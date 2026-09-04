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
    const id = randomUUID();
    const stackName = awsDeploymentStackName(id);
    const { error } = await supabase.from("aws_paseo_deployments").insert({
      id, user_id: user.id, aws_account_id: account.id, name: input.name, region: input.region,
      vpc_id: input.vpcId, subnet_id: input.subnetId, route_type: subnet.routeType,
      associate_public_ip: subnet.associatePublicIp, instance_type: input.instanceType,
      volume_size: input.volumeSize, state: "queued", stack_name: stackName,
    });
    if (error) throw error;
    await startAwsProvisioning(user.id, id);
    return NextResponse.json({ id, stackName }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
