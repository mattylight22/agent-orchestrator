import Link from "next/link";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { safeProductDestination } from "@/lib/routes";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const destination = safeProductDestination((await searchParams).next);
  return <main className="login-page">
    <Link className="login-back" href="/"><ArrowLeft/>Back to Agent God Mode</Link>
    <section className="login-panel clerk-login-panel">
      <ClerkLoading><div className="clerk-auth-state">Loading Sign-In…</div></ClerkLoading>
      <ClerkFailed><div className="clerk-auth-state error" role="alert">Sign-in is temporarily unavailable. Please try again shortly.</div></ClerkFailed>
      <ClerkLoaded>
        <SignIn
          routing="hash"
          forceRedirectUrl={destination}
          fallbackRedirectUrl="/app"
          appearance={{
            variables: {
              colorPrimary: "var(--brand)",
              colorForeground: "var(--text)",
              colorMutedForeground: "var(--text-2)",
              colorBackground: "var(--surface)",
              colorInput: "var(--surface-2)",
              colorInputForeground: "var(--text)",
              borderRadius: "10px",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
            },
            elements: {
              rootBox: "clerk-root",
              cardBox: "clerk-card-box",
              card: "clerk-card",
              footer: "clerk-footer",
              footerAction: "clerk-sign-up-hidden",
            },
          }}
        />
      </ClerkLoaded>
    </section>
  </main>;
}
