import type { WorkstreamPhase, WorkstreamStatus } from "@agent-lens/domain";
export function StatusChip({ value }: { value: WorkstreamStatus | WorkstreamPhase | string }) {
  return <span className={`status-chip status-${value}`}>{value.replaceAll("-", " ")}</span>;
}
