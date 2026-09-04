import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";
import { safeGithubConnectionDestination } from "@/lib/routes";

export async function GET(request: Request) {
  try {
    await requireUser();
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) throw new Error("GitHub connections are temporarily unavailable");
    const state = randomBytes(24).toString("base64url");
    const store = await cookies();
    store.set("agent-lens-github-state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
    store.set("agent-lens-github-return", safeGithubConnectionDestination(new URL(request.url).searchParams.get("next")), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("state", state);
    return NextResponse.redirect(url);
  } catch (error) { return jsonError(error, 500); }
}
