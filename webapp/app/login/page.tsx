import Link from "next/link";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { safeProductDestination } from "@/lib/routes";
import appIcon from "../../../resources/icon.png";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const destination = safeProductDestination((await searchParams).next);
  return <main className="login-page">
    <Link className="login-back" href="/"><ArrowLeft/>Back to Agent God Mode</Link>
    <section className="login-panel clerk-login-panel">
      <header className="login-auth-header">
        <img src={appIcon.src} alt="" />
        <span className="eyebrow">Agent God Mode</span>
        <h1>Welcome Back</h1>
        <p>Sign In to Continue</p>
      </header>
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
              header: "clerk-native-header",
              logoBox: "clerk-native-logo",
              main: "clerk-main",
              form: "clerk-form",
              formFieldRow: "clerk-field-row",
              formField: "clerk-field",
              formFieldInput: "clerk-field-input",
              formButtonPrimary: "clerk-primary-button",
              otpCodeField: "clerk-otp-field",
              otpCodeFieldInputs: "clerk-otp-inputs",
              otpCodeFieldInputContainer: "clerk-otp-input-container",
              otpCodeFieldInput: "clerk-otp-input",
              formResendCodeLink: "clerk-resend-link",
              footer: "clerk-footer",
              footerItem: "clerk-footer-item",
              footerAction: "clerk-sign-up-hidden",
            },
          }}
        />
      </ClerkLoaded>
    </section>
  </main>;
}
