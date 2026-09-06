"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { supabase } from "@/lib/supabase";

type AccountMode = "sign_in" | "sign_up";

// New-account verification email returns through the one fixed
// organizer-aware auth callback (purpose=organizer), which establishes the
// session with the existing safe SDK mechanism and lands at /organize. This
// is a hard-coded internal URL -- no caller-supplied redirect is ever used.
// The matching base URL (<origin>/auth/callback) must be present in the
// Supabase Auth Redirect URL allow-list; the member recovery and
// identity-claim flows already rely on that same base.
function organizerVerificationCallbackUrl() {
  return new URL("/auth/callback?purpose=organizer", window.location.origin).toString();
}

export default function OrganizerAccountPage() {
  const [mode, setMode] = useState<AccountMode>("sign_up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        window.location.assign("/organize");
      }
    });
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "sign_up" && password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }
    if (mode === "sign_up" && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "sign_up") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: organizerVerificationCallbackUrl() },
        });
        if (signUpError) {
          throw signUpError;
        }
        setMessage("Check your email to verify your account. Then return to create your private Event draft.");
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError || !data.session) {
          setError("Incorrect email or password.");
          return;
        }
        window.location.assign("/organize");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not complete that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page style={{ maxWidth: 620, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader title={mode === "sign_up" ? "Create your EpicentraX account" : "Sign in to create an Event"} headingLevel="h1" description="Your account lets you safely manage the private Events you create." />
      <PageSection variant="card">
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <label>
            Email
            <input className="app-form-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input className="app-form-input" type="password" autoComplete={mode === "sign_up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {mode === "sign_up" ? <label>
            Confirm password
            <input className="app-form-input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </label> : null}
          {message ? <Alert tone="success">{message}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div><AppButton type="submit" variant="primary" loading={busy}>{mode === "sign_up" ? "Create free account" : "Sign in"}</AppButton></div>
        </form>
      </PageSection>
      <p>
        {mode === "sign_up" ? "Already have an account? " : "New to EpicentraX? "}
        <button type="button" className="app-button" onClick={() => { setMode(mode === "sign_up" ? "sign_in" : "sign_up"); setError(null); setMessage(null); }}>
          {mode === "sign_up" ? "Sign in" : "Create a free account"}
        </button>
      </p>
      <p><Link href="/organize">Back to organizer setup</Link></p>
    </Page>
  );
}
