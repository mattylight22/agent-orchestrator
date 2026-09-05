import { describe, expect, it } from "vitest";
import { isManagedAgentStackName, isStackOwnedByConnection } from "./aws-orphan-rules";

const connectionId = "703ad78d-fbd8-4490-9d64-42917f39259b";

describe("AWS orphan safeguards", () => {
  it("accepts only generated Agent Instance stack names", () => {
    expect(isManagedAgentStackName("agent-god-mode-paseo-703ad78dfbd844909d644291")).toBe(true);
    expect(isManagedAgentStackName("agent-god-mode-access-703ad78dfbd8")).toBe(false);
    expect(isManagedAgentStackName("production-app")).toBe(false);
    expect(isManagedAgentStackName("agent-god-mode-paseo-../../production")).toBe(false);
  });

  it("requires both application and connection ownership tags", () => {
    const tags = [
      { Key: "Application", Value: "AgentGodMode" },
      { Key: "AgentGodModeConnection", Value: "703ad78dfbd8" },
    ];
    expect(isStackOwnedByConnection(tags, connectionId)).toBe(true);
    expect(isStackOwnedByConnection(tags.filter((tag) => tag.Key !== "Application"), connectionId)).toBe(false);
    expect(isStackOwnedByConnection([{ ...tags[0] }, { ...tags[1], Value: "ffffffffffff" }], connectionId)).toBe(false);
  });
});
