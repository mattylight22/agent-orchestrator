import { sleep } from "workflow";
import { CreateStackCommand, DeleteStackCommand, DescribeStackResourcesCommand, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DescribeInstanceInformationCommand, GetCommandInvocationCommand, SendCommandCommand } from "@aws-sdk/client-ssm";
import { awsConnectionToken, type AwsRegion } from "@agent-lens/domain";
import { awsClients, managedHostTemplateUrl } from "@/lib/aws";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parsePairingLink, storePaseoPairing, validatePairingOffer } from "@/lib/paseo";

type Row = Record<string, any>;

async function loadDeployment(userId: string, deploymentId: string): Promise<Row> {
  const { data, error } = await createSupabaseAdminClient().from("aws_paseo_deployments").select("*").eq("user_id", userId).eq("id", deploymentId).single();
  if (error || !data) throw error ?? new Error("AWS deployment not found");
  return data;
}

async function setDeploymentState(userId: string, deploymentId: string, state: string, values: Record<string, unknown> = {}) {
  "use step";
  const { error } = await createSupabaseAdminClient().from("aws_paseo_deployments").update({ state, failure_detail: null, ...values }).eq("user_id", userId).eq("id", deploymentId);
  if (error) throw error;
}

function missingStack(error: unknown) {
  return error instanceof Error && /does not exist|not exist/i.test(error.message);
}

async function createOrResumeStack(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const region = deployment.region as AwsRegion;
  const { account, cloudformation } = await awsClients(userId, deployment.aws_account_id, region, "create-stack");
  if (!account.account_id) throw new Error("AWS account identity is unavailable");
  let existing;
  try { existing = (await cloudformation.send(new DescribeStacksCommand({ StackName: deployment.stack_name }))).Stacks?.[0]; }
  catch (error) { if (!missingStack(error)) throw error; }
  if (existing) {
    if (existing.StackStatus === "CREATE_COMPLETE") return existing.StackId ?? deployment.stack_arn;
    if (existing.StackStatus?.includes("ROLLBACK") || existing.StackStatus?.includes("FAILED")) throw new Error("The AWS stack failed or rolled back. Delete it before redeploying this host.");
    return existing.StackId ?? deployment.stack_arn;
  }
  const connectionToken = awsConnectionToken(deployment.aws_account_id);
  const deploymentToken = String(deployment.id).replace(/[^a-f0-9]/gi, "").toLowerCase().slice(0, 24);
  const executionRoleArn = `arn:aws:iam::${account.account_id}:role/AgentGodModeExecution-${connectionToken}`;
  const result = await cloudformation.send(new CreateStackCommand({
    StackName: deployment.stack_name,
    TemplateURL: managedHostTemplateUrl(),
    RoleARN: executionRoleArn,
    OnFailure: "DO_NOTHING",
    Parameters: [
      { ParameterKey: "VpcId", ParameterValue: deployment.vpc_id },
      { ParameterKey: "SubnetId", ParameterValue: deployment.subnet_id },
      { ParameterKey: "InstanceProfileName", ParameterValue: `AgentGodModeInstance-${connectionToken}` },
      { ParameterKey: "ConnectionId", ParameterValue: connectionToken },
      { ParameterKey: "DeploymentId", ParameterValue: deploymentToken },
      { ParameterKey: "AssociatePublicIpAddress", ParameterValue: String(deployment.associate_public_ip) },
      { ParameterKey: "InstanceType", ParameterValue: deployment.instance_type },
      { ParameterKey: "RootVolumeSize", ParameterValue: String(deployment.volume_size) },
    ],
    Tags: [
      { Key: "Application", Value: "AgentGodMode" },
      { Key: "AgentGodModeConnection", Value: connectionToken },
      { Key: "AgentGodModeDeployment", Value: deploymentToken },
    ],
  }));
  await createSupabaseAdminClient().from("aws_paseo_deployments").update({ stack_arn: result.StackId ?? null }).eq("user_id", userId).eq("id", deploymentId);
  return result.StackId ?? null;
}

async function readStack(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { cloudformation } = await awsClients(userId, deployment.aws_account_id, deployment.region, "read-stack");
  const stack = (await cloudformation.send(new DescribeStacksCommand({ StackName: deployment.stack_name }))).Stacks?.[0];
  if (!stack?.StackStatus) throw new Error("AWS did not return the stack state");
  if (stack.StackStatus === "CREATE_COMPLETE") {
    const resources = await cloudformation.send(new DescribeStackResourcesCommand({ StackName: deployment.stack_name, LogicalResourceId: "PaseoHost" }));
    const instanceId = resources.StackResources?.find((item) => item.LogicalResourceId === "PaseoHost")?.PhysicalResourceId;
    if (!instanceId) throw new Error("AWS created the stack without a Paseo EC2 instance");
    return { complete: true, instanceId };
  }
  if (stack.StackStatus.includes("FAILED") || stack.StackStatus.includes("ROLLBACK")) throw new Error(`AWS stack entered ${stack.StackStatus}`);
  return { complete: false, instanceId: null };
}

async function isSsmReady(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { ssm } = await awsClients(userId, deployment.aws_account_id, deployment.region, "ssm-status");
  const result = await ssm.send(new DescribeInstanceInformationCommand({ Filters: [{ Key: "InstanceIds", Values: [deployment.instance_id] }] }));
  return result.InstanceInformationList?.some((item) => item.InstanceId === deployment.instance_id && item.PingStatus === "Online") ?? false;
}

function commandFailureOutput(result: { StandardErrorContent?: string; StandardOutputContent?: string }) {
  return `${result.StandardErrorContent ?? ""}\n${result.StandardOutputContent ?? ""}`
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/#offer=[^\s'\"]+/g, "#offer=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function invocationPending(error: unknown) {
  return error instanceof Error && error.name === "InvocationDoesNotExist";
}

async function startBootstrapWaitCommand(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { ssm } = await awsClients(userId, deployment.aws_account_id, deployment.region, "bootstrap-start");
  const result = await ssm.send(new SendCommandCommand({
    DocumentName: "AWS-RunShellScript",
    InstanceIds: [deployment.instance_id],
    Parameters: { commands: [
      "set -eu",
      "cloud-init status --wait",
      "command -v paseo >/dev/null 2>&1",
      "systemctl is-active --quiet paseo.service",
    ] },
    TimeoutSeconds: 900,
    Comment: `Wait for Agent God Mode bootstrap ${String(deployment.id).slice(0, 8)}`,
  }));
  if (!result.Command?.CommandId) throw new Error("AWS did not start the Agent Instance readiness check");
  return result.Command.CommandId;
}

async function bootstrapCommandState(userId: string, deploymentId: string, commandId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { ssm } = await awsClients(userId, deployment.aws_account_id, deployment.region, "bootstrap-status");
  try {
    const result = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: deployment.instance_id }));
    if (["Failed", "Cancelled", "TimedOut", "Cancelling"].includes(result.Status ?? "")) {
      const output = commandFailureOutput(result);
      throw new Error(output ? `Agent Instance setup failed: ${output}` : `Agent Instance readiness check ended with ${result.Status}`);
    }
    return result.Status === "Success";
  } catch (error) { if (invocationPending(error)) return false; throw error; }
}

async function startPairCommand(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  if (deployment.pair_command_id) return deployment.pair_command_id as string;
  const { ssm } = await awsClients(userId, deployment.aws_account_id, deployment.region, "pair-start");
  const result = await ssm.send(new SendCommandCommand({
    DocumentName: "AWS-RunShellScript",
    InstanceIds: [deployment.instance_id],
    Parameters: { commands: [
      "set -eu",
      "cloud-init status --wait",
      "command -v paseo >/dev/null 2>&1 || { echo 'Paseo CLI is unavailable after bootstrap. Review /var/log/agent-god-mode-bootstrap.log.' >&2; tail -n 80 /var/log/agent-god-mode-bootstrap.log >&2; exit 127; }",
      "sudo -iu ubuntu env PATH=/home/ubuntu/.local/bin:/home/ubuntu/.cursor/bin:/usr/local/bin:/usr/bin:/bin paseo daemon pair --relay",
    ] },
    TimeoutSeconds: 900,
    Comment: `Agent God Mode Relay pairing ${String(deployment.id).slice(0, 8)}`,
  }));
  if (!result.Command?.CommandId) throw new Error("AWS did not start the Paseo pairing command");
  const { error } = await createSupabaseAdminClient().from("aws_paseo_deployments").update({ pair_command_id: result.Command.CommandId }).eq("user_id", userId).eq("id", deploymentId);
  if (error) throw error;
  return result.Command.CommandId;
}

async function pairCommandState(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { ssm } = await awsClients(userId, deployment.aws_account_id, deployment.region, "pair-status");
  try {
    const result = await ssm.send(new GetCommandInvocationCommand({ CommandId: deployment.pair_command_id, InstanceId: deployment.instance_id }));
    if (["Failed", "Cancelled", "TimedOut", "Cancelling"].includes(result.Status ?? "")) {
      const output = commandFailureOutput(result);
      throw new Error(output ? `Paseo pairing failed on the Agent Instance: ${output}` : `Paseo pairing command ended with ${result.Status}`);
    }
    return result.Status === "Success";
  } catch (error) { if (invocationPending(error)) return false; throw error; }
}

async function completePairing(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { ssm } = await awsClients(userId, deployment.aws_account_id, deployment.region, "pair-complete");
  const result = await ssm.send(new GetCommandInvocationCommand({ CommandId: deployment.pair_command_id, InstanceId: deployment.instance_id }));
  if (result.Status !== "Success") throw new Error("Paseo pairing is not complete");
  const clean = (result.StandardOutputContent ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  const pairingLink = clean.match(/https?:\/\/[^\s'\"]+#offer=[^\s'\"]+/)?.[0];
  if (!pairingLink) throw new Error("Paseo did not return a valid Relay pairing offer");
  const offer = parsePairingLink(pairingLink);
  const catalog = await validatePairingOffer(offer);
  const hostId = await storePaseoPairing(userId, deployment.name, offer, catalog);
  const { error } = await createSupabaseAdminClient().from("aws_paseo_deployments").update({ paseo_host_id: hostId, state: "ready", failure_detail: null }).eq("user_id", userId).eq("id", deploymentId);
  if (error) throw error;
  return hostId;
}

async function failDeployment(userId: string, deploymentId: string, error: unknown) {
  "use step";
  const message = error instanceof Error ? error.message : "AWS provisioning failed";
  await createSupabaseAdminClient().from("aws_paseo_deployments").update({ state: "failed", failure_detail: message.slice(0, 1000) }).eq("user_id", userId).eq("id", deploymentId);
}

export async function provisionAwsPaseoWorkflow(userId: string, deploymentId: string) {
  "use workflow";
  try {
    await setDeploymentState(userId, deploymentId, "creating");
    await createOrResumeStack(userId, deploymentId);
    let stack;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      stack = await readStack(userId, deploymentId);
      if (stack.complete) break;
      await sleep("10s");
    }
    if (!stack?.complete || !stack.instanceId) throw new Error("Timed out waiting for the AWS stack");
    await setDeploymentState(userId, deploymentId, "waiting-for-ssm", { instance_id: stack.instanceId });
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      ready = await isSsmReady(userId, deploymentId);
      if (ready) break;
      await sleep("10s");
    }
    if (!ready) throw new Error("Timed out waiting for the EC2 instance to register with Session Manager");
    const bootstrapCommandId = await startBootstrapWaitCommand(userId, deploymentId);
    let bootstrapReady = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      bootstrapReady = await bootstrapCommandState(userId, deploymentId, bootstrapCommandId);
      if (bootstrapReady) break;
      await sleep("3s");
    }
    if (!bootstrapReady) throw new Error("Timed out waiting for the Agent Instance setup to finish");
    await setDeploymentState(userId, deploymentId, "pairing");
    await startPairCommand(userId, deploymentId);
    let paired = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      paired = await pairCommandState(userId, deploymentId);
      if (paired) break;
      await sleep("3s");
    }
    if (!paired) throw new Error("Timed out waiting for Paseo Relay pairing");
    await completePairing(userId, deploymentId);
  } catch (error) {
    await failDeployment(userId, deploymentId, error);
    throw error;
  }
}

async function deleteStack(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { account, cloudformation } = await awsClients(userId, deployment.aws_account_id, deployment.region, "delete-stack");
  if (!account.account_id) throw new Error("AWS account identity is unavailable");
  try {
    await cloudformation.send(new DeleteStackCommand({ StackName: deployment.stack_name, RoleARN: `arn:aws:iam::${account.account_id}:role/AgentGodModeExecution-${awsConnectionToken(deployment.aws_account_id)}` }));
  } catch (error) { if (!missingStack(error)) throw error; }
}

async function stackDeleted(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const { cloudformation } = await awsClients(userId, deployment.aws_account_id, deployment.region, "delete-status");
  try {
    const stack = (await cloudformation.send(new DescribeStacksCommand({ StackName: deployment.stack_name }))).Stacks?.[0];
    if (stack?.StackStatus === "DELETE_FAILED") throw new Error("AWS could not delete the stack. Review its stack events before retrying.");
    return false;
  } catch (error) { if (missingStack(error)) return true; throw error; }
}

async function finishDeletion(userId: string, deploymentId: string) {
  "use step";
  const deployment = await loadDeployment(userId, deploymentId);
  const admin = createSupabaseAdminClient();
  if (deployment.paseo_host_id) {
    await admin.from("paseo_connections").delete().eq("user_id", userId).eq("host_id", deployment.paseo_host_id).eq("transport", "relay");
    await admin.from("paseo_hosts").update({ enabled: false, deleted_at: new Date().toISOString() }).eq("user_id", userId).eq("id", deployment.paseo_host_id);
  }
  const { error } = await admin.from("aws_paseo_deployments").update({ state: "deleted", deleted_at: new Date().toISOString(), failure_detail: null }).eq("user_id", userId).eq("id", deploymentId);
  if (error) throw error;
}

export async function deleteAwsPaseoWorkflow(userId: string, deploymentId: string) {
  "use workflow";
  try {
    await setDeploymentState(userId, deploymentId, "deleting");
    await deleteStack(userId, deploymentId);
    let deleted = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      deleted = await stackDeleted(userId, deploymentId);
      if (deleted) break;
      await sleep("10s");
    }
    if (!deleted) throw new Error("Timed out waiting for AWS to delete the stack");
    await finishDeletion(userId, deploymentId);
  } catch (error) {
    await failDeployment(userId, deploymentId, error);
    throw error;
  }
}
