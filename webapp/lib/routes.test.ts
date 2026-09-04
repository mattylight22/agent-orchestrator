import { describe, expect, it } from "vitest";
import { isPublicPath, safeProductDestination } from "./routes";

describe("public web routes", () => {
  it("allows only the marketing and sign-in surfaces", () => {
    expect(["/", "/product", "/security", "/login", "/robots.txt", "/sitemap.xml", "/api/auth/sign-in"].every(isPublicPath)).toBe(true);
    expect(["/app", "/app/plans", "/api/snapshot", "/settings"].some(isPublicPath)).toBe(false);
  });
});

describe("post-auth destinations", () => {
  it("preserves authenticated product paths and legacy bookmarks", () => {
    expect(safeProductDestination("/app/workstreams/abc?tab=plan")).toBe("/app/workstreams/abc?tab=plan");
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
