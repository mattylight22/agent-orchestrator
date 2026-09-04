"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot } from "@agent-lens/domain";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface SnapshotContextValue {
  snapshot: AppSnapshot;
  refreshing: boolean;
  refresh(): Promise<void>;
  request<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  toast: { kind: "success" | "error" | "info"; message: string } | null;
  clearToast(): void;
}

const SnapshotContext = createContext<SnapshotContextValue | null>(null);

export function SnapshotProvider({ initial, children }: { initial: AppSnapshot; children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<SnapshotContextValue["toast"]>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Could not refresh Agent God Mode");
      setSnapshot(value);
    } finally { setRefreshing(false); }
  }, []);
  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(value.error ?? "The action failed");
      setToast({ kind: "error", message: error.message });
      throw error;
    }
    await refresh();
    return value as T;
  }, [refresh]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel("agent-lens-account-data").on("postgres_changes", { event: "*", schema: "public" }, () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 220);
    }).subscribe();
    return () => { if (timer.current) clearTimeout(timer.current); void supabase.removeChannel(channel); };
  }, [refresh]);
  useEffect(() => {
    const theme = snapshot.settings.theme;
    document.documentElement.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.dataset.density = snapshot.settings.density;
  }, [snapshot.settings.theme, snapshot.settings.density]);
  const value = useMemo(() => ({ snapshot, refreshing, refresh, request, toast, clearToast: () => setToast(null) }), [snapshot, refreshing, refresh, request, toast]);
  return <SnapshotContext.Provider value={value}>{children}{toast && <div className={`toast ${toast.kind}`} role="status"><span>{toast.message}</span><button aria-label="Dismiss" onClick={() => setToast(null)}>×</button></div>}</SnapshotContext.Provider>;
}

export function useAgentLens() {
  const value = useContext(SnapshotContext);
  if (!value) throw new Error("useAgentLens must be used within SnapshotProvider");
  return value;
}
