"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, CheckCircle2, CircleAlert, KeyRound, Mail } from "lucide-react";
import { getSupabase } from "@/lib/supabase";

type Mode = "request" | "update" | "sent" | "done" | "error";

export default function ResetPasswordPage() {
  const [mode, setMode] = useState<Mode>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    async function prepareRecovery() {
      const sb = getSupabase();
      if (!sb) return;
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        if (!alive) return;
        if (error) {
          setMode("error");
          setMessage("This reset link is invalid or expired. Request a new password reset email.");
          return;
        }
      }
      const { data: { session } } = await sb.auth.getSession();
      if (!alive) return;
      if (session) setMode("update");
      else if (window.location.hash.includes("error_description=")) {
        setMode("error");
        setMessage("This reset link is invalid or expired. Request a new password reset email.");
      }
    }
    void prepareRecovery();
    return () => { alive = false; };
  }, []);

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    const sb = getSupabase();
    if (!sb) { setMode("error"); setMessage("Authentication is not configured for this deployment."); return; }
    setBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      setMode("error");
      setMessage("We couldn’t send a reset email. Check the address and try again shortly.");
      return;
    }
    setMode("sent");
    setMessage("If an account exists for that address, a password reset link will arrive shortly.");
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setMessage("Use at least 8 characters for your new password."); return; }
    if (password !== confirmPassword) { setMessage("The passwords don’t match."); return; }
    const sb = getSupabase();
    if (!sb) { setMode("error"); setMessage("Authentication is not configured for this deployment."); return; }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) { setMessage("Password update failed. Your reset link may have expired; request a new one."); return; }
    await sb.auth.signOut();
    setPassword("");
    setConfirmPassword("");
    setMode("done");
    setMessage("Your password has been updated. Sign in with your new password.");
  }

  const setModeRequest = () => { setMode("request"); setMessage(""); };
  return (
    <main className="auth-screen">
      <section className="auth-card verify-card" aria-live="polite">
        <div className="brand-mark"><Activity size={20}/></div>
        <div className="eyebrow"><span className="eyebrow-line"/>NETWORK OPERATIONS</div>
        {mode === "update" ? (
          <>
            <div className="verify-icon"><KeyRound size={23}/></div>
            <h1>Set a new password</h1>
            <p>Choose a strong password for your NetPulse account.</p>
            <form onSubmit={updatePassword}>
              <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label>
              <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Enter it again"/></label>
              {message && <p role="alert" className="auth-message">{message}</p>}
              <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? "Updating password…" : "Update password"}</button>
            </form>
          </>
        ) : mode === "done" ? (
          <>
            <div className="verify-icon verify-success"><CheckCircle2 size={24}/></div><h1>Password updated</h1><p>{message}</p>
            <Link className="button button-primary auth-submit verify-link" href="/">Return to sign in <ArrowLeft size={15}/></Link>
          </>
        ) : mode === "sent" ? (
          <>
            <div className="verify-icon verify-success"><Mail size={24}/></div><h1>Check your inbox</h1><p>{message}</p>
            <button className="button button-secondary auth-submit" onClick={setModeRequest}>Try another email</button>
          </>
        ) : (
          <>
            <div className="verify-icon">{mode === "error" ? <CircleAlert size={24}/> : <KeyRound size={23}/>}</div>
            <h1>{mode === "error" ? "Reset link needs attention" : "Reset your password"}</h1>
            <p>{message || "Enter the email address for your NetPulse account. We’ll send you a secure link to choose a new password."}</p>
            <form onSubmit={requestReset}>
              <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@organization.com"/></label>
              <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? "Sending reset link…" : "Send reset link"}</button>
            </form>
            <Link className="verify-back" href="/"><ArrowLeft size={14}/> Back to sign in</Link>
          </>
        )}
        <div className="verify-footer"><span className="pulse-dot"/> NETPULSE IDENTITY · SECURE ACCESS</div>
      </section>
    </main>
  );
}
