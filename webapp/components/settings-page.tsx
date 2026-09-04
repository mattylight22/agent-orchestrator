"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, Github, KeyRound, Link2, LoaderCircle, LockKeyhole, Palette, Plus, RadioTower, RefreshCw, Server, Shield, Unplug, Wifi, X } from "lucide-react";
import type { AgentRole, AppSettings, PaseoHost, PaseoTransport, RoleConfig } from "@agent-lens/domain";
import { useRouter } from "next/navigation";
import { useAgentLens } from "./snapshot-provider";
import { validateBrowserTailscaleConnection } from "@/lib/paseo-browser";

export function SettingsPage() {
  const { snapshot, request, refresh } = useAgentLens();
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [settings, setSettings] = useState(snapshot.settings);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const settingsRef = useRef(settings);
  const pendingRef = useRef<Partial<AppSettings>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const catalogs = useMemo(() => Object.values(snapshot.providerCatalogs).flat(), [snapshot.providerCatalogs]);

  function scheduleSave(delay = 450) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushRef.current(), delay);
  }

  function update(patch: Partial<AppSettings>) {
    const next = {
      ...settingsRef.current,
      ...patch,
      ...(patch.globalRoles ? { globalRoles: { ...settingsRef.current.globalRoles, ...patch.globalRoles } } : {}),
    };
    settingsRef.current = next;
    pendingRef.current = {
      ...pendingRef.current,
      ...patch,
      ...(patch.globalRoles ? { globalRoles: next.globalRoles } : {}),
    };
    dirtyRef.current = true;
    setSettings(next);
    setSaveError("");
    setSaveState("saving");
    scheduleSave();
  }

  flushRef.current = async () => {
    if (savingRef.current) { scheduleSave(120); return; }
    const patch = pendingRef.current;
    if (!Object.keys(patch).length) return;
    pendingRef.current = {};
    savingRef.current = true;
    if (mountedRef.current) setSaveState("saving");
    let succeeded = false;
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "Could not save settings");
      succeeded = true;
    } catch (error) {
      if (mountedRef.current) {
        setSaveError(error instanceof Error ? error.message : "Could not save settings");
        setSaveState("error");
      }
    } finally {
      savingRef.current = false;
      if (Object.keys(pendingRef.current).length) scheduleSave(120);
      else {
        dirtyRef.current = false;
        if (succeeded && mountedRef.current) {
          setSaveState("saved");
          if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
          statusTimerRef.current = setTimeout(() => setSaveState("idle"), 1_800);
        } else if (!succeeded) {
          void refresh().catch(() => undefined);
        }
      }
    }
  };

  useEffect(() => {
    if (!dirtyRef.current) { settingsRef.current = snapshot.settings; setSettings(snapshot.settings); }
  }, [snapshot.settings]);
  useEffect(() => {
    const theme = settings.theme;
    document.documentElement.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.dataset.density = settings.density;
  }, [settings.theme, settings.density]);
  useEffect(() => () => {
    mountedRef.current = false;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (Object.keys(pendingRef.current).length) void flushRef.current();
  }, []);

  return <section className="page settings-page"><header className="page-header"><div><span className="eyebrow">Preferences</span><h1>Settings</h1><p>Connections, defaults, appearance, and agent roles.</p></div><div className={`settings-save-state ${saveState}`} role="status" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "saved" ? <><Check/>Saved</> : saveState === "error" ? "Save failed" : "Changes save automatically"}</div></header>
    <div className="settings-stack">
      {saveError && <div className="banner error" role="alert">{saveError}</div>}
      <SettingsSection icon={<Palette/>} title="Appearance" description="Tune Agent God Mode for your workspace and display."><div className="settings-grid"><label>Theme<select value={settings.theme} onChange={(event) => update({ theme: event.target.value as AppSettings["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Density<select value={settings.density} onChange={(event) => update({ density: event.target.value as AppSettings["density"] })}><option value="compact">Compact</option><option value="balanced">Balanced compact</option><option value="comfortable">Comfortable</option></select></label><label>Branch prefix<input value={settings.branchPrefix} onChange={(event) => update({ branchPrefix: event.target.value })} onBlur={() => void flushRef.current()}/></label><label>Rows per page<select value={settings.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}><option>25</option><option>50</option><option>100</option></select></label></div></SettingsSection>
      <SettingsSection icon={<Github/>} title="GitHub" description="Choose repositories and coordinate branches, pull requests, and checks."><div className="connection-row"><div className="connection-icon"><Github/></div><div><strong>{snapshot.settings.githubConnected ? `Connected as ${snapshot.settings.githubLogin}` : "GitHub is not connected"}</strong><small>{snapshot.settings.githubConnected ? `${snapshot.repositories.length} repositories available` : "Connect GitHub to choose repositories for your workstreams."}</small></div>{snapshot.settings.githubConnected ? <><button className="button" disabled={busy === "repos"} onClick={() => { setBusy("repos"); void request("/api/github/repositories", { method: "POST" }).finally(() => setBusy("")); }}><RefreshCw className={busy === "repos" ? "spinning" : ""}/>Refresh repositories</button><button className="button danger" onClick={() => void request("/api/github/disconnect", { method: "POST" })}><Unplug/>Disconnect</button></> : <a className="primary button" href="/api/github/connect"><Github/>Connect GitHub</a>}</div><p className="github-access-note"><Shield/>Agent God Mode does not ingest, store, index, or analyze repository source through GitHub. Paseo checks out and runs agents against the code on your infrastructure.</p></SettingsSection>
      <SettingsSection id="paseo" icon={<Server/>} title="Paseo hosts" description="Connect each host through Relay, Tailscale, or both."><PaseoHosts hosts={snapshot.hosts} providerCatalogs={snapshot.providerCatalogs} request={request}/></SettingsSection>
      <SettingsSection icon={<Bot/>} title="Agent defaults" description="Defaults are validated against each host's live provider catalog before launch."><div className="role-grid">{(["planner", "builder", "reviewer"] as AgentRole[]).map((role) => <RoleEditor role={role} key={role} config={settings.globalRoles[role]} catalogs={catalogs} onChange={(config) => update({ globalRoles: { ...settingsRef.current.globalRoles, [role]: config } })}/>)}</div></SettingsSection>
      <SettingsSection icon={<KeyRound/>} title="Account" description="Manage your Agent God Mode account."><div className="connection-row"><div><strong>Signed in as {snapshot.cloud.email}</strong><small>Your changes are saved automatically.</small></div><span className="connected"><Check/>Connected</span><button className="button danger" onClick={() => void request("/api/auth/sign-out", { method: "POST" }).then(() => { router.push("/login"); router.refresh(); })}>Sign out</button></div></SettingsSection>
    </div>
  </section>;
}

function PaseoHosts({ hosts, providerCatalogs, request }: { hosts: PaseoHost[]; providerCatalogs: Record<string, Array<unknown>>; request<T = unknown>(url: string, init?: RequestInit): Promise<T> }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  async function prefer(hostId: string, transport: PaseoTransport) {
    setBusy(`${hostId}:${transport}`);
    try { await request(`/api/paseo/hosts/${hostId}/transport`, { method: "PATCH", body: JSON.stringify({ transport }) }); }
    finally { setBusy(""); }
  }
  async function refreshHost(host: PaseoHost) {
    setBusy(host.id);
    try {
      const browserValidation = (host.transports ?? []).includes("tailscale") && host.endpoint !== "Paseo relay"
        ? await validateBrowserTailscaleConnection(host.endpoint)
        : undefined;
      const value = await request<{ mappingWarning?: string | null }>(`/api/paseo/hosts/${host.id}/refresh`, { method: "POST", body: JSON.stringify({ browserValidation }) });
      setWarnings((current) => ({ ...current, [host.id]: value.mappingWarning ?? "" }));
    } finally { setBusy(""); }
  }
  return <>
    <div className="host-settings">{hosts.map((host) => <div className="connection-row host-row" key={host.id}>
      <div className="connection-icon"><Server/></div>
      <div><strong>{host.name}</strong><small>{providerCatalogs[host.id]?.length ?? 0} models available</small><div className="transport-list">{(host.transports ?? []).map((transport) => <button type="button" key={transport} disabled={busy !== "" || host.preferredTransport === transport} className={`transport-chip ${host.preferredTransport === transport ? "preferred" : ""}`} onClick={() => void prefer(host.id, transport)}>{transport === "relay" ? <RadioTower/> : <Wifi/>}{transport === "relay" ? "Relay" : "Tailscale"}{host.preferredTransport === transport && <span>Primary</span>}</button>)}</div></div>
      <span className="connected"><Check/>Configured</span>
      <button className="button" onClick={() => void refreshHost(host)} disabled={busy !== ""}><RefreshCw className={busy === host.id ? "spinning" : ""}/>Refresh</button>
      {warnings[host.id] && <div className="banner warning">Providers refreshed. Repository discovery needs attention: {warnings[host.id]}</div>}
    </div>)}</div>
    {!hosts.length && <div className="empty-connection"><Server/><div><strong>No Paseo hosts connected</strong><small>Add a connection to discover providers, projects, and workspaces.</small></div></div>}
    <div className="add-host-row"><div><Plus/><span><strong>Connect another Paseo host</strong><small>Use the guided setup to choose Relay or a direct Tailscale connection.</small></span></div><button className="primary" onClick={() => setWizardOpen(true)}><Plus/>Add host</button></div>
    {wizardOpen && <PaseoSetupWizard request={request} onClose={() => setWizardOpen(false)}/>} 
  </>;
}

function PaseoSetupWizard({ request, onClose }: { request<T = unknown>(url: string, init?: RequestInit): Promise<T>; onClose(): void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [transport, setTransport] = useState<PaseoTransport>("tailscale");
  const [name, setName] = useState("");
  const [pairingLink, setPairingLink] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ providerCount: number; mappingCount: number; mappingWarning?: string | null } | null>(null);
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setError(""); setStep(3);
    try {
      const browserValidation = transport === "tailscale" ? await validateBrowserTailscaleConnection(endpoint) : undefined;
      const value = await request<{ providerCount: number; mappingCount: number; mappingWarning?: string | null }>("/api/paseo/hosts/connect", { method: "POST", body: JSON.stringify({ name, transport, pairingLink: transport === "relay" ? pairingLink : undefined, endpoint: browserValidation?.endpoint, browserValidation }) });
      setResult(value); setPairingLink(""); setStep(4);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection failed"); setStep(2); }
  }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog connection-wizard" role="dialog" aria-modal="true" aria-labelledby="paseo-wizard-title">
    <header><div><span className="eyebrow">Paseo connection</span><h2 id="paseo-wizard-title">Connect a host</h2></div><button className="icon-button" aria-label="Close setup" onClick={onClose}><X/></button></header>
    <ol className="wizard-steps" aria-label="Setup progress"><li className={step >= 1 ? "active" : ""}><span>1</span>Method</li><li className={step >= 2 ? "active" : ""}><span>2</span>Connection</li><li className={step >= 3 ? "active" : ""}><span>3</span>Verify</li></ol>
    {step === 1 && <div className="wizard-panel"><div><h3>How should Agent God Mode reach this host?</h3><p>You can add the other connection method later.</p></div><div className="connection-methods"><button type="button" className={transport === "tailscale" ? "selected" : ""} onClick={() => setTransport("tailscale")}><span><Wifi/></span><strong>Direct via Tailscale</strong><small>Your browser connects straight to Paseo through Tailscale on this device. Traffic stays inside your tailnet.</small><i>{transport === "tailscale" && <Check/>}</i></button><button type="button" className={transport === "relay" ? "selected" : ""} onClick={() => setTransport("relay")}><span><RadioTower/></span><strong>Paseo Relay</strong><small>Connect from any device without joining the tailnet. End-to-end encrypted with no inbound ports.</small><i>{transport === "relay" && <Check/>}</i></button></div><footer><button className="primary" onClick={() => setStep(2)}>Continue<ArrowRight/></button></footer></div>}
    {step === 2 && <form className="wizard-panel" onSubmit={connect}><div><h3>{transport === "relay" ? "Pair through Paseo Relay" : "Connect through Tailscale"}</h3><p>{transport === "relay" ? <>Run <code>paseo daemon pair</code> on the host and paste the complete one-time pairing link.</> : <>Make sure Tailscale is connected on this device, then enter the host’s secure <code>.ts.net</code> WebSocket endpoint.</>}</p></div>{error && <div className="banner error" role="alert">{error}</div>}<label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Build server" autoFocus required/></label>{transport === "relay" ? <label>Pairing link<input type="password" autoComplete="off" value={pairingLink} onChange={(event) => setPairingLink(event.target.value)} placeholder="https://app.paseo.sh/#offer=…" required/><small><LockKeyhole/>Your pairing link is stored securely.</small></label> : <label>Tailscale WebSocket endpoint<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="wss://build-host.your-tailnet.ts.net/ws" spellCheck={false} required/><small><Shield/>Your browser connects directly to this private address; the endpoint is never exposed publicly.</small></label>}<div className="wizard-callout">{transport === "relay" ? <KeyRound/> : <Link2/>}<span><strong>{transport === "relay" ? "Secure Relay connection" : "Direct browser connection"}</strong><small>{transport === "relay" ? "We’ll verify the host and load its available providers before saving." : "This browser will verify the daemon, providers, projects, and workspaces over your tailnet."}</small></span></div><footer><button type="button" className="button" onClick={() => { setError(""); setStep(1); }}><ArrowLeft/>Back</button><button className="primary">Connect and verify<ArrowRight/></button></footer></form>}
    {step === 3 && <div className="wizard-verifying" role="status"><span><LoaderCircle className="spinning"/></span><h3>Verifying {transport === "relay" ? "Relay" : "Tailscale"} connection…</h3><p>Checking the host, loading providers, and matching repositories.</p></div>}
    {step === 4 && <div className="wizard-complete"><span><Check/></span><h3>Host connected</h3><p>Agent God Mode found {result?.providerCount ?? 0} provider models and matched {result?.mappingCount ?? 0} repositories. This method is now primary; any other configured method remains available as fallback.</p>{result?.mappingWarning && <div className="banner warning">The connection is saved, but repository matching needs attention: {result.mappingWarning}</div>}<footer><button className="primary" onClick={onClose}>Done</button></footer></div>}
  </section></div>;
}

function SettingsSection({ id, icon, title, description, children }: { id?: string; icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) { return <section className="settings-section" id={id}><header><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></header><div className="settings-content">{children}</div></section>; }

function RoleEditor({ role, config, catalogs, onChange }: { role: AgentRole; config: RoleConfig; catalogs: Array<any>; onChange(config: RoleConfig): void }) {
  const providers = [...new Set(catalogs.map((item) => item.provider))];
  const models = catalogs.filter((item) => item.provider === config.provider);
  const selected = models.find((item) => item.model === config.model);
  return <article className="role-card"><header><div className={`role-icon ${role}`}><Bot/></div><div><strong>{role[0].toUpperCase() + role.slice(1)}</strong><code>{config.provider}/{config.model}</code></div></header><div className="field-grid"><label>Provider<select value={config.provider} onChange={(event) => { const provider = event.target.value; const model = catalogs.find((item) => item.provider === provider); onChange({ provider, model: model?.model ?? "" }); }}><option value={config.provider}>{config.provider}</option>{providers.filter((item) => item !== config.provider).map((item) => <option key={item}>{item}</option>)}</select></label><label>Model<select value={config.model} onChange={(event) => onChange({ ...config, model: event.target.value })}><option value={config.model}>{config.model}</option>{models.filter((item) => item.model !== config.model).map((item) => <option value={item.model} key={item.model}>{item.modelLabel}</option>)}</select></label><label>Mode<select value={config.modeId ?? ""} onChange={(event) => onChange({ ...config, modeId: event.target.value || undefined })}><option value="">Model default</option>{(selected?.modes ?? []).map((item: any) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label>Thinking<select value={config.thinkingOptionId ?? ""} onChange={(event) => onChange({ ...config, thinkingOptionId: event.target.value || undefined })}><option value="">Model default</option>{(selected?.thinkingOptions ?? []).map((item: any) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label></div></article>;
}
