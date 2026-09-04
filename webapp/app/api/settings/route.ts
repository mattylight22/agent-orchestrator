import { NextResponse } from "next/server";
import type { AppSettings } from "@agent-lens/domain";
import { jsonError, readJson } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  try {
    const patch = await readJson<Partial<AppSettings>>(request);
    const { supabase, user } = await requireUser();
    const { data } = await supabase.from("user_settings").select("payload").eq("user_id", user.id).maybeSingle();
    const current = (data?.payload ?? {}) as Record<string, unknown>;
    const payload = { ...current, ...patch, githubConnected: undefined, githubLogin: undefined, githubClientId: undefined, cloud: undefined };
    const { error } = await supabase.from("user_settings").upsert({ user_id: user.id, payload, source_updated_at: new Date().toISOString() });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
