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
    if (action === "set-password") {
      const body = await readJson<{ password: string }>(request);
      if (typeof body.password !== "string" || body.password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        return NextResponse.json({ error: "Your invitation session has expired. Request a new invitation." }, { status: 401 });
      }
      const { error } = await supabase.auth.updateUser({ password: body.password });
      if (error) throw error;
      return NextResponse.json({ ok: true });
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
