import { sleep } from "workflow";
import { randomUUID } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { defaultAppSettings, replaceReviewLog, resolveRoleConfig, type AgentRole, type ReviewFinding, type RoleConfig } from "@agent-lens/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getGithubAccessToken } from "@/lib/github";
import { ensureHostRepositoryMapping, providerCatalog, waitForProviderSnapshot, withPaseoClient } from "@/lib/paseo";

type Row = Record<string, any>;

async function setWorkflowState(runId: string, state: string, error?: string) {
  "use step";
  await createSupabaseAdminClient().from("workflow_runs").update({ state, error: error ?? null, ...(state === "running" ? { started_at: new Date().toISOString() } : {}), ...(["complete", "failed", "cancelled"].includes(state) ? { finished_at: new Date().toISOString() } : {}) }).eq("id", runId);
}

async function loadWorkstream(userId: string, workstreamId: string): Promise<{ workstream: Row; repository: Row; settings: any }> {
  const admin = createSupabaseAdminClient();
  const [{ data: workstream, error: wsError }, { data: settings }] = await Promise.all([
    admin.from("workstreams").select("*").eq("user_id", userId).eq("id", workstreamId).single(),
    admin.from("user_settings").select("payload").eq("user_id", userId).maybeSingle(),
  ]);
  if (wsError || !workstream) throw wsError ?? new Error("Workstream not found");
  const { data: repository, error: repoError } = await admin.from("repositories").select("*").eq("user_id", userId).eq("id", workstream.repository_id).single();
  if (wsError || repoError || !workstream || !repository) throw wsError ?? repoError ?? new Error("Workstream not found");
  return { workstream, repository, settings: { ...defaultAppSettings, ...(settings?.payload ?? {}), globalRoles: { ...defaultAppSettings.globalRoles, ...(settings?.payload?.globalRoles ?? {}) }, promptTemplates: { ...defaultAppSettings.promptTemplates, ...(settings?.payload?.promptTemplates ?? {}) } } };
}

async function checkpoint(userId: string, workstreamId: string, name: string, operation: () => Promise<string | null>) {
  const admin = createSupabaseAdminClient();
  const id = `${workstreamId}:${name}`;
  const { data } = await admin.from("provisioning_checkpoints").select("state,detail,attempt").eq("id", id).maybeSingle();
  if (data?.state === "complete") return data.detail as string | null;
  await admin.from("provisioning_checkpoints").upsert({ id, user_id: userId, workstream_id: workstreamId, checkpoint: name, state: "running", attempt: (data?.attempt ?? 0) + 1 });
  try {
    const detail = await operation();
    const { error } = await admin.from("provisioning_checkpoints").update({ state: "complete", detail }).eq("id", id);
    if (error) throw error;
    return detail;
  } catch (error) {
    await admin.from("provisioning_checkpoints").update({ state: "failed", detail: error instanceof Error ? error.message : String(error) }).eq("id", id);
    throw error;
  }
}

async function createGithubBranch(userId: string, workstreamId: string) {
  "use step";
  const { workstream } = await loadWorkstream(userId, workstreamId);
  return checkpoint(userId, workstreamId, "github-branch", async () => {
    const token = await getGithubAccessToken(userId);
    const octokit = new Octokit({ auth: token, userAgent: "agent-lens-web/0.1" });
    const [owner, repo] = workstream.repository_full_name.split("/");
    const base = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${workstream.base_branch}` });
    const baseSha = base.data.object.sha;
    if (!workstream.base_sha) {
      try {
        await octokit.rest.git.getRef({ owner, repo, ref: `heads/${workstream.branch_name}` });
        throw new Error(`Branch ${workstream.branch_name} already exists and is not owned by this workstream`);
      } catch (error: any) {
        if (error?.status !== 404) throw error;
      }
      await createSupabaseAdminClient().from("workstreams").update({ base_sha: baseSha, source_updated_at: new Date().toISOString() }).eq("id", workstreamId).eq("user_id", userId);
    }
    try {
      await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${workstream.branch_name}`, sha: baseSha });
    } catch (error: any) {
      if (error?.status !== 422) throw error;
      const existing = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${workstream.branch_name}` });
      if ((workstream.base_sha ?? baseSha) !== existing.data.object.sha) throw new Error(`Branch ${workstream.branch_name} already exists and is not owned by this workstream`);
    }
    await createSupabaseAdminClient().from("workstreams").update({ base_sha: baseSha, source_updated_at: new Date().toISOString() }).eq("id", workstreamId).eq("user_id", userId);
    return baseSha;
  });
}

async function createPaseoWorkspace(userId: string, workstreamId: string) {
  "use step";
  const { workstream, repository } = await loadWorkstream(userId, workstreamId);
  return checkpoint(userId, workstreamId, "paseo-workspace", async () => {
    if (workstream.workspace_id) return workstream.workspace_id;
    const mapping = await ensureHostRepositoryMapping(userId, workstream.host_id, repository.id, repository.full_name);
    const workspaceId = await withPaseoClient(userId, workstream.host_id, async (client) => {
      const workspace = await client.workspaces.create({
        title: workstream.name,
        source: { kind: "worktree", cwd: mapping.project_root_path, projectId: mapping.project_id, action: "checkout", refName: workstream.branch_name, worktreeSlug: workstream.branch_name.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-|-$/g, "") },
      });
      return workspace.id;
    });
    await createSupabaseAdminClient().from("workstreams").update({ workspace_id: workspaceId, phase: "planning", agent_state: "queued", source_updated_at: new Date().toISOString() }).eq("id", workstreamId).eq("user_id", userId);
    return workspaceId;
  });
}

function rolePrompt(role: AgentRole, workstream: Row, settings: any): string {
  if (role === "planner") return `${settings.promptTemplates.planner}\n\n# Workstream context\n\n- Product: Agent God Mode\n- Repository: ${workstream.repository_full_name}\n- Base branch: ${workstream.base_branch}\n- Work branch: ${workstream.branch_name}\n\n# Brief\n\n${workstream.brief}`;
  if (role === "builder") return `${settings.promptTemplates.builder}\n\n# Original brief\n\n${workstream.brief}\n\n# Accepted plan\n\n${workstream.accepted_plan}`;
  return `${settings.promptTemplates.independentReview}\n\nPull request: ${workstream.pr_url}\nCompare ${workstream.branch_name} against ${workstream.base_branch}.`;
}

async function launchAgent(userId: string, workstreamId: string, role: AgentRole, override?: RoleConfig): Promise<string> {
  "use step";
  const { workstream, settings } = await loadWorkstream(userId, workstreamId);
  if (!workstream.workspace_id) throw new Error("Paseo workspace has not been created");
  const existing = await createSupabaseAdminClient().from("agent_runs").select("paseo_agent_id").eq("user_id", userId).eq("workstream_id", workstreamId).eq("role", role).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.data?.paseo_agent_id && role === "planner") return existing.data.paseo_agent_id;
  const config = override ?? resolveRoleConfig(settings, workstream.host_id, role);
  const agentId = await withPaseoClient(userId, workstream.host_id, async (client) => {
    const snapshot = await waitForProviderSnapshot(client);
    const available = providerCatalog(snapshot).find((item) => item.provider === config.provider && item.model === config.model && item.status === "ready");
    if (!available) throw new Error(`${config.provider}/${config.model} is not available on the selected Paseo host`);
    const workspace = client.workspaces.ref(workstream.workspace_id);
    const agent = await workspace.agents.create({
      config: {
        provider: `${config.provider}/${config.model}`,
        ...(config.modeId ? { modeId: config.modeId } : {}),
        ...(config.thinkingOptionId && available.thinkingOptions.some((item) => item.id === config.thinkingOptionId) ? { thinkingOptionId: config.thinkingOptionId } : {}),
        ...(config.featureValues ? { featureValues: config.featureValues } : {}),
        ...(role === "reviewer" && config.provider === "codex" ? { options: { approval_policy: "never", sandbox_mode: "read-only", web_search: "disabled" } } : {}),
      },
      title: `${role === "planner" ? "Plan" : role === "builder" ? "Build" : "Review"} · ${workstream.name}`,
      prompt: rolePrompt(role, workstream, settings), labels: { app: "agent-lens", workstream: workstreamId, role },
      ...(role === "reviewer" ? { outputSchema: { type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"], properties: { verdict: { enum: ["clean", "findings", "blocked"] }, summary: { type: "string" }, findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["severity", "title", "explanation", "recommendation"], properties: { severity: { enum: ["critical", "high", "medium", "low"] }, title: { type: "string" }, file: { type: "string" }, line: { type: "number" }, explanation: { type: "string" }, recommendation: { type: "string" } } } } } } } : {}),
    });
    return agent.id;
  });
  const now = new Date().toISOString();
  const runId = randomUUID();
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("agent_runs").insert({ id: runId, user_id: userId, workstream_id: workstreamId, role, paseo_agent_id: agentId, provider: config.provider, model: config.model, state: "running", created_at: now, source_updated_at: now });
  if (error) throw error;
  await admin.from("workstreams").update({ phase: role === "planner" ? "planning" : role === "builder" ? "building" : "independent-review", agent_state: "running", source_updated_at: now }).eq("id", workstreamId).eq("user_id", userId);
  await admin.from("audit_events").insert({ id: randomUUID(), user_id: userId, workstream_id: workstreamId, event_type: `${role}.started`, title: `${role[0].toUpperCase()}${role.slice(1)} started`, detail: `${config.provider}/${config.model}` });
  return agentId;
}

function titleFromPlan(body: string) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Implementation plan";
}

async function synchronizeAgent(userId: string, workstreamId: string, agentId: string): Promise<{ terminal: boolean; attention: boolean }> {
  "use step";
  const admin = createSupabaseAdminClient();
  const [{ data: workstream, error }, { data: run }] = await Promise.all([
    admin.from("workstreams").select("host_id").eq("user_id", userId).eq("id", workstreamId).single(),
    admin.from("agent_runs").select("role").eq("user_id", userId).eq("paseo_agent_id", agentId).maybeSingle(),
  ]);
  if (error || !workstream) throw error ?? new Error("Workstream not found");
  const sync = await withPaseoClient(userId, workstream.host_id, async (client) => {
    const agent = client.agents.ref(agentId);
    const page = await agent.timeline.refetch({ limit: 500, projection: "projected" });
    return { page, agent: page.agent ?? agent.current() };
  });
  const messages = (sync.page.entries as any[]).flatMap((entry) => {
    const item = entry.item;
    if (!["assistant_message", "user_message", "reasoning", "error"].includes(item.type)) return [];
    const content = item.type === "error" ? item.message : item.text;
    if (!content) return [];
    return [{ id: `${agentId}:${"messageId" in item ? item.messageId : `${sync.page.epoch ?? "timeline"}:${entry.seqStart}-${entry.seqEnd}:${item.type}`}`, user_id: userId, workstream_id: workstreamId, role: item.type === "assistant_message" ? "assistant" : item.type === "user_message" ? "user" : "system", kind: "message", content, agent_role: run?.role ?? null, source_updated_at: entry.timestamp, created_at: entry.timestamp }];
  });
  if (messages.length) {
    const { error: timelineError } = await admin.from("timeline_items").upsert(messages, { onConflict: "user_id,id" });
    if (timelineError) throw timelineError;
  }
  const permissions = (sync.agent?.pendingPermissions ?? []) as any[];
  for (const permission of permissions) {
    if (permission.kind === "plan" && typeof permission.input?.plan === "string" && permission.input.plan.trim()) {
      const planId = `plan:${workstreamId}`;
      const now = new Date().toISOString();
      const { error: planError } = await admin.from("plans").upsert({ id: planId, user_id: userId, workstream_id: workstreamId, title: titleFromPlan(permission.input.plan), body: permission.input.plan, status: "product-feature", source_agent_id: agentId, source_permission_id: permission.id, source_updated_at: now, deleted_at: null }, { onConflict: "user_id,workstream_id" });
      if (planError) throw planError;
    }
    if (permission.kind === "question" && Array.isArray(permission.input?.questions)) {
      const id = `${agentId}:${permission.id}`;
      await admin.from("agent_questions").upsert({ id, user_id: userId, workstream_id: workstreamId, agent_id: agentId, request_id: permission.id, status: "pending", prompts: permission.input.questions }, { onConflict: "user_id,agent_id,request_id" });
      await admin.from("timeline_items").upsert({ id: `question:${id}`, user_id: userId, workstream_id: workstreamId, role: "system", kind: "question", content: JSON.stringify({ agentId, requestId: permission.id, status: "pending", questions: permission.input.questions }), source_updated_at: new Date().toISOString(), created_at: new Date().toISOString() }, { onConflict: "user_id,id" });
    }
  }
  const attention = permissions.some((item) => item.kind === "plan" || item.kind === "question");
  const status = String(sync.agent?.status ?? "running");
  const terminal = ["idle", "done", "error", "failed", "stopped"].includes(status) || attention;
  const state = attention ? "attention" : ["error", "failed"].includes(status) ? "failed" : terminal ? "idle" : "running";
  await admin.from("agent_runs").update({ state, source_updated_at: new Date().toISOString() }).eq("user_id", userId).eq("paseo_agent_id", agentId);
  await admin.from("workstreams").update({ agent_state: state, source_updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", workstreamId);
  return { terminal, attention };
}

async function failWorkstream(userId: string, workstreamId: string, runId: string, error: unknown) {
  "use step";
  const message = error instanceof Error ? error.message : String(error);
  const admin = createSupabaseAdminClient();
  await admin.from("workstreams").update({ phase: "attention", agent_state: "failed", source_updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", workstreamId);
  await admin.from("audit_events").insert({ id: randomUUID(), user_id: userId, workstream_id: workstreamId, event_type: "workflow.failed", title: "Workflow needs attention", detail: message });
  await admin.from("workflow_runs").update({ state: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", runId);
}

export async function provisionWorkstreamWorkflow(userId: string, workstreamId: string, runId: string) {
  "use workflow";
  try {
    await setWorkflowState(runId, "running");
    await createGithubBranch(userId, workstreamId);
    await createPaseoWorkspace(userId, workstreamId);
    const agentId = await launchAgent(userId, workstreamId, "planner");
    for (;;) {
      const result = await synchronizeAgent(userId, workstreamId, agentId);
      if (result.terminal) break;
      await sleep("15s");
    }
    await setWorkflowState(runId, "complete");
  } catch (error) {
    await failWorkstream(userId, workstreamId, runId, error);
    throw error;
  }
}

export async function runAgentWorkflow(userId: string, workstreamId: string, runId: string, role: AgentRole, override?: RoleConfig) {
  "use workflow";
  try {
    await setWorkflowState(runId, "running");
    const agentId = await launchAgent(userId, workstreamId, role, override);
    for (;;) {
      const result = await synchronizeAgent(userId, workstreamId, agentId);
      if (result.terminal) break;
      await sleep("15s");
    }
    await setWorkflowState(runId, "complete");
  } catch (error) {
    await failWorkstream(userId, workstreamId, runId, error);
    throw error;
  }
}

export async function synchronizeExistingAgentWorkflow(userId: string, workstreamId: string, runId: string, agentId: string) {
  "use workflow";
  try {
    await setWorkflowState(runId, "running");
    for (;;) {
      const result = await synchronizeAgent(userId, workstreamId, agentId);
      if (result.terminal) break;
      await sleep("15s");
    }
    await setWorkflowState(runId, "complete");
  } catch (error) {
    await failWorkstream(userId, workstreamId, runId, error);
    throw error;
  }
}

async function latestAgent(userId: string, workstreamId: string, role: AgentRole) {
  "use step";
  const { data, error } = await createSupabaseAdminClient().from("agent_runs").select("paseo_agent_id").eq("user_id", userId).eq("workstream_id", workstreamId).eq("role", role).not("paseo_agent_id", "is", null).order("created_at", { ascending: false }).limit(1).single();
  if (error || !data?.paseo_agent_id) throw new Error(`${role} session is unavailable`);
  return data.paseo_agent_id as string;
}

async function sendAgentMessage(userId: string, workstreamId: string, agentId: string, prompt: string) {
  "use step";
  const { data: workstream, error } = await createSupabaseAdminClient().from("workstreams").select("host_id").eq("user_id", userId).eq("id", workstreamId).single();
  if (error || !workstream) throw error ?? new Error("Workstream not found");
  await withPaseoClient(userId, workstream.host_id, (client) => client.agents.ref(agentId).send(prompt));
}

async function readReviewerResult(userId: string, workstreamId: string, agentId: string): Promise<{ verdict: "clean" | "findings" | "blocked"; summary: string; findings: ReviewFinding[] }> {
  "use step";
  const { data, error } = await createSupabaseAdminClient().from("timeline_items").select("content").eq("user_id", userId).eq("workstream_id", workstreamId).eq("role", "assistant").like("id", `${agentId}:%`).order("created_at", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error("The reviewer did not return a result");
  const raw = data.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(raw) as { verdict: "clean" | "findings" | "blocked"; summary: string; findings: ReviewFinding[] };
  if (!value.verdict || !Array.isArray(value.findings)) throw new Error("The reviewer returned an invalid structured result");
  return value;
}

async function recordReviewIteration(userId: string, workstreamId: string, iteration: number, result: { verdict: string; summary: string; findings: ReviewFinding[] }) {
  "use step";
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("review_iterations").upsert({ id: `${workstreamId}:${iteration}`, user_id: userId, workstream_id: workstreamId, iteration, verdict: result.verdict, findings: result.findings }, { onConflict: "user_id,workstream_id,iteration" });
  if (error) throw error;
  await admin.from("timeline_items").upsert({ id: `review:${workstreamId}:${iteration}`, user_id: userId, workstream_id: workstreamId, role: "assistant", kind: "finding", content: result.summary, agent_role: "reviewer", source_updated_at: new Date().toISOString(), created_at: new Date().toISOString() }, { onConflict: "user_id,id" });
  await admin.from("workstreams").update({ review_iteration: iteration, source_updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", workstreamId);
}

async function captureFixAndUpdatePr(userId: string, workstreamId: string, iteration: number) {
  "use step";
  const admin = createSupabaseAdminClient();
  const [{ data: workstream, error }, { data: fixMessage }] = await Promise.all([
    admin.from("workstreams").select("*").eq("user_id", userId).eq("id", workstreamId).single(),
    admin.from("timeline_items").select("content").eq("user_id", userId).eq("workstream_id", workstreamId).eq("role", "assistant").eq("agent_role", "builder").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || !workstream?.pr_number) throw error ?? new Error("Pull request is unavailable");
  const token = await getGithubAccessToken(userId);
  const octokit = new Octokit({ auth: token, userAgent: "agent-lens-web/0.1" });
  const [owner, repo] = workstream.repository_full_name.split("/");
  const branch = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${workstream.branch_name}` });
  await admin.from("review_iterations").update({ fix_summary: fixMessage?.content ?? "Fixes applied", tests: fixMessage?.content ?? null, commit_sha: branch.data.object.sha }).eq("workstream_id", workstreamId).eq("iteration", iteration);
  await updatePrReviewLog(admin, userId, workstream, octokit, owner, repo);
}

async function updatePrReviewLog(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, workstream: Row, octokit: Octokit, owner: string, repo: string) {
  const { data: allIterations } = await admin.from("review_iterations").select("*").eq("user_id", userId).eq("workstream_id", workstream.id).order("iteration");
  const log = (allIterations ?? []).map((item) => `### Iteration ${item.iteration} — ${item.verdict}\n\n${(item.findings ?? []).length ? (item.findings as ReviewFinding[]).map((finding) => `- **${finding.severity}: ${finding.title}**${finding.file ? ` — \`${finding.file}${finding.line ? `:${finding.line}` : ""}\`` : ""}`).join("\n") : "No actionable findings."}\n\n${item.fix_summary ? `**Fixes and tests:** ${item.fix_summary}\n\n` : ""}${item.commit_sha ? `**Commit:** \`${item.commit_sha}\`` : ""}`).join("\n\n");
  const pull = await octokit.rest.pulls.get({ owner, repo, pull_number: workstream.pr_number });
  await octokit.rest.pulls.update({ owner, repo, pull_number: workstream.pr_number, body: replaceReviewLog(pull.data.body ?? "", log) });
}

async function completeIndependentReview(userId: string, workstreamId: string, clean: boolean, detail: string) {
  "use step";
  const admin = createSupabaseAdminClient();
  await admin.from("workstreams").update({ phase: clean ? "complete" : "attention", agent_state: clean ? "idle" : "attention", source_updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", workstreamId);
  await admin.from("audit_events").insert({ id: randomUUID(), user_id: userId, workstream_id: workstreamId, event_type: clean ? "independent-review.clean" : "independent-review.limit", title: clean ? "Independent review completed cleanly" : "Independent review needs attention", detail });
  const { data: workstream } = await admin.from("workstreams").select("*").eq("user_id", userId).eq("id", workstreamId).single();
  if (workstream?.pr_number) {
    const token = await getGithubAccessToken(userId);
    const octokit = new Octokit({ auth: token, userAgent: "agent-lens-web/0.1" });
    const [owner, repo] = workstream.repository_full_name.split("/");
    await updatePrReviewLog(admin, userId, workstream, octokit, owner, repo);
  }
}

export async function independentReviewWorkflow(userId: string, workstreamId: string, runId: string, override?: RoleConfig) {
  "use workflow";
  try {
    await setWorkflowState(runId, "running");
    const reviewerId = await launchAgent(userId, workstreamId, "reviewer", override);
    const builderId = await latestAgent(userId, workstreamId, "builder");
    for (let iteration = 1; iteration <= 3; iteration += 1) {
      for (;;) { const state = await synchronizeAgent(userId, workstreamId, reviewerId); if (state.terminal) break; await sleep("15s"); }
      const result = await readReviewerResult(userId, workstreamId, reviewerId);
      await recordReviewIteration(userId, workstreamId, iteration, result);
      if (result.verdict === "clean" || !result.findings.length) {
        await completeIndependentReview(userId, workstreamId, true, `Completed in ${iteration} iteration${iteration === 1 ? "" : "s"}.`);
        await setWorkflowState(runId, "complete"); return;
      }
      if (result.verdict === "blocked") {
        await completeIndependentReview(userId, workstreamId, false, result.summary);
        await setWorkflowState(runId, "complete"); return;
      }
      await sendAgentMessage(userId, workstreamId, builderId, `Fix every actionable finding below, run relevant tests, commit, and push the branch. Report a concise fix and test summary.\n\n${JSON.stringify(result.findings, null, 2)}`);
      for (;;) { const state = await synchronizeAgent(userId, workstreamId, builderId); if (state.terminal) break; await sleep("15s"); }
      await captureFixAndUpdatePr(userId, workstreamId, iteration);
      if (iteration < 3) await sendAgentMessage(userId, workstreamId, reviewerId, "Re-review the updated pull request. Return only the same structured result with remaining or newly introduced actionable findings.");
    }
    await completeIndependentReview(userId, workstreamId, false, "Stopped after three iterations; manual intervention is required.");
    await setWorkflowState(runId, "complete");
  } catch (error) {
    await failWorkstream(userId, workstreamId, runId, error); throw error;
  }
}

async function reconcilePullRequest(userId: string, workstreamId: string): Promise<"open" | "merged" | "closed"> {
  "use step";
  const admin = createSupabaseAdminClient();
  const { data: workstream, error } = await admin.from("workstreams").select("*").eq("user_id", userId).eq("id", workstreamId).single();
  if (error || !workstream?.pr_number) throw error ?? new Error("Pull request is unavailable");
  const token = await getGithubAccessToken(userId);
  const octokit = new Octokit({ auth: token, userAgent: "agent-lens-web/0.1" });
  const [owner, repo] = workstream.repository_full_name.split("/");
  const pull = await octokit.rest.pulls.get({ owner, repo, pull_number: workstream.pr_number });
  const checks = await octokit.rest.checks.listForRef({ owner, repo, ref: pull.data.head.sha, per_page: 100 });
  const checkState = checks.data.total_count === 0 ? "none" : checks.data.check_runs.some((check) => check.conclusion && !["success", "neutral", "skipped"].includes(check.conclusion)) ? "failure" : checks.data.check_runs.every((check) => check.status === "completed") ? "success" : "pending";
  if (pull.data.merged) {
    await admin.from("workstreams").update({ status: "merged", phase: "complete", agent_state: "idle", pr_checks: checkState, source_updated_at: new Date().toISOString() }).eq("id", workstreamId).eq("user_id", userId);
    await admin.from("plans").update({ execution_state: "completed", source_updated_at: new Date().toISOString() }).eq("workstream_id", workstreamId).eq("user_id", userId);
    await admin.from("audit_events").upsert({ id: `merged:${workstreamId}`, user_id: userId, workstream_id: workstreamId, event_type: "pr.merged", title: `Pull request #${workstream.pr_number} merged`, detail: workstream.pr_url }, { onConflict: "user_id,id" });
    return "merged";
  }
  await admin.from("workstreams").update({ pr_checks: checkState, source_updated_at: new Date().toISOString() }).eq("id", workstreamId).eq("user_id", userId);
  return pull.data.state === "closed" ? "closed" : "open";
}

export async function pullRequestReconciliationWorkflow(userId: string, workstreamId: string, runId: string) {
  "use workflow";
  try {
    await setWorkflowState(runId, "running");
    for (;;) {
      const state = await reconcilePullRequest(userId, workstreamId);
      if (state !== "open") break;
      await sleep("1m");
    }
    await setWorkflowState(runId, "complete");
  } catch (error) {
    await failWorkstream(userId, workstreamId, runId, error); throw error;
  }
}
