import type { Metadata } from "next";
import { ArrowRight, GitBranch, ListTree, MessageSquare, Settings2, ShieldCheck } from "lucide-react";
import { LifecycleDiagram, OversightDiagram, ReviewDiagram, WorkstreamDiagram } from "@/components/marketing-diagrams";
import { MarketingCta } from "@/components/marketing-shell";

export const metadata: Metadata = { title: "Product", description: "Use multiple coding-agent subscriptions through Paseo to turn plans into isolated, reviewed GitHub workstreams." };

export default function ProductPage() {
  return <main className="marketing-subpage"><section className="marketing-page-hero"><span className="marketing-kicker">The product</span><h1>One operating system for all of your coding agents.</h1><p>Paseo connects the Claude, Codex, Cursor, and other provider CLIs already running on your infrastructure. Agent God Mode gives them a shared workflow for planning, implementation, review, and delivery across repositories.</p></section>
    <section className="product-feature-row"><div><span>01 · Workstreams</span><h2>Parallel work without branch collisions.</h2><p>Every workstream owns a GitHub branch and an isolated Paseo workspace created from the selected base branch. Agent God Mode coordinates repository metadata, branches, pull requests, and checks through GitHub; it does not ingest, store, index, or analyze repository source. Checkout and analysis happen inside Paseo on your infrastructure.</p><ul><li><GitBranch/>Configurable branch naming</li><li><Settings2/>Repository and host selection</li><li><MessageSquare/>Follow-ups stay in the same agent session</li></ul></div><WorkstreamDiagram/></section>
    <section className="product-feature-row reverse dark"><div><span>02 · Plans</span><h2>Make the plan a real artifact.</h2><p>Capture the planner’s complete response, annotate exact passages, submit revision comments, and keep one current plan instead of accumulating duplicates.</p><ul><li><ListTree/>Product, implementation-ready, and cancelled states</li><li><ShieldCheck/>Dependency gates between plans</li><li><ArrowRight/>Launch implementation directly from an approved plan</li></ul></div><OversightDiagram/></section>
    <section className="product-lifecycle-detail"><div className="marketing-section-heading"><span>03 · Gated execution</span><h2>A clear role for every model.</h2><p>Choose planning, building, and reviewing models independently. Agent God Mode carries the accepted context forward and keeps consequential actions behind explicit gates.</p></div><LifecycleDiagram/></section>
    <section className="product-feature-row"><div><span>04 · Independent review</span><h2>Review, fix, and verify—not just comment.</h2><p>A separate reviewer reports structured findings. Actionable issues return to the builder for fixes and tests, then the reviewer checks again for up to three iterations.</p></div><ReviewDiagram/></section>
    <section className="marketing-final-cta"><span>Ready when your team is.</span><h2>Run the next workstream with full context.</h2><MarketingCta suffix={<ArrowRight/>}/></section>
  </main>;
}
