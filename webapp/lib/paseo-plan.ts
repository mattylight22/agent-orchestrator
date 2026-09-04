export interface PaseoPlanCandidate {
  body: string;
  permissionId: string | null;
  sourceUpdatedAt: string;
}

type LooseRecord = Record<string, any>;

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function planTextFromPermission(permission: LooseRecord): string | null {
  if (permission?.kind !== "plan") return null;
  return nonEmpty(permission.input?.plan)
    ?? nonEmpty(permission.input?.text)
    ?? (permission.detail?.type === "plan" ? nonEmpty(permission.detail.text) : null);
}

export function planTextFromTimelineItem(item: LooseRecord): string | null {
  if (item?.type !== "tool_call" || item.detail?.type !== "plan") return null;
  return nonEmpty(item.detail.text);
}

export function latestPaseoPlan(entries: LooseRecord[], permissions: LooseRecord[], now = new Date().toISOString()): PaseoPlanCandidate | null {
  const pending = [...permissions].reverse().find((permission) => planTextFromPermission(permission));
  if (pending) {
    return {
      body: planTextFromPermission(pending)!,
      permissionId: nonEmpty(pending.id),
      sourceUpdatedAt: now,
    };
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const body = planTextFromTimelineItem(entries[index]?.item);
    if (!body) continue;
    return {
      body,
      permissionId: null,
      sourceUpdatedAt: nonEmpty(entries[index]?.timestamp) ?? now,
    };
  }
  return null;
}
