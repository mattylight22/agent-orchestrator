import "server-only";

import { DeleteStackCommand, DescribeStacksCommand, ListStacksCommand, type Stack } from "@aws-sdk/client-cloudformation";
import { awsConnectionToken, awsRegions, type AwsOrphanScan, type AwsOrphanStack, type AwsRegion } from "@agent-lens/domain";
import { awsClients } from "./aws";
import { isManagedAgentStackName, isStackOwnedByConnection } from "./aws-orphan-rules";
import { createSupabaseAdminClient } from "./supabase/admin";

interface AccountRow { id: string; name: string; account_id: string | null }
interface DeploymentRow { aws_account_id: string; region: string; stack_name: string }

function deploymentKey(accountId: string, region: string, stackName: string) {
  return `${accountId}:${region}:${stackName}`;
}

function readableError(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  return "AWS could not be checked in this region";
}

function stackMissing(error: unknown) {
  return error instanceof Error && /does not exist|not exist/i.test(error.message);
}

async function scanRegion(userId: string, account: AccountRow, region: AwsRegion, known: Set<string>) {
  const { cloudformation } = await awsClients(userId, account.id, region, `orphan-scan-${region}`);
  const summaries = [];
  let nextToken: string | undefined;
  do {
    const page = await cloudformation.send(new ListStacksCommand({ NextToken: nextToken }));
    summaries.push(...(page.StackSummaries ?? []));
    nextToken = page.NextToken;
  } while (nextToken);

  const candidates = summaries.filter((summary) =>
    summary.StackName && isManagedAgentStackName(summary.StackName) && summary.StackStatus !== "DELETE_COMPLETE" &&
    !known.has(deploymentKey(account.id, region, summary.StackName))
  );

  const orphans = await Promise.all(candidates.map(async (summary): Promise<AwsOrphanStack | null> => {
    if (!summary.StackName) return null;
    const stack = (await cloudformation.send(new DescribeStacksCommand({ StackName: summary.StackId ?? summary.StackName }))).Stacks?.[0];
    if (!stack?.StackId || !isStackOwnedByConnection(stack.Tags, account.id)) return null;
    return {
      awsAccountId: account.id,
      awsAccountName: account.name,
      awsAccountNumber: account.account_id,
      region,
      stackName: summary.StackName,
      stackId: stack.StackId,
      stackStatus: stack.StackStatus ?? summary.StackStatus ?? "UNKNOWN",
      createdAt: stack.CreationTime?.toISOString() ?? summary.CreationTime?.toISOString() ?? null,
      instanceId: stack.Outputs?.find((output) => output.OutputKey === "InstanceId")?.OutputValue ?? null,
    };
  }));
  return orphans.filter((item): item is AwsOrphanStack => Boolean(item));
}

export async function scanAwsOrphanStacks(userId: string): Promise<AwsOrphanScan> {
  const admin = createSupabaseAdminClient();
  const [{ data: accountData, error: accountError }, { data: deploymentData, error: deploymentError }] = await Promise.all([
    admin.from("aws_accounts").select("id,name,account_id").eq("user_id", userId).eq("state", "connected").is("deleted_at", null),
    admin.from("aws_paseo_deployments").select("aws_account_id,region,stack_name").eq("user_id", userId).neq("state", "deleted").is("deleted_at", null),
  ]);
  if (accountError || deploymentError) throw accountError ?? deploymentError;
  const accounts = (accountData ?? []) as AccountRow[];
  const deployments = (deploymentData ?? []) as DeploymentRow[];
  const known = new Set(deployments.map((item) => deploymentKey(item.aws_account_id, item.region, item.stack_name)));
  const warnings: AwsOrphanScan["warnings"] = [];
  const checks = accounts.flatMap((account) => awsRegions.map(async (region) => {
    try { return await scanRegion(userId, account, region, known); }
    catch (error) {
      warnings.push({ awsAccountId: account.id, awsAccountName: account.name, region, message: readableError(error) });
      return [];
    }
  }));
  const orphans = (await Promise.all(checks)).flat().sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  return { orphans, warnings, scannedAt: new Date().toISOString() };
}

export async function deleteAwsOrphanStack(userId: string, input: { awsAccountId: string; region: string; stackName: string }) {
  if (!awsRegions.includes(input.region as AwsRegion)) throw new Error("Choose a supported AWS region");
  if (!isManagedAgentStackName(input.stackName)) throw new Error("Only Agent God Mode Agent Instance stacks can be removed here");
  const region = input.region as AwsRegion;
  const admin = createSupabaseAdminClient();
  const { data: linked, error: linkedError } = await admin.from("aws_paseo_deployments").select("id").eq("user_id", userId)
    .eq("aws_account_id", input.awsAccountId).eq("region", region).eq("stack_name", input.stackName)
    .neq("state", "deleted").is("deleted_at", null).limit(1);
  if (linkedError) throw linkedError;
  if (linked?.length) throw new Error("This stack is linked to an active Agent Instance and cannot be deleted as an orphan");

  const { account, cloudformation } = await awsClients(userId, input.awsAccountId, region, `orphan-delete-${region}`);
  let stack: Stack | undefined;
  try { stack = (await cloudformation.send(new DescribeStacksCommand({ StackName: input.stackName }))).Stacks?.[0]; }
  catch (error) { if (stackMissing(error)) return { deleted: true, alreadyMissing: true }; throw error; }
  if (!stack || !isStackOwnedByConnection(stack.Tags, input.awsAccountId)) throw new Error("AWS ownership tags do not match this connection");
  if (stack.StackStatus === "DELETE_IN_PROGRESS") return { deleted: true, alreadyDeleting: true };
  if (!account.account_id) throw new Error("AWS account identity is unavailable");
  const executionRoleArn = `arn:aws:iam::${account.account_id}:role/AgentGodModeExecution-${awsConnectionToken(input.awsAccountId)}`;
  await cloudformation.send(new DeleteStackCommand({ StackName: stack.StackId ?? input.stackName, RoleARN: executionRoleArn }));
  return { deleted: true };
}
