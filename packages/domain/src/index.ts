import { z } from "zod";

export const product = {
  name: "Agent Lens",
  slug: "agent-lens",
  appId: "com.agentlens.app",
} as const;

export const supabaseProject = {
  url: "https://lexvjfpuofjsannrwkwx.supabase.co",
  publishableKey: "sb_publishable_7_khXbhC3w69ROo_UFEoyQ_pzVuVV7N",
} as const;

export const workstreamStatuses = ["draft", "ready-to-build", "unreviewed", "reviewed", "merged"] as const;
export const workstreamPhases = ["provisioning", "planning", "ready", "building", "review-fix", "pr-open", "independent-review", "complete", "attention"] as const;
export const agentStates = ["queued", "running", "idle", "attention", "failed", "stopped"] as const;
export const planStatuses = ["product-feature", "implementation-ready", "cancelled"] as const;
export const planExecutionStates = ["staged", "blocked", "eligible", "in-progress", "completed", "cancelled"] as const;

export type WorkstreamStatus = (typeof workstreamStatuses)[number];
export type WorkstreamPhase = (typeof workstreamPhases)[number];
export type AgentState = (typeof agentStates)[number];
export type AgentRole = "planner" | "builder" | "reviewer";
export type PlanStatus = (typeof planStatuses)[number];
export type PlanExecutionState = (typeof planExecutionStates)[number];
export type PaseoTransport = "relay" | "tailscale";
export const awsAccountStates = ["pending", "connected", "error"] as const;
export const awsDeploymentStates = ["queued", "creating", "waiting-for-ssm", "pairing", "ready", "failed", "deleting", "deleted"] as const;
export const awsRegions = ["us-east-1", "us-east-2", "us-west-1", "us-west-2"] as const;
export const awsInstanceTypes = ["t3.medium", "t3.large", "t3.xlarge", "m7i-flex.large", "m7i-flex.xlarge"] as const;
export type AwsAccountState = (typeof awsAccountStates)[number];
export type AwsDeploymentState = (typeof awsDeploymentStates)[number];
export type AwsRegion = (typeof awsRegions)[number];
export type AwsInstanceType = (typeof awsInstanceTypes)[number];

export interface AwsAccountConnection {
  id: string;
  name: string;
  accountId: string | null;
  roleArn: string | null;
  state: AwsAccountState;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AwsPaseoDeployment {
  id: string;
  awsAccountId: string;
  name: string;
  region: AwsRegion;
  vpcId: string;
  subnetId: string;
  routeType: "nat" | "public";
  associatePublicIp: boolean;
  instanceType: AwsInstanceType;
  volumeSize: number;
  state: AwsDeploymentState;
  stackName: string;
  stackArn: string | null;
  instanceId: string | null;
  paseoHostId: string | null;
  failureDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaseoHost {
  id: string;
  name: string;
  endpoint: string;
  enabled: boolean;
  health: "connected" | "connecting" | "offline" | "error";
  daemonId?: string | null;
  daemonVersion: string | null;
  lastSyncAt: string | null;
  error: string | null;
  preferredTransport?: PaseoTransport;
  transports?: PaseoTransport[];
}

export function normalizeTailscaleEndpoint(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("Enter the Paseo WebSocket endpoint on your tailnet");
  const candidate = value.includes("://") ? value : `wss://${value}`;
  let endpoint: URL;
  try { endpoint = new URL(candidate); }
  catch { throw new Error("Enter a valid Tailscale hostname or 100.x WebSocket endpoint"); }
  if (endpoint.protocol !== "wss:") throw new Error("Tailscale connections must use wss://");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("The endpoint cannot contain credentials, query parameters, or a fragment");
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const ipv4 = hostname.split(".").map(Number);
  const tailscaleIpv4 = ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127;
  const tailscaleIpv6 = hostname.startsWith("fd7a:115c:a1e0:");
  const tailscaleDns = hostname.endsWith(".ts.net") && hostname.length > ".ts.net".length;
  if (!tailscaleIpv4 && !tailscaleIpv6 && !tailscaleDns) throw new Error("Use a Tailscale 100.64.0.0/10 address, Tailscale IPv6 address, or full .ts.net MagicDNS name");
  if (endpoint.pathname === "/") endpoint.pathname = "/ws";
  if (endpoint.pathname !== "/ws") throw new Error("The Paseo WebSocket path must be /ws");
  return endpoint.toString();
}

export interface RoleConfig {
  provider: string;
  model: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export interface ProviderModel {
  provider: string;
  providerLabel: string;
  model: string;
  modelLabel: string;
  status: "ready" | "loading" | "unavailable" | "error";
  modes: Array<{ id: string; label: string }>;
  thinkingOptions: Array<{ id: string; label: string }>;
}

export interface Repository {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  updatedAt: string;
  installations: string[];
  hostAvailability: Array<{ hostId: string; projectId: string; projectRootPath: string; available: boolean }>;
}

export interface AgentRun {
  id: string;
  workstreamId: string;
  role: AgentRole;
  paseoAgentId: string | null;
  provider: string;
  model: string;
  state: AgentState;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineItem {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  kind: "message" | "status" | "tool" | "finding" | "question";
  content: string;
  createdAt: string;
  agentRole?: AgentRole;
}

export interface AgentQuestionOption { label: string; description?: string }
export interface AgentQuestionPrompt {
  question: string;
  header: string;
  options: AgentQuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
}
export interface AgentQuestion {
  agentId: string;
  requestId: string;
  status: "pending" | "answered" | "dismissed";
  questions: AgentQuestionPrompt[];
  answers?: Record<string, string>;
}
export interface CapturedPlan { agentId: string; requestId: string; title: string; body: string }

export interface Plan {
  id: string;
  workstreamId: string;
  title: string;
  body: string;
  status: PlanStatus;
  executionState: PlanExecutionState;
  repositoryId: string;
  repositoryFullName: string;
  sourceAgentId: string | null;
  sourcePermissionId: string | null;
  dependencyIds: string[];
  blockedByIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanComment {
  id: string;
  planId: string;
  quote: string;
  comment: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFinding {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  file?: string;
  line?: number;
  explanation: string;
  recommendation: string;
}
export interface ReviewIteration {
  id: string;
  workstreamId: string;
  iteration: number;
  verdict: "clean" | "findings" | "blocked";
  findings: ReviewFinding[];
  fixSummary: string | null;
  tests: string | null;
  commitSha: string | null;
  createdAt: string;
}
export interface AuditEvent { id: string; type: string; title: string; detail: string | null; createdAt: string }

export interface Workstream {
  id: string;
  name: string;
  brief: string;
  repositoryId: string;
  repositoryFullName: string;
  repositoryUrl: string;
  hostId: string;
  hostName: string;
  branchName: string;
  baseBranch: string;
  baseSha: string | null;
  workspaceId: string | null;
  status: WorkstreamStatus;
  phase: WorkstreamPhase;
  agentState: AgentState;
  acceptedPlan: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prChecks: "none" | "pending" | "success" | "failure";
  reviewIteration: number;
  createdAt: string;
  updatedAt: string;
  agents: AgentRun[];
  timeline: TimelineItem[];
  reviews: ReviewIteration[];
  audit: AuditEvent[];
}

export interface AppSettings {
  githubClientId: string;
  githubLogin: string | null;
  githubConnected: boolean;
  branchPrefix: string;
  defaultBaseBranch: string;
  theme: "system" | "light" | "dark";
  density: "compact" | "balanced" | "comfortable";
  pageSize: number;
  cloud: { supabaseUrl: string; supabasePublishableKey: string; syncEnabled: boolean };
  globalRoles: Record<AgentRole, RoleConfig>;
  hostRoleOverrides: Record<string, Partial<Record<AgentRole, RoleConfig>>>;
  repositoryDefaults: Record<string, { hostId?: string; baseBranch?: string }>;
  promptTemplates: { planner: string; builder: string; reviewFix: string; independentReview: string };
}

export interface CloudState {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  syncing: boolean;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  error: string | null;
}

export interface AppSnapshot {
  settings: AppSettings;
  cloud: CloudState;
  hosts: PaseoHost[];
  repositories: Repository[];
  workstreams: Workstream[];
  plans: Plan[];
  planComments: PlanComment[];
  providerCatalogs: Record<string, ProviderModel[]>;
  /** Repositories from the signed-in user's latest authored or merged pull requests. */
  recentRepositoryIds?: string[];
  /** Web-only credentialless AWS account connections. */
  awsAccounts?: AwsAccountConnection[];
  /** Web-only Paseo hosts provisioned in connected AWS accounts. */
  awsDeployments?: AwsPaseoDeployment[];
}

export const defaultAppSettings: AppSettings = {
  githubClientId: "",
  githubLogin: null,
  githubConnected: false,
  branchPrefix: "agm",
  defaultBaseBranch: "main",
  theme: "system",
  density: "balanced",
  pageSize: 25,
  globalRoles: {
    planner: { provider: "claude", model: "claude-fable-5", modeId: "plan", thinkingOptionId: "high" },
    builder: { provider: "cursor", model: "cursor-grok-4.5-high" },
    reviewer: { provider: "codex", model: "gpt-5.6-sol", modeId: "auto-review", thinkingOptionId: "high" },
  },
  hostRoleOverrides: {},
  repositoryDefaults: {},
  promptTemplates: {
    planner: "Stay in plan mode. Inspect the repository thoroughly, ask any materially necessary questions, and produce a decision-complete Markdown implementation plan. Do not modify files.",
    builder: "Implement the accepted plan completely. Run relevant checks and tests, resolve failures, and report the result. Do not commit, push, or create a pull request yet.",
    reviewFix: "Perform an extensive review of the implemented code. Find and fix code or logic errors, missed edge cases, regressions, security issues, and insufficient tests. Rerun relevant checks, commit all final changes, and push the current branch. Do not create a pull request.",
    independentReview: "Review the pull request read-only. Report every actionable correctness, logic, security, regression, edge-case, and test finding. Do not modify files.",
  },
  cloud: { supabaseUrl: supabaseProject.url, supabasePublishableKey: supabaseProject.publishableKey, syncEnabled: true },
};

export const createHostInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  endpoint: z.string().trim().url().refine((value) => value.startsWith("ws"), "Use ws:// or wss://"),
});
export const createWorkstreamInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brief: z.string().trim().min(1),
  repositoryId: z.string().min(1),
  hostId: z.string().min(1),
  prefix: z.string().trim().min(1).max(40),
  baseBranch: z.string().trim().min(1).max(120),
});
export const supabaseCredentialsSchema = z.object({ email: z.string().trim().email(), password: z.string().min(8) });
export const awsRoleArnSchema = z.string().trim().regex(/^arn:aws:iam::\d{12}:role\/AgentGodMode(?:Connection|Customer)-[a-f0-9]{12}$/, "Paste the ConnectionRoleArn created for this AWS account");
export const awsAccountIdSchema = z.string().regex(/^\d{12}$/, "AWS account IDs contain exactly 12 digits");
export const createAwsDeploymentInputSchema = z.object({
  awsAccountId: z.string().uuid(),
  name: z.string().trim().min(1).max(64),
  region: z.enum(awsRegions),
  vpcId: z.string().regex(/^vpc-[a-f0-9]+$/),
  subnetId: z.string().regex(/^subnet-[a-f0-9]+$/),
  routeType: z.enum(["nat", "public"]),
  associatePublicIp: z.boolean(),
  instanceType: z.enum(awsInstanceTypes),
  volumeSize: z.number().int().min(40).max(2048),
});
export type CreateHostInput = z.infer<typeof createHostInputSchema>;
export type CreateWorkstreamInput = z.infer<typeof createWorkstreamInputSchema>;
export type CreateAwsDeploymentInput = z.infer<typeof createAwsDeploymentInputSchema>;

export function awsConnectionToken(id: string): string {
  const token = id.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 12);
  if (token.length !== 12) throw new Error("Invalid AWS connection ID");
  return token;
}

export function awsDeploymentStackName(id: string): string {
  return `agent-god-mode-paseo-${id.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 24)}`;
}

export const REVIEW_START = "<!-- agent-lens:review-log:start -->";
export const REVIEW_END = "<!-- agent-lens:review-log:end -->";

export function slugifyWorkstream(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
}

export function branchName(prefix: string, name: string): string {
  const slug = slugifyWorkstream(name);
  if (!slug) throw new Error("The workstream name must contain a letter or number");
  return `${prefix.replace(/^\/+|\/+$/g, "").replace(/\s+/g, "-")}/${slug}`;
}

export function replaceReviewLog(body: string, log: string): string {
  const block = `${REVIEW_START}\n## Agent Lens Review Log\n\n${log.trim()}\n${REVIEW_END}`;
  const start = body.indexOf(REVIEW_START);
  const end = body.indexOf(REVIEW_END);
  if (start >= 0 && end > start) return `${body.slice(0, start).trimEnd()}\n\n${block}${body.slice(end + REVIEW_END.length)}`.trim();
  return `${body.trim()}\n\n${block}`.trim();
}

export function resolveRoleConfig(settings: AppSettings, hostId: string, role: AgentRole): RoleConfig {
  return settings.hostRoleOverrides[hostId]?.[role] ?? settings.globalRoles[role];
}

export function wouldCreatePlanDependencyCycle(plans: Array<{ id: string; dependencyIds: string[] }>, planId: string, dependencyIds: string[]): boolean {
  const graph = new Map(plans.map((plan) => [plan.id, plan.id === planId ? dependencyIds : plan.dependencyIds]));
  const reaches = (start: string, target: string, seen = new Set<string>()): boolean => {
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return (graph.get(start) ?? []).some((next) => reaches(next, target, seen));
  };
  return dependencyIds.some((dependencyId) => reaches(dependencyId, planId));
}

export function planRevisionPrompt(comments: Pick<PlanComment, "quote" | "comment">[]): string {
  return [
    "Revise the captured plan using every comment below. Preserve unaffected detail and submit the complete revised plan again for review.",
    ...comments.map((item, index) => `## Revision comment ${index + 1}\n\nSelected text:\n${item.quote.split("\n").map((line) => `> ${line}`).join("\n")}\n\nRequested change:\n${item.comment}`),
  ].join("\n\n");
}

export interface AgentLensApi {
  bootstrap(): Promise<AppSnapshot>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  createHost(input: CreateHostInput): Promise<PaseoHost>;
  deleteHost(hostId: string): Promise<void>;
  connectHost(hostId: string): Promise<void>;
  startGithubDeviceFlow(clientId: string): Promise<void>;
  disconnectGithub(): Promise<void>;
  signInSupabase(email: string, password: string): Promise<void>;
  signUpSupabase(email: string, password: string): Promise<{ confirmationRequired: boolean }>;
  requestSupabasePasswordReset(email: string): Promise<void>;
  signOutSupabase(): Promise<void>;
  syncSupabase(): Promise<void>;
  refreshRepositories(): Promise<Repository[]>;
  refreshPaseoMappings(): Promise<void>;
  createWorkstream(input: CreateWorkstreamInput): Promise<Workstream>;
  updateWorkstreamStatus(id: string, status: WorkstreamStatus): Promise<Workstream>;
  sendFollowup(id: string, prompt: string): Promise<void>;
  respondToAgentQuestion(id: string, agentId: string, requestId: string, answers: Record<string, string> | null): Promise<void>;
  updatePlanStatus(id: string, status: PlanStatus): Promise<void>;
  setPlanDependencies(id: string, dependencyIds: string[]): Promise<void>;
  addPlanComment(planId: string, quote: string, comment: string, startOffset: number, endOffset: number): Promise<PlanComment>;
  deletePlanComment(id: string): Promise<void>;
  submitPlanComments(planId: string): Promise<void>;
  beginPlan(id: string): Promise<void>;
  markPlanReady(id: string): Promise<Workstream>;
  startBuild(id: string, config?: RoleConfig): Promise<void>;
  startReviewFix(id: string): Promise<void>;
  completeReview(id: string): Promise<void>;
  startIndependentReview(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onSnapshot(handler: (snapshot: AppSnapshot) => void): () => void;
  onGithubVerification(handler: (payload: { verificationUri: string; userCode: string }) => void): () => void;
  onToast(handler: (payload: { kind: "success" | "error" | "info"; message: string }) => void): () => void;
}
