"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

// Vendor-scoped password recovery landing page. Mirrors the explicit
// token-exchange pattern used by /vendor/callback (required because the
// shared Supabase client has detectSessionInUrl disabled -- see that page
// for the full explanation) rather than the member-side /auth/callback,
// which is member-purpose-specific (activation/recovery destinations,
// identity-finalization RPC) and not safely reusable here without widening
// its scope to a second, unrelated flow.
export default function VendorResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Verifying your link...");
  const [sessionReady, setSessionReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function establishRecoverySession() {
      try {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const searchParams = new URLSearchParams(window.location.search);

        const errorDescription =
          hashParams.get("error_description") || searchParams.get("error_description");
        if (errorDescription) {
          throw new Error(errorDescription);
        }

        const code = searchParams.get("code");
        const hashAccessToken = hashParams.get("access_token");
        const hashRefreshToken = hashParams.get("refresh_token");

        let hasSession = false;

        if (code) {
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
          hasSession = !!data.session;
        } else if (hashAccessToken && hashRefreshToken) {
          const { data, error: setSessionError } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });
          if (setSessionError) {
            throw setSessionError;
          }
          hasSession = !!data.session;
        }

        window.history.replaceState(null, "", window.location.pathname);

        if (!cancelled) {
          if (hasSession) {
            setSessionReady(true);
            setStatus("");
          } else {
            setStatus("This link is invalid or has expired.");
            setFailed(true);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(err instanceof Error ? err.message : "This link is invalid or has expired.");
          setFailed(true);
        }
      }
    }

    void establishRecoverySession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setBusy(true);
      setError(null);

      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message || "That password could not be used.");
        return;
      }

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (accessToken) {
        await fetch("/api/vendor/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ accessToken }),
        });
      }

      router.replace("/vendor/workspace");
      router.refresh();
    } catch {
      setError("Could not update your password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 440, margin: "0 auto" }}>
      <div className="card" style={{ padding: 18, display: "grid", gap: 12 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Set Vendor Password</h1>

        {!sessionReady ? (
          <>
            {status ? <div>{status}</div> : null}
            {failed ? (
              <Link href="/vendor/login" className="app-button app-button-primary">
                Go to Vendor Login
              </Link>
            ) : null}
          </>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
            <label>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>New Password</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                style={{ width: "100%", padding: 10 }}
              />
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Confirm Password</div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                style={{ width: "100%", padding: 10 }}
              />
            </label>

            {error ? (
              <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="app-button app-button-primary"
            >
              {busy ? "Saving..." : "Save Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
