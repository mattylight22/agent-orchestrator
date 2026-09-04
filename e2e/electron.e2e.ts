import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

let app: ElectronApplication;

test.beforeEach(async () => {
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, AGENT_LENS_DEMO: "1" },
  });
});

test.afterEach(async () => {
  await app.close();
});

test("boots through the secure preload and navigates a seeded workstream", async () => {
  const window = await app.firstWindow();
  await expect(window.locator(".brand-mark img")).toBeVisible();
  await expect.poll(() => window.locator(".brand-mark img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1024);
  await expect(window.getByRole("heading", { name: "Workstreams" })).toBeVisible();
  await expect(window.getByText("Command palette and keyboard navigation", { exact: true })).toBeVisible();
  await window.getByText("Command palette and keyboard navigation", { exact: true }).click();
  await expect(window.getByRole("heading", { name: "Command palette and keyboard navigation" })).toBeVisible();
  await expect(window.getByText("Plan", { exact: true }).first()).toBeVisible();
  await expect(window.getByText("Following up with")).toBeVisible();
});

test("applies dark appearance without reloading the renderer", async () => {
  const window = await app.firstWindow();
  await window.evaluate(async () => window.lens.updateSettings({ theme: "dark" }));
  await expect.poll(() => window.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(window.locator(".table-panel")).toBeVisible();
});

test("keeps cloud sync optional and contained behind secure preload IPC", async () => {
  const window = await app.firstWindow();
  await window.getByRole("link", { name: "Settings" }).click();
  await window.getByRole("button", { name: "Cloud sync" }).click();
  await expect(window.getByRole("heading", { name: "Cloud sync" })).toBeVisible();
  await expect(window.getByText("The Supabase project is managed by Agent Lens. Sign-in remains optional.")).toBeVisible();
  await expect(window.getByLabel("Project URL")).toHaveCount(0);
  await expect(window.getByLabel("Publishable key")).toHaveCount(0);
});

test("populates the mapped Paseo host when creating a workstream", async () => {
  const window = await app.firstWindow();
  await window.getByRole("button", { name: "New workstream" }).first().click();
  const host = window.getByLabel("Paseo host");
  await expect(host).toBeEnabled();
  await expect(host).not.toHaveValue("");
  await expect(window.getByText("Repository validated on this host")).toBeVisible();
});
