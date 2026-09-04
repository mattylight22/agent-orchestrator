import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";

export async function POST() {
  try {
    const { user } = await requireUser();
    const { error } = await createSupabaseAdminClient().from("github_connections").delete().eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error, 500); }
}
