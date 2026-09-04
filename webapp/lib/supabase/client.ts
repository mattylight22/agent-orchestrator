"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./config";

let client: ReturnType<typeof createBrowserClient> | undefined;
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  client ??= createBrowserClient(url, publishableKey);
  return client;
}
