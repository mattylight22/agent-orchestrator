import { NextResponse } from "next/server";

export function errorMessage(error: unknown, fallback = "Unexpected error") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const message = typeof value.message === "string" ? value.message : "";
    const details = typeof value.details === "string" ? value.details : "";
    const code = typeof value.code === "string" ? value.code : "";
    const combined = [code, message, details].filter(Boolean).join(": ");
    if (combined) return combined;
  }
  return fallback;
}

export function jsonError(error: unknown, status = 400) {
  const message = errorMessage(error);
  return NextResponse.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : status });
}

export async function readJson<T>(request: Request): Promise<T> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object") throw new Error("A JSON request body is required");
  return value as T;
}
