import "server-only";

import { start } from "workflow/api";
import { createSupabaseAdminClient } from "./supabase/admin";
import { deleteAwsPaseoWorkflow, provisionAwsPaseoWorkflow } from "@/workflows/aws-provisioning";

export async function startAwsProvisioning(userId: string, deploymentId: string) {
  try {
    const run = await start(provisionAwsPaseoWorkflow, [userId, deploymentId]);
    await createSupabaseAdminClient().from("aws_paseo_deployments").update({ workflow_run_id: run.runId }).eq("user_id", userId).eq("id", deploymentId);
    return run.runId;
  } catch (error) {
    await createSupabaseAdminClient().from("aws_paseo_deployments").update({ state: "failed", failure_detail: error instanceof Error ? error.message.slice(0, 1000) : "Could not start AWS provisioning" }).eq("user_id", userId).eq("id", deploymentId);
    throw error;
  }
}

export async function startAwsDeletion(userId: string, deploymentId: string) {
  try {
    const run = await start(deleteAwsPaseoWorkflow, [userId, deploymentId]);
    await createSupabaseAdminClient().from("aws_paseo_deployments").update({ workflow_run_id: run.runId }).eq("user_id", userId).eq("id", deploymentId);
    return run.runId;
  } catch (error) {
    await createSupabaseAdminClient().from("aws_paseo_deployments").update({ state: "failed", failure_detail: error instanceof Error ? error.message.slice(0, 1000) : "Could not start AWS deletion" }).eq("user_id", userId).eq("id", deploymentId);
    throw error;
  }
}
