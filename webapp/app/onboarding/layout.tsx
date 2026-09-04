import type { Metadata } from "next";

export const metadata: Metadata = { title: "Set Up Your Account", robots: { index: false, follow: false } };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) { return children; }
