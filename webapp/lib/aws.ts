import "server-only";

import { randomUUID } from "node:crypto";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { DescribeRouteTablesCommand, DescribeSubnetsCommand, DescribeVpcsCommand, EC2Client } from "@aws-sdk/client-ec2";
import { SSMClient } from "@aws-sdk/client-ssm";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { awsAccountIdSchema, awsConnectionToken, awsRoleArnSchema, type AwsRegion } from "@agent-lens/domain";
import { classifySubnetRoute } from "./aws-deployment";
import { decryptCredential } from "./crypto";
import { createSupabaseAdminClient } from "./supabase/admin";

const DEFAULT_ACCESS_TEMPLATE_URL = "https://agent-god-mode-cloudformation-931677066893-us-east-2.s3.us-east-2.amazonaws.com/templates/agent-god-mode-aws-access.yaml?versionId=sKvrEtKTuBGSqFx22Tr.tTXd5SS4uTC9";
const DEFAULT_MANAGED_HOST_TEMPLATE_URL = "https://agent-god-mode-cloudformation-931677066893-us-east-2.s3.us-east-2.amazonaws.com/templates/agent-god-mode-managed-paseo-host.yaml?versionId=fdbNdBXsBFo1Yg4AKFf0mkb3cmFXPn0.";

interface ExternalIdEnvelope { externalId: string }
interface AwsConnectionRow { id: string; user_id: string; name: string; account_id: string | null; role_arn: string | null; state: string }
interface TemporaryCredentials { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration?: Date }

function requiredBrokerRoleArn() {
  const value = process.env.AGENT_LENS_AWS_BROKER_ROLE_ARN?.trim();
  if (!value || !/^arn:aws:iam::\d{12}:role\/.+$/.test(value)) throw new Error("Managed AWS deployment is not configured yet");
  return value;
}

function brokerRegion() {
  return process.env.AGENT_LENS_AWS_BROKER_REGION?.trim() || "us-east-1";
}

export function managedHostTemplateUrl() {
  return process.env.AGENT_LENS_AWS_HOST_TEMPLATE_URL?.trim() || DEFAULT_MANAGED_HOST_TEMPLATE_URL;
}

export async function loadAwsConnection(userId: string, connectionId: string) {
  const admin = createSupabaseAdminClient();
  const [{ data: account, error: accountError }, { data: secret, error: secretError }] = await Promise.all([
    admin.from("aws_accounts").select("*").eq("user_id", userId).eq("id", connectionId).is("deleted_at", null).single(),
    admin.from("aws_connection_secrets").select("encrypted_external_id").eq("user_id", userId).eq("id", connectionId).single(),
  ]);
  if (accountError || secretError || !account || !secret) throw accountError ?? secretError ?? new Error("AWS connection not found");
  return { account: account as AwsConnectionRow, externalId: decryptCredential<ExternalIdEnvelope>(secret.encrypted_external_id).externalId };
}

function brokerCredentials(connectionId: string, purpose: string) {
  return awsCredentialsProvider({
    audience: "sts.amazonaws.com",
    roleArn: requiredBrokerRoleArn(),
    roleSessionName: sessionName(connectionId, `broker-${purpose}`),
    clientConfig: { region: brokerRegion() },
  });
}

function sessionName(connectionId: string, purpose: string) {
  return `agm-${awsConnectionToken(connectionId)}-${purpose}`.replace(/[^\w+=,.@-]/g, "-").slice(0, 64);
}

export async function assumeCustomerCredentials(userId: string, connectionId: string, purpose: string): Promise<{ credentials: TemporaryCredentials; account: AwsConnectionRow }> {
  const { account, externalId } = await loadAwsConnection(userId, connectionId);
  if (!account.role_arn || account.state !== "connected") throw new Error("Verify this AWS account before deploying");
  const sts = new STSClient({ region: brokerRegion(), credentials: brokerCredentials(connectionId, purpose) });
  const assumed = await sts.send(new AssumeRoleCommand({ RoleArn: account.role_arn, ExternalId: externalId, RoleSessionName: sessionName(connectionId, purpose), DurationSeconds: 3600 }));
  const value = assumed.Credentials;
  if (!value?.AccessKeyId || !value.SecretAccessKey || !value.SessionToken) throw new Error("AWS did not issue temporary account credentials");
  return { credentials: { accessKeyId: value.AccessKeyId, secretAccessKey: value.SecretAccessKey, sessionToken: value.SessionToken, expiration: value.Expiration }, account };
}

export async function verifyAwsCustomerRole(userId: string, connectionId: string, rawRoleArn: string) {
  const roleArn = awsRoleArnSchema.parse(rawRoleArn);
  const { account, externalId } = await loadAwsConnection(userId, connectionId);
  const expectedToken = awsConnectionToken(connectionId);
  if (!roleArn.endsWith(`/AgentGodModeCustomer-${expectedToken}`)) throw new Error("This role belongs to a different AWS connection");
  const sts = new STSClient({ region: brokerRegion(), credentials: brokerCredentials(connectionId, "verify") });
  const assumed = await sts.send(new AssumeRoleCommand({ RoleArn: roleArn, ExternalId: externalId, RoleSessionName: sessionName(connectionId, "verify"), DurationSeconds: 900 }));
  const value = assumed.Credentials;
  if (!value?.AccessKeyId || !value.SecretAccessKey || !value.SessionToken) throw new Error("AWS did not issue temporary account credentials");
  const identity = await new STSClient({ region: brokerRegion(), credentials: { accessKeyId: value.AccessKeyId, secretAccessKey: value.SecretAccessKey, sessionToken: value.SessionToken } }).send(new GetCallerIdentityCommand({}));
  const roleAccountId = awsAccountIdSchema.parse(roleArn.split(":")[4]);
  if (!identity.Account || identity.Account !== roleAccountId) throw new Error("The verified role returned a different AWS account");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("aws_accounts").update({ role_arn: roleArn, account_id: identity.Account, state: "connected", error: null }).eq("user_id", userId).eq("id", account.id);
  if (error) throw error;
  return { accountId: identity.Account, roleArn };
}

export function awsAccessSetup(connectionId: string, externalId: string) {
  const brokerRoleArn = requiredBrokerRoleArn();
  const token = awsConnectionToken(connectionId);
  const templateUrl = process.env.AGENT_LENS_AWS_ACCESS_TEMPLATE_URL?.trim() || DEFAULT_ACCESS_TEMPLATE_URL;
  const params = new URLSearchParams({
    templateURL: templateUrl,
    stackName: `agent-god-mode-access-${token}`,
    param_BrokerRoleArn: brokerRoleArn,
    param_ConnectionId: token,
    param_ExternalId: externalId,
  });
  const roleName = `AgentGodModeCustomer-${token}`;
  const executionRoleArn = `arn:aws:iam::*:role/AgentGodModeExecution-${token}`;
  return {
    token,
    roleName,
    launchUrl: `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/quickcreate?${params.toString()}`,
    trustPolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: brokerRoleArn }, Action: "sts:AssumeRole", Condition: { StringEquals: { "sts:ExternalId": externalId } } }] }, null, 2),
    permissionsPolicy: JSON.stringify({ Version: "2012-10-17", Statement: [
      { Sid: "DiscoverInfrastructure", Effect: "Allow", Action: ["ec2:DescribeRegions", "ec2:DescribeRouteTables", "ec2:DescribeSubnets", "ec2:DescribeVpcs", "cloudformation:ListStacks", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations", "ssm:GetCommandInvocation"], Resource: "*" },
      { Sid: "CreatePaseoStackWithDesignatedRole", Effect: "Allow", Action: "cloudformation:CreateStack", Resource: "arn:aws:cloudformation:*:*:stack/agent-god-mode-paseo-*/*", Condition: { StringEquals: { "cloudformation:RoleArn": executionRoleArn } } },
      { Sid: "ManageOnlyPaseoStacks", Effect: "Allow", Action: ["cloudformation:DeleteStack", "cloudformation:DescribeStackEvents", "cloudformation:DescribeStackResources", "cloudformation:DescribeStacks", "cloudformation:GetTemplate"], Resource: "arn:aws:cloudformation:*:*:stack/agent-god-mode-paseo-*/*" },
      { Sid: "PassOnlyExecutionRole", Effect: "Allow", Action: "iam:PassRole", Resource: executionRoleArn, Condition: { StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" } } },
      { Sid: "UseAwsRunShellScript", Effect: "Allow", Action: "ssm:SendCommand", Resource: "arn:aws:ssm:*::document/AWS-RunShellScript" },
      { Sid: "RunCommandsOnlyOnConnectionInstances", Effect: "Allow", Action: "ssm:SendCommand", Resource: "arn:aws:ec2:*:*:instance/*", Condition: { StringEquals: { [`ssm:resourceTag/AgentGodModeConnection`]: token } } },
    ] }, null, 2),
  };
}

export async function getAwsAccessSetup(userId: string, connectionId: string) {
  const { externalId } = await loadAwsConnection(userId, connectionId);
  return awsAccessSetup(connectionId, externalId);
}

export async function listAwsNetworks(userId: string, connectionId: string, region: AwsRegion) {
  const { credentials } = await assumeCustomerCredentials(userId, connectionId, "networks");
  const ec2 = new EC2Client({ region, credentials });
  const [vpcs, subnets, routeTables] = await Promise.all([
    ec2.send(new DescribeVpcsCommand({})),
    ec2.send(new DescribeSubnetsCommand({})),
    ec2.send(new DescribeRouteTablesCommand({})),
  ]);
  const name = (tags: Array<{ Key?: string; Value?: string }> | undefined, fallback: string) => tags?.find((tag) => tag.Key === "Name")?.Value || fallback;
  const mainByVpc = new Map((routeTables.RouteTables ?? []).filter((table) => table.Associations?.some((association) => association.Main)).map((table) => [table.VpcId, table]));
  const explicitBySubnet = new Map((routeTables.RouteTables ?? []).flatMap((table) => (table.Associations ?? []).flatMap((association) => association.SubnetId ? [[association.SubnetId, table] as const] : [])));
  const choices = (subnets.Subnets ?? []).flatMap((subnet) => {
    if (!subnet.SubnetId || !subnet.VpcId) return [];
    const table = explicitBySubnet.get(subnet.SubnetId) ?? mainByVpc.get(subnet.VpcId);
    const routeType = classifySubnetRoute(table?.Routes ?? []);
    if (!routeType) return [];
    return [{ id: subnet.SubnetId, name: name(subnet.Tags, subnet.SubnetId), vpcId: subnet.VpcId, availabilityZone: subnet.AvailabilityZone ?? "", cidr: subnet.CidrBlock ?? "", routeType, associatePublicIp: routeType === "public" }];
  });
  return {
    vpcs: (vpcs.Vpcs ?? []).flatMap((vpc) => vpc.VpcId ? [{ id: vpc.VpcId, name: name(vpc.Tags, vpc.VpcId), isDefault: Boolean(vpc.IsDefault) }] : []),
    subnets: choices,
  };
}

export async function awsClients(userId: string, connectionId: string, region: AwsRegion, purpose: string) {
  const { credentials, account } = await assumeCustomerCredentials(userId, connectionId, purpose);
  return { account, cloudformation: new CloudFormationClient({ region, credentials }), ec2: new EC2Client({ region, credentials }), ssm: new SSMClient({ region, credentials }) };
}

export function createExternalId() {
  return `agm-${randomUUID()}-${randomUUID()}`;
}
