-- P-2C linked-database behavior proof.
--
-- Run only after 20260924000000 AND 20260925000000 have been applied to the
-- target.  The fixture creates isolated auth + identity rows, exercises the
-- governed RPCs as the authenticated browser role, and rolls everything back.
--
-- It proves:
--   1. a returning organizer adds a SECOND private Draft event to an event
--      space she already organizes -- same tenant, same organizer
--      appointment, same canonical Person; no new tenant / appointment /
--      tenant-lifecycle audit; event + draft-marker + command audit each +1;
--   2. add-event idempotent replay and changed-input conflict;
--   3. add-event with a possible prior identity returns the safe outcome as a
--      ROW with one ledger + one audit row and no event; a replay adds no
--      second ledger/audit row; and after identity verification a FRESH key
--      creates one event, reusing the now-linked canonical Person;
--   4. add-event to a tenant where the caller is only an Event Admin /
--      Tenant Admin -- or an unrelated tenant -- is rejected as the
--      non-enumerating 'Organization not found.' with zero writes;
--   5. a second auth account linked to the SAME canonical Person reads her
--      event spaces + drafts through the Person-first path;
--   6. an invalid/ambiguous account link reads no other Person's spaces/drafts;
--   7. one event space with two draft events appears once in the spaces list
--      (draft_event_count = 2) and twice in the draft list;
--   8. the P-2A explicit new-event-space command is unchanged (new tenant +
--      appointment + first draft + two lifecycle audit rows);
--   9. the add-event command creates no admin_users / admin_tenant_access /
--      admin_event_access / person_tenant_administrator_appointments row;
--  10. Platform Admin direct RLS reads and the ordinary tenant-administration
--      RPCs cannot discover / read / update the private event space or EITHER
--      of its two draft events;
--  11. the P-2A private-draft isolation (seven administration exclusions,
--      direct RLS, the P-2A create command) is unchanged for a multi-event
--      space, and ordinary non-private tenants are unaffected;
--  12. inconsistent-appointment defense -- an appointment carrying
--      auth_user_id = account A but person_id = Person B does NOT let the
--      resolved account A list / fetch / add-event to that space (proves the
--      identity-conditional fallback: a resolved caller is matched by Person
--      only, never by a stray account-keyed row);
--  13. brand-new unauthorized rollback -- a truly zero-evidence verified
--      account targeting an existing private event space it does not organize
--      goes through the real order (resolver creates a Person + link + audit
--      FIRST, then authorization rejects with 'Organization not found.'), and
--      the whole transaction rolls back: no people / person_auth_accounts /
--      person_resolution_audit / ledger / command audit / tenant / appointment
--      / event / draft / lifecycle / admin fact remains, and the targeted
--      space is unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.p2c_fixture_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-2C fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.p2c_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2c_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2c_fixture_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2c_fixture_counts()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'tenants', (SELECT count(*) FROM public.tenants),
    'events', (SELECT count(*) FROM public.events),
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'organizer_appointments', (SELECT count(*) FROM public.self_service_organizer_appointments),
    'private_event_drafts', (SELECT count(*) FROM public.self_service_private_event_drafts),
    'command_audit', (SELECT count(*) FROM public.self_service_onboarding_command_audit),
    'event_added_audit', (
      SELECT count(*) FROM public.self_service_onboarding_command_audit
      WHERE action = 'private_event_added'
    ),
    'tenant_lifecycle_audit', (SELECT count(*) FROM public.self_service_tenant_lifecycle_audit),
    'safe_outcome_ledger', (SELECT count(*) FROM public.self_service_onboarding_safe_outcome_ledger),
    'organizer_resolution_audit', (
      SELECT count(*) FROM public.person_resolution_audit
      WHERE request_context = 'organizer_self_service_signup'
    ),
    'admin_users', (SELECT count(*) FROM public.admin_users),
    'admin_tenant_access', (SELECT count(*) FROM public.admin_tenant_access),
    'admin_event_access', (SELECT count(*) FROM public.admin_event_access),
    'ptaa', (SELECT count(*) FROM public.person_tenant_administrator_appointments)
  );
$function$;

ALTER FUNCTION public.p2c_fixture_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2c_fixture_counts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2c_fixture_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p2c_fixture_link_account(
  p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (
    person_id, auth_user_id, status, is_primary, verified_at
  ) VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;

ALTER FUNCTION public.p2c_fixture_link_account(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2c_fixture_link_account(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2c_fixture_link_account(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2c_fixture_ordinary_tenant()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT t.id FROM public.tenants t WHERE t.organization_code = 'p2c-fixture-ordinary';
$function$;

ALTER FUNCTION public.p2c_fixture_ordinary_tenant() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2c_fixture_ordinary_tenant()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2c_fixture_ordinary_tenant() TO authenticated;

-- How many person_auth_accounts / person_resolution_audit rows exist for one
-- auth account -- used to prove a caught-and-rolled-back unauthorized add-event
-- leaves NO resolver-created identity fact behind.
CREATE OR REPLACE FUNCTION public.p2c_fixture_person_link_count(p_auth_user_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT count(*) FROM public.person_auth_accounts paa
  WHERE paa.auth_user_id = p_auth_user_id;
$function$;

ALTER FUNCTION public.p2c_fixture_person_link_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2c_fixture_person_link_count(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2c_fixture_person_link_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2c_fixture_resolution_audit_count(p_auth_user_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT count(*) FROM public.person_resolution_audit pra
  WHERE pra.auth_user_id = p_auth_user_id;
$function$;

ALTER FUNCTION public.p2c_fixture_resolution_audit_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2c_fixture_resolution_audit_count(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2c_fixture_resolution_audit_count(uuid) TO authenticated;

-- A complete snapshot of one event space, to prove an adversarial call leaves
-- it byte-for-byte unchanged.
CREATE OR REPLACE FUNCTION public.p2c_fixture_space_snapshot(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'tenant_active', (SELECT t.is_active FROM public.tenants t WHERE t.id = p_tenant_id),
    'tenant_private', (SELECT t.is_self_service_private_draft FROM public.tenants t WHERE t.id = p_tenant_id),
    'tenant_name', (SELECT t.organization_name FROM public.tenants t WHERE t.id = p_tenant_id),
    'event_count', (SELECT count(*) FROM public.events e WHERE e.tenant_id = p_tenant_id),
    'draft_count', (SELECT count(*) FROM public.self_service_private_event_drafts d WHERE d.tenant_id = p_tenant_id),
    'appointment_count', (SELECT count(*) FROM public.self_service_organizer_appointments oa WHERE oa.tenant_id = p_tenant_id)
  );
$function$;

ALTER FUNCTION public.p2c_fixture_space_snapshot(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2c_fixture_space_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2c_fixture_space_snapshot(uuid) TO authenticated;

-- The direct-RLS reads (assertion set 10) need the pre-history table grants the
-- P-2A migration's narrowed policies gate.  Fixture-scoped; rolled back.
GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT, UPDATE ON public.events TO authenticated;

DO $fixture$
DECLARE
  v_mary_person_id uuid;
  v_inactive_person_id uuid;
  v_prior_person_id uuid;
  v_ordinary_tenant_id uuid;
  v_ordinary_event_id uuid;
  v_mary_admin_user_id uuid;
  v_prior_tenant_id uuid;
  v_prior_appointment_id uuid;
  v_prior_event_id uuid;
  v_person_a_id uuid;
  v_person_b_id uuid;
  v_mismatch_tenant_id uuid;
  v_mismatch_appointment_id uuid;
  v_mismatch_event_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      '92c00000-0000-4000-8000-000000000001',
      '92c00000-0000-4000-8000-000000000002',
      '92c00000-0000-4000-8000-000000000003',
      '92c00000-0000-4000-8000-000000000005',
      '92c00000-0000-4000-8000-000000000006',
      '92c00000-0000-4000-8000-000000000007',
      '92c00000-0000-4000-8000-000000000008',
      '92c00000-0000-4000-8000-000000000009'
    )
  ) THEN
    RAISE EXCEPTION 'P-2C fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92c00000-0000-4000-8000-000000000001', 'p2c-mary@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000002', 'p2c-mary-second-device@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000003', 'p2c-platform-admin@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000005', 'p2c-brand-new@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000006', 'p2c-inactive-person@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000007', 'p2c-returning-device@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000008', 'p2c-prior-owner@fixture.invalid', now()),
    ('92c00000-0000-4000-8000-000000000009', 'p2c-mismatch-account@fixture.invalid', now());

  INSERT INTO public.admin_users (email, display_name, user_id, is_active, privilege_group)
  VALUES ('p2c-platform-admin@fixture.invalid', 'P2C Platform Admin',
          '92c00000-0000-4000-8000-000000000003', true, 'super_admin');

  -- Mary: one canonical Person, an active-primary link plus a second active
  -- (non-primary) link -- a returning organizer on a second device.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_mary_person_id;
  PERFORM public.p2c_fixture_link_account(v_mary_person_id, '92c00000-0000-4000-8000-000000000001', true);
  PERFORM public.p2c_fixture_link_account(v_mary_person_id, '92c00000-0000-4000-8000-000000000002', false);

  -- An ordinary (non-private) tenant/event where Mary ALSO holds legitimate,
  -- explicit Event Admin + Tenant Admin authority.  That authority must not
  -- make this tenant a valid target for her personal add-event command.
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p2c-fixture-ordinary', 'p2c-fixture-ordinary', 'P2C Ordinary Org',
          'P2C Ordinary Org', 'P2C Ordinary Org')
  RETURNING id INTO v_ordinary_tenant_id;
  INSERT INTO public.events (tenant_id, name)
  VALUES (v_ordinary_tenant_id, 'P2C Ordinary Event')
  RETURNING id INTO v_ordinary_event_id;
  INSERT INTO public.admin_users (email, display_name, user_id, is_active, privilege_group)
  VALUES ('p2c-mary@fixture.invalid', 'P2C Mary Admin',
          '92c00000-0000-4000-8000-000000000001', true, 'event_admin')
  RETURNING id INTO v_mary_admin_user_id;
  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_mary_admin_user_id, v_ordinary_event_id, 'event_admin');
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  VALUES (v_mary_admin_user_id, v_ordinary_tenant_id, true);
  INSERT INTO public.person_tenant_administrator_appointments (person_id, tenant_id)
  VALUES (v_mary_person_id, v_ordinary_tenant_id);

  -- Account ...006: linked to a Person that is now inactive ->
  -- resolve_auth_person_link returns invalid_or_ambiguous.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_inactive_person_id;
  PERFORM public.p2c_fixture_link_account(v_inactive_person_id, '92c00000-0000-4000-8000-000000000006', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_inactive_person_id;

  -- A prior canonical Person (P7) who already organizes an event space, with
  -- her ORIGINAL account ...008 linked active-primary.  Account ...007 carries
  -- P7's verified email but is not linked yet -- the "returning on a new
  -- device before re-verifying" case.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_prior_person_id;
  PERFORM public.p2c_fixture_link_account(v_prior_person_id, '92c00000-0000-4000-8000-000000000008', true);
  INSERT INTO public.person_identifiers (
    person_id, identifier_type, identifier_value, normalized_value,
    source_type, verification_status, is_current
  ) VALUES (
    v_prior_person_id, 'email', 'p2c-returning-device@fixture.invalid',
    'p2c-returning-device@fixture.invalid', 'member_confirmation', 'user_confirmed', true
  );

  INSERT INTO public.tenants (
    organization_code, slug, organization_name, display_name, app_title,
    is_active, is_self_service_private_draft
  ) VALUES (
    'p2c-p7-space', 'p2c-p7-space', 'P7 Personal Space', 'P7 Personal Space',
    'P7 Personal Space', true, true
  ) RETURNING id INTO v_prior_tenant_id;
  INSERT INTO public.self_service_organizer_appointments (person_id, auth_user_id, tenant_id)
  VALUES (v_prior_person_id, '92c00000-0000-4000-8000-000000000008', v_prior_tenant_id)
  RETURNING id INTO v_prior_appointment_id;
  INSERT INTO public.events (
    tenant_id, name, end_date, timezone, status, is_active, visible_to_members
  ) VALUES (
    v_prior_tenant_id, 'P7 First Event', current_date + 6, 'UTC', 'Draft', false, false
  ) RETURNING id INTO v_prior_event_id;
  INSERT INTO public.self_service_private_event_drafts (
    event_id, tenant_id, organizer_appointment_id, location_mode, starter_template
  ) VALUES (
    v_prior_event_id, v_prior_tenant_id, v_prior_appointment_id, 'no_location', 'casual'
  );

  -- Deliberately inconsistent BUT schema-permitted appointment: account ...009
  -- resolves exactly to Person A, while a private event-space appointment
  -- carries auth_user_id = account ...009 and person_id = Person B.  A resolved
  -- caller must not be able to use that account-keyed row to reach Person B's
  -- space.  (Neither unique rule is violated: ...009 has no other appointment
  -- in this tenant, and Person B has no other active appointment here.)
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person_a_id;
  PERFORM public.p2c_fixture_link_account(v_person_a_id, '92c00000-0000-4000-8000-000000000009', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person_b_id;

  INSERT INTO public.tenants (
    organization_code, slug, organization_name, display_name, app_title,
    is_active, is_self_service_private_draft
  ) VALUES (
    'p2c-mismatch-space', 'p2c-mismatch-space', 'Mismatch Space', 'Mismatch Space',
    'Mismatch Space', true, true
  ) RETURNING id INTO v_mismatch_tenant_id;
  INSERT INTO public.self_service_organizer_appointments (person_id, auth_user_id, tenant_id)
  VALUES (v_person_b_id, '92c00000-0000-4000-8000-000000000009', v_mismatch_tenant_id)
  RETURNING id INTO v_mismatch_appointment_id;
  INSERT INTO public.events (
    tenant_id, name, end_date, timezone, status, is_active, visible_to_members
  ) VALUES (
    v_mismatch_tenant_id, 'Mismatch Draft Event', current_date + 6, 'UTC', 'Draft', false, false
  ) RETURNING id INTO v_mismatch_event_id;
  INSERT INTO public.self_service_private_event_drafts (
    event_id, tenant_id, organizer_appointment_id, location_mode, starter_template
  ) VALUES (
    v_mismatch_event_id, v_mismatch_tenant_id, v_mismatch_appointment_id, 'no_location', 'casual'
  );
END;
$fixture$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_space record;
  v_added record;
  v_added_retry record;
  v_third record;
  v_uncertain record;
  v_verified record;
  v_space_tenant uuid;
  v_space_appointment uuid;
  v_mary_person uuid;
  v_prior_person uuid;
  v_prior_tenant uuid;
  v_mismatch_tenant uuid;
  v_mismatch_event uuid;
  v_snapshot_before jsonb;
  v_org_rows int;
  v_max_count int;
  v_failed boolean;
BEGIN
  -- 8: the P-2A new-event-space command is untouched.
  v_before := public.p2c_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_space
  FROM public.create_self_service_organizer_draft(
    'Mary Personal Space', 'Mary First Event', current_date + 7, 'UTC',
    '92cdd000-0000-4000-8000-000000000001', current_date + 7, 'no_location', NULL, 'casual'
  );
  v_after := public.p2c_fixture_counts();
  PERFORM public.p2c_fixture_assert(
    v_space.outcome = 'created'
    AND (v_after->>'tenants')::bigint = (v_before->>'tenants')::bigint + 1
    AND (v_after->>'organizer_appointments')::bigint = (v_before->>'organizer_appointments')::bigint + 1
    AND (v_after->>'events')::bigint = (v_before->>'events')::bigint + 1
    AND (v_after->>'private_event_drafts')::bigint = (v_before->>'private_event_drafts')::bigint + 1
    AND (v_after->>'tenant_lifecycle_audit')::bigint = (v_before->>'tenant_lifecycle_audit')::bigint + 2,
    'P-2A new-event-space command unchanged: new tenant + appointment + first draft + two lifecycle audits'
  );
  v_space_tenant := v_space.tenant_id;
  v_space_appointment := v_space.organizer_appointment_id;
  v_mary_person := v_space.organizer_person_id;

  -- 1 + 9: add a SECOND draft event to the SAME event space.
  v_before := public.p2c_fixture_counts();
  SELECT * INTO v_added
  FROM public.create_self_service_organizer_event(
    v_space_tenant, 'Mary Second Event', current_date + 9, 'UTC',
    '92cdd000-0000-4000-8000-000000000002', current_date + 9, 'location', 'Community Hall', 'dinner'
  );
  v_after := public.p2c_fixture_counts();
  PERFORM public.p2c_fixture_assert(
    v_added.outcome = 'created'
    AND v_added.tenant_id = v_space_tenant
    AND v_added.organizer_appointment_id = v_space_appointment
    AND v_added.organizer_person_id = v_mary_person
    AND v_added.event_id <> v_space.event_id
    AND v_added.status = 'Draft'
    AND v_added.is_active = false
    AND v_added.visible_to_members = false,
    'add-event reuses the same event space, organizer appointment, and canonical Person'
  );
  PERFORM public.p2c_fixture_assert(
    (v_after->>'events')::bigint = (v_before->>'events')::bigint + 1
    AND (v_after->>'private_event_drafts')::bigint = (v_before->>'private_event_drafts')::bigint + 1
    AND (v_after->>'command_audit')::bigint = (v_before->>'command_audit')::bigint + 1
    AND (v_after->>'event_added_audit')::bigint = (v_before->>'event_added_audit')::bigint + 1
    AND (v_after->>'tenants')::bigint = (v_before->>'tenants')::bigint
    AND (v_after->>'organizer_appointments')::bigint = (v_before->>'organizer_appointments')::bigint
    AND (v_after->>'tenant_lifecycle_audit')::bigint = (v_before->>'tenant_lifecycle_audit')::bigint
    AND (v_after->>'people')::bigint = (v_before->>'people')::bigint
    AND (v_after->>'admin_users')::bigint = (v_before->>'admin_users')::bigint
    AND (v_after->>'admin_tenant_access')::bigint = (v_before->>'admin_tenant_access')::bigint
    AND (v_after->>'admin_event_access')::bigint = (v_before->>'admin_event_access')::bigint
    AND (v_after->>'ptaa')::bigint = (v_before->>'ptaa')::bigint,
    'add-event: +1 event / draft-marker / command audit; zero new tenant / appointment / lifecycle / admin authority'
  );

  -- 2: idempotent replay and changed-input conflict.
  v_before := public.p2c_fixture_counts();
  SELECT * INTO v_added_retry
  FROM public.create_self_service_organizer_event(
    v_space_tenant, 'Mary Second Event', current_date + 9, 'UTC',
    '92cdd000-0000-4000-8000-000000000002', current_date + 9, 'location', 'Community Hall', 'dinner'
  );
  PERFORM public.p2c_fixture_assert(
    v_added_retry.outcome = 'created'
    AND v_added_retry.event_id = v_added.event_id
    AND public.p2c_fixture_counts() = v_before,
    'an identical add-event retry replays the same event with no new rows'
  );
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_event(
      v_space_tenant, 'Mary Second Event CHANGED', current_date + 9, 'UTC',
      '92cdd000-0000-4000-8000-000000000002', current_date + 9, 'location', 'Community Hall', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Idempotency key was already used with different draft input.';
  END;
  PERFORM public.p2c_fixture_assert(v_failed, 'add-event with a reused key + changed input fails closed');

  -- 7: one event space with two draft events -- once in the spaces list, twice
  -- in the draft list.
  SELECT count(*), max(o.draft_event_count)
    INTO v_org_rows, v_max_count
  FROM public.list_my_self_service_private_organizations() AS o
  WHERE o.tenant_id = v_space_tenant;
  PERFORM public.p2c_fixture_assert(
    v_org_rows = 1 AND v_max_count = 2,
    'the event space appears once in the spaces list with draft_event_count = 2'
  );
  PERFORM public.p2c_fixture_assert(
    (SELECT count(*) FROM public.list_my_self_service_private_drafts() AS d WHERE d.tenant_id = v_space_tenant) = 2,
    'both draft events appear in the caller draft list'
  );

  -- 3 (fresh key path): Mary adds a THIRD event with a fresh idempotency key.
  v_before := public.p2c_fixture_counts();
  SELECT * INTO v_third
  FROM public.create_self_service_organizer_event(
    v_space_tenant, 'Mary Third Event', current_date + 11, 'UTC',
    '92cdd000-0000-4000-8000-000000000003'
  );
  v_after := public.p2c_fixture_counts();
  PERFORM public.p2c_fixture_assert(
    v_third.outcome = 'created'
    AND (v_after->>'events')::bigint = (v_before->>'events')::bigint + 1
    AND (v_after->>'private_event_drafts')::bigint = (v_before->>'private_event_drafts')::bigint + 1,
    'a fresh idempotency key creates exactly one more event in the same space'
  );

  -- 5: Mary's SECOND linked account reads the same spaces + drafts (Person-first).
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000002', true);
  PERFORM public.p2c_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.list_my_self_service_private_organizations() AS o
      WHERE o.tenant_id = v_space_tenant
    )
    AND (SELECT count(*) FROM public.list_my_self_service_private_drafts() AS d WHERE d.tenant_id = v_space_tenant) = 3
    AND EXISTS (SELECT 1 FROM public.get_my_self_service_private_draft(v_space.event_id)),
    'a second auth account linked to the same canonical Person reads her spaces + drafts (Person-first)'
  );

  -- 6: an invalid/ambiguous account link reads nothing.
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000006', true);
  PERFORM public.p2c_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.list_my_self_service_private_organizations())
    AND NOT EXISTS (SELECT 1 FROM public.list_my_self_service_private_drafts())
    AND NOT EXISTS (SELECT 1 FROM public.get_my_self_service_private_draft(v_space.event_id)),
    'an invalid/ambiguous account link cannot read another Person''s spaces or drafts'
  );

  -- 4: add-event to a tenant where Mary is only Event Admin / Tenant Admin.
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000001', true);
  v_before := public.p2c_fixture_counts();
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_event(
      public.p2c_fixture_ordinary_tenant(), 'Sneaky Event', current_date + 3, 'UTC',
      '92cdd000-0000-4000-8000-000000000004'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Organization not found.';
  END;
  PERFORM public.p2c_fixture_assert(
    v_failed AND public.p2c_fixture_counts() = v_before,
    'add-event to a tenant where the caller is only Event/Tenant Admin is rejected as Organization not found, zero writes'
  );
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_event(
      '99999999-0000-4000-8000-000000009999', 'Nowhere Event', current_date + 3, 'UTC',
      '92cdd000-0000-4000-8000-000000000005'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Organization not found.';
  END;
  PERFORM public.p2c_fixture_assert(v_failed, 'add-event to an unrelated / missing tenant id is the identical non-enumerating message');

  -- 3 (uncertain-outcome path): account ...007 carries P7's verified email but
  -- is not linked yet.  add-event returns identity_confirmation_required as a
  -- ROW with one ledger + one audit row and no event; a replay adds neither.
  v_prior_tenant := (SELECT id FROM public.tenants WHERE organization_code = 'p2c-p7-space');
  v_before := public.p2c_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000007', true);
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_event(
    v_prior_tenant, 'P7 Would-Be Event', current_date + 8, 'UTC',
    '92cdd000-0000-4000-8000-000000000007'
  );
  v_after := public.p2c_fixture_counts();
  PERFORM public.p2c_fixture_assert(
    v_uncertain.outcome = 'identity_confirmation_required'
    AND v_uncertain.tenant_id IS NULL
    AND v_uncertain.event_id IS NULL
    AND v_uncertain.organizer_person_id IS NULL
    AND (v_after->>'safe_outcome_ledger')::bigint = (v_before->>'safe_outcome_ledger')::bigint + 1
    AND (v_after->>'organizer_resolution_audit')::bigint = (v_before->>'organizer_resolution_audit')::bigint + 1
    AND (v_after->>'events')::bigint = (v_before->>'events')::bigint
    AND (v_after->>'tenants')::bigint = (v_before->>'tenants')::bigint
    AND (v_after->>'private_event_drafts')::bigint = (v_before->>'private_event_drafts')::bigint,
    'add-event with a possible prior identity returns the safe outcome as a row: one ledger + one audit, no event'
  );
  v_before := public.p2c_fixture_counts();
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_event(
    v_prior_tenant, 'P7 Would-Be Event', current_date + 8, 'UTC',
    '92cdd000-0000-4000-8000-000000000007'
  );
  v_after := public.p2c_fixture_counts();
  PERFORM public.p2c_fixture_assert(
    v_uncertain.outcome = 'identity_confirmation_required'
    AND (v_after->>'safe_outcome_ledger')::bigint = (v_before->>'safe_outcome_ledger')::bigint
    AND (v_after->>'organizer_resolution_audit')::bigint = (v_before->>'organizer_resolution_audit')::bigint,
    'replaying the same key + input replays the safe outcome with no second ledger / audit row'
  );

  -- 3 (post-verification fresh key): after account ...007 is linked to P7, a
  -- FRESH key creates one event in P7's existing space, reusing P7's Person.
  v_prior_person := (
    SELECT paa.person_id FROM public.person_auth_accounts paa
    WHERE paa.auth_user_id = '92c00000-0000-4000-8000-000000000008'
      AND paa.status = 'active' AND paa.is_primary = true
  );
  PERFORM public.p2c_fixture_link_account(v_prior_person, '92c00000-0000-4000-8000-000000000007', false);
  v_before := public.p2c_fixture_counts();
  SELECT * INTO v_verified
  FROM public.create_self_service_organizer_event(
    v_prior_tenant, 'P7 Confirmed Event', current_date + 8, 'UTC',
    '92cdd000-0000-4000-8000-000000000107'
  );
  v_after := public.p2c_fixture_counts();
  PERFORM public.p2c_fixture_assert(
    v_verified.outcome = 'created'
    AND v_verified.organizer_person_id = v_prior_person
    AND v_verified.tenant_id = v_prior_tenant
    AND (v_after->>'events')::bigint = (v_before->>'events')::bigint + 1
    AND (v_after->>'people')::bigint = (v_before->>'people')::bigint
    AND (v_after->>'tenants')::bigint = (v_before->>'tenants')::bigint,
    'after verification a fresh key creates one event in the existing space, reusing the now-linked canonical Person'
  );

  -- 10 + 11: Platform Admin cannot discover / read / update the private event
  -- space or EITHER of its draft events, and ordinary tenants are unaffected.
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000003', true);
  PERFORM public.p2c_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_space_tenant)
    AND (SELECT count(*) FROM public.events WHERE tenant_id = v_space_tenant) = 0,
    'Platform Admin direct RLS reads see neither the private event space nor any of its draft events'
  );
  PERFORM public.p2c_fixture_assert(
    (WITH u AS (
       UPDATE public.events SET visible_to_members = true
       WHERE tenant_id = v_space_tenant
       RETURNING 1
     ) SELECT count(*) FROM u) = 0,
    'Platform Admin raw UPDATE cannot reach any event in the private space'
  );
  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_owned_events_for_administration(v_space_tenant);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2c_fixture_assert(v_failed, 'list_tenant_owned_events_for_administration still rejects the multi-event private space');
  v_failed := false;
  BEGIN
    PERFORM public.get_tenant_for_administration(v_space_tenant);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2c_fixture_assert(v_failed, 'tenant detail still rejects the multi-event private space');
  PERFORM public.p2c_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.list_tenants_for_administration() AS t WHERE t.id = v_space_tenant
    )
    AND (SELECT count(*) FROM public.list_tenants_for_administration()) > 0,
    'the private space is excluded from the Platform Admin tenant list; ordinary tenants are still returned'
  );
  PERFORM public.p2c_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.list_tenant_owned_events_for_administration(public.p2c_fixture_ordinary_tenant())
    ),
    'an ordinary non-private tenant''s owned-event list is unaffected'
  );

  -- ==== 12: inconsistent appointment (auth_user_id = A, person_id = B) ======
  -- Account ...009 resolves EXACTLY to Person A.  A private-space appointment
  -- carries auth_user_id = ...009 but person_id = Person B.  The old
  -- unconditional "OR oa.auth_user_id = ..." fallback would have leaked this
  -- space to ...009; the identity-conditional rule must not.
  v_mismatch_tenant := (SELECT id FROM public.tenants WHERE organization_code = 'p2c-mismatch-space');
  v_mismatch_event := (
    SELECT d.event_id FROM public.self_service_private_event_drafts d
    WHERE d.tenant_id = v_mismatch_tenant
    LIMIT 1
  );
  v_before := public.p2c_fixture_counts();
  v_snapshot_before := public.p2c_fixture_space_snapshot(v_mismatch_tenant);
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000009', true);
  PERFORM public.p2c_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.list_my_self_service_private_organizations() AS o
      WHERE o.tenant_id = v_mismatch_tenant
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.list_my_self_service_private_drafts() AS d
      WHERE d.tenant_id = v_mismatch_tenant
    )
    AND NOT EXISTS (SELECT 1 FROM public.get_my_self_service_private_draft(v_mismatch_event)),
    'a resolved caller cannot list or fetch a space whose appointment carries their auth_user_id but another Person''s person_id'
  );
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_event(
      v_mismatch_tenant, 'Mismatch Intrusion', current_date + 5, 'UTC',
      '92cdd000-0000-4000-8000-000000000209'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Organization not found.';
  END;
  PERFORM public.p2c_fixture_assert(
    v_failed
    AND public.p2c_fixture_counts() = v_before
    AND public.p2c_fixture_space_snapshot(v_mismatch_tenant) = v_snapshot_before,
    'add-event to the mismatched space is rejected non-enumeratively with zero writes and the space unchanged'
  );

  -- ==== 13: brand-new zero-evidence unauthorized account -> full rollback ===
  -- Account ...005 has no Person, no link, no identity evidence.  It targets
  -- P7's EXISTING private event space.  The resolver runs the real order:
  -- create_new (Person + link + audit) FIRST, then Person-scoped authorization
  -- rejects with 'Organization not found.', and the whole transaction rolls
  -- back -- leaving NO resolver-created fact behind.
  v_prior_tenant := (SELECT id FROM public.tenants WHERE organization_code = 'p2c-p7-space');
  v_before := public.p2c_fixture_counts();
  v_snapshot_before := public.p2c_fixture_space_snapshot(v_prior_tenant);
  PERFORM set_config('request.jwt.claim.sub', '92c00000-0000-4000-8000-000000000005', true);
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_event(
      v_prior_tenant, 'Intruder Event', current_date + 4, 'UTC',
      '92cdd000-0000-4000-8000-000000000205'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Organization not found.';
  END;
  PERFORM public.p2c_fixture_assert(v_failed, 'a brand-new unauthorized add-event is rejected as Organization not found.');
  PERFORM public.p2c_fixture_assert(
    public.p2c_fixture_counts() = v_before
    AND public.p2c_fixture_person_link_count('92c00000-0000-4000-8000-000000000005') = 0
    AND public.p2c_fixture_resolution_audit_count('92c00000-0000-4000-8000-000000000005') = 0,
    'the resolver-created Person / account link / resolution audit and every ledger / command-audit / tenant / appointment / event / draft / lifecycle / admin fact are all rolled back'
  );
  PERFORM public.p2c_fixture_assert(
    public.p2c_fixture_space_snapshot(v_prior_tenant) = v_snapshot_before,
    'the targeted private event space is completely unchanged'
  );
END;
$fixture$;

ROLLBACK;
