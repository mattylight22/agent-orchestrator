import { NextResponse } from "next/server";
import type { PaseoTransport } from "@agent-lens/domain";
import { jsonError, readJson } from "@/lib/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { transport } = await readJson<{ transport: PaseoTransport }>(request);
    if (transport !== "relay" && transport !== "tailscale") throw new Error("Choose Relay or Tailscale");
    const { user } = await requireUser();
    const admin = createSupabaseAdminClient();
    const { data: connection, error: connectionError } = await admin.from("paseo_connections").select("id").eq("user_id", user.id).eq("host_id", id).eq("transport", transport).maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) throw new Error(`This host does not have a ${transport === "relay" ? "Relay" : "Tailscale"} connection`);
    const { error } = await admin.from("paseo_hosts").update({ preferred_transport: transport }).eq("user_id", user.id).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ hostId: id, preferredTransport: transport });
  } catch (error) { return jsonError(error); }
}
