import { AlertCircle, ArrowRight, ExternalLink, GitBranch, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSnapshot } from "../lib/store";

export function NewWorkstreamDialog({ onClose, initialRepositoryId }: { onClose: () => void; initialRepositoryId?: string }) {
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const initialRepository = snapshot.repositories.find((item) => item.id === initialRepositoryId) ?? snapshot.repositories[0];
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const accounts = useMemo(() => [...new Set(snapshot.repositories.map((item) => item.owner))].sort((a, b) => a.localeCompare(b)), [snapshot.repositories]);
  const [account, setAccount] = useState(initialRepository?.owner ?? "");
  const accountRepositories = useMemo(() => snapshot.repositories.filter((item) => item.owner === account), [account, snapshot.repositories]);
  const [repositoryId, setRepositoryId] = useState(initialRepository?.id ?? "");
  const repository = snapshot.repositories.find((item) => item.id === repositoryId);
  const connectedHosts = useMemo(() => snapshot.hosts.filter((host) => host.health === "connected"), [snapshot.hosts]);
  const mappedHostIds = useMemo(() => new Set(repository?.hostAvailability.map((mapping) => mapping.hostId) ?? []), [repository]);
  const defaults = snapshot.settings.repositoryDefaults[repositoryId];
  const initialMappedHost = snapshot.hosts.find((host) => host.health === "connected" && initialRepository?.hostAvailability.some((mapping) => mapping.hostId === host.id));
  const [hostId, setHostId] = useState(defaults?.hostId ?? initialMappedHost?.id ?? snapshot.hosts.find((host) => host.health === "connected")?.id ?? "");
  const [prefix, setPrefix] = useState(snapshot.settings.branchPrefix);
  const [baseBranch, setBaseBranch] = useState(defaults?.baseBranch ?? repository?.defaultBranch ?? snapshot.settings.defaultBaseBranch);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mappingHosts, setMappingHosts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const selectRepository = (next: string) => {
    setRepositoryId(next);
    const repo = snapshot.repositories.find((item) => item.id === next);
    const repoDefaults = snapshot.settings.repositoryDefaults[next];
    setBaseBranch(repoDefaults?.baseBranch ?? repo?.defaultBranch ?? snapshot.settings.defaultBaseBranch);
    const mappedHost = snapshot.hosts.find((host) => host.health === "connected" && repo?.hostAvailability.some((mapping) => mapping.hostId === host.id));
    setHostId(repoDefaults?.hostId ?? mappedHost?.id ?? connectedHosts[0]?.id ?? "");
  };

  const selectAccount = (next: string) => {
    setAccount(next);
    const first = snapshot.repositories.find((item) => item.owner === next);
    selectRepository(first?.id ?? "");
  };

  const refreshRepositories = async () => {
    setRefreshing(true);
    setMappingHosts(true);
    setError(null);
    try {
      if (snapshot.settings.githubConnected) {
        const repositories = await window.lens.refreshRepositories();
        if (!repositories.length) setError("GitHub returned no installed repositories. Install the GitHub App on an account or organization, then refresh.");
      } else {
        // Existing windows can retain an older preload bridge during development.
        // Repository refresh performs this discovery too once GitHub is connected.
        const refreshMappings = (window.lens as Partial<typeof window.lens>).refreshPaseoMappings;
        if (refreshMappings) await refreshMappings();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMappingHosts(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshRepositories();
  }, []);

  useEffect(() => {
    if (!snapshot.repositories.length) return;
    const nextAccount = accounts.includes(account) ? account : accounts[0];
    if (nextAccount !== account) setAccount(nextAccount);
    const selected = snapshot.repositories.find((item) => item.id === repositoryId && item.owner === nextAccount);
    if (!selected) {
      const first = snapshot.repositories.find((item) => item.owner === nextAccount);
      if (first) selectRepository(first.id);
    }
  }, [snapshot.repositories, accounts, account, repositoryId]);

  useEffect(() => {
    if (hostId && connectedHosts.some((host) => host.id === hostId)) return;
    const preferred = defaults?.hostId && connectedHosts.some((host) => host.id === defaults.hostId)
      ? defaults.hostId
      : connectedHosts.find((host) => mappedHostIds.has(host.id))?.id ?? connectedHosts[0]?.id;
    setHostId(preferred ?? "");
  }, [connectedHosts, defaults?.hostId, hostId, mappedHostIds]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      const workstream = await window.lens.createWorkstream({ name, brief, repositoryId, hostId, prefix, baseBranch });
      onClose();
      void navigate({ to: "/workstreams/$workstreamId", params: { workstreamId: workstream.id } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setPending(false); }
  };

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal new-workstream-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
      <div className="modal-header"><div><span className="eyebrow">New workstream</span><h2>Start with a clear brief</h2><p>A branch, isolated Paseo workspace, and planning agent will be created.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div>
      <div className="modal-body form-grid">
        {error && <div className="banner error"><AlertCircle size={16} /><span>{error}</span></div>}
        <label className="field span-2"><span>Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Improve account recovery flow" required /></label>
        <label className="field span-2"><span>Brief</span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Describe the desired outcome, constraints, and acceptance criteria…" rows={6} required /></label>
        {!snapshot.repositories.length && <div className="repository-empty span-2"><div><strong>{snapshot.settings.githubConnected ? "No installed repositories found" : "Connect GitHub first"}</strong><span>{snapshot.settings.githubConnected ? "Install the GitHub App on your account or organizations, then refresh this list." : "Open GitHub settings in Agent Lens and complete sign-in."}</span></div>{snapshot.settings.githubConnected && <div><button type="button" className="secondary" onClick={() => void window.lens.openExternal("https://github.com/settings/installations")}><ExternalLink size={14} />Manage installations</button><button type="button" className="secondary" disabled={refreshing} onClick={() => void refreshRepositories()}>{refreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}Refresh</button></div>}</div>}
        <label className="field"><span>Account / organization</span><select value={account} onChange={(event) => selectAccount(event.target.value)} required disabled={!accounts.length}><option value="" disabled>{refreshing ? "Refreshing accounts…" : "Select account"}</option>{accounts.map((owner) => <option value={owner} key={owner}>{owner}</option>)}</select></label>
        <label className="field"><span>Repository</span><select value={repositoryId} onChange={(event) => selectRepository(event.target.value)} required disabled={!accountRepositories.length}><option value="" disabled>{refreshing ? "Refreshing repositories…" : "Select repository"}</option>{accountRepositories.map((repo) => <option value={repo.id} key={repo.id}>{repo.name}</option>)}</select></label>
        <label className="field"><span>Paseo host</span><select value={hostId} onChange={(event) => setHostId(event.target.value)} required disabled={mappingHosts}><option value="" disabled>{mappingHosts ? "Discovering Paseo projects…" : "No connected host"}</option>{connectedHosts.map((host) => <option value={host.id} key={host.id}>{host.name}{mappedHostIds.has(host.id) ? "" : " · clone on create"}</option>)}</select><small>{mappingHosts ? "Validating existing Paseo projects…" : hostId && mappedHostIds.has(hostId) ? "Repository already exists on this host" : hostId ? "Repository will be cloned into ~/projects and registered with Paseo" : "Connect a Paseo host to continue"}</small></label>
        <label className="field"><span>Branch prefix</span><input className="mono" value={prefix} onChange={(event) => setPrefix(event.target.value)} required /></label>
        <label className="field"><span>Base branch</span><input className="mono" value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} required /></label>
        <div className="branch-preview span-2"><GitBranch size={15} /><span>Branch</span><code>{prefix || "lens"}/{slug || "workstream-name"}</code></div>
      </div>
      <div className="modal-footer"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={pending || refreshing || mappingHosts || !repository || !hostId}>{pending ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{pending ? "Provisioning…" : "Create & start planning"}</button></div>
    </form>
  </div>;
}
