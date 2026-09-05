import "server-only";
import { randomUUID } from "node:crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";
import { createSupabaseAdminClient } from "./admin";

interface AppUser {
  id: string;
  clerkUserId: string;
  email: string;
}

function clerkSupabaseClient(accessToken: () => Promise<string | null>) {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createClient(url, publishableKey, { accessToken });
}

export async function createSupabaseServerClient() {
  const session = await auth();
  return clerkSupabaseClient(() => session.getToken());
}

async function ensureAppUser(clerkUserId: string): Promise<AppUser> {
  const admin = createSupabaseAdminClient();
  const existing = await admin
    .from("app_users")
    .select("id,clerk_user_id,email")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    return { id: existing.data.id, clerkUserId, email: existing.data.email ?? "" };
  }

  const clerkUser = await currentUser();
  const primaryEmail = clerkUser?.primaryEmailAddress;
  const email = primaryEmail?.emailAddress.trim().toLowerCase();
  if (!clerkUser || clerkUser.id !== clerkUserId || primaryEmail?.verification?.status !== "verified" || !email) {
    throw new Error("A verified email address is required to use Agent God Mode");
  }

  // Claim the UUID seeded from the previous Supabase Auth account when emails
  // match. New Clerk accounts receive a provider-neutral internal UUID.
  const legacy = await admin
    .from("app_users")
    .select("id,clerk_user_id,email")
    .eq("email", email)
    .maybeSingle();
  if (legacy.error) throw legacy.error;
  if (legacy.data?.clerk_user_id && legacy.data.clerk_user_id !== clerkUserId) {
    throw new Error("This email address is already linked to another account");
  }

  if (legacy.data) {
    const claimed = await admin
      .from("app_users")
      .update({ clerk_user_id: clerkUserId, email })
      .eq("id", legacy.data.id)
      .is("clerk_user_id", null)
      .select("id,clerk_user_id,email")
      .maybeSingle();
    if (claimed.error) throw claimed.error;
    if (claimed.data) return { id: claimed.data.id, clerkUserId, email };
  } else {
    const inserted = await admin
      .from("app_users")
      .insert({ id: randomUUID(), clerk_user_id: clerkUserId, email })
      .select("id,clerk_user_id,email")
      .single();
    if (!inserted.error && inserted.data) return { id: inserted.data.id, clerkUserId, email };
    if (inserted.error?.code !== "23505") throw inserted.error;
  }

  // A concurrent first request may have completed the link.
  const linked = await admin
    .from("app_users")
    .select("id,clerk_user_id,email")
    .eq("clerk_user_id", clerkUserId)
    .single();
  if (linked.error) throw linked.error;
  return { id: linked.data.id, clerkUserId, email: linked.data.email ?? email };
}

export async function requireUser() {
  const session = await auth();
  if (!session.userId) throw new Error("AUTH_REQUIRED");
  const user = await ensureAppUser(session.userId);
  const supabase = clerkSupabaseClient(() => session.getToken());
  return { supabase, user };
}
