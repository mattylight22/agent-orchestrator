import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Cloud, ExternalLink, KeyRound, Laptop, Network, Server, ShieldCheck, Terminal, Wifi } from "lucide-react";
import { AwsDeployControls } from "@/components/aws-deploy-controls";
import { getAwsTemplateUrl } from "@/lib/aws-template";

export const metadata: Metadata = {
  title: "Set Up an Agent Instance",
  description: "Install a Paseo Agent Instance, connect it through encrypted Relay or Tailscale, and prepare Claude Code, Codex, and Cursor CLI.",
};

const templateUrl = getAwsTemplateUrl();

function Code({ children }: { children: string }) {
  return <pre className="setup-code"><code>{children}</code></pre>;
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<ExternalLink/></a>;
}

export default function SetupPage() {
  return <main className="setup-page">
    <section className="marketing-page-hero setup-hero">
      <span className="marketing-kicker">Agent Instance Setup</span>
      <h1>Bring Your Own Agent Machine Online.</h1>
      <p>Use your existing Claude, Codex, Cursor, and other coding-agent subscriptions through one interface—while your code and provider sign-ins stay on infrastructure you control.</p>
      <div className="setup-hero-actions"><a href="#manual-setup" className="marketing-button">Set Up an Agent Instance <ArrowRight/></a><a href="#aws" className="marketing-secondary-button">Deploy on AWS</a></div>
    </section>

    <nav className="setup-toc" aria-label="Setup guide sections"><a href="#why-paseo">Why Paseo</a><a href="#manual-setup">Quick Start</a><a href="#providers">Agent CLIs</a><a href="#relay">Paseo Relay</a><a href="#tailscale">Tailscale</a><a href="#aws">AWS Template</a><a href="#verify">Verify</a></nav>

    <section className="setup-section setup-raised" id="why-paseo">
      <div className="setup-heading"><span>01 · Why Paseo</span><h2>One Connection to Every Coding Agent You Already Use.</h2><p>Paseo runs on your Agent Instance and makes its installed provider CLIs available to Agent God Mode. You keep each provider subscription and sign-in; Agent God Mode gives you one place to choose models, coordinate work, and follow progress.</p></div>
      <ol className="setup-steps">
        <li><span>1</span><div><h3>Use Your Subscriptions</h3><p>Sign in to Claude Code, Codex, Cursor Agent, and other supported CLIs with the accounts your team already pays for.</p></div></li>
        <li><span>2</span><div><h3>Keep Execution Private</h3><p>Paseo runs the agents beside your repositories. Agent God Mode uses GitHub for repository selection and delivery metadata, but does not ingest, store, index, or analyze repository source. Source code, working trees, and provider sessions remain on your machine or company infrastructure.</p></div></li>
        <li><span>3</span><div><h3>Manage Everything Together</h3><p>Agent God Mode provides one interface for planning, model selection, follow-ups, implementation, review, and pull requests.</p></div></li>
      </ol>
    </section>

    <section className="setup-section" id="manual-setup">
      <div className="setup-heading"><span>02 · Quick Start</span><h2>Three Steps From a Clean Linux Machine.</h2><p>Ubuntu 24.04 LTS is the recommended baseline. Run agents as a dedicated non-root user with access only to the repositories it should manage.</p></div>
      <div className="setup-run-grid">
        <article><Laptop/><div><span>Quickest Start</span><h3>Run Paseo on Your Computer</h3><p>Your Mac or Linux computer can be an Agent Instance. This is useful for trying Agent God Mode or keeping everything on hardware you already manage. Keep the machine awake, connected, and running Paseo while agents work.</p></div></article>
        <article><Cloud/><div><span>Recommended for Ongoing Work</span><h3>Use an Always-On Server</h3><p>A dedicated cloud or company server keeps agents running through long plans, builds, and reviews without depending on a laptop staying awake. Your code and provider sessions still remain on infrastructure you control.</p></div></article>
      </div>
      <ol className="setup-steps">
        <li><span>1</span><div><h3>Install Paseo</h3><p>Install Node.js 22 or newer, then install the current headless Paseo CLI.</p><Code>{"npm install -g @getpaseo/cli\npaseo daemon start"}</Code><External href="https://paseo.sh/docs">Paseo Getting Started</External></div></li>
        <li><span>2</span><div><h3>Install and Sign In to at Least One Agent CLI</h3><p>Paseo supervises provider CLIs already installed and authenticated on this machine; it does not replace their subscriptions.</p><a href="#providers">Choose Your Providers <ArrowRight/></a></div></li>
        <li><span>3</span><div><h3>Choose a Connection</h3><p>Select one connection method during setup. Tailscale Direct uses your private tailnet. Paseo Relay creates an end-to-end encrypted connection using outbound internet access.</p><div className="setup-choice-links"><a href="#tailscale"><Network/>Tailscale Direct</a><a href="#relay"><Cloud/>Paseo Relay · Easiest</a></div></div></li>
      </ol>
    </section>

    <section className="setup-section setup-dark" id="providers">
      <div className="setup-heading"><span>03 · Agent Providers</span><h2>Install the CLIs Behind Your Subscriptions.</h2><p>Run these commands as the same Linux user that runs Paseo. Each provider stays signed in on this Agent Instance; Agent God Mode never needs the provider password or subscription credentials.</p></div>
      <div className="provider-install-grid">
        <article><Terminal/><span>Anthropic</span><h3>Claude Code</h3><Code>{"curl -fsSL https://claude.ai/install.sh | bash\nclaude auth login"}</Code><p>On a remote Agent Instance, open the displayed URL in your local browser and paste the authorization code back into the terminal if prompted.</p><External href="https://code.claude.com/docs/en/authentication">Claude Code Authentication</External></article>
        <article><Terminal/><span>OpenAI</span><h3>Codex CLI</h3><Code>{"curl -fsSL https://chatgpt.com/codex/install.sh | sh\ncodex login --device-auth"}</Code><p>Open the displayed URL on any device and enter the one-time code. Device-code login must be enabled in your ChatGPT security settings or workspace policy.</p><External href="https://developers.openai.com/codex/auth">Codex Authentication</External></article>
        <article><Terminal/><span>Cursor</span><h3>Cursor Agent CLI</h3><Code>{"curl https://cursor.com/install -fsS | bash\ncursor-agent login"}</Code><p>Cursor currently documents browser login, not a device-code flag. Open the displayed sign-in URL locally. If browser login cannot be completed from the Agent Instance, use a Cursor API key instead.</p><Code>{'export CURSOR_API_KEY="your_api_key"'}</Code><External href="https://docs.cursor.com/en/cli/reference/authentication">Cursor CLI Authentication</External></article>
      </div>
      <div className="setup-note"><Check/><div><strong>Confirm Paseo Can See Them</strong><Code>{"paseo provider diagnostic claude\npaseo provider diagnostic codex\npaseo provider diagnostic cursor"}</Code><External href="https://paseo.sh/docs/providers">How Paseo Providers Work</External></div></div>
    </section>

    <section className="setup-section" id="relay">
      <div className="setup-heading"><span>04 · Encrypted Relay · Easiest</span><h2>Connect Through Paseo Relay.</h2><p>Paseo Relay creates an end-to-end encrypted connection to your Agent Instance. The instance needs only outbound internet access—no public IP, inbound security-group rule, or port forwarding.</p></div>
      <ol className="setup-compact-steps"><li><span>1</span><div><h3>Create a Pairing Offer</h3><Code>{"paseo daemon pair --relay"}</Code></div></li><li><span>2</span><div><h3>Copy the Complete Link</h3><p>Keep the <code>#offer=…</code> fragment intact. The hostname before it can be a Paseo or Tailscale URL; the encrypted offer contains the relay endpoint used by Agent God Mode.</p></div></li><li><span>3</span><div><h3>Pair Agent God Mode</h3><p>Open <strong>App → Settings → Agent Instances → Add Instance → Paseo Relay</strong>, paste the link, then connect and verify.</p></div></li></ol>
      <External href="https://paseo.sh/docs/connectivity#paseo-relay">Paseo Relay Details</External>
    </section>

    <section className="setup-section setup-raised" id="tailscale">
      <div className="setup-heading"><span>05 · Private Direct Connection</span><h2>Connect the Web App Over Tailscale.</h2><p>Install Tailscale on the device where you use Agent God Mode and join the same tailnet as the Agent Instance. Your browser then connects directly to Paseo over the private network; Agent God Mode does not need a public route to the instance.</p></div>
      <ol className="setup-compact-steps"><li><span>1</span><div><h3>Join Both Devices to the Tailnet</h3><p>Install Tailscale on the Agent Instance and on each computer that will use Agent God Mode.</p><Code>{"curl -fsSL https://tailscale.com/install.sh | sh\nsudo tailscale up"}</Code></div></li><li><span>2</span><div><h3>Give Paseo a Private HTTPS Address</h3><p>Keep Paseo listening locally and use Tailscale Serve to provide a trusted <code>.ts.net</code> HTTPS/WSS endpoint inside the tailnet.</p><Code>{"sudo tailscale serve --bg http://127.0.0.1:6767\ntailscale serve status"}</Code></div></li><li><span>3</span><div><h3>Connect From Agent God Mode</h3><p>While Tailscale is connected on your computer, choose <strong>Tailscale Direct</strong> and enter <code>wss://your-host.your-tailnet.ts.net/ws</code>. The browser verifies the daemon, providers, projects, and workspaces directly.</p></div></li></ol>
      <div className="setup-reference-row"><External href="https://tailscale.com/docs/install/linux">Install Tailscale on Linux</External><External href="https://paseo.sh/docs/connectivity#tailscale">Paseo’s Tailscale configuration</External></div>
    </section>

    <section className="setup-section aws-section" id="aws">
      <div className="setup-heading"><span>06 · AWS</span><h2>Launch a Ready-to-Authenticate Agent Instance.</h2><p>Choose a one-time CloudFormation launch or connect your AWS account for managed provisioning. Both approaches create an Ubuntu instance with no inbound ports, Session Manager access, an encrypted root volume, and Paseo plus the supported agent CLIs.</p></div>
      <div className="aws-paths"><article><ExternalLink/><span>Fastest Path</span><h3>One-Click Deployment</h3><p>Open a prefilled CloudFormation stack, review it, and launch it yourself. Agent God Mode has no continuing AWS access; you pair the completed Agent Instance manually.</p></article><article><KeyRound/><span>Managed Lifecycle</span><h3>Connect Your AWS Account</h3><p>Authorize a narrowly scoped role once. Agent God Mode can then create, monitor, pair, retry, open, and delete Agent Instances without storing AWS access keys.</p></article></div>
      <div className="aws-launch-card"><div><Server/><span><strong>Agent God Mode Agent Instance</strong><small>Ubuntu 24.04 · t3.medium default · 100 GB gp3 · Session Manager access</small></span></div><ul><li><Check/>Cost-conscious default for one active agent</li><li><Check/>Instance size remains configurable for heavier builds or concurrency</li><li><Check/>No public IP or inbound port required for Relay</li></ul><AwsDeployControls templateUrl={templateUrl}/></div>
      <div className="aws-oidc-guide"><div><ShieldCheck/><span><strong>No AWS Access Keys</strong><small>The app exchanges its production identity for short-lived credentials, then assumes only the restricted IAM role created for your connection.</small></span></div><ol><li><span>1</span><div><h3>Create a Connection</h3><p>Open <strong>App → Settings → AWS Accounts</strong> and name the account. Agent God Mode prepares a unique, restricted AWS access configuration.</p></div></li><li><span>2</span><div><h3>Authorize AWS Access</h3><p>Use <strong>Create AWS Access</strong> for the guided CloudFormation setup, or choose <strong>Set Up AWS Access Manually</strong> to copy the exact trust and permissions policies. The complete template creates the connection, CloudFormation, and EC2 roles required for automatic deployment.</p></div></li><li><span>3</span><div><h3>Verify Access</h3><p>Copy <code>ConnectionRoleArn</code> from the stack Outputs into Agent God Mode. Verification confirms the account and permissions through AWS STS.</p></div></li><li><span>4</span><div><h3>Deploy and Pair</h3><p>Choose a supported region, VPC, routed subnet, instance size, and encrypted disk. Agent God Mode creates the stack, waits for Session Manager, and pairs Paseo over encrypted Relay.</p></div></li></ol><div className="setup-reference-row"><External href="https://vercel.com/docs/oidc/aws">Vercel OIDC for AWS</External><External href="https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html">AWS External IDs</External><External href="https://docs.aws.amazon.com/prescriptive-guidance/latest/least-privilege-cloudformation/service-roles-for-cloudformation.html">CloudFormation Service Roles</External></div></div>
      <ol className="setup-compact-steps after-launch"><li><span>1</span><div><h3>Open the Instance</h3><p>In the stack Outputs, copy the Session Manager command and run it from an authenticated AWS CLI.</p></div></li><li><span>2</span><div><h3>Authenticate Providers</h3><p>Run logins as the same user that runs Paseo. Open the displayed URLs on your local computer and enter or paste the one-time codes back into the remote terminal.</p><Code>{"sudo -iu ubuntu\nclaude auth login\ncodex login --device-auth\ncursor-agent login\ngh auth login --web"}</Code><p>Codex has a dedicated device-code flow. Claude supports remote URL/code completion. Cursor currently has no documented device-code flag; use <code>CURSOR_API_KEY</code> if its browser flow cannot complete.</p></div></li><li><span>3</span><div><h3>Connect the Agent Instance</h3><p>Choose Tailscale Direct in settings for a private browser-to-instance connection, or generate a Relay pairing offer:</p><Code>{"paseo daemon pair --relay"}</Code></div></li></ol>
      <External href="https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html">AWS Systems Manager Session Manager</External>
    </section>

    <section className="setup-section setup-dark verify-section" id="verify">
      <div className="setup-heading"><span>07 · Verify</span><h2>Confirm the Agent Instance Before Starting Work.</h2></div>
      <div className="verify-grid"><article><Wifi/><h3>Daemon</h3><Code>{"paseo daemon status"}</Code></article><article><Terminal/><h3>Providers</h3><Code>{"paseo provider diagnostic claude\npaseo provider diagnostic codex"}</Code></article><article><Cloud/><h3>Remote Connection</h3><Code>{'paseo --host "$OFFER_URL" ls -a'}</Code></article></div>
      <p>If provider discovery still fails, verify the binary is installed for the daemon user and visible in that user’s PATH. See <External href="https://paseo.sh/docs/cli#provider-diagnostics">Paseo provider diagnostics</External>.</p>
    </section>

    <section className="marketing-final-cta"><span>Instance Ready?</span><h2>Pair It, Map a Repository, and Start a Workstream.</h2><Link className="marketing-button" href="/login?next=/app/settings">Open Settings <ArrowRight/></Link></section>
  </main>;
}
