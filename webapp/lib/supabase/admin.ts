import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Account services are temporarily unavailable");
  const { url } = getSupabasePublicConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
