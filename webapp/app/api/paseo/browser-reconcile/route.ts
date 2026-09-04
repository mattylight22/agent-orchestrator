import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/http";
import { persistPaseoAgentSnapshot, type PaseoAgentSnapshotInput } from "@/lib/paseo-sync";
import { requireUser } from "@/lib/supabase/server";

interface BrowserReconcileInput {
  agents?: Array<{ workstreamId: string; agentId: string; entries: PaseoAgentSnapshotInput["entries"]; agent: PaseoAgentSnapshotInput["agent"] }>;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<BrowserReconcileInput>(request);
    const { user } = await requireUser();
    const candidates = (body.agents ?? []).filter((item) => item?.workstreamId && item?.agentId && Array.isArray(item.entries)).slice(0, 12);
    const latestAgentByWorkstream = new Map<string, string>();
    for (const candidate of candidates) {
      if (!latestAgentByWorkstream.has(candidate.workstreamId)) latestAgentByWorkstream.set(candidate.workstreamId, candidate.agentId);
    }
    const results = await Promise.allSettled(candidates.map((candidate) => persistPaseoAgentSnapshot(
      user.id,
      candidate.workstreamId,
      candidate.agentId,
      { entries: candidate.entries, agent: candidate.agent },
      { updateWorkstreamState: latestAgentByWorkstream.get(candidate.workstreamId) === candidate.agentId },
    )));
    return NextResponse.json({
      synchronized: results.filter((result) => result.status === "fulfilled").length,
      planChanges: results.reduce((count, result) => count + (result.status === "fulfilled" && result.value.planChanged ? 1 : 0), 0),
      failures: results.filter((result) => result.status === "rejected").length,
    });
  } catch (error) { return jsonError(error); }
}
