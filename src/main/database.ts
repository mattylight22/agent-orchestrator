import Database from "better-sqlite3";
import { app } from "electron";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AgentRole,
  AgentRun,
  AppSettings,
  AuditEvent,
  PaseoHost,
  Plan,
  PlanComment,
  PlanStatus,
  ReviewIteration,
  TimelineItem,
  Workstream,
  WorkstreamPhase,
  WorkstreamStatus,
} from "../shared/contracts.js";
import { defaultAppSettings, supabaseProject } from "../shared/contracts.js";

export const hosts = sqliteTable("hosts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  endpoint: text("endpoint").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  daemonId: text("daemon_id"),
  daemonVersion: text("daemon_version"),
  createdAt: text("created_at").notNull(),
});

export const workstreams = sqliteTable(
  "workstreams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    brief: text("brief").notNull(),
    repositoryId: text("repository_id").notNull(),
    repositoryFullName: text("repository_full_name").notNull(),
    repositoryUrl: text("repository_url").notNull(),
    hostId: text("host_id").notNull(),
    branchName: text("branch_name").notNull(),
    baseBranch: text("base_branch").notNull(),
    baseSha: text("base_sha"),
    workspaceId: text("workspace_id"),
    status: text("status").notNull(),
    phase: text("phase").notNull(),
    agentState: text("agent_state").notNull(),
    acceptedPlan: text("accepted_plan"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    prChecks: text("pr_checks").notNull(),
    reviewIteration: integer("review_iteration").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("workstream_branch_unique").on(table.repositoryId, table.branchName)],
);

export const schema = { hosts, workstreams };

export const defaultSettings: AppSettings = structuredClone(defaultAppSettings);

export function mergeTimelineText(current: string, incoming: string): string {
  if (!incoming || current === incoming || current.endsWith(incoming)) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  return current + incoming;
}

export interface LocalSyncRecord {
  entityType: "settings" | "host" | "workstream" | "plan" | "plan-comment";
  entityId: string;
  payload: unknown;
  sourceUpdatedAt: string;
}

export interface LocalSyncTombstone {
  entityType: "host" | "workstream" | "plan" | "plan-comment";
  entityId: string;
  deletedAt: string;
}

export function portableSettings(settings: AppSettings): Omit<AppSettings, "githubClientId" | "githubLogin" | "githubConnected" | "cloud"> {
  const { githubClientId: _clientId, githubLogin: _login, githubConnected: _connected, cloud: _cloud, ...portable } = settings;
  return portable;
}

interface WorkstreamRow extends Record<string, unknown> {
  id: string;
  name: string;
  brief: string;
  repository_id: string;
  repository_full_name: string;
  repository_url: string;
  host_id: string;
  branch_name: string;
  base_branch: string;
  base_sha: string | null;
  workspace_id: string | null;
  status: WorkstreamStatus;
  phase: WorkstreamPhase;
  agent_state: Workstream["agentState"];
  accepted_plan: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_checks: Workstream["prChecks"];
  review_iteration: number;
  created_at: string;
  updated_at: string;
}

export class AppDatabase {
  readonly sqlite: Database.Database;
  readonly orm: ReturnType<typeof drizzle<typeof schema>>;

  constructor(path = join(app.getPath("userData"), "agent-lens.sqlite")) {
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.orm = drizzle(this.sqlite, { schema });
    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        daemon_id TEXT,
        daemon_version TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS host_repositories (
        repository_id TEXT NOT NULL,
        host_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_root_path TEXT NOT NULL,
        remote_url TEXT,
        validated_at TEXT NOT NULL,
        PRIMARY KEY (repository_id, host_id)
      );
      CREATE TABLE IF NOT EXISTS workstreams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        brief TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        repository_full_name TEXT NOT NULL,
        repository_url TEXT NOT NULL,
        host_id TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        base_sha TEXT,
        workspace_id TEXT,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        agent_state TEXT NOT NULL,
        accepted_plan TEXT,
        pr_number INTEGER,
        pr_url TEXT,
        pr_checks TEXT NOT NULL DEFAULT 'none',
        review_iteration INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(repository_id, branch_name)
      );
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        workstream_id TEXT NOT NULL,
        role TEXT NOT NULL,
        paseo_agent_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        state TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workstream_id) REFERENCES workstreams(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        workstream_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        source_agent_id TEXT,
        source_permission_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workstream_id) REFERENCES workstreams(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS plan_dependencies (
        plan_id TEXT NOT NULL,
        depends_on_plan_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(plan_id, depends_on_plan_id),
        FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE,
        FOREIGN KEY(depends_on_plan_id) REFERENCES plans(id) ON DELETE CASCADE,
        CHECK(plan_id <> depends_on_plan_id)
      );
      CREATE TABLE IF NOT EXISTS plan_comments (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        quote TEXT NOT NULL,
        comment TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS timeline_items (
        id TEXT PRIMARY KEY,
        workstream_id TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_role TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(workstream_id) REFERENCES workstreams(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS review_iterations (
        id TEXT PRIMARY KEY,
        workstream_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        findings TEXT NOT NULL,
        fix_summary TEXT,
        tests TEXT,
        commit_sha TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(workstream_id) REFERENCES workstreams(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        workstream_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(workstream_id) REFERENCES workstreams(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS cloud_tombstones (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS mutation_outbox (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );
      DROP TRIGGER IF EXISTS settings_mutation_outbox_insert;
      DROP TRIGGER IF EXISTS settings_mutation_outbox_update;
      DROP TRIGGER IF EXISTS hosts_mutation_outbox_insert;
      DROP TRIGGER IF EXISTS hosts_mutation_outbox_update;
      DROP TRIGGER IF EXISTS workstreams_mutation_outbox_insert;
      DROP TRIGGER IF EXISTS workstreams_mutation_outbox_update;
      DROP TRIGGER IF EXISTS plans_mutation_outbox_insert;
      DROP TRIGGER IF EXISTS plans_mutation_outbox_update;
      DROP TRIGGER IF EXISTS plan_comments_mutation_outbox_insert;
      DROP TRIGGER IF EXISTS plan_comments_mutation_outbox_update;
      CREATE TRIGGER IF NOT EXISTS settings_mutation_outbox_insert AFTER INSERT ON settings WHEN NEW.key = 'app'
      BEGIN INSERT INTO mutation_outbox VALUES('settings', 'app', 'upsert', 'settings:app:' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS settings_mutation_outbox_update AFTER UPDATE ON settings WHEN NEW.key = 'app'
      BEGIN INSERT INTO mutation_outbox VALUES('settings', 'app', 'upsert', 'settings:app:' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS hosts_mutation_outbox_insert AFTER INSERT ON hosts
      BEGIN INSERT INTO mutation_outbox VALUES('host', NEW.id, 'upsert', 'host:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS hosts_mutation_outbox_update AFTER UPDATE ON hosts
      BEGIN INSERT INTO mutation_outbox VALUES('host', NEW.id, 'upsert', 'host:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS workstreams_mutation_outbox_insert AFTER INSERT ON workstreams
      BEGIN INSERT INTO mutation_outbox VALUES('workstream', NEW.id, 'upsert', 'workstream:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS workstreams_mutation_outbox_update AFTER UPDATE ON workstreams
      BEGIN INSERT INTO mutation_outbox VALUES('workstream', NEW.id, 'upsert', 'workstream:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS plans_mutation_outbox_insert AFTER INSERT ON plans
      BEGIN INSERT INTO mutation_outbox VALUES('plan', NEW.id, 'upsert', 'plan:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS plans_mutation_outbox_update AFTER UPDATE ON plans
      BEGIN INSERT INTO mutation_outbox VALUES('plan', NEW.id, 'upsert', 'plan:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS plan_comments_mutation_outbox_insert AFTER INSERT ON plan_comments
      BEGIN INSERT INTO mutation_outbox VALUES('plan-comment', NEW.id, 'upsert', 'plan-comment:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
      CREATE TRIGGER IF NOT EXISTS plan_comments_mutation_outbox_update AFTER UPDATE ON plan_comments
      BEGIN INSERT INTO mutation_outbox VALUES('plan-comment', NEW.id, 'upsert', 'plan-comment:' || NEW.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(entity_type, entity_id) DO UPDATE SET operation=excluded.operation, idempotency_key=excluded.idempotency_key, created_at=excluded.created_at; END;
    `);
    const hostColumns = new Set((this.sqlite.prepare("PRAGMA table_info(hosts)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!hostColumns.has("daemon_id")) this.sqlite.exec("ALTER TABLE hosts ADD COLUMN daemon_id TEXT");
    if (!hostColumns.has("daemon_version")) this.sqlite.exec("ALTER TABLE hosts ADD COLUMN daemon_version TEXT");
    if (!this.sqlite.prepare("SELECT 1 FROM settings WHERE key = ?").get("app")) {
      this.sqlite
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .run("app", JSON.stringify(defaultSettings));
    }
    if (!this.sqlite.prepare("SELECT 1 FROM settings WHERE key = ?").get("app:updatedAt")) {
      this.sqlite
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
        .run("app:updatedAt", new Date().toISOString());
    }
  }

  settings(): AppSettings {
    const row = this.sqlite.prepare("SELECT value FROM settings WHERE key = ?").get("app") as
      | { value: string }
      | undefined;
    const stored = row ? JSON.parse(row.value) as Partial<AppSettings> : {};
    return {
      ...defaultSettings,
      ...stored,
      cloud: {
        supabaseUrl: supabaseProject.url,
        supabasePublishableKey: supabaseProject.publishableKey,
        syncEnabled: stored.cloud?.syncEnabled ?? defaultSettings.cloud.syncEnabled,
      },
    } as AppSettings;
  }

  saveSettings(settings: AppSettings): void {
    const write = this.sqlite.transaction(() => {
      this.sqlite
        .prepare("INSERT INTO settings(key, value) VALUES('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(settings));
      this.sqlite
        .prepare("INSERT INTO settings(key, value) VALUES('app:updatedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(new Date().toISOString());
    });
    write();
  }

  pendingMutations(): Array<{ entityType: string; entityId: string; operation: string; idempotencyKey: string; createdAt: string }> {
    return (this.sqlite.prepare("SELECT * FROM mutation_outbox ORDER BY created_at").all() as Array<Record<string, unknown>>).map((row) => ({
      entityType: String(row.entity_type), entityId: String(row.entity_id), operation: String(row.operation),
      idempotencyKey: String(row.idempotency_key), createdAt: String(row.created_at),
    }));
  }

  clearMutationOutbox(): void {
    this.sqlite.prepare("DELETE FROM mutation_outbox").run();
  }

  listHosts(): PaseoHost[] {
    return (this.sqlite.prepare("SELECT * FROM hosts ORDER BY name").all() as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id),
        name: String(row.name),
        endpoint: String(row.endpoint),
        enabled: Boolean(row.enabled),
        health: "offline",
        daemonId: row.daemon_id ? String(row.daemon_id) : null,
        daemonVersion: row.daemon_version ? String(row.daemon_version) : null,
        lastSyncAt: null,
        error: null,
      }),
    );
  }

  createHost(name: string, endpoint: string): PaseoHost {
    const host: PaseoHost = {
      id: randomUUID(),
      name,
      endpoint,
      enabled: true,
      health: "offline",
      daemonVersion: null,
      lastSyncAt: null,
      error: null,
    };
    this.sqlite
      .prepare("INSERT INTO hosts(id, name, endpoint, enabled, created_at) VALUES(?, ?, ?, 1, ?)")
      .run(host.id, host.name, host.endpoint, new Date().toISOString());
    return host;
  }

  updateHostIdentity(id: string, daemonId: string, daemonVersion: string | null): void {
    this.sqlite.prepare("UPDATE hosts SET daemon_id = ?, daemon_version = ? WHERE id = ?").run(daemonId, daemonVersion, id);
  }

  updateHostEndpoint(id: string, endpoint: string): void {
    this.sqlite.prepare("UPDATE hosts SET endpoint = ? WHERE id = ? AND endpoint <> ?").run(endpoint, id, endpoint);
  }

  deleteHost(id: string): void {
    const remove = this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM hosts WHERE id = ?").run(id);
      this.sqlite.prepare("INSERT INTO cloud_tombstones(entity_type, entity_id, deleted_at) VALUES('host', ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at = excluded.deleted_at").run(id, new Date().toISOString());
    });
    remove();
  }

  upsertRepository(id: string, payload: unknown): void {
    this.sqlite
      .prepare(
        "INSERT INTO repositories(id, payload, updated_at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      )
      .run(id, JSON.stringify(payload), new Date().toISOString());
  }

  listRepositoryPayloads<T>(): T[] {
    return (this.sqlite.prepare("SELECT payload FROM repositories ORDER BY updated_at DESC").all() as Array<{ payload: string }>).map(
      (row) => JSON.parse(row.payload) as T,
    );
  }

  upsertHostRepository(input: {
    repositoryId: string;
    hostId: string;
    projectId: string;
    projectRootPath: string;
    remoteUrl: string | null;
  }): void {
    this.sqlite
      .prepare(`
        INSERT INTO host_repositories(repository_id, host_id, project_id, project_root_path, remote_url, validated_at)
        VALUES(@repositoryId, @hostId, @projectId, @projectRootPath, @remoteUrl, @validatedAt)
        ON CONFLICT(repository_id, host_id) DO UPDATE SET
          project_id = excluded.project_id,
          project_root_path = excluded.project_root_path,
          remote_url = excluded.remote_url,
          validated_at = excluded.validated_at
      `)
      .run({ ...input, validatedAt: new Date().toISOString() });
  }

  hostRepository(repositoryId: string, hostId: string): { projectId: string; projectRootPath: string } | null {
    const row = this.sqlite
      .prepare("SELECT project_id, project_root_path FROM host_repositories WHERE repository_id = ? AND host_id = ?")
      .get(repositoryId, hostId) as { project_id: string; project_root_path: string } | undefined;
    return row ? { projectId: row.project_id, projectRootPath: row.project_root_path } : null;
  }

  hostRepositoryRows(): Array<{
    repositoryId: string;
    hostId: string;
    projectId: string;
    projectRootPath: string;
  }> {
    return (this.sqlite.prepare("SELECT * FROM host_repositories").all() as Array<Record<string, unknown>>).map(
      (row) => ({
        repositoryId: String(row.repository_id),
        hostId: String(row.host_id),
        projectId: String(row.project_id),
        projectRootPath: String(row.project_root_path),
      }),
    );
  }

  insertWorkstream(input: Omit<Workstream, "agents" | "timeline" | "reviews" | "audit" | "hostName">): void {
    this.sqlite.prepare(`
      INSERT INTO workstreams(
        id, name, brief, repository_id, repository_full_name, repository_url, host_id,
        branch_name, base_branch, base_sha, workspace_id, status, phase, agent_state,
        accepted_plan, pr_number, pr_url, pr_checks, review_iteration, created_at, updated_at
      ) VALUES(
        @id, @name, @brief, @repositoryId, @repositoryFullName, @repositoryUrl, @hostId,
        @branchName, @baseBranch, @baseSha, @workspaceId, @status, @phase, @agentState,
        @acceptedPlan, @prNumber, @prUrl, @prChecks, @reviewIteration, @createdAt, @updatedAt
      )
    `).run(input);
  }

  updateWorkstream(id: string, patch: Partial<{
    workspaceId: string | null;
    status: WorkstreamStatus;
    phase: WorkstreamPhase;
    agentState: Workstream["agentState"];
    acceptedPlan: string | null;
    prNumber: number | null;
    prUrl: string | null;
    prChecks: Workstream["prChecks"];
    reviewIteration: number;
    baseSha: string | null;
  }>): void {
    const columns: Record<string, string> = {
      workspaceId: "workspace_id",
      status: "status",
      phase: "phase",
      agentState: "agent_state",
      acceptedPlan: "accepted_plan",
      prNumber: "pr_number",
      prUrl: "pr_url",
      prChecks: "pr_checks",
      reviewIteration: "review_iteration",
      baseSha: "base_sha",
    };
    const entries = Object.entries(patch).filter(([key]) => columns[key]);
    if (!entries.length) return;
    const setters = entries.map(([key]) => `${columns[key]} = @${key}`).join(", ");
    this.sqlite
      .prepare(`UPDATE workstreams SET ${setters}, updated_at = @updatedAt WHERE id = @id`)
      .run({ id, ...patch, updatedAt: new Date().toISOString() });
  }

  insertAgent(input: {
    workstreamId: string;
    role: AgentRole;
    paseoAgentId: string | null;
    provider: string;
    model: string;
    state?: AgentRun["state"];
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO agent_runs(id, workstream_id, role, paseo_agent_id, provider, model, state, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workstreamId, input.role, input.paseoAgentId, input.provider, input.model, input.state ?? "running", now, now);
    this.touchWorkstream(input.workstreamId, now);
    return id;
  }

  updateAgentByPaseoId(paseoAgentId: string, state: AgentRun["state"], summary?: string): void {
    const context = this.agentContext(paseoAgentId);
    const now = new Date().toISOString();
    this.sqlite
      .prepare("UPDATE agent_runs SET state = ?, summary = COALESCE(?, summary), updated_at = ? WHERE paseo_agent_id = ?")
      .run(state, summary ?? null, now, paseoAgentId);
    if (context) this.touchWorkstream(context.workstreamId, now);
  }

  agentContext(paseoAgentId: string): { workstreamId: string; role: AgentRole } | null {
    const row = this.sqlite
      .prepare("SELECT workstream_id, role FROM agent_runs WHERE paseo_agent_id = ?")
      .get(paseoAgentId) as { workstream_id: string; role: AgentRole } | undefined;
    return row ? { workstreamId: row.workstream_id, role: row.role } : null;
  }

  latestAgent(workstreamId: string, role?: AgentRole): AgentRun | null {
    const row = this.sqlite
      .prepare(`SELECT * FROM agent_runs WHERE workstream_id = ? ${role ? "AND role = ?" : ""} ORDER BY created_at DESC LIMIT 1`)
      .get(...(role ? [workstreamId, role] : [workstreamId])) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), workstreamId, role: row.role as AgentRole,
      paseoAgentId: row.paseo_agent_id ? String(row.paseo_agent_id) : null,
      provider: String(row.provider), model: String(row.model), state: row.state as AgentRun["state"],
      summary: row.summary ? String(row.summary) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  latestAssistantMessage(workstreamId: string, agentRole?: AgentRole): string | null {
    const row = this.sqlite
      .prepare(`SELECT content FROM timeline_items WHERE workstream_id = ? AND role = 'assistant' ${agentRole ? "AND agent_role = ?" : ""} ORDER BY created_at DESC LIMIT 1`)
      .get(...(agentRole ? [workstreamId, agentRole] : [workstreamId])) as { content: string } | undefined;
    return row?.content ?? null;
  }

  upsertCapturedPlan(input: {
    workstreamId: string;
    title: string;
    body: string;
    sourceAgentId: string;
    sourcePermissionId: string;
  }): Plan {
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO plans(id, workstream_id, title, body, status, source_agent_id, source_permission_id, created_at, updated_at)
      VALUES(@id, @workstreamId, @title, @body, 'product-feature', @sourceAgentId, @sourcePermissionId, @createdAt, @updatedAt)
      ON CONFLICT(workstream_id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        source_agent_id = excluded.source_agent_id,
        source_permission_id = excluded.source_permission_id,
        updated_at = excluded.updated_at
    `).run({ id: randomUUID(), ...input, createdAt: now, updatedAt: now });
    this.touchWorkstream(input.workstreamId, now);
    const plan = this.planForWorkstream(input.workstreamId);
    if (!plan) throw new Error("The captured plan could not be persisted");
    return plan;
  }

  planForWorkstream(workstreamId: string): Plan | null {
    const row = this.sqlite.prepare("SELECT id FROM plans WHERE workstream_id = ?").get(workstreamId) as { id: string } | undefined;
    return row ? this.getPlan(row.id) : null;
  }

  getPlan(id: string): Plan | null {
    return this.listPlans().find((plan) => plan.id === id) ?? null;
  }

  listPlans(): Plan[] {
    const rows = this.sqlite.prepare(`
      SELECT p.*, w.repository_id, w.repository_full_name, w.status AS workstream_status, w.phase AS workstream_phase
      FROM plans p
      JOIN workstreams w ON w.id = p.workstream_id
      ORDER BY p.updated_at DESC
    `).all() as Array<Record<string, unknown>>;
    const dependencyRows = this.sqlite.prepare("SELECT plan_id, depends_on_plan_id FROM plan_dependencies").all() as Array<{ plan_id: string; depends_on_plan_id: string }>;
    const reviewedPlanIds = new Set(rows.filter((row) => row.workstream_status === "reviewed" || row.workstream_status === "merged").map((row) => String(row.id)));
    return rows.map((row): Plan => {
      const id = String(row.id);
      const dependencyIds = dependencyRows.filter((dependency) => dependency.plan_id === id).map((dependency) => dependency.depends_on_plan_id);
      const blockedByIds = dependencyIds.filter((dependencyId) => !reviewedPlanIds.has(dependencyId));
      const status = row.status as PlanStatus;
      const phase = String(row.workstream_phase);
      const executionState: Plan["executionState"] = status === "cancelled"
        ? "cancelled"
        : row.workstream_status === "reviewed" || row.workstream_status === "merged"
          ? "completed"
          : ["building", "review-fix", "pr-open", "independent-review", "complete"].includes(phase)
            ? "in-progress"
            : blockedByIds.length
              ? "blocked"
              : status === "implementation-ready"
                ? "eligible"
                : "staged";
      return {
        id,
        workstreamId: String(row.workstream_id),
        title: String(row.title),
        body: String(row.body),
        status,
        executionState,
        repositoryId: String(row.repository_id),
        repositoryFullName: String(row.repository_full_name),
        sourceAgentId: row.source_agent_id ? String(row.source_agent_id) : null,
        sourcePermissionId: row.source_permission_id ? String(row.source_permission_id) : null,
        dependencyIds,
        blockedByIds,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
  }

  updatePlanStatus(id: string, status: PlanStatus): void {
    const plan = this.getPlan(id);
    if (!plan) throw new Error("Plan not found");
    const now = new Date().toISOString();
    this.sqlite.prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    this.touchWorkstream(plan.workstreamId, now);
  }

  setPlanDependencies(id: string, dependencyIds: string[]): void {
    const plan = this.getPlan(id);
    if (!plan) throw new Error("Plan not found");
    const replace = this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM plan_dependencies WHERE plan_id = ?").run(id);
      const insert = this.sqlite.prepare("INSERT INTO plan_dependencies(plan_id, depends_on_plan_id, created_at) VALUES(?, ?, ?)");
      const now = new Date().toISOString();
      for (const dependencyId of dependencyIds) insert.run(id, dependencyId, now);
      this.sqlite.prepare("UPDATE plans SET updated_at = ? WHERE id = ?").run(now, id);
      this.touchWorkstream(plan.workstreamId, now);
    });
    replace();
  }

  addPlanComment(input: { planId: string; quote: string; comment: string; startOffset: number; endOffset: number }): PlanComment {
    if (!this.getPlan(input.planId)) throw new Error("Plan not found");
    const now = new Date().toISOString();
    const value: PlanComment = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.sqlite.prepare(`
      INSERT INTO plan_comments(id, plan_id, quote, comment, start_offset, end_offset, created_at, updated_at)
      VALUES(@id, @planId, @quote, @comment, @startOffset, @endOffset, @createdAt, @updatedAt)
    `).run(value);
    return value;
  }

  listPlanComments(planId?: string): PlanComment[] {
    const rows = (planId
      ? this.sqlite.prepare("SELECT * FROM plan_comments WHERE plan_id = ? ORDER BY start_offset, created_at").all(planId)
      : this.sqlite.prepare("SELECT * FROM plan_comments ORDER BY created_at").all()) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      planId: String(row.plan_id),
      quote: String(row.quote),
      comment: String(row.comment),
      startOffset: Number(row.start_offset),
      endOffset: Number(row.end_offset),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  deletePlanComment(id: string): void {
    const row = this.sqlite.prepare("SELECT id FROM plan_comments WHERE id = ?").get(id) as { id: string } | undefined;
    if (!row) return;
    const now = new Date().toISOString();
    this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM plan_comments WHERE id = ?").run(id);
      this.sqlite.prepare("INSERT INTO cloud_tombstones(entity_type, entity_id, deleted_at) VALUES('plan-comment', ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at = excluded.deleted_at").run(id, now);
    })();
  }

  deletePlanComments(planId: string): void {
    const ids = this.listPlanComments(planId).map((item) => item.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    this.sqlite.transaction(() => {
      const remove = this.sqlite.prepare("DELETE FROM plan_comments WHERE id = ?");
      const tombstone = this.sqlite.prepare("INSERT INTO cloud_tombstones(entity_type, entity_id, deleted_at) VALUES('plan-comment', ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at = excluded.deleted_at");
      for (const id of ids) { remove.run(id); tombstone.run(id, now); }
    })();
  }

  addTimeline(workstreamId: string, item: Omit<TimelineItem, "id" | "createdAt"> & { createdAt?: string; sourceId?: string }): string {
    const id = item.sourceId ?? randomUUID();
    const now = new Date().toISOString();
    if (item.sourceId) {
      const existing = this.sqlite.prepare("SELECT content FROM timeline_items WHERE id = ?").get(id) as { content: string } | undefined;
      if (existing) {
        const content = item.kind === "question" ? item.content : mergeTimelineText(existing.content, item.content);
        this.sqlite.prepare("UPDATE timeline_items SET content = ? WHERE id = ?").run(content, id);
        this.touchWorkstream(workstreamId, now);
        return id;
      }
      this.replaceMatchingLegacyTimelineFragments(workstreamId, item);
    }
    this.sqlite.prepare(`
      INSERT INTO timeline_items(id, workstream_id, role, kind, content, agent_role, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(id, workstreamId, item.role, item.kind, item.content, item.agentRole ?? null, item.createdAt ?? now);
    this.touchWorkstream(workstreamId, now);
    return id;
  }

  private replaceMatchingLegacyTimelineFragments(
    workstreamId: string,
    item: Omit<TimelineItem, "id" | "createdAt"> & { createdAt?: string; sourceId?: string },
  ): void {
    const timestamp = new Date(item.createdAt ?? new Date().toISOString()).getTime();
    const rows = this.sqlite.prepare(`
      SELECT id, content FROM timeline_items
      WHERE workstream_id = ? AND role = ? AND kind = ?
        AND COALESCE(agent_role, '') = COALESCE(?, '')
        AND created_at BETWEEN ? AND ?
      ORDER BY created_at, rowid
    `).all(
      workstreamId,
      item.role,
      item.kind,
      item.agentRole ?? null,
      new Date(timestamp - 5_000).toISOString(),
      new Date(timestamp + 5_000).toISOString(),
    ) as Array<{ id: string; content: string }>;
    for (let start = 0; start < rows.length; start += 1) {
      let combined = "";
      for (let end = start; end < rows.length; end += 1) {
        combined += rows[end].content;
        if (!item.content.startsWith(combined)) break;
        if (combined === item.content) {
          const ids = rows.slice(start, end + 1).map((row) => row.id);
          const placeholders = ids.map(() => "?").join(",");
          this.sqlite.prepare(`DELETE FROM timeline_items WHERE id IN (${placeholders})`).run(...ids);
          return;
        }
      }
    }
  }

  addAudit(workstreamId: string, type: string, title: string, detail?: string | null): void {
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO audit_events(id, workstream_id, type, title, detail, created_at)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), workstreamId, type, title, detail ?? null, now);
    this.touchWorkstream(workstreamId, now);
  }

  addReview(input: Omit<ReviewIteration, "id" | "createdAt">): void {
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO review_iterations(id, workstream_id, iteration, verdict, findings, fix_summary, tests, commit_sha, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.workstreamId, input.iteration, input.verdict, JSON.stringify(input.findings), input.fixSummary, input.tests, input.commitSha, now);
    this.touchWorkstream(input.workstreamId, now);
  }

  syncRecords(): LocalSyncRecord[] {
    const settingsUpdated = this.sqlite.prepare("SELECT value FROM settings WHERE key = 'app:updatedAt'").get() as { value: string };
    const localSettings = this.settings();
    const records: LocalSyncRecord[] = [{
      entityType: "settings",
      entityId: "app",
      payload: portableSettings(localSettings),
      sourceUpdatedAt: settingsUpdated.value,
    }];
    const hostRows = this.sqlite.prepare("SELECT * FROM hosts").all() as Array<Record<string, unknown>>;
    for (const row of hostRows) {
      records.push({
        entityType: "host",
        entityId: String(row.id),
        payload: { id: row.id, name: row.name, endpoint: row.endpoint, enabled: Boolean(row.enabled) },
        sourceUpdatedAt: String(row.created_at),
      });
    }
    for (const workstream of this.listWorkstreams()) {
      records.push({ entityType: "workstream", entityId: workstream.id, payload: workstream, sourceUpdatedAt: workstream.updatedAt });
    }
    for (const plan of this.listPlans()) {
      records.push({ entityType: "plan", entityId: plan.id, payload: plan, sourceUpdatedAt: plan.updatedAt });
    }
    for (const comment of this.listPlanComments()) {
      records.push({ entityType: "plan-comment", entityId: comment.id, payload: comment, sourceUpdatedAt: comment.updatedAt });
    }
    return records;
  }

  syncTombstones(): LocalSyncTombstone[] {
    return (this.sqlite.prepare("SELECT * FROM cloud_tombstones").all() as Array<Record<string, unknown>>).map((row) => ({
      entityType: row.entity_type as LocalSyncTombstone["entityType"],
      entityId: String(row.entity_id),
      deletedAt: String(row.deleted_at),
    }));
  }

  applySyncRecord(record: LocalSyncRecord): void {
    if (record.entityType === "settings") {
      const current = this.settings();
      const payload = record.payload as Partial<AppSettings>;
      const merged: AppSettings = {
        ...current,
        ...payload,
        githubClientId: current.githubClientId,
        githubLogin: current.githubLogin,
        githubConnected: current.githubConnected,
        cloud: current.cloud,
      };
      const write = this.sqlite.transaction(() => {
        this.sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'app'").run(JSON.stringify(merged));
        this.sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'app:updatedAt'").run(record.sourceUpdatedAt);
      });
      write();
      return;
    }
    if (record.entityType === "host") {
      const host = record.payload as Pick<PaseoHost, "id" | "name" | "endpoint" | "enabled" | "daemonId" | "daemonVersion">;
      const write = this.sqlite.transaction(() => {
        const duplicate = this.sqlite.prepare("SELECT id FROM hosts WHERE endpoint = ? AND id <> ?").get(host.endpoint, host.id) as { id: string } | undefined;
        if (duplicate) {
          this.sqlite.prepare("UPDATE workstreams SET host_id = ? WHERE host_id = ?").run(host.id, duplicate.id);
          this.sqlite.prepare("DELETE FROM host_repositories WHERE host_id = ?").run(duplicate.id);
          this.sqlite.prepare("DELETE FROM hosts WHERE id = ?").run(duplicate.id);
        }
        this.sqlite.prepare(`
          INSERT INTO hosts(id, name, endpoint, enabled, daemon_id, daemon_version, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, endpoint = CASE WHEN excluded.endpoint = '' THEN hosts.endpoint ELSE excluded.endpoint END, enabled = excluded.enabled, daemon_id = excluded.daemon_id, daemon_version = excluded.daemon_version
        `).run(host.id, host.name, host.endpoint, host.enabled ? 1 : 0, host.daemonId ?? null, host.daemonVersion ?? null, record.sourceUpdatedAt);
        this.sqlite.prepare("DELETE FROM cloud_tombstones WHERE entity_type = 'host' AND entity_id = ?").run(host.id);
      });
      write();
      return;
    }
    if (record.entityType === "plan") {
      this.replacePlan(record.payload as Plan);
      return;
    }
    if (record.entityType === "plan-comment") {
      this.replacePlanComment(record.payload as PlanComment);
      return;
    }
    this.replaceWorkstream(record.payload as Workstream);
  }

  applySyncDeletion(entityType: LocalSyncTombstone["entityType"], entityId: string, deletedAt: string): void {
    const remove = this.sqlite.transaction(() => {
      if (entityType === "host") this.sqlite.prepare("DELETE FROM hosts WHERE id = ?").run(entityId);
      else if (entityType === "plan") this.sqlite.prepare("DELETE FROM plans WHERE id = ?").run(entityId);
      else if (entityType === "plan-comment") this.sqlite.prepare("DELETE FROM plan_comments WHERE id = ?").run(entityId);
      else this.sqlite.prepare("DELETE FROM workstreams WHERE id = ?").run(entityId);
      this.sqlite.prepare("INSERT INTO cloud_tombstones(entity_type, entity_id, deleted_at) VALUES(?, ?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET deleted_at = excluded.deleted_at").run(entityType, entityId, deletedAt);
    });
    remove();
  }

  cloudSyncUser(): string | null {
    const row = this.sqlite.prepare("SELECT value FROM settings WHERE key = 'cloud:lastUserId'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setCloudSyncUser(userId: string): void {
    this.sqlite.prepare("INSERT INTO settings(key, value) VALUES('cloud:lastUserId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(userId);
  }

  private replaceWorkstream(value: Workstream): void {
    const replace = this.sqlite.transaction(() => {
      const collision = this.sqlite.prepare("SELECT id FROM workstreams WHERE repository_id = ? AND branch_name = ? AND id <> ?").get(value.repositoryId, value.branchName, value.id);
      if (collision) throw new Error(`Cloud workstream conflicts with local branch ${value.repositoryFullName}:${value.branchName}`);
      this.sqlite.prepare(`
        INSERT INTO workstreams(id, name, brief, repository_id, repository_full_name, repository_url, host_id, branch_name, base_branch, base_sha, workspace_id, status, phase, agent_state, accepted_plan, pr_number, pr_url, pr_checks, review_iteration, created_at, updated_at)
        VALUES(@id, @name, @brief, @repositoryId, @repositoryFullName, @repositoryUrl, @hostId, @branchName, @baseBranch, @baseSha, @workspaceId, @status, @phase, @agentState, @acceptedPlan, @prNumber, @prUrl, @prChecks, @reviewIteration, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, brief=excluded.brief, repository_id=excluded.repository_id, repository_full_name=excluded.repository_full_name, repository_url=excluded.repository_url, host_id=excluded.host_id, branch_name=excluded.branch_name, base_branch=excluded.base_branch, base_sha=excluded.base_sha, workspace_id=excluded.workspace_id, status=excluded.status, phase=excluded.phase, agent_state=excluded.agent_state, accepted_plan=excluded.accepted_plan, pr_number=excluded.pr_number, pr_url=excluded.pr_url, pr_checks=excluded.pr_checks, review_iteration=excluded.review_iteration, created_at=excluded.created_at, updated_at=excluded.updated_at
      `).run(value);
      for (const table of ["agent_runs", "timeline_items", "review_iterations", "audit_events"]) {
        this.sqlite.prepare(`DELETE FROM ${table} WHERE workstream_id = ?`).run(value.id);
      }
      const insertAgent = this.sqlite.prepare("INSERT INTO agent_runs(id, workstream_id, role, paseo_agent_id, provider, model, state, summary, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      value.agents.forEach((item) => insertAgent.run(item.id, value.id, item.role, item.paseoAgentId, item.provider, item.model, item.state, item.summary, item.createdAt, item.updatedAt));
      const insertTimeline = this.sqlite.prepare("INSERT INTO timeline_items(id, workstream_id, role, kind, content, agent_role, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)");
      value.timeline.forEach((item) => insertTimeline.run(item.id, value.id, item.role, item.kind, item.content, item.agentRole ?? null, item.createdAt));
      const insertReview = this.sqlite.prepare("INSERT INTO review_iterations(id, workstream_id, iteration, verdict, findings, fix_summary, tests, commit_sha, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)");
      value.reviews.forEach((item) => insertReview.run(item.id, value.id, item.iteration, item.verdict, JSON.stringify(item.findings), item.fixSummary, item.tests, item.commitSha, item.createdAt));
      const insertAudit = this.sqlite.prepare("INSERT INTO audit_events(id, workstream_id, type, title, detail, created_at) VALUES(?, ?, ?, ?, ?, ?)");
      value.audit.forEach((item) => insertAudit.run(item.id, value.id, item.type, item.title, item.detail, item.createdAt));
      this.sqlite.prepare("DELETE FROM cloud_tombstones WHERE entity_type = 'workstream' AND entity_id = ?").run(value.id);
    });
    replace();
  }

  private replacePlan(value: Plan): void {
    if (!this.getWorkstream(value.workstreamId)) throw new Error(`Cloud plan references missing workstream ${value.workstreamId}`);
    const replace = this.sqlite.transaction(() => {
      const collision = this.sqlite.prepare("SELECT id FROM plans WHERE workstream_id = ? AND id <> ?").get(value.workstreamId, value.id) as { id: string } | undefined;
      if (collision) this.sqlite.prepare("DELETE FROM plans WHERE id = ?").run(collision.id);
      this.sqlite.prepare(`
        INSERT INTO plans(id, workstream_id, title, body, status, source_agent_id, source_permission_id, created_at, updated_at)
        VALUES(@id, @workstreamId, @title, @body, @status, @sourceAgentId, @sourcePermissionId, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET workstream_id=excluded.workstream_id, title=excluded.title, body=excluded.body, status=excluded.status, source_agent_id=excluded.source_agent_id, source_permission_id=excluded.source_permission_id, created_at=excluded.created_at, updated_at=excluded.updated_at
      `).run(value);
      this.replacePlanDependencies(value.id, value.dependencyIds);
      this.sqlite.prepare("DELETE FROM cloud_tombstones WHERE entity_type = 'plan' AND entity_id = ?").run(value.id);
    });
    replace();
  }

  private replacePlanComment(value: PlanComment): void {
    if (!this.getPlan(value.planId)) throw new Error(`Cloud plan comment references missing plan ${value.planId}`);
    this.sqlite.prepare(`
      INSERT INTO plan_comments(id, plan_id, quote, comment, start_offset, end_offset, created_at, updated_at)
      VALUES(@id, @planId, @quote, @comment, @startOffset, @endOffset, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, quote=excluded.quote, comment=excluded.comment, start_offset=excluded.start_offset, end_offset=excluded.end_offset, created_at=excluded.created_at, updated_at=excluded.updated_at
    `).run(value);
    this.sqlite.prepare("DELETE FROM cloud_tombstones WHERE entity_type = 'plan-comment' AND entity_id = ?").run(value.id);
  }

  replacePlanDependencies(planId: string, dependencyIds: string[]): void {
    this.sqlite.prepare("DELETE FROM plan_dependencies WHERE plan_id = ?").run(planId);
    const insert = this.sqlite.prepare("INSERT OR IGNORE INTO plan_dependencies(plan_id, depends_on_plan_id, created_at) SELECT ?, id, ? FROM plans WHERE id = ?");
    const now = new Date().toISOString();
    for (const dependencyId of dependencyIds) insert.run(planId, now, dependencyId);
  }

  private touchWorkstream(id: string, at = new Date().toISOString()): void {
    this.sqlite.prepare("UPDATE workstreams SET updated_at = ? WHERE id = ?").run(at, id);
  }

  getWorkstream(id: string): Workstream | null {
    const row = this.sqlite.prepare("SELECT * FROM workstreams WHERE id = ?").get(id) as WorkstreamRow | undefined;
    return row ? this.hydrateWorkstream(row) : null;
  }

  listWorkstreams(): Workstream[] {
    return (this.sqlite.prepare("SELECT * FROM workstreams ORDER BY created_at DESC").all() as WorkstreamRow[]).map(
      (row) => this.hydrateWorkstream(row),
    );
  }

  private hydrateWorkstream(row: WorkstreamRow): Workstream {
    const host = this.listHosts().find((candidate) => candidate.id === row.host_id);
    const agents = (this.sqlite.prepare("SELECT * FROM agent_runs WHERE workstream_id = ? ORDER BY created_at").all(row.id) as Array<Record<string, unknown>>).map((item): AgentRun => ({
      id: String(item.id), workstreamId: row.id, role: item.role as AgentRole, paseoAgentId: item.paseo_agent_id ? String(item.paseo_agent_id) : null,
      provider: String(item.provider), model: String(item.model), state: item.state as AgentRun["state"], summary: item.summary ? String(item.summary) : null,
      createdAt: String(item.created_at), updatedAt: String(item.updated_at),
    }));
    const timeline = (this.sqlite.prepare("SELECT * FROM timeline_items WHERE workstream_id = ? ORDER BY created_at").all(row.id) as Array<Record<string, unknown>>).map((item): TimelineItem => ({
      id: String(item.id), role: item.role as TimelineItem["role"], kind: item.kind as TimelineItem["kind"], content: String(item.content),
      createdAt: String(item.created_at), ...(item.agent_role ? { agentRole: item.agent_role as AgentRole } : {}),
    }));
    const reviews = (this.sqlite.prepare("SELECT * FROM review_iterations WHERE workstream_id = ? ORDER BY iteration").all(row.id) as Array<Record<string, unknown>>).map((item): ReviewIteration => ({
      id: String(item.id), workstreamId: row.id, iteration: Number(item.iteration), verdict: item.verdict as ReviewIteration["verdict"],
      findings: JSON.parse(String(item.findings)), fixSummary: item.fix_summary ? String(item.fix_summary) : null, tests: item.tests ? String(item.tests) : null,
      commitSha: item.commit_sha ? String(item.commit_sha) : null, createdAt: String(item.created_at),
    }));
    const audit = (this.sqlite.prepare("SELECT * FROM audit_events WHERE workstream_id = ? ORDER BY created_at DESC").all(row.id) as Array<Record<string, unknown>>).map((item): AuditEvent => ({
      id: String(item.id), type: String(item.type), title: String(item.title), detail: item.detail ? String(item.detail) : null, createdAt: String(item.created_at),
    }));
    return {
      id: row.id, name: row.name, brief: row.brief, repositoryId: row.repository_id, repositoryFullName: row.repository_full_name,
      repositoryUrl: row.repository_url, hostId: row.host_id, hostName: host?.name ?? "Unknown host", branchName: row.branch_name,
      baseBranch: row.base_branch, baseSha: row.base_sha, workspaceId: row.workspace_id, status: row.status, phase: row.phase,
      agentState: row.agent_state, acceptedPlan: row.accepted_plan, prNumber: row.pr_number, prUrl: row.pr_url,
      prChecks: row.pr_checks, reviewIteration: row.review_iteration, createdAt: row.created_at, updatedAt: row.updated_at,
      agents, timeline, reviews, audit,
    };
  }

  close(): void {
    this.sqlite.close();
  }
}
