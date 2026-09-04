import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeGithubCode, storeGithubConnection, syncGithubRepositories } from "@/lib/github";
import { requireUser } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const store = await cookies();
    const expected = store.get("agent-lens-github-state")?.value;
    store.delete("agent-lens-github-state");
    if (!code || !state || !expected || state !== expected) throw new Error("Invalid or expired GitHub OAuth state");
    const { user } = await requireUser();
    const credential = await exchangeGithubCode(code);
    await storeGithubConnection(user.id, credential);
    await syncGithubRepositories(user.id);
    return NextResponse.redirect(new URL("/app/settings?github=connected", appUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub connection failed";
    return NextResponse.redirect(new URL(`/app/settings?githubError=${encodeURIComponent(message)}`, appUrl));
  }
}
