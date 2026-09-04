import "server-only";
import type { AppSettings, AppSnapshot, PaseoHost, PaseoTransport, Plan, Repository, Workstream } from "@agent-lens/domain";
import { defaultAppSettings } from "@agent-lens/domain";
import { createSupabaseAdminClient } from "./supabase/admin";
import { requireUser } from "./supabase/server";

type Row = Record<string, any>;

function workstream(row: Row, hosts: Map<string, Row>, agents: Row[], timeline: Row[], reviews: Row[], audit: Row[]): Workstream {
  return {
    id: row.id, name: row.name, brief: row.brief, repositoryId: row.repository_id,
    repositoryFullName: row.repository_full_name, repositoryUrl: row.repository_url,
    hostId: row.host_id, hostName: hosts.get(row.host_id)?.name ?? "Unavailable host",
    branchName: row.branch_name, baseBranch: row.base_branch, baseSha: row.base_sha,
    workspaceId: row.workspace_id, status: row.status, phase: row.phase, agentState: row.agent_state,
    acceptedPlan: row.accepted_plan, prNumber: row.pr_number, prUrl: row.pr_url,
    prChecks: row.pr_checks, reviewIteration: row.review_iteration,
    createdAt: row.created_at, updatedAt: row.updated_at,
    agents: agents.filter((item) => item.workstream_id === row.id).map((item) => ({
      id: item.id, workstreamId: row.id, role: item.role, paseoAgentId: item.paseo_agent_id,
      provider: item.provider, model: item.model, state: item.state, summary: item.summary,
      createdAt: item.created_at, updatedAt: item.updated_at,
    })),
    timeline: timeline.filter((item) => item.workstream_id === row.id).map((item) => ({
      id: item.id, role: item.role, kind: item.kind, content: item.content,
      agentRole: item.agent_role ?? undefined, createdAt: item.created_at,
    })),
    reviews: reviews.filter((item) => item.workstream_id === row.id).map((item) => ({
      id: item.id, workstreamId: row.id, iteration: item.iteration, verdict: item.verdict,
      findings: item.findings ?? [], fixSummary: item.fix_summary, tests: item.tests,
      commitSha: item.commit_sha, createdAt: item.created_at,
    })),
    audit: audit.filter((item) => item.workstream_id === row.id).map((item) => ({
      id: item.id, type: item.event_type, title: item.title, detail: item.detail, createdAt: item.created_at,
    })),
  };
}

export async function loadSnapshot(): Promise<AppSnapshot> {
  const { supabase, user } = await requireUser();
  const admin = createSupabaseAdminClient();
  const query = (table: string) => supabase.from(table).select("*").eq("user_id", user.id);
  const [settingsResult, hostsResult, repositoriesResult, mappingsResult, workstreamsResult, agentsResult, timelineResult, plansResult, dependenciesResult, commentsResult, reviewsResult, auditResult, connectionsResult] = await Promise.all([
    query("user_settings").maybeSingle(), query("paseo_hosts").is("deleted_at", null),
    query("repositories").is("deleted_at", null).order("github_updated_at", { ascending: false }), query("host_repository_mappings"),
    query("workstreams").is("deleted_at", null).order("created_at", { ascending: false }), query("agent_runs"),
    query("timeline_items").order("created_at"), query("plans").is("deleted_at", null).order("updated_at", { ascending: false }),
    query("plan_dependencies"), query("plan_comments").is("deleted_at", null), query("review_iterations").order("iteration"),
    query("audit_events").order("created_at", { ascending: false }),
    admin.from("paseo_connections").select("host_id,transport").eq("user_id", user.id),
  ]);
  const firstError = [settingsResult, hostsResult, repositoriesResult, mappingsResult, workstreamsResult, agentsResult, timelineResult, plansResult, dependenciesResult, commentsResult, reviewsResult, auditResult, connectionsResult].find((item) => item.error)?.error;
  if (firstError) throw firstError;
  const hostRows = (hostsResult.data ?? []) as Row[];
  const hostMap = new Map(hostRows.map((row) => [row.id, row]));
  const mappingRows = (mappingsResult.data ?? []) as Row[];
  const wsRows = (workstreamsResult.data ?? []) as Row[];
  const workstreams = wsRows.map((row) => workstream(row, hostMap, (agentsResult.data ?? []) as Row[], (timelineResult.data ?? []) as Row[], (reviewsResult.data ?? []) as Row[], (auditResult.data ?? []) as Row[]));
  const dependencyRows = (dependenciesResult.data ?? []) as Row[];
  const completedPlanIds = new Set(((plansResult.data ?? []) as Row[]).filter((row) => row.execution_state === "completed").map((row) => row.id));
  const plans: Plan[] = ((plansResult.data ?? []) as Row[]).map((row) => {
    const dependencyIds = dependencyRows.filter((item) => item.plan_id === row.id).map((item) => item.depends_on_plan_id);
    const blockedByIds = dependencyIds.filter((id) => !completedPlanIds.has(id));
    return {
      id: row.id, workstreamId: row.workstream_id, title: row.title, body: row.body,
      status: row.status, executionState: row.status === "cancelled" ? "cancelled" : blockedByIds.length ? "blocked" : row.execution_state,
      repositoryId: wsRows.find((item) => item.id === row.workstream_id)?.repository_id ?? "",
      repositoryFullName: wsRows.find((item) => item.id === row.workstream_id)?.repository_full_name ?? "",
      sourceAgentId: row.source_agent_id, sourcePermissionId: row.source_permission_id,
      dependencyIds, blockedByIds, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  });
  const { data: github } = await admin.from("github_connections").select("login").eq("user_id", user.id).maybeSingle();
  const stored = (settingsResult.data as Row | null)?.payload as Partial<AppSettings> | undefined;
  const settings: AppSettings = {
    ...defaultAppSettings, ...stored,
    globalRoles: { ...defaultAppSettings.globalRoles, ...(stored?.globalRoles ?? {}) },
    promptTemplates: { ...defaultAppSettings.promptTemplates, ...(stored?.promptTemplates ?? {}) },
    cloud: defaultAppSettings.cloud,
    githubLogin: github?.login ?? null,
    githubConnected: Boolean(github),
  };
  const hosts: PaseoHost[] = hostRows.map((row) => ({
    id: row.id, name: row.name, endpoint: row.endpoint || "Paseo relay", enabled: row.enabled,
    health: "offline", daemonId: row.daemon_id, daemonVersion: row.daemon_version,
    lastSyncAt: row.source_updated_at, error: null,
    preferredTransport: (row.preferred_transport ?? "relay") as PaseoTransport,
    transports: ((connectionsResult.data ?? []) as Row[]).filter((connection) => connection.host_id === row.id).map((connection) => connection.transport as PaseoTransport),
  }));
  const repositories: Repository[] = ((repositoriesResult.data ?? []) as Row[]).map((row) => ({
    id: row.id, fullName: row.full_name, owner: row.owner, name: row.name, description: row.description,
    defaultBranch: row.default_branch, private: row.is_private, htmlUrl: row.html_url,
    updatedAt: row.github_updated_at, installations: row.installations ?? [],
    hostAvailability: mappingRows.filter((item) => item.repository_id === row.id).map((item) => ({ hostId: item.host_id, projectId: item.project_id, projectRootPath: item.project_root_path, available: true })),
  }));
  return {
    settings,
    cloud: { configured: true, signedIn: true, email: user.email ?? null, syncing: false, syncEnabled: true, lastSyncAt: new Date().toISOString(), error: null },
    hosts, repositories, workstreams, plans,
    planComments: ((commentsResult.data ?? []) as Row[]).map((row) => ({ id: row.id, planId: row.plan_id, quote: row.quote, comment: row.comment, startOffset: row.start_offset, endOffset: row.end_offset, createdAt: row.created_at, updatedAt: row.updated_at })),
    providerCatalogs: Object.fromEntries(hostRows.map((row) => [row.id, row.provider_catalog ?? []])),
  };
}
