import { describe, expect, it } from "vitest";
import { AWS_DEPLOYMENT_REGIONS, buildAwsQuickCreateUrl } from "./aws-deployment";

describe("AWS deployment regions", () => {
  it("offers the supported US regions with storage included in each estimate", () => {
    expect(AWS_DEPLOYMENT_REGIONS.map((region) => region.id)).toEqual(["us-east-1", "us-east-2", "us-west-1", "us-west-2"]);
    expect(AWS_DEPLOYMENT_REGIONS.every((region) => region.storage && region.total)).toBe(true);
  });

  it("opens CloudFormation in the selected region", () => {
    const url = buildAwsQuickCreateUrl("https://assets.example/template.yaml", "us-west-2");
    expect(url).toContain("region=us-west-2");
    expect(url).toContain("templateURL=https%3A%2F%2Fassets.example%2Ftemplate.yaml");
  });
});
