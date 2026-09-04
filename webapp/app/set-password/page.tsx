"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import appIcon from "../../../resources/icon.png";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Unable to create password");
      router.replace("/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <Link className="login-back" href="/"><ArrowLeft />Back to Agent God Mode</Link>
      <section className="login-panel">
        <form onSubmit={submit}>
          <img src={appIcon.src} alt="" className="login-icon" />
          <span className="eyebrow">Invitation Accepted</span>
          <h1>Create Your Password</h1>
          <p>Choose the password you’ll use to sign in to Agent God Mode.</p>
          {error && <div className="banner error" role="alert">{error}</div>}
          <label>
            Password
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoFocus />
          </label>
          <label>
            Confirm Password
            <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required />
          </label>
          <div className="password-requirement"><Check />At Least 8 Characters</div>
          <button className="primary login-submit" disabled={busy}>
            {busy ? "Creating Password…" : "Create Password"}<ArrowRight />
          </button>
        </form>
      </section>
    </main>
  );
}
