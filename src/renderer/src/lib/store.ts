import { useSyncExternalStore } from "react";
import type { AppSnapshot } from "../../../shared/contracts";

let current: AppSnapshot | null = null;
const listeners = new Set<() => void>();

export function setSnapshot(next: AppSnapshot): void {
  current = next;
  for (const listener of listeners) listener();
}

export function getSnapshot(): AppSnapshot | null {
  return current;
}

export function useSnapshot(): AppSnapshot {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  if (!value) throw new Promise<void>((resolve) => {
    const stop = () => {
      listeners.delete(stop);
      resolve();
    };
    listeners.add(stop);
  });
  return value;
}

