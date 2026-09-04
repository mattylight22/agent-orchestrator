import type { Metadata } from "next";
import "./globals.css";
import appIcon from "../../resources/icon.png";

export const metadata: Metadata = {
  metadataBase: new URL("https://agentgodmode.dev"),
  applicationName: "Agent God Mode",
  title: { default: "Agent God Mode", template: "%s · Agent God Mode" },
  description: "Turn plans into reviewed pull requests across every repository with structured coding-agent orchestration.",
  icons: { icon: appIcon.src, apple: appIcon.src },
  openGraph: {
    type: "website",
    siteName: "Agent God Mode",
    title: "Agent God Mode",
    description: "Turn plans into reviewed pull requests across every repository.",
    url: "https://agentgodmode.dev",
  },
  twitter: { card: "summary", title: "Agent God Mode", description: "Structured orchestration for coding agents." },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
