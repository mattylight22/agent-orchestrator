import { redirect } from "next/navigation";
import { OnboardingPage } from "@/components/onboarding-page";
import { SnapshotProvider } from "@/components/snapshot-provider";
import { loadSnapshot } from "@/lib/data";
import { onboardingState } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export default async function Onboarding() {
  let snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") redirect("/login?next=/onboarding");
    throw error;
  }
  if (onboardingState(snapshot).complete) redirect("/app");
  const templateUrl = process.env.AWS_CLOUDFORMATION_TEMPLATE_URL;
  const awsQuickCreateUrl = templateUrl
    ? `https://console.aws.amazon.com/cloudformation/home?region=us-east-2#/stacks/quickcreate?templateURL=${encodeURIComponent(templateUrl)}&stackName=agent-god-mode-paseo`
    : null;
  return <SnapshotProvider initial={snapshot}><OnboardingPage awsQuickCreateUrl={awsQuickCreateUrl}/></SnapshotProvider>;
}
