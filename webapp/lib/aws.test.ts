import { describe, expect, it } from "vitest";
import { awsAccountIdSchema, awsConnectionToken, awsDeploymentStackName, awsRoleArnSchema, createAwsDeploymentInputSchema } from "@agent-lens/domain";
import { classifySubnetRoute } from "./aws-deployment";

describe("AWS provisioning validation", () => {
  it("derives stable role and stack identifiers", () => {
    expect(awsConnectionToken("703ad78d-fbd8-4490-9d64-42917f39259b")).toBe("703ad78dfbd8");
    expect(awsDeploymentStackName("703ad78d-fbd8-4490-9d64-42917f39259b")).toBe("agent-god-mode-paseo-703ad78dfbd844909d644291");
  });

  it("accepts only the customer role naming convention", () => {
    expect(awsRoleArnSchema.safeParse("arn:aws:iam::123456789012:role/AgentGodModeCustomer-703ad78dfbd8").success).toBe(true);
    expect(awsRoleArnSchema.safeParse("arn:aws:iam::123456789012:role/Admin").success).toBe(false);
  });

  it("accepts only 12-digit AWS account IDs", () => {
    expect(awsAccountIdSchema.safeParse("123456789012").success).toBe(true);
    expect(awsAccountIdSchema.safeParse("1234-admin").success).toBe(false);
  });

  it("rejects unsupported deployment regions and small disks", () => {
    const base = { awsAccountId: crypto.randomUUID(), name: "Paseo", region: "us-east-2", vpcId: "vpc-123abc", subnetId: "subnet-123abc", routeType: "nat", associatePublicIp: false, instanceType: "t3.medium", volumeSize: 100 };
    expect(createAwsDeploymentInputSchema.safeParse(base).success).toBe(true);
    expect(createAwsDeploymentInputSchema.safeParse({ ...base, region: "eu-west-1" }).success).toBe(false);
    expect(createAwsDeploymentInputSchema.safeParse({ ...base, volumeSize: 20 }).success).toBe(false);
  });

  it("accepts only healthy internet and NAT default routes", () => {
    expect(classifySubnetRoute([{ DestinationCidrBlock: "0.0.0.0/0", NatGatewayId: "nat-123", State: "active" }])).toBe("nat");
    expect(classifySubnetRoute([{ DestinationCidrBlock: "0.0.0.0/0", GatewayId: "igw-123", State: "active" }])).toBe("public");
    expect(classifySubnetRoute([{ DestinationCidrBlock: "0.0.0.0/0", GatewayId: "igw-123", State: "blackhole" }])).toBeNull();
    expect(classifySubnetRoute([{ DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local", State: "active" }])).toBeNull();
  });
});
