"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Bot, Check, Cloud, ExternalLink, Github, Laptop, Server, ShieldCheck } from "lucide-react";
import appIcon from "../../resources/icon.png";
import { onboardingState } from "@/lib/onboarding";
import { AwsDeployControls } from "./aws-deploy-controls";
import { AwsAccountWizard } from "./aws-account-wizard";
import { useAgentLens } from "./snapshot-provider";
import { PaseoSetupWizard } from "./settings-page";

export function OnboardingPage({ awsTemplateUrl }: { awsTemplateUrl: string }) {
  const { snapshot, request } = useAgentLens();
  const state = onboardingState(snapshot);
  const [paseoWizardOpen, setPaseoWizardOpen] = useState(false);
  const [awsWizardOpen, setAwsWizardOpen] = useState(false);
  const [githubError, setGithubError] = useState("");
  const [introBusy, setIntroBusy] = useState(false);

  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get("githubError");
    if (message) setGithubError(message);
  }, []);

  return <main className="onboarding-page">
    <header className="onboarding-header"><Link href="/"><img src={appIcon.src} alt=""/><strong>Agent God Mode</strong></Link><span>Account Setup</span></header>
    <div className="onboarding-shell">
      <div className="onboarding-intro"><span className="eyebrow">Get Started</span><h1>Connect the Tools That Make Your Workstreams Run.</h1><p>We’ll connect GitHub, introduce Paseo, and set up your first Agent Instance.</p></div>
      <ol className="onboarding-progress" aria-label="Setup progress">
        <li className={!state.githubConnected ? "current" : "complete"}><span>{state.githubConnected ? <Check/> : "1"}</span><div><strong>GitHub</strong><small>{state.githubConnected ? "Connected" : "Required"}</small></div></li>
        <li className={state.paseoIntroductionSeen ? "complete" : state.githubConnected ? "current" : ""}><span>{state.paseoIntroductionSeen ? <Check/> : "2"}</span><div><strong>Meet Paseo</strong><small>{state.paseoIntroductionSeen ? "Introduced" : "Next"}</small></div></li>
        <li className={state.paseoConfigured ? "complete" : state.paseoIntroductionSeen ? "current" : ""}><span>{state.paseoConfigured ? <Check/> : "3"}</span><div><strong>Agent Instance</strong><small>{state.paseoConfigured ? "Connected" : "Required"}</small></div></li>
      </ol>

      {!state.githubConnected && <section className="onboarding-panel">
        <div className="onboarding-panel-icon"><Github/></div><span className="eyebrow">Step 1 of 3</span><h2>Connect GitHub</h2>
        <p>GitHub provides the repository list and lets Agent God Mode create branches and pull requests on your behalf.</p>
        <div className="onboarding-privacy"><ShieldCheck/><div><strong>Your Source Code Is Not Analyzed by Agent God Mode.</strong><span>We use GitHub for repository and delivery metadata. Your repositories are checked out and processed by agents running through Paseo on infrastructure you control.</span></div></div>
        {githubError && <div className="banner error" role="alert">{githubError}</div>}
        <a className="primary onboarding-primary" href="/api/github/connect?next=/onboarding"><Github/>Connect GitHub<ArrowRight/></a>
      </section>}

      {state.githubConnected && !state.paseoIntroductionSeen && <section className="onboarding-panel paseo-intro-panel">
        <div className="onboarding-panel-icon"><Bot/></div><span className="eyebrow">Step 2 of 3</span><h2>Meet Paseo</h2>
        <p>Paseo is the secure connection between Agent God Mode and the coding-agent tools running on your infrastructure.</p>
        <div className="onboarding-paseo-explainer"><div><strong>One Interface for Your Subscriptions</strong><span>Paseo makes your authenticated Claude Code, Codex, Cursor, and other supported agent CLIs available through one consistent interface.</span></div><div><strong>Code Stays on Your Infrastructure</strong><span>Agents work inside isolated workspaces on your Agent Instance. Your source code and provider sessions do not move into Agent God Mode.</span></div><div><strong>Work Continues Independently</strong><span>An always-on Agent Instance can keep planning, building, and reviewing even after you close this browser tab.</span></div></div>
        <div className="onboarding-intro-actions"><a className="button" href="https://paseo.sh" target="_blank" rel="noreferrer">Learn About Paseo<ExternalLink/></a><button className="primary" disabled={introBusy} onClick={() => { setIntroBusy(true); void request("/api/settings", { method: "PATCH", body: JSON.stringify({ paseoIntroductionSeen: true }) }).finally(() => setIntroBusy(false)); }}>{introBusy ? "Saving…" : "Set Up an Agent Instance"}<ArrowRight/></button></div>
      </section>}

      {state.githubConnected && state.paseoIntroductionSeen && !state.paseoConfigured && <section className="onboarding-panel paseo-onboarding-panel">
        <div className="onboarding-panel-icon"><Server/></div><span className="eyebrow">Step 3 of 3</span><h2>Set Up Your Agent Instance</h2>
        <p>An Agent Instance is a computer or cloud server running Paseo. Your repositories, agent subscriptions, and execution stay there.</p>
        <div className="onboarding-options">
          <article><Laptop/><div><strong>Use Your Computer or Server</strong><p>Run Paseo locally or on an existing machine, then connect through Tailscale or encrypted Relay. Local setup works well, but agents pause whenever that computer sleeps or disconnects.</p></div><button className="primary" onClick={() => setPaseoWizardOpen(true)}>Connect Instance<ArrowRight/></button></article>
          <article className="recommended"><span>Recommended</span><Cloud/><div><strong>Deploy an Always-On Agent Instance</strong><p>Keep long-running agents uninterrupted on an EC2 instance with Paseo and the supported agent CLIs installed.</p></div><AwsDeployControls templateUrl={awsTemplateUrl} compact onManagedDeploy={() => setAwsWizardOpen(true)}/></article>
        </div>
        <div className="onboarding-help"><span>Want to install Paseo and the provider CLIs yourself?</span><Link href="/docs/setup" target="_blank">Open the Manual Setup Guide<ExternalLink/></Link></div>
      </section>}

      {state.complete && <section className="onboarding-panel onboarding-complete">
        <div className="onboarding-panel-icon"><Check/></div><span className="eyebrow">Setup Complete</span><h2>Your Control Center Is Ready.</h2><p>GitHub and your Agent Instance are connected. You can now create your first workstream.</p><Link className="primary onboarding-primary" href="/app">Open Dashboard<ArrowRight/></Link>
      </section>}
    </div>
    {paseoWizardOpen && <PaseoSetupWizard request={request} onClose={() => setPaseoWizardOpen(false)}/>} 
    {awsWizardOpen && <AwsAccountWizard onClose={() => setAwsWizardOpen(false)}/>}
  </main>;
}
