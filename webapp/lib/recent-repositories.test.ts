import { describe, expect, it } from "vitest";
import { selectRecentRepositories } from "./recent-repositories";

const repositories = [
  { id: "a", fullName: "acme/alpha" },
  { id: "b", fullName: "acme/bravo" },
  { id: "c", fullName: "labs/charlie" },
  { id: "d", fullName: "labs/delta" },
  { id: "e", fullName: "labs/echo" },
  { id: "f", fullName: "labs/foxtrot" },
] as any[];

describe("selectRecentRepositories", () => {
  it("shows workstream repositories first, then fills remaining slots from pull-request activity", () => {
    const workstreams = [
      { repositoryId: "a", updatedAt: "2026-01-01T00:00:00Z" },
      { repositoryId: "b", updatedAt: "2026-02-01T00:00:00Z" },
      { repositoryId: "a", updatedAt: "2026-03-01T00:00:00Z" },
    ] as any[];
    expect(selectRecentRepositories(repositories, workstreams, ["b", "c", "d", "e", "f"]).map((repository) => repository.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("falls back to the five repositories from recent pull-request activity", () => {
    expect(selectRecentRepositories(repositories, [], ["f", "e", "d", "c", "b", "a"]).map((repository) => repository.id)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("filters within the ranked recent list", () => {
    expect(selectRecentRepositories(repositories, [], ["f", "e", "d", "c"], "char").map((repository) => repository.id)).toEqual(["c"]);
  });

  it("does not duplicate a workstream repository found in pull-request activity", () => {
    const workstreams = [{ repositoryId: "a", updatedAt: "2026-03-01T00:00:00Z" }] as any[];
    expect(selectRecentRepositories(repositories, workstreams, ["a", "b", "c", "d", "e", "f"]).map((repository) => repository.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
