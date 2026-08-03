import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  type AuthenticatedRequestCredential,
  authenticatedRequestCredentialValue,
} from "@/lib/server/authenticationBoundary";

/**
 * Creates one non-persistent client for a bearer token already validated by
 * the Server Authentication Boundary. This is never a service-role client and
 * must not be retained past the current request.
 */
export function createAuthenticatedUserClient(
  credential: AuthenticatedRequestCredential,
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  const accessToken = authenticatedRequestCredentialValue(credential);

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
