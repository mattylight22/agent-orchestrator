import { describe, expect, it } from "vitest";
import { defaultSettings, mergeTimelineText, portableSettings } from "../src/main/database";
import { cloudErrorMessage } from "../src/main/supabase-sync-service";
import { normalizeGithubRemote, normalizePaseoEndpoint, parseAgentQuestionPrompts, titleFromPlan } from "../src/main/paseo-manager";
import { planRevisionPrompt, replaceReviewLog, resolveRoleConfig, slugifyWorkstream, wouldCreatePlanDependencyCycle } from "../src/main/workstream-service";
import { normalizeTailscaleEndpoint } from "../packages/domain/src/index";

describe("slugifyWorkstream", () => {
  it("creates a safe kebab-case branch suffix", () => {
    expect(slugifyWorkstream("  Café Account Recovery — Phase 2! ")).toBe("cafe-account-recovery-phase-2");
  });

  it("caps the branch suffix at 72 characters", () => {
    expect(slugifyWorkstream("A".repeat(100))).toHaveLength(72);
  });
});

describe("mergeTimelineText", () => {
  it("joins streamed message fragments", () => {
    expect(mergeTimelineText("then f", "an out")).toBe("then fan out");
  });

  it("accepts a projected full-message replacement without duplication", () => {
    expect(mergeTimelineText("I'll start", "I'll start with the repository")).toBe("I'll start with the repository");
  });

  it("ignores replayed fragments", () => {
    expect(mergeTimelineText("fan out", "an out")).toBe("fan out");
  });
});

describe("normalizeGithubRemote", () => {
  it.each([
    ["git@github.com:Northstar/Arc-Web.git", "northstar/arc-web"],
    ["ssh://git@github.com/Northstar/Arc-Web.git", "northstar/arc-web"],
    ["https://github.com/Northstar/Arc-Web", "northstar/arc-web"],
  ])("normalizes %s", (remote, expected) => expect(normalizeGithubRemote(remote)).toBe(expected));

  it("rejects ambiguous non-GitHub paths", () => {
    expect(normalizeGithubRemote("/srv/repos/arc-web")).toBeNull();
  });
});

describe("normalizePaseoEndpoint", () => {
  it("adds the Paseo daemon port for a direct unencrypted Tailscale URL", () => {
    expect(normalizePaseoEndpoint("ws://100.88.249.24/ws")).toBe("ws://100.88.249.24:6767/ws");
  });

  it("keeps secure reverse-proxy URLs on their default TLS port", () => {
    expect(normalizePaseoEndpoint("wss://paseo.example-tailnet.ts.net")).toBe("wss://paseo.example-tailnet.ts.net/ws");
  });
});

describe("normalizeTailscaleEndpoint", () => {
  it.each([
    ["100.88.249.24", "wss://100.88.249.24/ws"],
    ["wss://100.64.0.1:6767/ws", "wss://100.64.0.1:6767/ws"],
    ["wss://builder.example-tailnet.ts.net/ws", "wss://builder.example-tailnet.ts.net/ws"],
  ])("accepts tailnet endpoint %s", (input, expected) => expect(normalizeTailscaleEndpoint(input)).toBe(expected));

  it.each(["ws://100.88.249.24/ws", "wss://192.168.1.4/ws", "wss://metadata.google.internal/ws", "wss://100.88.249.24/admin"])("rejects unsafe endpoint %s", (input) => {
    expect(() => normalizeTailscaleEndpoint(input)).toThrow();
  });
});

describe("parseAgentQuestionPrompts", () => {
  it("keeps Paseo question choices and interaction flags", () => {
    expect(parseAgentQuestionPrompts({
      questions: [{
        header: "Delivery",
        question: "How should this ship?",
        options: [{ label: "Phased", description: "Use reviewable phases." }, { label: "All at once" }],
        multiSelect: false,
        allowOther: true,
      }],
    })).toEqual([{ 
      header: "Delivery",
      question: "How should this ship?",
      options: [{ label: "Phased", description: "Use reviewable phases." }, { label: "All at once" }],
      multiSelect: false,
      allowOther: true,
      allowEmpty: false,
    }]);
  });

  it("rejects malformed tool input instead of rendering a broken form", () => {
    expect(parseAgentQuestionPrompts({ questions: [{ header: "Missing question", options: [] }] })).toBeNull();
  });
});

describe("captured plans", () => {
  it("uses the first Markdown heading as the plan title", () => {
    expect(titleFromPlan("Intro\n\n# Checkout reliability\n\nSteps")).toBe("Checkout reliability");
  });

  it("allows a staged dependency chain and rejects a cycle", () => {
    const plans = [
      { id: "a", dependencyIds: [] },
      { id: "b", dependencyIds: ["a"] },
      { id: "c", dependencyIds: ["b"] },
    ];
    expect(wouldCreatePlanDependencyCycle(plans, "c", ["b"])).toBe(false);
    expect(wouldCreatePlanDependencyCycle(plans, "a", ["c"])).toBe(true);
  });

  it("combines every annotation into one structured revision request", () => {
    const prompt = planRevisionPrompt([
      { quote: "Use a nightly job.", comment: "Make this event-driven." },
      { quote: "Delete immediately.", comment: "Add a 30-day recovery window." },
    ]);
    expect(prompt).toContain("## Revision comment 1");
    expect(prompt).toContain("> Use a nightly job.");
    expect(prompt).toContain("Make this event-driven.");
    expect(prompt).toContain("## Revision comment 2");
    expect(prompt).toContain("Add a 30-day recovery window.");
  });
});

describe("resolveRoleConfig", () => {
  it("prefers a host override and otherwise uses the global default", () => {
    const settings = {
      ...defaultSettings,
      hostRoleOverrides: { fleet: { builder: { provider: "cursor", model: "host-model" } } },
    };
    expect(resolveRoleConfig(settings, "fleet", "builder").model).toBe("host-model");
    expect(resolveRoleConfig(settings, "other", "builder").model).toBe("cursor-grok-4.5-high");
  });
});

describe("replaceReviewLog", () => {
  it("appends a bounded review log while preserving the pull request body", () => {
    const result = replaceReviewLog("## Summary\n\nKeep this.", "### Iteration 1\n\nClean.");
    expect(result).toContain("## Summary\n\nKeep this.");
    expect(result).toContain("<!-- agent-lens:review-log:start -->");
    expect(result).toContain("### Iteration 1");
  });

  it("updates its own bounded section without duplicating it", () => {
    const first = replaceReviewLog("Before\n\nAfter", "Old result");
    const second = replaceReviewLog(first, "New result");
    expect(second.match(/agent-lens:review-log:start/g)).toHaveLength(1);
    expect(second).not.toContain("Old result");
    expect(second).toContain("New result");
    expect(second).toContain("Before\n\nAfter");
  });
});

describe("local-first cloud records", () => {
  it("keeps device credentials out of synchronized settings", () => {
    const payload = portableSettings({
      ...defaultSettings,
      githubClientId: "device-github-client",
      cloud: { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "publishable-key", syncEnabled: true },
    });
    expect(payload).not.toHaveProperty("githubClientId");
    expect(payload).not.toHaveProperty("githubConnected");
    expect(payload).not.toHaveProperty("cloud");
  });

  it("turns a structured Supabase constraint failure into an actionable message", () => {
    expect(cloudErrorMessage({ code: "PGRST205", message: "Could not find the table public.user_settings in the schema cache" })).toContain("schema is not initialized");
  });
});
