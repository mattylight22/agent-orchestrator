import { awsConnectionToken } from "@agent-lens/domain";

const MANAGED_STACK_PATTERN = /^agent-god-mode-paseo-[a-f0-9]{24}$/;

export function isManagedAgentStackName(value: string) {
  return MANAGED_STACK_PATTERN.test(value);
}

export function isStackOwnedByConnection(tags: Array<{ Key?: string; Value?: string }> | undefined, connectionId: string) {
  const values = new Map((tags ?? []).flatMap((tag) => tag.Key && tag.Value ? [[tag.Key, tag.Value] as const] : []));
  return values.get("Application") === "AgentGodMode" && values.get("AgentGodModeConnection") === awsConnectionToken(connectionId);
}
