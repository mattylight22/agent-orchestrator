import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import type { AgentRole, RoleConfig } from "@agent-lens/domain";
import { createSupabaseAdminClient } from "./supabase/admin";
import { PLAN_ACCEPTED_MESSAGE, resolvePlanPermission } from "./plan-permission";
import { independentReviewWorkflow, provisionWorkstreamWorkflow, pullRequestReconciliationWorkflow, runAgentWorkflow, synchronizeExistingAgentWorkflow } from "@/workflows/lifecycle";

export async function startWorkstreamWorkflow(userId: string, workstreamId: string) {
  return startPhase(userId, workstreamId, "provisioning", provisionWorkstreamWorkflow, []);
}

export async function startAgentWorkflow(userId: string, workstreamId: string, role: AgentRole, override?: RoleConfig) {
  return startPhase(userId, workstreamId, role, runAgentWorkflow, [role, override]);
}

export async function startBuilderWorkflow(userId: string, workstreamId: string, override?: RoleConfig) {
  const admin = createSupabaseAdminClient();
  const [{ data: workstream, error: workstreamError }, { data: plan, error: planError }] = await Promise.all([
    admin.from("workstreams").select("host_id,accepted_plan").eq("user_id", userId).eq("id", workstreamId).single(),
    admin.from("plans").select("source_agent_id,source_permission_id").eq("user_id", userId).eq("workstream_id", workstreamId).is("deleted_at", null).maybeSingle(),
  ]);
  if (workstreamError || planError || !workstream) throw workstreamError ?? planError ?? new Error("Workstream not found");
  if (!workstream.accepted_plan) throw new Error("Mark a plan implementation-ready before starting the build");
  const resolved = await resolvePlanPermission({ userId, hostId: workstream.host_id, agentId: plan?.source_agent_id, permissionId: plan?.source_permission_id, message: PLAN_ACCEPTED_MESSAGE });
  if (resolved && plan?.source_agent_id) await startAgentSynchronization(userId, workstreamId, plan.source_agent_id);
  const now = new Date().toISOString();
  const { error: phaseError } = await admin.from("workstreams").update({ phase: "building", agent_state: "queued", source_updated_at: now }).eq("user_id", userId).eq("id", workstreamId);
  if (phaseError) throw phaseError;
  try {
    return await startAgentWorkflow(userId, workstreamId, "builder", override);
  } catch (error) {
    await admin.from("workstreams").update({ phase: "ready", agent_state: "idle", source_updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", workstreamId);
    throw error;
  }
}

export async function startAgentSynchronization(userId: string, workstreamId: string, agentId: string) {
  return startPhase(userId, workstreamId, `sync:${agentId}`, synchronizeExistingAgentWorkflow, [agentId]);
}

export async function startIndependentReview(userId: string, workstreamId: string, override?: RoleConfig) {
  return startPhase(userId, workstreamId, "independent-review", independentReviewWorkflow, [override]);
}

export async function startPullRequestReconciliation(userId: string, workstreamId: string) {
  return startPhase(userId, workstreamId, "github-reconciliation", pullRequestReconciliationWorkflow, []);
}

async function startPhase(userId: string, workstreamId: string, phase: string, workflow: (...args: any[]) => Promise<any>, extra: unknown[]) {
  const admin = createSupabaseAdminClient();
  const { data: active } = await admin.from("workflow_runs").select("id,workflow_run_id,state").eq("user_id", userId).eq("workstream_id", workstreamId).eq("phase", phase).in("state", ["queued", "running", "waiting"]).maybeSingle();
  if (active) return active;
  const runId = randomUUID();
  const { error } = await admin.from("workflow_runs").insert({ id: runId, user_id: userId, workstream_id: workstreamId, phase, state: "queued" });
  if (error) throw error;
  try {
    const run = await start(workflow, [userId, workstreamId, runId, ...extra] as any[]);
    await admin.from("workflow_runs").update({ workflow_run_id: run.runId }).eq("id", runId);
    return { id: runId, workflow_run_id: run.runId, state: "queued" };
  } catch (error) {
    await admin.from("workflow_runs").update({ state: "failed", error: error instanceof Error ? error.message : String(error), finished_at: new Date().toISOString() }).eq("id", runId);
    throw error;
  }
}
