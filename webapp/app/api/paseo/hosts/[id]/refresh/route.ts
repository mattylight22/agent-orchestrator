import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/http";
import { providerCatalog, refreshHostMappings, waitForProviderSnapshot, withPaseoClient } from "@/lib/paseo";
import { requireUser } from "@/lib/supabase/server";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    const catalog = await withPaseoClient(user.id, id, async (client) => providerCatalog(await waitForProviderSnapshot(client)));
    const { error } = await supabase.from("paseo_hosts").update({ provider_catalog: catalog, source_updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    let mappingCount = 0;
    let mappingWarning: string | null = null;
    try {
      mappingCount = (await refreshHostMappings(user.id, id)).length;
    } catch (error) {
      mappingWarning = errorMessage(error, "Repository discovery failed");
    }
    return NextResponse.json({ providerCount: catalog.length, mappingCount, mappingWarning });
  } catch (error) { return jsonError(error); }
}
