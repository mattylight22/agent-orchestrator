import type { AgentRole, Repository, Workstream } from "../shared/contracts.js";
import { AppDatabase } from "./database.js";

const now = Date.now();
const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

export function seedDemoData(db: AppDatabase): void {
  if (db.listWorkstreams().length > 0) return;

  const primary = db.createHost("Paseo · Build Fleet", "wss://paseo-build.tailnet.ts.net/ws");
  const secondary = db.createHost("Paseo · Sandbox", "wss://paseo-sandbox.tailnet.ts.net/ws");
  const repositories: Repository[] = [
    {
      id: "repo-arc",
      fullName: "northstar/arc-web",
      owner: "northstar",
      name: "arc-web",
      description: "Customer-facing application and design system",
      defaultBranch: "main",
      private: true,
      htmlUrl: "https://github.com/northstar/arc-web",
      updatedAt: at(1),
      installations: ["Northstar Engineering"],
      hostAvailability: [],
    },
    {
      id: "repo-api",
      fullName: "northstar/platform-api",
      owner: "northstar",
      name: "platform-api",
      description: "Core platform services",
      defaultBranch: "main",
      private: true,
      htmlUrl: "https://github.com/northstar/platform-api",
      updatedAt: at(3),
      installations: ["Northstar Engineering"],
      hostAvailability: [],
    },
    {
      id: "repo-ops",
      fullName: "northstar/control-plane",
      owner: "northstar",
      name: "control-plane",
      description: "Internal operations tooling",
      defaultBranch: "main",
      private: true,
      htmlUrl: "https://github.com/northstar/control-plane",
      updatedAt: at(6),
      installations: ["Northstar Engineering"],
      hostAvailability: [],
    },
  ];
  for (const repository of repositories) {
    db.upsertRepository(repository.id, repository);
    db.upsertHostRepository({
      repositoryId: repository.id,
      hostId: primary.id,
      projectId: `project-${repository.name}`,
      projectRootPath: `/srv/repos/${repository.name}`,
      remoteUrl: repository.fullName,
    });
  }
  db.upsertHostRepository({
    repositoryId: repositories[0].id,
    hostId: secondary.id,
    projectId: "project-arc-sandbox",
    projectRootPath: "/srv/sandbox/arc-web",
    remoteUrl: repositories[0].fullName,
  });

  const examples: Array<{
    id: string;
    name: string;
    brief: string;
    repo: Repository;
    hostId: string;
    status: Workstream["status"];
    phase: Workstream["phase"];
    agentState: Workstream["agentState"];
    hours: number;
    plan?: string;
    pr?: number;
    checks?: Workstream["prChecks"];
  }> = [
    {
      id: "ws-command-menu",
      name: "Command palette and keyboard navigation",
      brief: "Add a fast, accessible command palette with navigation and lifecycle actions.",
      repo: repositories[0], hostId: primary.id, status: "ready-to-build", phase: "ready", agentState: "idle", hours: 1,
      plan: "# Implementation plan\n\n## 1. Command registry\n\nCreate a typed command registry with context-aware availability and keyboard shortcuts.\n\n## 2. Palette UI\n\n- Add fuzzy filtering\n- Preserve visible focus\n- Announce result counts\n\n## 3. Verification\n\nAdd unit and interaction coverage for navigation, disabled commands, and focus restoration.",
    },
    {
      id: "ws-token-refresh",
      name: "Harden installation token refresh",
      brief: "Prevent concurrent token refreshes and make rate-limit recovery visible.",
      repo: repositories[1], hostId: primary.id, status: "draft", phase: "building", agentState: "running", hours: 2,
      plan: "# Accepted plan\n\nIntroduce a single-flight refresh coordinator, persist no token material, and surface a rate-limit state with retry timing.",
    },
    {
      id: "ws-markdown",
      name: "Polish long-form Markdown rendering",
      brief: "Improve plan readability, code blocks, tables, task lists, and copy affordances.",
      repo: repositories[0], hostId: secondary.id, status: "unreviewed", phase: "pr-open", agentState: "idle", hours: 5,
      plan: "# Markdown presentation\n\nUse a constrained reading measure and explicit rhythm for headings. Tables scroll within their own region on compact windows.\n\n> External content remains sanitized before it reaches the DOM.\n\n```ts\nconst safe = sanitize(markdown)\n```",
      pr: 184, checks: "success",
    },
    {
      id: "ws-audit",
      name: "Append-only lifecycle audit export",
      brief: "Add an exportable, append-only lifecycle audit trail for compliance reviews.",
      repo: repositories[2], hostId: primary.id, status: "reviewed", phase: "complete", agentState: "idle", hours: 25,
      plan: "# Plan\n\nPersist normalized lifecycle events and add JSON export with secret redaction.",
      pr: 92, checks: "success",
    },
    {
      id: "ws-collision",
      name: "Resolve branch collision during provisioning",
      brief: "Make branch provisioning fully idempotent after an interrupted GitHub request.",
      repo: repositories[1], hostId: primary.id, status: "draft", phase: "attention", agentState: "attention", hours: 42,
    },
  ];

  for (const example of examples) {
    const branchName = `lens/${example.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const createdAt = at(example.hours);
    db.insertWorkstream({
      id: example.id,
      name: example.name,
      brief: example.brief,
      repositoryId: example.repo.id,
      repositoryFullName: example.repo.fullName,
      repositoryUrl: example.repo.htmlUrl,
      hostId: example.hostId,
      branchName,
      baseBranch: "main",
      baseSha: "a91f7d33d1b4ce8206be7810ad859af4d36fef80",
      workspaceId: `workspace-${example.id}`,
      status: example.status,
      phase: example.phase,
      agentState: example.agentState,
      acceptedPlan: example.plan ?? null,
      prNumber: example.pr ?? null,
      prUrl: example.pr ? `${example.repo.htmlUrl}/pull/${example.pr}` : null,
      prChecks: example.checks ?? "none",
      reviewIteration: example.status === "reviewed" ? 2 : 0,
      createdAt,
      updatedAt: at(Math.max(0.15, example.hours - 0.8)),
    });
    const roles: AgentRole[] = example.phase === "planning" ? ["planner"] : example.pr ? ["planner", "builder"] : ["planner"];
    for (const role of roles) {
      db.insertAgent({
        workstreamId: example.id,
        role,
        paseoAgentId: `agent-${example.id}-${role}`,
        provider: role === "planner" ? "claude" : "cursor",
        model: role === "planner" ? "claude-fable-5" : "cursor-grok-4.5-high",
        state: role === roles.at(-1) ? example.agentState : "idle",
      });
    }
    db.addTimeline(example.id, { role: "system", kind: "status", content: `Workspace checked out at ${branchName}.`, createdAt });
    db.addTimeline(example.id, { role: "user", kind: "message", content: example.brief, agentRole: "planner", createdAt: at(example.hours - 0.1) });
    if (example.plan) db.addTimeline(example.id, { role: "assistant", kind: "message", content: example.plan, agentRole: "planner", createdAt: at(example.hours - 0.3) });
    if (example.agentState === "running") db.addTimeline(example.id, { role: "system", kind: "status", content: "Builder is running repository tests…", agentRole: "builder", createdAt: at(0.3) });
    if (example.phase === "attention") db.addTimeline(example.id, { role: "system", kind: "status", content: "The branch already exists on GitHub but is not associated with a known workstream. Confirm the branch before retrying.", createdAt: at(40) });
    db.addAudit(example.id, "workstream.created", "Workstream created", branchName);
    if (example.pr) db.addAudit(example.id, "pr.opened", `Pull request #${example.pr} opened`, `${example.repo.htmlUrl}/pull/${example.pr}`);
  }

  db.addReview({
    workstreamId: "ws-audit",
    iteration: 1,
    verdict: "findings",
    findings: [{ severity: "medium", title: "Redaction missed nested feature values", file: "src/main/audit-export.ts", line: 87, explanation: "Nested provider options could be emitted without redaction.", recommendation: "Use the recursive secret scrubber for the entire payload." }],
    fixSummary: "Applied recursive redaction before serialization and covered nested arrays and records.",
    tests: "pnpm test audit-export — 18 passed",
    commitSha: "f15b8d1",
  });
  db.addReview({ workstreamId: "ws-audit", iteration: 2, verdict: "clean", findings: [], fixSummary: null, tests: "pnpm test — 264 passed", commitSha: "f15b8d1" });
}
