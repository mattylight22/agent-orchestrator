const DEFAULT_TEMPLATE_URL =
  "https://agent-god-mode-cloudformation-931677066893-us-east-2.s3.us-east-2.amazonaws.com/templates/agent-god-mode-paseo-host.yaml";

export function getAwsTemplateUrl() {
  return process.env.AWS_CLOUDFORMATION_TEMPLATE_URL?.trim() || DEFAULT_TEMPLATE_URL;
}

export function getAwsQuickCreateUrl() {
  const params = new URLSearchParams({
    templateURL: getAwsTemplateUrl(),
    stackName: "agent-god-mode-paseo",
  });

  return `https://console.aws.amazon.com/cloudformation/home?region=us-east-2#/stacks/quickcreate?${params.toString()}`;
}
