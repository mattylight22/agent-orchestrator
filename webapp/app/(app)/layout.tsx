import { loadSnapshot } from "@/lib/data";
import { AppShell } from "@/components/app-shell";
import { SnapshotProvider } from "@/components/snapshot-provider";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const snapshot = await loadSnapshot();
  return <SnapshotProvider initial={snapshot}><AppShell>{children}</AppShell></SnapshotProvider>;
}
