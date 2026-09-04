import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/server";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    const { data: account, error: accountError } = await supabase.from("aws_accounts").select("id").eq("user_id", user.id).eq("id", id).is("deleted_at", null).maybeSingle();
    if (accountError) throw accountError;
    if (!account) throw new Error("AWS account connection not found");
    const { count, error: deploymentError } = await supabase.from("aws_paseo_deployments").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("aws_account_id", id).neq("state", "deleted").is("deleted_at", null);
    if (deploymentError) throw deploymentError;
    if (count) throw new Error("Delete this account’s Paseo deployments before disconnecting AWS");
    const admin = createSupabaseAdminClient();
    const { error: secretError } = await admin.from("aws_connection_secrets").delete().eq("user_id", user.id).eq("id", id);
    if (secretError) throw secretError;
    const { error } = await supabase.from("aws_accounts").update({ deleted_at: new Date().toISOString() }).eq("user_id", user.id).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true, reminder: "Delete the Agent God Mode access stack in AWS to revoke its IAM roles completely." });
  } catch (error) { return jsonError(error); }
}
