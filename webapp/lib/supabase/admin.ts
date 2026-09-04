import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseProject } from "@agent-lens/domain";

export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createClient(supabaseProject.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
