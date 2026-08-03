import "server-only";

import {
  type AuthenticatedAccount,
  resolveAuthenticatedRequest,
} from "@/lib/server/authenticationBoundary";
import { resolveAuthenticatedAccountPerson } from "@/lib/server/personResolutionBridge";

/**
 * The single canonical Auth-to-Person outcome for the current request. This
 * is the Authentication Boundary's account fact and the Person Resolution
 * Bridge's exact-link classification composed together -- nothing else.
 */
export type CurrentAuthenticatedPersonResolution =
  | { state: "resolved"; account: AuthenticatedAccount; personId: string }
  | { state: "no_person"; account: AuthenticatedAccount }
  | { state: "invalid_or_ambiguous"; account: AuthenticatedAccount }
  | { state: "unauthenticated" }
  | { state: "internal_error" };

/**
 * Composes the Server Authentication Boundary and the Person Resolution
 * Bridge into one call. This is Authentication -> Person Resolution only --
 * it never resolves Relationship, Participation, Assignment, Authority, or
 * Workspace, and it never reads people, person_auth_accounts, or
 * person_identifiers directly.
 */
export async function resolveCurrentAuthenticatedPerson(
  requestHeaders: Headers,
): Promise<CurrentAuthenticatedPersonResolution> {
  const authenticatedRequest = await resolveAuthenticatedRequest(requestHeaders);

  if (authenticatedRequest.state === "unauthenticated") {
    return { state: "unauthenticated" };
  }

  if (authenticatedRequest.state === "internal_error") {
    return { state: "internal_error" };
  }

  const personResolution = await resolveAuthenticatedAccountPerson(
    authenticatedRequest,
  );

  if (personResolution.state === "resolved") {
    return {
      state: "resolved",
      account: authenticatedRequest.account,
      personId: personResolution.personId,
    };
  }

  if (personResolution.state === "no_person") {
    return { state: "no_person", account: authenticatedRequest.account };
  }

  if (personResolution.state === "invalid_or_ambiguous") {
    return {
      state: "invalid_or_ambiguous",
      account: authenticatedRequest.account,
    };
  }

  return { state: "internal_error" };
}
