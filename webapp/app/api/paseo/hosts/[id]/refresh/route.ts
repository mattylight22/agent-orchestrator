import { NextResponse } from "next/server";
import { normalizeTailscaleEndpoint, type ProviderModel } from "@agent-lens/domain";
import { errorMessage, jsonError } from "@/lib/http";
import { providerCatalog, refreshHostMappings, storeHostMappings, waitForProviderSnapshot, withPaseoClient, type PaseoProjectDiscovery } from "@/lib/paseo";
import { requireUser } from "@/lib/supabase/server";

interface RefreshInput { browserValidation?: { endpoint: string; daemonId: string; daemonVersion: string | null; catalog: ProviderModel[]; discoveries: PaseoProjectDiscovery[] } }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    const body = await request.json().catch(() => ({})) as RefreshInput;
    const { data: host, error: hostError } = await supabase.from("paseo_hosts").select("endpoint,daemon_id").eq("id", id).eq("user_id", user.id).single();
    if (hostError || !host) throw hostError ?? new Error("Agent Instance not found");
    const direct = body.browserValidation;
    if (direct && (direct.endpoint !== normalizeTailscaleEndpoint(host.endpoint) || direct.daemonId !== host.daemon_id)) throw new Error("The Tailscale endpoint returned a different Agent Instance");
    const catalog = direct?.catalog ?? await withPaseoClient(user.id, id, async (client) => providerCatalog(await waitForProviderSnapshot(client)));
    const { error } = await supabase.from("paseo_hosts").update({ provider_catalog: catalog, daemon_version: direct?.daemonVersion ?? undefined, source_updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    let mappingCount = 0;
    let mappingWarning: string | null = null;
    try {
      mappingCount = direct ? (await storeHostMappings(user.id, id, direct.discoveries)).length : (await refreshHostMappings(user.id, id)).length;
    } catch (error) {
      mappingWarning = errorMessage(error, "Repository discovery failed");
    }
    return NextResponse.json({ providerCount: catalog.length, mappingCount, mappingWarning });
  } catch (error) { return jsonError(error); }
}
