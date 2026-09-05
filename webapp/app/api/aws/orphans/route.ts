import { NextResponse } from "next/server";
import { deleteAwsOrphanStack, scanAwsOrphanStacks } from "@/lib/aws-orphans";
import { jsonError, readJson } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { user } = await requireUser();
    return NextResponse.json(await scanAwsOrphanStacks(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const input = await readJson<{ awsAccountId?: string; region?: string; stackName?: string; confirmation?: string }>(request);
    if (!input.awsAccountId || !input.region || !input.stackName) throw new Error("Choose an orphaned stack to delete");
    if (input.confirmation !== input.stackName) throw new Error(`Type ${input.stackName} exactly to confirm deletion`);
    const { user } = await requireUser();
    return NextResponse.json(await deleteAwsOrphanStack(user.id, { awsAccountId: input.awsAccountId, region: input.region, stackName: input.stackName }));
  } catch (error) { return jsonError(error); }
}
