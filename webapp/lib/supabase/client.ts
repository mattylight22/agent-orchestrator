"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseProject } from "@agent-lens/domain";

let client: ReturnType<typeof createBrowserClient> | undefined;
export function createSupabaseBrowserClient() {
  client ??= createBrowserClient(supabaseProject.url, supabaseProject.publishableKey);
  return client;
}
