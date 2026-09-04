import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/http";
import { parsePairingLink, refreshHostMappings, storePaseoPairing, validatePairingOffer } from "@/lib/paseo";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { name, pairingLink } = await readJson<{ name: string; pairingLink: string }>(request);
    if (!name?.trim()) throw new Error("Give this Paseo host a display name");
    const { user } = await requireUser();
    const offer = parsePairingLink(pairingLink);
    const catalog = await validatePairingOffer(offer);
    const hostId = await storePaseoPairing(user.id, name, offer, catalog);
    const mappings = await refreshHostMappings(user.id, hostId);
    return NextResponse.json({ hostId, providerCount: catalog.length, mappingCount: mappings.length });
  } catch (error) { return jsonError(error); }
}
