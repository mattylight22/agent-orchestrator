import { MarketingShell } from "@/components/marketing-shell";
import { auth } from "@clerk/nextjs/server";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  return <MarketingShell signedIn={Boolean(userId)}>{children}</MarketingShell>;
}
