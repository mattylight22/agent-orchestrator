import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeGithubCode, storeGithubConnection, syncGithubRepositories } from "@/lib/github";
import { requireUser } from "@/lib/supabase/server";
import { safeGithubConnectionDestination } from "@/lib/routes";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  const store = await cookies();
  const destination = safeGithubConnectionDestination(store.get("agent-lens-github-return")?.value);
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expected = store.get("agent-lens-github-state")?.value;
    store.delete("agent-lens-github-state");
    store.delete("agent-lens-github-return");
    if (!code || !state || !expected || state !== expected) throw new Error("Invalid or expired GitHub OAuth state");
    const { user } = await requireUser();
    const credential = await exchangeGithubCode(code);
    await storeGithubConnection(user.id, credential);
    await syncGithubRepositories(user.id);
    const redirectUrl = new URL(destination, appUrl);
    redirectUrl.searchParams.set("github", "connected");
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub connection failed";
    store.delete("agent-lens-github-return");
    const redirectUrl = new URL(destination, appUrl);
    redirectUrl.searchParams.set("githubError", message);
    return NextResponse.redirect(redirectUrl);
  }
}
