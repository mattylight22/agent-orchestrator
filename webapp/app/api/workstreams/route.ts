import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { branchName, createWorkstreamInputSchema } from "@agent-lens/domain";
import { jsonError, readJson } from "@/lib/http";
import { startWorkstreamWorkflow } from "@/lib/orchestration";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const input = createWorkstreamInputSchema.parse(await readJson(request));
    const { supabase, user } = await requireUser();
    const [{ data: repository, error: repoError }, { data: host, error: hostError }] = await Promise.all([
      supabase.from("repositories").select("*").eq("user_id", user.id).eq("id", input.repositoryId).is("deleted_at", null).single(),
      supabase.from("paseo_hosts").select("id,name").eq("user_id", user.id).eq("id", input.hostId).is("deleted_at", null).single(),
    ]);
    if (repoError || hostError || !repository || !host) throw repoError ?? hostError ?? new Error("Repository or host is unavailable");
    const branch = branchName(input.prefix, input.name);
    const { data: existing } = await supabase.from("workstreams").select("id").eq("user_id", user.id).eq("repository_id", repository.id).eq("branch_name", branch).is("deleted_at", null).maybeSingle();
    if (existing) return NextResponse.json({ id: existing.id, existing: true }, { status: 200 });
    const id = randomUUID();
    const now = new Date().toISOString();
    const { error } = await supabase.from("workstreams").insert({
      id, user_id: user.id, name: input.name.trim(), brief: input.brief.trim(), repository_id: repository.id,
      repository_full_name: repository.full_name, repository_url: repository.html_url, host_id: host.id,
      branch_name: branch, base_branch: input.baseBranch, status: "draft", phase: "provisioning",
      agent_state: "queued", pr_checks: "none", review_iteration: 0, source_updated_at: now, created_at: now,
    });
    if (error) throw error;
    await supabase.from("audit_events").insert({ id: randomUUID(), user_id: user.id, workstream_id: id, event_type: "workstream.provisioning", title: "Workstream provisioning started", detail: branch });
    await startWorkstreamWorkflow(user.id, id);
    return NextResponse.json({ id, existing: false }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
