"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import LoginActionButton from "@/components/auth/LoginActionButton";
import { supabase } from "@/lib/supabase";

export default function VendorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function establishVendorSession(accessToken: string) {
    const sessionResponse = await fetch("/api/vendor/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ accessToken }),
    });

    const sessionPayload = (await sessionResponse.json()) as {
      ok?: boolean;
      error?: string;
    };

    if (!sessionResponse.ok || !sessionPayload.ok) {
      throw new Error(sessionPayload.error || "Could not establish vendor session.");
    }
  }

  async function signInWithPassword() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setError("Enter your email and password.");
      setStatus("");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Signing in...");

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      const accessToken = data.session?.access_token;
      if (!accessToken) {
        throw new Error("Could not establish a session.");
      }

      await establishVendorSession(accessToken);

      setStatus("Signed in. Opening workspace...");
      router.replace("/vendor/workspace");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Enter your email address.");
      setStatus("");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Sending sign-in link...");

      const redirectTo = `${window.location.origin}/vendor/callback`;

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (otpError) {
        throw otpError;
      }

      setStatus("Check your email for the secure vendor sign-in link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send sign-in link.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Enter your email address first.");
      setStatus("");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Sending password reset link...");

      const redirectTo = `${window.location.origin}/vendor/reset-password`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo },
      );

      if (resetError) {
        throw resetError;
      }

      setStatus("Check your email for a link to set your password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a password reset link.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 440, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 18, display: "grid", gap: 12 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Vendor Login</h1>
        <div style={{ color: "#555", fontSize: 14 }}>
          Access is person-specific and not a shared organization token.
        </div>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Email</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Password</div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <LoginActionButton
          variant="primary"
          onClick={() => void signInWithPassword()}
          disabled={busy}
        >
          {busy ? "Please wait..." : "Sign In"}
        </LoginActionButton>

        <LoginActionButton
          variant="recovery"
          onClick={() => void sendPasswordReset()}
          disabled={busy}
        >
          Forgot Password
        </LoginActionButton>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          <div style={{ fontSize: 12, color: "#888" }}>or</div>
          <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 8,
          }}
        >
          <LoginActionButton
            variant="alternate"
            onClick={() => void sendMagicLink()}
            disabled={busy}
          >
            Email Me a Sign-in Link
          </LoginActionButton>

          <LoginActionButton variant="alternate" href="/vendor/register">
            Request Vendor Access
          </LoginActionButton>
        </div>

        {status ? <div style={{ fontSize: 14, color: "#555" }}>{status}</div> : null}
        {error ? (
          <div style={{ fontSize: 14, color: "#991b1b", fontWeight: 700 }}>{error}</div>
        ) : null}
      </div>

      <LoginActionButton variant="back" href="/login">
        Back to Login
      </LoginActionButton>
    </div>
  );
}
