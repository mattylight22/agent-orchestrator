"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, ChevronLeft, ChevronRight, Filter, Search, Trash2, X } from "lucide-react";
import type { Workstream } from "@agent-lens/domain";
import { useAgentLens } from "./snapshot-provider";
import { StatusChip } from "./status-chip";

export function Dashboard() {
  const { snapshot, request } = useAgentLens();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [repository, setRepository] = useState(params.get("repository") ?? "");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<Workstream | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  useEffect(() => { if (params.get("focus") === "search") document.getElementById("workstream-search")?.focus(); }, [params]);
  useEffect(() => { setRepository(params.get("repository") ?? ""); }, [params]);
  const filtered = useMemo(() => snapshot.workstreams.filter((item) => (!query || `${item.name} ${item.branchName} ${item.repositoryFullName}`.toLowerCase().includes(query.toLowerCase())) && (!status || item.status === status) && (!repository || item.repositoryId === repository)), [snapshot.workstreams, query, status, repository]);
  const pageSize = snapshot.settings.pageSize;
  const rows = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const stats = [
    ["Active agents", snapshot.workstreams.filter((item) => item.agentState === "running").length, "working now"],
    ["Ready to build", snapshot.workstreams.filter((item) => item.status === "ready-to-build").length, "plans accepted"],
    ["Needs attention", snapshot.workstreams.filter((item) => ["attention", "failed"].includes(item.agentState)).length, "across all hosts"],
    ["Open pull requests", snapshot.workstreams.filter((item) => item.prNumber && item.status !== "merged").length, "linked branches"],
  ];
  return <section className="page dashboard-page">
    <header className="page-header"><div><span className="eyebrow">Control center</span><h1>Workstreams</h1><p>Plan, build, and review across every repository from one place.</p></div></header>
    <div className="stats">{stats.map(([label, count, note]) => <div key={label}><span>{label}</span><strong>{count}</strong><small>{note}</small></div>)}</div>
    <div className="data-panel">
      <div className="filter-bar"><label className="search-field"><Search /><input id="workstream-search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search workstreams, branches, repositories…" /><kbd>⌘F</kbd></label><label className="select-field"><Filter /><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">All statuses</option><option value="draft">Draft</option><option value="ready-to-build">Ready to build</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option><option value="merged">Merged</option></select></label><select value={repository} onChange={(event) => { setRepository(event.target.value); setPage(0); }}><option value="">All repositories</option>{snapshot.repositories.map((repo) => <option value={repo.id} key={repo.id}>{repo.fullName}</option>)}</select></div>
      <div className="table-wrap"><table><thead><tr><th>Workstream</th><th>Repository</th><th>Branch</th><th>Status</th><th>Phase</th><th>Agent</th><th>Updated</th><th>PR</th><th aria-label="Actions" /></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><Link className="row-title" href={`/app/workstreams/${item.id}`}>{item.name}</Link></td><td>{item.repositoryFullName}</td><td><code title={item.branchName}>{item.branchName}</code></td><td><StatusChip value={item.status}/></td><td><StatusChip value={item.phase}/></td><td><span className={`agent-state ${item.agentState}`}><i />{item.agentState}</span></td><td title={new Date(item.updatedAt).toLocaleString()}>{relative(item.updatedAt)}</td><td>{item.prUrl ? <a className="external" href={item.prUrl} target="_blank" rel="noreferrer">#{item.prNumber}<ArrowUpRight /></a> : "—"}</td><td className="row-actions"><button className="icon-button delete-trigger" aria-label={`Delete ${item.name}`} title="Delete workstream" onClick={() => { setDeleting(item); setConfirmation(""); }}><Trash2 /></button></td></tr>)}</tbody></table></div>
      {!rows.length && <div className="empty-state"><div><Search /></div><h3>No workstreams found</h3><p>{snapshot.workstreams.length ? "Try adjusting the filters." : "Create your first workstream to start planning."}</p></div>}
      <footer className="pagination"><span>Showing {filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span><div><button disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft /></button><button disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(page + 1)}><ChevronRight /></button></div></footer>
    </div>
    {deleting && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !deleteBusy && setDeleting(null)}><form className="dialog delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-workstream-title" onSubmit={(event) => { event.preventDefault(); if (confirmation !== deleting.name) return; setDeleteBusy(true); void request(`/api/workstreams/${deleting.id}/actions`, { method: "POST", body: JSON.stringify({ action: "delete", confirmation }) }).then(() => { setDeleting(null); setConfirmation(""); }).catch(() => undefined).finally(() => setDeleteBusy(false)); }}><header><div><span className="eyebrow">Delete workstream</span><h2 id="delete-workstream-title">Delete {deleting.name}?</h2></div><button type="button" className="icon-button" aria-label="Close" disabled={deleteBusy} onClick={() => setDeleting(null)}><X /></button></header><div className="delete-warning"><AlertTriangle /><div><strong>This removes the workstream from Agent God Mode.</strong><p>{deleting.workspaceId ? "Its linked Paseo workspace and agents will be archived." : "No linked Paseo workspace exists."} The GitHub branch and pull request will not be deleted.</p></div></div><div className="delete-summary"><span>Repository <strong>{deleting.repositoryFullName}</strong></span><span>Branch <code>{deleting.branchName}</code></span></div><label>Type <strong>{deleting.name}</strong> to confirm<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} /></label><footer><button type="button" className="button" disabled={deleteBusy} onClick={() => setDeleting(null)}>Cancel</button><button className="danger-action" disabled={deleteBusy || confirmation !== deleting.name}>{deleteBusy ? "Deleting…" : "Delete workstream"}</button></footer></form></div>}
  </section>;
}

function relative(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return format.format(seconds, "second");
  const minutes = Math.round(seconds / 60); if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60); if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}
