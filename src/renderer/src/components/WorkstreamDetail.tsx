import { Link, useParams } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Circle, CircleHelp, Clock3, Code2, ExternalLink, FileSearch, GitBranch, GitCommitHorizontal, GitPullRequest, LoaderCircle, MessageSquare, MoreHorizontal, PanelRightClose, PanelRightOpen, Play, Send, Server, ShieldCheck, Sparkles, TerminalSquare, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentQuestion, AgentRole, Plan, PlanStatus, Workstream } from "../../../shared/contracts";
import { exactTime, label, relativeTime } from "../lib/format";
import { useSnapshot } from "../lib/store";
import { Markdown } from "./Markdown";
import { PlanAnnotator } from "./PlanAnnotator";
import { StatusChip } from "./StatusChip";

const stages = [
  ["Plan", "planning", "ready"], ["Build", "building"], ["Review & Fix", "review-fix"], ["Pull request", "pr-open"], ["Independent review", "independent-review", "complete"],
] as const;

export function WorkstreamDetail() {
  const { workstreamId } = useParams({ from: "/workstreams/$workstreamId" });
  const snapshot = useSnapshot();
  const workstream = snapshot.workstreams.find((item) => item.id === workstreamId);
  const capturedPlan = snapshot.plans.find((plan) => plan.workstreamId === workstreamId);
  const [tab, setTab] = useState<"timeline" | "plan" | "findings">("timeline");
  const [inspector, setInspector] = useState(true);
  const [followup, setFollowup] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workContentRef = useRef<HTMLDivElement>(null);
  const lastPlanUpdateRef = useRef<string | null>(null);
  const timelineLength = workstream?.timeline.length ?? 0;
  const timelineTail = workstream?.timeline.at(-1)?.content;
  useEffect(() => {
    if (tab !== "timeline") return;
    const element = workContentRef.current;
    if (!element) return;
    const lastItem = workstream?.timeline.at(-1);
    const incomingQuestion = lastItem?.kind === "question" && parseQuestion(lastItem.content)?.status === "pending";
    const planArrived = Boolean(capturedPlan?.updatedAt && capturedPlan.updatedAt !== lastPlanUpdateRef.current);
    lastPlanUpdateRef.current = capturedPlan?.updatedAt ?? null;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 140;
    if (incomingQuestion || planArrived || nearBottom) requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }));
  }, [tab, timelineLength, timelineTail, capturedPlan?.updatedAt, workstream]);
  if (!workstream) return <div className="page missing"><h1>Workstream not found</h1><Link to="/" search={{ repo: undefined }}>Back to dashboard</Link></div>;
  const pendingQuestion = workstream.timeline.some((item) => item.kind === "question" && parseQuestion(item.content)?.status === "pending");
  const revisingCapturedPlan = capturedPlan?.status === "product-feature" && workstream.phase === "planning" && workstream.agents.at(-1)?.role === "planner";

  const run = async (key: string, action: () => Promise<unknown>) => {
    setPending(key); setError(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setPending(null); }
  };
  const primary = primaryAction(workstream);
  const executePrimary = () => {
    if (primary.key === "plan") return run("plan", () => window.lens.markPlanReady(workstream.id));
    if (primary.key === "build") return run("build", () => window.lens.startBuild(workstream.id));
    if (primary.key === "review") return run("review", () => window.lens.startReviewFix(workstream.id));
    if (primary.key === "pr") return run("pr", () => window.lens.completeReview(workstream.id));
    if (primary.key === "independent") return run("independent", () => window.lens.startIndependentReview(workstream.id));
    if (workstream.prUrl) return run("open", () => window.lens.openExternal(workstream.prUrl!));
    return Promise.resolve();
  };
  const submitFollowup = async () => {
    if (!followup.trim()) return;
    const message = followup; setFollowup("");
    await run("followup", () => window.lens.sendFollowup(workstream.id, message));
  };
  const updateCapturedPlanStatus = (status: PlanStatus) => {
    if (!capturedPlan) return Promise.resolve();
    return run(`plan-status:${status}`, () => window.lens.updatePlanStatus(capturedPlan.id, status));
  };
  const beginCapturedPlan = () => {
    if (!capturedPlan) return Promise.resolve();
    return run("plan-begin", async () => {
      if (capturedPlan.status !== "implementation-ready") {
        await window.lens.updatePlanStatus(capturedPlan.id, "implementation-ready");
      }
      await window.lens.beginPlan(capturedPlan.id);
    });
  };

  return <div className={`detail-page ${inspector ? "with-inspector" : ""}`}>
    <header className="detail-header">
      <div className="detail-breadcrumb"><Link to="/" search={{ repo: undefined }}><ArrowLeft size={15} />Workstreams</Link><ChevronRight size={13} /><span>{workstream.repositoryFullName}</span></div>
      <div className="detail-title-row"><div><div className="detail-title"><h1>{workstream.name}</h1><StatusChip value={workstream.status} /></div><button className="branch-link" onClick={() => void window.lens.openExternal(`${workstream.repositoryUrl}/tree/${workstream.branchName}`)}><GitBranch size={13} /><code>{workstream.branchName}</code><ExternalLink size={12} /></button></div><div className="detail-actions"><button className="icon-button" onClick={() => setInspector(!inspector)} title="Toggle inspector">{inspector ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button><button className="icon-button"><MoreHorizontal size={18} /></button><button className="primary lifecycle-action" onClick={() => void executePrimary()} disabled={Boolean(pending) || workstream.agentState === "running" || pendingQuestion}>{pending ? <LoaderCircle className="spin" size={16} /> : primary.icon}{primary.label}</button></div></div>
      <StageRail workstream={workstream} />
      {error && <div className="banner error inline-banner"><AlertCircle size={16} />{error}</div>}
    </header>
    <div className="detail-body">
      <section className="work-area">
        <div className="tabs"><button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}><MessageSquare size={14} />Timeline</button><button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}><FileSearch size={14} />Plan{capturedPlan && <em>Captured</em>}</button><button className={tab === "findings" ? "active" : ""} onClick={() => setTab("findings")}><ShieldCheck size={14} />Findings {workstream.reviews.flatMap((item) => item.findings).length > 0 && <span>{workstream.reviews.flatMap((item) => item.findings).length}</span>}</button></div>
        <div className="work-content" ref={workContentRef}>
          {tab === "timeline" && <Timeline workstream={workstream} capturedPlan={capturedPlan} pending={pending} onViewPlan={() => setTab("plan")} onPlanStatus={updateCapturedPlanStatus} onBeginPlan={beginCapturedPlan} onRespondToQuestion={(agentId, requestId, answers) => run(`question:${requestId}`, () => window.lens.respondToAgentQuestion(workstream.id, agentId, requestId, answers))} />}
          {tab === "plan" && (capturedPlan ? <PlanAnnotator plan={capturedPlan} /> : workstream.acceptedPlan ? <article className="plan-document"><div className="document-meta"><span>Accepted plan</span><time>{exactTime(workstream.updatedAt)}</time></div><Markdown>{workstream.acceptedPlan}</Markdown></article> : <EmptyPlan />)}
          {tab === "findings" && <Findings workstream={workstream} />}
        </div>
        <div className="composer-wrap"><div className="composer-context"><span className={`presence ${pendingQuestion || workstream.agentState === "running" ? "connecting" : "connected"}`} />{pendingQuestion ? "Waiting for an answer from you" : revisingCapturedPlan ? "Requesting plan changes from" : "Following up with"} {!pendingQuestion && <><strong>{latestRole(workstream)}</strong><span>·</span><span>{latestModel(workstream)}</span></>}</div><div className="composer"><textarea value={followup} onChange={(event) => setFollowup(event.target.value)} placeholder={revisingCapturedPlan ? "Describe what should change in the captured plan…" : "Ask a question, clarify requirements, or give feedback…"} onKeyDown={(event) => { if (event.key === "Enter" && event.metaKey) { event.preventDefault(); void submitFollowup(); } }} /><button className="send-button" aria-label={revisingCapturedPlan ? "Request plan revision" : "Send follow-up"} onClick={() => void submitFollowup()} disabled={!followup.trim() || Boolean(pending)}>{pending === "followup" ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}</button></div><div className="composer-hint"><span>⌘ Enter to send</span><span>{pendingQuestion ? "Answer the agent question above to continue" : revisingCapturedPlan ? "Feedback asks the planner to revise and resubmit this plan" : workstream.agentState === "running" ? "Agent is currently working" : "Follow-ups continue in the same session"}</span></div></div>
      </section>
      {inspector && <Inspector workstream={workstream} />}
    </div>
  </div>;
}

function StageRail({ workstream }: { workstream: Workstream }) {
  const active = Math.max(0, stages.findIndex((stage) => stage.slice(1).includes(workstream.phase as never)));
  return <div className="stage-rail">{stages.map((stage, index) => <div key={stage[0]} className={`${index < active ? "done" : ""} ${index === active ? "active" : ""}`}><span>{index < active ? <Check size={12} /> : index === active && workstream.agentState === "running" ? <LoaderCircle className="spin" size={12} /> : <Circle size={9} />}</span><strong>{stage[0]}</strong>{index < stages.length - 1 && <i />}</div>)}</div>;
}

function primaryAction(workstream: Workstream) {
  if (workstream.phase === "planning") return { key: "plan", label: "Mark ready to build", icon: <Check size={16} /> };
  if (workstream.phase === "ready") return { key: "build", label: "Start build", icon: <Play size={16} /> };
  if (workstream.phase === "building") return { key: "review", label: "Start Review & Fix", icon: <FileSearch size={16} /> };
  if (workstream.phase === "review-fix") return { key: "pr", label: "Mark review complete", icon: <GitPullRequest size={16} /> };
  if (workstream.phase === "pr-open") return { key: "independent", label: "Start independent review", icon: <ShieldCheck size={16} /> };
  return { key: "open", label: workstream.prUrl ? "Open pull request" : "Awaiting attention", icon: workstream.prUrl ? <ExternalLink size={16} /> : <AlertCircle size={16} /> };
}

function Timeline({
  workstream,
  capturedPlan,
  pending,
  onViewPlan,
  onPlanStatus,
  onBeginPlan,
  onRespondToQuestion,
}: {
  workstream: Workstream;
  capturedPlan?: Plan;
  pending: string | null;
  onViewPlan: () => void;
  onPlanStatus: (status: PlanStatus) => Promise<unknown>;
  onBeginPlan: () => Promise<unknown>;
  onRespondToQuestion: (agentId: string, requestId: string, answers: Record<string, string> | null) => Promise<void>;
}) {
  if (!workstream.timeline.length && !capturedPlan) return <div className="empty-state"><div className="empty-icon"><MessageSquare size={21} /></div><h3>No timeline events yet</h3><p>The provisioning and agent timeline will appear here.</p></div>;
  return <div className="timeline">{workstream.timeline.map((item) => {
    if (item.kind === "status") return <div className="timeline-status" key={item.id}><span><Clock3 size={13} /></span><p>{item.content}</p><time title={exactTime(item.createdAt)}>{relativeTime(item.createdAt)}</time></div>;
    if (item.kind === "question") return <QuestionCard key={item.id} content={item.content} createdAt={item.createdAt} onRespond={onRespondToQuestion} />;
    return <article key={item.id} className={`message ${item.role}`}><header><div className={`avatar ${item.role}`}>{item.role === "user" ? "You" : item.role === "tool" ? <TerminalSquare size={14} /> : <Sparkles size={14} />}</div><strong>{item.role === "user" ? "You" : item.role === "tool" ? "Tool activity" : `${label(item.agentRole ?? "agent")} agent`}</strong><span>{item.agentRole && latestAgentFor(workstream, item.agentRole)}</span><time title={exactTime(item.createdAt)}>{relativeTime(item.createdAt)}</time></header><Markdown>{item.content}</Markdown></article>;
  })}{capturedPlan && <CapturedPlanCard plan={capturedPlan} pending={pending} onViewPlan={onViewPlan} onStatus={onPlanStatus} onBegin={onBeginPlan} />}</div>;
}

const planStatusLabels: Record<PlanStatus, string> = {
  "product-feature": "Product / Feature",
  "implementation-ready": "Implementation Ready",
  cancelled: "Cancelled",
};

function CapturedPlanCard({
  plan,
  pending,
  onViewPlan,
  onStatus,
  onBegin,
}: {
  plan: Plan;
  pending: string | null;
  onViewPlan: () => void;
  onStatus: (status: PlanStatus) => Promise<unknown>;
  onBegin: () => Promise<unknown>;
}) {
  const busy = pending?.startsWith("plan-") ?? false;
  const cannotBegin = plan.executionState === "blocked" || plan.executionState === "in-progress" || plan.executionState === "completed" || plan.executionState === "cancelled";
  const beginLabel = plan.executionState === "in-progress" ? "Implementation in progress" : plan.executionState === "completed" ? "Implementation complete" : "Begin implementation";
  return <article className={`captured-plan-card ${plan.status}`} aria-live="polite">
    <header>
      <div className="captured-plan-icon"><FileSearch size={16} /></div>
      <div><span>Plan captured from Paseo</span><h2>{plan.title}</h2></div>
      <time title={exactTime(plan.updatedAt)}>{relativeTime(plan.updatedAt)}</time>
    </header>
    <div className="captured-plan-preview"><Markdown>{plan.body}</Markdown></div>
    <footer>
      <div className="captured-plan-status" aria-label="Plan status">
        {(Object.keys(planStatusLabels) as PlanStatus[]).map((status) => <button key={status} className={plan.status === status ? "active" : ""} disabled={busy || plan.executionState === "in-progress" || plan.executionState === "completed"} onClick={() => void onStatus(status)}>{pending === `plan-status:${status}` ? <LoaderCircle className="spin" size={12} /> : status === "implementation-ready" ? <Check size={12} /> : status === "cancelled" ? <X size={12} /> : <Circle size={10} />}{planStatusLabels[status]}</button>)}
      </div>
      <div className="captured-plan-actions"><button className="secondary" onClick={onViewPlan}>View full plan</button><button className="primary" disabled={busy || cannotBegin} title={plan.executionState === "blocked" ? "Complete and review prerequisite plans first" : undefined} onClick={() => void onBegin()}>{pending === "plan-begin" ? <LoaderCircle className="spin" size={14} /> : plan.executionState === "completed" ? <CheckCircle2 size={14} /> : <Play size={14} />}{beginLabel}</button></div>
    </footer>
  </article>;
}

function parseQuestion(content: string): AgentQuestion | null {
  try {
    const value = JSON.parse(content) as Partial<AgentQuestion>;
    return value.agentId && value.requestId && Array.isArray(value.questions) && value.status ? value as AgentQuestion : null;
  } catch {
    return null;
  }
}

function QuestionCard({
  content,
  createdAt,
  onRespond,
}: {
  content: string;
  createdAt: string;
  onRespond: (agentId: string, requestId: string, answers: Record<string, string> | null) => Promise<void>;
}) {
  const question = useMemo(() => parseQuestion(content), [content]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  if (!question) return <article className="message tool"><header><div className="avatar tool"><TerminalSquare size={14} /></div><strong>Tool activity</strong><time title={exactTime(createdAt)}>{relativeTime(createdAt)}</time></header><Markdown>{content}</Markdown></article>;

  const active = question.questions[Math.min(activeIndex, question.questions.length - 1)];
  const isPending = question.status === "pending";
  const isAnswered = (index: number) => {
    const prompt = question.questions[index];
    return Boolean(selections[index]?.length || otherTexts[index]?.trim() || (prompt.allowEmpty && prompt.options.length === 0));
  };
  const allAnswered = question.questions.every((_prompt, index) => isAnswered(index));
  const toggle = (optionIndex: number) => {
    if (!isPending || submitting) return;
    setSelections((current) => {
      const selected = current[activeIndex] ?? [];
      const next = active.multiSelect
        ? selected.includes(optionIndex) ? selected.filter((value) => value !== optionIndex) : [...selected, optionIndex]
        : selected.includes(optionIndex) ? [] : [optionIndex];
      return { ...current, [activeIndex]: next };
    });
    setOtherTexts((current) => ({ ...current, [activeIndex]: "" }));
    if (!active.multiSelect && activeIndex < question.questions.length - 1) setActiveIndex(activeIndex + 1);
  };
  const submit = async (answers: Record<string, string> | null) => {
    setSubmitting(true); setLocalError(null);
    try { await onRespond(question.agentId, question.requestId, answers); }
    catch (reason) { setLocalError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmitting(false); }
  };
  const submitAnswers = () => {
    if (!allAnswered) return;
    const answers: Record<string, string> = {};
    question.questions.forEach((prompt, index) => {
      const other = otherTexts[index]?.trim();
      if (other) answers[prompt.header] = other;
      else answers[prompt.header] = (selections[index] ?? []).map((optionIndex) => prompt.options[optionIndex]?.label).filter(Boolean).join(", ");
    });
    void submit(answers);
  };

  return <article className={`agent-question ${question.status}`} aria-live="polite">
    <header><div className="question-heading"><span><CircleHelp size={15} /></span><div><strong>Agent needs your input</strong><small>{question.questions.length} decision{question.questions.length === 1 ? "" : "s"}</small></div></div><time title={exactTime(createdAt)}>{relativeTime(createdAt)}</time></header>
    {question.questions.length > 1 && <div className="question-tabs" role="tablist">{question.questions.map((prompt, index) => <button key={`${prompt.header}-${index}`} role="tab" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={() => setActiveIndex(index)} disabled={submitting}>{isAnswered(index) && <Check size={11} />}{prompt.header}</button>)}</div>}
    <div className="question-body">
      <h3>{active.question}</h3>
      <div className="question-options" role={active.multiSelect ? "group" : "radiogroup"}>{active.options.map((option, optionIndex) => {
        const selected = selections[activeIndex]?.includes(optionIndex) ?? false;
        return <button key={`${option.label}-${optionIndex}`} className={selected ? "selected" : ""} role={active.multiSelect ? "checkbox" : "radio"} aria-checked={selected} onClick={() => toggle(optionIndex)} disabled={!isPending || submitting}><i>{selected && (active.multiSelect ? <Check size={11} /> : <span />)}</i><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></button>;
      })}</div>
      {(active.allowOther || active.options.length === 0) && <input value={otherTexts[activeIndex] ?? ""} onChange={(event) => { const value = event.target.value; setOtherTexts((current) => ({ ...current, [activeIndex]: value })); if (value) setSelections((current) => ({ ...current, [activeIndex]: [] })); }} placeholder={active.placeholder ?? (active.options.length ? "Other…" : "Type your answer…")} disabled={!isPending || submitting} />}
    </div>
    <footer>{localError && <span className="question-error"><AlertCircle size={13} />{localError}</span>}{isPending ? <div className="question-actions"><button onClick={() => void submit(null)} disabled={submitting}><X size={13} />Dismiss</button><button className="primary" onClick={submitAnswers} disabled={!allAnswered || submitting}>{submitting ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}Submit answers</button></div> : <div className="question-resolved"><CheckCircle2 size={14} />{question.status === "dismissed" ? "Dismissed" : "Answered"}</div>}</footer>
  </article>;
}

function EmptyPlan() { return <div className="empty-state"><div className="empty-icon"><FileSearch size={21} /></div><h3>The plan isn’t frozen yet</h3><p>Review the planner timeline, send any follow-ups, then mark the plan ready to build.</p></div>; }

function Findings({ workstream }: { workstream: Workstream }) {
  if (!workstream.reviews.length) return <div className="empty-state"><div className="empty-icon"><ShieldCheck size={21} /></div><h3>No independent review yet</h3><p>After the pull request opens, start an independent review to populate structured findings.</p></div>;
  return <div className="findings-list">{[...workstream.reviews].reverse().map((iteration) => <section className="review-iteration" key={iteration.id}><header><div><span>Iteration {iteration.iteration}</span><StatusChip value={iteration.verdict === "clean" ? "reviewed" : iteration.verdict === "blocked" ? "attention" : "unreviewed"} /></div><time>{exactTime(iteration.createdAt)}</time></header>{iteration.findings.length ? iteration.findings.map((finding, index) => <article className={`finding ${finding.severity}`} key={`${finding.title}-${index}`}><div className="severity">{finding.severity}</div><div><h3>{finding.title}</h3>{finding.file && <code>{finding.file}{finding.line ? `:${finding.line}` : ""}</code>}<p>{finding.explanation}</p><strong>Recommendation</strong><p>{finding.recommendation}</p></div></article>) : <div className="clean-verdict"><CheckCircle2 size={19} /><div><strong>No actionable findings</strong><span>The reviewer completed a clean pass.</span></div></div>}{iteration.fixSummary && <div className="fix-summary"><GitCommitHorizontal size={16} /><div><strong>Builder fix summary</strong><p>{iteration.fixSummary}</p>{iteration.commitSha && <code>{iteration.commitSha}</code>}</div></div>}</section>)}</div>;
}

function Inspector({ workstream }: { workstream: Workstream }) {
  const host = useSnapshot().hosts.find((item) => item.id === workstream.hostId);
  return <aside className="inspector">
    <InspectorSection title="Workstream"><DataRow icon={<GitBranch size={14} />} label="Branch" value={workstream.branchName} mono /><DataRow icon={<Code2 size={14} />} label="Base" value={workstream.baseBranch} mono /><DataRow icon={<Server size={14} />} label="Host" value={workstream.hostName} /><DataRow icon={<Circle size={14} />} label="Host state" value={host?.health ?? "offline"} /></InspectorSection>
    <InspectorSection title="Agents">{workstream.agents.length ? [...workstream.agents].reverse().map((agent) => <div className="agent-card" key={agent.id}><div className={`agent-icon ${agent.role}`}><Sparkles size={14} /></div><div><strong>{label(agent.role)}</strong><code>{agent.provider}/{agent.model}</code></div><span className={`presence ${agent.state === "running" || agent.state === "attention" ? "connecting" : agent.state === "failed" ? "error" : "connected"}`} /></div>) : <p className="inspector-empty">No agents yet.</p>}</InspectorSection>
    <InspectorSection title="Pull request">{workstream.prNumber ? <button className="pr-inspector" onClick={() => workstream.prUrl && void window.lens.openExternal(workstream.prUrl)}><GitPullRequest size={17} /><span><strong>#{workstream.prNumber}</strong><small className={`checks ${workstream.prChecks}`}>{label(workstream.prChecks)} checks</small></span><ExternalLink size={14} /></button> : <p className="inspector-empty">The pull request is created after Review & Fix is marked complete.</p>}</InspectorSection>
    <InspectorSection title="Audit history">{workstream.audit.slice(0, 8).map((event) => <div className="audit-row" key={event.id}><i /><div><strong>{event.title}</strong><span title={exactTime(event.createdAt)}>{relativeTime(event.createdAt)}</span>{event.detail && <p>{event.detail}</p>}</div></div>)}</InspectorSection>
  </aside>;
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="inspector-section"><h3>{title}</h3>{children}</section>; }
function DataRow({ icon, label: rowLabel, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) { return <div className="data-row"><span>{icon}{rowLabel}</span><strong className={mono ? "mono" : ""} title={value}>{value}</strong></div>; }
function latestRole(workstream: Workstream): string { return label(workstream.agents.at(-1)?.role ?? "planner"); }
function latestModel(workstream: Workstream): string { const agent = workstream.agents.at(-1); return agent ? `${agent.provider}/${agent.model}` : "pending"; }
function latestAgentFor(workstream: Workstream, role: AgentRole): string { const agent = [...workstream.agents].reverse().find((item) => item.role === role); return agent ? `${agent.provider}/${agent.model}` : ""; }
