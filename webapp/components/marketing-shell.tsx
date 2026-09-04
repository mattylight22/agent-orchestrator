import Link from "next/link";
import appIcon from "../../resources/icon.png";

export function MarketingShell({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  return <div className="marketing-root" data-session={signedIn ? "authenticated" : "anonymous"}>
    <header className="marketing-header">
      <Link className="marketing-wordmark" href="/" aria-label="Agent God Mode home"><img src={appIcon.src} alt=""/><strong>Agent God Mode</strong></Link>
      <nav aria-label="Public navigation"><Link href="/product">Product</Link><Link href="/docs/setup">Setup</Link><Link href="/security">Security</Link></nav>
      <div className="marketing-session-actions"><Link className="marketing-button signed-out-only" href="/login?next=/app">Sign in</Link><Link className="marketing-button signed-in-only" href="/app">Open app</Link></div>
    </header>
    {children}
    <footer className="marketing-footer"><div><Link className="marketing-wordmark" href="/"><img src={appIcon.src} alt=""/><strong>Agent God Mode</strong></Link><p>Structured orchestration for serious software work.</p></div><nav aria-label="Footer navigation"><Link href="/product">Product</Link><Link href="/docs/setup">Setup</Link><Link href="/security">Security</Link><Link href="/login?next=/app" className="signed-out-only">Sign in</Link><Link href="/app" className="signed-in-only">Open app</Link></nav><small>Built for GitHub-backed workstreams running through Paseo.</small></footer>
  </div>;
}

export function MarketingCta({ className = "marketing-button", suffix }: { className?: string; suffix?: React.ReactNode }) {
  return <><Link className={`${className} signed-out-only`} href="/login?next=/app">Sign in to get started{suffix}</Link><Link className={`${className} signed-in-only`} href="/app">Open Agent God Mode{suffix}</Link></>;
}
