import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Cloud, Download, ExternalLink, KeyRound, Network, Server, Terminal, Wifi } from "lucide-react";

export const metadata: Metadata = {
  title: "Set up Paseo",
  description: "Install a Paseo agent host, connect it through encrypted Relay or Tailscale, and prepare Claude Code, Codex, and Cursor CLI.",
};

const templateUrl = process.env.NEXT_PUBLIC_AWS_CLOUDFORMATION_TEMPLATE_URL;
const quickCreateUrl = templateUrl
  ? "https://console.aws.amazon.com/cloudformation/home?region=us-east-2#/stacks/quickcreate?templateURL=" + encodeURIComponent(templateUrl) + "&stackName=agent-god-mode-paseo"
  : null;

function Code({ children }: { children: string }) {
  return <pre className="setup-code"><code>{children}</code></pre>;
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<ExternalLink/></a>;
}

export default function SetupPage() {
  return <main className="setup-page">
    <section className="marketing-page-hero setup-hero">
      <span className="marketing-kicker">Paseo host setup</span>
      <h1>Bring your own agent machine online.</h1>
      <p>Install the coding-agent CLIs you already subscribe to, start Paseo, then connect Agent God Mode through Relay or your private Tailscale network.</p>
      <div className="setup-hero-actions"><a href="#manual-setup" className="marketing-button">Set up a host <ArrowRight/></a><a href="#aws" className="marketing-secondary-button">Deploy on AWS</a></div>
    </section>

    <nav className="setup-toc" aria-label="Setup guide sections"><a href="#manual-setup">Quick start</a><a href="#providers">Agent CLIs</a><a href="#relay">Paseo Relay</a><a href="#tailscale">Tailscale</a><a href="#aws">AWS template</a><a href="#verify">Verify</a></nav>

    <section className="setup-section" id="manual-setup">
      <div className="setup-heading"><span>01 · Quick start</span><h2>Three steps from a clean Linux host.</h2><p>Ubuntu 24.04 LTS is the recommended baseline. Run agents as a dedicated non-root user with access only to the repositories it should manage.</p></div>
      <ol className="setup-steps">
        <li><span>1</span><div><h3>Install Paseo</h3><p>Install Node.js 22 or newer, then install the current headless Paseo CLI.</p><Code>{"npm install -g @getpaseo/cli\npaseo daemon start"}</Code><External href="https://paseo.sh/docs">Paseo getting started</External></div></li>
        <li><span>2</span><div><h3>Install and sign in to at least one agent CLI</h3><p>Paseo supervises provider CLIs already installed and authenticated on this machine; it does not replace their subscriptions.</p><a href="#providers">Choose your providers <ArrowRight/></a></div></li>
        <li><span>3</span><div><h3>Choose a connection</h3><p>Use Relay for the hosted web app. Use Tailscale when the Agent God Mode runtime and this host share a tailnet. You may enable both.</p><div className="setup-choice-links"><a href="#relay"><Cloud/>Relay</a><a href="#tailscale"><Network/>Tailscale</a></div></div></li>
      </ol>
    </section>

    <section className="setup-section setup-dark" id="providers">
      <div className="setup-heading"><span>02 · Agent providers</span><h2>Install the CLIs behind your subscriptions.</h2><p>Run these commands as the same Linux user that runs the Paseo daemon. Complete each interactive login before expecting the provider to appear in Agent God Mode.</p></div>
      <div className="provider-install-grid">
        <article><Terminal/><span>Anthropic</span><h3>Claude Code</h3><Code>{"curl -fsSL https://claude.ai/install.sh | bash\nclaude"}</Code><p>Inside Claude Code, use <code>/login</code> if it does not prompt automatically.</p><External href="https://code.claude.com/docs/en/quickstart">Claude Code setup</External></article>
        <article><Terminal/><span>OpenAI</span><h3>Codex CLI</h3><Code>{"curl -fsSL https://chatgpt.com/codex/install.sh | sh\ncodex"}</Code><p>Select <strong>Sign in with ChatGPT</strong> to use an eligible ChatGPT plan.</p><External href="https://developers.openai.com/codex">Codex documentation</External></article>
        <article><Terminal/><span>Cursor</span><h3>Cursor Agent CLI</h3><Code>{"curl https://cursor.com/install -fsS | bash\ncursor-agent login"}</Code><p>Ensure <code>~/.local/bin</code> is in the Paseo daemon user’s PATH.</p><External href="https://docs.cursor.com/en/cli/installation">Cursor CLI setup</External></article>
      </div>
      <div className="setup-note"><Check/><div><strong>Confirm Paseo can see them</strong><Code>{"paseo provider diagnostic claude\npaseo provider diagnostic codex\npaseo provider diagnostic cursor"}</Code><External href="https://paseo.sh/docs/providers">How Paseo providers work</External></div></div>
    </section>

    <section className="setup-section" id="relay">
      <div className="setup-heading"><span>03 · Recommended for web</span><h2>Connect through Paseo Relay.</h2><p>Relay needs only outbound internet access—no public IP, inbound security-group rule, port forwarding, or Tailscale installation. Paseo encrypts daemon traffic end to end.</p></div>
      <ol className="setup-compact-steps"><li><span>1</span><div><h3>Create a pairing offer</h3><Code>{"paseo daemon pair --relay"}</Code></div></li><li><span>2</span><div><h3>Copy the complete link</h3><p>Keep the <code>#offer=…</code> fragment intact. The hostname before it can be a Paseo or Tailscale URL; the encrypted offer contains the relay endpoint used by Agent God Mode.</p></div></li><li><span>3</span><div><h3>Pair Agent God Mode</h3><p>Open <strong>App → Settings → Paseo hosts → Add host → Paseo Relay</strong>, paste the link, then connect and verify.</p></div></li></ol>
      <External href="https://paseo.sh/docs/connectivity#paseo-relay">Paseo Relay details</External>
    </section>

    <section className="setup-section setup-raised" id="tailscale">
      <div className="setup-heading"><span>04 · Private direct connection</span><h2>Connect over Tailscale.</h2><p>This path is for an Agent God Mode runtime that is itself connected to the same tailnet. Enabling it does not disable Relay; Paseo can advertise both transports for one daemon.</p></div>
      <ol className="setup-compact-steps"><li><span>1</span><div><h3>Install and join Tailscale</h3><Code>{"curl -fsSL https://tailscale.com/install.sh | sh\nsudo tailscale up"}</Code></div></li><li><span>2</span><div><h3>Bind Paseo to the tailnet address</h3><Code>{'tailscale ip -4\n# Add the returned IP to ~/.paseo/config.json:\n{\n  "$schema": "https://paseo.sh/schemas/paseo.config.v1.json",\n  "version": 1,\n  "daemon": { "listen": "100.x.y.z:6767" }\n}\npaseo daemon restart'}</Code></div></li><li><span>3</span><div><h3>Add the direct endpoint</h3><p>In Agent God Mode choose <strong>Tailscale direct</strong> and enter <code>wss://your-host.your-tailnet.ts.net/ws</code>. TLS must be valid for a browser-hosted deployment.</p></div></li></ol>
      <div className="setup-reference-row"><External href="https://tailscale.com/docs/install/linux">Install Tailscale on Linux</External><External href="https://paseo.sh/docs/connectivity#tailscale">Paseo’s Tailscale configuration</External></div>
    </section>

    <section className="setup-section aws-section" id="aws">
      <div className="setup-heading"><span>05 · AWS</span><h2>Launch a ready-to-authenticate EC2 host.</h2><p>The CloudFormation template creates an Ubuntu instance with no inbound ports, Session Manager access, an encrypted root volume, and startup installation of Paseo, Tailscale, GitHub CLI, Claude Code, Codex, and Cursor Agent. You authenticate the CLIs after launch so credentials never enter CloudFormation user data.</p></div>
      <div className="aws-launch-card"><div><Server/><span><strong>Agent God Mode Paseo Host</strong><small>Ubuntu 24.04 · t3.large default · 100 GB gp3 · SSM access</small></span></div><ul><li><Check/>Latest public Ubuntu AMI, or your own golden AMI</li><li><Check/>No public IP or inbound port required for Relay</li><li><Check/>Provider credentials added only after deployment</li></ul><div className="aws-actions">{quickCreateUrl ? <a className="marketing-button" href={quickCreateUrl} target="_blank" rel="noreferrer">Launch stack in AWS <ExternalLink/></a> : <a className="marketing-button" href="/aws/agent-god-mode-paseo-host.yaml" download>Download template <Download/></a>}<a className="marketing-secondary-button" href="/aws/agent-god-mode-paseo-host.yaml" download>Download YAML</a></div>{!quickCreateUrl && <p className="aws-publish-note"><KeyRound/>A CloudFormation Quick Create URL requires the template to be published in your S3 bucket. Set <code>NEXT_PUBLIC_AWS_CLOUDFORMATION_TEMPLATE_URL</code> to that object URL to turn this into a one-click Launch Stack button.</p>}</div>
      <ol className="setup-compact-steps after-launch"><li><span>1</span><div><h3>Open the instance</h3><p>In the stack Outputs, copy the Session Manager command and run it from an authenticated AWS CLI.</p></div></li><li><span>2</span><div><h3>Authenticate providers</h3><Code>{"sudo -iu ubuntu\nclaude\ncodex\ncursor-agent login\ngh auth login"}</Code></div></li><li><span>3</span><div><h3>Pair the host</h3><Code>{"paseo daemon pair --relay"}</Code><p>Paste the resulting link into Agent God Mode settings.</p></div></li></ol>
      <External href="https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html">AWS Systems Manager Session Manager</External>
    </section>

    <section className="setup-section setup-dark verify-section" id="verify">
      <div className="setup-heading"><span>06 · Verify</span><h2>Confirm the daemon before starting work.</h2></div>
      <div className="verify-grid"><article><Wifi/><h3>Daemon</h3><Code>{"paseo daemon status"}</Code></article><article><Terminal/><h3>Providers</h3><Code>{"paseo provider diagnostic claude\npaseo provider diagnostic codex"}</Code></article><article><Cloud/><h3>Remote connection</h3><Code>{'paseo --host "$OFFER_URL" ls -a'}</Code></article></div>
      <p>If provider discovery still fails, verify the binary is installed for the daemon user and visible in that user’s PATH. See <External href="https://paseo.sh/docs/cli#provider-diagnostics">Paseo provider diagnostics</External>.</p>
    </section>

    <section className="marketing-final-cta"><span>Host ready?</span><h2>Pair it, map a repository, and start a workstream.</h2><Link className="marketing-button" href="/login?next=/app/settings">Open settings <ArrowRight/></Link></section>
  </main>;
}
