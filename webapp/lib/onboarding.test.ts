import { describe, expect, it } from "vitest";
import { onboardingState } from "./onboarding";

describe("onboarding state", () => {
  it("requires both GitHub and a usable Paseo connection", () => {
    expect(onboardingState({ settings: { githubConnected: false }, hosts: [] }).complete).toBe(false);
    expect(onboardingState({ settings: { githubConnected: true }, hosts: [] }).complete).toBe(false);
    expect(onboardingState({ settings: { githubConnected: true }, hosts: [{ enabled: true, transports: [] }] }).complete).toBe(false);
    expect(onboardingState({ settings: { githubConnected: true }, hosts: [{ enabled: true, transports: ["relay"] }] }).complete).toBe(true);
  });

  it("does not count disabled hosts", () => {
    expect(onboardingState({ settings: { githubConnected: true }, hosts: [{ enabled: false, transports: ["tailscale"] }] }).complete).toBe(false);
  });
});
