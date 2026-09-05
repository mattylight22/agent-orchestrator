import { afterEach, describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./crypto-core";

const originalPrimary = process.env.CREDENTIAL_ENCRYPTION_KEY;
const originalLegacy = process.env.AGENT_LENS_ENCRYPTION_KEY;
const primary = Buffer.alloc(32, 17).toString("base64");
const legacy = Buffer.alloc(32, 29).toString("base64");

afterEach(() => {
  if (originalPrimary === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = originalPrimary;
  if (originalLegacy === undefined) delete process.env.AGENT_LENS_ENCRYPTION_KEY;
  else process.env.AGENT_LENS_ENCRYPTION_KEY = originalLegacy;
});

describe("credential encryption key rotation", () => {
  it("writes new credentials with the primary key", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = primary;
    process.env.AGENT_LENS_ENCRYPTION_KEY = legacy;
    const encrypted = encryptCredential({ token: "new" });
    delete process.env.AGENT_LENS_ENCRYPTION_KEY;
    expect(decryptCredential<{ token: string }>(encrypted)).toEqual({ token: "new" });
  });

  it("reads credentials encrypted with the legacy key", () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.AGENT_LENS_ENCRYPTION_KEY = legacy;
    const encrypted = encryptCredential({ token: "existing" });
    process.env.CREDENTIAL_ENCRYPTION_KEY = primary;
    expect(decryptCredential<{ token: string }>(encrypted)).toEqual({ token: "existing" });
  });

  it("returns an actionable error when neither key can decrypt a record", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = primary;
    delete process.env.AGENT_LENS_ENCRYPTION_KEY;
    const encrypted = encryptCredential({ token: "lost" });
    process.env.CREDENTIAL_ENCRYPTION_KEY = legacy;
    expect(() => decryptCredential(encrypted)).toThrow("Reconnect it and try again");
  });
});
