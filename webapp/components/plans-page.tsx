"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, GitBranch, Maximize2, Search } from "lucide-react";
import type { PlanStatus } from "@agent-lens/domain";
import { useAgentLens } from "./snapshot-provider";
import { PlanReaderModal } from "./plan-reader-modal";
import { StatusChip } from "./status-chip";

export function PlansPage() {
  const { snapshot, request } = useAgentLens();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [reader, setReader] = useState<{ planId: string; mode: "read" | "annotate" } | null>(null);
  const plans = useMemo(() => snapshot.plans.filter((plan) => (!query || `${plan.title} ${plan.repositoryFullName}`.toLowerCase().includes(query.toLowerCase())) && (!status || plan.status === status)), [snapshot.plans, query, status]);
  const readerPlan = snapshot.plans.find((plan) => plan.id === reader?.planId);
  async function update(id: string, next: PlanStatus) { await request(`/api/plans/${id}/actions`, { method: "POST", body: JSON.stringify({ action: "status", status: next }) }); }
  return <section className="page"><header className="page-header"><div><span className="eyebrow">Plan Library</span><h1>Plans</h1><p>Review, stage, sequence, and launch implementation-ready work.</p></div></header>
    <div className="plan-toolbar"><label className="search-field"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plans and repositories…"/></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All Plan Statuses</option><option value="product-feature">Product / Feature Plan</option><option value="implementation-ready">Implementation Ready</option><option value="cancelled">Cancelled</option></select></div>
    <div className="plan-grid">{plans.map((plan) => <article className="plan-card" key={plan.id}><header><div className="plan-icon"><GitBranch/></div><div><Link href={`/app/workstreams/${plan.workstreamId}?tab=plan`}>{plan.title}</Link><small>{plan.repositoryFullName}</small></div><StatusChip value={plan.status}/></header><p>{plan.body.replace(/[#>*`]/g, "").slice(0, 220)}{plan.body.length > 220 ? "…" : ""}</p><div className="plan-meta"><span><StatusChip value={plan.executionState}/></span>{plan.blockedByIds.length > 0 && <span>{plan.blockedByIds.length} prerequisite{plan.blockedByIds.length === 1 ? "" : "s"} pending</span>}</div><footer><select value={plan.status} onChange={(event) => void update(plan.id, event.target.value as PlanStatus)}><option value="product-feature">Product / Feature Plan</option><option value="implementation-ready">Implementation Ready</option><option value="cancelled">Cancelled</option></select><button className="button" onClick={() => setReader({ planId: plan.id, mode: "read" })}><Maximize2/>Read</button><button className="button" onClick={() => setReader({ planId: plan.id, mode: "annotate" })}>Review and Annotate</button>{plan.status === "implementation-ready" && !plan.blockedByIds.length && plan.executionState !== "completed" && <button className="primary" onClick={() => void request(`/api/plans/${plan.id}/actions`, { method: "POST", body: JSON.stringify({ action: "begin" }) })}><Check/>Begin Work</button>}</footer></article>)}</div>
    {!plans.length && <div className="empty-state standalone"><div><GitBranch/></div><h3>No Plans Found</h3><p>Plans captured from Paseo appear here without duplicate records when revised.</p></div>}
    {readerPlan && reader && <PlanReaderModal title={readerPlan.title} repository={readerPlan.repositoryFullName} status={readerPlan.status} body={readerPlan.body} mode={reader.mode} planId={readerPlan.id} comments={snapshot.planComments.filter((item) => item.planId === readerPlan.id)} request={request} workstreamHref={`/app/workstreams/${readerPlan.workstreamId}?tab=plan`} onMinimize={() => setReader(null)} onClose={() => setReader(null)}/>}
  </section>;
}
