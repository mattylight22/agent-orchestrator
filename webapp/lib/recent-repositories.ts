import type { Repository, Workstream } from "@agent-lens/domain";

export function selectRecentRepositories(
  repositories: Repository[],
  workstreams: Workstream[],
  pullRequestRepositoryIds: string[] = [],
  query = "",
  limit = 5,
) {
  const repositoryById = new Map(repositories.map((repository) => [repository.id, repository]));
  const latestWorkstreamActivity = new Map<string, number>();
  for (const workstream of workstreams) {
    const activity = new Date(workstream.updatedAt).getTime();
    latestWorkstreamActivity.set(workstream.repositoryId, Math.max(latestWorkstreamActivity.get(workstream.repositoryId) ?? 0, Number.isFinite(activity) ? activity : 0));
  }
  const workstreamRepositories = [...latestWorkstreamActivity.entries()]
    .sort((left, right) => right[1] - left[1])
    .flatMap(([id]) => repositoryById.get(id) ?? []);
  const included = new Set(workstreamRepositories.map((repository) => repository.id));
  const pullRequestRepositories = pullRequestRepositoryIds
    .flatMap((id) => repositoryById.get(id) ?? [])
    .filter((repository) => !included.has(repository.id));
  const ranked = [...workstreamRepositories, ...pullRequestRepositories].slice(0, limit);
  const normalizedQuery = query.trim().toLowerCase();
  return ranked.filter((repository) => !normalizedQuery || repository.fullName.toLowerCase().includes(normalizedQuery));
}
