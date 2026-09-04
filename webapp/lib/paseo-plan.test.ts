import { describe, expect, it } from "vitest";
import { latestPaseoPlan, planTextFromPermission, planTextFromTimelineItem } from "./paseo-plan";

describe("Paseo plan capture", () => {
  it("reads current plan permissions in both supported payload shapes", () => {
    expect(planTextFromPermission({ kind: "plan", input: { plan: "# First" } })).toBe("# First");
    expect(planTextFromPermission({ kind: "plan", detail: { type: "plan", text: "# Second" } })).toBe("# Second");
  });

  it("reads completed plan artifacts from the projected timeline", () => {
    expect(planTextFromTimelineItem({ type: "tool_call", detail: { type: "plan", text: "# Timeline plan" } })).toBe("# Timeline plan");
  });

  it("uses the pending revision before an older timeline plan", () => {
    expect(latestPaseoPlan(
      [{ timestamp: "2026-09-04T10:00:00.000Z", item: { type: "tool_call", detail: { type: "plan", text: "# Old" } } }],
      [{ id: "permission-2", kind: "plan", detail: { type: "plan", text: "# Revised" } }],
      "2026-09-04T11:00:00.000Z",
    )).toEqual({ body: "# Revised", permissionId: "permission-2", sourceUpdatedAt: "2026-09-04T11:00:00.000Z" });
  });

  it("returns the newest timeline plan without creating a second identity", () => {
    expect(latestPaseoPlan([
      { timestamp: "2026-09-04T10:00:00.000Z", item: { type: "tool_call", detail: { type: "plan", text: "# Old" } } },
      { timestamp: "2026-09-04T11:00:00.000Z", item: { type: "tool_call", detail: { type: "plan", text: "# Revised" } } },
    ], [])).toEqual({ body: "# Revised", permissionId: null, sourceUpdatedAt: "2026-09-04T11:00:00.000Z" });
  });
});
