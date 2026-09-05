import "server-only";
import { withPaseoDaemon } from "./paseo";

export const PLAN_ACCEPTED_MESSAGE = "Plan captured and marked implementation-ready in Agent God Mode. A separate builder agent will implement it.";

export async function resolvePlanPermission(input: {
  userId: string;
  hostId: string;
  agentId?: string | null;
  permissionId?: string | null;
  message: string | null;
}) {
  if (!input.message || !input.agentId || !input.permissionId) return false;
  return withPaseoDaemon(input.userId, input.hostId, async (client) => {
    const current = await client.fetchAgent(input.agentId!);
    if (!current?.agent.pendingPermissions.some((permission: any) => permission.id === input.permissionId && permission.kind === "plan")) return false;
    await client.respondToPermissionAndWait(input.agentId!, input.permissionId!, { behavior: "deny", message: input.message! }, 15_000);
    return true;
  });
}
