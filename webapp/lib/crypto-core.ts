import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface Envelope { v: 1; iv: string; tag: string; data: string }

function keys(): Buffer[] {
  const rawValues = [process.env.CREDENTIAL_ENCRYPTION_KEY, process.env.AGENT_LENS_ENCRYPTION_KEY]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const uniqueValues = [...new Set(rawValues)];
  if (!uniqueValues.length) throw new Error("Secure connections are temporarily unavailable");
  const values = uniqueValues.map((raw) => Buffer.from(raw, "base64"));
  if (values.some((value) => value.length !== 32)) throw new Error("Secure connections are temporarily unavailable");
  return values;
}

export function encryptCredential(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys()[0], iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope: Envelope = { v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

export function decryptCredential<T>(encoded: string): T {
  const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Envelope;
  if (envelope.v !== 1) throw new Error("Unsupported credential envelope version");
  for (const key of keys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const value = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64url")), decipher.final()]);
      return JSON.parse(value.toString("utf8")) as T;
    } catch {
      // Existing records may still use the legacy key while new records use the primary key.
    }
  }
  throw new Error("This stored connection can no longer be decrypted. Reconnect it and try again.");
}
