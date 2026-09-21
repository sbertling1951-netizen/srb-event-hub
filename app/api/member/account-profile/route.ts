import { NextResponse } from "next/server";

import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import { resolveAuthenticatedAccountPerson } from "@/lib/server/personResolutionBridge";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

// GET /api/member/account-profile -- the signed-in account holder's own
// display name, and nothing else.
//
// The account page previously named its heading from the first registration
// row, which on a household entry is the pilot rather than the account owner.
// Registration data is not the authority for the account holder's name; the
// canonical Person this Auth account is linked to is.
//
// Identity chain, unchanged and never bypassed here:
//   bearer credential -> resolveAuthenticatedRequest (auth.users)
//   -> resolveAuthenticatedAccountPerson (auth.uid() -> person_auth_accounts
//      -> people, via resolve_current_auth_person_link)
//   -> exactly that one people row
//
// Nothing about WHICH Person is read can come from the caller: no query
// parameter, request body, cookie, header, user metadata, registration row,
// email address or client storage value participates in the lookup. The only
// input is the bearer credential the Server Authentication Boundary validated
// for this request, and only the `resolved` link state proceeds.
//
// public.people denies every anon and authenticated role (deny_all_*_people in
// 20260724_create_person_identity_foundation.sql), so this read uses the
// existing server-only service client. That client bypasses RLS, which is
// exactly why this route reads one exact, already-resolved id, selects only
// the three display/status columns, and returns no identifier of any kind.
// No RLS policy, grant, or identity primitive is added or broadened.
//
// This route creates, links, finalizes and writes nothing.

type AccountProfileRow = {
  display_first_name?: unknown;
  display_last_name?: unknown;
  status?: unknown;
};

/**
 * The only body this route can produce. A failure is never distinguishable
 * from "this account has no display name": every closed path returns the same
 * neutral shape, and no identifier, credential or diagnostic accompanies it.
 */
function accountProfileResponse(displayName: string | null, status = 200) {
  return NextResponse.json(
    { displayName },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Composes the name only for an ACTIVE canonical Person. A merged or inactive
 * Person, or one with no usable display name, yields no name at all -- the
 * page then shows its neutral heading rather than a stale or wrong identity.
 */
function composeActivePersonDisplayName(row: AccountProfileRow): string | null {
  if (row.status !== "active") {
    return null;
  }

  const parts = [row.display_first_name, row.display_last_name]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  return parts.length > 0 ? parts.join(" ") : null;
}

export async function GET(request: Request) {
  try {
    // Only the request's own bearer credential is read. `request.url` and its
    // query string are deliberately never consulted.
    const authenticated = await resolveAuthenticatedRequest(request.headers);

    if (authenticated.state === "unauthenticated") {
      return accountProfileResponse(null, 401);
    }

    if (authenticated.state !== "authenticated") {
      // A transient validation failure is not evidence that the caller's
      // session ended, so it fails closed without challenging the session.
      return accountProfileResponse(null);
    }

    const person = await resolveAuthenticatedAccountPerson(authenticated);

    // no_person, invalid_or_ambiguous and internal_error are deliberately
    // indistinguishable to the caller: ambiguity must never resolve to a name.
    if (person.state !== "resolved") {
      return accountProfileResponse(null);
    }

    const supabaseAdmin = getSupabaseAdminClient();

    if (!supabaseAdmin) {
      return accountProfileResponse(null);
    }

    const { data, error } = await supabaseAdmin
      .from("people")
      .select("display_first_name, display_last_name, status")
      .eq("id", person.personId)
      .maybeSingle();

    if (error || !data) {
      return accountProfileResponse(null);
    }

    return accountProfileResponse(
      composeActivePersonDisplayName(data as AccountProfileRow),
    );
  } catch {
    return accountProfileResponse(null);
  }
}
