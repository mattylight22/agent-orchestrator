import { NextResponse } from "next/server";
import { loadSnapshot } from "@/lib/data";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await loadSnapshot()); }
  catch (error) { return jsonError(error, 500); }
}
