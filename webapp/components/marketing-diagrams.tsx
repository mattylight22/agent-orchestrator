import { Bot, Check, GitBranch, GitPullRequest, ListChecks, MessageSquare, ShieldCheck } from "lucide-react";

export function LifecycleDiagram() {
  const steps = [
    ["01", "Plan", "Shape and approve the work"],
    ["02", "Build", "Implement in isolation"],
    ["03", "Review & fix", "Find and resolve issues"],
    ["04", "Pull request", "Publish a clean branch"],
    ["05", "Independent review", "Verify with a second agent"],
  ];
  return <div className="lifecycle-diagram" aria-label="Agent God Mode workstream lifecycle">{steps.map(([number, title, detail]) => <div key={number}><span>{number}</span><strong>{title}</strong><small>{detail}</small></div>)}</div>;
}

export function WorkstreamDiagram() {
  return <div className="workstream-diagram" aria-label="A repository split into isolated agent workstreams">
    <div className="diagram-repository"><GitBranch/><span><strong>GitHub repository</strong><small>main · protected source of truth</small></span></div>
    <div className="diagram-trunk"/>
    {["Product onboarding", "API hardening", "Billing cleanup"].map((name, index) => <div className="diagram-lane" key={name}><span className="diagram-index">0{index + 1}</span><div><strong>{name}</strong><code>agm/{name.toLowerCase().replaceAll(" ", "-")}</code></div><span className="diagram-workspace"><Bot/>Isolated workspace</span></div>)}
  </div>;
}

export function OversightDiagram() {
  return <div className="oversight-diagram" aria-label="A live agent timeline with plan and review controls">
    <div className="oversight-header"><span><i/>Planner running</span><code>claude / high</code></div>
    <div className="oversight-message"><Bot/><div><small>PLANNER AGENT</small><p>I’ve mapped the repository and prepared a decision-complete implementation plan.</p></div></div>
    <div className="oversight-plan"><ListChecks/><span><strong>Plan ready for review</strong><small>Annotate, revise, sequence, or approve</small></span><Check/></div>
    <div className="oversight-controls"><span><MessageSquare/>Add feedback</span><span><ShieldCheck/>Mark ready</span></div>
  </div>;
}

export function ReviewDiagram() {
  return <div className="review-diagram" aria-label="Independent review loop">
    <div><GitPullRequest/><span><small>PULL REQUEST</small><strong>Ready for review</strong></span></div>
    <ol><li><span>1</span><p><strong>Independent review</strong><small>3 actionable findings</small></p></li><li><span>2</span><p><strong>Builder fixes and tests</strong><small>Commit pushed automatically</small></p></li><li><span>3</span><p><strong>Reviewer verifies again</strong><small>Clean verdict recorded</small></p></li></ol>
  </div>;
}
