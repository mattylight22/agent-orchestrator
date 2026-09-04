"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Minimize2, Send, Trash2, X } from "lucide-react";
import { Markdown } from "./markdown";
import { StatusChip } from "./status-chip";

type Request = <T = unknown>(url: string, init?: RequestInit) => Promise<T>;

interface PlanReaderModalProps {
  title: string;
  repository?: string;
  status: string;
  body: string;
  mode?: "read" | "annotate";
  planId?: string;
  comments?: Array<{ id: string; quote: string; comment: string }>;
  request?: Request;
  workstreamHref?: string;
  onMinimize?(): void;
  onClose(): void;
}

export function PlanReaderModal({ title, repository, status, body, mode = "read", planId, comments = [], request, workstreamHref, onMinimize, onClose }: PlanReaderModalProps) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return <div className="plan-reader-backdrop" role="presentation">
    <section className="plan-reader" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="plan-reader-header">
        <div>
          <span className="eyebrow">{mode === "annotate" ? "Review and Annotate" : "Plan Reading View"}</span>
          <h2 id={titleId}>{title}</h2>
          {repository && <small>{repository}</small>}
        </div>
        <div>
          <StatusChip value={status}/>
          {workstreamHref && mode === "read" && <Link className="button" href={workstreamHref} onClick={onClose}>Open Workstream <ArrowRight/></Link>}
          {onMinimize && <button className="button" onClick={onMinimize} aria-label="Minimize plan"><Minimize2/>Minimize</button>}
          <button ref={closeButton} className="button" onClick={onClose} aria-label="Close full-screen plan"><X/>Close</button>
        </div>
      </header>
      <div className="plan-reader-scroll">
        {mode === "annotate" && planId && request
          ? <div className="plan-reader-annotator"><PlanAnnotator body={body} planId={planId} comments={comments} request={request}/></div>
          : <article className="plan-reader-content"><Markdown>{body}</Markdown></article>}
      </div>
    </section>
  </div>;
}

export function PlanAnnotator({ body, planId, comments, request }: { body: string; planId: string; comments: Array<{ id: string; quote: string; comment: string }>; request: Request }) {
  const prose = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ quote: string; start: number; end: number } | null>(null);
  const [comment, setComment] = useState("");

  function capture() {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !prose.current?.contains(selected.anchorNode)) return;
    const range = selected.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(prose.current);
    before.setEnd(range.startContainer, range.startOffset);
    const quote = selected.toString().trim();
    if (!quote) return;
    setSelection({ quote, start: before.toString().length, end: before.toString().length + selected.toString().length });
  }

  return <div className="annotator">
    <div className="plan-prose" ref={prose} onMouseUp={capture}><Markdown>{body}</Markdown></div>
    <aside className="comments-panel">
      <header><strong>Revision Comments</strong><small>{comments.length}</small></header>
      {selection && <form onSubmit={(event) => {
        event.preventDefault();
        if (!comment.trim()) return;
        void request(`/api/plans/${planId}/actions`, { method: "POST", body: JSON.stringify({ action: "add-comment", quote: selection.quote, comment, startOffset: selection.start, endOffset: selection.end }) });
        window.getSelection()?.removeAllRanges();
        setSelection(null);
        setComment("");
      }}><blockquote>{selection.quote}</blockquote><textarea autoFocus value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What should change?"/><div><button type="button" className="button" onClick={() => setSelection(null)}>Cancel</button><button className="primary">Add Comment</button></div></form>}
      {!selection && !comments.length && <p className="hint">Highlight a sentence or section in the plan to request a revision.</p>}
      {comments.map((item) => <article key={item.id}><blockquote>{item.quote}</blockquote><p>{item.comment}</p><button aria-label="Delete comment" onClick={() => void request(`/api/plans/${planId}/actions`, { method: "POST", body: JSON.stringify({ action: "delete-comment", commentId: item.id }) })}><Trash2/></button></article>)}
      {comments.length > 0 && <button className="primary submit-revisions" onClick={() => void request(`/api/plans/${planId}/actions`, { method: "POST", body: JSON.stringify({ action: "submit-comments" }) })}><Send/>Submit {comments.length} Revision{comments.length === 1 ? "" : "s"} to Planner</button>}
    </aside>
  </div>;
}
