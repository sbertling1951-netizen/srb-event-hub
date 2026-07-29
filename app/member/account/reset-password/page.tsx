"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  fontSize: 16,
  lineHeight: 1.4,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
  boxSizing: "border-box",
};

// Used for both:
//   - genuine password recovery (reached via /auth/callback after a
//     "Forgot password?" magic link, which establishes a recovery
//     session), and
//   - a signed-in member voluntarily adding/changing a password as a
//     backup sign-in method (Account Security).
// Either way, supabase.auth.updateUser({ password }) is used against
// whatever session is already active -- no new auth user is created,
// no password is ever sent to a custom application API or stored in a
// public table.
export default function MemberAccountResetPasswordPage() {
  const router = useRouter();

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      setHasSession(!!data?.session);
      setCheckingSession(false);
    }

    void check();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setStatus(null);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setStatus(null);
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Updating password...");

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        // Handles weak/leaked-password rejections and similar Supabase
        // Auth errors cleanly, without revealing unrelated account
        // details.
        setError(
          updateError.message ||
            "That password could not be used. Please choose a different one.",
        );
        setStatus(null);
        return;
      }

      setStatus("Password updated. Opening your EpicentraX account...");
      router.replace("/member/account");
    } catch {
      setError("Could not update your password. Please try again.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return <div style={{ padding: 24 }}>Checking your session...</div>;
  }

  if (!hasSession) {
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            padding: 20,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 700 }}>
            This link has expired or was already used.
          </div>
          <Link href="/member/login" style={{ color: "#0b5cff", fontWeight: 700 }}>
            Back to Member Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Set a Password</h1>
      <p style={{ marginTop: 0, color: "#475569", lineHeight: 1.5 }}>
        Add a password as a backup sign-in method.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "white",
          padding: 18,
          display: "grid",
          gap: 12,
        }}
      >
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>New Password</div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Confirm Password
          </div>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            style={inputStyle}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            minHeight: 48,
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#0b5cff",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 16,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Please wait..." : "Save Password"}
        </button>

        {status ? (
          <div style={{ fontSize: 13, color: "#666" }}>{status}</div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              border: "1px solid #fecaca",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#991b1b",
              padding: 12,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
      </form>
    </div>
  );
}
