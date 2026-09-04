import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface Envelope { v: 1; iv: string; tag: string; data: string }

function key(): Buffer {
  const raw = process.env.AGENT_LENS_ENCRYPTION_KEY;
  if (!raw) throw new Error("AGENT_LENS_ENCRYPTION_KEY is not configured");
  const value = Buffer.from(raw, "base64");
  if (value.length !== 32) throw new Error("AGENT_LENS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return value;
}

export function encryptCredential(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope: Envelope = { v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

export function decryptCredential<T>(encoded: string): T {
  const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Envelope;
  if (envelope.v !== 1) throw new Error("Unsupported credential envelope version");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const value = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64url")), decipher.final()]);
  return JSON.parse(value.toString("utf8")) as T;
}
