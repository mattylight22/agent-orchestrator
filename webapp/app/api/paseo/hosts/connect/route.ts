import { NextResponse } from "next/server";
import { normalizeTailscaleEndpoint, type PaseoTransport, type ProviderModel } from "@agent-lens/domain";
import { jsonError, readJson } from "@/lib/http";
import { parsePairingLink, refreshHostMappings, storeHostMappings, storePaseoPairing, storePaseoTailscaleConnection, validatePairingOffer, type PaseoProjectDiscovery } from "@/lib/paseo";
import { requireUser } from "@/lib/supabase/server";

interface ConnectInput {
  name: string;
  transport: PaseoTransport;
  pairingLink?: string;
  endpoint?: string;
  browserValidation?: { endpoint: string; daemonId: string; daemonVersion: string | null; catalog: ProviderModel[]; discoveries: PaseoProjectDiscovery[] };
}

export async function POST(request: Request) {
  try {
    const input = await readJson<ConnectInput>(request);
    if (!input.name?.trim()) throw new Error("Give this Agent Instance a display name");
    if (input.transport !== "relay" && input.transport !== "tailscale") throw new Error("Choose Relay or Tailscale");
    const { user } = await requireUser();
    let hostId: string;
    let providerCount: number;
    if (input.transport === "relay") {
      const offer = parsePairingLink(input.pairingLink ?? "");
      const catalog = await validatePairingOffer(offer);
      hostId = await storePaseoPairing(user.id, input.name, offer, catalog);
      providerCount = catalog.length;
    } else {
      const validated = input.browserValidation;
      if (!validated || validated.endpoint !== normalizeTailscaleEndpoint(input.endpoint ?? "") || !validated.daemonId || !Array.isArray(validated.catalog) || !Array.isArray(validated.discoveries)) {
        throw new Error("Verify the Tailscale connection from this browser before saving it");
      }
      hostId = await storePaseoTailscaleConnection(user.id, input.name, validated);
      providerCount = validated.catalog.length;
    }
    let mappingCount = 0;
    let mappingWarning: string | null = null;
    try {
      mappingCount = input.transport === "tailscale"
        ? (await storeHostMappings(user.id, hostId, input.browserValidation?.discoveries ?? [])).length
        : (await refreshHostMappings(user.id, hostId)).length;
    }
    catch (error) { mappingWarning = error instanceof Error ? error.message : "Repository matching will retry later"; }
    return NextResponse.json({ hostId, transport: input.transport, providerCount, mappingCount, mappingWarning });
  } catch (error) { return jsonError(error); }
}
