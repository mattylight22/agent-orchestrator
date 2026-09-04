import { NextResponse } from "next/server";
import { startAwsDeletion, startAwsProvisioning } from "@/lib/aws-orchestration";
import { jsonError, readJson } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ action?: string; confirmation?: string }>(request);
    const { supabase, user } = await requireUser();
    const { data: deployment, error } = await supabase.from("aws_paseo_deployments").select("*").eq("user_id", user.id).eq("id", id).is("deleted_at", null).single();
    if (error || !deployment) throw error ?? new Error("AWS deployment not found");
    if (body.action === "retry") {
      if (deployment.state !== "failed") throw new Error("Only failed deployments can be retried");
      const { data: claimed, error: claimError } = await supabase.from("aws_paseo_deployments").update({ state: "queued", failure_detail: null }).eq("user_id", user.id).eq("id", id).eq("state", "failed").select("id").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) throw new Error("This deployment is already being retried");
      await startAwsProvisioning(user.id, id);
    } else if (body.action === "delete") {
      if (body.confirmation?.trim() !== deployment.name) throw new Error(`Type ${deployment.name} exactly to confirm deletion`);
      if (["creating", "waiting-for-ssm", "pairing", "deleting"].includes(deployment.state)) throw new Error("Wait for the current AWS operation to finish before deleting");
      if (deployment.paseo_host_id) {
        const { data: workstreams, error: workstreamError } = await supabase.from("workstreams").select("id,phase").eq("user_id", user.id).eq("host_id", deployment.paseo_host_id).is("deleted_at", null);
        if (workstreamError) throw workstreamError;
        if (workstreams?.some((workstream) => workstream.phase !== "complete")) throw new Error("Complete or delete active workstreams on this host before destroying its AWS infrastructure");
        const workstreamIds = (workstreams ?? []).map((workstream) => workstream.id);
        if (workstreamIds.length) {
          const { data: activeRuns, error: runError } = await supabase.from("workflow_runs").select("id").eq("user_id", user.id).in("workstream_id", workstreamIds).in("state", ["queued", "running", "waiting"]).limit(1);
          if (runError) throw runError;
          if (activeRuns?.length) throw new Error("Wait for active workstream workflows to finish before destroying this host");
        }
      }
      const { data: claimed, error: claimError } = await supabase.from("aws_paseo_deployments").update({ state: "deleting", failure_detail: null }).eq("user_id", user.id).eq("id", id).eq("state", deployment.state).select("id").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) throw new Error("Another AWS operation already started for this deployment");
      await startAwsDeletion(user.id, id);
    } else throw new Error("Unknown AWS deployment action");
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
