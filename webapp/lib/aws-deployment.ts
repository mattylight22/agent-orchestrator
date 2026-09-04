export const AWS_DEPLOYMENT_REGIONS = [
  { id: "us-east-1", label: "US East (N. Virginia)", compute: "$30.37", storage: "$8.00", total: "$38.37" },
  { id: "us-east-2", label: "US East (Ohio)", compute: "$30.37", storage: "$8.00", total: "$38.37" },
  { id: "us-west-1", label: "US West (N. California)", compute: "$36.21", storage: "$9.60", total: "$45.81" },
  { id: "us-west-2", label: "US West (Oregon)", compute: "$30.37", storage: "$8.00", total: "$38.37" },
] as const;

export type AwsDeploymentRegion = (typeof AWS_DEPLOYMENT_REGIONS)[number]["id"];

export const AWS_DEFAULT_DEPLOYMENT_REGION: AwsDeploymentRegion = "us-east-2";

export function buildAwsQuickCreateUrl(templateUrl: string, region: AwsDeploymentRegion) {
  const params = new URLSearchParams({
    templateURL: templateUrl,
    stackName: "agent-god-mode-paseo",
  });

  return `https://console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?${params.toString()}`;
}
