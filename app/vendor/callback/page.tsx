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
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        const accessToken = session?.access_token;
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
