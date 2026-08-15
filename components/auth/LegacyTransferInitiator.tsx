"use client";

import { useEffect, useRef } from "react";

import { supabase } from "@/lib/supabase";

// Legacy Login Transfer -- legacy-domain initiation trigger (Stage 3B).
//
// Deliberately thin: on mount, this component only (1) checks whether it
// is running on the legacy hostname -- a UX/efficiency gate, never a
// security boundary, since the initiation route itself independently
// re-derives identity from the caller's own already-validated session --
// and (2) fires one POST carrying whatever local session evidence the
// browser has. It renders no UI and owns no business logic; the
// initiation route is the real transport boundary.
const LEGACY_HOSTNAME = "app.eventsyncapp.com";
const CANONICAL_LOGIN_URL = "https://epicentrax.com/login";

export default function LegacyTransferInitiator() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) {
      return;
    }
    if (window.location.hostname !== LEGACY_HOSTNAME) {
      return;
    }
    ranRef.current = true;

    async function run() {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        // Captured exactly once, unvalidated -- the initiation route owns
        // all Stage 2 safety evaluation.
        const destination =
          window.location.pathname +
          window.location.search +
          window.location.hash;

        const res = await fetch("/api/legacy-transfer/initiate", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ destination }),
        });

        const payload = (await res.json().catch(() => null)) as
          | { ok?: boolean; transfer_url?: string }
          | null;

        if (payload?.ok && typeof payload.transfer_url === "string") {
          window.location.replace(payload.transfer_url);
          return;
        }
      } catch {
        // fall through to the generic failure navigation below
      }

      window.location.replace(CANONICAL_LOGIN_URL);
    }

    void run();
  }, []);

  return null;
}
