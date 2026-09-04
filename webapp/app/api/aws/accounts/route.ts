import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { awsAccessSetup, createExternalId } from "@/lib/aws";
import { encryptCredential } from "@/lib/crypto";
import { jsonError, readJson } from "@/lib/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { name } = await readJson<{ name?: string }>(request);
    const cleanName = name?.trim();
    if (!cleanName || cleanName.length > 80) throw new Error("Give this AWS account a name");
    const { supabase, user } = await requireUser();
    const id = randomUUID();
    const externalId = createExternalId();
    const setup = awsAccessSetup(id, externalId);
    const { error: accountError } = await supabase.from("aws_accounts").insert({ id, user_id: user.id, name: cleanName, state: "pending" });
    if (accountError) throw accountError;
    const { error: secretError } = await createSupabaseAdminClient().from("aws_connection_secrets").insert({ id, user_id: user.id, encrypted_external_id: encryptCredential({ externalId }) });
    if (secretError) {
      await supabase.from("aws_accounts").delete().eq("user_id", user.id).eq("id", id);
      throw secretError;
    }
    return NextResponse.json({ connectionId: id, setup }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
