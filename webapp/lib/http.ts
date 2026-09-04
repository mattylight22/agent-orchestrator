import { NextResponse } from "next/server";

export function jsonError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : status });
}

export async function readJson<T>(request: Request): Promise<T> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object") throw new Error("A JSON request body is required");
  return value as T;
}
