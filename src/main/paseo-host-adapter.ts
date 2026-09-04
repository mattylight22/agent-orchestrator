import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceMatch } from "./paseo-manager.js";

export class PaseoHostAdapter {
  private readonly client: DaemonClient;

  constructor(hostId: string, endpoint: string) {
    this.client = new DaemonClient({
      url: endpoint,
      clientId: `agent-lens-projects-${hostId}`,
      clientType: "cli",
      reconnect: { enabled: true, baseDelayMs: 1_000, maxDelayMs: 15_000 },
      connectTimeoutMs: 15_000,
    });
    if (typeof this.client.listProjects !== "function" || typeof this.client.openProject !== "function") {
      throw new Error("This Paseo daemon/client version does not support project discovery");
    }
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async daemonIdentity(): Promise<{ serverId: string; version: string | null }> {
    const status = await this.client.getDaemonStatus();
    return { serverId: status.serverId, version: status.version ?? null };
  }

  async respondToQuestion(
    agentId: string,
    requestId: string,
    input: Record<string, unknown>,
    answers: Record<string, string> | null,
  ): Promise<void> {
    if (typeof this.client.respondToPermissionAndWait !== "function") {
      throw new Error("Update this Paseo host to answer agent questions");
    }
    await this.client.respondToPermissionAndWait(
      agentId,
      requestId,
      answers
        ? { behavior: "allow", updatedInput: { ...input, answers } }
        : { behavior: "deny", message: "Dismissed by user" },
      15_000,
    );
  }

  async resolveCapturedPlan(agentId: string, requestId: string, message: string): Promise<void> {
    if (typeof this.client.respondToPermissionAndWait !== "function") {
      throw new Error("Update this Paseo host to resolve captured plans");
    }
    await this.client.respondToPermissionAndWait(
      agentId,
      requestId,
      { behavior: "deny", message },
      15_000,
    );
  }

  async discoverProjects(
    hostId: string,
    knownProjectIds: Set<string>,
    normalizeRemote: (remote: string | null | undefined) => string | null,
  ): Promise<WorkspaceMatch[]> {
    const { projects } = await this.client.listProjects();
    const openedProjectIds = new Set<string>();
    for (const project of projects) {
      if (project.projectKind !== "git" || knownProjectIds.has(project.projectId)) continue;
      await this.client.openProject(project.projectRootPath);
      openedProjectIds.add(project.projectId);
    }
    if (!openedProjectIds.size) return [];

    const deadline = Date.now() + 5_000;
    const discovered = new Map<string, WorkspaceMatch>();
    do {
      let cursor: string | undefined;
      do {
        const page = await this.client.fetchWorkspaces({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
        for (const workspace of page.entries) {
          if (!openedProjectIds.has(workspace.projectId) || discovered.has(workspace.projectId)) continue;
          const remoteFullName = normalizeRemote(workspace.gitRuntime?.remoteUrl ?? workspace.project?.checkout.remoteUrl);
          if (!remoteFullName) continue;
          discovered.set(workspace.projectId, {
            hostId,
            projectId: workspace.projectId,
            projectRootPath: workspace.projectRootPath,
            remoteFullName,
          });
        }
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor);
      if (discovered.size === openedProjectIds.size || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (true);
    return [...discovered.values()];
  }

  async cloneGithubProject(
    hostId: string,
    remoteFullName: string,
    normalizeRemote: (remote: string | null | undefined) => string | null,
  ): Promise<WorkspaceMatch> {
    if (typeof this.client.cloneGithubProject !== "function") {
      throw new Error("Update this Paseo host to clone missing GitHub projects");
    }

    let cloneUrl = `git@github.com:${remoteFullName}.git`;
    if (typeof this.client.searchGithubRepositories === "function") {
      try {
        const search = await this.client.searchGithubRepositories({ query: remoteFullName, limit: 30 });
        const repository = search.repositories.find(
          (candidate) => candidate.nameWithOwner.toLowerCase() === remoteFullName.toLowerCase(),
        );
        // Paseo's search honors the host's `gh config get git_protocol` preference.
        if (repository) cloneUrl = repository.cloneUrl;
      } catch {
        // Cloning itself only needs git credentials; GitHub CLI search is optional.
      }
    }

    const owner = remoteFullName.split("/")[0];
    const result = await this.client.cloneGithubProject({
      repo: cloneUrl,
      targetDirectory: `~/projects/${owner}`,
    });
    if (result.error || !result.project) {
      if (result.checkoutPath && /checkout path already exists/i.test(result.error ?? "")) {
        const opened = await this.client.openProject(result.checkoutPath);
        const workspace = opened.workspace;
        const existingRemote = normalizeRemote(workspace?.gitRuntime?.remoteUrl ?? workspace?.project?.checkout.remoteUrl);
        if (workspace && existingRemote === remoteFullName.toLowerCase()) {
          return {
            hostId,
            projectId: workspace.projectId,
            projectRootPath: workspace.projectRootPath,
            remoteFullName: existingRemote,
          };
        }
        throw new Error(`The existing checkout at ${result.checkoutPath} is not ${remoteFullName}`);
      }
      throw new Error(result.error || `Paseo could not register ${remoteFullName}`);
    }
    const normalized = normalizeRemote(cloneUrl) ?? remoteFullName.toLowerCase();
    return {
      hostId,
      projectId: result.project.projectId,
      projectRootPath: result.project.projectRootPath,
      remoteFullName: normalized,
    };
  }
}
