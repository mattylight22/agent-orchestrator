import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { awsDeploymentStackName, createAwsDeploymentInputSchema } from "@agent-lens/domain";
import { listAwsNetworks } from "@/lib/aws";
import { startAwsProvisioning } from "@/lib/aws-orchestration";
import { jsonError, readJson } from "@/lib/http";
import { requireUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const input = createAwsDeploymentInputSchema.parse(await readJson(request));
    const { supabase, user } = await requireUser();
    const { data: account, error: accountError } = await supabase.from("aws_accounts").select("id,state").eq("user_id", user.id).eq("id", input.awsAccountId).eq("state", "connected").is("deleted_at", null).single();
    if (accountError || !account) throw accountError ?? new Error("Connect and verify this AWS account first");
    const networks = await listAwsNetworks(user.id, account.id, input.region);
    const subnet = networks.subnets.find((item) => item.id === input.subnetId && item.vpcId === input.vpcId);
    if (!subnet) throw new Error("Choose a subnet with a usable NAT or internet-gateway route");
    if (subnet.routeType !== input.routeType || subnet.associatePublicIp !== input.associatePublicIp) throw new Error("The subnet routing changed; reload the network choices");

    type ExistingDeployment = { id: string; stack_name: string; state: string };
    async function reuseDeployment(existing: ExistingDeployment) {
      if (existing.state === "deleting") throw new Error(`Agent Instance “${input.name}” is being deleted. Wait for deletion to finish before using this name again.`);
      if (existing.state === "failed") {
        const { data: claimed, error: claimError } = await supabase.from("aws_paseo_deployments")
          .update({ state: "queued", failure_detail: null, pair_command_id: null })
          .eq("user_id", user.id).eq("id", existing.id).eq("state", "failed").select("id").maybeSingle();
        if (claimError) throw claimError;
        if (claimed) await startAwsProvisioning(user.id, existing.id);
      }
      return NextResponse.json({ id: existing.id, stackName: existing.stack_name, reused: true });
    }

    const { data: existing, error: existingError } = await supabase.from("aws_paseo_deployments")
      .select("id,stack_name,state")
      .eq("user_id", user.id).eq("aws_account_id", account.id).eq("name", input.name)
      .neq("state", "deleted").is("deleted_at", null).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return reuseDeployment(existing);

    const id = randomUUID();
    const stackName = awsDeploymentStackName(id);
    const { error } = await supabase.from("aws_paseo_deployments").insert({
      id, user_id: user.id, aws_account_id: account.id, name: input.name, region: input.region,
      vpc_id: input.vpcId, subnet_id: input.subnetId, route_type: subnet.routeType,
      associate_public_ip: subnet.associatePublicIp, instance_type: input.instanceType,
      volume_size: input.volumeSize, state: "queued", stack_name: stackName,
    });
    if (error?.code === "23505") {
      const { data: raced, error: racedError } = await supabase.from("aws_paseo_deployments")
        .select("id,stack_name,state")
        .eq("user_id", user.id).eq("aws_account_id", account.id).eq("name", input.name)
        .neq("state", "deleted").is("deleted_at", null).maybeSingle();
      if (racedError) throw racedError;
      if (raced) return reuseDeployment(raced);
      throw new Error(`An active Agent Instance named “${input.name}” already exists. Choose a different name or manage the existing instance in Settings.`);
    }
    if (error) throw error;
    await startAwsProvisioning(user.id, id);
    return NextResponse.json({ id, stackName }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
