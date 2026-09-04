import type { Metadata } from "next";
import "./globals.css";
import appIcon from "../../resources/icon.png";

export const metadata: Metadata = {
  title: { default: "Agent God Mode", template: "%s · Agent God Mode" },
  description: "Plan, build, and review GitHub workstreams through Paseo.",
  icons: { icon: appIcon.src, apple: appIcon.src },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
