import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Activity, ChevronLeft, ChevronRight, ChevronsLeft, CirclePlus, FileText, GitBranch, PanelLeft, Search, Server, Settings, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { exactTime, relativeTime } from "../lib/format";
import { useSnapshot } from "../lib/store";
import { NewWorkstreamDialog } from "./NewWorkstreamDialog";
import brandIconUrl from "../../../../resources/icon.png";

export function AppShell() {
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const scopedRepositoryId = useRouterState({ select: (state) => (state.location.search as { repo?: string }).repo });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("agent-lens.sidebar.collapsed") === "true");
  const [creating, setCreating] = useState(false);
  const [palette, setPalette] = useState(false);
  const [repositoryBrowser, setRepositoryBrowser] = useState(false);
  const recentRepositories = useMemo(() => rankRepositories(snapshot).slice(0, 6), [snapshot.repositories, snapshot.workstreams]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette(true); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); setCreating(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("agent-lens.sidebar.collapsed", String(next));
  };

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="drag-region" />
        <div className="brand"><div className="brand-mark"><img src={brandIconUrl} alt="" /></div><span>Agent Lens</span></div>
        <button className="primary new-workstream" onClick={() => setCreating(true)}><CirclePlus size={16} /><span>New workstream</span><kbd>⌘N</kbd></button>
        <nav className="navigation" aria-label="Primary navigation">
          <Link to="/" search={{ repo: undefined }} activeOptions={{ exact: true }}><Workflow size={17} /><span>Dashboard</span></Link>
          <Link to="/plans"><FileText size={17} /><span>Plans</span>{snapshot.plans.filter((plan) => plan.executionState === "eligible").length > 0 && <em>{snapshot.plans.filter((plan) => plan.executionState === "eligible").length}</em>}</Link>
          <button onClick={() => setPalette(true)}><Search size={17} /><span>Search</span><kbd>⌘K</kbd></button>
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label"><span className="sidebar-label-title">Recent repositories</span><button onClick={() => setRepositoryBrowser(true)} title="Browse repositories"><Search size={12} /></button></div>
          {recentRepositories.map(({ repository: repo }) => (
            <button key={repo.id} onClick={() => void navigate({ to: "/", search: { repo: repo.id } })} className="repo-link">
              <span className="repo-glyph">{repo.name.slice(0, 1).toUpperCase()}</span><span>{repo.name}</span>
              <span className="count">{snapshot.workstreams.filter((item) => item.repositoryId === repo.id).length}</span>
            </button>
          ))}
          {snapshot.repositories.length > recentRepositories.length && <button className="browse-repositories" onClick={() => setRepositoryBrowser(true)}>Browse all {snapshot.repositories.length}</button>}
        </div>
        <div className="sidebar-section hosts-section">
          <div className="sidebar-label">Paseo hosts <span>{snapshot.hosts.length}</span></div>
          {snapshot.hosts.map((host) => (
            <div className="host-row" key={host.id}><span className={`presence ${host.health}`} /><Server size={14} /><span>{host.name.replace(/^Paseo · /, "")}</span></div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <Link to="/settings"><Settings size={17} /><span>Settings</span></Link>
          <button onClick={toggleSidebar} aria-label="Toggle sidebar"><ChevronsLeft size={17} /><span>Collapse sidebar</span></button>
        </div>
      </aside>
      <main className="content-shell">
        <header className="titlebar">
          <button className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label="Toggle sidebar"><PanelLeft size={17} /></button>
          <div className="titlebar-context"><Activity size={14} /><span>{path === "/" ? "All workstreams" : path === "/plans" ? "Plans" : path === "/settings" ? "Settings" : "Workstream"}</span></div>
          <div className="titlebar-spacer" />
          <div className="connection-summary"><span className="presence connected" />{snapshot.hosts.filter((host) => host.health === "connected").length}/{snapshot.hosts.length} hosts</div>
        </header>
        <Outlet />
      </main>
      {creating && <NewWorkstreamDialog initialRepositoryId={scopedRepositoryId} onClose={() => setCreating(false)} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} onNew={() => { setPalette(false); setCreating(true); }} />}
      {repositoryBrowser && <RepositoryBrowser onClose={() => setRepositoryBrowser(false)} />}
    </div>
  );
}

function rankRepositories(snapshot: ReturnType<typeof useSnapshot>) {
  return snapshot.repositories.map((repository) => {
    const workstreamActivity = snapshot.workstreams
      .filter((item) => item.repositoryId === repository.id)
      .reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, "");
    const activityAt = workstreamActivity > repository.updatedAt ? workstreamActivity : repository.updatedAt;
    return { repository, activityAt, workstreamCount: snapshot.workstreams.filter((item) => item.repositoryId === repository.id).length };
  }).sort((a, b) => b.activityAt.localeCompare(a.activityAt) || a.repository.fullName.localeCompare(b.repository.fullName));
}

function RepositoryBrowser({ onClose }: { onClose: () => void }) {
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const repositories = useMemo(() => rankRepositories(snapshot).filter(({ repository }) => `${repository.owner} ${repository.name} ${repository.fullName}`.toLowerCase().includes(query.toLowerCase())), [snapshot.repositories, snapshot.workstreams, query]);
  const pageCount = Math.max(1, Math.ceil(repositories.length / pageSize));
  const visible = repositories.slice(page * pageSize, (page + 1) * pageSize);
  const open = (id: string) => {
    void navigate({ to: "/", search: { repo: id } });
    onClose();
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="repository-browser" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="eyebrow">GitHub</span><h2>Browse repositories</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header>
    <label className="repository-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search account or repository…" /></label>
    <div className="repository-results">{visible.map(({ repository, activityAt, workstreamCount }) => <button key={repository.id} onClick={() => open(repository.id)}><span className="repo-glyph">{repository.name.slice(0, 1).toUpperCase()}</span><span><strong>{repository.fullName}</strong><small>{repository.description || (repository.private ? "Private repository" : "Public repository")}</small></span><span className="repository-activity"><strong>{relativeTime(activityAt)}</strong><small title={exactTime(activityAt)}>{workstreamCount} workstream{workstreamCount === 1 ? "" : "s"}</small></span></button>)}{!visible.length && <div className="palette-empty">No matching repositories</div>}</div>
    <footer><span>{repositories.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, repositories.length)} of ${repositories.length}` : "0 repositories"}</span><div><button className="icon-button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15} /></button><span>Page {page + 1} of {pageCount}</span><button className="icon-button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></footer>
  </div></div>;
}

function CommandPalette({ onClose, onNew }: { onClose: () => void; onNew: () => void }) {
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const matches = snapshot.workstreams.filter((item) => `${item.name} ${item.repositoryFullName} ${item.branchName}`.toLowerCase().includes(query.toLowerCase())).slice(0, 7);
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
      <div className="palette-search"><Search size={18} /><input autoFocus placeholder="Search workstreams or run a command…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Escape" && onClose()} /><kbd>esc</kbd></div>
      {!query && <button className="palette-command" onClick={onNew}><CirclePlus size={17} /><span><strong>Create workstream</strong><small>Start a branch and planning agent</small></span><kbd>⌘N</kbd></button>}
      <div className="palette-group-label">Workstreams</div>
      {matches.map((item) => <button className="palette-command" key={item.id} onClick={() => { void navigate({ to: "/workstreams/$workstreamId", params: { workstreamId: item.id } }); onClose(); }}><GitBranch size={17} /><span><strong>{item.name}</strong><small>{item.repositoryFullName} · {item.branchName}</small></span></button>)}
      {!matches.length && <div className="palette-empty">No matching workstreams</div>}
    </div>
  </div>;
}
