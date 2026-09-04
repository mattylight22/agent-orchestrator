import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { providerCatalog, refreshHostMappings, waitForProviderSnapshot, withPaseoClient } from "@/lib/paseo";
import { requireUser } from "@/lib/supabase/server";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    const catalog = await withPaseoClient(user.id, id, async (client) => providerCatalog(await waitForProviderSnapshot(client)));
    const { error } = await supabase.from("paseo_hosts").update({ provider_catalog: catalog, source_updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    const mappings = await refreshHostMappings(user.id, id);
    return NextResponse.json({ providerCount: catalog.length, mappingCount: mappings.length });
  } catch (error) { return jsonError(error); }
}
