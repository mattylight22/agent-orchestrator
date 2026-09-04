import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Check, ChevronDown, CircleDashed, FileText, GitBranch, Layers3, LoaderCircle, LockKeyhole, Play, Search, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Plan, PlanStatus } from "../../../shared/contracts";
import { exactTime, relativeTime } from "../lib/format";
import { useSnapshot } from "../lib/store";
import { PlanAnnotator } from "./PlanAnnotator";

const statusLabels: Record<PlanStatus, string> = {
  "product-feature": "Product / Feature Plan",
  "implementation-ready": "Implementation Ready",
  cancelled: "Cancelled",
};

const executionLabels: Record<Plan["executionState"], string> = {
  staged: "Staged",
  blocked: "Blocked",
  eligible: "Eligible",
  "in-progress": "In progress",
  completed: "Completed & reviewed",
  cancelled: "Cancelled",
};

export function PlansPage() {
  const snapshot = useSnapshot();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PlanStatus | "all">("all");
  const [repositoryId, setRepositoryId] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.plans[0]?.id ?? null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plans = useMemo(() => snapshot.plans
    .filter((plan) => status === "all" || plan.status === status)
    .filter((plan) => repositoryId === "all" || plan.repositoryId === repositoryId)
    .filter((plan) => `${plan.title} ${plan.repositoryFullName} ${plan.body}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [snapshot.plans, query, status, repositoryId]);
  const selected = snapshot.plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setPending(key); setError(null);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(null); }
  };

  const setPlanStatus = (plan: Plan, next: PlanStatus) => run(`status:${plan.id}`, () => window.lens.updatePlanStatus(plan.id, next));
  const toggleDependency = (plan: Plan, dependencyId: string) => {
    const next = plan.dependencyIds.includes(dependencyId)
      ? plan.dependencyIds.filter((id) => id !== dependencyId)
      : [...plan.dependencyIds, dependencyId];
    return run(`dependencies:${plan.id}`, () => window.lens.setPlanDependencies(plan.id, next));
  };

  return <div className="plans-page">
    <header className="plans-heading">
      <div><div className="eyebrow">Plan library</div><h1>Plans</h1><p>Stage product work, define implementation order, and launch eligible plans.</p></div>
      <div className="plan-metrics"><span><strong>{snapshot.plans.filter((plan) => plan.executionState === "eligible").length}</strong> eligible</span><span><strong>{snapshot.plans.filter((plan) => plan.executionState === "blocked").length}</strong> blocked</span><span><strong>{snapshot.plans.filter((plan) => plan.executionState === "completed").length}</strong> completed</span></div>
    </header>
    <div className="plan-filter-bar">
      <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plan titles, repositories, and contents…" /></label>
      <label className="filter-select"><select value={status} onChange={(event) => setStatus(event.target.value as PlanStatus | "all")}><option value="all">All plan statuses</option>{Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><ChevronDown size={13} /></label>
      <label className="filter-select"><select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="all">All repositories</option>{snapshot.repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select><ChevronDown size={13} /></label>
    </div>
    {error && <div className="banner error plan-banner"><AlertCircle size={16} />{error}</div>}
    <div className="plan-library">
      <aside className="plan-list" aria-label="Plans">
        {plans.map((plan) => <button key={plan.id} className={plan.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(plan.id)}>
          <span className={`plan-state-icon ${plan.executionState}`}>{plan.executionState === "blocked" ? <LockKeyhole size={14} /> : plan.executionState === "completed" ? <Check size={14} /> : plan.executionState === "cancelled" ? <XCircle size={14} /> : <FileText size={14} />}</span>
          <span className="plan-list-copy"><strong>{plan.title}</strong><small>{plan.repositoryFullName}</small><span><i className={`plan-state-dot ${plan.executionState}`} />{executionLabels[plan.executionState]}<time title={exactTime(plan.updatedAt)}>{relativeTime(plan.updatedAt)}</time></span></span>
        </button>)}
        {!plans.length && <div className="plan-list-empty"><FileText size={22} /><strong>No matching plans</strong><span>Finalized Paseo plans will be captured here automatically.</span></div>}
      </aside>
      <main className="plan-viewer">
        {selected ? <PlanDetail plan={selected} plans={snapshot.plans} pending={pending} onStatus={setPlanStatus} onToggleDependency={toggleDependency} onBegin={(plan) => run(`begin:${plan.id}`, () => window.lens.beginPlan(plan.id))} onMarkReviewed={(plan) => run(`reviewed:${plan.id}`, () => window.lens.updateWorkstreamStatus(plan.workstreamId, "reviewed"))} /> : <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><h3>No plan selected</h3><p>Select a plan to view its full Markdown document.</p></div>}
      </main>
    </div>
  </div>;
}

function PlanDetail({
  plan,
  plans,
  pending,
  onStatus,
  onToggleDependency,
  onBegin,
  onMarkReviewed,
}: {
  plan: Plan;
  plans: Plan[];
  pending: string | null;
  onStatus: (plan: Plan, status: PlanStatus) => Promise<void>;
  onToggleDependency: (plan: Plan, dependencyId: string) => Promise<void>;
  onBegin: (plan: Plan) => Promise<void>;
  onMarkReviewed: (plan: Plan) => Promise<void>;
}) {
  const workstream = useSnapshot().workstreams.find((candidate) => candidate.id === plan.workstreamId);
  const prerequisites = plan.dependencyIds.map((id) => plans.find((candidate) => candidate.id === id)).filter(Boolean) as Plan[];
  const candidates = plans.filter((candidate) => candidate.id !== plan.id && candidate.status !== "cancelled");
  const working = pending?.endsWith(plan.id) ?? false;
  const canBegin = plan.executionState === "eligible";
  return <>
    <header className="plan-detail-header">
      <div><div className="plan-detail-meta"><span className={`plan-execution-chip ${plan.executionState}`}>{plan.executionState === "blocked" && <LockKeyhole size={12} />}{executionLabels[plan.executionState]}</span><span>{plan.repositoryFullName}</span><time title={exactTime(plan.updatedAt)}>Updated {relativeTime(plan.updatedAt)}</time></div><h2>{plan.title}</h2><Link to="/workstreams/$workstreamId" params={{ workstreamId: plan.workstreamId }}><GitBranch size={13} />Open linked workstream<ArrowRight size={12} /></Link></div>
      <div className="plan-primary-actions">{workstream?.phase === "complete" && workstream.status !== "reviewed" && workstream.status !== "merged" ? <button className="primary" disabled={Boolean(pending)} onClick={() => void onMarkReviewed(plan)}>{pending === `reviewed:${plan.id}` ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Mark complete & reviewed</button> : <button className="primary" disabled={!canBegin || Boolean(pending)} title={!canBegin ? beginDisabledReason(plan, plans) : "Start the builder agent"} onClick={() => void onBegin(plan)}>{pending === `begin:${plan.id}` ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}Begin implementation</button>}</div>
    </header>
    {plan.blockedByIds.length > 0 && <div className="plan-blocked-banner"><LockKeyhole size={16} /><div><strong>Blocked by prerequisite work</strong><span>{plan.blockedByIds.map((id) => plans.find((candidate) => candidate.id === id)?.title).filter(Boolean).join(" → ")} must be completed and reviewed first.</span></div></div>}
    <section className="plan-controls">
      <div><h3>Plan status</h3><p>Status is editorial; execution eligibility is calculated from prerequisites and workstream progress.</p></div>
      <div className="plan-status-segments">{(Object.keys(statusLabels) as PlanStatus[]).map((status) => <button key={status} className={plan.status === status ? "active" : ""} disabled={working || plan.executionState === "in-progress" || plan.executionState === "completed"} onClick={() => void onStatus(plan, status)}>{plan.status === status && working ? <LoaderCircle className="spin" size={12} /> : status === "cancelled" ? <XCircle size={12} /> : status === "implementation-ready" ? <Check size={12} /> : <CircleDashed size={12} />}{statusLabels[status]}</button>)}</div>
    </section>
    <details className="plan-dependencies" open={plan.dependencyIds.length > 0}>
      <summary><span><Layers3 size={15} /><strong>Prerequisites</strong><small>{prerequisites.length ? `${prerequisites.length} plan${prerequisites.length === 1 ? "" : "s"}` : "No blockers"}</small></span><ChevronDown size={14} /></summary>
      <div>{candidates.length ? candidates.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={plan.dependencyIds.includes(candidate.id)} disabled={Boolean(pending)} onChange={() => void onToggleDependency(plan, candidate.id)} /><span><strong>{candidate.title}</strong><small>{candidate.repositoryFullName} · {executionLabels[candidate.executionState]}</small></span></label>) : <p>No other plans are available as prerequisites.</p>}</div>
    </details>
    <PlanAnnotator plan={plan} className="plan-library-annotator" />
  </>;
}

function beginDisabledReason(plan: Plan, plans: Plan[]): string {
  if (plan.status !== "implementation-ready") return "Mark this plan Implementation Ready first";
  if (plan.blockedByIds.length) return `Blocked by ${plan.blockedByIds.map((id) => plans.find((candidate) => candidate.id === id)?.title).filter(Boolean).join(", ")}`;
  if (plan.executionState === "in-progress") return "Implementation is already in progress";
  if (plan.executionState === "completed") return "This plan is already completed and reviewed";
  if (plan.executionState === "cancelled") return "This plan is cancelled";
  return "This plan is not eligible yet";
}
