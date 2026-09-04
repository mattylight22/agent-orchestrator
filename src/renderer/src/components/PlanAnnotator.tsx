import { Check, Highlighter, LoaderCircle, MessageSquareText, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Plan, PlanComment } from "../../../shared/contracts";
import { exactTime } from "../lib/format";
import { useSnapshot } from "../lib/store";
import { Markdown } from "./Markdown";

interface SelectionDraft {
  quote: string;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
}

const statusLabels = {
  "product-feature": "Product / Feature Plan",
  "implementation-ready": "Implementation Ready",
  cancelled: "Cancelled",
} as const;

export function PlanAnnotator({ plan, className = "" }: { plan: Plan; className?: string }) {
  const comments = useSnapshot().planComments.filter((item) => item.planId === plan.id);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [comment, setComment] = useState("");
  const [showComments, setShowComments] = useState(comments.length > 0);
  const [pending, setPending] = useState<"add" | "submit" | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => applyCommentHighlights(contentRef.current, comments), [comments, plan.body]);
  useEffect(() => { if (!comments.length) setShowComments(false); }, [comments.length]);

  const captureSelection = () => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const content = contentRef.current;
      const workspace = workspaceRef.current;
      if (!selection || !content || !workspace || selection.rangeCount === 0 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!content.contains(range.commonAncestorContainer)) return;
      const raw = selection.toString();
      const quote = raw.trim();
      if (!quote) return;
      const leadingWhitespace = raw.indexOf(quote);
      const before = document.createRange();
      before.selectNodeContents(content);
      before.setEnd(range.startContainer, range.startOffset);
      const startOffset = before.toString().length + Math.max(0, leadingWhitespace);
      const selectionRect = range.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      setDraft({
        quote,
        startOffset,
        endOffset: startOffset + quote.length,
        top: selectionRect.bottom - workspaceRect.top + 8,
        left: Math.min(Math.max(selectionRect.left - workspaceRect.left + selectionRect.width / 2, 150), Math.max(150, workspace.clientWidth - 150)),
      });
      setComment("");
      setError(null);
    }, 0);
  };

  const addComment = async () => {
    if (!draft || !comment.trim()) return;
    setPending("add"); setError(null);
    try {
      await window.lens.addPlanComment(plan.id, draft.quote, comment, draft.startOffset, draft.endOffset);
      setDraft(null); setComment(""); setShowComments(true); window.getSelection()?.removeAllRanges();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(null); }
  };

  const deleteComment = async (id: string) => {
    setPending(id); setError(null);
    try { await window.lens.deletePlanComment(id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(null); }
  };

  const submitComments = async () => {
    setPending("submit"); setError(null);
    try { await window.lens.submitPlanComments(plan.id); setShowComments(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(null); }
  };

  return <div className={`plan-annotation-workspace ${className}`} ref={workspaceRef}>
    <div className="plan-annotation-toolbar">
      <div><Highlighter size={14} /><span><strong>Select text to comment</strong><small>Highlight a sentence or section, then describe the revision.</small></span></div>
      <div>{comments.length > 0 && <button className={showComments ? "secondary active" : "secondary"} onClick={() => setShowComments(!showComments)}><MessageSquareText size={14} />Review comments <b>{comments.length}</b></button>}<button className="primary" disabled={!comments.length || pending !== null || plan.status !== "product-feature"} title={plan.status !== "product-feature" ? "Only Product / Feature plans can be revised" : undefined} onClick={() => void submitComments()}>{pending === "submit" ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}Submit revisions</button></div>
    </div>
    {error && <div className="annotation-error">{error}</div>}
    {showComments && comments.length > 0 && <section className="plan-comment-review"><header><div><MessageSquareText size={15} /><span><strong>Revision comments</strong><small>These will be sent together as one revision request.</small></span></div><button className="icon-button" onClick={() => setShowComments(false)} aria-label="Close comments"><X size={14} /></button></header><div className="plan-comment-list">{comments.map((item, index) => <PlanCommentCard key={item.id} item={item} index={index} deleting={pending === item.id} onDelete={() => void deleteComment(item.id)} onLocate={() => locateComment(contentRef.current, item)} />)}</div><footer><span>{comments.length} pending comment{comments.length === 1 ? "" : "s"}</span><button className="primary" disabled={pending !== null || plan.status !== "product-feature"} onClick={() => void submitComments()}>{pending === "submit" ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}Send all to planner</button></footer></section>}
    <article className="plan-document annotatable-plan" ref={contentRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
      <div className="document-meta"><span>{statusLabels[plan.status]}</span><time>{exactTime(plan.createdAt)}</time></div>
      <Markdown>{plan.body}</Markdown>
    </article>
    {draft && <div className="selection-comment-popover" style={{ top: draft.top, left: draft.left }}>
      <header><Highlighter size={14} /><strong>Add revision comment</strong><button onClick={() => setDraft(null)} aria-label="Cancel"><X size={13} /></button></header>
      <blockquote>{draft.quote}</blockquote>
      <textarea autoFocus value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What should change here?" onKeyDown={(event) => { if (event.key === "Enter" && event.metaKey) { event.preventDefault(); void addComment(); } }} />
      <footer><span>⌘ Enter to save</span><button className="primary" disabled={!comment.trim() || pending === "add"} onClick={() => void addComment()}>{pending === "add" ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}Add comment</button></footer>
    </div>}
  </div>;
}

function PlanCommentCard({ item, index, deleting, onDelete, onLocate }: { item: PlanComment; index: number; deleting: boolean; onDelete: () => void; onLocate: () => void }) {
  return <article><button className="comment-number" onClick={onLocate} title="Show selection">{index + 1}</button><div><blockquote>{item.quote}</blockquote><p>{item.comment}</p></div><button className="icon-button danger" disabled={deleting} onClick={onDelete} aria-label="Delete revision comment">{deleting ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}</button></article>;
}

function textRange(root: HTMLElement, startOffset: number, endOffset: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null; let endNode: Text | null = null; let start = 0; let end = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = offset + node.data.length;
    if (!startNode && startOffset >= offset && startOffset <= next) { startNode = node; start = startOffset - offset; }
    if (endOffset >= offset && endOffset <= next) { endNode = node; end = endOffset - offset; break; }
    offset = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange(); range.setStart(startNode, start); range.setEnd(endNode, end); return range;
}

function applyCommentHighlights(root: HTMLElement | null, comments: PlanComment[]): () => void {
  const css = CSS as typeof CSS & { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } };
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!root || !css.highlights || !HighlightConstructor) return () => undefined;
  const ranges = comments.map((item) => textRange(root, item.startOffset, item.endOffset)).filter(Boolean) as Range[];
  css.highlights.set("plan-revision-comments", new HighlightConstructor(...ranges));
  return () => css.highlights?.delete("plan-revision-comments");
}

function locateComment(root: HTMLElement | null, item: PlanComment): void {
  if (!root) return;
  const range = textRange(root, item.startOffset, item.endOffset);
  const element = range?.startContainer.parentElement;
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
}
