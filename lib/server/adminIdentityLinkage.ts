import type { SupabaseClient } from "@supabase/supabase-js";

// Governed admin_users.user_id linkage resolver. This is the single
// identity-matching algorithm for backfilling admin auth linkage --
// resolveAdminActorFromBearer (lib/server/adminAuthz.ts) calls this same
// function rather than duplicating the lookup, so there is exactly one
// place this decision is made.
//
// The candidate-selection step (admin_users lookup by exact active email)
// is unchanged from the mechanism already live in production. What this
// adds, before persisting, is a corroborating check against the governed
// Person identity graph (person_auth_accounts -> person_identifiers) when
// that graph has data for the caller: if the Person graph exists for this
// auth user and it does NOT include the candidate's email among that
// Person's current identifiers, the linkage is refused even though the
// raw email matched. If no Person/auth-account graph exists at all for
// this auth user, behavior falls back to exactly the existing governed
// email-match algorithm -- this only ever makes linkage stricter, never
// looser, and never blocks a caller who has no Person graph data.
//
// This function never creates a Person, an auth account, or an
// admin_users row, and never touches Event assignments, task grants, or
// materialization state. It writes exactly one column:
// admin_users.user_id, and only from NULL to a single confirmed value.

export type AdminIdentityLinkageResult =
  | { status: "already_linked"; adminUserId: string }
  | { status: "linked"; adminUserId: string }
  | { status: "no_admin_found" }
  | { status: "ambiguous"; reason: string }
  | { status: "conflict"; reason: string };

export async function resolveAndLinkAdminIdentity(
  supabaseAdmin: SupabaseClient,
  authUser: { id: string; email: string | null | undefined },
): Promise<AdminIdentityLinkageResult> {
  // 1. Already linked by user_id -- no-op, idempotent.
  const { data: byUserId } = await supabaseAdmin
    .from("admin_users")
    .select("id,user_id")
    .eq("user_id", authUser.id)
    .eq("is_active", true)
    .maybeSingle();

  if (byUserId) {
    return { status: "already_linked", adminUserId: byUserId.id };
  }

  if (!authUser.email) {
    return { status: "no_admin_found" };
  }

  // 2. Candidate lookup: the existing governed email-match algorithm,
  // reused unchanged (same predicate resolveAdminActorFromBearer already
  // used before this refactor).
  const { data: candidates, error: candidateError } = await supabaseAdmin
    .from("admin_users")
    .select("id,user_id,email")
    .eq("email", authUser.email)
    .eq("is_active", true);

  if (candidateError || !candidates || candidates.length === 0) {
    return { status: "no_admin_found" };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      reason: "multiple active admin_users rows share this email",
    };
  }

  const candidate = candidates[0];

  if (candidate.user_id) {
    if (candidate.user_id === authUser.id) {
      return { status: "already_linked", adminUserId: candidate.id };
    }
    return {
      status: "conflict",
      reason: "admin_users row is already linked to a different auth user",
    };
  }

  // 3. Person-graph corroboration, only enforced when data exists.
  const { data: personLinks } = await supabaseAdmin
    .from("person_auth_accounts")
    .select("person_id")
    .eq("auth_user_id", authUser.id)
    .eq("status", "active")
    .eq("is_primary", true);

  if (personLinks && personLinks.length > 1) {
    return {
      status: "ambiguous",
      reason: "multiple active primary person_auth_accounts exist for this auth user",
    };
  }

  if (personLinks && personLinks.length === 1) {
    const personId = personLinks[0].person_id;

    const { data: identifiers } = await supabaseAdmin
      .from("person_identifiers")
      .select("normalized_value")
      .eq("person_id", personId)
      .eq("identifier_type", "email")
      .eq("is_current", true);

    const currentEmails = (identifiers || [])
      .map((row: { normalized_value: string | null }) => (row.normalized_value || "").toLowerCase())
      .filter(Boolean);

    if (!currentEmails.includes(authUser.email.toLowerCase())) {
      return {
        status: "ambiguous",
        reason: "Person identity graph does not corroborate this email",
      };
    }
  }

  // 4. Persist -- guarded so the write only applies if the row is still
  // NULL at write time (race-safe, idempotent under concurrent calls).
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("admin_users")
    .update({ user_id: authUser.id })
    .eq("id", candidate.id)
    .is("user_id", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return { status: "conflict", reason: updateError.message };
  }

  if (!updated) {
    // Someone else linked it between our read and our write; re-check.
    const { data: recheck } = await supabaseAdmin
      .from("admin_users")
      .select("id,user_id")
      .eq("id", candidate.id)
      .maybeSingle();

    if (recheck?.user_id === authUser.id) {
      return { status: "already_linked", adminUserId: candidate.id };
    }

    return {
      status: "conflict",
      reason: "admin_users row was linked to a different auth user concurrently",
    };
  }

  return { status: "linked", adminUserId: candidate.id };
}
