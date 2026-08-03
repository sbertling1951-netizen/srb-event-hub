import "server-only";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import type { AuthenticatedRequestContext } from "@/lib/server/authenticationBoundary";

export type PersonResolution =
  | { state: "resolved"; personId: string }
  | { state: "no_person" }
  | { state: "invalid_or_ambiguous" }
  | { state: "internal_error" };

type CurrentAuthPersonLinkRow = {
  status?: unknown;
  person_id?: unknown;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/**
 * Resolves only the already-authenticated request's exact Auth-to-Person link.
 * The parameterless database entry point derives its own account from
 * auth.uid(); this bridge accepts no caller-controlled identity selector.
 */
export async function resolveAuthenticatedAccountPerson(
  authenticatedRequest: AuthenticatedRequestContext,
): Promise<PersonResolution> {
  const supabase = createAuthenticatedUserClient(
    authenticatedRequest.credential,
  );

  if (!supabase) {
    return { state: "internal_error" };
  }

  try {
    const { data, error } = await supabase.rpc(
      "resolve_current_auth_person_link",
    );

    if (error || !Array.isArray(data) || data.length !== 1) {
      return { state: "internal_error" };
    }

    const row = data[0] as CurrentAuthPersonLinkRow;

    if (row.status === "resolved" && isUuid(row.person_id)) {
      return { state: "resolved", personId: row.person_id };
    }

    if (row.status === "no_link" && row.person_id === null) {
      return { state: "no_person" };
    }

    if (row.status === "invalid_or_ambiguous" && row.person_id === null) {
      return { state: "invalid_or_ambiguous" };
    }

    return { state: "internal_error" };
  } catch {
    return { state: "internal_error" };
  }
}
