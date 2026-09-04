import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { planRevisionPrompt, planStatuses, wouldCreatePlanDependencyCycle, type PlanStatus } from "@agent-lens/domain";
import { jsonError, readJson } from "@/lib/http";
import { startAgentSynchronization, startAgentWorkflow } from "@/lib/orchestration";
import { withPaseoDaemon } from "@/lib/paseo";
import { requireUser } from "@/lib/supabase/server";

type ActionBody = { action: string; status?: PlanStatus; dependencyIds?: string[]; quote?: string; comment?: string; startOffset?: number; endOffset?: number; commentId?: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<ActionBody>(request);
    const { supabase, user } = await requireUser();
    const { data: plan, error } = await supabase.from("plans").select("*, workstreams!inner(*)").eq("user_id", user.id).eq("id", id).is("deleted_at", null).single();
    if (error || !plan) throw error ?? new Error("Plan not found");
    const workstream = plan.workstreams as Record<string, any>;
    if (body.action === "status") {
      if (!body.status || !planStatuses.includes(body.status)) throw new Error("Invalid plan status");
      if (["in-progress", "completed"].includes(plan.execution_state) && body.status === "cancelled") throw new Error("An active or completed plan cannot be cancelled");
      await supabase.from("plans").update({ status: body.status, execution_state: body.status === "cancelled" ? "cancelled" : plan.execution_state, source_updated_at: new Date().toISOString() }).eq("id", id);
      if (body.status === "implementation-ready") {
        await supabase.from("workstreams").update({ accepted_plan: plan.body, status: "ready-to-build", phase: "ready", agent_state: "idle", source_updated_at: new Date().toISOString() }).eq("id", plan.workstream_id);
      } else if (body.status === "cancelled") {
        await supabase.from("workstreams").update({ accepted_plan: null, status: "draft", agent_state: "idle", source_updated_at: new Date().toISOString() }).eq("id", plan.workstream_id);
      }
      await resolvePlanPermission(user.id, workstream, plan, body.status === "implementation-ready" ? "Plan captured and marked implementation-ready in Agent Lens. A separate builder agent will implement it." : body.status === "cancelled" ? "Plan captured and cancelled in Agent Lens. Do not implement it." : null);
      await audit(supabase, user.id, plan.workstream_id, "plan.status.changed", `Plan marked ${body.status}`, `Previous status: ${plan.status}`);
    } else if (body.action === "dependencies") {
      const dependencyIds = [...new Set(body.dependencyIds ?? [])].filter((dependencyId) => dependencyId !== id);
      const { data: planRows } = await supabase.from("plans").select("id").eq("user_id", user.id).is("deleted_at", null);
      const { data: dependencyRows } = await supabase.from("plan_dependencies").select("plan_id,depends_on_plan_id").eq("user_id", user.id);
      const plans = (planRows ?? []).map((item) => ({ id: item.id, dependencyIds: (dependencyRows ?? []).filter((dependency) => dependency.plan_id === item.id).map((dependency) => dependency.depends_on_plan_id) }));
      if (wouldCreatePlanDependencyCycle(plans, id, dependencyIds)) throw new Error("That dependency would create a cycle");
      await supabase.from("plan_dependencies").delete().eq("user_id", user.id).eq("plan_id", id);
      if (dependencyIds.length) {
        const { error: dependencyError } = await supabase.from("plan_dependencies").insert(dependencyIds.map((dependencyId) => ({ user_id: user.id, plan_id: id, depends_on_plan_id: dependencyId })));
        if (dependencyError) throw dependencyError;
      }
    } else if (body.action === "add-comment") {
      if (!body.quote?.trim() || !body.comment?.trim() || body.startOffset == null || body.endOffset == null || body.endOffset <= body.startOffset) throw new Error("Select plan text and enter a revision comment");
      const { error: commentError } = await supabase.from("plan_comments").insert({ id: randomUUID(), user_id: user.id, plan_id: id, quote: body.quote.trim(), comment: body.comment.trim(), start_offset: body.startOffset, end_offset: body.endOffset, source_updated_at: new Date().toISOString() });
      if (commentError) throw commentError;
    } else if (body.action === "delete-comment") {
      if (!body.commentId) throw new Error("Comment identity is required");
      await supabase.from("plan_comments").update({ deleted_at: new Date().toISOString(), source_updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("plan_id", id).eq("id", body.commentId);
    } else if (body.action === "submit-comments") {
      const { data: comments } = await supabase.from("plan_comments").select("*").eq("user_id", user.id).eq("plan_id", id).is("deleted_at", null).order("created_at");
      if (!comments?.length) throw new Error("Add at least one revision comment");
      const feedback = planRevisionPrompt(comments.map((item) => ({ quote: item.quote, comment: item.comment })));
      const resolved = await resolvePlanPermission(user.id, workstream, plan, feedback);
      if (!resolved) throw new Error("The planner is no longer waiting on this plan; send the revision as a follow-up instead");
      await supabase.from("plan_comments").update({ deleted_at: new Date().toISOString(), source_updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("plan_id", id).is("deleted_at", null);
      await supabase.from("workstreams").update({ agent_state: "running", source_updated_at: new Date().toISOString() }).eq("id", plan.workstream_id);
      await audit(supabase, user.id, plan.workstream_id, "plan.revision.requested", "Plan revision requested", feedback);
      if (plan.source_agent_id) await startAgentSynchronization(user.id, plan.workstream_id, plan.source_agent_id);
    } else if (body.action === "begin") {
      const { data: blockers } = await supabase.from("plan_dependencies").select("depends_on_plan_id, plans!plan_dependencies_depends_on_plan_id_fkey(execution_state)").eq("user_id", user.id).eq("plan_id", id);
      if ((blockers ?? []).some((item: any) => item.plans?.execution_state !== "completed")) throw new Error("Complete every prerequisite plan first");
      await supabase.from("plans").update({ status: "implementation-ready", execution_state: "in-progress", source_updated_at: new Date().toISOString() }).eq("id", id);
      await supabase.from("workstreams").update({ accepted_plan: plan.body, status: "ready-to-build", phase: "ready", source_updated_at: new Date().toISOString() }).eq("id", plan.workstream_id);
      await startAgentWorkflow(user.id, plan.workstream_id, "builder");
    } else throw new Error("Unknown plan action");
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

async function resolvePlanPermission(userId: string, workstream: Record<string, any>, plan: Record<string, any>, message: string | null) {
  if (!message || !plan.source_agent_id || !plan.source_permission_id) return false;
  return withPaseoDaemon(userId, workstream.host_id, async (client) => {
    const current = await client.fetchAgent(plan.source_agent_id);
    if (!current?.agent.pendingPermissions.some((permission: any) => permission.id === plan.source_permission_id && permission.kind === "plan")) return false;
    await client.respondToPermissionAndWait(plan.source_agent_id, plan.source_permission_id, { behavior: "deny", message }, 15_000);
    return true;
  });
}

async function audit(supabase: any, userId: string, workstreamId: string, eventType: string, title: string, detail: string | null) {
  const { error } = await supabase.from("audit_events").insert({ id: randomUUID(), user_id: userId, workstream_id: workstreamId, event_type: eventType, title, detail });
  if (error) throw error;
}
