import { MarketingShell } from "@/components/marketing-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return <MarketingShell signedIn={Boolean(data.user)}>{children}</MarketingShell>;
}
