import { NextResponse } from "next/server";
import { awsRegions, type AwsRegion } from "@agent-lens/domain";
import { listAwsNetworks } from "@/lib/aws";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const region = new URL(request.url).searchParams.get("region") as AwsRegion | null;
    if (!region || !awsRegions.includes(region)) throw new Error("Choose a supported AWS region");
    const { user } = await requireUser();
    return NextResponse.json(await listAwsNetworks(user.id, id, region));
  } catch (error) { return jsonError(error); }
}
