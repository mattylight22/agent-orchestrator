import "server-only";
import { createSupabaseAdminClient } from "./supabase/admin";
import { withPaseoClient } from "./paseo";
import { latestPaseoPlan } from "./paseo-plan";

export interface PaseoSynchronizationResult {
  terminal: boolean;
  attention: boolean;
  planChanged: boolean;
}

function titleFromPlan(body: string) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Implementation plan";
}

async function saveCurrentPlan(input: {
  userId: string;
  workstreamId: string;
  agentId: string;
  body: string;
  permissionId: string | null;
  sourceUpdatedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data: existing, error: readError } = await admin
    .from("plans")
    .select("id,body")
    .eq("user_id", input.userId)
    .eq("workstream_id", input.workstreamId)
    .maybeSingle();
  if (readError) throw readError;

  if (existing?.body === input.body) {
    const { error } = await admin.from("plans").update({
      source_agent_id: input.agentId,
      ...(input.permissionId ? { source_permission_id: input.permissionId } : {}),
      deleted_at: null,
    }).eq("id", existing.id).eq("user_id", input.userId);
    if (error) throw error;
    return false;
  }

  const values = {
    title: titleFromPlan(input.body),
    body: input.body,
    status: "product-feature",
    execution_state: "staged",
    source_agent_id: input.agentId,
    source_permission_id: input.permissionId,
    source_updated_at: input.sourceUpdatedAt,
    deleted_at: null,
  };
  if (existing) {
    const { error } = await admin.from("plans").update(values).eq("id", existing.id).eq("user_id", input.userId);
    if (error) throw error;
  } else {
    const { error } = await admin.from("plans").insert({ id: `plan:${input.workstreamId}`, user_id: input.userId, workstream_id: input.workstreamId, ...values });
    if (error) throw error;
  }
  return true;
}

export async function synchronizePaseoAgent(userId: string, workstreamId: string, agentId: string, options: { updateWorkstreamState?: boolean } = {}): Promise<PaseoSynchronizationResult> {
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
  const entries = sync.page.entries as any[];
  const messages = entries.flatMap((entry) => {
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
  const captured = latestPaseoPlan(entries, permissions);
  const planChanged = captured ? await saveCurrentPlan({
    userId,
    workstreamId,
    agentId,
    body: captured.body,
    permissionId: captured.permissionId,
    sourceUpdatedAt: captured.sourceUpdatedAt,
  }) : false;

  for (const permission of permissions) {
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
  const sourceUpdatedAt = new Date().toISOString();
  await admin.from("agent_runs").update({ state, source_updated_at: sourceUpdatedAt }).eq("user_id", userId).eq("paseo_agent_id", agentId);
  if (options.updateWorkstreamState !== false) {
    await admin.from("workstreams").update({ agent_state: state, source_updated_at: sourceUpdatedAt }).eq("user_id", userId).eq("id", workstreamId);
  }
  return { terminal, attention, planChanged };
}
