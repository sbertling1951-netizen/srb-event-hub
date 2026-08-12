"use client";

import { supabase } from "@/lib/supabase";

/**
 * Ends both parts of the existing Vendor browser session: the httpOnly
 * workspace cookies and the Supabase Auth session. Kept in one client-side
 * helper so the canonical shell action and the retained deep-link page
 * (`/vendor/workspace/sign-out`) cannot drift into two implementations.
 *
 * Governed ordering is preserved: the server-owned cookie clear
 * (`DELETE /api/vendor/session`) runs first, then Supabase Auth signOut.
 * Either step's failure throws rather than being silently swallowed --
 * callers must not redirect, or otherwise treat the session as ended,
 * unless this resolves without throwing. This function never sets or
 * clears a cookie itself; deletion attributes remain entirely owned by
 * the DELETE endpoint.
 */
export async function signOutOfVendorWorkspace(): Promise<void> {
  const response = await fetch("/api/vendor/session", {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not end the vendor session. Please try again.");
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error("Could not sign out. Please try again.");
  }
}
