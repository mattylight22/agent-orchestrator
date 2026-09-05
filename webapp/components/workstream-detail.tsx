"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Bot, Check, Circle, CircleHelp, GitBranch, Maximize2, MessageSquare, Play, RotateCcw, Send, ShieldCheck } from "lucide-react";
import type { AgentQuestion, PlanStatus } from "@agent-lens/domain";
import { useAgentLens } from "./snapshot-provider";
import { Markdown } from "./markdown";
import { PlanAnnotator, PlanReaderModal } from "./plan-reader-modal";
import { StatusChip } from "./status-chip";
import { workstreamRecoveryAction } from "@/lib/workstream-recovery";

const stages = [
  ["Plan", ["provisioning", "planning", "ready"]], ["Build", ["building"]], ["Review & Fix", ["review-fix"]], ["Pull Request", ["pr-open"]], ["Independent Review", ["independent-review", "complete"]],
] as const;

export function WorkstreamDetail({ id }: { id: string }) {
  const { snapshot, request } = useAgentLens();
  const params = useSearchParams();
  const workstream = snapshot.workstreams.find((item) => item.id === id);
  const plan = snapshot.plans.find((item) => item.workstreamId === id);
  const [tab, setTab] = useState<"timeline" | "plan" | "findings">(params.get("tab") === "plan" ? "plan" : "timeline");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  if (!workstream) return <section className="page"><div className="empty-state standalone"><h2>Workstream Not Found</h2><Link className="button" href="/app">Back to Dashboard</Link></div></section>;
  const action = async (name: string, payload: Record<string, unknown> = {}) => { setBusy(name); try { await request(`/api/workstreams/${id}/actions`, { method: "POST", body: JSON.stringify({ action: name, ...payload }) }); } finally { setBusy(""); } };
  const stageIndex = Math.max(0, stages.findIndex(([, phases]) => (phases as readonly string[]).includes(workstream.phase)));
  const recovery = workstreamRecoveryAction(workstream);
  const primary = recovery === "retry-provision" ? <button className="primary" onClick={() => void action("retry-provision")} disabled={Boolean(busy)}><RotateCcw/>Retry Provisioning</button>
    : recovery === "retry-build" ? <button className="primary" onClick={() => void action("build")} disabled={Boolean(busy)}><RotateCcw/>Retry Build</button>
    : workstream.phase === "ready" ? <button className="primary" onClick={() => void action("build")} disabled={Boolean(busy)}><Play/>Start Build</button>
    : workstream.phase === "building" && workstream.agentState !== "running" ? <button className="primary" onClick={() => void action("review-fix")} disabled={Boolean(busy)}><ShieldCheck/>Review & Fix</button>
    : workstream.phase === "review-fix" && workstream.agentState !== "running" ? <button className="primary" onClick={() => void action("complete-review")} disabled={Boolean(busy)}><GitBranch/>Create Pull Request</button>
    : workstream.phase === "pr-open" ? <button className="primary" onClick={() => void action("independent-review")} disabled={Boolean(busy)}><ShieldCheck/>Start Independent Review</button>
    : plan && plan.status === "product-feature" ? <button className="primary" onClick={() => void request(`/api/plans/${plan.id}/actions`, { method: "POST", body: JSON.stringify({ action: "status", status: "implementation-ready" }) })}><Check/>Mark Ready to Build</button> : null;
  async function followup(event: React.FormEvent) { event.preventDefault(); if (!prompt.trim()) return; const text = prompt; setPrompt(""); await action("followup", { prompt: text }); }
  return <section className="workstream-page">
    <header className="workstream-header"><div><div className="breadcrumbs"><Link href="/app">Workstreams</Link><span>›</span><span>{workstream.repositoryFullName}</span></div><div className="title-line"><h1>{workstream.name}</h1><StatusChip value={workstream.status}/></div><a href={workstream.repositoryUrl + "/tree/" + workstream.branchName} target="_blank" rel="noreferrer"><GitBranch/>{workstream.branchName}<ArrowUpRight/></a></div><div>{primary}</div></header>
    <div className="stage-rail">{stages.map(([label], index) => <div className={index < stageIndex ? "complete" : index === stageIndex ? "active" : ""} key={label}><span>{index < stageIndex ? <Check/> : <Circle/>}</span><strong>{label}</strong><i/></div>)}</div>
    <div className="workstream-body"><div className="workstream-main">
      <div className="tabs"><button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}><MessageSquare/>Timeline</button><button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}><GitBranch/>Captured Plan{plan && <i/>}</button><button className={tab === "findings" ? "active" : ""} onClick={() => setTab("findings")}><ShieldCheck/>Findings</button></div>
      {tab === "timeline" && <Timeline workstream={workstream} plan={plan} comments={plan ? snapshot.planComments.filter((item) => item.planId === plan.id) : []} request={request} onMinimizeAnnotations={() => setTab("plan")} />}
      {tab === "plan" && (plan ? <PlanDetail plan={plan} allPlans={snapshot.plans} comments={snapshot.planComments.filter((item) => item.planId === plan.id)} request={request} /> : <div className="empty-state"><Bot/><h3>Waiting for the Planner</h3><p>The complete plan will appear here and inline in the timeline when Paseo presents it.</p></div>)}
      {tab === "findings" && <Findings workstream={workstream}/>} 
      <form className="composer" onSubmit={followup}><div className="recipient"><i className={workstream.agentState === "running" ? "running" : "online"}/>Following up with <strong>{workstream.agents.at(-1)?.role ?? "agent"}</strong><span>·</span><code>{workstream.agents.at(-1)?.provider}/{workstream.agents.at(-1)?.model}</code></div><div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Ask a question, clarify requirements, or give feedback…" rows={2}/><button className="primary icon-button" disabled={!prompt.trim() || Boolean(busy)}><Send/></button></div><small>Enter to send · Shift+Enter for a new line</small></form>
    </div><Inspector workstream={workstream} request={request}/></div>
  </section>;
}

function Timeline({ workstream, plan, comments, request, onMinimizeAnnotations }: { workstream: any; plan: any; comments: any[]; request: any; onMinimizeAnnotations(): void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [readerMode, setReaderMode] = useState<"read" | "annotate" | null>(null);
  const latestItemId = workstream.timeline.at(-1)?.id;
  useEffect(() => {
    if (!stickToBottom.current) return;
    const frame = requestAnimationFrame(() => {
      const element = scroll.current;
      if (element) element.scrollTo({ top: element.scrollHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [latestItemId, plan?.updatedAt]);
  return <div className="timeline-scroll" ref={scroll} onScroll={() => {
    const element = scroll.current;
    if (element) stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  }}>{workstream.timeline.map((item: any) => {
    const question = item.kind === "question" ? parseQuestion(item.content) : null;
    if (question) return <Question key={item.id} value={question} workstreamId={workstream.id} request={request}/>;
    return <article className={`timeline-item ${item.role}`} key={item.id}><header><span className="agent-avatar">{item.role === "user" ? "Y" : "✣"}</span><strong>{item.role === "user" ? "You" : item.agentRole ? `${item.agentRole} agent` : "Agent"}</strong><time title={new Date(item.createdAt).toLocaleString()}>{relative(item.createdAt)}</time></header><Markdown>{item.content}</Markdown></article>;
  })}{plan && <article className="captured-plan-inline"><header><div><GitBranch/><span><strong>Plan Ready for Review</strong><small>Revisions replace this plan; they do not create duplicates.</small></span></div><StatusChip value={plan.status}/></header><Markdown>{plan.body}</Markdown><footer><button className="button" onClick={() => setReaderMode("read")}><Maximize2/>Read Fullscreen</button><button className="button" onClick={() => setReaderMode("annotate")}>Review and Annotate</button><button className="primary" disabled={plan.status === "implementation-ready"} onClick={() => void request(`/api/plans/${plan.id}/actions`, { method: "POST", body: JSON.stringify({ action: "status", status: "implementation-ready" }) })}><Check/>{plan.status === "implementation-ready" ? "Implementation Ready" : "Mark Ready to Build"}</button></footer></article>}<div ref={end}/>{readerMode && plan && <PlanReaderModal title={plan.title} repository={plan.repositoryFullName} status={plan.status} body={plan.body} mode={readerMode} planId={plan.id} comments={comments} request={request} onMinimize={readerMode === "annotate" ? () => { setReaderMode(null); onMinimizeAnnotations(); } : () => setReaderMode(null)} onClose={() => setReaderMode(null)}/>}</div>;
}

function parseQuestion(content: string): AgentQuestion | null { try { const value = JSON.parse(content); return value?.agentId && value?.requestId && Array.isArray(value.questions) ? value : null; } catch { return null; } }

function Question({ value, workstreamId, request }: { value: AgentQuestion; workstreamId: string; request: any }) {
  const [answers, setAnswers] = useState<Record<string, string>>(value.answers ?? {});
  const [busy, setBusy] = useState(false);
  if (value.status !== "pending") return <article className="question-card resolved"><header><Check/><strong>Agent Question {value.status}</strong></header></article>;
  return <article className="question-card"><header><CircleHelp/><div><strong>Agent Needs Your Input</strong><small>{value.questions.length} decision{value.questions.length === 1 ? "" : "s"}</small></div></header>{value.questions.map((question, index) => <fieldset key={`${question.header}-${index}`}><legend>{question.question}</legend><div className="option-list">{question.options.map((option) => <label key={option.label}><input type={question.multiSelect ? "checkbox" : "radio"} name={`${value.requestId}-${index}`} checked={(answers[question.header] ?? "").split(", ").includes(option.label)} onChange={() => setAnswers((current) => ({ ...current, [question.header]: option.label }))}/><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>)}</div>{question.allowOther && <input placeholder={question.placeholder ?? "Other…"} onChange={(event) => setAnswers((current) => ({ ...current, [question.header]: event.target.value }))}/>}</fieldset>)}<footer><button className="button" disabled={busy} onClick={() => { setBusy(true); void request(`/api/workstreams/${workstreamId}/actions`, { method: "POST", body: JSON.stringify({ action: "question", agentId: value.agentId, requestId: value.requestId, answers: null }) }).finally(() => setBusy(false)); }}>Dismiss</button><button className="primary" disabled={busy || value.questions.some((item) => !item.allowEmpty && !answers[item.header])} onClick={() => { setBusy(true); void request(`/api/workstreams/${workstreamId}/actions`, { method: "POST", body: JSON.stringify({ action: "question", agentId: value.agentId, requestId: value.requestId, answers }) }).finally(() => setBusy(false)); }}><Check/>Submit Answers</button></footer></article>;
}

function PlanDetail({ plan, allPlans, comments, request }: { plan: any; allPlans: any[]; comments: any[]; request: any }) {
  const [status, setStatus] = useState<PlanStatus>(plan.status);
  const [readerMode, setReaderMode] = useState<"read" | "annotate" | null>(null);
  const dependencies = useMemo(() => new Set(plan.dependencyIds), [plan.dependencyIds]);
  return <div className="plan-detail"><div className="plan-actions"><select value={status} onChange={(event) => { const next = event.target.value as PlanStatus; setStatus(next); void request(`/api/plans/${plan.id}/actions`, { method: "POST", body: JSON.stringify({ action: "status", status: next }) }); }}><option value="product-feature">Product / Feature Plan</option><option value="implementation-ready">Implementation Ready</option><option value="cancelled">Cancelled</option></select><details><summary className="button">Dependencies ({plan.dependencyIds.length})</summary><div className="dependency-menu">{allPlans.filter((item) => item.id !== plan.id).map((item) => <label key={item.id}><input type="checkbox" defaultChecked={dependencies.has(item.id)} onChange={(event) => { event.currentTarget.checked ? dependencies.add(item.id) : dependencies.delete(item.id); void request(`/api/plans/${plan.id}/actions`, { method: "POST", body: JSON.stringify({ action: "dependencies", dependencyIds: [...dependencies] }) }); }}/><span>{item.title}<small>{item.executionState}</small></span></label>)}</div></details><button className="button" onClick={() => setReaderMode("read")}><Maximize2/>Read Fullscreen</button><button className="button" onClick={() => setReaderMode("annotate")}>Review and Annotate</button>{status === "implementation-ready" && !plan.blockedByIds.length && <button className="primary" onClick={() => void request(`/api/plans/${plan.id}/actions`, { method: "POST", body: JSON.stringify({ action: "begin" }) })}><Play/>Begin Implementation</button>}</div>
    <PlanAnnotator body={plan.body} planId={plan.id} comments={comments} request={request}/>
    {readerMode && <PlanReaderModal title={plan.title} repository={plan.repositoryFullName} status={status} body={plan.body} mode={readerMode} planId={plan.id} comments={comments} request={request} onMinimize={() => setReaderMode(null)} onClose={() => setReaderMode(null)}/>}
  </div>;
}

function Findings({ workstream }: { workstream: any }) { const reviews = workstream.reviews; return <div className="findings-list">{reviews.flatMap((review: any) => review.findings.map((finding: any, index: number) => <article key={`${review.id}-${index}`} className={`finding ${finding.severity}`}><header><StatusChip value={finding.severity}/><strong>{finding.title}</strong><span>Iteration {review.iteration}</span></header>{finding.file && <code>{finding.file}{finding.line ? `:${finding.line}` : ""}</code>}<p>{finding.explanation}</p><div><strong>Recommendation</strong><p>{finding.recommendation}</p></div></article>))}{!reviews.length && <div className="empty-state"><ShieldCheck/><h3>No Independent Review Yet</h3><p>Findings and iteration history will appear here after a pull request is created.</p></div>}</div>; }

function Inspector({ workstream, request }: { workstream: any; request: any }) { return <aside className="inspector"><section><span className="eyebrow">Workstream</span><label className="inspector-status">Manual Status<select value={workstream.status} disabled={workstream.status === "merged"} onChange={(event) => void request(`/api/workstreams/${workstream.id}/actions`, { method: "POST", body: JSON.stringify({ action: "status", status: event.target.value }) })}><option value="draft">Draft</option><option value="ready-to-build">Ready to Build</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option>{workstream.status === "merged" && <option value="merged">Merged</option>}</select></label><dl><dt>Branch</dt><dd><code>{workstream.branchName}</code></dd><dt>Base</dt><dd><code>{workstream.baseBranch}</code></dd><dt>Agent Instance</dt><dd>{workstream.hostName}</dd><dt>Workspace</dt><dd><code>{workstream.workspaceId ?? "Provisioning…"}</code></dd></dl></section><section><span className="eyebrow">Agents</span>{workstream.agents.map((agent: any) => <div className="agent-row" key={agent.id}><span className="agent-avatar">✣</span><div><strong>{agent.role}</strong><code>{agent.provider}/{agent.model}</code></div><i className={agent.state}/></div>)}</section><section><span className="eyebrow">Pull Request</span>{workstream.prUrl ? <a className="pr-link" href={workstream.prUrl} target="_blank" rel="noreferrer">PR #{workstream.prNumber}<StatusChip value={workstream.prChecks}/><ArrowUpRight/></a> : <p>The pull request is created after Review & Fix is complete.</p>}</section><section><span className="eyebrow">Audit History</span><div className="audit-list">{workstream.audit.map((item: any) => <div key={item.id}><i/><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}<time>{relative(item.createdAt)}</time></span></div>)}</div></section></aside>; }

function relative(value: string) { const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000); return Math.abs(minutes) < 60 ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(minutes, "minute") : new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(minutes / 60), "hour"); }
