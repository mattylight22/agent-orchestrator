"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Cloud, ExternalLink, Github, Laptop, Server, ShieldCheck } from "lucide-react";
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

  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get("githubError");
    if (message) setGithubError(message);
  }, []);

  return <main className="onboarding-page">
    <header className="onboarding-header"><Link href="/"><img src={appIcon.src} alt=""/><strong>Agent God Mode</strong></Link><span>Account setup</span></header>
    <div className="onboarding-shell">
      <div className="onboarding-intro"><span className="eyebrow">Get started</span><h1>Connect the tools that make your workstreams run.</h1><p>Both connections are required before entering the dashboard.</p></div>
      <ol className="onboarding-progress" aria-label="Setup progress">
        <li className={!state.githubConnected ? "current" : "complete"}><span>{state.githubConnected ? <Check/> : "1"}</span><div><strong>GitHub</strong><small>{state.githubConnected ? "Connected" : "Required"}</small></div></li>
        <li className={state.githubConnected ? state.paseoConfigured ? "complete" : "current" : ""}><span>{state.paseoConfigured ? <Check/> : "2"}</span><div><strong>Paseo host</strong><small>{state.paseoConfigured ? "Connected" : "Required"}</small></div></li>
      </ol>

      {!state.githubConnected && <section className="onboarding-panel">
        <div className="onboarding-panel-icon"><Github/></div><span className="eyebrow">Step 1 of 2</span><h2>Connect GitHub</h2>
        <p>GitHub provides the repository list and lets Agent God Mode create branches and pull requests on your behalf.</p>
        <div className="onboarding-privacy"><ShieldCheck/><div><strong>Your source code is not analyzed by Agent God Mode.</strong><span>We use GitHub for repository and delivery metadata. Your repositories are checked out and processed by agents running through Paseo on infrastructure you control.</span></div></div>
        {githubError && <div className="banner error" role="alert">{githubError}</div>}
        <a className="primary onboarding-primary" href="/api/github/connect?next=/onboarding"><Github/>Connect GitHub<ArrowRight/></a>
      </section>}

      {state.githubConnected && !state.paseoConfigured && <section className="onboarding-panel paseo-onboarding-panel">
        <div className="onboarding-panel-icon"><Server/></div><span className="eyebrow">Step 2 of 2</span><h2>Set up your Paseo host</h2>
        <p>Your Paseo host is where repositories, agent subscriptions, and execution stay. Connect a machine you already manage or deploy a dedicated host in your AWS account.</p>
        <div className="onboarding-options">
          <article><Laptop/><div><strong>Use your computer or server</strong><p>Run Paseo locally or on an existing machine, then connect through Tailscale or encrypted Relay. Local setup works well, but agents pause whenever that computer sleeps or disconnects.</p></div><button className="primary" onClick={() => setPaseoWizardOpen(true)}>Connect host<ArrowRight/></button></article>
          <article className="recommended"><span>Recommended</span><Cloud/><div><strong>Deploy an always-on AWS host</strong><p>Keep long-running agents uninterrupted on an EC2 instance with Paseo and the supported agent CLIs installed.</p></div><AwsDeployControls templateUrl={awsTemplateUrl} compact onManagedDeploy={() => setAwsWizardOpen(true)}/></article>
        </div>
        <div className="onboarding-help"><span>Want to install Paseo and the provider CLIs yourself?</span><Link href="/docs/setup" target="_blank">Open the manual setup guide<ExternalLink/></Link></div>
      </section>}

      {state.complete && <section className="onboarding-panel onboarding-complete">
        <div className="onboarding-panel-icon"><Check/></div><span className="eyebrow">Setup complete</span><h2>Your control center is ready.</h2><p>GitHub and Paseo are connected. You can now create your first workstream.</p><Link className="primary onboarding-primary" href="/app">Open dashboard<ArrowRight/></Link>
      </section>}
    </div>
    {paseoWizardOpen && <PaseoSetupWizard request={request} onClose={() => setPaseoWizardOpen(false)}/>} 
    {awsWizardOpen && <AwsAccountWizard onClose={() => setAwsWizardOpen(false)}/>}
  </main>;
}
