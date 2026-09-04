import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

if (process.env.VERCEL === "1") {
  console.log("Skipping Electron native-module rebuild for the Vercel web build.");
  process.exit(0);
}

const executable = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild",
);

if (!existsSync(executable)) {
  console.warn("electron-rebuild is unavailable; skipping the desktop native-module rebuild.");
  process.exit(0);
}

const result = spawnSync(executable, ["-f", "-w", "better-sqlite3"], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
