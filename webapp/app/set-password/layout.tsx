import type { Metadata } from "next";

export const metadata: Metadata = { title: "Create password", robots: { index: false, follow: false } };

export default function SetPasswordLayout({ children }: { children: React.ReactNode }) { return children; }
