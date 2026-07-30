import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

type NameHint = {
  firstName?: string | null;
  lastName?: string | null;
};

type ResolveResult = { personId: string } | { error: string };

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
