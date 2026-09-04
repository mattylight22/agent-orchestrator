import { randomUUID } from "node:crypto";
import type {
  CreateWorkstreamInput,
  AppSettings,
  PlanComment,
  PlanStatus,
  Repository,
  ReviewFinding,
  RoleConfig,
  Workstream,
  WorkstreamStatus,
} from "../shared/contracts.js";
import {
  branchName as createBranchName,
  planRevisionPrompt,
  replaceReviewLog,
  resolveRoleConfig,
  slugifyWorkstream,
  wouldCreatePlanDependencyCycle,
} from "../shared/contracts.js";
import { AppDatabase } from "./database.js";
import { GithubService } from "./github-service.js";
import { PaseoManager } from "./paseo-manager.js";

export { planRevisionPrompt, replaceReviewLog, resolveRoleConfig, slugifyWorkstream, wouldCreatePlanDependencyCycle } from "../shared/contracts.js";

function providerLabel(config: RoleConfig): string {
  return `${config.provider}/${config.model}`;
}

function plannerPrompt(workstream: Workstream, template: string): string {
  return `${template}\n\n# Workstream context\n\n- Name: ${workstream.name}\n- Repository: ${workstream.repositoryFullName}\n- Base branch: ${workstream.baseBranch}\n- Workstream branch: ${workstream.branchName}\n\n# Request\n\n${workstream.brief}`;
}

function builderPrompt(workstream: Workstream, template: string): string {
  return `${template}\n\n# Workstream\n\n${workstream.brief}\n\n# Accepted plan\n\n${workstream.acceptedPlan ?? "No accepted plan was captured."}`;
}

function prBody(workstream: Workstream): string {
  return `## Summary\n\n${workstream.brief}\n\n## Accepted plan\n\n${workstream.acceptedPlan ?? "See the Agent Lens workstream."}\n\n## Validation\n\nImplementation and pre-PR review were completed by the assigned builder agent.\n\n---\nCreated by Agent Lens.`;
}

const reviewOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["clean", "findings", "blocked"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          title: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
          explanation: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["severity", "title", "explanation", "recommendation"],
      },
    },
  },
  required: ["verdict", "summary", "findings"],
} as const;

export class WorkstreamService {
  constructor(
    private readonly db: AppDatabase,
    private readonly github: GithubService,
    private readonly paseo: PaseoManager,
    private readonly publish: () => void,
    private readonly notify: (kind: "success" | "error" | "info", message: string) => void,
  ) {}

  async create(input: CreateWorkstreamInput): Promise<Workstream> {
    const repository = this.db.listRepositoryPayloads<Repository>().find((repo) => repo.id === input.repositoryId);
    if (!repository) throw new Error("Repository is no longer available from GitHub");
    let mapping = this.db.hostRepository(input.repositoryId, input.hostId);
    if (!mapping) {
      const project = await this.paseo.ensureRepositoryProject(input.hostId, repository.fullName);
      this.db.upsertHostRepository({
        repositoryId: repository.id,
        hostId: input.hostId,
        projectId: project.projectId,
        projectRootPath: project.projectRootPath,
        remoteUrl: project.remoteFullName,
      });
      mapping = { projectId: project.projectId, projectRootPath: project.projectRootPath };
    }
    const branchName = createBranchName(input.prefix, input.name);
    const known = this.db.listWorkstreams().find(
      (workstream) => workstream.repositoryId === input.repositoryId && workstream.branchName === branchName,
    );
    if (known) {
      if (known.baseSha && (known.phase === "provisioning" || known.phase === "attention") && !this.db.latestAgent(known.id, "planner")) {
        return this.provision(known, mapping, true);
      }
      return known;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const baseSha = await this.github.branchSha(repository.fullName, input.baseBranch);
    const base: Omit<Workstream, "agents" | "timeline" | "reviews" | "audit" | "hostName"> = {
      id,
      name: input.name,
      brief: input.brief,
      repositoryId: repository.id,
      repositoryFullName: repository.fullName,
      repositoryUrl: repository.htmlUrl,
      hostId: input.hostId,
      branchName,
      baseBranch: input.baseBranch,
      baseSha,
      workspaceId: null,
      status: "draft",
      phase: "provisioning",
      agentState: "queued",
      acceptedPlan: null,
      prNumber: null,
      prUrl: null,
      prChecks: "none",
      reviewIteration: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insertWorkstream(base);
    this.db.addAudit(id, "provisioning.started", "Workstream provisioning started", branchName);
    this.publish();
    return this.provision(this.require(id), mapping, false);
  }

  private async provision(
    workstream: Workstream,
    mapping: { projectId: string; projectRootPath: string },
    retry: boolean,
  ): Promise<Workstream> {
    const id = workstream.id;
    try {
      let workspaceId = workstream.workspaceId;
      if (!workspaceId) {
        let branchExists = false;
        if (retry) {
          try {
            const branchSha = await this.github.branchSha(workstream.repositoryFullName, workstream.branchName);
            if (branchSha !== workstream.baseSha) {
              throw new Error(`Branch ${workstream.branchName} exists at an unexpected commit; refusing to attach it`);
            }
            branchExists = true;
          } catch (error) {
            if (!(typeof error === "object" && error !== null && "status" in error && error.status === 404)) throw error;
          }
        }
        if (!branchExists) {
          await this.github.createBranch(
            workstream.repositoryFullName,
            workstream.baseBranch,
            workstream.branchName,
            workstream.baseSha ?? undefined,
          );
          this.db.addAudit(id, "branch.created", "GitHub branch created", workstream.branchName);
        }
        const workspace = await this.paseo.createCheckoutWorkspace({
          hostId: workstream.hostId,
          projectId: mapping.projectId,
          projectRootPath: mapping.projectRootPath,
          branchName: workstream.branchName,
          title: workstream.name,
        });
        workspaceId = workspace.id;
        this.db.updateWorkstream(id, { workspaceId, phase: "planning", agentState: "running" });
        this.db.addAudit(id, "workspace.created", "Isolated Paseo workspace created", workspaceId);
      }
      this.db.updateWorkstream(id, { phase: "planning", agentState: "running" });
      const current = this.require(id);
      const settings = this.db.settings();
      const config = resolveRoleConfig(settings, current.hostId, "planner");
      const agent = await this.paseo.createAgent({
        hostId: current.hostId,
        workspaceId,
        config,
        title: `Plan · ${current.name}`,
        prompt: plannerPrompt(current, settings.promptTemplates.planner),
        role: "planner",
        workstreamId: id,
      });
      this.db.insertAgent({ workstreamId: id, role: "planner", paseoAgentId: agent.id, provider: config.provider, model: config.model });
      this.db.addTimeline(id, { role: "system", kind: "status", content: `Planning started with ${providerLabel(config)}.`, agentRole: "planner" });
      this.db.addAudit(id, "agent.started", "Planner started", agent.id);
      this.publish();
      void agent.waitForFinish(60 * 60_000).then((result) => {
        if (result.lastMessage) this.db.updateAgentByPaseoId(agent.id, result.status === "idle" ? "idle" : result.status === "error" ? "failed" : "attention", result.lastMessage);
        this.db.updateWorkstream(id, { agentState: result.status === "idle" ? "idle" : result.status === "error" ? "failed" : "attention" });
        this.publish();
      });
      return this.require(id);
    } catch (error) {
      this.db.updateWorkstream(id, { phase: "attention", agentState: "failed" });
      this.db.addAudit(id, "provisioning.failed", "Provisioning needs attention", error instanceof Error ? error.message : String(error));
      this.publish();
      throw error;
    }
  }

  updateStatus(id: string, status: WorkstreamStatus): Workstream {
    const workstream = this.require(id);
    if (workstream.status === "merged" && status !== "merged") throw new Error("Merged workstreams are terminal");
    this.db.updateWorkstream(id, { status });
    this.db.addAudit(id, "status.changed", `Marked ${status}`, `Previous status: ${workstream.status}`);
    this.publish();
    return this.require(id);
  }

  async sendFollowup(id: string, prompt: string): Promise<void> {
    const workstream = this.require(id);
    const agent = this.db.latestAgent(id);
    if (!agent?.paseoAgentId) throw new Error("There is no active agent for this workstream");
    this.db.addTimeline(id, { role: "user", kind: "message", content: prompt, agentRole: agent.role });
    this.db.updateWorkstream(id, { agentState: "running" });
    this.publish();
    const plan = agent.role === "planner" ? this.db.planForWorkstream(id) : null;
    if (plan?.sourceAgentId === agent.paseoAgentId && plan.sourcePermissionId && plan.status === "product-feature") {
      const revisionRequested = await this.paseo.requestPlanRevision(
        workstream.hostId,
        agent.paseoAgentId,
        plan.sourcePermissionId,
        prompt,
      );
      if (revisionRequested) {
        this.db.addAudit(id, "plan.revision.requested", "Plan revision requested", prompt);
        this.publish();
        return;
      }
    }
    await this.paseo.send(workstream.hostId, agent.paseoAgentId, prompt);
  }

  async respondToAgentQuestion(
    id: string,
    agentId: string,
    requestId: string,
    answers: Record<string, string> | null,
  ): Promise<void> {
    const workstream = this.require(id);
    const context = this.db.agentContext(agentId);
    if (!context || context.workstreamId !== id) throw new Error("That question does not belong to this workstream");
    await this.paseo.respondToQuestion(workstream.hostId, agentId, requestId, answers);
    this.db.updateWorkstream(id, { agentState: "running" });
    this.db.addAudit(
      id,
      answers ? "agent.question.answered" : "agent.question.dismissed",
      answers ? "Answered agent question" : "Dismissed agent question",
      answers ? Object.entries(answers).map(([header, answer]) => `${header}: ${answer}`).join("\n") : null,
    );
    this.publish();
  }

  async updatePlanStatus(id: string, status: PlanStatus): Promise<void> {
    const plan = this.db.getPlan(id);
    if (!plan) throw new Error("Plan not found");
    if (["in-progress", "completed"].includes(plan.executionState) && status === "cancelled") {
      throw new Error("An active or completed plan cannot be cancelled");
    }
    this.db.updatePlanStatus(id, status);
    if (status === "implementation-ready") {
      const workstream = this.require(plan.workstreamId);
      this.db.updateWorkstream(plan.workstreamId, {
        acceptedPlan: plan.body,
        status: "ready-to-build",
        ...(["planning", "ready", "attention"].includes(workstream.phase) ? { phase: "ready" as const } : {}),
      });
    } else if (status === "cancelled") {
      const workstream = this.require(plan.workstreamId);
      if (["planning", "ready", "attention"].includes(workstream.phase)) {
        this.db.updateWorkstream(plan.workstreamId, { acceptedPlan: null, status: "draft", agentState: "idle" });
      }
    }
    this.db.addAudit(plan.workstreamId, "plan.status.changed", `Plan marked ${status}`, `Previous status: ${plan.status}`);
    this.publish();
    if (status !== "product-feature" && plan.sourceAgentId && plan.sourcePermissionId) {
      const workstream = this.require(plan.workstreamId);
      await this.paseo.resolveCapturedPlan(workstream.hostId, plan.sourceAgentId, plan.sourcePermissionId, status).catch((error) => {
        this.notify("error", `Plan saved, but Paseo could not be released: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  setPlanDependencies(id: string, dependencyIds: string[]): void {
    const plans = this.db.listPlans();
    const plan = plans.find((candidate) => candidate.id === id);
    if (!plan) throw new Error("Plan not found");
    const unique = [...new Set(dependencyIds)];
    if (unique.includes(id)) throw new Error("A plan cannot depend on itself");
    if (unique.some((dependencyId) => !plans.some((candidate) => candidate.id === dependencyId))) throw new Error("One or more prerequisite plans no longer exist");
    if (wouldCreatePlanDependencyCycle(plans, id, unique)) throw new Error("That dependency would create a plan cycle");
    this.db.setPlanDependencies(id, unique);
    this.db.addAudit(plan.workstreamId, "plan.dependencies.changed", "Plan prerequisites updated", unique.length ? `${unique.length} prerequisite${unique.length === 1 ? "" : "s"}` : "No prerequisites");
    this.publish();
  }

  async submitPlanComments(planId: string): Promise<void> {
    const plan = this.db.getPlan(planId);
    if (!plan) throw new Error("Plan not found");
    if (plan.status !== "product-feature") throw new Error("Only a Product / Feature plan can be revised");
    const comments = this.db.listPlanComments(planId);
    if (!comments.length) throw new Error("Add at least one revision comment first");
    const feedback = planRevisionPrompt(comments);
    await this.sendFollowup(plan.workstreamId, feedback);
    this.db.deletePlanComments(planId);
    this.db.addAudit(plan.workstreamId, "plan.comments.submitted", "Revision comments submitted", `${comments.length} comment${comments.length === 1 ? "" : "s"}`);
    this.publish();
  }

  async beginPlan(id: string): Promise<void> {
    const plan = this.db.getPlan(id);
    if (!plan) throw new Error("Plan not found");
    if (plan.status !== "implementation-ready") throw new Error("Mark the plan Implementation Ready before beginning work");
    if (plan.blockedByIds.length) {
      const blockers = this.db.listPlans().filter((candidate) => plan.blockedByIds.includes(candidate.id)).map((candidate) => candidate.title);
      throw new Error(`Complete and review prerequisite${blockers.length === 1 ? "" : "s"}: ${blockers.join(", ")}`);
    }
    if (plan.executionState === "in-progress" || plan.executionState === "completed") throw new Error(`This plan is already ${plan.executionState}`);
    this.db.updateWorkstream(plan.workstreamId, { acceptedPlan: plan.body, phase: "ready", status: "ready-to-build" });
    this.db.addAudit(plan.workstreamId, "plan.started", "Implementation started from Plans", plan.title);
    this.publish();
    await this.startBuild(plan.workstreamId);
  }

  async markPlanReady(id: string): Promise<Workstream> {
    let plan = this.db.planForWorkstream(id);
    if (!plan) {
      const body = this.db.latestAssistantMessage(id, "planner") ?? this.db.latestAgent(id, "planner")?.summary;
      const agent = this.db.latestAgent(id, "planner");
      if (!body || !agent?.paseoAgentId) throw new Error("The planner has not produced a plan yet");
      plan = this.db.upsertCapturedPlan({ workstreamId: id, title: this.require(id).name, body, sourceAgentId: agent.paseoAgentId, sourcePermissionId: "legacy" });
    }
    await this.updatePlanStatus(plan.id, "implementation-ready");
    return this.require(id);
  }

  async startBuild(id: string, override?: RoleConfig): Promise<void> {
    const workstream = this.require(id);
    if (!workstream.workspaceId || !workstream.acceptedPlan) throw new Error("Accept a plan before starting the build");
    const settings = this.db.settings();
    const config = override ?? resolveRoleConfig(settings, workstream.hostId, "builder");
    this.db.updateWorkstream(id, { phase: "building", agentState: "running" });
    this.publish();
    const agent = await this.paseo.createAgent({
      hostId: workstream.hostId,
      workspaceId: workstream.workspaceId,
      config,
      title: `Build · ${workstream.name}`,
      prompt: builderPrompt(workstream, settings.promptTemplates.builder),
      role: "builder",
      workstreamId: id,
    });
    this.db.insertAgent({ workstreamId: id, role: "builder", paseoAgentId: agent.id, provider: config.provider, model: config.model });
    this.db.addAudit(id, "build.started", "Build started", providerLabel(config));
    this.publish();
    void agent.waitForFinish(2 * 60 * 60_000).then((result) => {
      this.db.updateAgentByPaseoId(agent.id, result.status === "idle" ? "idle" : result.status === "error" ? "failed" : "attention", result.lastMessage ?? undefined);
      this.db.updateWorkstream(id, { agentState: result.status === "idle" ? "idle" : result.status === "error" ? "failed" : "attention" });
      this.publish();
    });
  }

  async startReviewFix(id: string): Promise<void> {
    const workstream = this.require(id);
    const builder = this.db.latestAgent(id, "builder");
    if (!builder?.paseoAgentId) throw new Error("Start the build before review and fix");
    this.db.updateWorkstream(id, { phase: "review-fix", agentState: "running" });
    this.db.addAudit(id, "review-fix.started", "Review & Fix started", null);
    this.publish();
    await this.paseo.send(workstream.hostId, builder.paseoAgentId, this.db.settings().promptTemplates.reviewFix);
  }

  async completeReview(id: string): Promise<void> {
    const workstream = this.require(id);
    if (workstream.agentState === "running") throw new Error("Wait for the builder to finish before creating the PR");
    if (!workstream.workspaceId) throw new Error("The Paseo workspace is unavailable");
    await this.paseo.assertWorkspaceReadyForPr(workstream.hostId, workstream.workspaceId, workstream.branchName);
    const remoteSha = await this.github.branchSha(workstream.repositoryFullName, workstream.branchName);
    if (!workstream.baseSha || remoteSha === workstream.baseSha) throw new Error("The GitHub branch has no pushed implementation commits yet");
    const pull = await this.github.findOrCreatePullRequest({
      repositoryFullName: workstream.repositoryFullName,
      branchName: workstream.branchName,
      baseBranch: workstream.baseBranch,
      title: workstream.name,
      body: prBody(workstream),
    });
    this.db.updateWorkstream(id, { phase: "pr-open", prNumber: pull.number, prUrl: pull.url, prChecks: "pending" });
    this.db.addAudit(id, "pr.opened", `Pull request #${pull.number} ready for review`, pull.url);
    this.publish();
    this.notify("success", `Pull request #${pull.number} is ready for review`);
  }

  async startIndependentReview(id: string): Promise<void> {
    const workstream = this.require(id);
    if (!workstream.workspaceId || !workstream.prNumber || !workstream.prUrl) throw new Error("Create the pull request before independent review");
    this.db.updateWorkstream(id, { phase: "independent-review", agentState: "running", reviewIteration: 0 });
    this.db.addAudit(id, "independent-review.started", "Independent review started", workstream.prUrl);
    this.publish();
    void this.runReviewLoop(id).catch((error) => {
      this.db.updateWorkstream(id, { phase: "attention", agentState: "attention" });
      this.db.addAudit(id, "independent-review.failed", "Independent review needs attention", error instanceof Error ? error.message : String(error));
      this.publish();
      this.notify("error", "Independent review needs attention");
    });
  }

  async reconcileGithub(): Promise<void> {
    for (const workstream of this.db.listWorkstreams().filter((item) => item.prNumber !== null)) {
      try {
        const state = await this.github.pullRequestState(workstream.repositoryFullName, workstream.prNumber!);
        this.db.updateWorkstream(workstream.id, {
          prChecks: state.checks,
          ...(state.merged ? { status: "merged" as const, phase: "complete" as const, agentState: "idle" as const } : {}),
        });
        if (state.merged && workstream.status !== "merged") {
          this.db.addAudit(workstream.id, "pr.merged", `Pull request #${workstream.prNumber} merged`, workstream.prUrl);
        }
      } catch {
        // A single inaccessible or rate-limited repository must not block other workstreams.
      }
    }
    this.publish();
  }

  private async runReviewLoop(id: string): Promise<void> {
    let workstream = this.require(id);
    const settings = this.db.settings();
    const reviewerConfig = resolveRoleConfig(settings, workstream.hostId, "reviewer");
    const reviewer = await this.paseo.createAgent({
      hostId: workstream.hostId,
      workspaceId: workstream.workspaceId!,
      config: reviewerConfig,
      title: `Review · ${workstream.name}`,
      prompt: `${settings.promptTemplates.independentReview}\n\nPull request: ${workstream.prUrl}\nCompare ${workstream.branchName} against ${workstream.baseBranch}. Return only the requested structured result.`,
      role: "reviewer",
      workstreamId: id,
      outputSchema: reviewOutputSchema,
    });
    this.db.insertAgent({ workstreamId: id, role: "reviewer", paseoAgentId: reviewer.id, provider: reviewerConfig.provider, model: reviewerConfig.model });
    const builderRun = this.db.latestAgent(id, "builder");
    if (!builderRun?.paseoAgentId) throw new Error("Builder session is unavailable for fixes");
    const builder = this.paseo.agent(workstream.hostId, builderRun.paseoAgentId);

    let reviewResult = await reviewer.waitForFinish(60 * 60_000);
    for (let iteration = 1; iteration <= 3; iteration += 1) {
      if (reviewResult.status !== "idle" || !reviewResult.lastMessage) throw new Error(reviewResult.error ?? `Reviewer stopped with ${reviewResult.status}`);
      const parsed = JSON.parse(reviewResult.lastMessage) as { verdict: "clean" | "findings" | "blocked"; summary: string; findings: ReviewFinding[] };
      this.db.addReview({ workstreamId: id, iteration, verdict: parsed.verdict, findings: parsed.findings, fixSummary: null, tests: null, commitSha: null });
      this.db.updateWorkstream(id, { reviewIteration: iteration });
      this.db.addTimeline(id, { role: "assistant", kind: "finding", content: parsed.summary, agentRole: "reviewer" });
      this.publish();
      if (parsed.verdict === "clean" || parsed.findings.length === 0) {
        this.db.updateWorkstream(id, { phase: "complete", agentState: "idle" });
        this.db.addAudit(id, "independent-review.clean", "Independent review completed cleanly", `Completed in ${iteration} iteration${iteration === 1 ? "" : "s"}.`);
        await this.updateReviewLog(id);
        this.publish();
        this.notify("success", "Independent review is clean — ready to mark reviewed");
        return;
      }
      if (parsed.verdict === "blocked") throw new Error(parsed.summary);
      const fixPrompt = `Fix every actionable finding below, run relevant tests, commit, and push the branch. Report a concise fix and test summary.\n\n${JSON.stringify(parsed.findings, null, 2)}`;
      const fixResult = await builder.run(fixPrompt, { timeoutMs: 2 * 60 * 60_000 });
      if (fixResult.status !== "idle") throw new Error(fixResult.error ?? `Builder stopped with ${fixResult.status}`);
      const commitSha = await this.github.branchSha(workstream.repositoryFullName, workstream.branchName);
      this.db.sqlite.prepare("UPDATE review_iterations SET fix_summary = ?, tests = ?, commit_sha = ? WHERE workstream_id = ? AND iteration = ?")
        .run(fixResult.lastMessage ?? "Fixes applied", fixResult.lastMessage ?? null, commitSha, id, iteration);
      await this.updateReviewLog(id);
      reviewResult = await reviewer.run("Re-review the updated pull request. Report only remaining or newly introduced actionable findings using the same structured format.", { timeoutMs: 60 * 60_000 });
      workstream = this.require(id);
    }
    this.db.updateWorkstream(id, { phase: "attention", agentState: "attention" });
    this.db.addAudit(id, "independent-review.limit", "Review stopped after three iterations", "Manual intervention is required.");
    await this.updateReviewLog(id);
    this.publish();
    this.notify("info", "Review reached the three-iteration limit");
  }

  private async updateReviewLog(id: string): Promise<void> {
    const workstream = this.require(id);
    if (!workstream.prNumber) return;
    const pull = await this.github.getPullRequest(workstream.repositoryFullName, workstream.prNumber);
    const log = workstream.reviews.map((iteration) => {
      const findings = iteration.findings.length
        ? iteration.findings.map((finding) => `- **${finding.severity.toUpperCase()} — ${finding.title}**${finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})` : ""}`).join("\n")
        : "- No actionable findings.";
      return `### Iteration ${iteration.iteration} · ${iteration.verdict}\n\n${findings}\n\n${iteration.fixSummary ? `**Fix summary:** ${iteration.fixSummary}\n\n` : ""}${iteration.commitSha ? `**Commit:** \`${iteration.commitSha}\`` : ""}`;
    }).join("\n\n");
    await this.github.updatePullRequestBody(workstream.repositoryFullName, workstream.prNumber, replaceReviewLog(pull.body, log));
  }

  private require(id: string): Workstream {
    const workstream = this.db.getWorkstream(id);
    if (!workstream) throw new Error("Workstream not found");
    return workstream;
  }
}
