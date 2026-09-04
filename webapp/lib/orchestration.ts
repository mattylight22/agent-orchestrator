import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import type { AgentRole, RoleConfig } from "@agent-lens/domain";
import { createSupabaseAdminClient } from "./supabase/admin";
import { independentReviewWorkflow, provisionWorkstreamWorkflow, pullRequestReconciliationWorkflow, runAgentWorkflow, synchronizeExistingAgentWorkflow } from "@/workflows/lifecycle";

export async function startWorkstreamWorkflow(userId: string, workstreamId: string) {
  return startPhase(userId, workstreamId, "provisioning", provisionWorkstreamWorkflow, []);
}

export async function startAgentWorkflow(userId: string, workstreamId: string, role: AgentRole, override?: RoleConfig) {
  return startPhase(userId, workstreamId, role, runAgentWorkflow, [role, override]);
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
