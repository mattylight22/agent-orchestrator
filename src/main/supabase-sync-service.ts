import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentRun, AuditEvent, CloudState, Plan, PlanComment, Repository, ReviewIteration, TimelineItem, Workstream } from "../shared/contracts.js";
import type { AppDatabase, LocalSyncRecord, LocalSyncTombstone } from "./database.js";
import { SecretVault } from "./secret-vault.js";

interface SupabaseConfiguration {
  supabaseUrl: string;
  supabasePublishableKey: string;
  syncEnabled: boolean;
}

type CloudRow = Record<string, unknown>;

const realtimeTables = [
  "user_settings", "repositories", "paseo_hosts", "host_repository_mappings", "workstreams",
  "agent_runs", "timeline_items", "agent_questions", "plans", "plan_dependencies",
  "plan_comments", "review_iterations", "audit_events", "workflow_runs",
] as const;

export class SupabaseSyncService {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private authSubscription: { unsubscribe(): void } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private readonly sessionVault = new SecretVault("supabase-session.bin");
  private value: CloudState = {
    configured: false,
    signedIn: false,
    email: null,
    syncing: false,
    syncEnabled: false,
    lastSyncAt: null,
    error: null,
  };

  constructor(private readonly db: AppDatabase, private readonly changed: () => void) {}

  state(): CloudState { return { ...this.value }; }

  async configure(configuration: SupabaseConfiguration): Promise<void> {
    this.disposeClient();
    const url = configuration.supabaseUrl.trim().replace(/\/$/, "");
    const key = configuration.supabasePublishableKey.trim();
    this.value = { ...this.value, configured: Boolean(url && key), syncEnabled: configuration.syncEnabled, signedIn: false, email: null, error: null };
    if (!url || !key) { this.changed(); return; }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Supabase project URL must use HTTPS");

    const storage = {
      getItem: async (storageKey: string): Promise<string | null> => this.sessionVault.read<Record<string, string>>()?.[storageKey] ?? null,
      setItem: async (storageKey: string, item: string): Promise<void> => this.sessionVault.write({ ...(this.sessionVault.read<Record<string, string>>() ?? {}), [storageKey]: item }),
      removeItem: async (storageKey: string): Promise<void> => {
        const values = this.sessionVault.read<Record<string, string>>() ?? {};
        delete values[storageKey];
        if (Object.keys(values).length) this.sessionVault.write(values); else this.sessionVault.clear();
      },
    };
    this.client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage } });
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      this.updateSession(session?.user.email ?? null, Boolean(session));
      if (session) this.subscribe(session.user.id);
      if (session && this.value.syncEnabled) this.scheduleSync(150);
    });
    this.authSubscription = data.subscription;
    const { data: sessionData, error } = await this.client.auth.getSession();
    if (error) throw error;
    this.updateSession(sessionData.session?.user.email ?? null, Boolean(sessionData.session));
    if (sessionData.session) {
      this.subscribe(sessionData.session.user.id);
      if (configuration.syncEnabled) this.scheduleSync(150);
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    const client = this.requireClient();
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      const authError = error as typeof error & { code?: string };
      if (authError.code === "invalid_credentials" || /invalid login credentials/i.test(authError.message)) {
        throw new Error("Supabase Auth rejected this email/password for project lexvjfpuofjsannrwkwx. Confirm this is an Email provider account with a password.");
      }
      throw error;
    }
    this.updateSession(data.user.email ?? null, true);
    this.subscribe(data.user.id);
    if (this.value.syncEnabled) await this.sync().catch(() => undefined);
  }

  async signUp(email: string, password: string): Promise<{ confirmationRequired: boolean }> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signUp({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
    if (data.session && data.user) {
      this.updateSession(data.user.email ?? null, true);
      this.subscribe(data.user.id);
      if (this.value.syncEnabled) await this.sync().catch(() => undefined);
    }
    return { confirmationRequired: !data.session };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.requireClient().auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.updateSession(null, false);
  }

  scheduleSync(delay = 1_500): void {
    if (!this.client || !this.value.signedIn || !this.value.syncEnabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.sync().catch(() => undefined); }, delay);
    this.timer.unref?.();
  }

  async sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.performSync().finally(() => { this.running = null; });
    return this.running;
  }

  dispose(): void { this.disposeClient(); }

  private async performSync(): Promise<void> {
    const client = this.requireClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) throw userError ?? new Error("Sign in to Supabase before syncing");
    if (!this.value.syncEnabled) throw new Error("Cloud sync is disabled");
    const userId = userData.user.id;
    this.value = { ...this.value, syncing: true, error: null };
    this.changed();
    try {
      const remote = await this.fetchRemote(client, userId);
      const firstSyncForUser = this.db.cloudSyncUser() !== userId;
      const localRecords = new Map(this.db.syncRecords().map((record) => [`${record.entityType}:${record.entityId}`, record]));
      for (const record of remote.records.sort((a, b) => syncOrder(a.entityType) - syncOrder(b.entityType))) {
        const local = localRecords.get(`${record.entityType}:${record.entityId}`);
        if (firstSyncForUser || !local || Date.parse(record.sourceUpdatedAt) > Date.parse(local.sourceUpdatedAt)) this.db.applySyncRecord(record);
      }
      for (const repository of remote.repositories) this.db.upsertRepository(repository.id, repository);
      for (const mapping of remote.mappings) this.db.upsertHostRepository(mapping);

      for (const deleted of remote.deleted) {
        const local = this.db.syncRecords().find((record) => record.entityType === deleted.entityType && record.entityId === deleted.entityId);
        if (firstSyncForUser || !local || Date.parse(deleted.deletedAt) > Date.parse(local.sourceUpdatedAt)) this.db.applySyncDeletion(deleted.entityType, deleted.entityId, deleted.deletedAt);
      }

      await this.pushLocal(client, userId, remote.records);
      await this.pushTombstones(client, userId);
      this.db.clearMutationOutbox();
      this.db.setCloudSyncUser(userId);
      this.value = { ...this.value, syncing: false, lastSyncAt: new Date().toISOString(), error: null };
      this.changed();
    } catch (reason) {
      this.value = { ...this.value, syncing: false, error: cloudErrorMessage(reason) };
      this.changed();
      throw reason;
    }
  }

  private async fetchRemote(client: SupabaseClient, userId: string): Promise<{
    records: LocalSyncRecord[];
    deleted: LocalSyncTombstone[];
    repositories: Repository[];
    mappings: Array<{ repositoryId: string; hostId: string; projectId: string; projectRootPath: string; remoteUrl: string | null }>;
  }> {
    const table = async (name: string): Promise<CloudRow[]> => {
      const { data, error } = await client.from(name).select("*").eq("user_id", userId);
      if (error) throw error;
      return (data ?? []) as CloudRow[];
    };
    const [settings, repositories, hosts, mappings, workstreams, agents, timeline, plans, dependencies, comments, reviews, audit] = await Promise.all([
      table("user_settings"), table("repositories"), table("paseo_hosts"), table("host_repository_mappings"), table("workstreams"),
      table("agent_runs"), table("timeline_items"), table("plans"), table("plan_dependencies"), table("plan_comments"),
      table("review_iterations"), table("audit_events"),
    ]);
    const records: LocalSyncRecord[] = [];
    const deleted: LocalSyncTombstone[] = [];
    if (settings[0]) records.push({ entityType: "settings", entityId: "app", payload: settings[0].payload, sourceUpdatedAt: String(settings[0].source_updated_at) });
    for (const row of hosts) {
      if (row.deleted_at) { deleted.push({ entityType: "host", entityId: String(row.id), deletedAt: String(row.deleted_at) }); continue; }
      const endpoint = row.endpoint ? String(row.endpoint) : `relay:${String(row.daemon_id ?? row.id)}`;
      records.push({ entityType: "host", entityId: String(row.id), sourceUpdatedAt: String(row.source_updated_at), payload: { id: row.id, name: row.name, endpoint, enabled: Boolean(row.endpoint) && Boolean(row.enabled), daemonId: row.daemon_id, daemonVersion: row.daemon_version } });
    }
    for (const row of workstreams) {
      if (row.deleted_at) { deleted.push({ entityType: "workstream", entityId: String(row.id), deletedAt: String(row.deleted_at) }); continue; }
      const id = String(row.id);
      const value = cloudWorkstream(row, hosts, agents.filter((item) => item.workstream_id === id), timeline.filter((item) => item.workstream_id === id), reviews.filter((item) => item.workstream_id === id), audit.filter((item) => item.workstream_id === id));
      records.push({ entityType: "workstream", entityId: id, payload: value, sourceUpdatedAt: String(row.source_updated_at) });
    }
    for (const row of plans) {
      if (row.deleted_at) { deleted.push({ entityType: "plan", entityId: String(row.id), deletedAt: String(row.deleted_at) }); continue; }
      const workstream = workstreams.find((item) => item.id === row.workstream_id);
      const dependencyIds = dependencies.filter((item) => item.plan_id === row.id).map((item) => String(item.depends_on_plan_id));
      const value: Plan = {
        id: String(row.id), workstreamId: String(row.workstream_id), title: String(row.title), body: String(row.body), status: row.status as Plan["status"],
        executionState: (row.execution_state ?? "staged") as Plan["executionState"], repositoryId: String(workstream?.repository_id ?? ""), repositoryFullName: String(workstream?.repository_full_name ?? ""),
        sourceAgentId: row.source_agent_id ? String(row.source_agent_id) : null, sourcePermissionId: row.source_permission_id ? String(row.source_permission_id) : null,
        dependencyIds, blockedByIds: [], createdAt: String(row.created_at), updatedAt: String(row.source_updated_at),
      };
      records.push({ entityType: "plan", entityId: value.id, payload: value, sourceUpdatedAt: value.updatedAt });
    }
    for (const row of comments) {
      if (row.deleted_at) { deleted.push({ entityType: "plan-comment", entityId: String(row.id), deletedAt: String(row.deleted_at) }); continue; }
      const value: PlanComment = { id: String(row.id), planId: String(row.plan_id), quote: String(row.quote), comment: String(row.comment), startOffset: Number(row.start_offset), endOffset: Number(row.end_offset), createdAt: String(row.created_at), updatedAt: String(row.source_updated_at) };
      records.push({ entityType: "plan-comment", entityId: value.id, payload: value, sourceUpdatedAt: value.updatedAt });
    }
    return {
      records,
      deleted,
      repositories: repositories.filter((row) => !row.deleted_at).map(cloudRepository),
      mappings: mappings.map((row) => ({ repositoryId: String(row.repository_id), hostId: String(row.host_id), projectId: String(row.project_id), projectRootPath: String(row.project_root_path), remoteUrl: row.remote_url ? String(row.remote_url) : null })),
    };
  }

  private async pushLocal(client: SupabaseClient, userId: string, remoteRecords: LocalSyncRecord[]): Promise<void> {
    const remote = new Map(remoteRecords.map((record) => [`${record.entityType}:${record.entityId}`, record]));
    const local = this.db.syncRecords().filter((record) => {
      const cloud = remote.get(`${record.entityType}:${record.entityId}`);
      return !cloud || Date.parse(record.sourceUpdatedAt) >= Date.parse(cloud.sourceUpdatedAt);
    });
    const settings = local.find((record) => record.entityType === "settings");
    if (settings) await checked(client.from("user_settings").upsert({ user_id: userId, payload: settings.payload, source_updated_at: settings.sourceUpdatedAt }));
    const hosts = local.filter((record) => record.entityType === "host").map((record) => {
      const value = record.payload as { id: string; name: string; endpoint: string; enabled: boolean; daemonId?: string | null; daemonVersion?: string | null };
      if (value.endpoint.startsWith("relay:")) return null;
      return { id: value.id, user_id: userId, name: value.name, endpoint: value.endpoint, enabled: value.enabled, daemon_id: value.daemonId ?? null, daemon_version: value.daemonVersion ?? null, source_updated_at: record.sourceUpdatedAt, deleted_at: null };
    }).filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (hosts.length) await checked(client.from("paseo_hosts").upsert(hosts));

    const repositoryRows = this.db.sqlite.prepare("SELECT id, payload, updated_at FROM repositories").all() as Array<{ id: string; payload: string; updated_at: string }>;
    if (repositoryRows.length) await checked(client.from("repositories").upsert(repositoryRows.map((row) => repositoryToCloud(userId, JSON.parse(row.payload) as Repository, row.updated_at))));
    const mappingRows = this.db.sqlite.prepare("SELECT * FROM host_repositories").all() as Array<Record<string, unknown>>;
    if (mappingRows.length) await checked(client.from("host_repository_mappings").upsert(mappingRows.map((row) => ({
      id: `${row.host_id}:${row.repository_id}`, user_id: userId, host_id: row.host_id, repository_id: row.repository_id,
      project_id: row.project_id, project_root_path: row.project_root_path, remote_url: row.remote_url, validated_at: row.validated_at,
    }))));

    for (const record of local.filter((item) => item.entityType === "workstream")) {
      const value = record.payload as Workstream;
      await checked(client.from("workstreams").upsert(workstreamToCloud(userId, value)));
      if (value.agents.length) await checked(client.from("agent_runs").upsert(value.agents.map((item) => agentToCloud(userId, item))));
      if (value.timeline.length) await checked(client.from("timeline_items").upsert(value.timeline.map((item) => timelineToCloud(userId, value.id, item))));
      if (value.reviews.length) await checked(client.from("review_iterations").upsert(value.reviews.map((item) => reviewToCloud(userId, item))));
      if (value.audit.length) await checked(client.from("audit_events").upsert(value.audit.map((item) => auditToCloud(userId, value.id, item))));
    }
    for (const record of local.filter((item) => item.entityType === "plan")) {
      const value = record.payload as Plan;
      await checked(client.from("plans").upsert(planToCloud(userId, value)));
      await checked(client.from("plan_dependencies").delete().eq("user_id", userId).eq("plan_id", value.id));
      if (value.dependencyIds.length) await checked(client.from("plan_dependencies").insert(value.dependencyIds.map((dependencyId) => ({ user_id: userId, plan_id: value.id, depends_on_plan_id: dependencyId }))));
    }
    const comments = local.filter((item) => item.entityType === "plan-comment").map((record) => commentToCloud(userId, record.payload as PlanComment));
    if (comments.length) await checked(client.from("plan_comments").upsert(comments));
  }

  private async pushTombstones(client: SupabaseClient, userId: string): Promise<void> {
    const table: Record<LocalSyncTombstone["entityType"], string> = { host: "paseo_hosts", workstream: "workstreams", plan: "plans", "plan-comment": "plan_comments" };
    for (const deletion of this.db.syncTombstones()) {
      await checked(client.from(table[deletion.entityType]).update({ deleted_at: deletion.deletedAt, source_updated_at: deletion.deletedAt }).eq("user_id", userId).eq("id", deletion.entityId));
    }
  }

  private subscribe(userId: string): void {
    if (!this.client) return;
    if (this.channel) void this.client.removeChannel(this.channel);
    let channel = this.client.channel(`orchestration:${userId}`);
    for (const table of realtimeTables) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` }, () => this.scheduleSync(250));
    this.channel = channel.subscribe();
  }

  private updateSession(email: string | null, signedIn: boolean): void { this.value = { ...this.value, signedIn, email, error: null }; this.changed(); }
  private requireClient(): SupabaseClient { if (!this.client) throw new Error("Agent Lens Cloud is unavailable"); return this.client; }
  private disposeClient(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    this.client = null;
  }
}

async function checked(query: PromiseLike<{ error: unknown }>): Promise<void> { const { error } = await query; if (error) throw error; }
function syncOrder(entityType: LocalSyncRecord["entityType"]): number { return entityType === "settings" ? 0 : entityType === "host" ? 1 : entityType === "workstream" ? 2 : entityType === "plan" ? 3 : 4; }

function cloudRepository(row: CloudRow): Repository {
  return { id: String(row.id), fullName: String(row.full_name), owner: String(row.owner), name: String(row.name), description: row.description ? String(row.description) : null, defaultBranch: String(row.default_branch), private: Boolean(row.is_private), htmlUrl: String(row.html_url), updatedAt: String(row.github_updated_at), installations: Array.isArray(row.installations) ? row.installations.map((item) => typeof item === "string" ? item : String((item as Record<string, unknown>)?.login ?? "")).filter(Boolean) : [], hostAvailability: [] };
}
function repositoryToCloud(userId: string, value: Repository, updatedAt: string) {
  return { id: value.id, user_id: userId, github_id: value.id, full_name: value.fullName, owner: value.owner, name: value.name, description: value.description, default_branch: value.defaultBranch, is_private: value.private, html_url: value.htmlUrl, github_updated_at: value.updatedAt, installations: value.installations, source_updated_at: updatedAt, deleted_at: null };
}
function workstreamToCloud(userId: string, value: Workstream) {
  return { id: value.id, user_id: userId, name: value.name, brief: value.brief, repository_id: value.repositoryId, repository_full_name: value.repositoryFullName, repository_url: value.repositoryUrl, host_id: value.hostId, branch_name: value.branchName, base_branch: value.baseBranch, base_sha: value.baseSha, workspace_id: value.workspaceId, status: value.status, phase: value.phase, agent_state: value.agentState, accepted_plan: value.acceptedPlan, pr_number: value.prNumber, pr_url: value.prUrl, pr_checks: value.prChecks, review_iteration: value.reviewIteration, source_updated_at: value.updatedAt, created_at: value.createdAt, deleted_at: null };
}
function agentToCloud(userId: string, value: AgentRun) { return { id: value.id, user_id: userId, workstream_id: value.workstreamId, role: value.role, paseo_agent_id: value.paseoAgentId, provider: value.provider, model: value.model, state: value.state, summary: value.summary, source_updated_at: value.updatedAt, created_at: value.createdAt }; }
function timelineToCloud(userId: string, workstreamId: string, value: TimelineItem) { return { id: value.id, user_id: userId, workstream_id: workstreamId, role: value.role, kind: value.kind, content: value.content, agent_role: value.agentRole ?? null, source_updated_at: value.createdAt, created_at: value.createdAt }; }
function reviewToCloud(userId: string, value: ReviewIteration) { return { id: value.id, user_id: userId, workstream_id: value.workstreamId, iteration: value.iteration, verdict: value.verdict, findings: value.findings, fix_summary: value.fixSummary, tests: value.tests, commit_sha: value.commitSha, created_at: value.createdAt }; }
function auditToCloud(userId: string, workstreamId: string, value: AuditEvent) { return { id: value.id, user_id: userId, workstream_id: workstreamId, event_type: value.type, title: value.title, detail: value.detail, created_at: value.createdAt }; }
function planToCloud(userId: string, value: Plan) { return { id: value.id, user_id: userId, workstream_id: value.workstreamId, title: value.title, body: value.body, status: value.status, execution_state: value.executionState, source_agent_id: value.sourceAgentId, source_permission_id: value.sourcePermissionId, source_updated_at: value.updatedAt, created_at: value.createdAt, deleted_at: null }; }
function commentToCloud(userId: string, value: PlanComment) { return { id: value.id, user_id: userId, plan_id: value.planId, quote: value.quote, comment: value.comment, start_offset: value.startOffset, end_offset: value.endOffset, source_updated_at: value.updatedAt, created_at: value.createdAt, deleted_at: null }; }

function cloudWorkstream(row: CloudRow, hosts: CloudRow[], agents: CloudRow[], timeline: CloudRow[], reviews: CloudRow[], audit: CloudRow[]): Workstream {
  return {
    id: String(row.id), name: String(row.name), brief: String(row.brief), repositoryId: String(row.repository_id), repositoryFullName: String(row.repository_full_name), repositoryUrl: String(row.repository_url), hostId: String(row.host_id), hostName: String(hosts.find((host) => host.id === row.host_id)?.name ?? "Paseo host"), branchName: String(row.branch_name), baseBranch: String(row.base_branch), baseSha: row.base_sha ? String(row.base_sha) : null, workspaceId: row.workspace_id ? String(row.workspace_id) : null, status: row.status as Workstream["status"], phase: row.phase as Workstream["phase"], agentState: row.agent_state as Workstream["agentState"], acceptedPlan: row.accepted_plan ? String(row.accepted_plan) : null, prNumber: row.pr_number == null ? null : Number(row.pr_number), prUrl: row.pr_url ? String(row.pr_url) : null, prChecks: row.pr_checks as Workstream["prChecks"], reviewIteration: Number(row.review_iteration), createdAt: String(row.created_at), updatedAt: String(row.source_updated_at),
    agents: agents.map((item) => ({ id: String(item.id), workstreamId: String(item.workstream_id), role: item.role as AgentRun["role"], paseoAgentId: item.paseo_agent_id ? String(item.paseo_agent_id) : null, provider: String(item.provider), model: String(item.model), state: item.state as AgentRun["state"], summary: item.summary ? String(item.summary) : null, createdAt: String(item.created_at), updatedAt: String(item.source_updated_at) })),
    timeline: timeline.map((item) => ({ id: String(item.id), role: item.role as TimelineItem["role"], kind: item.kind as TimelineItem["kind"], content: String(item.content), createdAt: String(item.created_at), ...(item.agent_role ? { agentRole: item.agent_role as TimelineItem["agentRole"] } : {}) })),
    reviews: reviews.map((item) => ({ id: String(item.id), workstreamId: String(item.workstream_id), iteration: Number(item.iteration), verdict: item.verdict as ReviewIteration["verdict"], findings: Array.isArray(item.findings) ? item.findings as ReviewIteration["findings"] : [], fixSummary: item.fix_summary ? String(item.fix_summary) : null, tests: item.tests ? String(item.tests) : null, commitSha: item.commit_sha ? String(item.commit_sha) : null, createdAt: String(item.created_at) })),
    audit: audit.map((item) => ({ id: String(item.id), type: String(item.event_type), title: String(item.title), detail: item.detail ? String(item.detail) : null, createdAt: String(item.created_at) })),
  };
}

export function cloudErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object") {
    const value = reason as { code?: unknown; message?: unknown; details?: unknown };
    const code = typeof value.code === "string" ? value.code : null;
    const message = typeof value.message === "string" ? value.message : null;
    const details = typeof value.details === "string" ? value.details : null;
    if (code === "PGRST205" || (message && /could not find.*(user_settings|workstreams)/i.test(message))) return "Cloud schema is not initialized: apply the Agent Lens orchestration migration.";
    return [code ? `[${code}]` : null, message, details].filter(Boolean).join(" ") || "Supabase returned an unknown synchronization error.";
  }
  return typeof reason === "string" ? reason : "Supabase returned an unknown synchronization error.";
}
