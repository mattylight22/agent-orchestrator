import "server-only";
import { randomUUID } from "node:crypto";
import { createPaseoClient, type PaseoClient, type PaseoClientConfig } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { parseConnectionOfferFromUrl, type ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
import { normalizeTailscaleEndpoint, type PaseoTransport, type ProviderModel } from "@agent-lens/domain";
import { decryptCredential, encryptCredential } from "./crypto";
import { createSupabaseAdminClient } from "./supabase/admin";

export interface StoredPaseoCapability { offer: ConnectionOffer }
export interface StoredTailscaleConnection { endpoint: string }
export interface PaseoProjectDiscovery { projectId: string; projectRootPath: string; remote: string; workspaceKind: string }

export function parsePairingLink(link: string): ConnectionOffer {
  const offer = parseConnectionOfferFromUrl(link.trim());
  if (!offer) throw new Error("Paste the complete link produced by `paseo daemon pair`");
  return offer;
}

function connection(offer: ConnectionOffer) {
  return {
    url: buildRelayWebSocketUrl({ endpoint: offer.relay.endpoint, useTls: offer.relay.useTls ?? true, serverId: offer.serverId, role: "client" }),
    e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
  };
}

function directConnection(endpoint: string) { return { url: normalizeTailscaleEndpoint(endpoint) }; }

export function providerCatalog(snapshot: any): ProviderModel[] {
  return (snapshot.entries ?? []).flatMap((entry: any) => (entry.models ?? []).map((model: any) => ({
    provider: String(entry.provider), providerLabel: String(entry.label ?? entry.provider),
    model: String(model.id), modelLabel: String(model.label ?? model.id), status: entry.status ?? "error",
    modes: (entry.modes ?? []).map((mode: any) => ({ id: String(mode.id), label: String(mode.label ?? mode.id) })),
    thinkingOptions: (model.thinkingOptions ?? []).map((option: any) => ({ id: String(option.id), label: String(option.label ?? option.id) })),
  })));
}

export async function waitForProviderSnapshot(client: PaseoClient, options: { cwd?: string; timeoutMs?: number } = {}) {
  const { timeoutMs = 60_000, cwd } = options;
  try {
    return await client.providers.waitForReady({ ...(cwd ? { cwd } : {}), timeoutMs });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Update the host to wait for provider discovery.") throw error;
  }

  const deadline = Date.now() + timeoutMs;
  let snapshot = await client.providers.snapshot(cwd ? { cwd } : undefined);
  while (snapshot.entries.some((entry) => entry.status === "loading") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    snapshot = await client.providers.snapshot(cwd ? { cwd } : undefined);
  }
  if (snapshot.entries.some((entry) => entry.status === "loading")) {
    throw new Error("Timed out waiting for provider discovery");
  }
  return snapshot;
}

export async function validatePairingOffer(offer: ConnectionOffer): Promise<ProviderModel[]> {
  const client = createPaseoClient({ ...connection(offer), clientId: `agent-lens-pair-${randomUUID()}`, appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 15_000 });
  try {
    await client.connect();
    const snapshot = await waitForProviderSnapshot(client);
    return providerCatalog(snapshot);
  } finally { await client.close().catch(() => undefined); }
}

export async function validateTailscaleConnection(rawEndpoint: string) {
  const endpoint = normalizeTailscaleEndpoint(rawEndpoint);
  const client = createPaseoClient({ ...directConnection(endpoint), clientId: `agent-lens-tailscale-check-${randomUUID()}`, appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 15_000 });
  let catalog: ProviderModel[];
  try {
    await client.connect();
    catalog = providerCatalog(await waitForProviderSnapshot(client));
  } catch (error) {
    throw new Error(`Agent God Mode could not reach Paseo through Tailscale. Confirm the endpoint, secure certificate, Paseo listener, and that Agent God Mode can access your tailnet. ${error instanceof Error ? error.message : ""}`.trim());
  } finally { await client.close().catch(() => undefined); }
  const daemon = new DaemonClient({ ...directConnection(endpoint), clientId: `agent-lens-tailscale-identity-${randomUUID()}`, clientType: "browser", appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 15_000 });
  try {
    await daemon.connect();
    const status = await daemon.getDaemonStatus();
    return { endpoint, catalog, daemonId: status.serverId, daemonVersion: status.version ?? null };
  } finally { await daemon.close().catch(() => undefined); }
}

async function storePaseoConnection(input: { userId: string; name: string; daemonId: string; daemonVersion?: string | null; endpoint: string; catalog: ProviderModel[]; transport: PaseoTransport; credential: StoredPaseoCapability | StoredTailscaleConnection }) {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from("paseo_hosts").select("id,name,endpoint").eq("user_id", input.userId).eq("daemon_id", input.daemonId).maybeSingle();
  const hostId = existing?.id ?? randomUUID();
  const now = new Date().toISOString();
  const { error: hostError } = await admin.from("paseo_hosts").upsert({
    id: hostId, user_id: input.userId, name: existing?.name ?? input.name.trim(), daemon_id: input.daemonId,
    endpoint: input.transport === "tailscale" ? input.endpoint : (existing?.endpoint ?? ""), enabled: true,
    daemon_version: input.daemonVersion ?? undefined, preferred_transport: input.transport,
    provider_catalog: input.catalog, source_updated_at: now, deleted_at: null,
  });
  if (hostError) throw hostError;
  const { error: secretError } = await admin.from("paseo_connections").upsert({
    id: `${input.transport}:${hostId}`, user_id: input.userId, host_id: hostId, transport: input.transport,
    encrypted_credentials: encryptCredential(input.credential), updated_at: now,
  });
  if (secretError) throw secretError;
  return hostId;
}

export async function storePaseoPairing(userId: string, name: string, offer: ConnectionOffer, catalog: ProviderModel[]) {
  return storePaseoConnection({ userId, name, daemonId: offer.serverId, endpoint: "", catalog, transport: "relay", credential: { offer } });
}

export async function storePaseoTailscaleConnection(userId: string, name: string, value: { endpoint: string; daemonId: string; daemonVersion: string | null; catalog: ProviderModel[] }) {
  const endpoint = normalizeTailscaleEndpoint(value.endpoint);
  return storePaseoConnection({ userId, name, daemonId: value.daemonId, daemonVersion: value.daemonVersion, endpoint, catalog: value.catalog, transport: "tailscale", credential: { endpoint } });
}

async function loadConnections(userId: string, hostId: string): Promise<Array<{ transport: PaseoTransport; config: Pick<PaseoClientConfig, "url" | "e2ee"> }>> {
  const admin = createSupabaseAdminClient();
  const [{ data: host, error: hostError }, { data: rows, error: connectionError }] = await Promise.all([
    admin.from("paseo_hosts").select("preferred_transport").eq("user_id", userId).eq("id", hostId).single(),
    admin.from("paseo_connections").select("transport,encrypted_credentials").eq("user_id", userId).eq("host_id", hostId),
  ]);
  if (hostError || connectionError || !host) throw hostError ?? connectionError ?? new Error("Agent Instance not found");
  const preferred = (host.preferred_transport ?? "relay") as PaseoTransport;
  return (rows ?? []).map((row) => {
    const transport = row.transport as PaseoTransport;
    if (transport === "relay") return { transport, config: connection(decryptCredential<StoredPaseoCapability>(row.encrypted_credentials).offer) };
    return { transport, config: directConnection(decryptCredential<StoredTailscaleConnection>(row.encrypted_credentials).endpoint) };
  }).sort((left, right) => Number(right.transport === preferred) - Number(left.transport === preferred));
}

export async function withPaseoClient<T>(userId: string, hostId: string, action: (client: PaseoClient) => Promise<T>): Promise<T> {
  const candidates = await loadConnections(userId, hostId);
  if (!candidates.length) throw new Error("This Agent Instance has no web connection configured");
  let lastError: unknown;
  for (const candidate of candidates) {
    const client = createPaseoClient({ ...candidate.config, clientId: `agent-lens-workflow-${randomUUID()}`, appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 20_000 });
    try { await client.connect(); }
    catch (error) { lastError = error; await client.close().catch(() => undefined); continue; }
    try { return await action(client); }
    finally { await client.close().catch(() => undefined); }
  }
  throw new Error(`Could not connect to this Agent Instance using its configured transports. ${lastError instanceof Error ? lastError.message : ""}`.trim());
}

export async function withPaseoDaemon<T>(userId: string, hostId: string, action: (client: DaemonClient) => Promise<T>): Promise<T> {
  const candidates = await loadConnections(userId, hostId);
  if (!candidates.length) throw new Error("This Agent Instance has no web connection configured");
  let lastError: unknown;
  for (const candidate of candidates) {
    const client = new DaemonClient({ ...candidate.config, clientId: `agent-lens-daemon-${randomUUID()}`, clientType: "browser", appVersion: "0.1.0", reconnect: { enabled: false }, connectTimeoutMs: 20_000 });
    try { await client.connect(); }
    catch (error) { lastError = error; await client.close().catch(() => undefined); continue; }
    try { return await action(client); }
    finally { await client.close().catch(() => undefined); }
  }
  throw new Error(`Could not connect to this Agent Instance using its configured transports. ${lastError instanceof Error ? lastError.message : ""}`.trim());
}

export function normalizeGithubRemote(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const match = remote.trim().replace(/\.git$/, "").match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

export async function storeHostMappings(userId: string, hostId: string, matches: PaseoProjectDiscovery[]) {
  const admin = createSupabaseAdminClient();
  const { data: repositories, error } = await admin.from("repositories").select("id,full_name").eq("user_id", userId).is("deleted_at", null);
  if (error) throw error;
  const repositoryByName = new Map((repositories ?? []).map((repo) => [repo.full_name.toLowerCase(), repo]));
  const normalizedMatches = matches.flatMap((match) => {
    const remote = normalizeGithubRemote(match.remote);
    return remote ? [{ ...match, remote }] : [];
  });
  const { data: existingMappings, error: existingMappingsError } = await admin
    .from("host_repository_mappings")
    .select("repository_id,project_id")
    .eq("user_id", userId)
    .eq("host_id", hostId);
  if (existingMappingsError) throw existingMappingsError;
  const existingByRepository = new Map((existingMappings ?? []).map((mapping) => [mapping.repository_id, mapping.project_id]));
  type ProjectMatch = (typeof normalizedMatches)[number];
  const candidatesByRepository = new Map<string, { repository: { id: string; full_name: string }; matches: ProjectMatch[] }>();
  for (const match of normalizedMatches) {
    const repository = repositoryByName.get(match.remote);
    if (!repository) continue;
    const group: { repository: { id: string; full_name: string }; matches: ProjectMatch[] } = candidatesByRepository.get(repository.id) ?? { repository, matches: [] };
    group.matches.push(match);
    candidatesByRepository.set(repository.id, group);
  }

  const rows: Array<Record<string, unknown>> = [];
  const ambiguous: string[] = [];
  for (const { repository, matches: candidates } of candidatesByRepository.values()) {
    const existingProjectId = existingByRepository.get(repository.id);
    const checkoutCandidates = candidates.filter((candidate) => candidate.workspaceKind !== "worktree");
    const selected = candidates.find((candidate) => candidate.projectId === existingProjectId)
      ?? (checkoutCandidates.length === 1 ? checkoutCandidates[0] : undefined)
      ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!selected) { ambiguous.push(repository.full_name); continue; }
    rows.push({ id: `${hostId}:${repository.id}`, user_id: userId, host_id: hostId, repository_id: repository.id, project_id: selected.projectId, project_root_path: selected.projectRootPath, remote_url: selected.remote, validated_at: new Date().toISOString() });
  }
  if (rows.length) {
    const { error: mappingError } = await admin.from("host_repository_mappings").upsert(rows, { onConflict: "user_id,host_id,repository_id" });
    if (mappingError) throw mappingError;
  }
  if (ambiguous.length) throw new Error(`Multiple Paseo projects match ${ambiguous.join(", ")}. Select an existing project mapping before provisioning.`);
  return rows;
}

export async function refreshHostMappings(userId: string, hostId: string) {
  const matches = await withPaseoDaemon(userId, hostId, async (client) => {
    const { projects } = await client.listProjects();
    const known = new Map<string, { projectId: string; projectRootPath: string; remote: string; workspaceKind: string }>();
    for (const project of projects) {
      if (project.projectKind !== "git") continue;
      await client.openProject(project.projectRootPath).catch(() => undefined);
    }
    let cursor: string | undefined;
    do {
      const page = await client.fetchWorkspaces({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      for (const workspace of page.entries) {
        const remote = normalizeGithubRemote(workspace.gitRuntime?.remoteUrl ?? workspace.project?.checkout.remoteUrl);
        if (remote) known.set(workspace.projectId, { projectId: workspace.projectId, projectRootPath: workspace.projectRootPath, remote, workspaceKind: workspace.workspaceKind });
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return [...known.values()] as PaseoProjectDiscovery[];
  });
  return storeHostMappings(userId, hostId, matches);
}

export async function ensureHostRepositoryMapping(userId: string, hostId: string, repositoryId: string, fullName: string) {
  const admin = createSupabaseAdminClient();
  let { data: mapping } = await admin.from("host_repository_mappings").select("*").eq("user_id", userId).eq("host_id", hostId).eq("repository_id", repositoryId).maybeSingle();
  if (mapping) return mapping;
  await refreshHostMappings(userId, hostId);
  ({ data: mapping } = await admin.from("host_repository_mappings").select("*").eq("user_id", userId).eq("host_id", hostId).eq("repository_id", repositoryId).maybeSingle());
  if (mapping) return mapping;
  const created = await withPaseoDaemon(userId, hostId, async (client) => {
    const result = await client.cloneGithubProject({ repo: `git@github.com:${fullName}.git`, targetDirectory: `~/projects/${fullName.split("/")[0]}` });
    if (result.error || !result.project) throw new Error(result.error ?? `Paseo could not register ${fullName}`);
    return result.project;
  });
  mapping = { id: `${hostId}:${repositoryId}`, user_id: userId, host_id: hostId, repository_id: repositoryId, project_id: created.projectId, project_root_path: created.projectRootPath, remote_url: fullName.toLowerCase(), validated_at: new Date().toISOString() };
  const { error } = await admin.from("host_repository_mappings").upsert(mapping, { onConflict: "user_id,host_id,repository_id" });
  if (error) throw error;
  return mapping;
}
