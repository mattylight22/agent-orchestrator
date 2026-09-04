import type { Metadata } from "next";
import { ArrowRight, GitBranch, ListTree, MessageSquare, Settings2, ShieldCheck } from "lucide-react";
import { LifecycleDiagram, OversightDiagram, ReviewDiagram, WorkstreamDiagram } from "@/components/marketing-diagrams";
import { MarketingCta } from "@/components/marketing-shell";

export const metadata: Metadata = { title: "Product", description: "Use multiple coding-agent subscriptions through Paseo to turn plans into isolated, reviewed GitHub workstreams." };

export default function ProductPage() {
  return <main className="marketing-subpage"><section className="marketing-page-hero"><span className="marketing-kicker">The Product</span><h1>One Operating System for All of Your Coding Agents.</h1><p>Paseo connects the Claude, Codex, Cursor, and other provider CLIs already running on your infrastructure. Agent God Mode gives them a shared workflow for planning, implementation, review, and delivery across repositories.</p></section>
    <section className="product-feature-row"><div><span>01 · Workstreams</span><h2>Parallel Work Without Branch Collisions.</h2><p>Every workstream owns a GitHub branch and an isolated Paseo workspace created from the selected base branch. Agent God Mode coordinates repository metadata, branches, pull requests, and checks through GitHub; it does not ingest, store, index, or analyze repository source. Checkout and analysis happen inside Paseo on your infrastructure.</p><ul><li><GitBranch/>Configurable Branch Naming</li><li><Settings2/>Repository and Agent Instance Selection</li><li><MessageSquare/>Follow-Ups Stay in the Same Agent Session</li></ul></div><WorkstreamDiagram/></section>
    <section className="product-feature-row reverse dark"><div><span>02 · Plans</span><h2>Make the Plan a Real Artifact.</h2><p>Capture the planner’s complete response, annotate exact passages, submit revision comments, and keep one current plan instead of accumulating duplicates.</p><ul><li><ListTree/>Product, Implementation-Ready, and Cancelled States</li><li><ShieldCheck/>Dependency Gates Between Plans</li><li><ArrowRight/>Launch Implementation Directly From an Approved Plan</li></ul></div><OversightDiagram/></section>
    <section className="product-lifecycle-detail"><div className="marketing-section-heading"><span>03 · Gated Execution</span><h2>A Clear Role for Every Model.</h2><p>Choose planning, building, and reviewing models independently. Agent God Mode carries the accepted context forward and keeps consequential actions behind explicit gates.</p></div><LifecycleDiagram/></section>
    <section className="product-feature-row"><div><span>04 · Independent Review</span><h2>Review, Fix, and Verify—Not Just Comment.</h2><p>A separate reviewer reports structured findings. Actionable issues return to the builder for fixes and tests, then the reviewer checks again for up to three iterations.</p></div><ReviewDiagram/></section>
    <section className="marketing-final-cta"><span>Ready When Your Team Is.</span><h2>Run the Next Workstream With Full Context.</h2><MarketingCta suffix={<ArrowRight/>}/></section>
  </main>;
}
