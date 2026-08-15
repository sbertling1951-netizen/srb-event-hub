"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

// Legacy Login Transfer -- canonical redemption bootstrap (Stage 3B).
// Not a general auth UI: this page only ever consumes a #t=<token>
// fragment produced by /api/legacy-transfer/initiate on the legacy
// domain, redeems it, installs the resulting session, and navigates on.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function extractTransferToken(hash: string): string | null {
  if (!hash.startsWith("#")) {
    return null;
  }

  const params = new URLSearchParams(hash.slice(1));
  const values = params.getAll("t");
  if (values.length !== 1) {
    return null;
  }

  const token = values[0];
  if (!token || !TOKEN_PATTERN.test(token)) {
    return null;
  }

  return token;
}

type RedeemResponse = {
  ok?: boolean;
  access_token?: string;
  refresh_token?: string;
  destination?: string;
};

export default function LegacyTransferPage() {
  const router = useRouter();
  const ranRef = useRef(false);
  const [status, setStatus] = useState("Completing your transfer...");

  useEffect(() => {
    if (ranRef.current) {
      return;
    }
    ranRef.current = true;

    async function run() {
      const token = extractTransferToken(window.location.hash);

      // Strip the fragment before any network request, regardless of
      // outcome -- it must not linger in browser history any longer
      // than necessary.
      window.history.replaceState(null, "", window.location.pathname);

      if (!token) {
        router.replace("/login");
        return;
      }

      try {
        const res = await fetch("/api/legacy-transfer/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const payload = (await res.json().catch(() => null)) as RedeemResponse | null;

        if (!payload?.ok) {
          setStatus("");
          router.replace("/login");
          return;
        }

        const destination =
          typeof payload.destination === "string" ? payload.destination : "/";

        if (
          typeof payload.access_token === "string" &&
          typeof payload.refresh_token === "string"
        ) {
          const { data, error } = await supabase.auth.setSession({
            access_token: payload.access_token,
            refresh_token: payload.refresh_token,
          });

          if (error || !data.session) {
            setStatus("");
            router.replace("/login");
            return;
          }
        }

        // Vendor path: the server already established the vendor cookie
        // on this response; no client-side session call is needed.
        router.replace(destination);
      } catch {
        setStatus("");
        router.replace("/login");
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
      </div>
    </div>
  );
}
