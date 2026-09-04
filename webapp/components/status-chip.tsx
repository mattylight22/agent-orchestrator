import type { WorkstreamPhase, WorkstreamStatus } from "@agent-lens/domain";
export function StatusChip({ value }: { value: WorkstreamStatus | WorkstreamPhase | string }) {
  const label = value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return <span className={`status-chip status-${value}`}>{label}</span>;
}
