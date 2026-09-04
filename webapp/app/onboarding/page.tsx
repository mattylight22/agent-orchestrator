import { redirect } from "next/navigation";
import { OnboardingPage } from "@/components/onboarding-page";
import { SnapshotProvider } from "@/components/snapshot-provider";
import { loadSnapshot } from "@/lib/data";
import { onboardingState } from "@/lib/onboarding";
import { getAwsQuickCreateUrl } from "@/lib/aws-template";

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
  const awsQuickCreateUrl = getAwsQuickCreateUrl();
  return <SnapshotProvider initial={snapshot}><OnboardingPage awsQuickCreateUrl={awsQuickCreateUrl}/></SnapshotProvider>;
}
