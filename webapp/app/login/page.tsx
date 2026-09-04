"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import appIcon from "../../../resources/icon.png";
import { safeProductDestination } from "@/lib/routes";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "invite-expired") setError("This invitation is invalid or has expired. Ask for a new invitation.");
  }, []);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Authentication failed"); const requested = new URLSearchParams(window.location.search).get("next"); router.push(safeProductDestination(requested)); router.refresh(); } catch (error) { setError(error instanceof Error ? error.message : "Authentication failed"); } finally { setBusy(false); } }
  return <main className="login-page"><Link className="login-back" href="/"><ArrowLeft/>Back to Agent God Mode</Link><section className="login-panel"><form onSubmit={submit}><img src={appIcon.src} alt="" className="login-icon"/><span className="eyebrow">Welcome Back</span><h1>Sign In to Agent God Mode</h1><p>Enter your email and password to open your workstreams.</p>{error && <div className="banner error" role="alert">{error}</div>}<label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required/></label><button className="primary login-submit" disabled={busy}>{busy ? "Signing In…" : "Sign In"}<ArrowRight/></button><small>Account creation is currently invite-only.</small></form></section></main>;
}
