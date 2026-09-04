import { NextResponse } from "next/server";
import { verifyAwsConnectionRole } from "@/lib/aws";
import { jsonError, readJson } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { roleArn } = await readJson<{ roleArn?: string }>(request);
    if (!roleArn) throw new Error("Paste the ConnectionRoleArn from the AWS stack outputs");
    const { user } = await requireUser();
    return NextResponse.json(await verifyAwsConnectionRole(user.id, id, roleArn));
  } catch (error) { return jsonError(error); }
}
