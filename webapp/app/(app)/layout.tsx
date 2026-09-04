import { loadSnapshot } from "@/lib/data";
import { AppShell } from "@/components/app-shell";
import { SnapshotProvider } from "@/components/snapshot-provider";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  let snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") redirect("/login");
    throw error;
  }
  return <SnapshotProvider initial={snapshot}><AppShell>{children}</AppShell></SnapshotProvider>;
}
