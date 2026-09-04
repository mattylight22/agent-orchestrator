import { createPaseoClient, type PaseoAgentHandle, type PaseoClient, type PaseoWorkspaceHandle } from "@getpaseo/client";
import type { AgentQuestion, AgentQuestionPrompt, AgentRole, CapturedPlan, PaseoHost, ProviderModel, RoleConfig } from "../shared/contracts.js";
import { PaseoHostAdapter } from "./paseo-host-adapter.js";

type HostRuntime = {
  host: PaseoHost;
  client: PaseoClient;
  adapter: PaseoHostAdapter;
  catalog: ProviderModel[];
  workspaceMatches: WorkspaceMatch[];
  projectMatches: WorkspaceMatch[];
  unsubscribers: Array<() => void>;
  followedAgentIds: Set<string>;
  questionsByAgent: Map<string, Map<string, AgentQuestion>>;
  plansByAgent: Map<string, Map<string, CapturedPlan>>;
};

export interface WorkspaceMatch {
  hostId: string;
  projectId: string;
  projectRootPath: string;
  remoteFullName: string;
}

export interface PaseoEvents {
  hostChanged(host: PaseoHost): void;
  catalogChanged(hostId: string, catalog: ProviderModel[]): void;
  workspaceMatches(hostId: string, matches: WorkspaceMatch[]): void;
  agentChanged(input: { paseoAgentId: string; state: "running" | "idle" | "attention" | "failed" }): void;
  timeline(input: { paseoAgentId: string; role: "assistant" | "user" | "system" | "tool"; content: string; createdAt: string; sourceId: string }): void;
  question(input: { paseoAgentId: string; question: AgentQuestion; createdAt: string }): void;
  plan(input: { paseoAgentId: string; plan: CapturedPlan; createdAt: string }): void;
}

export function normalizePaseoEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint.trim());
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") throw new Error("Use a ws:// or wss:// Paseo endpoint");
  if (parsed.protocol === "ws:" && !parsed.port) parsed.port = "6767";
  const path = parsed.pathname.replace(/\/$/, "");
  parsed.pathname = path.endsWith("/ws") ? path : `${path}/ws`;
  return parsed.toString();
}

export function normalizeGithubRemote(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const source = remote.trim();
  if (!/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/github\.com\/)/i.test(source)) return null;
  const normalized = source
    .replace(/^git@github\.com:/i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return /^[^/]+\/[^/]+$/.test(normalized) ? normalized.toLowerCase() : null;
}

function mapLifecycle(value: unknown): "running" | "idle" | "attention" | "failed" {
  const status = String(value ?? "").toLowerCase();
  if (status.includes("fail") || status.includes("error")) return "failed";
  if (status.includes("attention") || status.includes("permission") || status.includes("input")) return "attention";
  if (status.includes("run") || status.includes("start") || status.includes("queue")) return "running";
  return "idle";
}

type PendingPermissionLike = {
  id: string;
  kind: string;
  input?: Record<string, unknown>;
};

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

export function titleFromPlan(body: string): string {
  const heading = body.split("\n").find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  return heading?.replace(/^#{1,3}\s+/, "").trim() || "Untitled plan";
}

export function parseAgentQuestionPrompts(input: unknown): AgentQuestionPrompt[] | null {
  if (!input || typeof input !== "object" || !Array.isArray((input as Record<string, unknown>).questions)) return null;
  const parsed: AgentQuestionPrompt[] = [];
  for (const rawQuestion of (input as Record<string, unknown>).questions as unknown[]) {
    if (!rawQuestion || typeof rawQuestion !== "object") return null;
    const question = rawQuestion as Record<string, unknown>;
    if (typeof question.question !== "string" || typeof question.header !== "string" || !Array.isArray(question.options)) return null;
    const options: AgentQuestionPrompt["options"] = [];
    for (const rawOption of question.options) {
      if (!rawOption || typeof rawOption !== "object" || typeof (rawOption as Record<string, unknown>).label !== "string") return null;
      const option = rawOption as Record<string, unknown>;
      options.push({
        label: option.label as string,
        ...(typeof option.description === "string" ? { description: option.description } : {}),
      });
    }
    parsed.push({
      question: question.question,
      header: question.header,
      options,
      multiSelect: question.multiSelect === true,
      allowOther: question.allowOther === true || question.isOther === true,
      allowEmpty: question.allowEmpty === true,
      ...(optionalString(question, "placeholder") ? { placeholder: optionalString(question, "placeholder") } : {}),
    });
  }
  return parsed.length ? parsed : null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class PaseoManager {
  private readonly runtimes = new Map<string, HostRuntime>();

  constructor(private readonly events: PaseoEvents) {}

  hostSnapshot(hosts: PaseoHost[]): PaseoHost[] {
    return hosts.map((host) => this.runtimes.get(host.id)?.host ?? host);
  }

  catalogs(): Record<string, ProviderModel[]> {
    return Object.fromEntries([...this.runtimes.entries()].map(([id, runtime]) => [id, runtime.catalog]));
  }

  async connect(host: PaseoHost): Promise<void> {
    await this.disconnect(host.id);
    const endpoint = normalizePaseoEndpoint(host.endpoint);
    const connecting = { ...host, endpoint, health: "connecting" as const, error: null };
    this.events.hostChanged(connecting);
    const client = createPaseoClient({
      url: endpoint,
      clientId: `agent-lens-${host.id}`,
      reconnect: { enabled: true, baseDelayMs: 1_000, maxDelayMs: 15_000 },
      connectTimeoutMs: 15_000,
    });
    const adapter = new PaseoHostAdapter(host.id, endpoint);
    const runtime: HostRuntime = { host: connecting, client, adapter, catalog: [], workspaceMatches: [], projectMatches: [], unsubscribers: [], followedAgentIds: new Set(), questionsByAgent: new Map(), plansByAgent: new Map() };
    this.runtimes.set(host.id, runtime);
    try {
      await withTimeout(client.connect(), 15_000, `Timed out connecting to ${endpoint}`);
      await withTimeout(adapter.connect(), 15_000, `Timed out discovering projects on ${host.name}`);
      const identity = await adapter.daemonIdentity();
      runtime.host = { ...host, endpoint, daemonId: identity.serverId, daemonVersion: identity.version, health: "connected", lastSyncAt: new Date().toISOString(), error: null };
      this.events.hostChanged(runtime.host);
      const agents = await client.agents.list({
        filter: { includeArchived: false },
        subscribe: { subscriptionId: `agent-lens-agents-${host.id}` },
      });
      for (const entry of agents.entries) {
        if (entry.agent.labels.app === "agent-lens") this.followAgent(runtime, client.agents.ref(entry.agent));
      }
      await this.refreshWorkspaces(host.id);
      await this.refreshProjects(host.id);
      await this.refreshCatalog(host.id);
      runtime.unsubscribers.push(
        client.agents.subscribe((update) => {
          if (update.kind !== "upsert") return;
          this.events.agentChanged({
            paseoAgentId: update.agent.id,
            state: update.agent.pendingPermissions.some((permission) => permission.kind === "question" || permission.kind === "plan") ? "attention" : mapLifecycle(update.agent.status),
          });
        }),
        client.providers.subscribe(() => void this.refreshCatalog(host.id)),
        client.workspaces.subscribe(() => void this.refreshWorkspaces(host.id)),
      );
    } catch (error) {
      await client.close().catch(() => undefined);
      await adapter.close().catch(() => undefined);
      runtime.host = { ...host, endpoint, health: "error", error: error instanceof Error ? error.message : String(error) };
      this.events.hostChanged(runtime.host);
      throw error;
    }
  }

  async disconnect(hostId: string): Promise<void> {
    const runtime = this.runtimes.get(hostId);
    if (!runtime) return;
    runtime.unsubscribers.forEach((unsubscribe) => unsubscribe());
    await runtime.client.close().catch(() => undefined);
    await runtime.adapter.close().catch(() => undefined);
    this.runtimes.delete(hostId);
  }

  async refreshWorkspaces(hostId: string): Promise<WorkspaceMatch[]> {
    const runtime = this.requireRuntime(hostId);
    const matches = new Map<string, WorkspaceMatch>();
    let cursor: string | undefined;
    do {
      const page = await runtime.client.workspaces.list({
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
        subscribe: { subscriptionId: `agent-lens-workspaces-${hostId}` },
      });
      for (const workspace of page.entries) {
        const fullName = normalizeGithubRemote(workspace.gitRuntime?.remoteUrl ?? workspace.project?.checkout.remoteUrl);
        if (!fullName) continue;
        matches.set(`${fullName}:${workspace.projectId}`, {
          hostId,
          projectId: workspace.projectId,
          projectRootPath: workspace.projectRootPath,
          remoteFullName: fullName,
        });
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    runtime.workspaceMatches = [...matches.values()];
    this.emitMatches(runtime);
    return runtime.workspaceMatches;
  }

  async refreshProjects(hostId: string): Promise<WorkspaceMatch[]> {
    const runtime = this.requireRuntime(hostId);
    const knownProjectIds = new Set(runtime.workspaceMatches.map((match) => match.projectId));
    runtime.projectMatches = await runtime.adapter.discoverProjects(hostId, knownProjectIds, normalizeGithubRemote);
    this.emitMatches(runtime);
    return runtime.projectMatches;
  }

  async refreshRepositoryMatches(): Promise<WorkspaceMatch[]> {
    const matches: WorkspaceMatch[] = [];
    for (const hostId of this.runtimes.keys()) {
      await this.refreshWorkspaces(hostId);
      await this.refreshProjects(hostId);
      matches.push(...this.combinedMatches(this.requireRuntime(hostId)));
    }
    return matches;
  }

  repositoryMatches(): WorkspaceMatch[] {
    return [...this.runtimes.values()].flatMap((runtime) => this.combinedMatches(runtime));
  }

  async ensureRepositoryProject(hostId: string, remoteFullName: string): Promise<WorkspaceMatch> {
    const runtime = this.requireRuntime(hostId);
    const normalized = remoteFullName.toLowerCase();
    await this.refreshWorkspaces(hostId);
    await this.refreshProjects(hostId);
    const existing = this.combinedMatches(runtime).filter((match) => match.remoteFullName === normalized);
    if (existing.length > 1) {
      throw new Error(`Multiple Paseo projects match ${remoteFullName}; remove the duplicate or choose an existing mapped project`);
    }
    if (existing[0]) return existing[0];

    const created = await runtime.adapter.cloneGithubProject(hostId, remoteFullName, normalizeGithubRemote);
    runtime.projectMatches = [
      ...runtime.projectMatches.filter((match) => match.remoteFullName !== normalized),
      created,
    ];
    this.emitMatches(runtime);
    return created;
  }

  private combinedMatches(runtime: HostRuntime): WorkspaceMatch[] {
    const matches = new Map<string, WorkspaceMatch>();
    for (const match of [...runtime.projectMatches, ...runtime.workspaceMatches]) matches.set(`${match.remoteFullName}:${match.projectId}`, match);
    return [...matches.values()];
  }

  private emitMatches(runtime: HostRuntime): void {
    this.events.workspaceMatches(runtime.host.id, this.combinedMatches(runtime));
  }

  async refreshCatalog(hostId: string, cwd?: string): Promise<ProviderModel[]> {
    const runtime = this.requireRuntime(hostId);
    let snapshot: Awaited<ReturnType<PaseoClient["providers"]["snapshot"]>>;
    try {
      snapshot = await runtime.client.providers.waitForReady({
        ...(cwd ? { cwd } : {}),
        timeoutMs: 60_000,
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Update the host to wait for provider discovery.") throw error;
      const deadline = Date.now() + 60_000;
      snapshot = await runtime.client.providers.snapshot();
      while (snapshot.entries.some((entry) => entry.status === "loading") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        snapshot = await runtime.client.providers.snapshot();
      }
      if (snapshot.entries.some((entry) => entry.status === "loading")) {
        throw new Error("Timed out waiting for provider discovery");
      }
    }
    const catalog: ProviderModel[] = [];
    for (const rawEntry of snapshot.entries as Array<Record<string, unknown>>) {
      const provider = String(rawEntry.provider ?? "");
      const providerLabel = String(rawEntry.label ?? provider);
      const status = String(rawEntry.status ?? "error") as ProviderModel["status"];
      const models = Array.isArray(rawEntry.models) ? (rawEntry.models as Array<Record<string, unknown>>) : [];
      const modes = Array.isArray(rawEntry.modes) ? (rawEntry.modes as Array<Record<string, unknown>>) : [];
      for (const model of models) {
        const thinking = Array.isArray(model.thinkingOptions)
          ? (model.thinkingOptions as Array<Record<string, unknown>>)
          : [];
        catalog.push({
          provider,
          providerLabel,
          model: String(model.id),
          modelLabel: String(model.label ?? model.id),
          status,
          modes: modes.map((mode) => ({ id: String(mode.id), label: String(mode.label ?? mode.id) })),
          thinkingOptions: thinking.map((option) => ({ id: String(option.id), label: String(option.label ?? option.id) })),
        });
      }
    }
    runtime.catalog = catalog;
    this.events.catalogChanged(hostId, catalog);
    return catalog;
  }

  validateRole(hostId: string, config: RoleConfig): RoleConfig {
    const runtime = this.requireRuntime(hostId);
    const match = runtime.catalog.find((item) => item.provider === config.provider && item.model === config.model && item.status === "ready");
    if (!match) throw new Error(`${config.provider}/${config.model} is not available on ${runtime.host.name}`);
    return {
      ...config,
      ...(config.thinkingOptionId && !match.thinkingOptions.some((option) => option.id === config.thinkingOptionId)
        ? { thinkingOptionId: undefined }
        : {}),
    };
  }

  async createCheckoutWorkspace(input: {
    hostId: string;
    projectId: string;
    projectRootPath: string;
    branchName: string;
    title: string;
  }): Promise<PaseoWorkspaceHandle> {
    const runtime = this.requireRuntime(input.hostId);
    return runtime.client.workspaces.create({
      title: input.title,
      source: {
        kind: "worktree",
        cwd: input.projectRootPath,
        projectId: input.projectId,
        action: "checkout",
        refName: input.branchName,
        worktreeSlug: input.branchName.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-|-$/g, ""),
      },
    });
  }

  async createAgent(input: {
    hostId: string;
    workspaceId: string;
    config: RoleConfig;
    title: string;
    prompt: string;
    role: AgentRole;
    workstreamId: string;
    outputSchema?: Record<string, unknown>;
  }): Promise<PaseoAgentHandle> {
    const runtime = this.requireRuntime(input.hostId);
    const workspace = runtime.client.workspaces.ref(input.workspaceId);
    const descriptor = await workspace.refresh();
    await this.refreshCatalog(input.hostId, descriptor?.workspaceDirectory ?? descriptor?.projectRootPath);
    const resolved = this.validateRole(input.hostId, input.config);
    const agent = await workspace.agents.create({
      config: {
        provider: `${resolved.provider}/${resolved.model}`,
        ...(resolved.modeId ? { modeId: resolved.modeId } : {}),
        ...(resolved.thinkingOptionId ? { thinkingOptionId: resolved.thinkingOptionId } : {}),
        ...(resolved.featureValues ? { featureValues: resolved.featureValues } : {}),
        ...(input.role === "reviewer" && resolved.provider === "codex"
          ? { options: { approval_policy: "never", sandbox_mode: "read-only", web_search: "disabled" } }
          : {}),
      },
      title: input.title,
      prompt: input.prompt,
      labels: { app: "agent-lens", workstream: input.workstreamId, role: input.role },
      ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    });
    this.followAgent(runtime, agent);
    return agent;
  }

  agent(hostId: string, agentId: string): PaseoAgentHandle {
    return this.requireRuntime(hostId).client.agents.ref(agentId);
  }

  async send(hostId: string, agentId: string, prompt: string): Promise<void> {
    const runtime = this.requireRuntime(hostId);
    const agent = runtime.client.agents.ref(agentId);
    await agent.send(prompt);
    this.followAgent(runtime, agent);
  }

  async respondToQuestion(
    hostId: string,
    agentId: string,
    requestId: string,
    answers: Record<string, string> | null,
  ): Promise<void> {
    const runtime = this.requireRuntime(hostId);
    const agent = runtime.client.agents.ref(agentId);
    await agent.refresh();
    const permission = agent.current()?.pendingPermissions.find(
      (candidate) => candidate.id === requestId && candidate.kind === "question",
    );
    if (!permission) throw new Error("This question is no longer waiting for an answer");
    const existing = runtime.questionsByAgent.get(agentId)?.get(requestId);
    await runtime.adapter.respondToQuestion(agentId, requestId, permission.input ?? {}, answers);
    if (existing) {
      this.events.question({
        paseoAgentId: agentId,
        question: {
          ...existing,
          status: answers ? "answered" : "dismissed",
          ...(answers ? { answers } : {}),
        },
        createdAt: new Date().toISOString(),
      });
      runtime.questionsByAgent.get(agentId)?.delete(requestId);
    }
    this.events.agentChanged({ paseoAgentId: agentId, state: "running" });
  }

  async resolveCapturedPlan(hostId: string, agentId: string, requestId: string, status: "implementation-ready" | "cancelled"): Promise<void> {
    const runtime = this.requireRuntime(hostId);
    const agent = runtime.client.agents.ref(agentId);
    await agent.refresh();
    const permission = agent.current()?.pendingPermissions.find(
      (candidate) => candidate.id === requestId && candidate.kind === "plan",
    );
    if (!permission) return;
    await runtime.adapter.resolveCapturedPlan(
      agentId,
      requestId,
      status === "implementation-ready"
        ? "Plan captured and marked implementation-ready in Agent Lens. A separate builder agent will implement it."
        : "Plan captured and cancelled in Agent Lens. Do not implement it.",
    );
    runtime.plansByAgent.get(agentId)?.delete(requestId);
    this.events.agentChanged({ paseoAgentId: agentId, state: "idle" });
  }

  async requestPlanRevision(hostId: string, agentId: string, requestId: string, feedback: string): Promise<boolean> {
    const runtime = this.requireRuntime(hostId);
    const agent = runtime.client.agents.ref(agentId);
    await agent.refresh();
    const permission = agent.current()?.pendingPermissions.find(
      (candidate) => candidate.id === requestId && candidate.kind === "plan",
    );
    if (!permission) return false;
    await runtime.adapter.resolveCapturedPlan(
      agentId,
      requestId,
      `Revise the plan before implementation. Apply this feedback:\n\n${feedback}\n\nSubmit the complete revised plan again when it is ready for review.`,
    );
    runtime.plansByAgent.get(agentId)?.delete(requestId);
    this.events.agentChanged({ paseoAgentId: agentId, state: "running" });
    this.followAgent(runtime, agent);
    return true;
  }

  async assertWorkspaceReadyForPr(hostId: string, workspaceId: string, branchName: string): Promise<void> {
    const workspace = this.requireRuntime(hostId).client.workspaces.ref(workspaceId);
    const descriptor = await workspace.refresh();
    if (!descriptor) throw new Error("The Paseo workspace is unavailable");
    if (descriptor.gitRuntime?.currentBranch && descriptor.gitRuntime.currentBranch !== branchName) {
      throw new Error(`The Paseo workspace is on ${descriptor.gitRuntime.currentBranch}, not ${branchName}`);
    }
    if (descriptor.gitRuntime?.isDirty !== false) {
      throw new Error("The Paseo workspace must be clean before creating the pull request");
    }
    if ((descriptor.gitRuntime.aheadOfOrigin ?? 0) > 0) {
      throw new Error("The Paseo workspace has commits that have not been pushed");
    }
  }

  private followAgent(runtime: HostRuntime, agent: PaseoAgentHandle): void {
    if (runtime.followedAgentIds.has(agent.id)) return;
    runtime.followedAgentIds.add(agent.id);
    runtime.unsubscribers.push(agent.subscribe((update) => {
      if (update.kind === "upsert") {
        this.syncAgentQuestions(runtime, agent.id, update.agent.pendingPermissions);
        this.syncAgentPlans(runtime, agent.id, update.agent.pendingPermissions);
        this.events.agentChanged({
          paseoAgentId: agent.id,
          state: update.agent.pendingPermissions.some((permission) => permission.kind === "question" || permission.kind === "plan")
            ? "attention"
            : mapLifecycle(update.agent.status),
        });
      }
    }));
    const currentPermissions = agent.current()?.pendingPermissions ?? [];
    this.syncAgentQuestions(runtime, agent.id, currentPermissions);
    this.syncAgentPlans(runtime, agent.id, currentPermissions);
    if (currentPermissions.some((permission) => permission.kind === "question" || permission.kind === "plan")) {
      this.events.agentChanged({ paseoAgentId: agent.id, state: "attention" });
    }
    runtime.unsubscribers.push(agent.timeline.subscribe(({ event, timestamp, seq, epoch }) => {
      if (event.type !== "timeline") return;
      const item = event.item;
      if (item.type !== "assistant_message" && item.type !== "user_message" && item.type !== "reasoning" && item.type !== "error") return;
      const content = item.type === "error" ? item.message : item.text;
      if (!content) return;
      const role = item.type === "assistant_message" ? "assistant" : item.type === "user_message" ? "user" : "system";
      const messageId = "messageId" in item ? item.messageId : undefined;
      this.events.timeline({
        paseoAgentId: agent.id,
        role,
        content,
        createdAt: timestamp,
        sourceId: `${agent.id}:${messageId ?? `${epoch ?? "stream"}:${seq ?? timestamp}:${item.type}`}`,
      });
    }));
    void this.syncAgentTimeline(runtime, agent).catch(() => undefined);
  }

  private async syncAgentTimeline(runtime: HostRuntime, agent: PaseoAgentHandle): Promise<void> {
    const page = await agent.timeline.refetch({ limit: 500, projection: "projected" });
    this.syncAgentQuestions(runtime, agent.id, page.agent?.pendingPermissions ?? []);
    this.syncAgentPlans(runtime, agent.id, page.agent?.pendingPermissions ?? []);
    if (page.agent?.pendingPermissions.some((permission) => permission.kind === "question" || permission.kind === "plan")) {
      this.events.agentChanged({ paseoAgentId: agent.id, state: "attention" });
    }
    for (const entry of page.entries) {
      const item = entry.item;
      if (item.type !== "assistant_message" && item.type !== "user_message" && item.type !== "reasoning" && item.type !== "error") continue;
      const content = item.type === "error" ? item.message : item.text;
      if (!content) continue;
      const role = item.type === "assistant_message" ? "assistant" : item.type === "user_message" ? "user" : "system";
      const messageId = "messageId" in item ? item.messageId : undefined;
      this.events.timeline({
        paseoAgentId: agent.id,
        role,
        content,
        createdAt: entry.timestamp,
        sourceId: `${agent.id}:${messageId ?? `${page.epoch ?? "timeline"}:${entry.seqStart}-${entry.seqEnd}:${item.type}`}`,
      });
    }
  }

  private syncAgentQuestions(runtime: HostRuntime, agentId: string, permissions: readonly PendingPermissionLike[]): void {
    const previous = runtime.questionsByAgent.get(agentId) ?? new Map<string, AgentQuestion>();
    const current = new Map<string, AgentQuestion>();
    for (const permission of permissions) {
      if (permission.kind !== "question") continue;
      const questions = parseAgentQuestionPrompts(permission.input);
      if (!questions) continue;
      const question: AgentQuestion = {
        agentId,
        requestId: permission.id,
        status: "pending",
        questions,
      };
      current.set(permission.id, question);
      this.events.question({ paseoAgentId: agentId, question, createdAt: new Date().toISOString() });
    }
    for (const [requestId, question] of previous) {
      if (current.has(requestId)) continue;
      this.events.question({
        paseoAgentId: agentId,
        question: { ...question, status: "answered" },
        createdAt: new Date().toISOString(),
      });
    }
    runtime.questionsByAgent.set(agentId, current);
  }

  private syncAgentPlans(runtime: HostRuntime, agentId: string, permissions: readonly PendingPermissionLike[]): void {
    const previous = runtime.plansByAgent.get(agentId) ?? new Map<string, CapturedPlan>();
    const current = new Map<string, CapturedPlan>();
    for (const permission of permissions) {
      if (permission.kind !== "plan" || typeof permission.input?.plan !== "string" || !permission.input.plan.trim()) continue;
      const plan: CapturedPlan = {
        agentId,
        requestId: permission.id,
        title: titleFromPlan(permission.input.plan),
        body: permission.input.plan,
      };
      current.set(permission.id, plan);
      if (previous.get(permission.id)?.body !== plan.body) {
        this.events.plan({ paseoAgentId: agentId, plan, createdAt: new Date().toISOString() });
      }
    }
    runtime.plansByAgent.set(agentId, current);
  }

  private requireRuntime(hostId: string): HostRuntime {
    const runtime = this.runtimes.get(hostId);
    if (!runtime || runtime.host.health !== "connected") throw new Error("Paseo host is not connected");
    return runtime;
  }
}
