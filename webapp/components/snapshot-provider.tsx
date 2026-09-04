"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot } from "@agent-lens/domain";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchBrowserTailscaleAgents } from "@/lib/paseo-browser";

interface SnapshotContextValue {
  snapshot: AppSnapshot;
  refreshing: boolean;
  refresh(): Promise<void>;
  request<T = unknown>(url: string, init?: RequestInit): Promise<T>;
  toast: { kind: "success" | "error" | "info"; message: string } | null;
  clearToast(): void;
}

const SnapshotContext = createContext<SnapshotContextValue | null>(null);

const realtimeTables = [
  "user_settings",
  "repositories",
  "paseo_hosts",
  "host_repository_mappings",
  "workstreams",
  "agent_runs",
  "timeline_items",
  "agent_questions",
  "plans",
  "plan_dependencies",
  "plan_comments",
  "review_iterations",
  "audit_events",
  "workflow_runs",
] as const;

export function SnapshotProvider({ initial, children }: { initial: AppSnapshot; children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<SnapshotContextValue["toast"]>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const reconcileInFlight = useRef<Promise<void> | null>(null);
  const loadSnapshot = useCallback(async (showIndicator = false) => {
    if (refreshInFlight.current) return refreshInFlight.current;
    if (showIndicator) setRefreshing(true);
    const pending = (async () => {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Could not refresh Agent God Mode");
      setSnapshot(value);
    })();
    refreshInFlight.current = pending;
    try {
      await pending;
    } finally {
      if (refreshInFlight.current === pending) refreshInFlight.current = null;
      if (showIndicator) setRefreshing(false);
    }
  }, []);
  const refresh = useCallback(() => loadSnapshot(true), [loadSnapshot]);
  const refreshInBackground = useCallback(() => { void loadSnapshot().catch(() => undefined); }, [loadSnapshot]);
  const snapshotRef = useRef(snapshot);
  const reconcilePaseo = useCallback(() => {
    if (reconcileInFlight.current) return reconcileInFlight.current;
    const pending = (async () => {
      const current = snapshotRef.current;
      const hostById = new Map(current.hosts.map((host) => [host.id, host]));
      const directWorkstreams = current.workstreams.filter((workstream) => (hostById.get(workstream.hostId)?.transports ?? []).includes("tailscale"));
      const directByHost = new Map<string, Array<{ workstreamId: string; agentId: string }>>();
      for (const workstream of directWorkstreams) {
        const seenRoles = new Set<string>();
        for (const agent of [...workstream.agents].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
          if (!agent.paseoAgentId || seenRoles.has(agent.role)) continue;
          seenRoles.add(agent.role);
          const list = directByHost.get(workstream.hostId) ?? [];
          list.push({ workstreamId: workstream.id, agentId: agent.paseoAgentId });
          directByHost.set(workstream.hostId, list);
        }
      }
      for (const [hostId, agents] of directByHost) {
        const host = hostById.get(hostId);
        if (!host || host.endpoint === "Paseo relay") continue;
        try {
          const snapshots = await fetchBrowserTailscaleAgents(host.endpoint, agents);
          await fetch("/api/paseo/browser-reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agents: snapshots }) });
        } catch { /* A disconnected tailnet must not block Relay or Supabase updates. */ }
      }
      const serverWorkstreamIds = current.workstreams.filter((workstream) => (hostById.get(workstream.hostId)?.transports ?? []).includes("relay")).map((workstream) => workstream.id);
      if (serverWorkstreamIds.length) {
        await fetch("/api/paseo/reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workstreamIds: serverWorkstreamIds }),
        });
      }
      await loadSnapshot();
    })().catch(() => undefined).finally(() => {
      if (reconcileInFlight.current === pending) reconcileInFlight.current = null;
    });
    reconcileInFlight.current = pending;
    return pending;
  }, [loadSnapshot]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  const scheduleBackgroundRefresh = useCallback((delay = 160) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refreshInBackground, delay);
  }, [refreshInBackground]);
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
    const channel = supabase.channel("agent-god-mode-account-data");
    for (const table of realtimeTables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => scheduleBackgroundRefresh());
    }
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") scheduleBackgroundRefresh(0);
    });
    return () => { if (timer.current) clearTimeout(timer.current); void supabase.removeChannel(channel); };
  }, [scheduleBackgroundRefresh]);
  const hasActiveWork = useMemo(() => snapshot.workstreams.some((workstream) =>
    ["queued", "running"].includes(workstream.agentState) ||
    ["provisioning", "planning", "building", "review-fix", "independent-review"].includes(workstream.phase)
  ), [snapshot.workstreams]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void reconcilePaseo();
    }, hasActiveWork ? 3_000 : 15_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void reconcilePaseo(); };
    void reconcilePaseo();
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hasActiveWork, reconcilePaseo]);
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
