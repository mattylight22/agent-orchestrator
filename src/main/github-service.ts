import { Octokit } from "@octokit/rest";
import type { Repository } from "../shared/contracts.js";
import { SecretVault } from "./secret-vault.js";

interface GithubSecret {
  accessToken: string;
  login: string;
  clientId?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export class GithubService {
  private readonly vault = new SecretVault();
  private secret: GithubSecret | null = this.vault.read<GithubSecret>();
  private refreshPromise: Promise<void> | null = null;

  connected(): boolean {
    return Boolean(this.secret?.accessToken);
  }

  login(): string | null {
    return this.secret?.login ?? null;
  }

  disconnect(): void {
    this.secret = null;
    this.vault.clear();
  }

  private async octokit(): Promise<Octokit> {
    if (!this.secret) throw new Error("Connect GitHub first");
    if (this.secret.expiresAt && this.secret.expiresAt <= Date.now() + 5 * 60_000) await this.refreshToken();
    return new Octokit({ auth: this.secret.accessToken, userAgent: "agent-lens/0.1" });
  }

  private async refreshToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    const secret = this.secret;
    if (!secret?.refreshToken || !secret.clientId) throw new Error("GitHub authorization has expired; reconnect GitHub");
    if (secret.refreshExpiresAt && secret.refreshExpiresAt <= Date.now()) throw new Error("GitHub refresh authorization has expired; reconnect GitHub");
    this.refreshPromise = (async () => {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: secret.clientId!,
          grant_type: "refresh_token",
          refresh_token: secret.refreshToken!,
        }),
      });
      const token = (await response.json()) as {
        access_token?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; error?: string;
      };
      if (!token.access_token) throw new Error(`GitHub token refresh failed: ${token.error ?? response.status}`);
      this.secret = {
        ...secret,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? secret.refreshToken,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1_000 : undefined,
        refreshExpiresAt: token.refresh_token_expires_in ? Date.now() + token.refresh_token_expires_in * 1_000 : secret.refreshExpiresAt,
      };
      this.vault.write(this.secret);
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async authenticateDevice(
    clientId: string,
    onVerification: (payload: { verificationUri: string; userCode: string }) => void,
  ): Promise<string> {
    if (!clientId.trim()) throw new Error("Enter the GitHub App client ID first");
    const codeResponse = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId }),
    });
    if (!codeResponse.ok) throw new Error(`GitHub device authorization failed (${codeResponse.status})`);
    const device = (await codeResponse.json()) as DeviceCodeResponse;
    onVerification({ verificationUri: device.verification_uri, userCode: device.user_code });

    const expiresAt = Date.now() + device.expires_in * 1_000;
    let interval = device.interval * 1_000;
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const token = (await tokenResponse.json()) as {
        access_token?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; error?: string;
      };
      if (token.access_token) {
        const octokit = new Octokit({ auth: token.access_token });
        const user = await octokit.rest.users.getAuthenticated();
        this.secret = {
          accessToken: token.access_token,
          login: user.data.login,
          clientId,
          refreshToken: token.refresh_token,
          expiresAt: token.expires_in ? Date.now() + token.expires_in * 1_000 : undefined,
          refreshExpiresAt: token.refresh_token_expires_in ? Date.now() + token.refresh_token_expires_in * 1_000 : undefined,
        };
        this.vault.write(this.secret);
        return user.data.login;
      }
      if (token.error === "slow_down") interval += 5_000;
      else if (token.error !== "authorization_pending") throw new Error(`GitHub authorization failed: ${token.error}`);
    }
    throw new Error("GitHub authorization expired before it was completed");
  }

  async listRepositories(): Promise<Repository[]> {
    const octokit = await this.octokit();
    const installations = await octokit.paginate(octokit.rest.apps.listInstallationsForAuthenticatedUser, {
      per_page: 100,
    });
    const byId = new Map<string, Repository>();
    for (const installation of installations) {
      const repos = await octokit.paginate(octokit.rest.apps.listInstallationReposForAuthenticatedUser, {
        installation_id: installation.id,
        per_page: 100,
      });
      for (const repo of repos) {
        const id = String(repo.id);
        const existing = byId.get(id);
        byId.set(id, {
          id,
          fullName: repo.full_name,
          owner: repo.owner.login,
          name: repo.name,
          description: repo.description,
          defaultBranch: repo.default_branch,
          private: repo.private,
          htmlUrl: repo.html_url,
          updatedAt: repo.updated_at ?? new Date().toISOString(),
          installations: [...new Set([...(existing?.installations ?? []), String(installation.id)])],
          hostAvailability: existing?.hostAvailability ?? [],
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async createBranch(repositoryFullName: string, baseBranch: string, branchName: string, resolvedBaseSha?: string): Promise<string> {
    const [owner, repo] = repositoryFullName.split("/");
    if (!owner || !repo) throw new Error("Invalid repository name");
    const octokit = await this.octokit();
    const sha = resolvedBaseSha ?? (await octokit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` })).data.object.sha;
    try {
      await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha });
    } catch (error) {
      if (error instanceof Error && /Reference already exists/i.test(error.message)) {
        throw new Error(`Branch ${branchName} already exists`);
      }
      throw error;
    }
    return sha;
  }

  async branchSha(repositoryFullName: string, branchName: string): Promise<string> {
    const [owner, repo] = repositoryFullName.split("/");
    if (!owner || !repo) throw new Error("Invalid repository name");
    const result = await (await this.octokit()).rest.git.getRef({ owner, repo, ref: `heads/${branchName}` });
    return result.data.object.sha;
  }

  async findOrCreatePullRequest(input: {
    repositoryFullName: string;
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string; body: string }> {
    const [owner, repo] = input.repositoryFullName.split("/");
    if (!owner || !repo) throw new Error("Invalid repository name");
    const octokit = await this.octokit();
    const existing = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${input.branchName}`, state: "open" });
    const pull = existing.data[0] ?? (await octokit.rest.pulls.create({
      owner,
      repo,
      head: input.branchName,
      base: input.baseBranch,
      title: input.title,
      body: input.body,
      draft: false,
    })).data;
    return { number: pull.number, url: pull.html_url, body: pull.body ?? input.body };
  }

  async updatePullRequestBody(repositoryFullName: string, number: number, body: string): Promise<void> {
    const [owner, repo] = repositoryFullName.split("/");
    if (!owner || !repo) throw new Error("Invalid repository name");
    await (await this.octokit()).rest.pulls.update({ owner, repo, pull_number: number, body });
  }

  async getPullRequest(repositoryFullName: string, number: number): Promise<{ body: string; merged: boolean; state: string }> {
    const [owner, repo] = repositoryFullName.split("/");
    if (!owner || !repo) throw new Error("Invalid repository name");
    const result = await (await this.octokit()).rest.pulls.get({ owner, repo, pull_number: number });
    return { body: result.data.body ?? "", merged: result.data.merged, state: result.data.state };
  }

  async pullRequestState(repositoryFullName: string, number: number): Promise<{
    merged: boolean;
    state: string;
    checks: "none" | "pending" | "success" | "failure";
  }> {
    const [owner, repo] = repositoryFullName.split("/");
    if (!owner || !repo) throw new Error("Invalid repository name");
    const octokit = await this.octokit();
    const pull = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
    const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
      owner, repo, ref: pull.data.head.sha, per_page: 100,
    });
    const failureConclusions = new Set(["failure", "cancelled", "timed_out", "action_required", "stale"]);
    const checks = runs.length === 0
      ? "none"
      : runs.some((run) => run.conclusion && failureConclusions.has(run.conclusion))
        ? "failure"
        : runs.every((run) => run.status === "completed")
          ? "success"
          : "pending";
    return { merged: pull.data.merged, state: pull.data.state, checks };
  }
}
