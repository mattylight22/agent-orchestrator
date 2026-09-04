"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { ArrowRight, X } from "lucide-react";
import { Markdown } from "./markdown";
import { StatusChip } from "./status-chip";

interface PlanReaderModalProps {
  title: string;
  repository?: string;
  status: string;
  body: string;
  workstreamHref?: string;
  onClose(): void;
}

export function PlanReaderModal({ title, repository, status, body, workstreamHref, onClose }: PlanReaderModalProps) {
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
          <span className="eyebrow">Plan reading view</span>
          <h2 id={titleId}>{title}</h2>
          {repository && <small>{repository}</small>}
        </div>
        <div>
          <StatusChip value={status}/>
          {workstreamHref && <Link className="button" href={workstreamHref} onClick={onClose}>Review and annotate <ArrowRight/></Link>}
          <button ref={closeButton} className="button" onClick={onClose} aria-label="Close full-screen plan"><X/>Close</button>
        </div>
      </header>
      <div className="plan-reader-scroll">
        <article className="plan-reader-content"><Markdown>{body}</Markdown></article>
      </div>
    </section>
  </div>;
}
