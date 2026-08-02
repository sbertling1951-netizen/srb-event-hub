import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

type NameHint = {
  firstName?: string | null;
  lastName?: string | null;
};

type ResolveResult = { personId: string } | { error: string };

export type GovernedPersonResolution =
  | {
      kind: "resolved_existing";
      personId: string;
      auditId: string;
    }
  | {
      kind: "created_new";
      personId: string;
      auditId: string;
    }
  | {
      kind: "needs_confirmation";
      auditId: string;
    }
  | {
      kind: "ambiguous";
      auditId: string;
    }
  | {
      kind: "invalid_existing_link";
      auditId: string;
    }
  | {
      kind: "error";
      message: string;
    };

export type GovernedPersonResolutionInput = {
  requestContext: "vendor_self_registration" | "vendor_invitation_activation";
  authUserId: string;
  verifiedAuthEmail?: string | null;
  verifiedAuthPhone?: string | null;
  invitationAccessId?: string | null;
  displayFirstName?: string | null;
  displayLastName?: string | null;
};

type GovernedPersonResolutionRow = {
  outcome?: unknown;
  person_id?: unknown;
  audit_id?: unknown;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function invalidGovernedResolution(message: string): GovernedPersonResolution {
  return { kind: "error", message };
}

// This adapter intentionally remains unused until the Vendor route-integration
// milestone. Its inputs must be derived by trusted server code; callers must
// provide only verified Auth claims, never browser-supplied identity evidence.
export async function resolveGovernedPersonForServerAuthUser(
  supabaseAdmin: SupabaseAdminClient,
  input: GovernedPersonResolutionInput,
): Promise<GovernedPersonResolution> {
  if (!isUuid(input.authUserId)) {
    return invalidGovernedResolution("Invalid server-derived auth user identity.");
  }

  const { data, error } = await supabaseAdmin.rpc(
    "resolve_vendor_person_identity",
    {
      p_request_context: input.requestContext,
      p_auth_user_id: input.authUserId,
      p_verified_auth_email: input.verifiedAuthEmail?.trim() || null,
      p_verified_auth_phone: input.verifiedAuthPhone?.trim() || null,
      p_invitation_access_id: input.invitationAccessId || null,
      p_display_first_name: input.displayFirstName?.trim() || null,
      p_display_last_name: input.displayLastName?.trim() || null,
    },
  );

  if (error) {
    return invalidGovernedResolution("Governed Person resolution could not complete.");
  }

  if (!Array.isArray(data) || data.length !== 1) {
    return invalidGovernedResolution("Governed Person resolution returned an invalid result.");
  }

  const row = data[0] as GovernedPersonResolutionRow;
  if (!isUuid(row.audit_id)) {
    return invalidGovernedResolution("Governed Person resolution returned an invalid audit result.");
  }

  if (row.outcome === "resolved_existing" || row.outcome === "created_new") {
    if (!isUuid(row.person_id)) {
      return invalidGovernedResolution("Governed Person resolution returned an invalid Person result.");
    }

    return {
      kind: row.outcome,
      personId: row.person_id,
      auditId: row.audit_id,
    };
  }

  if (
    row.outcome === "needs_confirmation" ||
    row.outcome === "ambiguous" ||
    row.outcome === "invalid_existing_link"
  ) {
    if (row.person_id !== null) {
      return invalidGovernedResolution("Governed Person resolution returned an invalid unresolved result.");
    }

    return { kind: row.outcome, auditId: row.audit_id };
  }

  return invalidGovernedResolution("Governed Person resolution returned an unknown outcome.");
}

// One source of truth for "which person does this auth.users identity map
// to." Reuses an existing person_auth_accounts link when present (this is
// what keeps an existing member from getting a second, duplicate person
// record when they also gain vendor access); otherwise creates a new
// person + person_auth_accounts row. Used by both vendor self-registration
// and vendor invitation activation so the two paths cannot drift.
export async function resolveOrCreatePersonForAuthUser(
  supabaseAdmin: SupabaseAdminClient,
  authUserId: string,
  nameHint: NameHint = {},
): Promise<ResolveResult> {
  const { data: personAuth, error: personAuthError } = await supabaseAdmin
    .from("person_auth_accounts")
    .select("id,person_id,status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (personAuthError) {
    return { error: personAuthError.message };
  }

  if (personAuth?.person_id) {
    if (personAuth.status !== "active") {
      const { error: reactivateError } = await supabaseAdmin
        .from("person_auth_accounts")
        .update({
          status: "active",
          retired_at: null,
          verified_at: new Date().toISOString(),
        })
        .eq("id", personAuth.id);

      if (reactivateError) {
        return { error: reactivateError.message };
      }
    }

    return { personId: personAuth.person_id };
  }

  const { data: createdPerson, error: personCreateError } = await supabaseAdmin
    .from("people")
    .insert({
      display_first_name: nameHint.firstName?.trim() || null,
      display_last_name: nameHint.lastName?.trim() || null,
      status: "active",
    })
    .select("id")
    .single();

  if (personCreateError || !createdPerson?.id) {
    return { error: personCreateError?.message || "Could not create person record." };
  }

  const personId: string = createdPerson.id;

  const { error: personAuthCreateError } = await supabaseAdmin
    .from("person_auth_accounts")
    .insert({
      person_id: personId,
      auth_user_id: authUserId,
      status: "active",
      is_primary: true,
      verified_at: new Date().toISOString(),
    });

  if (personAuthCreateError) {
    await supabaseAdmin.from("people").delete().eq("id", personId);
    return { error: personAuthCreateError.message };
  }

  return { personId };
}
