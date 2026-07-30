"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

export default function VendorCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Finalizing vendor sign-in...");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function completeSignIn() {
      try {
        // The shared Supabase client (lib/supabase.ts) has
        // detectSessionInUrl disabled for the rest of the app, so this
        // page must explicitly exchange whatever this specific
        // invitation/magic-link redirect carries. Without this, getSession()
        // silently returns whatever session (or none) already happens to be
        // in this browser's storage -- e.g. an admin's own logged-in
        // session -- instead of the identity this link actually represents.
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

        let accessToken: string | undefined;

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            throw error;
          }
          accessToken = data.session?.access_token;
        } else if (hashAccessToken && hashRefreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });
          if (error) {
            throw error;
          }
          accessToken = data.session?.access_token;
        }

        window.history.replaceState(null, "", window.location.pathname);

        if (!accessToken) {
          if (!cancelled) {
            setStatus(
              "This invitation link is invalid or has expired. Request a new invitation, or sign in below if you already have access.",
            );
            setFailed(true);
          }
          return;
        }

        const sessionResponse = await fetch("/api/vendor/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
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

        if (!cancelled) {
          setStatus("Vendor sign-in successful. Opening workspace...");
          router.replace("/vendor/workspace");
          router.refresh();
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(err instanceof Error ? err.message : "Vendor sign-in failed.");
          setFailed(true);
        }
      }
    }

    void completeSignIn();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div style={{ padding: 24, maxWidth: 680, margin: "0 auto" }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0 }}>Vendor Sign-In</h1>
        <div>{status}</div>
        {failed ? (
          <div style={{ marginTop: 14 }}>
            <Link href="/vendor/login" className="app-button app-button-primary">
              Go to Vendor Login
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
