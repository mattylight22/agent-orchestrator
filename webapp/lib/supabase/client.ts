"use client";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

export function createSupabaseBrowserClient(accessToken: () => Promise<string | null>) {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createClient(url, publishableKey, { accessToken });
}
