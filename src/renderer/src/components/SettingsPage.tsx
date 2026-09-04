import { AlertCircle, Check, ChevronDown, Cloud, Database, Github, LoaderCircle, LogOut, Moon, Plus, RefreshCw, Server, Shield, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AgentRole, AppSettings, ProviderModel, RoleConfig } from "../../../shared/contracts";
import { label } from "../lib/format";
import { useSnapshot } from "../lib/store";

export function SettingsPage() {
  const snapshot = useSnapshot();
  const [section, setSection] = useState<"general" | "github" | "hosts" | "cloud" | "agents">("general");
  return <div className="settings-page page"><div className="page-heading"><div><div className="eyebrow">Preferences</div><h1>Settings</h1><p>Connections, defaults, appearance, and agent roles.</p></div></div><div className="settings-layout"><nav className="settings-nav"><button className={section === "general" ? "active" : ""} onClick={() => setSection("general")}><Sun size={16} />General</button><button className={section === "github" ? "active" : ""} onClick={() => setSection("github")}><Github size={16} />GitHub</button><button className={section === "hosts" ? "active" : ""} onClick={() => setSection("hosts")}><Server size={16} />Paseo hosts</button><button className={section === "cloud" ? "active" : ""} onClick={() => setSection("cloud")}><Cloud size={16} />Cloud sync</button><button className={section === "agents" ? "active" : ""} onClick={() => setSection("agents")}><Shield size={16} />Agent defaults</button></nav><div className="settings-content">{section === "general" && <General settings={snapshot.settings} />}{section === "github" && <GithubSettings settings={snapshot.settings} />}{section === "hosts" && <HostSettings />}{section === "cloud" && <CloudSettings />}{section === "agents" && <AgentSettings settings={snapshot.settings} />}</div></div></div>;
}

function General({ settings }: { settings: AppSettings }) {
  const update = (patch: Partial<AppSettings>) => void window.lens.updateSettings(patch);
  return <><SettingsHeader title="General" description="Set the app’s appearance and workstream defaults." /><SettingsGroup title="Appearance"><div className="setting-row"><div><strong>Theme</strong><span>Follow macOS or choose a fixed appearance.</span></div><div className="segmented">{(["system", "light", "dark"] as const).map((value) => <button className={settings.theme === value ? "active" : ""} key={value} onClick={() => update({ theme: value })}>{value === "light" ? <Sun size={14} /> : value === "dark" ? <Moon size={14} /> : null}{label(value)}</button>)}</div></div><div className="setting-row"><div><strong>Density</strong><span>Controls table row height and information spacing.</span></div><select value={settings.density} onChange={(event) => update({ density: event.target.value as AppSettings["density"] })}><option value="compact">Compact</option><option value="balanced">Balanced compact</option><option value="comfortable">Comfortable</option></select></div></SettingsGroup><SettingsGroup title="Workstream defaults"><label className="setting-row"><div><strong>Branch prefix</strong><span>Used before the kebab-case workstream name.</span></div><input className="mono short-input" defaultValue={settings.branchPrefix} onBlur={(event) => update({ branchPrefix: event.target.value })} /></label><label className="setting-row"><div><strong>Base branch</strong><span>Repository defaults take precedence when configured.</span></div><input className="mono short-input" defaultValue={settings.defaultBaseBranch} onBlur={(event) => update({ defaultBaseBranch: event.target.value })} /></label></SettingsGroup></>;
}

function GithubSettings({ settings }: { settings: AppSettings }) {
  const [clientId, setClientId] = useState(settings.githubClientId);
  const [pending, setPending] = useState(false);
  const [verification, setVerification] = useState<{ verificationUri: string; userCode: string } | null>(null);
  useState(() => window.lens.onGithubVerification(setVerification));
  const connect = async () => { setPending(true); try { await window.lens.startGithubDeviceFlow(clientId); } finally { setPending(false); } };
  return <><SettingsHeader title="GitHub" description="Authenticate your GitHub App and query its repository installations." /><SettingsGroup title="Account"><div className="github-account"><div className="github-avatar"><Github size={21} /></div><div><strong>{settings.githubConnected ? settings.githubLogin : "Not connected"}</strong><span>{settings.githubConnected ? "Credentials are encrypted by macOS Keychain-backed safe storage." : "Connect with the GitHub device flow."}</span></div>{settings.githubConnected && <span className="connected-badge"><Check size={13} />Connected</span>}</div>{!settings.githubConnected && <><label className="field"><span>GitHub App client ID</span><input className="mono" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Iv1.0123456789abcdef" /></label>{verification && <div className="verification"><span>Enter this code on GitHub</span><strong>{verification.userCode}</strong><small>A browser window has been opened.</small></div>}<button className="primary" disabled={!clientId || pending} onClick={() => void connect()}>{pending ? <LoaderCircle size={16} className="spin" /> : <Github size={16} />}Connect GitHub</button></>}{settings.githubConnected && <div className="settings-buttons"><button className="secondary" onClick={() => void window.lens.refreshRepositories()}><RefreshCw size={15} />Refresh repositories</button><button className="danger-button" onClick={() => void window.lens.disconnectGithub()}>Disconnect</button></div>}</SettingsGroup></>;
}

function HostSettings() {
  const { hosts } = useSnapshot();
  const [adding, setAdding] = useState(false); const [name, setName] = useState(""); const [endpoint, setEndpoint] = useState(""); const [error, setError] = useState<string | null>(null);
  const add = async () => { try { await window.lens.createHost({ name, endpoint }); setAdding(false); setName(""); setEndpoint(""); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  return <><SettingsHeader title="Paseo hosts" description="Connect directly to remote Paseo daemons over your existing Tailscale network." /><SettingsGroup title="Connections">{hosts.map((host) => <div className="host-setting" key={host.id}><span className={`presence ${host.health}`} /><div><strong>{host.name}</strong><code>{host.endpoint}</code>{host.error && <small>{host.error}</small>}</div><span className="host-health">{label(host.health)}</span><button className="icon-button" onClick={() => void window.lens.connectHost(host.id)}><RefreshCw size={14} /></button><button className="icon-button danger" onClick={() => void window.lens.deleteHost(host.id)}><Trash2 size={14} /></button></div>)}{adding ? <div className="add-host-form">{error && <div className="banner error"><AlertCircle size={15} />{error}</div>}<label className="field"><span>Display name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Paseo · Build Fleet" /></label><label className="field"><span>WebSocket endpoint</span><input className="mono" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="ws://100.x.y.z:6767/ws" /><small>Use ws:// with port 6767 for a direct Tailscale IP, or wss:// only when TLS is configured.</small></label><div><button className="secondary" onClick={() => setAdding(false)}>Cancel</button><button className="primary" onClick={() => void add()}>Add & connect</button></div></div> : <button className="add-row" onClick={() => setAdding(true)}><Plus size={15} />Add Paseo host</button>}</SettingsGroup></>;
}

function CloudSettings() {
  const { settings, cloud } = useSnapshot();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"configure" | "sign-in" | "sign-up" | "reset" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: NonNullable<typeof pending>, action: () => Promise<unknown>) => {
    setPending(kind); setError(null);
    try { await action(); } catch (reason) { setError(cleanIpcError(reason)); }
    finally { setPending(null); }
  };
  const toggleSync = (syncEnabled: boolean) => void run("configure", () => window.lens.updateSettings({ cloud: { ...settings.cloud, syncEnabled } }));
  return <><SettingsHeader title="Cloud sync" description="Keep SQLite local-first and optionally synchronize your preferences, hosts, and workstreams through your Supabase account." />
    <SettingsGroup title="Supabase project">
      <div className="cloud-status"><div className="github-avatar"><Database size={20} /></div><div><strong>{cloud.configured ? "Agent Lens Cloud" : "Cloud unavailable"}</strong><span>{cloud.signedIn ? `Signed in as ${cloud.email}` : "The Supabase project is managed by Agent Lens. Sign-in remains optional."}</span></div>{cloud.signedIn && <span className="connected-badge"><Check size={13} />Connected</span>}</div>
      {(error || cloud.error) && <div className="cloud-error"><AlertCircle size={15} />{error ?? cloud.error}</div>}
    </SettingsGroup>
    {cloud.configured && <SettingsGroup title="Account">
      {!cloud.signedIn ? <div className="cloud-auth"><label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><div className="cloud-auth-help"><button disabled={!email || pending !== null} onClick={() => void run("reset", () => window.lens.requestSupabasePasswordReset(email))}>{pending === "reset" && <LoaderCircle size={13} className="spin" />}Reset password</button><span>Auth project <code>lexvjfpuofjsannrwkwx</code></span></div><div className="cloud-actions"><button className="secondary" disabled={!email || password.length < 8 || pending !== null} onClick={() => void run("sign-up", () => window.lens.signUpSupabase(email, password))}>{pending === "sign-up" && <LoaderCircle size={15} className="spin" />}Create account</button><button className="primary" disabled={!email || password.length < 8 || pending !== null} onClick={() => void run("sign-in", () => window.lens.signInSupabase(email, password))}>{pending === "sign-in" ? <LoaderCircle size={15} className="spin" /> : <Cloud size={15} />}Sign in</button></div></div> : <><label className="setting-row cloud-toggle"><div><strong>Synchronize this Mac</strong><span>Changes sync after local writes and when another signed-in client updates the account.</span></div><input type="checkbox" checked={settings.cloud.syncEnabled} disabled={pending !== null} onChange={(event) => toggleSync(event.target.checked)} /></label><div className="cloud-sync-row"><div><strong>{cloud.syncing ? "Syncing…" : cloud.lastSyncAt ? `Last synced ${new Date(cloud.lastSyncAt).toLocaleString()}` : "Not synced yet"}</strong><span>SQLite stays available offline and remains the local runtime database.</span></div><div><button className="secondary" disabled={!settings.cloud.syncEnabled || pending !== null || cloud.syncing} onClick={() => void run("sync", () => window.lens.syncSupabase())}>{pending === "sync" || cloud.syncing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Sync now</button><button className="danger-button" disabled={pending !== null} onClick={() => void window.lens.signOutSupabase()}><LogOut size={15} />Sign out</button></div></div></>}
    </SettingsGroup>}
    <div className="cloud-note"><Shield size={15} /><span>Supabase sessions are encrypted with macOS-backed safe storage. GitHub credentials never sync, and every cloud row is restricted to its owner by Row Level Security.</span></div>
  </>;
}

function AgentSettings({ settings }: { settings: AppSettings }) {
  const snapshot = useSnapshot();
  const catalog = Object.values(snapshot.providerCatalogs).flat().filter((item, index, list) => list.findIndex((candidate) => candidate.provider === item.provider && candidate.model === item.model) === index);
  const updateRole = (role: AgentRole, patch: Partial<RoleConfig>) => void window.lens.updateSettings({ globalRoles: { ...settings.globalRoles, [role]: { ...settings.globalRoles[role], ...patch } } });
  return <><SettingsHeader title="Agent defaults" description="Defaults are validated against each host’s live provider catalog before launch." />{(["planner", "builder", "reviewer"] as AgentRole[]).map((role) => <AgentRoleSettings key={role} role={role} config={settings.globalRoles[role]} catalog={catalog} onChange={(patch) => updateRole(role, patch)} />)}</>;
}

function AgentRoleSettings({ role, config, catalog, onChange }: { role: AgentRole; config: RoleConfig; catalog: ProviderModel[]; onChange: (patch: Partial<RoleConfig>) => void }) {
  const providers = [...new Set(catalog.map((item) => item.provider))].sort();
  if (config.provider && !providers.includes(config.provider)) providers.unshift(config.provider);
  const providerModels = catalog.filter((item) => item.provider === config.provider);
  const selected = providerModels.find((item) => item.model === config.model);
  const modelValues = [...providerModels];
  if (config.model && !modelValues.some((item) => item.model === config.model)) modelValues.unshift({ provider: config.provider, providerLabel: config.provider, model: config.model, modelLabel: config.model, status: "unavailable", modes: [], thinkingOptions: [] });
  const modes = [...(selected?.modes ?? [])];
  if (config.modeId && !modes.some((item) => item.id === config.modeId)) modes.unshift({ id: config.modeId, label: config.modeId });
  const thinkingOptions = [...(selected?.thinkingOptions ?? [])];
  if (config.thinkingOptionId && !thinkingOptions.some((item) => item.id === config.thinkingOptionId)) thinkingOptions.unshift({ id: config.thinkingOptionId, label: config.thinkingOptionId });
  const changeProvider = (provider: string) => {
    const first = catalog.find((item) => item.provider === provider);
    onChange({ provider, model: first?.model ?? "", modeId: first?.modes[0]?.id, thinkingOptionId: first?.thinkingOptions.find((item) => item.id === "high")?.id });
  };
  const changeModel = (model: string) => {
    const next = providerModels.find((item) => item.model === model);
    onChange({ model, modeId: next?.modes[0]?.id, thinkingOptionId: next?.thinkingOptions.find((item) => item.id === "high")?.id });
  };
  return <SettingsGroup title={label(role)}><div className="role-summary"><div className={`role-icon ${role}`}><Shield size={17} /></div><div><strong>{config.provider}/{config.model}</strong><span>{role === "planner" ? "Produces a decision-complete plan without editing files." : role === "builder" ? "Implements, tests, reviews, fixes, commits, and pushes." : "Reviews the pull request in a read-only sandbox."}</span></div></div><div className="role-grid">
    <label className="field"><span>Provider</span><div className="select-wrap"><select value={config.provider} onChange={(event) => changeProvider(event.target.value)}>{providers.map((provider) => <option key={provider} value={provider}>{catalog.find((item) => item.provider === provider)?.providerLabel ?? provider}</option>)}</select><ChevronDown size={13} /></div></label>
    <label className="field"><span>Model</span><div className="select-wrap"><select value={config.model} onChange={(event) => changeModel(event.target.value)}>{modelValues.map((item) => <option key={item.model} value={item.model}>{item.modelLabel}{item.status !== "ready" ? ` · ${label(item.status)}` : ""}</option>)}</select><ChevronDown size={13} /></div></label>
    <label className="field"><span>Mode</span><div className="select-wrap"><select value={config.modeId ?? ""} onChange={(event) => onChange({ modeId: event.target.value || undefined })}><option value="">Model default</option>{modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select><ChevronDown size={13} /></div></label>
    <label className="field"><span>Thinking</span><div className="select-wrap"><select value={config.thinkingOptionId ?? ""} onChange={(event) => onChange({ thinkingOptionId: event.target.value || undefined })}><option value="">Model default</option>{thinkingOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={13} /></div></label>
  </div></SettingsGroup>;
}

function SettingsHeader({ title, description }: { title: string; description: string }) { return <header className="settings-header"><h2>{title}</h2><p>{description}</p></header>; }
function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section className="settings-group"><h3>{title}</h3><div className="settings-card">{children}</div></section>; }

function cleanIpcError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error|AuthApiError):\s*/i, "");
}
