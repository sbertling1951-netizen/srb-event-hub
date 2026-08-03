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

const authenticatedRequestCredential: unique symbol = Symbol(
  "authenticatedRequestCredential",
);

/**
 * An opaque, server-only capability for the bearer credential that was
 * validated for this request. The symbol-keyed value is intentionally not an
 * account fact and is omitted from ordinary JSON serialization.
 */
export type AuthenticatedRequestCredential = {
  readonly [authenticatedRequestCredential]: string;
};

/**
 * The successful request-scoped authentication result. Consumers may use the
 * account fact as context, while only narrow server-side infrastructure may
 * consume the separate credential capability for an immediate user-context
 * database call.
 */
export type AuthenticatedRequestContext = {
  account: AuthenticatedAccount;
  credential: AuthenticatedRequestCredential;
};

/**
 * A request-scoped authentication result for trusted server code. Invalid,
 * expired, missing, and malformed credentials deliberately share the
 * unauthenticated state so callers do not receive credential diagnostics.
 */
export type ServerAuthenticationResolution =
  | ({ state: "authenticated" } & AuthenticatedRequestContext)
  | { state: "unauthenticated" }
  | { state: "internal_error" };

/**
 * Exposes the validated bearer only to server-only request infrastructure.
 * It must never be returned from a route, persisted, cached, or logged.
 */
export function authenticatedRequestCredentialValue(
  credential: AuthenticatedRequestCredential,
): string {
  return credential[authenticatedRequestCredential];
}

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
      credential: {
        [authenticatedRequestCredential]: accessToken,
      },
    };
  } catch (error) {
    console.error("Unexpected request authentication failure.", error);
    return { state: "internal_error" };
  }
}
