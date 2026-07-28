"use client";

import Link from "next/link";
import { useState } from "react";

import { supabase } from "@/lib/supabase";

export default function VendorLoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendMagicLink() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setStatus("Enter your email address.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Sending sign-in link...");

      const redirectTo = `${window.location.origin}/vendor/callback`;

      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        throw error;
      }

      setStatus("Check your email for the secure vendor sign-in link.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not send sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 680, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 18, display: "grid", gap: 10 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Vendor Login</h1>
        <div style={{ color: "#555", fontSize: 14 }}>
          Use your vendor email to sign in. Access is person-specific and not a
          shared organization token.
        </div>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Email</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void sendMagicLink()}
            disabled={busy}
            className="app-button app-button-primary"
          >
            {busy ? "Sending..." : "Send Sign-In Link"}
          </button>

          <Link href="/" className="app-button app-button-muted">
            Back to Home
          </Link>

          <Link href="/vendor/register" className="app-button">
            New Vendor Registration
          </Link>
        </div>

        {status ? <div style={{ fontSize: 14, color: "#555" }}>{status}</div> : null}
      </div>
    </div>
  );
}
