import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Columns3, ExternalLink, Filter, GitPullRequest, List, Search, SlidersHorizontal, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Workstream } from "../../../shared/contracts";
import { exactTime, relativeTime } from "../lib/format";
import { useSnapshot } from "../lib/store";
import { NewWorkstreamDialog } from "./NewWorkstreamDialog";
import { StatusChip } from "./StatusChip";

const columns = [
  createColumnHelper<Workstream>().accessor("name", { header: "Workstream", cell: ({ row }) => <div className="workstream-cell"><strong>{row.original.name}</strong><code title={row.original.branchName}>{row.original.branchName}</code></div> }),
  createColumnHelper<Workstream>().accessor("hostName", { header: "Host", cell: (info) => <span className="host-cell"><i />{info.getValue().replace(/^Paseo · /, "")}</span> }),
  createColumnHelper<Workstream>().accessor("status", { header: "Status", cell: (info) => <StatusChip value={info.getValue()} /> }),
  createColumnHelper<Workstream>().accessor("phase", { header: "Active phase", cell: (info) => <StatusChip value={info.getValue()} kind="phase" /> }),
  createColumnHelper<Workstream>().accessor("agentState", { header: "Agent", cell: (info) => <StatusChip value={info.getValue()} kind="agent" /> }),
  createColumnHelper<Workstream>().accessor("updatedAt", { header: "Updated", cell: (info) => <time title={exactTime(info.getValue())}>{relativeTime(info.getValue())}</time> }),
  createColumnHelper<Workstream>().display({ id: "pr", header: "PR / checks", cell: ({ row }) => row.original.prNumber ? <div className="pr-cell"><GitPullRequest size={14} /><span>#{row.original.prNumber}</span><i className={`check-dot ${row.original.prChecks}`} /></div> : <span className="muted">—</span> }),
];

export function Dashboard() {
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const routeSearch = useSearch({ from: "/" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [repo, setRepo] = useState(routeSearch.repo ?? "all");
  const [grouped, setGrouped] = useState(true);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = snapshot.settings.pageSize;
  const filtered = useMemo(() => snapshot.workstreams
    .filter((item) => status === "all" || item.status === status)
    .filter((item) => repo === "all" || item.repositoryId === repo)
    .filter((item) => `${item.name} ${item.branchName} ${item.repositoryFullName}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [snapshot.workstreams, query, status, repo]);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const groups = useMemo(() => Object.entries(paged.reduce<Record<string, Workstream[]>>((result, item) => {
    (result[item.repositoryFullName] ??= []).push(item);
    return result;
  }, {})), [paged]);

  useEffect(() => setRepo(routeSearch.repo ?? "all"), [routeSearch.repo]);

  return <div className="page dashboard-page">
    <div className="page-heading"><div><div className="eyebrow">Control center</div><h1>Workstreams</h1><p>Plan, build, and review across every repository from one place.</p></div><button className="primary" onClick={() => setCreating(true)}><CirclePlus size={16} />New workstream</button></div>
    <div className="summary-strip">
      <div><span>Active agents</span><strong>{snapshot.workstreams.filter((item) => item.agentState === "running").length}</strong><small><i className="live-dot" /> working now</small></div>
      <div><span>Ready to build</span><strong>{snapshot.workstreams.filter((item) => item.phase === "ready").length}</strong><small>plans accepted</small></div>
      <div><span>Needs attention</span><strong>{snapshot.workstreams.filter((item) => item.phase === "attention").length}</strong><small>across all hosts</small></div>
      <div><span>Open pull requests</span><strong>{snapshot.workstreams.filter((item) => item.prNumber && item.status !== "merged").length}</strong><small>{snapshot.workstreams.filter((item) => item.prChecks === "success").length} checks passing</small></div>
    </div>
    <div className="table-panel">
      <div className="filter-bar">
        <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search workstreams, branches, repositories…" /><kbd>⌘F</kbd></label>
        <label className="filter-select"><Filter size={14} /><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="all">All statuses</option><option value="draft">Draft</option><option value="ready-to-build">Ready to build</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option><option value="merged">Merged</option></select><ChevronDown size={13} /></label>
        <label className="filter-select"><select value={repo} onChange={(event) => { const next = event.target.value; setRepo(next); setPage(0); void navigate({ to: "/", search: { repo: next === "all" ? undefined : next } }); }}><option value="all">All repositories</option>{snapshot.repositories.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select><ChevronDown size={13} /></label>
        <button className={`icon-button ${grouped ? "selected" : ""}`} title={grouped ? "Grouped by repository" : "Flat view"} onClick={() => setGrouped(!grouped)}>{grouped ? <Columns3 size={16} /> : <List size={16} />}</button>
        <button className="icon-button" title="More filters"><SlidersHorizontal size={16} /></button>
      </div>
      {paged.length ? grouped ? groups.map(([repository, rows]) => <WorkstreamGroup key={repository} repository={repository} rows={rows ?? []} onOpen={(id) => void navigate({ to: "/workstreams/$workstreamId", params: { workstreamId: id } })} />) : <WorkstreamTable rows={paged} onOpen={(id) => void navigate({ to: "/workstreams/$workstreamId", params: { workstreamId: id } })} /> : <div className="empty-state"><div className="empty-icon"><Workflow size={22} /></div><h3>No workstreams found</h3><p>Try adjusting the filters, or start a new workstream.</p><button className="secondary" onClick={() => setCreating(true)}><CirclePlus size={16} />New workstream</button></div>}
      <div className="pagination"><span>Showing {filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span><div><button className="icon-button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><button className="icon-button" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></div>
    </div>
    {creating && <NewWorkstreamDialog initialRepositoryId={repo === "all" ? undefined : repo} onClose={() => setCreating(false)} />}
  </div>;
}

function WorkstreamGroup({ repository, rows, onOpen }: { repository: string; rows: Workstream[]; onOpen: (id: string) => void }) {
  const newest = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return <section className="repo-group"><header><button><ChevronDown size={14} /></button><span className="repo-glyph">{repository.split("/").at(-1)?.slice(0, 1).toUpperCase()}</span><strong>{repository}</strong><span>{rows.length} workstream{rows.length === 1 ? "" : "s"}</span><small>Latest update {newest ? relativeTime(newest.updatedAt) : "—"}</small><button className="icon-button external"><ExternalLink size={14} /></button></header><WorkstreamTable rows={rows} onOpen={onOpen} /></section>;
}

function WorkstreamTable({ rows, onOpen }: { rows: Workstream[]; onOpen: (id: string) => void }) {
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return <div className="table-scroll"><table><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}{header.id === "updatedAt" && <ArrowDown size={12} />}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} tabIndex={0} onClick={() => onOpen(row.original.id)} onKeyDown={(event) => event.key === "Enter" && onOpen(row.original.id)}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>;
}
