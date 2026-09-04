"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronsLeft, CirclePlus, FileText, LayoutDashboard, Menu, Search, Settings, X } from "lucide-react";
import appIcon from "../../resources/icon.png";
import { useAgentLens } from "./snapshot-provider";
import { NewWorkstreamDialog } from "./new-workstream-dialog";
import { selectRecentRepositories } from "@/lib/recent-repositories";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { snapshot, refreshing, request } = useAgentLens();
  const [mobile, setMobile] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const requestedPullRequestActivity = useRef(false);
  const recent = useMemo(() => selectRecentRepositories(snapshot.repositories, snapshot.workstreams, snapshot.recentRepositoryIds, repoQuery), [snapshot.repositories, snapshot.workstreams, snapshot.recentRepositoryIds, repoQuery]);
  useEffect(() => {
    if (requestedPullRequestActivity.current || snapshot.workstreams.length || snapshot.recentRepositoryIds !== undefined || !snapshot.settings.githubConnected) return;
    requestedPullRequestActivity.current = true;
    void request("/api/github/repositories", { method: "POST" }).catch(() => undefined);
  }, [request, snapshot.recentRepositoryIds, snapshot.settings.githubConnected, snapshot.workstreams.length]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); setNewOpen(true); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); router.push("/app?focus=search"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return <div className="app-shell">
    <header className="mobile-bar"><button className="icon-button" onClick={() => setMobile(true)} aria-label="Open navigation"><Menu /></button><span><img src={appIcon.src} alt="" />Agent God Mode</span><i className={refreshing ? "sync spinning" : "sync"} /></header>
    <aside className={mobile ? "sidebar open" : "sidebar"}>
      <div className="brand"><img src={appIcon.src} alt="" /><strong>Agent God Mode</strong><button className="mobile-close" onClick={() => setMobile(false)} aria-label="Close navigation"><X /></button></div>
      <button className="primary new-button" onClick={() => setNewOpen(true)}><CirclePlus />New workstream <kbd>⌘N</kbd></button>
      <nav className="main-nav">
        <Nav href="/app" active={pathname === "/app"} icon={<LayoutDashboard />}>Dashboard</Nav>
        <Nav href="/app/plans" active={pathname.startsWith("/app/plans")} icon={<FileText />}>Plans</Nav>
        <Nav href="/app?focus=search" active={false} icon={<Search />}>Search <kbd>⌘K</kbd></Nav>
      </nav>
      <div className="side-heading"><span>Recent repositories</span><Search size={13} /></div>
      <input className="repo-search" value={repoQuery} onChange={(event) => setRepoQuery(event.target.value)} placeholder="Filter repositories" aria-label="Filter repositories" />
      <div className="repo-list">{recent.map((repo) => <Link key={repo.id} href={`/app?repository=${encodeURIComponent(repo.id)}`} onClick={() => setMobile(false)}><span className="repo-avatar">{repo.name[0]?.toUpperCase()}</span><span>{repo.name}</span><small>{snapshot.workstreams.filter((item) => item.repositoryId === repo.id).length}</small></Link>)}{!recent.length && <p>No repositories match.</p>}</div>
      <Link className="browse-link" href="/app?allRepositories=1">Browse all {snapshot.repositories.length}</Link>
      <div className="side-heading"><span>Paseo hosts</span><small>{snapshot.hosts.length}</small></div>
      <div className="host-list">{snapshot.hosts.map((host) => <Link href="/app/settings#paseo" key={host.id}><i className="online"/><Bot /> <span>{host.name}</span></Link>)}</div>
      <div className="sidebar-bottom"><Nav href="/app/settings" active={pathname.startsWith("/app/settings")} icon={<Settings />}>Settings</Nav><button><ChevronsLeft />Collapse sidebar</button></div>
    </aside>
    <main className="main-area"><div className="topbar"><span>{pathname.startsWith("/app/plans") ? "Plans" : pathname.startsWith("/app/settings") ? "Settings" : pathname.startsWith("/app/workstreams/") ? "Workstream" : "All workstreams"}</span><span className="host-health"><i className="online" />{snapshot.hosts.length}/{snapshot.hosts.length} paired</span></div>{children}</main>
    <NewWorkstreamDialog open={newOpen} onClose={() => setNewOpen(false)} />
  </div>;
}

function Nav({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return <Link className={active ? "nav-link active" : "nav-link"} href={href}>{icon}<span>{children}</span></Link>;
}
