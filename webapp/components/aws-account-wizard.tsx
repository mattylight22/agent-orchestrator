"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Cloud, Copy, ExternalLink, LoaderCircle, Network, Server, ShieldCheck, Terminal, X } from "lucide-react";
import { awsInstanceTypes, type AwsAccountConnection, type AwsPaseoDeployment, type AwsRegion } from "@agent-lens/domain";
import { AWS_DEFAULT_DEPLOYMENT_REGION, AWS_DEPLOYMENT_REGIONS } from "@/lib/aws-deployment";
import { useAgentLens } from "./snapshot-provider";

interface SetupPayload { token: string; roleName: string; launchUrl: string; trustPolicy: string; permissionsPolicy: string }
interface NetworksPayload { vpcs: Array<{ id: string; name: string; isDefault: boolean }>; subnets: Array<{ id: string; name: string; vpcId: string; availabilityZone: string; cidr: string; routeType: "nat" | "public"; associatePublicIp: boolean }> }
type Stage = "accounts" | "create" | "access" | "deploy" | "progress";

export function AwsAccountWizard({ onClose }: { onClose(): void }) {
  const { snapshot, request } = useAgentLens();
  const accounts = snapshot.awsAccounts ?? [];
  const deployments = snapshot.awsDeployments ?? [];
  const [stage, setStage] = useState<Stage>(accounts.length ? "accounts" : "create");
  const [connectionId, setConnectionId] = useState(accounts.find((item) => item.state === "connected")?.id ?? "");
  const [accountName, setAccountName] = useState("");
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [roleArn, setRoleArn] = useState("");
  const [manual, setManual] = useState(false);
  const [region, setRegion] = useState<AwsRegion>(AWS_DEFAULT_DEPLOYMENT_REGION);
  const [networks, setNetworks] = useState<NetworksPayload | null>(null);
  const [vpcId, setVpcId] = useState("");
  const [subnetId, setSubnetId] = useState("");
  const [deploymentName, setDeploymentName] = useState("Agent Instance");
  const [instanceType, setInstanceType] = useState<(typeof awsInstanceTypes)[number]>("t3.medium");
  const [volumeSize, setVolumeSize] = useState(100);
  const [deploymentId, setDeploymentId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const selectedAccount = accounts.find((item) => item.id === connectionId);
  const selectedSubnet = networks?.subnets.find((item) => item.id === subnetId);
  const deployment = deployments.find((item) => item.id === deploymentId);
  const estimate = AWS_DEPLOYMENT_REGIONS.find((item) => item.id === region) ?? AWS_DEPLOYMENT_REGIONS[1];
  const visibleSubnets = useMemo(() => networks?.subnets.filter((item) => item.vpcId === vpcId) ?? [], [networks, vpcId]);

  useEffect(() => {
    if (stage !== "deploy" || !connectionId) return;
    let cancelled = false;
    setBusy("networks"); setError(""); setNetworks(null); setVpcId(""); setSubnetId("");
    request<NetworksPayload>(`/api/aws/accounts/${connectionId}/networks?region=${region}`)
      .then((value) => { if (!cancelled) { setNetworks(value); const preferred = value.vpcs.find((item) => item.isDefault && value.subnets.some((subnet) => subnet.vpcId === item.id)) ?? value.vpcs.find((item) => value.subnets.some((subnet) => subnet.vpcId === item.id)); setVpcId(preferred?.id ?? ""); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load AWS networks"); })
      .finally(() => { if (!cancelled) setBusy(""); });
    return () => { cancelled = true; };
  }, [connectionId, region, request, stage]);

  useEffect(() => { setSubnetId(""); }, [vpcId]);

  async function createConnection(event: React.FormEvent) {
    event.preventDefault(); setBusy("create"); setError("");
    try {
      const value = await request<{ connectionId: string; setup: SetupPayload }>("/api/aws/accounts", { method: "POST", body: JSON.stringify({ name: accountName }) });
      setConnectionId(value.connectionId); setSetup(value.setup); setStage("access");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create AWS connection"); }
    finally { setBusy(""); }
  }

  async function openPending(account: AwsAccountConnection) {
    setBusy(account.id); setError("");
    try { const value = await request<{ setup: SetupPayload }>(`/api/aws/accounts/${account.id}/setup`); setConnectionId(account.id); setSetup(value.setup); setStage("access"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load AWS setup"); }
    finally { setBusy(""); }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault(); setBusy("verify"); setError("");
    try { await request(`/api/aws/accounts/${connectionId}/verify`, { method: "POST", body: JSON.stringify({ roleArn }) }); setStage("deploy"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "AWS role verification failed"); }
    finally { setBusy(""); }
  }

  async function deploy(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSubnet) return;
    setBusy("deploy"); setError("");
    try {
      const value = await request<{ id: string }>("/api/aws/deployments", { method: "POST", body: JSON.stringify({ awsAccountId: connectionId, name: deploymentName, region, vpcId, subnetId, routeType: selectedSubnet.routeType, associatePublicIp: selectedSubnet.associatePublicIp, instanceType, volumeSize }) });
      setDeploymentId(value.id); setStage("progress");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start AWS deployment"); }
    finally { setBusy(""); }
  }

  return <div className="dialog-backdrop" role="presentation"><section className="dialog aws-account-wizard" role="dialog" aria-modal="true" aria-labelledby="aws-wizard-title">
    <header><div><span className="eyebrow">Credentialless AWS</span><h2 id="aws-wizard-title">Deploy an Agent Instance</h2></div><button className="icon-button" aria-label="Close AWS Setup" onClick={onClose}><X/></button></header>
    <ol className="wizard-steps aws-wizard-steps" aria-label="AWS setup progress"><li className={["accounts","create","access","deploy","progress"].includes(stage) ? "active" : ""}><span>1</span>Account</li><li className={["access","deploy","progress"].includes(stage) ? "active" : ""}><span>2</span>Access</li><li className={["deploy","progress"].includes(stage) ? "active" : ""}><span>3</span>Configure</li><li className={stage === "progress" ? "active" : ""}><span>4</span>Provision</li></ol>
    {error && <div className="banner error aws-wizard-error" role="alert">{error}</div>}

    {stage === "accounts" && <div className="wizard-panel"><div><h3>Choose an AWS Account</h3><p>Use an existing connection or add another account without storing access keys.</p></div><div className="aws-account-list">{accounts.map((account) => <button key={account.id} onClick={() => account.state === "connected" ? (setConnectionId(account.id), setStage("deploy")) : void openPending(account)}><Cloud/><span><strong>{account.name}</strong><small>{account.state === "connected" ? `Account ${account.accountId}` : "Finish Role Setup"}</small></span><i className={account.state}>{account.state}</i><ArrowRight/></button>)}</div><footer><button className="primary" onClick={() => setStage("create")}>Connect Another Account<ArrowRight/></button></footer></div>}

    {stage === "create" && <form className="wizard-panel" onSubmit={createConnection}><div><h3>Name This AWS Account</h3><p>This is only a label in Agent God Mode. No AWS access keys are requested or stored.</p></div><label>Account Name<input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Engineering production" autoFocus required/></label><div className="wizard-callout"><ShieldCheck/><span><strong>Short-Lived Access Only</strong><small>Every operation exchanges a production OIDC identity for temporary AWS credentials, then assumes the restricted IAM role created for this connection.</small></span></div><footer>{accounts.length > 0 && <button type="button" className="button" onClick={() => setStage("accounts")}><ArrowLeft/>Back</button>}<button className="primary" disabled={busy === "create"}>{busy === "create" ? <LoaderCircle className="spinning"/> : null}Create Connection<ArrowRight/></button></footer></form>}

    {stage === "access" && setup && <form className="wizard-panel aws-access-panel" onSubmit={verify}><div><h3>Authorize Agent God Mode in AWS</h3><p>The recommended stack creates three restricted IAM roles: one for this connection, one for CloudFormation, and one for the EC2 host. Access is limited to Agent God Mode infrastructure.</p></div><a className="primary button aws-launch-access" href={setup.launchUrl} target="_blank" rel="noreferrer">Create AWS Access<ExternalLink/></a><button type="button" className="text-button" onClick={() => setManual((value) => !value)}>{manual ? "Hide Manual IAM Setup" : "Set Up AWS Access Manually"}</button>{manual && <div className="manual-iam"><p>Create an IAM role named <code>{setup.roleName}</code>, choose <strong>Custom Trust Policy</strong>, and paste the first document. Then add an inline permissions policy with the second document.</p><JsonCopyBox title="Trust Policy" value={setup.trustPolicy}/><JsonCopyBox title="Permissions Policy" value={setup.permissionsPolicy}/><div className="banner warning">Automatic deployment also needs the restricted CloudFormation and EC2 roles. The complete template creates all three roles.</div><a href="/aws/agent-god-mode-aws-access.yaml" download>Download Complete IAM Template</a></div>}<label>AWS Connection Role ARN<input value={roleArn} onChange={(event) => setRoleArn(event.target.value)} placeholder={`arn:aws:iam::123456789012:role/${setup.roleName}`} spellCheck={false} required/><small>Copy <code>ConnectionRoleArn</code> from the stack’s Outputs tab.</small></label><footer><button type="button" className="button" onClick={() => setStage(accounts.length > 1 ? "accounts" : "create")}><ArrowLeft/>Back</button><button className="primary" disabled={busy === "verify"}>{busy === "verify" ? <LoaderCircle className="spinning"/> : null}Verify Access<ArrowRight/></button></footer></form>}

    {stage === "deploy" && <form className="wizard-panel aws-deploy-form" onSubmit={deploy}><div><h3>Configure the Agent Instance</h3><p>Only subnets with a usable NAT Gateway or internet-gateway route are available.</p></div><div className="field-grid"><label>Account<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>{accounts.filter((item) => item.state === "connected").map((item) => <option value={item.id} key={item.id}>{item.name} · {item.accountId}</option>)}</select></label><label>Region<select value={region} onChange={(event) => setRegion(event.target.value as AwsRegion)}>{AWS_DEPLOYMENT_REGIONS.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.id}</option>)}</select></label><label>VPC<select value={vpcId} onChange={(event) => setVpcId(event.target.value)} disabled={busy === "networks"}><option value="">Select VPC…</option>{networks?.vpcs.filter((vpc) => networks.subnets.some((subnet) => subnet.vpcId === vpc.id)).map((vpc) => <option value={vpc.id} key={vpc.id}>{vpc.name} · {vpc.id}{vpc.isDefault ? " · default" : ""}</option>)}</select></label><label>Subnet<select value={subnetId} onChange={(event) => setSubnetId(event.target.value)} disabled={!vpcId || busy === "networks"}><option value="">Select Subnet…</option>{visibleSubnets.map((subnet) => <option value={subnet.id} key={subnet.id}>{subnet.name} · {subnet.availabilityZone} · {subnet.routeType === "nat" ? "private/NAT" : "public route"}</option>)}</select></label><label>Instance Type<select value={instanceType} onChange={(event) => setInstanceType(event.target.value as typeof instanceType)}>{awsInstanceTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Encrypted Disk (GB)<input type="number" min={40} max={2048} value={volumeSize} onChange={(event) => setVolumeSize(Number(event.target.value))}/></label></div><label>Instance Name<input value={deploymentName} onChange={(event) => setDeploymentName(event.target.value)} required/></label>{selectedSubnet && <div className="aws-network-result"><Network/><div><strong>{selectedSubnet.routeType === "nat" ? "Private Subnet Through NAT Gateway" : "Internet-Gateway Subnet With Public IP"}</strong><small>{selectedSubnet.routeType === "nat" ? "The instance receives no public IP." : "The instance receives a public IP for outbound traffic, but its security group has no inbound rules."}</small></div></div>}<div className="aws-inline-estimate"><span>Estimated Default in {estimate.label}</span><strong>≈ ${estimate.total}/month</strong><small>For t3.medium and 100 GB gp3. The displayed baseline changes only by region; larger compute or disk selections cost more.</small></div><div className="banner warning">Deleting this deployment later terminates the instance and permanently destroys its encrypted EBS volume.</div><footer><button type="button" className="button" onClick={() => setStage("accounts")}><ArrowLeft/>Back</button><button className="primary" disabled={!selectedSubnet || busy === "deploy"}>{busy === "deploy" ? <LoaderCircle className="spinning"/> : null}Deploy and Pair<ArrowRight/></button></footer></form>}

    {stage === "progress" && <div className="wizard-panel aws-progress"><div><h3>{deployment?.state === "ready" ? "Agent Instance Ready" : "Provisioning in AWS"}</h3><p>{deployment?.state === "ready" ? "The Agent Instance is online and paired through Paseo Relay." : "You can close this window. Provisioning continues and its status stays available in Settings."}</p></div><DeploymentProgress deployment={deployment}/>{deployment?.state === "ready" && deployment.instanceId && <div className="aws-ready-actions"><a className="button" href={sessionUrl(deployment)} target="_blank" rel="noreferrer"><Terminal/>Open Session Manager<ExternalLink/></a><div className="setup-code compact"><code>{"sudo -iu ubuntu\nclaude auth login\ncodex login --device-auth\ncursor-agent login\ngh auth login --web"}</code></div></div>}<footer><button className="primary" onClick={onClose}>{deployment?.state === "ready" ? "Done" : "Close"}</button></footer></div>}
  </section></div>;
}

export function DeploymentProgress({ deployment }: { deployment?: AwsPaseoDeployment }) {
  const states = ["creating", "waiting-for-ssm", "pairing", "ready"];
  const index = deployment ? states.indexOf(deployment.state) : -1;
  return <div className="deployment-progress" role="status" aria-live="polite">{states.map((state, itemIndex) => <div className={deployment?.state === "failed" ? "failed" : itemIndex < index || deployment?.state === "ready" ? "complete" : itemIndex === index || (!deployment && itemIndex === 0) ? "active" : ""} key={state}><span>{itemIndex < index || deployment?.state === "ready" ? <Check/> : itemIndex + 1}</span><strong>{state === "creating" ? "Create Stack" : state === "waiting-for-ssm" ? "Start Instance" : state === "pairing" ? "Pair Relay" : "Ready"}</strong></div>)}{deployment?.failureDetail && <div className="banner error">{deployment.failureDetail}</div>}</div>;
}

function JsonCopyBox({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="json-copy-box"><header><strong>{title}</strong><button type="button" onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>{copied ? <Check/> : <Copy/>}{copied ? "Copied" : "Copy JSON"}</button></header><pre><code>{value}</code></pre></div>;
}

export function sessionUrl(deployment: AwsPaseoDeployment) {
  return `https://${deployment.region}.console.aws.amazon.com/systems-manager/session-manager/${deployment.instanceId}?region=${deployment.region}`;
}

export function AwsAccountsPanel({ onAdd }: { onAdd(): void }) {
  const { snapshot, request } = useAgentLens();
  const accounts = snapshot.awsAccounts ?? [];
  const deployments = snapshot.awsDeployments ?? [];
  const [deleting, setDeleting] = useState<AwsPaseoDeployment | null>(null);
  const [disconnecting, setDisconnecting] = useState<AwsAccountConnection | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function deploymentAction(deployment: AwsPaseoDeployment, action: "retry" | "delete") {
    setBusy(deployment.id); setError("");
    try { await request(`/api/aws/deployments/${deployment.id}/actions`, { method: "POST", body: JSON.stringify({ action, confirmation: action === "delete" ? confirmation : undefined }) }); if (action === "delete") { setDeleting(null); setConfirmation(""); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : "AWS deployment action failed"); }
    finally { setBusy(""); }
  }

  async function disconnectAccount(account: AwsAccountConnection) {
    setBusy(account.id); setError("");
    try {
      await request(`/api/aws/accounts/${account.id}`, { method: "DELETE" });
      setDisconnecting(null); setConfirmation("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not disconnect the AWS account"); }
    finally { setBusy(""); }
  }

  return <div className="aws-accounts-panel">
    {error && <div className="banner error" role="alert">{error}</div>}
    {!accounts.length && <div className="empty-connection"><Cloud/><div><strong>No AWS Accounts Connected</strong><small>Connect with short-lived credentials to deploy and manage an Agent Instance without AWS access keys.</small></div></div>}
    {accounts.map((account) => { const retained = deployments.filter((item) => item.awsAccountId === account.id && item.state !== "deleted"); return <div className="aws-account-group" key={account.id}><header><div className="connection-icon"><Cloud/></div><span><strong>{account.name}</strong><small>{account.accountId ? `AWS account ${account.accountId}` : "AWS role setup is incomplete"}</small></span><i className={account.state}>{account.state}</i>{account.state !== "connected" && <button className="button" onClick={onAdd}>Finish Setup</button>}<button className="icon-button" aria-label={`Disconnect ${account.name}`} title={retained.length ? "Delete this account’s deployments first" : "Disconnect AWS account"} disabled={retained.length > 0} onClick={() => { setDisconnecting(account); setConfirmation(""); }}><X/></button></header>{retained.map((deployment) => <div className="aws-deployment-row" key={deployment.id}><Server/><span><strong>{deployment.name}</strong><small>{deployment.region} · {deployment.instanceType} · {deployment.volumeSize} GB · {deployment.stackName}</small>{deployment.failureDetail && <small className="error-text">{deployment.failureDetail}</small>}</span><i className={deployment.state}>{deployment.state.replaceAll("-", " ")}</i>{deployment.state === "ready" && deployment.instanceId && <a className="button" href={sessionUrl(deployment)} target="_blank" rel="noreferrer"><Terminal/>Open Terminal</a>}{deployment.state === "failed" && <button className="button" disabled={busy === deployment.id} onClick={() => void deploymentAction(deployment, "retry")}>Retry</button>}{!["creating", "waiting-for-ssm", "pairing", "deleting"].includes(deployment.state) && <button className="button danger" onClick={() => { setDeleting(deployment); setConfirmation(""); }}>Delete</button>}</div>)}</div>; })}
    <div className="add-host-row"><div><Cloud/><span><strong>Deploy Through Your AWS Account</strong><small>Use OIDC and a scoped IAM role. Agent God Mode never stores AWS access keys.</small></span></div><button className="primary" onClick={onAdd}>Connect or Deploy<ArrowRight/></button></div>
    {deleting && <div className="nested-confirm"><div><strong>Delete {deleting.name}?</strong><p>This deletes the CloudFormation stack, terminates the EC2 instance, and permanently destroys its encrypted {deleting.volumeSize} GB volume. Type <code>{deleting.name}</code> to confirm.</p></div><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus/><div><button className="button" onClick={() => setDeleting(null)}>Cancel</button><button className="button danger" disabled={confirmation !== deleting.name || busy === deleting.id} onClick={() => void deploymentAction(deleting, "delete")}>Delete Infrastructure</button></div></div>}
    {disconnecting && <div className="nested-confirm"><div><strong>Disconnect {disconnecting.name}?</strong><p>Agent God Mode will delete its encrypted connection secret. To completely revoke access, also delete the <code>agent-god-mode-access-*</code> stack in AWS. Type <code>{disconnecting.name}</code> to confirm.</p></div><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus/><div><button className="button" onClick={() => setDisconnecting(null)}>Cancel</button><button className="button danger" disabled={confirmation !== disconnecting.name || busy === disconnecting.id} onClick={() => void disconnectAccount(disconnecting)}>Disconnect Account</button></div></div>}
  </div>;
}
