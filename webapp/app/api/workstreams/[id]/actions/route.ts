import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { workstreamStatuses, type RoleConfig, type WorkstreamStatus } from "@agent-lens/domain";
import { Octokit } from "@octokit/rest";
import { getGithubAccessToken } from "@/lib/github";
import { jsonError, readJson } from "@/lib/http";
import { startAgentSynchronization, startAgentWorkflow, startIndependentReview, startPullRequestReconciliation, startWorkstreamWorkflow } from "@/lib/orchestration";
import { withPaseoClient, withPaseoDaemon } from "@/lib/paseo";
import { requireUser } from "@/lib/supabase/server";

type ActionBody = { action: string; prompt?: string; status?: WorkstreamStatus; roleConfig?: RoleConfig; agentId?: string; requestId?: string; answers?: Record<string, string> | null };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<ActionBody>(request);
    const { supabase, user } = await requireUser();
    const { data: workstream, error } = await supabase.from("workstreams").select("*").eq("user_id", user.id).eq("id", id).is("deleted_at", null).single();
    if (error || !workstream) throw error ?? new Error("Workstream not found");
    if (body.action === "retry-provision") {
      if (workstream.workspace_id) throw new Error("This workstream already has a Paseo workspace");
      const { error: retryError } = await supabase.from("workstreams").update({ phase: "provisioning", agent_state: "queued", source_updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
      if (retryError) throw retryError;
      await audit(supabase, user.id, id, "workstream.provisioning.retried", "Provisioning retried", workstream.branch_name);
      await startWorkstreamWorkflow(user.id, id);
    } else if (body.action === "status") {
      if (!body.status || !workstreamStatuses.includes(body.status)) throw new Error("Invalid workstream status");
      if (workstream.status === "merged" && body.status !== "merged") throw new Error("Merged workstreams are terminal");
      await supabase.from("workstreams").update({ status: body.status, source_updated_at: new Date().toISOString() }).eq("id", id);
      if (body.status === "reviewed") await supabase.from("plans").update({ execution_state: "completed", source_updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("workstream_id", id);
      await audit(supabase, user.id, id, "status.changed", `Marked ${body.status}`, `Previous status: ${workstream.status}`);
    } else if (body.action === "followup") {
      if (!body.prompt?.trim()) throw new Error("Enter a follow-up message");
      const { data: run } = await supabase.from("agent_runs").select("*").eq("user_id", user.id).eq("workstream_id", id).not("paseo_agent_id", "is", null).order("created_at", { ascending: false }).limit(1).single();
      if (!run?.paseo_agent_id) throw new Error("There is no agent to follow up with");
      await withPaseoClient(user.id, workstream.host_id, (client) => client.agents.ref(run.paseo_agent_id).send(body.prompt!.trim()));
      await supabase.from("timeline_items").insert({ id: randomUUID(), user_id: user.id, workstream_id: id, role: "user", kind: "message", content: body.prompt.trim(), agent_role: run.role, source_updated_at: new Date().toISOString() });
      await supabase.from("workstreams").update({ agent_state: "running", source_updated_at: new Date().toISOString() }).eq("id", id);
      await startAgentSynchronization(user.id, id, run.paseo_agent_id);
    } else if (body.action === "question") {
      if (!body.agentId || !body.requestId) throw new Error("Question identity is required");
      const { data: question } = await supabase.from("agent_questions").select("*").eq("user_id", user.id).eq("workstream_id", id).eq("agent_id", body.agentId).eq("request_id", body.requestId).single();
      if (!question || question.status !== "pending") throw new Error("This question is no longer waiting for an answer");
      await withPaseoDaemon(user.id, workstream.host_id, (client) => client.respondToPermissionAndWait(body.agentId!, body.requestId!, body.answers ? { behavior: "allow", updatedInput: { questions: question.prompts, answers: body.answers } } : { behavior: "deny", message: "Dismissed by user" }, 15_000));
      await supabase.from("agent_questions").update({ status: body.answers ? "answered" : "dismissed", answers: body.answers ?? null }).eq("id", question.id);
      await supabase.from("timeline_items").update({ content: JSON.stringify({ agentId: body.agentId, requestId: body.requestId, status: body.answers ? "answered" : "dismissed", questions: question.prompts, answers: body.answers }) }).eq("id", `question:${question.id}`);
      await startAgentSynchronization(user.id, id, body.agentId);
    } else if (body.action === "build") {
      if (!workstream.accepted_plan) throw new Error("Mark a plan implementation-ready before starting the build");
      await startAgentWorkflow(user.id, id, "builder", body.roleConfig);
    } else if (body.action === "review-fix") {
      const { data: builder } = await supabase.from("agent_runs").select("paseo_agent_id").eq("user_id", user.id).eq("workstream_id", id).eq("role", "builder").order("created_at", { ascending: false }).limit(1).single();
      if (!builder?.paseo_agent_id) throw new Error("Start the builder before Review & Fix");
      const { data: settings } = await supabase.from("user_settings").select("payload").eq("user_id", user.id).maybeSingle();
      const prompt = settings?.payload?.promptTemplates?.reviewFix ?? "Extensively review and fix every actionable issue. Run tests, commit, and push. Do not create a pull request.";
      await withPaseoClient(user.id, workstream.host_id, (client) => client.agents.ref(builder.paseo_agent_id).send(prompt));
      await supabase.from("workstreams").update({ phase: "review-fix", agent_state: "running", source_updated_at: new Date().toISOString() }).eq("id", id);
      await startAgentSynchronization(user.id, id, builder.paseo_agent_id);
    } else if (body.action === "complete-review") {
      if (workstream.agent_state === "running") throw new Error("Wait for the builder to finish");
      if (!workstream.workspace_id) throw new Error("The Paseo workspace is unavailable");
      await withPaseoClient(user.id, workstream.host_id, async (client) => {
        const descriptor = await client.workspaces.ref(workstream.workspace_id).refresh();
        if (!descriptor || descriptor.gitRuntime?.isDirty !== false) throw new Error("The Paseo workspace must be clean");
        if ((descriptor.gitRuntime?.aheadOfOrigin ?? 0) > 0) throw new Error("Push the branch before creating the pull request");
      });
      const token = await getGithubAccessToken(user.id);
      const octokit = new Octokit({ auth: token, userAgent: "agent-lens-web/0.1" });
      const [owner, repo] = workstream.repository_full_name.split("/");
      const existing = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${workstream.branch_name}`, state: "open", per_page: 1 });
      const pull = existing.data[0] ?? (await octokit.rest.pulls.create({ owner, repo, head: workstream.branch_name, base: workstream.base_branch, title: workstream.name, body: `## Summary\n\n${workstream.brief}\n\n## Accepted plan\n\n${workstream.accepted_plan ?? ""}` })).data;
      await supabase.from("workstreams").update({ phase: "pr-open", status: "unreviewed", pr_number: pull.number, pr_url: pull.html_url, pr_checks: "pending", source_updated_at: new Date().toISOString() }).eq("id", id);
      await audit(supabase, user.id, id, "pr.opened", `Pull request #${pull.number} ready for review`, pull.html_url);
      await startPullRequestReconciliation(user.id, id);
    } else if (body.action === "independent-review") {
      if (!workstream.pr_url) throw new Error("Create the pull request before independent review");
      await startIndependentReview(user.id, id, body.roleConfig);
    } else throw new Error("Unknown workstream action");
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

async function audit(supabase: any, userId: string, workstreamId: string, eventType: string, title: string, detail: string | null) {
  const { error } = await supabase.from("audit_events").insert({ id: randomUUID(), user_id: userId, workstream_id: workstreamId, event_type: eventType, title, detail });
  if (error) throw error;
}
