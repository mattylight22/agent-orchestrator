import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, Notification, shell } from "electron";
import { join } from "node:path";
import { z } from "zod";
import type { AppSettings, AppSnapshot, CloudState, PaseoHost, Repository } from "../shared/contracts.js";
import { createHostInputSchema, createWorkstreamInputSchema, planStatuses, supabaseCredentialsSchema, workstreamStatuses } from "../shared/contracts.js";
import { AppDatabase } from "./database.js";
import { GithubService } from "./github-service.js";
import { normalizePaseoEndpoint, PaseoManager } from "./paseo-manager.js";
import type { WorkspaceMatch } from "./paseo-manager.js";
import { WorkstreamService } from "./workstream-service.js";
import { seedDemoData } from "./seed-demo.js";
import { SupabaseSyncService } from "./supabase-sync-service.js";

const userDataRoot = join(app.getPath("appData"), "agent-lens");
app.setName("Agent Lens");
process.title = "Agent Lens";
app.setPath("userData", process.env.AGENT_LENS_DEMO === "1" ? join(userDataRoot, "demo") : userDataRoot);

let mainWindow: BrowserWindow | null = null;
let db: AppDatabase;
let github: GithubService;
let paseo: PaseoManager;
let workstreams: WorkstreamService;
let cloud: SupabaseSyncService;
const liveHosts = new Map<string, PaseoHost>();
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(app.getAppPath(), "resources", "icon.png");

function repositories(): Repository[] {
  const mappings = db.hostRepositoryRows();
  return db.listRepositoryPayloads<Repository>().map((repository) => ({
    ...repository,
    hostAvailability: mappings
      .filter((mapping) => mapping.repositoryId === repository.id)
      .map((mapping) => ({ ...mapping, available: true })),
  }));
}

function settings(): AppSettings {
  const value = db.settings();
  return {
    ...value,
    githubConnected: github.connected(),
    githubLogin: github.login(),
  };
}

function snapshot(): AppSnapshot {
  const storedHosts = db.listHosts();
  return {
    settings: settings(),
    cloud: cloud?.state() ?? emptyCloudState(),
    hosts: storedHosts.map((host) => liveHosts.get(host.id) ?? host),
    repositories: repositories(),
    workstreams: db.listWorkstreams(),
    plans: db.listPlans(),
    planComments: db.listPlanComments(),
    providerCatalogs: paseo.catalogs(),
  };
}

function publish(scheduleCloud = true): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("lens:snapshot", snapshot());
  if (scheduleCloud) cloud?.scheduleSync();
}

function emptyCloudState(): CloudState {
  return { configured: false, signedIn: false, email: null, syncing: false, syncEnabled: false, lastSyncAt: null, error: null };
}

function toast(kind: "success" | "error" | "info", message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("lens:toast", { kind, message });
  if ((kind === "success" || kind === "error") && Notification.isSupported()) {
    new Notification({ title: "Agent Lens", body: message }).show();
  }
}

function persistWorkspaceMatches(matches: WorkspaceMatch[]): void {
  const repos = db.listRepositoryPayloads<Repository>();
  const groups = new Map<string, WorkspaceMatch[]>();
  for (const match of matches) {
    const key = `${match.hostId}:${match.remoteFullName}`;
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  for (const candidates of groups.values()) {
    const first = candidates[0];
    const repo = repos.find((candidate) => candidate.fullName.toLowerCase() === first.remoteFullName);
    if (!repo) continue;
    const existing = db.hostRepository(repo.id, first.hostId);
    const selected = candidates.find((candidate) => candidate.projectId === existing?.projectId)
      ?? (candidates.length === 1 ? first : undefined);
    if (selected) db.upsertHostRepository({ repositoryId: repo.id, hostId: selected.hostId, projectId: selected.projectId, projectRootPath: selected.projectRootPath, remoteUrl: selected.remoteFullName });
  }
}

function applyTheme(theme: AppSettings["theme"]): void {
  nativeTheme.themeSource = theme;
}

function externalUrlAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "github.com" || url.hostname.endsWith(".github.com")) return true;
    return db.listHosts().some((host) => {
      try { return new URL(host.endpoint).hostname === url.hostname; } catch { return false; }
    });
  } catch {
    return false;
  }
}

function registerIpc(): void {
  ipcMain.handle("lens:bootstrap", () => snapshot());
  ipcMain.handle("lens:settings:update", async (_event, patch: Partial<AppSettings>) => {
    const current = db.settings();
    const next: AppSettings = {
      ...current,
      ...patch,
      globalRoles: { ...current.globalRoles, ...(patch.globalRoles ?? {}) },
      hostRoleOverrides: { ...current.hostRoleOverrides, ...(patch.hostRoleOverrides ?? {}) },
      repositoryDefaults: { ...current.repositoryDefaults, ...(patch.repositoryDefaults ?? {}) },
      promptTemplates: { ...current.promptTemplates, ...(patch.promptTemplates ?? {}) },
      cloud: { ...current.cloud, ...(patch.cloud ?? {}) },
    };
    db.saveSettings(next);
    applyTheme(next.theme);
    if (patch.cloud) await cloud.configure(next.cloud);
    publish();
    return settings();
  });
  ipcMain.handle("lens:host:create", async (_event, raw: unknown) => {
    const input = createHostInputSchema.parse(raw);
    const host = db.createHost(input.name, normalizePaseoEndpoint(input.endpoint));
    publish();
    await paseo.connect(host).catch((error) => toast("error", error instanceof Error ? error.message : String(error)));
    return liveHosts.get(host.id) ?? host;
  });
  ipcMain.handle("lens:host:delete", async (_event, hostId: string) => {
    await paseo.disconnect(hostId);
    liveHosts.delete(hostId);
    db.deleteHost(hostId);
    publish();
  });
  ipcMain.handle("lens:host:connect", async (_event, hostId: string) => {
    const host = db.listHosts().find((candidate) => candidate.id === hostId);
    if (!host) throw new Error("Paseo host not found");
    await paseo.connect(host);
    publish();
  });
  ipcMain.handle("lens:github:device", async (_event, clientId: string) => {
    const current = db.settings();
    db.saveSettings({ ...current, githubClientId: clientId });
    const login = await github.authenticateDevice(clientId, (payload) => {
      mainWindow?.webContents.send("lens:github-verification", payload);
      void shell.openExternal(payload.verificationUri);
    });
    toast("success", `Connected to GitHub as ${login}`);
    await refreshRepositories();
    publish();
  });
  ipcMain.handle("lens:github:disconnect", () => {
    github.disconnect();
    publish();
  });
  ipcMain.handle("lens:github:refresh", refreshRepositories);
  ipcMain.handle("lens:paseo:refresh-mappings", async () => {
    const matches = await paseo.refreshRepositoryMatches();
    persistWorkspaceMatches(matches);
    publish();
  });
  ipcMain.handle("lens:supabase:sign-in", async (_event, email: string, password: string) => {
    const credentials = supabaseCredentialsSchema.parse({ email, password });
    await cloud.signIn(credentials.email, credentials.password);
    toast("success", "Supabase cloud sync connected");
    publish(false);
  });
  ipcMain.handle("lens:supabase:sign-up", async (_event, email: string, password: string) => {
    const credentials = supabaseCredentialsSchema.parse({ email, password });
    const result = await cloud.signUp(credentials.email, credentials.password);
    toast("success", result.confirmationRequired ? "Check your email to confirm your Supabase account" : "Supabase account created and connected");
    publish(false);
    return result;
  });
  ipcMain.handle("lens:supabase:password-reset", async (_event, email: string) => {
    const parsed = z.string().trim().email().parse(email);
    await cloud.requestPasswordReset(parsed);
    toast("success", "Supabase password recovery email requested");
    publish(false);
  });
  ipcMain.handle("lens:supabase:sign-out", async () => {
    await cloud.signOut();
    publish(false);
  });
  ipcMain.handle("lens:supabase:sync", async () => {
    await cloud.sync();
    toast("success", "Cloud sync complete");
    publish(false);
  });
  ipcMain.handle("lens:workstream:create", async (_event, raw: unknown) => {
    const input = createWorkstreamInputSchema.parse(raw);
    const result = await workstreams.create(input);
    publish();
    return result;
  });
  ipcMain.handle("lens:workstream:status", (_event, id: string, status: string) => {
    if (!workstreamStatuses.includes(status as never)) throw new Error("Invalid workstream status");
    return workstreams.updateStatus(id, status as (typeof workstreamStatuses)[number]);
  });
  ipcMain.handle("lens:workstream:followup", (_event, id: string, prompt: string) => workstreams.sendFollowup(id, prompt));
  ipcMain.handle(
    "lens:workstream:question",
    (_event, id: string, agentId: string, requestId: string, answers: Record<string, string> | null) => {
      if (!id || !agentId || !requestId) throw new Error("Invalid agent question response");
      if (answers !== null && (typeof answers !== "object" || Array.isArray(answers) || Object.values(answers).some((answer) => typeof answer !== "string"))) {
        throw new Error("Invalid agent question answers");
      }
      return workstreams.respondToAgentQuestion(id, agentId, requestId, answers);
    },
  );
  ipcMain.handle("lens:plan:status", (_event, id: string, status: string) => {
    if (!planStatuses.includes(status as never)) throw new Error("Invalid plan status");
    return workstreams.updatePlanStatus(id, status as (typeof planStatuses)[number]);
  });
  ipcMain.handle("lens:plan:dependencies", (_event, id: string, dependencyIds: string[]) => {
    if (!Array.isArray(dependencyIds) || dependencyIds.some((dependencyId) => typeof dependencyId !== "string")) throw new Error("Invalid plan dependencies");
    return workstreams.setPlanDependencies(id, dependencyIds);
  });
  ipcMain.handle("lens:plan-comment:add", (_event, planId: string, quote: string, comment: string, startOffset: number, endOffset: number) => {
    if (!planId || !quote.trim() || !comment.trim() || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset) throw new Error("Invalid plan comment");
    const value = db.addPlanComment({ planId, quote: quote.trim(), comment: comment.trim(), startOffset, endOffset });
    publish();
    return value;
  });
  ipcMain.handle("lens:plan-comment:delete", (_event, id: string) => {
    if (!id) throw new Error("Invalid plan comment");
    db.deletePlanComment(id);
    publish();
  });
  ipcMain.handle("lens:plan-comment:submit", (_event, planId: string) => workstreams.submitPlanComments(planId));
  ipcMain.handle("lens:plan:begin", (_event, id: string) => workstreams.beginPlan(id));
  ipcMain.handle("lens:workstream:plan-ready", (_event, id: string) => workstreams.markPlanReady(id));
  ipcMain.handle("lens:workstream:build", (_event, id: string, config?: AppSettings["globalRoles"]["builder"]) => workstreams.startBuild(id, config));
  ipcMain.handle("lens:workstream:review-fix", (_event, id: string) => workstreams.startReviewFix(id));
  ipcMain.handle("lens:workstream:complete-review", (_event, id: string) => workstreams.completeReview(id));
  ipcMain.handle("lens:workstream:independent-review", (_event, id: string) => workstreams.startIndependentReview(id));
  ipcMain.handle("lens:external", async (_event, url: string) => {
    if (!externalUrlAllowed(url)) throw new Error("External URL is not allowed");
    await shell.openExternal(url);
  });
}

async function refreshRepositories(): Promise<Repository[]> {
  const values = await github.listRepositories();
  values.forEach((repository) => db.upsertRepository(repository.id, repository));
  const matches = paseo
    ? await paseo.refreshRepositoryMatches()
    : [];
  persistWorkspaceMatches(matches);
  await workstreams?.reconcileGithub();
  publish();
  return repositories();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f4f3ef",
    icon: appIconPath,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (externalUrlAllowed(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    const demoRoute = process.env.AGENT_LENS_DEMO_ROUTE ?? "";
    void mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL.replace(/\/$/, "")}${demoRoute}`);
  }
  else void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

void app.whenReady().then(async () => {
  const icon = nativeImage.createFromPath(appIconPath);
  if (process.platform === "darwin" && !icon.isEmpty()) app.dock?.setIcon(icon);
  db = new AppDatabase();
  if (process.env.AGENT_LENS_DEMO === "1") {
    seedDemoData(db);
    if (process.env.AGENT_LENS_DEMO_THEME === "dark") db.saveSettings({ ...db.settings(), theme: "dark" });
  }
  github = new GithubService();
  paseo = new PaseoManager({
    hostChanged(host) {
      liveHosts.set(host.id, host);
      db.updateHostEndpoint(host.id, host.endpoint);
      if (host.daemonId) db.updateHostIdentity(host.id, host.daemonId, host.daemonVersion);
      publish();
    },
    catalogChanged() {
      publish();
    },
    workspaceMatches(hostId, matches) {
      persistWorkspaceMatches(matches.map((match) => ({ ...match, hostId })));
      publish();
    },
    agentChanged(input) {
      db.updateAgentByPaseoId(input.paseoAgentId, input.state);
      const context = db.agentContext(input.paseoAgentId);
      if (context) db.updateWorkstream(context.workstreamId, { agentState: input.state });
      publish();
    },
    timeline(input) {
      const context = db.agentContext(input.paseoAgentId);
      if (!context) return;
      db.addTimeline(context.workstreamId, {
        role: input.role,
        kind: input.role === "tool" ? "tool" : "message",
        content: input.content,
        createdAt: input.createdAt,
        agentRole: context.role,
        sourceId: input.sourceId,
      });
      publish();
    },
    question(input) {
      const context = db.agentContext(input.paseoAgentId);
      if (!context) return;
      db.addTimeline(context.workstreamId, {
        role: "tool",
        kind: "question",
        content: JSON.stringify(input.question),
        createdAt: input.createdAt,
        agentRole: context.role,
        sourceId: `${input.paseoAgentId}:question:${input.question.requestId}`,
      });
      publish();
    },
    plan(input) {
      const context = db.agentContext(input.paseoAgentId);
      if (!context || context.role !== "planner") return;
      const existing = db.planForWorkstream(context.workstreamId);
      if (existing?.sourcePermissionId === input.plan.requestId && existing.body === input.plan.body) return;
      const revised = Boolean(existing && (existing.body !== input.plan.body || existing.title !== input.plan.title));
      db.upsertCapturedPlan({
        workstreamId: context.workstreamId,
        title: input.plan.title,
        body: input.plan.body,
        sourceAgentId: input.plan.agentId,
        sourcePermissionId: input.plan.requestId,
      });
      if (!existing || revised) {
        db.addAudit(
          context.workstreamId,
          revised ? "plan.revised" : "plan.captured",
          revised ? "Paseo plan revised" : "Paseo plan captured",
          input.plan.title,
        );
      }
      publish();
    },
  });
  workstreams = new WorkstreamService(db, github, paseo, publish, toast);
  cloud = new SupabaseSyncService(db, () => publish(false));
  await cloud.configure(db.settings().cloud).catch((error) => toast("error", error instanceof Error ? error.message : String(error)));
  applyTheme(db.settings().theme);
  registerIpc();
  createWindow();
  if (process.env.AGENT_LENS_DEMO !== "1" && github.connected()) {
    void workstreams.reconcileGithub();
    setInterval(() => void workstreams.reconcileGithub(), 60_000).unref();
  }
  if (process.env.AGENT_LENS_DEMO !== "1") {
    for (const host of db.listHosts().filter((candidate) => candidate.enabled)) {
      void paseo.connect(host).catch(() => undefined);
    }
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  cloud?.dispose();
  db?.close();
});
