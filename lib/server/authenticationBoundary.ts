import "server-only";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

/**
 * The only account fact this boundary exposes. It is derived from a validated
 * request credential and is not a Person, relationship, participation, or
 * authority decision.
 */
export type AuthenticatedAccount = {
  accountId: string;
};

/**
 * A request-scoped authentication result for trusted server code. Invalid,
 * expired, missing, and malformed credentials deliberately share the
 * unauthenticated state so callers do not receive credential diagnostics.
 */
export type ServerAuthenticationResolution =
  | { state: "authenticated"; account: AuthenticatedAccount }
  | { state: "unauthenticated" }
  | { state: "internal_error" };

function requestBearerToken(requestHeaders: Headers): string | null {
  const authorization = requestHeaders.get("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);

  return match?.[1] || null;
}

/**
 * Validates only the bearer credential presented by this request. It never
 * accepts an account identifier from headers, query values, cookies, or a
 * request body. The service credential is used only to validate the submitted
 * Supabase credential; this boundary never queries person_auth_accounts or
 * invokes restricted identity primitives.
 */
export async function resolveAuthenticatedRequest(
  requestHeaders: Headers,
): Promise<ServerAuthenticationResolution> {
  const accessToken = requestBearerToken(requestHeaders);

  if (!accessToken) {
    return { state: "unauthenticated" };
  }

  try {
    const supabase = getSupabaseAdminClient();

    if (!supabase) {
      return { state: "internal_error" };
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(accessToken);

    if (error || !user?.id) {
      return { state: "unauthenticated" };
    }

    return {
      state: "authenticated",
      account: { accountId: user.id },
    };
  } catch (error) {
    console.error("Unexpected request authentication failure.", error);
    return { state: "internal_error" };
  }
}
