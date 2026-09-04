import { app, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class SecretVault {
  private readonly path: string;

  constructor(filename = "secrets.bin") {
    this.path = join(app.getPath("userData"), filename);
  }

  read<T>(): T | null {
    if (!existsSync(this.path) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = readFileSync(this.path);
      return JSON.parse(safeStorage.decryptString(encrypted)) as T;
    } catch {
      return null;
    }
  }

  write(value: unknown): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this Mac");
    }
    writeFileSync(this.path, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
  }

  clear(): void {
    if (existsSync(this.path)) writeFileSync(this.path, Buffer.alloc(0), { mode: 0o600 });
  }
}
