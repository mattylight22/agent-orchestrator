import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { jsonError, readJson } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await context.params;
    const supabase = await createSupabaseServerClient();
    if (action === "sign-out") {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    const body = await readJson<{ email: string; password: string }>(request);
    const result = action === "sign-up"
      ? await supabase.auth.signUp({ email: body.email.trim(), password: body.password })
      : await supabase.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, confirmationRequired: action === "sign-up" && !result.data.session });
  } catch (error) { return jsonError(error); }
}
