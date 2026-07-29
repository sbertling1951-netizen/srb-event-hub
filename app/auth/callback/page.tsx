"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

// Dedicated magic-link / recovery callback. Handles both possible
// Supabase redirect shapes without assuming which one the hosted
// project is configured for:
//   - PKCE: "?code=..." -> supabase.auth.exchangeCodeForSession()
//   - Implicit flow: "#access_token=...&refresh_token=..." ->
//     supabase.auth.setSession()
// Both are the SDK's own official session-establishment APIs operating
// on tokens Supabase itself already generated and validated -- no
// custom cryptography or token minting happens here.
//
// Only two internal purposes are ever recognized. No arbitrary "next"
// URL is ever accepted from the query string.
type Purpose = "activation" | "recovery";

const DESTINATIONS: Record<Purpose, string> = {
  activation: "/member/account",
  recovery: "/member/account/reset-password",
};

function resolvePurpose(value: string | null): Purpose | null {
  return value === "activation" || value === "recovery" ? value : null;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Verifying your link...");
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) {
      return;
    }
    ranRef.current = true;

    async function run() {
      try {
        const url = new URL(window.location.href);
        const purpose = resolvePurpose(url.searchParams.get("purpose"));
        const attemptToken = url.searchParams.get("attempt_token");
        const code = url.searchParams.get("code");
        const linkError = url.searchParams.get("error_description");

        if (linkError) {
          throw new Error("link_error");
        }

        if (!purpose) {
          throw new Error("unrecognized_purpose");
        }

        // Tracks whether THIS pass actually established the session (a
        // fresh, single-use code/token was just consumed) versus
        // recovering an already-existing session from an earlier,
        // already-successful pass (e.g. the page was reloaded, or the
        // link was opened twice). Supabase's own codes/tokens are
        // single-use, so a repeat delivery is expected to fail the
        // exchange -- that is only treated as an idempotent no-op, not
        // an error, when a valid session already exists. Finalizing
        // activation is only ever attempted on a fresh exchange, never
        // on a recovered one, so a reused/replayed link can never
        // trigger a second privileged finalize call.
        let isFreshExchange = true;

        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(window.location.href);

          if (exchangeError) {
            const { data: existingSessionData } =
              await supabase.auth.getSession();
            if (!existingSessionData?.session) {
              throw exchangeError;
            }
            isFreshExchange = false;
          }
        } else {
          const hashParams = new URLSearchParams(
            window.location.hash.replace(/^#/, ""),
          );
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (setSessionError) {
              throw setSessionError;
            }
          } else {
            const { data: existingSessionData } =
              await supabase.auth.getSession();
            if (!existingSessionData?.session) {
              throw new Error("no_session_in_url");
            }
            isFreshExchange = false;
          }
        }

        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          throw new Error("no_session_established");
        }

        setStatus("Your account is verified. Opening your EpicentraX account...");

        if (purpose === "activation" && isFreshExchange) {
          if (!attemptToken) {
            throw new Error("missing_attempt_token");
          }

          // Finalizes using auth.uid() derived server-side from the
          // session just established above -- the browser supplies only
          // the already-public attempt token for correlation, never a
          // person or auth user id.
          const { data: finalizeRows, error: finalizeError } =
            await supabase.rpc(
              "finalize_member_identity_activation_via_magic_link",
              { p_attempt_token: attemptToken },
            );

          if (finalizeError) {
            throw finalizeError;
          }

          const finalizeRow = Array.isArray(finalizeRows)
            ? finalizeRows[0]
            : finalizeRows;

          if (finalizeRow?.activation_status !== "ACTIVATED") {
            throw new Error("activation_not_finalized");
          }
        }

        router.replace(DESTINATIONS[purpose]);
      } catch (err) {
        console.error("Auth callback error:", err);
        setError(
          "We could not complete sign-in from this link. Please request a new one.",
        );
        setStatus("");
      }
    }

    void run();
  }, [router]);

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "#fff",
          padding: 20,
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: 20 }}>EpicentraX</h1>

        {status ? <div style={{ color: "#0f172a" }}>{status}</div> : null}

        {error ? (
          <div
            role="alert"
            style={{
              border: "1px solid #fecaca",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#991b1b",
              padding: 12,
              marginTop: 12,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
