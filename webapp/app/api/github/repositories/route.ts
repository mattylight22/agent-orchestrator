import { NextResponse } from "next/server";
import { syncGithubRepositories } from "@/lib/github";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function POST() {
  try {
    const { user } = await requireUser();
    return NextResponse.json({ repositories: await syncGithubRepositories(user.id) });
  } catch (error) { return jsonError(error, 500); }
}
