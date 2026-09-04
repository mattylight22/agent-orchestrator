"use client";

import { createPaseoClient } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { normalizeTailscaleEndpoint, type ProviderModel } from "@agent-lens/domain";

export interface BrowserTailscaleDiscovery {
  projectId: string;
  projectRootPath: string;
  remote: string;
  workspaceKind: string;
}

export interface BrowserTailscaleValidation {
  endpoint: string;
  daemonId: string;
  daemonVersion: string | null;
  catalog: ProviderModel[];
  discoveries: BrowserTailscaleDiscovery[];
}

export interface BrowserAgentSnapshot {
  workstreamId: string;
  agentId: string;
  entries: any[];
  agent: any;
}

function providerCatalog(snapshot: any): ProviderModel[] {
  return (snapshot.entries ?? []).flatMap((entry: any) => (entry.models ?? []).map((model: any) => ({
    provider: String(entry.provider),
    providerLabel: String(entry.label ?? entry.provider),
    model: String(model.id),
    modelLabel: String(model.label ?? model.id),
    status: entry.status ?? "error",
    modes: (entry.modes ?? []).map((mode: any) => ({ id: String(mode.id), label: String(mode.label ?? mode.id) })),
    thinkingOptions: (model.thinkingOptions ?? []).map((option: any) => ({ id: String(option.id), label: String(option.label ?? option.id) })),
  })));
}

async function waitForProviders(client: ReturnType<typeof createPaseoClient>) {
  try {
    return await client.providers.waitForReady({ timeoutMs: 60_000 });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Update the host to wait for provider discovery.") throw error;
  }
  const deadline = Date.now() + 60_000;
  let snapshot = await client.providers.snapshot();
  while (snapshot.entries.some((entry) => entry.status === "loading") && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    snapshot = await client.providers.snapshot();
  }
  if (snapshot.entries.some((entry) => entry.status === "loading")) throw new Error("Timed out waiting for provider discovery");
  return snapshot;
}

/** Connects from the user's browser through the Tailscale client on that device. */
export async function validateBrowserTailscaleConnection(rawEndpoint: string): Promise<BrowserTailscaleValidation> {
  const endpoint = normalizeTailscaleEndpoint(rawEndpoint);
  const clientId = `agent-god-mode-browser-${crypto.randomUUID()}`;
  const client = createPaseoClient({ url: endpoint, clientId, appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 15_000 });
  let catalog: ProviderModel[];
  try {
    await client.connect();
    catalog = providerCatalog(await waitForProviders(client));
  } catch (error) {
    throw new Error(`This browser could not reach Paseo over Tailscale. Confirm Tailscale is connected on this device, the .ts.net certificate is valid, and the endpoint ends in /ws. ${error instanceof Error ? error.message : ""}`.trim());
  } finally {
    await client.close().catch(() => undefined);
  }

  const daemon = new DaemonClient({ url: endpoint, clientId: `${clientId}-identity`, clientType: "browser", appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 15_000 });
  try {
    await daemon.connect();
    const status = await daemon.getDaemonStatus();
    const { projects } = await daemon.listProjects();
    for (const project of projects) {
      if (project.projectKind === "git") await daemon.openProject(project.projectRootPath).catch(() => undefined);
    }
    const known = new Map<string, BrowserTailscaleDiscovery>();
    let cursor: string | undefined;
    do {
      const page = await daemon.fetchWorkspaces({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      for (const workspace of page.entries) {
        const remote = workspace.gitRuntime?.remoteUrl ?? workspace.project?.checkout.remoteUrl;
        if (remote) known.set(workspace.projectId, {
          projectId: workspace.projectId,
          projectRootPath: workspace.projectRootPath,
          remote,
          workspaceKind: workspace.workspaceKind,
        });
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return {
      endpoint,
      daemonId: status.serverId,
      daemonVersion: status.version ?? null,
      catalog,
      discoveries: [...known.values()],
    };
  } finally {
    await daemon.close().catch(() => undefined);
  }
}

export async function fetchBrowserTailscaleAgents(endpointInput: string, agents: Array<{ workstreamId: string; agentId: string }>): Promise<BrowserAgentSnapshot[]> {
  if (!agents.length) return [];
  const endpoint = normalizeTailscaleEndpoint(endpointInput);
  const client = createPaseoClient({ url: endpoint, clientId: `agent-god-mode-live-${crypto.randomUUID()}`, appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 8_000 });
  try {
    await client.connect();
    const snapshots: BrowserAgentSnapshot[] = [];
    for (const input of agents.slice(0, 12)) {
      const agent = client.agents.ref(input.agentId);
      const page = await agent.timeline.refetch({ limit: 200, projection: "projected" });
      snapshots.push({ ...input, entries: page.entries as any[], agent: page.agent ?? agent.current() });
    }
    return snapshots;
  } finally {
    await client.close().catch(() => undefined);
  }
}
