"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, CheckCircle2, CircleAlert, MailCheck, RefreshCw } from "lucide-react";
import { getSupabase } from "@/lib/supabase";

type State = "checking" | "verified" | "sent" | "error" | "waiting";

export default function VerifyEmailPage() {
  const [state, setState] = useState<State>("checking");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialEmail = params.get("email") || "";
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    setEmail(initialEmail);

    if (tokenHash && (type === "signup" || type === "email")) {
      const sb = getSupabase();
      if (!sb) {
        setState("error");
        setMessage("Authentication is not configured for this deployment.");
        return;
      }
      sb.auth.verifyOtp({ token_hash: tokenHash, type: type as "signup" | "email" })
        .then(({ error }) => {
          if (error) {
            setState("error");
            setMessage("This verification link may have expired or already been used. Request a new link below.");
          } else {
            setState("verified");
            setMessage("Your email address has been verified. You can now return to NetPulse and sign in.");
          }
        })
        .catch(() => {
          setState("error");
          setMessage("We couldn’t verify this link. Request a new one or try again.");
        });
    } else if (params.get("sent") === "1") {
      setState("sent");
    } else {
      setState("waiting");
    }
  }, []);

  async function resend(e: FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) { setMessage("Authentication is not configured for this deployment."); setState("error"); return; }
    if (!email.trim()) { setMessage("Enter the email address you used to register."); return; }
    setBusy(true);
    const { error } = await sb.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/verify-email` }
    });
    setBusy(false);
    if (error) {
      setMessage("We couldn’t send a new verification email. Check the address and try again in a moment.");
      setState("error");
    } else {
      setMessage("If an unverified account exists for this address, a fresh verification link is on its way.");
      setState("sent");
    }
  }

  const verified = state === "verified";
  const checking = state === "checking";
  return (
    <main className="auth-screen">
      <section className="auth-card verify-card" aria-live="polite">
        <div className="brand-mark"><Activity size={20}/></div>
        <div className="eyebrow"><span className="eyebrow-line"/>NETWORK OPERATIONS</div>
        {checking ? (
          <>
            <div className="verify-icon"><RefreshCw size={22}/></div>
            <h1>Verifying your email</h1>
            <p>Please wait while we validate your secure verification link.</p>
          </>
        ) : verified ? (
          <>
            <div className="verify-icon verify-success"><CheckCircle2 size={24}/></div>
            <h1>Email verified</h1>
            <p>{message}</p>
            <Link className="button button-primary auth-submit verify-link" href="/">Continue to sign in <ArrowLeft size={15}/></Link>
          </>
        ) : (
          <>
            <div className="verify-icon">{state === "error" ? <CircleAlert size={24}/> : <MailCheck size={24}/>}</div>
            <h1>{state === "error" ? "Verification needs attention" : "Check your inbox"}</h1>
            <p>{message || (state === "waiting" ? "Use the verification link sent to your email address. If you can’t find it, request another below." : "We’ve sent a verification link if the account needs verification.")}</p>
            <form onSubmit={resend}>
              <label>Email address
                <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@organization.com"/>
              </label>
              <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Resend verification email"}</button>
            </form>
            <Link className="verify-back" href="/"> <ArrowLeft size={14}/> Back to sign in</Link>
          </>
        )}
        <div className="verify-footer"><span className="pulse-dot"/> NETPULSE IDENTITY · SECURE ACCESS</div>
      </section>
    </main>
  );
}
