export function workstreamRecoveryAction(workstream: {
  phase: string;
  workspaceId: string | null;
  acceptedPlan: string | null;
  status: string;
}) {
  if (workstream.phase !== "attention") return null;
  if (!workstream.workspaceId) return "retry-provision" as const;
  if (workstream.acceptedPlan && workstream.status === "ready-to-build") return "retry-build" as const;
  return null;
}
