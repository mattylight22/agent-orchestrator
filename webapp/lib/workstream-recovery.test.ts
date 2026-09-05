import { describe, expect, it } from "vitest";
import { workstreamRecoveryAction } from "./workstream-recovery";

describe("workstream recovery actions", () => {
  it("offers provisioning recovery before a workspace exists", () => {
    expect(workstreamRecoveryAction({ phase: "attention", workspaceId: null, acceptedPlan: null, status: "draft" })).toBe("retry-provision");
  });

  it("offers build recovery for an accepted plan with a workspace", () => {
    expect(workstreamRecoveryAction({ phase: "attention", workspaceId: "wks_123", acceptedPlan: "# Plan", status: "ready-to-build" })).toBe("retry-build");
  });

  it("does not replace normal phase actions", () => {
    expect(workstreamRecoveryAction({ phase: "ready", workspaceId: "wks_123", acceptedPlan: "# Plan", status: "ready-to-build" })).toBeNull();
  });
});
