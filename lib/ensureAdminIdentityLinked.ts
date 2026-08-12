"use client";

import { supabase } from "@/lib/supabase";

// Fire-and-forget trigger for the governed server-side identity-linkage
// check (/api/admins/link-identity). Called from the single admin
// workspace session-bootstrap boundary (lib/adminContext.tsx), not from
// individual pages. The client never writes admin_users.user_id itself --
// this only asks the server to run the governed resolver for the current
// session's own authenticated user.
//
// The module-level flag caps this to one attempt per page load, so a
// failure (or a legitimate non-admin caller) can never become a retry
// loop. The endpoint itself is idempotent regardless.
let attemptedThisPageLoad = false;

export async function ensureAdminIdentityLinked(): Promise<void> {
  if (attemptedThisPageLoad) {
    return;
  }
  attemptedThisPageLoad = true;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (!accessToken) {
      return;
    }

    await fetch("/api/admins/link-identity", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Fail closed silently: administrative authority resolution is
    // governed entirely by getCurrentAdminAccess/AdminRouteGuard
    // regardless of whether this backfill succeeds.
  }
}
