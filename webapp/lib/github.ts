import "server-only";
import { Octokit } from "@octokit/rest";
import { createSupabaseAdminClient } from "./supabase/admin";
import { decryptCredential, encryptCredential } from "./crypto";

interface GithubCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshTokenExpiresAt?: string;
}

function installationAccount(installation: { account?: unknown }) {
  const account = installation.account as Record<string, unknown> | null | undefined;
  return {
    login: String(account?.login ?? account?.slug ?? account?.name ?? "Unknown"),
    type: String(account?.type ?? (account?.slug ? "Organization" : "User")),
  };
}

function githubConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub connections are temporarily unavailable");
  return { clientId, clientSecret };
}

export async function exchangeGithubCode(code: string): Promise<GithubCredential> {
  const config = githubConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
  });
  const value = await response.json() as Record<string, any>;
  if (!response.ok || value.error || !value.access_token) throw new Error(value.error_description ?? value.error ?? "GitHub authorization failed");
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: value.expires_in ? new Date(Date.now() + value.expires_in * 1000).toISOString() : undefined,
    refreshTokenExpiresAt: value.refresh_token_expires_in ? new Date(Date.now() + value.refresh_token_expires_in * 1000).toISOString() : undefined,
  };
}

async function refreshCredential(credential: GithubCredential): Promise<GithubCredential> {
  if (!credential.refreshToken) throw new Error("GitHub authorization expired; reconnect GitHub");
  const config = githubConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: credential.refreshToken }),
  });
  const value = await response.json() as Record<string, any>;
  if (!response.ok || value.error || !value.access_token) throw new Error(value.error_description ?? value.error ?? "GitHub token refresh failed");
  return {
    accessToken: value.access_token, refreshToken: value.refresh_token ?? credential.refreshToken,
    expiresAt: value.expires_in ? new Date(Date.now() + value.expires_in * 1000).toISOString() : undefined,
    refreshTokenExpiresAt: value.refresh_token_expires_in ? new Date(Date.now() + value.refresh_token_expires_in * 1000).toISOString() : credential.refreshTokenExpiresAt,
  };
}

export async function getGithubAccessToken(userId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("github_connections").select("encrypted_credentials").eq("user_id", userId).single();
  if (error || !data) throw new Error("Connect GitHub first");
  let credential = decryptCredential<GithubCredential>(data.encrypted_credentials);
  if (credential.expiresAt && new Date(credential.expiresAt).getTime() < Date.now() + 60_000) {
    credential = await refreshCredential(credential);
    const { error: updateError } = await admin.from("github_connections").update({ encrypted_credentials: encryptCredential(credential) }).eq("user_id", userId);
    if (updateError) throw updateError;
  }
  return credential.accessToken;
}

export async function storeGithubConnection(userId: string, credential: GithubCredential) {
  const octokit = new Octokit({ auth: credential.accessToken, userAgent: "agent-lens-web/0.1" });
  const { data: viewer } = await octokit.rest.users.getAuthenticated();
  const installations = await octokit.paginate(octokit.rest.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
  const compact = installations.map((item) => ({ id: String(item.id), ...installationAccount(item) }));
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("github_connections").upsert({
    user_id: userId, login: viewer.login, encrypted_credentials: encryptCredential(credential), installations: compact,
  });
  if (error) throw error;
}

function repositoryNameFromApiUrl(value: string): string | null {
  const match = value.match(/\/repos\/([^/]+\/[^/]+)$/);
  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

async function recentPullRequestRepositoryIds(octokit: Octokit, login: string, repositories: Map<string, Record<string, unknown>>) {
  const repositoryIdByName = new Map([...repositories.entries()].map(([id, repository]) => [String(repository.full_name).toLowerCase(), id]));
  const activity = new Map<string, number>();
  const record = (items: Array<{ repository_url: string; created_at: string; closed_at?: string | null }>, kind: "authored" | "merged") => {
    for (const item of items) {
      const fullName = repositoryNameFromApiUrl(item.repository_url);
      const repositoryId = fullName ? repositoryIdByName.get(fullName) : undefined;
      if (!repositoryId) continue;
      const timestamp = new Date(kind === "merged" ? item.closed_at ?? item.created_at : item.created_at).getTime();
      activity.set(repositoryId, Math.max(activity.get(repositoryId) ?? 0, Number.isFinite(timestamp) ? timestamp : 0));
    }
  };
  const [authored, merged] = await Promise.all([
    octokit.rest.search.issuesAndPullRequests({ q: `is:pr author:${login}`, sort: "created", order: "desc", per_page: 50 }),
    octokit.rest.search.issuesAndPullRequests({ q: `is:pr is:merged merged-by:${login}`, sort: "updated", order: "desc", per_page: 50 }),
  ]);
  record(authored.data.items, "authored");
  record(merged.data.items, "merged");
  return [...activity.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([id]) => id);
}

export async function syncGithubRepositories(userId: string) {
  const token = await getGithubAccessToken(userId);
  const octokit = new Octokit({ auth: token, userAgent: "agent-lens-web/0.1" });
  const installations = await octokit.paginate(octokit.rest.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
  const rows = new Map<string, Record<string, unknown>>();
  for (const installation of installations) {
    const account = installationAccount(installation);
    const response = await octokit.paginate("GET /user/installations/{installation_id}/repositories", { installation_id: installation.id, per_page: 100 });
    for (const repository of response as any[]) {
      const id = `github:${repository.id}`;
      const previous = rows.get(id);
      const installs = Array.isArray(previous?.installations) ? previous.installations as unknown[] : [];
      rows.set(id, {
        id, user_id: userId, github_id: String(repository.id), full_name: repository.full_name,
        owner: repository.owner.login, name: repository.name, description: repository.description,
        default_branch: repository.default_branch, is_private: repository.private, html_url: repository.html_url,
        github_updated_at: repository.updated_at ?? new Date().toISOString(),
        installations: [...installs, { id: String(installation.id), ...account }],
        source_updated_at: new Date().toISOString(), deleted_at: null,
      });
    }
  }
  const admin = createSupabaseAdminClient();
  if (rows.size) {
    const { error } = await admin.from("repositories").upsert([...rows.values()], { onConflict: "user_id,id" });
    if (error) throw error;
  }
  const active = [...rows.keys()];
  const query = admin.from("repositories").update({ deleted_at: new Date().toISOString() }).eq("user_id", userId);
  if (active.length) query.not("id", "in", `(${active.map((id) => `\"${id}\"`).join(",")})`);
  const { error } = await query;
  if (error) throw error;
  try {
    const { data: viewer } = await octokit.rest.users.getAuthenticated();
    const recentGithubRepositoryIds = await recentPullRequestRepositoryIds(octokit, viewer.login, rows);
    const { data: settings, error: settingsReadError } = await admin.from("user_settings").select("payload").eq("user_id", userId).maybeSingle();
    if (settingsReadError) throw settingsReadError;
    const { error: settingsWriteError } = await admin.from("user_settings").upsert({
      user_id: userId,
      payload: { ...(settings?.payload ?? {}), recentGithubRepositoryIds },
      source_updated_at: new Date().toISOString(),
    });
    if (settingsWriteError) throw settingsWriteError;
  } catch {
    // Repository discovery should still succeed if GitHub search is unavailable or rate-limited.
  }
  return [...rows.values()];
}
