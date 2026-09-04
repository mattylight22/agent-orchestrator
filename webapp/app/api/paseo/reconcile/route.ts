import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/http";
import { synchronizePaseoAgent } from "@/lib/paseo-sync";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

type ReconcileBody = { workstreamIds?: string[] };

export async function POST(request: Request) {
  try {
    const body = await readJson<ReconcileBody>(request);
    const { supabase, user } = await requireUser();
    const requestedIds = [...new Set((body.workstreamIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 24);
    let workstreamsQuery = supabase.from("workstreams").select("id").eq("user_id", user.id).is("deleted_at", null);
    if (requestedIds.length) workstreamsQuery = workstreamsQuery.in("id", requestedIds);
    const { data: workstreams, error: workstreamError } = await workstreamsQuery;
    if (workstreamError) throw workstreamError;
    const workstreamIds = (workstreams ?? []).map((item) => item.id);
    if (!workstreamIds.length) return NextResponse.json({ synchronized: 0, planChanges: 0 });

    const { data: runs, error: runError } = await supabase
      .from("agent_runs")
      .select("workstream_id,role,paseo_agent_id,created_at")
      .eq("user_id", user.id)
      .in("workstream_id", workstreamIds)
      .not("paseo_agent_id", "is", null)
      .order("created_at", { ascending: false });
    if (runError) throw runError;

    const latestAgentByWorkstream = new Map<string, string>();
    const latest = new Map<string, { workstreamId: string; role: string; agentId: string }>();
    for (const run of runs ?? []) {
      if (run.paseo_agent_id && !latestAgentByWorkstream.has(run.workstream_id)) latestAgentByWorkstream.set(run.workstream_id, run.paseo_agent_id);
      const key = `${run.workstream_id}:${run.role}`;
      if (!latest.has(key) && run.paseo_agent_id) latest.set(key, { workstreamId: run.workstream_id, role: run.role, agentId: run.paseo_agent_id });
    }
    const candidates = [...latest.values()].sort((left, right) => Number(right.role === "planner") - Number(left.role === "planner")).slice(0, 12);
    const results = await Promise.allSettled(
      candidates.map(({ workstreamId, agentId }) => synchronizePaseoAgent(user.id, workstreamId, agentId, { updateWorkstreamState: latestAgentByWorkstream.get(workstreamId) === agentId })),
    );
    return NextResponse.json({
      synchronized: results.filter((result) => result.status === "fulfilled").length,
      planChanges: results.reduce((count, result) => count + (result.status === "fulfilled" && result.value.planChanged ? 1 : 0), 0),
      failures: results.filter((result) => result.status === "rejected").length,
    });
  } catch (error) {
    return jsonError(error);
  }
}
