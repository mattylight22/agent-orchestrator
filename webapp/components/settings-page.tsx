"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, Cloud, Github, KeyRound, Link2, LoaderCircle, LockKeyhole, Palette, Plus, RadioTower, RefreshCw, Server, Shield, Unplug, Wifi, X } from "lucide-react";
import type { AgentRole, AppSettings, PaseoHost, PaseoTransport, RoleConfig } from "@agent-lens/domain";
import { useRouter } from "next/navigation";
import { useAgentLens } from "./snapshot-provider";

export function SettingsPage() {
  const { snapshot, request } = useAgentLens();
  const router = useRouter();
  const [busy, setBusy] = useState("");
  async function update(patch: Partial<AppSettings>) { await request("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }); }
  return <section className="page settings-page"><header className="page-header"><div><span className="eyebrow">Preferences</span><h1>Settings</h1><p>Connections, defaults, appearance, and agent roles.</p></div></header>
    <div className="settings-stack">
      <SettingsSection icon={<Palette/>} title="Appearance" description="Tune Agent God Mode for your workspace and display."><div className="settings-grid"><label>Theme<select value={snapshot.settings.theme} onChange={(event) => void update({ theme: event.target.value as AppSettings["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Density<select value={snapshot.settings.density} onChange={(event) => void update({ density: event.target.value as AppSettings["density"] })}><option value="compact">Compact</option><option value="balanced">Balanced compact</option><option value="comfortable">Comfortable</option></select></label><label>Branch prefix<input value={snapshot.settings.branchPrefix} onChange={(event) => void update({ branchPrefix: event.target.value })}/></label><label>Rows per page<select value={snapshot.settings.pageSize} onChange={(event) => void update({ pageSize: Number(event.target.value) })}><option>25</option><option>50</option><option>100</option></select></label></div></SettingsSection>
      <SettingsSection icon={<Github/>} title="GitHub App" description="Access every organization and repository installation available to your GitHub user."><div className="connection-row"><div className="connection-icon"><Github/></div><div><strong>{snapshot.settings.githubConnected ? `Connected as ${snapshot.settings.githubLogin}` : "GitHub is not connected"}</strong><small>{snapshot.settings.githubConnected ? `${snapshot.repositories.length} repositories available across your installations` : "Authorization uses a server-side GitHub App OAuth flow."}</small></div>{snapshot.settings.githubConnected ? <><button className="button" disabled={busy === "repos"} onClick={() => { setBusy("repos"); void request("/api/github/repositories", { method: "POST" }).finally(() => setBusy("")); }}><RefreshCw className={busy === "repos" ? "spinning" : ""}/>Refresh repositories</button><button className="button danger" onClick={() => void request("/api/github/disconnect", { method: "POST" })}><Unplug/>Disconnect</button></> : <a className="primary button" href="/api/github/connect"><Github/>Connect GitHub</a>}</div></SettingsSection>
      <SettingsSection id="paseo" icon={<Server/>} title="Paseo hosts" description="Connect each daemon through Relay, Tailscale, or both."><PaseoHosts hosts={snapshot.hosts} providerCatalogs={snapshot.providerCatalogs} request={request}/></SettingsSection>
      <SettingsSection icon={<Bot/>} title="Agent defaults" description="Defaults are validated against each host's live provider catalog before launch."><div className="role-grid">{(["planner", "builder", "reviewer"] as AgentRole[]).map((role) => <RoleEditor role={role} key={role} config={snapshot.settings.globalRoles[role]} catalogs={Object.values(snapshot.providerCatalogs).flat()} onChange={(config) => void update({ globalRoles: { ...snapshot.settings.globalRoles, [role]: config } })}/>)}</div></SettingsSection>
      <SettingsSection icon={<Cloud/>} title="Cloud data" description="Electron and web share normalized account data through Supabase Realtime."><div className="security-note"><Shield/><div><strong>Local-first desktop, durable web</strong><p>Browser rows are protected by Row Level Security. GitHub and Paseo credentials are encrypted server-side and are denied to browser sessions.</p></div></div><div className="connection-row"><div><strong>Signed in as {snapshot.cloud.email}</strong><small>Changes synchronize automatically.</small></div><span className="connected"><Check/>Connected</span><button className="button danger" onClick={() => void request("/api/auth/sign-out", { method: "POST" }).then(() => { router.push("/login"); router.refresh(); })}>Sign out</button></div></SettingsSection>
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
  return <>
    <div className="host-settings">{hosts.map((host) => <div className="connection-row host-row" key={host.id}>
      <div className="connection-icon"><Server/></div>
      <div><strong>{host.name}</strong><small><code>{host.daemonId}</code> · {providerCatalogs[host.id]?.length ?? 0} models</small><div className="transport-list">{(host.transports ?? []).map((transport) => <button type="button" key={transport} disabled={busy !== "" || host.preferredTransport === transport} className={`transport-chip ${host.preferredTransport === transport ? "preferred" : ""}`} onClick={() => void prefer(host.id, transport)}>{transport === "relay" ? <RadioTower/> : <Wifi/>}{transport === "relay" ? "Relay" : "Tailscale"}{host.preferredTransport === transport && <span>Primary</span>}</button>)}</div></div>
      <span className="connected"><Check/>Configured</span>
      <button className="button" onClick={() => { setBusy(host.id); void request<{ mappingWarning?: string | null }>(`/api/paseo/hosts/${host.id}/refresh`, { method: "POST" }).then((value) => setWarnings((current) => ({ ...current, [host.id]: value.mappingWarning ?? "" }))).catch(() => undefined).finally(() => setBusy("")); }} disabled={busy !== ""}><RefreshCw className={busy === host.id ? "spinning" : ""}/>Refresh</button>
      {warnings[host.id] && <div className="banner warning">Providers refreshed. Repository discovery needs attention: {warnings[host.id]}</div>}
    </div>)}</div>
    {!hosts.length && <div className="empty-connection"><Server/><div><strong>No Paseo hosts connected</strong><small>Add a connection to discover providers, projects, and workspaces.</small></div></div>}
    <div className="add-host-row"><div><Plus/><span><strong>Connect another Paseo host</strong><small>Use the guided setup to choose Relay or a direct Tailscale connection. Matching daemon IDs are combined automatically.</small></span></div><button className="primary" onClick={() => setWizardOpen(true)}><Plus/>Add host</button></div>
    {wizardOpen && <PaseoSetupWizard request={request} onClose={() => setWizardOpen(false)}/>} 
  </>;
}

function PaseoSetupWizard({ request, onClose }: { request<T = unknown>(url: string, init?: RequestInit): Promise<T>; onClose(): void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [transport, setTransport] = useState<PaseoTransport>("relay");
  const [name, setName] = useState("");
  const [pairingLink, setPairingLink] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ providerCount: number; mappingCount: number; mappingWarning?: string | null } | null>(null);
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setError(""); setStep(3);
    try {
      const value = await request<{ providerCount: number; mappingCount: number; mappingWarning?: string | null }>("/api/paseo/hosts/connect", { method: "POST", body: JSON.stringify({ name, transport, pairingLink: transport === "relay" ? pairingLink : undefined, endpoint: transport === "tailscale" ? endpoint : undefined }) });
      setResult(value); setPairingLink(""); setStep(4);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection failed"); setStep(2); }
  }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog connection-wizard" role="dialog" aria-modal="true" aria-labelledby="paseo-wizard-title">
    <header><div><span className="eyebrow">Paseo connection</span><h2 id="paseo-wizard-title">Connect a host</h2></div><button className="icon-button" aria-label="Close setup" onClick={onClose}><X/></button></header>
    <ol className="wizard-steps" aria-label="Setup progress"><li className={step >= 1 ? "active" : ""}><span>1</span>Method</li><li className={step >= 2 ? "active" : ""}><span>2</span>Connection</li><li className={step >= 3 ? "active" : ""}><span>3</span>Verify</li></ol>
    {step === 1 && <div className="wizard-panel"><div><h3>How should Agent God Mode reach this daemon?</h3><p>You can add the other method later. Agent God Mode combines connections that report the same daemon ID.</p></div><div className="connection-methods"><button type="button" className={transport === "relay" ? "selected" : ""} onClick={() => setTransport("relay")}><span><RadioTower/></span><strong>Paseo Relay</strong><small>Recommended for Vercel. End-to-end encrypted and available to durable workflows without tailnet routing.</small><i>{transport === "relay" && <Check/>}</i></button><button type="button" className={transport === "tailscale" ? "selected" : ""} onClick={() => setTransport("tailscale")}><span><Wifi/></span><strong>Direct via Tailscale</strong><small>Connect directly over your private tailnet. The Vercel runtime must also have a route into that tailnet.</small><i>{transport === "tailscale" && <Check/>}</i></button></div><footer><button className="primary" onClick={() => setStep(2)}>Continue<ArrowRight/></button></footer></div>}
    {step === 2 && <form className="wizard-panel" onSubmit={connect}><div><h3>{transport === "relay" ? "Pair through Paseo Relay" : "Connect through Tailscale"}</h3><p>{transport === "relay" ? <>Run <code>paseo daemon pair</code> on the host and paste the complete one-time pairing link.</> : <>Enter the daemon’s secure WebSocket endpoint using its Tailscale IP or full <code>.ts.net</code> MagicDNS name.</>}</p></div>{error && <div className="banner error" role="alert">{error}</div>}<label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Build server" autoFocus required/></label>{transport === "relay" ? <label>Pairing link<input type="password" autoComplete="off" value={pairingLink} onChange={(event) => setPairingLink(event.target.value)} placeholder="https://app.paseo.sh/#offer=…" required/><small><LockKeyhole/>The capability is encrypted before storage and is never returned to the browser.</small></label> : <label>Tailscale WebSocket endpoint<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="wss://100.88.249.24/ws" spellCheck={false} required/><small><Shield/>Only Tailscale address ranges and full <code>.ts.net</code> names are accepted. Use <code>/ws</code>.</small></label>}<div className="wizard-callout">{transport === "relay" ? <KeyRound/> : <Link2/>}<span><strong>{transport === "relay" ? "Encrypted relay capability" : "Direct connectivity check"}</strong><small>{transport === "relay" ? "Agent God Mode validates the daemon identity and provider catalog before saving." : "The check runs from the deployed Agent God Mode server—the same environment used by durable workflows."}</small></span></div><footer><button type="button" className="button" onClick={() => { setError(""); setStep(1); }}><ArrowLeft/>Back</button><button className="primary">Connect and verify<ArrowRight/></button></footer></form>}
    {step === 3 && <div className="wizard-verifying" role="status"><span><LoaderCircle className="spinning"/></span><h3>Verifying {transport === "relay" ? "encrypted relay" : "Tailscale connection"}…</h3><p>Confirming the daemon identity, discovering providers, and matching repositories.</p></div>}
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
