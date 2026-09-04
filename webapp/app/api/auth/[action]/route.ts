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
    if (action === "sign-up") {
      return NextResponse.json({ error: "Account creation is currently disabled" }, { status: 403 });
    }
    if (action !== "sign-in") {
      return NextResponse.json({ error: "Unknown authentication action" }, { status: 404 });
    }
    const body = await readJson<{ email: string; password: string }>(request);
    const result = await supabase.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
