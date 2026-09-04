import { AlertTriangle, CheckCircle2, CircleDashed, LoaderCircle } from "lucide-react";
import type { AgentState, WorkstreamPhase, WorkstreamStatus } from "../../../shared/contracts";
import { label } from "../lib/format";

export function StatusChip({ value, kind = "status" }: { value: WorkstreamStatus | WorkstreamPhase | AgentState; kind?: "status" | "phase" | "agent" }) {
  const Icon = value === "running" || value === "building" || value === "independent-review" || value === "planning" ? LoaderCircle : value === "failed" || value === "attention" ? AlertTriangle : value === "reviewed" || value === "merged" || value === "complete" ? CheckCircle2 : CircleDashed;
  return <span className={`status-chip ${kind} ${value}`}><Icon size={12} className={Icon === LoaderCircle ? "spin" : ""} />{label(value)}</span>;
}

