import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../public/aws/${name}`, import.meta.url)), "utf8");

describe("AWS provisioning templates", () => {
  it("restricts the broker to production OIDC and named connection roles", () => {
    const template = read("agent-god-mode-operator-broker.yaml");
    expect(template).toContain("oidc.vercel.com/${VercelTeamSlug}:aud");
    expect(template).toContain('"sts.amazonaws.com"');
    expect(template).toContain("environment:production");
    expect(template).toContain("role/AgentGodModeConnection-*");
    expect(template).toContain("sts:ExternalId");
  });

  it("requires a connection external ID and designated execution role", () => {
    const template = read("agent-god-mode-aws-access.yaml");
    expect(template).toContain("sts:ExternalId: !Ref ExternalId");
    expect(template).toContain("cloudformation:RoleArn: !GetAtt ExecutionRole.Arn");
    expect(template).toContain("iam:PassedToService: cloudformation.amazonaws.com");
    expect(template).toContain("ssm:resourceTag/AgentGodModeConnection: !Ref ConnectionId");
  });

  it("keeps IAM resources out of the managed host template", () => {
    const template = read("agent-god-mode-managed-paseo-host.yaml");
    expect(template).not.toContain("AWS::IAM::Role");
    expect(template).not.toContain("AWS::IAM::InstanceProfile");
    expect(template).toContain("HttpTokens: required");
    expect(template).toContain("Encrypted: true");
    expect(template).toContain("AWS-StartInteractiveCommand");
    expect(template).toContain('sudo -iu ubuntu');
  });

  it("opens the standalone template session as the ubuntu agent user", () => {
    const template = read("agent-god-mode-paseo-host.yaml");
    expect(template).toContain("AWS-StartInteractiveCommand");
    expect(template).toContain('sudo -iu ubuntu');
  });
});
