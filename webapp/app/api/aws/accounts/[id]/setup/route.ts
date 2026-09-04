import { NextResponse } from "next/server";
import { getAwsAccessSetup } from "@/lib/aws";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser();
    return NextResponse.json({ setup: await getAwsAccessSetup(user.id, id) });
  } catch (error) { return jsonError(error); }
}
