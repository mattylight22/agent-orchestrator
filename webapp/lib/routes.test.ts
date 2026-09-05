import { describe, expect, it } from "vitest";
import { isPublicPath, safeGithubConnectionDestination, safeProductDestination } from "./routes";

describe("public web routes", () => {
  it("allows only the marketing and sign-in surfaces", () => {
    expect(["/", "/product", "/security", "/docs/setup", "/login", "/robots.txt", "/sitemap.xml"].every(isPublicPath)).toBe(true);
    expect(["/app", "/app/plans", "/api/snapshot", "/settings", "/set-password", "/api/auth/sign-in", "/auth/confirm"].some(isPublicPath)).toBe(false);
  });
});

describe("GitHub connection destinations", () => {
  it("allows onboarding and otherwise returns to settings", () => {
    expect(safeGithubConnectionDestination("/onboarding")).toBe("/onboarding");
    expect(safeGithubConnectionDestination("https://example.com")).toBe("/app/settings");
    expect(safeGithubConnectionDestination("/app/workstreams/private")).toBe("/app/settings");
  });
});

describe("post-auth destinations", () => {
  it("preserves authenticated product paths and legacy bookmarks", () => {
    expect(safeProductDestination("/app/workstreams/abc?tab=plan")).toBe("/app/workstreams/abc?tab=plan");
    expect(safeProductDestination("/onboarding")).toBe("/onboarding");
    expect(safeProductDestination("/plans?status=ready")).toBe("/plans?status=ready");
    expect(safeProductDestination("/workstreams/abc")).toBe("/workstreams/abc");
  });

  it("rejects public, malformed, and external destinations", () => {
    expect(safeProductDestination("//example.com/path")).toBe("/app");
    expect(safeProductDestination("https://example.com")).toBe("/app");
    expect(safeProductDestination("/security")).toBe("/app");
    expect(safeProductDestination(null)).toBe("/app");
  });
});
