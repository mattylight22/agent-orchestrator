"use client";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAgentLens } from "./snapshot-provider";

export function NewWorkstreamDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { snapshot, request } = useAgentLens();
  const router = useRouter();
  const search = useSearchParams();
  const scopedRepoId = search.get("repository");
  const [account, setAccount] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [hostId, setHostId] = useState("");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const accounts = useMemo(() => [...new Set(snapshot.repositories.flatMap((repo) => (repo.installations as unknown as Array<{ login?: string }>).map((item) => item.login).filter(Boolean) as string[]))].sort(), [snapshot.repositories]);
  const repositories = useMemo(() => snapshot.repositories.filter((repo) => !account || (repo.installations as unknown as Array<{ login?: string }>).some((item) => item.login === account)), [snapshot.repositories, account]);
  useEffect(() => {
    if (!open) return;
    const scoped = snapshot.repositories.find((repo) => repo.id === scopedRepoId);
    if (scoped) {
      setRepositoryId(scoped.id);
      setAccount((scoped.installations as unknown as Array<{ login?: string }>)[0]?.login ?? "");
      setHostId(snapshot.settings.repositoryDefaults[scoped.id]?.hostId ?? scoped.hostAvailability[0]?.hostId ?? snapshot.hosts[0]?.id ?? "");
    } else {
      setAccount(accounts[0] ?? ""); setRepositoryId(""); setHostId(snapshot.hosts[0]?.id ?? "");
    }
  }, [open, scopedRepoId, snapshot.repositories, snapshot.hosts, snapshot.settings.repositoryDefaults, accounts]);
  if (!open) return null;
  const repository = snapshot.repositories.find((item) => item.id === repositoryId);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await request<{ id: string }>("/api/workstreams", { method: "POST", body: JSON.stringify({ name, brief, repositoryId, hostId, prefix: snapshot.settings.branchPrefix, baseBranch: repository?.defaultBranch ?? snapshot.settings.defaultBaseBranch }) });
      onClose(); router.push(`/workstreams/${result.id}`);
    } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog" onSubmit={submit}>
    <header><div><span className="eyebrow">New workstream</span><h2>Create an isolated branch and workspace</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
    {!snapshot.settings.githubConnected && <div className="banner warning">Connect GitHub in Settings before creating a workstream.</div>}
    {!snapshot.hosts.length && <div className="banner warning">Pair a Paseo host in Settings before creating a workstream.</div>}
    <label>Account or organization<select value={account} onChange={(event) => { setAccount(event.target.value); setRepositoryId(""); }} required><option value="">Select account…</option>{accounts.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label>Repository<select value={repositoryId} onChange={(event) => { const id = event.target.value; setRepositoryId(id); const repo = snapshot.repositories.find((item) => item.id === id); setHostId(snapshot.settings.repositoryDefaults[id]?.hostId ?? repo?.hostAvailability[0]?.hostId ?? snapshot.hosts[0]?.id ?? ""); }} required disabled={!account}><option value="">Select repository…</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}</option>)}</select></label>
    <div className="field-grid"><label>Workstream name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Improve onboarding flow" required /></label><label>Paseo host<select value={hostId} onChange={(event) => setHostId(event.target.value)} required><option value="">Select host…</option>{snapshot.hosts.map((host) => <option value={host.id} key={host.id}>{host.name}{repository?.hostAvailability.some((item) => item.hostId === host.id) ? " · ready" : " · will register repo"}</option>)}</select></label></div>
    <label>Brief<textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={6} placeholder="Describe the outcome, constraints, and important context…" required /></label>
    {name && <div className="branch-preview"><span>Branch</span><code>{snapshot.settings.branchPrefix}/{name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}</code></div>}
    <footer><button type="button" className="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !repositoryId || !hostId}>{busy ? "Creating…" : "Create & start planning"}</button></footer>
  </form></div>;
}
