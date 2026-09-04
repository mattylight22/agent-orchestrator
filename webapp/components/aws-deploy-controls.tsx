"use client";

import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import {
  AWS_DEFAULT_DEPLOYMENT_REGION,
  AWS_DEPLOYMENT_REGIONS,
  buildAwsQuickCreateUrl,
  type AwsDeploymentRegion,
} from "@/lib/aws-deployment";

export function AwsDeployControls({ templateUrl, compact = false }: { templateUrl: string; compact?: boolean }) {
  const [region, setRegion] = useState<AwsDeploymentRegion>(AWS_DEFAULT_DEPLOYMENT_REGION);
  const estimate = AWS_DEPLOYMENT_REGIONS.find((item) => item.id === region) ?? AWS_DEPLOYMENT_REGIONS[1];
  const quickCreateUrl = buildAwsQuickCreateUrl(templateUrl, region);

  const selector = <label className={compact ? "onboarding-region" : "aws-region-picker"}>
    <span>Deployment region</span>
    <select value={region} onChange={(event) => setRegion(event.target.value as AwsDeploymentRegion)}>
      {AWS_DEPLOYMENT_REGIONS.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.id}</option>)}
    </select>
  </label>;

  if (compact) return <>
    {selector}
    <div className="onboarding-cost"><span>Estimated default cost</span><strong>≈ ${estimate.total}/month</strong><small>t3.medium running continuously plus 100 GB gp3 storage in {estimate.label}. Network usage and optional VPC services are additional.</small></div>
    <a className="primary button" href={quickCreateUrl} target="_blank" rel="noreferrer">Launch in AWS<ExternalLink/></a>
  </>;

  return <>
    {selector}
    <div className="aws-cost-estimate"><div><span>Estimated default infrastructure</span><strong>≈ ${estimate.total} / month</strong></div><dl><div><dt>t3.medium compute</dt><dd>{estimate.compute}</dd></div><div><dt>100 GB gp3 storage</dt><dd>{estimate.storage}</dd></div></dl><p>Based on 730 hours of Linux On-Demand usage in {estimate.label}. Data transfer, surplus T3 CPU credits, taxes, and optional VPC services such as a NAT Gateway are additional. Your selected instance size can change the total.</p></div>
    <div className="aws-actions"><a className="marketing-button" href={quickCreateUrl} target="_blank" rel="noreferrer">Launch stack in AWS <ExternalLink/></a><a className="marketing-secondary-button" href="/aws/agent-god-mode-paseo-host.yaml" download>Download AWS template <Download/></a></div>
  </>;
}
