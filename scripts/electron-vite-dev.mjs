import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronPackage = JSON.parse(readFileSync(join(projectRoot, "node_modules/electron/package.json"), "utf8"));
const sourceBundle = join(projectRoot, "node_modules/electron/dist/Electron.app");
const brandedDist = join(projectRoot, ".electron-dev");
const targetBundle = join(brandedDist, "Electron.app");
const markerPath = join(brandedDist, ".electron-version");

if (process.platform === "darwin") {
  const preparedVersion = existsSync(markerPath) ? readFileSync(markerPath, "utf8") : "";
  if (!existsSync(targetBundle) || preparedVersion !== electronPackage.version) {
    rmSync(brandedDist, { recursive: true, force: true });
    mkdirSync(brandedDist, { recursive: true });
    const clone = spawnSync("/bin/cp", ["-cR", sourceBundle, targetBundle], { stdio: "inherit" });
    if (clone.status !== 0) cpSync(sourceBundle, targetBundle, { recursive: true });
    const plist = join(targetBundle, "Contents/Info.plist");
    for (const [key, value] of [
      ["CFBundleDisplayName", "Agent Lens"],
      ["CFBundleName", "Agent Lens"],
      ["CFBundleIdentifier", "com.agentlens.dev"],
    ]) {
      const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], { stdio: "inherit" });
      if (result.status !== 0) throw new Error(`Could not brand development Electron bundle: ${key}`);
    }
    writeFileSync(markerPath, electronPackage.version);
  }
}

if (process.env.AGENT_LENS_PREPARE_ONLY === "1") process.exit(0);

const executable = join(projectRoot, "node_modules/.bin/electron-vite");
const child = spawn(executable, ["dev"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ...(process.platform === "darwin" ? { ELECTRON_OVERRIDE_DIST_PATH: brandedDist } : {}),
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
