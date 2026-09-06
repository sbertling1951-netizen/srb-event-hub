-- P-2A / P-2B linked-database behavior proof.
--
-- Run only after 20260924000000 has been applied to the target.  The fixture
-- creates isolated auth + identity rows, exercises the governed RPC as the
-- authenticated browser role, and rolls all fixture rows back.
--
-- P-2B additions prove: an already-linked organizer reuses her existing
-- canonical Person; a genuinely new organizer gets exactly one Person + one
-- active-primary account link + one audited created_new outcome; one possible
-- prior identity or an invalid/ambiguous/disputed account link fails closed
-- with zero downstream writes and a non-enumerating outcome; idempotency
-- never crosses a Person boundary; and no admin authority is ever created.
--
-- Later repairs add proof that: (A) established role-instance and unresolved
-- household-member evidence is NOT treated as zero evidence and cannot create
-- a duplicate Person; (B) an uncertain safe outcome is bound to the command
-- idempotency key -- same key + input replays it with no second audit/ledger,
-- changed input conflicts, and a fresh key after verification creates the
-- draft once reusing the existing Person; (C) an authenticated Platform Admin
-- cannot directly SELECT, enumerate, or UPDATE a private-draft tenant row or
-- its draft event row, while ordinary tenants/events stay readable; and the
-- hostname-mapping / admin-assignment / administration-audit list RPCs fail
-- closed for a private draft identically to a missing tenant id, while keeping
-- normal behavior for ordinary tenants; and (D) a canonical Person who ALREADY
-- holds legitimate Event Admin + Tenant Admin authority in a distinct ordinary
-- tenant/event can still create a separate private draft (reusing her Person),
-- that authority neither blocks it nor leaks into it, the flow creates zero
-- new admin_users / admin_tenant_access / admin_event_access / ptaa rows, and
-- the pre-existing authority is unchanged afterward.
--
-- "No new admin authority" is proved by before/after counts, NOT by assuming
-- the organizer's account has no admin_users row -- a canonical Person may
-- legitimately be an administrator elsewhere.

BEGIN;

CREATE OR REPLACE FUNCTION public.p2a_fixture_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-2A fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.p2a_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_assert(boolean, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.p2a_fixture_counts()
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
    'organizer_person_resolution_audit', (
      SELECT count(*) FROM public.person_resolution_audit
      WHERE request_context = 'organizer_self_service_signup'
    ),
    'safe_outcome_ledger', (
      SELECT count(*) FROM public.self_service_onboarding_safe_outcome_ledger
    ),
    'admin_users', (SELECT count(*) FROM public.admin_users),
    'admin_tenant_access', (SELECT count(*) FROM public.admin_tenant_access),
    'admin_event_access', (SELECT count(*) FROM public.admin_event_access),
    'person_tenant_administrator_appointments', (
      SELECT count(*) FROM public.person_tenant_administrator_appointments
    )
  );
$function$;

ALTER FUNCTION public.p2a_fixture_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_counts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_counts() TO authenticated;

-- Simulate a member completing identity verification: link a canonical Person
-- to an auth account.  (In production this is finalize_member_identity_activation
-- / the identity-claim flow.)
CREATE OR REPLACE FUNCTION public.p2a_fixture_link_account(
  p_person_id uuid, p_auth_user_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  INSERT INTO public.person_auth_accounts (
    person_id, auth_user_id, status, is_primary, verified_at
  ) VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;

ALTER FUNCTION public.p2a_fixture_link_account(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_link_account(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_link_account(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2a_fixture_person_by_identifier(p_normalized text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT pi.person_id
  FROM public.person_identifiers pi
  WHERE pi.normalized_value = p_normalized
  ORDER BY pi.created_at
  LIMIT 1;
$function$;

ALTER FUNCTION public.p2a_fixture_person_by_identifier(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_person_by_identifier(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_person_by_identifier(text) TO authenticated;

-- Inspect the private-draft tenant + its draft event bypassing RLS (the
-- Platform Admin's own direct reads are now excluded by policy).
CREATE OR REPLACE FUNCTION public.p2a_fixture_private_draft_intact(p_tenant_id uuid, p_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.is_active = true
      AND t.is_self_service_private_draft = true
  )
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND e.tenant_id = p_tenant_id
      AND e.status = 'Draft'
      AND e.is_active = false
      AND e.visible_to_members = false
  );
$function$;

ALTER FUNCTION public.p2a_fixture_private_draft_intact(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_private_draft_intact(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_private_draft_intact(uuid, uuid) TO authenticated;

-- One ordinary non-private tenant id, for "normal admin behavior preserved".
CREATE OR REPLACE FUNCTION public.p2a_fixture_any_non_private_tenant()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT t.id FROM public.tenants t
  WHERE t.is_self_service_private_draft = false
  ORDER BY t.created_at
  LIMIT 1;
$function$;

ALTER FUNCTION public.p2a_fixture_any_non_private_tenant() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_any_non_private_tenant()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_any_non_private_tenant() TO authenticated;

-- The pre-existing cross-context authority for the fixture's "already an admin
-- elsewhere" organizer (auth user ...011): the seeded ordinary tenant/event,
-- the canonical Person, the admin_users id, and whether the seeded Event/Tenant
-- Admin authority actually resolves.
CREATE OR REPLACE FUNCTION public.p2a_fixture_other_context()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'auth_user_id', '92400000-0000-4000-8000-000000000011',
    'person_id', (
      SELECT paa.person_id FROM public.person_auth_accounts paa
      WHERE paa.auth_user_id = '92400000-0000-4000-8000-000000000011'
        AND paa.status = 'active' AND paa.is_primary = true
    ),
    'admin_user_id', (
      SELECT au.id FROM public.admin_users au
      WHERE au.user_id = '92400000-0000-4000-8000-000000000011' AND au.is_active = true
    ),
    'other_tenant_id', (
      SELECT t.id FROM public.tenants t WHERE t.organization_code = 'p2a-fixture-other'
    ),
    'other_event_id', (
      SELECT e.id FROM public.events e WHERE e.name = 'P2A Fixture Other-Tenant Event'
    ),
    'event_admin_ok', public.has_event_admin_authority(
      '92400000-0000-4000-8000-000000000011',
      (SELECT e.id FROM public.events e WHERE e.name = 'P2A Fixture Other-Tenant Event')
    ),
    'tenant_admin_ok', public.has_tenant_admin_authority(
      '92400000-0000-4000-8000-000000000011',
      (SELECT t.id FROM public.tenants t WHERE t.organization_code = 'p2a-fixture-other')
    )
  );
$function$;

ALTER FUNCTION public.p2a_fixture_other_context() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_other_context()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_other_context() TO authenticated;

-- Exactly the seeded cross-context authority rows, all still present + active
-- and unchanged (no revocation, no new row).
CREATE OR REPLACE FUNCTION public.p2a_fixture_other_authority_intact(
  p_admin_user_id uuid, p_other_tenant_id uuid, p_other_event_id uuid, p_person_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT
    (SELECT count(*) FROM public.admin_users au
       WHERE au.id = p_admin_user_id AND au.is_active = true) = 1
  AND (SELECT count(*) FROM public.admin_event_access aea
       WHERE aea.admin_user_id = p_admin_user_id AND aea.event_id = p_other_event_id) = 1
  AND (SELECT count(*) FROM public.admin_tenant_access ata
       WHERE ata.admin_user_id = p_admin_user_id AND ata.tenant_id = p_other_tenant_id
         AND ata.is_active = true) = 1
  AND (SELECT count(*) FROM public.person_tenant_administrator_appointments ptaa
       WHERE ptaa.person_id = p_person_id AND ptaa.tenant_id = p_other_tenant_id
         AND ptaa.is_active = true) = 1;
$function$;

ALTER FUNCTION public.p2a_fixture_other_authority_intact(uuid, uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_other_authority_intact(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_other_authority_intact(uuid, uuid, uuid, uuid) TO authenticated;

-- The created draft's appointment is Person-scoped: person_id resolves to a
-- live canonical Person (active, not merged) that is linked active-primary to
-- the same auth account.  A canonical Person is tenant-independent, so there
-- is nothing "tenant" to assert on public.people itself.  Authority checks
-- here are scoped to THIS private-draft tenant/event ONLY: the self-service
-- flow created no admin_tenant_access / admin_event_access /
-- person_tenant_administrator_appointment for it, and the organizer Person is
-- not an active Tenant Administrator of it.  "No new admin_users" is a global
-- fact and is proved with before/after counts by the caller, NOT here --
-- admin_users is not tenant-scoped and a canonical Person may legitimately
-- already hold an admin_users row (Event Admin / Tenant Admin in some OTHER
-- tenant).  The private tenant/event stay scoped only through the organizer
-- appointment + the event->tenant ownership relationship.
CREATE OR REPLACE FUNCTION public.p2a_fixture_created_integrity(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor_auth_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.is_active = true
      AND t.is_self_service_private_draft = true
  )
  AND EXISTS (
    SELECT 1
    FROM public.self_service_organizer_appointments oa
    JOIN public.person_auth_accounts paa
      ON paa.person_id = oa.person_id
     AND paa.auth_user_id = p_actor_auth_user_id
     AND paa.status = 'active'
     AND paa.is_primary = true
    JOIN public.people p
      ON p.id = oa.person_id
     AND p.status = 'active'
     AND p.merged_into_person_id IS NULL
    WHERE oa.id = p_appointment_id
      AND oa.auth_user_id = p_actor_auth_user_id
      AND oa.tenant_id = p_tenant_id
      AND oa.is_active = true
      -- the private draft event is owned by this same private tenant
      AND EXISTS (
        SELECT 1
        FROM public.self_service_private_event_drafts d
        JOIN public.events e ON e.id = d.event_id
        WHERE d.organizer_appointment_id = oa.id
          AND d.tenant_id = oa.tenant_id
          AND e.tenant_id = oa.tenant_id
      )
  )
  AND NOT EXISTS (SELECT 1 FROM public.admin_tenant_access ata WHERE ata.tenant_id = p_tenant_id)
  AND NOT EXISTS (SELECT 1 FROM public.admin_event_access aea JOIN public.events e ON e.id = aea.event_id WHERE e.tenant_id = p_tenant_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.person_tenant_administrator_appointments ptaa
    WHERE ptaa.tenant_id = p_tenant_id
  )
  -- the organizer Person has NO active Tenant Administrator appointment for
  -- THIS private-draft tenant.  A legitimate Tenant Admin appointment the same
  -- canonical Person may hold in any OTHER tenant is not prohibited.
  AND NOT EXISTS (
    SELECT 1
    FROM public.self_service_organizer_appointments oa2
    JOIN public.person_tenant_administrator_appointments ptaa2
      ON ptaa2.person_id = oa2.person_id
     AND ptaa2.tenant_id = p_tenant_id
     AND ptaa2.is_active = true
    WHERE oa2.id = p_appointment_id
  );
$function$;

ALTER FUNCTION public.p2a_fixture_created_integrity(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_created_integrity(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_created_integrity(uuid, uuid, uuid)
  TO authenticated;

-- Fixture identity resolution helpers (read-only; SECURITY DEFINER so the
-- authenticated role can inspect the private identity tables through them).
CREATE OR REPLACE FUNCTION public.p2a_fixture_person_for_auth(p_auth_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT paa.person_id
  FROM public.person_auth_accounts paa
  WHERE paa.auth_user_id = p_auth_user_id
    AND paa.status = 'active'
    AND paa.is_primary = true;
$function$;

ALTER FUNCTION public.p2a_fixture_person_for_auth(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_person_for_auth(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_person_for_auth(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2a_fixture_last_organizer_audit_outcome(p_auth_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT pra.outcome
  FROM public.person_resolution_audit pra
  WHERE pra.auth_user_id = p_auth_user_id
    AND pra.request_context = 'organizer_self_service_signup'
  ORDER BY pra.created_at DESC, pra.id DESC
  LIMIT 1;
$function$;

ALTER FUNCTION public.p2a_fixture_last_organizer_audit_outcome(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2a_fixture_last_organizer_audit_outcome(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2a_fixture_last_organizer_audit_outcome(uuid) TO authenticated;

-- Direct RLS reads (part C): the P-2A migration narrows the tenants Platform
-- recovery policy and the events authenticated SELECT/UPDATE policies.  Give
-- authenticated the pre-history table grants those policies gate, so the
-- exclusion is actually exercised by the fixture.  Fixture-scoped; rolled back.
GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT, UPDATE ON public.events TO authenticated;

DO $fixture$
DECLARE
  v_mary_person_id uuid;
  v_prior_person_id uuid;
  v_invalid_person_id uuid;
  v_disputed_person_id uuid;
  v_role_evidence_person_id uuid;
  v_role_evidence_attendee_id uuid;
  v_control_tenant_id uuid;
  v_control_event_id uuid;
  v_household_attendee_id uuid;
  v_cross_person_id uuid;
  v_cross_admin_user_id uuid;
  v_other_tenant_id uuid;
  v_other_event_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      '92400000-0000-4000-8000-000000000001',
      '92400000-0000-4000-8000-000000000002',
      '92400000-0000-4000-8000-000000000003',
      '92400000-0000-4000-8000-000000000004',
      '92400000-0000-4000-8000-000000000005',
      '92400000-0000-4000-8000-000000000006',
      '92400000-0000-4000-8000-000000000007',
      '92400000-0000-4000-8000-000000000008',
      '92400000-0000-4000-8000-000000000009',
      '92400000-0000-4000-8000-000000000010',
      '92400000-0000-4000-8000-000000000011'
    )
  ) THEN
    RAISE EXCEPTION 'P-2A fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92400000-0000-4000-8000-000000000001', 'p2a-new-organizer@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000002', 'p2a-unverified@fixture.invalid', NULL),
    ('92400000-0000-4000-8000-000000000003', 'p2a-outsider@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000004', 'p2a-platform-admin@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000005', 'p2a-mary-linked@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000006', 'p2a-possible-prior@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000007', 'p2a-invalid-link@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000008', 'p2a-disputed@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000009', 'p2a-role-evidence@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000010', 'p2a-household-evidence@fixture.invalid', now()),
    ('92400000-0000-4000-8000-000000000011', 'p2a-cross-context-admin@fixture.invalid', now());

  -- Active Platform Administrator, used below to prove the ordinary Tenant
  -- Administration workflow neither lists nor mutates a P-2A private draft.
  INSERT INTO public.admin_users (email, display_name, user_id, is_active, privilege_group)
  VALUES ('p2a-platform-admin@fixture.invalid', 'P2A Fixture Platform Admin',
          '92400000-0000-4000-8000-000000000004', true, 'super_admin');

  -- Cross-context organizer (...011): a canonical Person who ALREADY holds
  -- legitimate, explicit Event Admin + Tenant Admin authority in a distinct
  -- ordinary (non-private) tenant/event.  This Person must still be able to
  -- create a separate self-service private draft, and none of this authority
  -- may leak into that private draft or be altered by it.
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p2a-fixture-other', 'p2a-fixture-other', 'P2A Fixture Other Org',
          'P2A Fixture Other Org', 'P2A Fixture Other Org')
  RETURNING id INTO v_other_tenant_id;
  INSERT INTO public.events (tenant_id, name)
  VALUES (v_other_tenant_id, 'P2A Fixture Other-Tenant Event')
  RETURNING id INTO v_other_event_id;

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_cross_person_id;
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (v_cross_person_id, '92400000-0000-4000-8000-000000000011', 'active', true, now());

  INSERT INTO public.admin_users (email, display_name, user_id, is_active, privilege_group)
  VALUES ('p2a-cross-context-admin@fixture.invalid', 'P2A Fixture Cross-Context Admin',
          '92400000-0000-4000-8000-000000000011', true, 'event_admin')
  RETURNING id INTO v_cross_admin_user_id;

  -- explicit Event Admin in the other tenant
  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_cross_admin_user_id, v_other_event_id, 'event_admin');
  -- explicit Tenant Admin in the other tenant (both substrates)
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  VALUES (v_cross_admin_user_id, v_other_tenant_id, true);
  INSERT INTO public.person_tenant_administrator_appointments (person_id, tenant_id)
  VALUES (v_cross_person_id, v_other_tenant_id);

  -- Mary: an already-activated canonical Person with an active-primary
  -- account link.  The command must reuse this exact person_id.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_mary_person_id;
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (v_mary_person_id, '92400000-0000-4000-8000-000000000005', 'active', true, now());

  -- Possible prior identity: an active Person carrying the organizer's
  -- verified email as a CURRENT identifier, but NO account link yet.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_prior_person_id;
  INSERT INTO public.person_identifiers (
    person_id, identifier_type, identifier_value, normalized_value,
    source_type, verification_status, is_current
  ) VALUES (
    v_prior_person_id, 'email', 'p2a-possible-prior@fixture.invalid',
    'p2a-possible-prior@fixture.invalid', 'member_confirmation', 'user_confirmed', true
  );

  -- Invalid/ambiguous account link: exactly one account row, but its Person
  -- is not active -> resolve_auth_person_link returns invalid_or_ambiguous.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_invalid_person_id;
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (v_invalid_person_id, '92400000-0000-4000-8000-000000000007', 'active', true, now());
  UPDATE public.people SET status = 'inactive' WHERE id = v_invalid_person_id;

  -- Disputed evidence: the verified email is a DISPUTED identifier.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_disputed_person_id;
  INSERT INTO public.person_identifiers (
    person_id, identifier_type, identifier_value, normalized_value,
    source_type, verification_status, is_current
  ) VALUES (
    v_disputed_person_id, 'email', 'p2a-disputed@fixture.invalid',
    'p2a-disputed@fixture.invalid', 'administrator', 'disputed', true
  );

  -- Part C control: one ordinary non-private event that a Platform Admin must
  -- still be able to read/enumerate directly after the RLS narrowing.
  SELECT id INTO v_control_tenant_id
  FROM public.tenants
  WHERE is_self_service_private_draft = false
  ORDER BY created_at
  LIMIT 1;
  INSERT INTO public.events (tenant_id, name)
  VALUES (v_control_tenant_id, 'P2A Fixture Control Event')
  RETURNING id INTO v_control_event_id;

  -- Blocker A: established ROLE evidence, NO person_identifiers row.  A Person
  -- with a PILOT role instance whose attendee carries the organizer's verified
  -- email.  A matcher that only checked person_identifiers would miss this and
  -- wrongly create a duplicate Person.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_role_evidence_person_id;
  INSERT INTO public.attendees (event_id, email, pilot_first, pilot_last)
  VALUES (v_control_event_id, 'p2a-role-evidence@fixture.invalid', 'Role', 'Evidence')
  RETURNING id INTO v_role_evidence_attendee_id;
  INSERT INTO public.person_role_instances (
    person_id, identity_role, attribution_method, evidence_source,
    attendee_id, household_member_id, source_table, source_record_id,
    source_role_instance_key, event_id
  ) VALUES (
    v_role_evidence_person_id, 'PILOT', 'automatic_backfill', 'fixture',
    v_role_evidence_attendee_id, NULL, 'public.attendees', v_role_evidence_attendee_id,
    'attendee_pilot:' || v_role_evidence_attendee_id::text, v_control_event_id
  );

  -- Blocker A: unresolved HOUSEHOLD-MEMBER evidence -- a household member row
  -- (no role instance) carrying the organizer's verified email.
  INSERT INTO public.attendees (event_id, email, pilot_first, pilot_last)
  VALUES (v_control_event_id, 'p2a-household-host@fixture.invalid', 'Household', 'Host')
  RETURNING id INTO v_household_attendee_id;
  INSERT INTO public.attendee_household_members (
    attendee_id, event_id, person_role, first_name, last_name, email
  ) VALUES (
    v_household_attendee_id, v_control_event_id, 'additional',
    'Household', 'Guest', 'p2a-household-evidence@fixture.invalid'
  );
END;
$fixture$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_created record;
  v_retry record;
  v_counts_before jsonb;
  v_counts_after jsonb;
  v_mary record;
  v_uncertain record;
  v_uncertain_retry record;
  v_cross record;
  v_other jsonb;
  v_expected_mary_person uuid;
  v_prior_person_id uuid;
  v_failed boolean;
BEGIN
  v_counts_before := public.p2a_fixture_counts();

  -- Anonymous and unverified callers fail without a partial Tenant, Event,
  -- appointment, Person, or command audit row.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_draft(
      'P2A Anonymous Organization', 'P2A Anonymous Event', current_date + 2,
      'UTC', '92500000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Self-service draft creation requires an authenticated verified account.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'anonymous caller is denied');

  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_draft(
      'P2A Unverified Organization', 'P2A Unverified Event', current_date + 2,
      'UTC', '92500000-0000-4000-8000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Self-service draft creation requires a verified account email.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'unverified account is denied');
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_counts() = v_counts_before,
    'denials leave no partial Tenant, Event, or Person'
  );

  -- ---- P-2B: genuinely new organizer, no prior identity evidence ----------
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_created
  FROM public.create_self_service_organizer_draft(
    '  P2A Fixture Organization  ',
    '  P2A Fixture Event  ',
    current_date + 3,
    'UTC',
    '92500000-0000-4000-8000-000000000003',
    current_date + 1,
    'location',
    '  P2A Fixture Venue  ',
    'casual'
  );

  PERFORM public.p2a_fixture_assert(
    v_created.outcome = 'created'
    AND v_created.tenant_id IS NOT NULL
    AND v_created.organizer_appointment_id IS NOT NULL
    AND v_created.organizer_person_id IS NOT NULL
    AND v_created.event_id IS NOT NULL
    AND v_created.organization_name = 'P2A Fixture Organization'
    AND v_created.event_name = 'P2A Fixture Event'
    AND v_created.status = 'Draft'
    AND v_created.is_active = false
    AND v_created.visible_to_members = false,
    'new verified Organizer receives exactly one hidden Draft plus a canonical Person'
  );

  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint + 1
    AND (v_counts_after->>'person_auth_accounts')::bigint = (v_counts_before->>'person_auth_accounts')::bigint + 1
    AND (v_counts_after->>'organizer_person_resolution_audit')::bigint = (v_counts_before->>'organizer_person_resolution_audit')::bigint + 1
    -- no new global admin authority of any kind is created by the flow
    AND (v_counts_after->>'admin_users')::bigint = (v_counts_before->>'admin_users')::bigint
    AND (v_counts_after->>'admin_tenant_access')::bigint = (v_counts_before->>'admin_tenant_access')::bigint
    AND (v_counts_after->>'admin_event_access')::bigint = (v_counts_before->>'admin_event_access')::bigint
    AND (v_counts_after->>'person_tenant_administrator_appointments')::bigint = (v_counts_before->>'person_tenant_administrator_appointments')::bigint,
    'exactly one Person + one account link + one resolution audit; zero new admin authority'
  );
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_last_organizer_audit_outcome('92400000-0000-4000-8000-000000000001') = 'created_new',
    'the created_new / no-prior-evidence outcome is audited'
  );
  PERFORM public.p2a_fixture_assert(
    v_created.organizer_person_id = public.p2a_fixture_person_for_auth('92400000-0000-4000-8000-000000000001'),
    'the appointment records the newly created Person'
  );
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_created_integrity(
      v_created.tenant_id,
      v_created.organizer_appointment_id,
      '92400000-0000-4000-8000-000000000001'
    ),
    'the new Organizer gains a Person-scoped appointment and no admin authority'
  );

  -- ---- P-2B: identical retry -- idempotent, does not cross Person -------
  SELECT * INTO v_retry
  FROM public.create_self_service_organizer_draft(
    'P2A Fixture Organization', 'P2A Fixture Event', current_date + 3,
    'UTC', '92500000-0000-4000-8000-000000000003', current_date + 1,
    'location', 'P2A Fixture Venue', 'casual'
  );
  PERFORM public.p2a_fixture_assert(
    v_retry.outcome = 'created'
    AND v_retry.event_id = v_created.event_id
    AND v_retry.organizer_person_id = v_created.organizer_person_id
    AND (public.p2a_fixture_counts()->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint + 1
    AND (public.p2a_fixture_counts()->>'events')::bigint = (v_counts_before->>'events')::bigint + 1
    AND (public.p2a_fixture_counts()->>'people')::bigint = (v_counts_before->>'people')::bigint + 1,
    'identical retry returns the original outcome, same Person, no duplicate Person'
  );

  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_draft(
      'P2A Fixture Organization', 'Changed Event', current_date + 3,
      'UTC', '92500000-0000-4000-8000-000000000003', current_date + 1,
      'location', 'P2A Fixture Venue', 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Idempotency key was already used with different draft input.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'reused idempotency key with changed input fails closed');

  -- ---- P-2B: already-linked Mary reuses her existing canonical Person ----
  v_counts_before := public.p2a_fixture_counts();
  v_expected_mary_person := public.p2a_fixture_person_for_auth('92400000-0000-4000-8000-000000000005');
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000005', true);
  SELECT * INTO v_mary
  FROM public.create_self_service_organizer_draft(
    'Mary Returning Org', 'Mary Second Event', current_date + 5,
    'UTC', '92500000-0000-4000-8000-000000000005'
  );
  PERFORM public.p2a_fixture_assert(
    v_mary.outcome = 'created'
    AND v_mary.organizer_person_id = v_expected_mary_person,
    'a linked organizer reuses her existing canonical Person UUID'
  );
  PERFORM public.p2a_fixture_assert(
    (public.p2a_fixture_counts()->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (public.p2a_fixture_counts()->>'person_auth_accounts')::bigint = (v_counts_before->>'person_auth_accounts')::bigint
    AND (public.p2a_fixture_counts()->>'organizer_person_resolution_audit')::bigint = (v_counts_before->>'organizer_person_resolution_audit')::bigint,
    'the linked-organizer path creates no new Person, account link, or resolution-audit row'
  );

  -- ==== Cross-context: a canonical Person who is ALREADY an admin elsewhere ==
  -- ...011 already holds an active admin_users record and explicit Event Admin
  -- + Tenant Admin authority in an ordinary (non-private) tenant/event.  She
  -- must still be able to create a separate private personal event, that
  -- pre-existing authority must not leak into it, and nothing about it may
  -- change the pre-existing authority.
  v_other := public.p2a_fixture_other_context();
  PERFORM public.p2a_fixture_assert(
    (v_other->>'person_id') IS NOT NULL
    AND (v_other->>'admin_user_id') IS NOT NULL
    AND (v_other->>'event_admin_ok')::boolean = true
    AND (v_other->>'tenant_admin_ok')::boolean = true,
    'the cross-context organizer genuinely holds pre-existing Event + Tenant Admin authority elsewhere'
  );

  v_counts_before := public.p2a_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000011', true);
  SELECT * INTO v_cross
  FROM public.create_self_service_organizer_draft(
    'Sofia Personal Org', 'Sofia Birthday Dinner', current_date + 9,
    'UTC', '92599000-0000-4000-8000-000000000011', current_date + 9,
    'location', 'Sofia''s house', 'birthday_family'
  );
  v_counts_after := public.p2a_fixture_counts();

  -- 1 + 2: command succeeds, reuses the existing canonical Person, and creates
  -- exactly one private tenant + appointment + draft event (and nothing else).
  PERFORM public.p2a_fixture_assert(
    v_cross.outcome = 'created'
    AND v_cross.organizer_person_id = (v_other->>'person_id')::uuid
    AND v_cross.organizer_person_id = public.p2a_fixture_person_for_auth('92400000-0000-4000-8000-000000000011')
    AND v_cross.status = 'Draft'
    AND v_cross.is_active = false
    AND v_cross.visible_to_members = false,
    'a Person who is already an admin elsewhere creates the private draft, reusing her canonical UUID'
  );
  PERFORM public.p2a_fixture_assert(
    (v_counts_after->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint + 1
    AND (v_counts_after->>'events')::bigint = (v_counts_before->>'events')::bigint + 1
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (v_counts_after->>'person_auth_accounts')::bigint = (v_counts_before->>'person_auth_accounts')::bigint,
    'exactly one private tenant + draft event; no new Person or account link'
  );

  -- 3: no admin authority fact for the private-draft tenant/event, and no new
  -- global admin authority row of any kind.
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_created_integrity(
      v_cross.tenant_id, v_cross.organizer_appointment_id,
      '92400000-0000-4000-8000-000000000011'
    ),
    'the private draft has a Person-scoped appointment and no admin authority scoped to it'
  );
  PERFORM public.p2a_fixture_assert(
    (v_counts_after->>'admin_users')::bigint = (v_counts_before->>'admin_users')::bigint
    AND (v_counts_after->>'admin_tenant_access')::bigint = (v_counts_before->>'admin_tenant_access')::bigint
    AND (v_counts_after->>'admin_event_access')::bigint = (v_counts_before->>'admin_event_access')::bigint
    AND (v_counts_after->>'person_tenant_administrator_appointments')::bigint = (v_counts_before->>'person_tenant_administrator_appointments')::bigint,
    'the self-service flow creates NO new admin_users / admin_tenant_access / admin_event_access / ptaa row'
  );

  -- 4: the pre-existing authority in the other tenant/event is byte-for-byte
  -- unchanged and still resolves.
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_other_authority_intact(
      (v_other->>'admin_user_id')::uuid,
      (v_other->>'other_tenant_id')::uuid,
      (v_other->>'other_event_id')::uuid,
      (v_other->>'person_id')::uuid
    )
    AND (public.p2a_fixture_other_context()->>'event_admin_ok')::boolean = true
    AND (public.p2a_fixture_other_context()->>'tenant_admin_ok')::boolean = true,
    'the organizer keeps her pre-existing Event + Tenant Admin authority in the other tenant, unchanged'
  );

  -- 5 + 6: the private draft is invisible/unwritable to this same organizer's
  -- ordinary admin context -- her pre-existing authority does not reach it.
  PERFORM public.p2a_fixture_assert(
    public.has_event_admin_authority('92400000-0000-4000-8000-000000000011', v_cross.event_id) = false
    AND public.has_tenant_admin_authority('92400000-0000-4000-8000-000000000011', v_cross.tenant_id) = false,
    'the pre-existing authority does NOT make the organizer an admin of her own private draft'
  );
  v_failed := false;
  BEGIN
    PERFORM public.list_tenants_for_administration();
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'a non-platform admin cannot use the ordinary tenant-administration RPCs at all');
  PERFORM public.p2a_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_cross.tenant_id)
    AND NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_cross.event_id)
    -- but her legitimate other-tenant reads still work
    AND EXISTS (SELECT 1 FROM public.events WHERE id = (v_other->>'other_event_id')::uuid),
    'the private draft is invisible to the organizer''s direct RLS reads, while her other-tenant event stays readable'
  );

  -- and to a real Platform Admin, this private draft is excluded from the
  -- ordinary tenant-administration RPCs exactly like every other private draft.
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000004', true);
  PERFORM public.p2a_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.list_tenants_for_administration() AS t WHERE t.id = v_cross.tenant_id
    ),
    'the cross-context organizer''s private draft is also omitted from the Platform Admin tenant list'
  );
  v_failed := false;
  BEGIN
    PERFORM public.get_tenant_for_administration(v_cross.tenant_id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'and rejected by tenant detail with the non-disclosing message');

  -- ---- P-2B: one possible prior identity -----------------------------------
  -- Returns 'identity_confirmation_required' as a ROW (not an error), writes
  -- exactly one durable resolution-audit row, and creates zero downstream
  -- facts (tenant / event / people / account link).
  v_counts_before := public.p2a_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000006', true);
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_draft(
    'Prior Match Org', 'Prior Match Event', current_date + 4,
    'UTC', '92500000-0000-4000-8000-000000000006'
  );
  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    v_uncertain.outcome = 'identity_confirmation_required'
    AND v_uncertain.tenant_id IS NULL
    AND v_uncertain.organizer_appointment_id IS NULL
    AND v_uncertain.organizer_person_id IS NULL
    AND v_uncertain.event_id IS NULL
    AND v_uncertain.organization_name IS NULL,
    'a possible prior identity returns identity_confirmation_required and no draft data'
  );
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_last_organizer_audit_outcome('92400000-0000-4000-8000-000000000006') = 'needs_confirmation'
    AND (v_counts_after->>'organizer_person_resolution_audit')::bigint
        = (v_counts_before->>'organizer_person_resolution_audit')::bigint + 1
    AND (v_counts_after->>'safe_outcome_ledger')::bigint
        = (v_counts_before->>'safe_outcome_ledger')::bigint + 1,
    'a possible prior identity persists one resolution-audit row and one safe-outcome ledger row'
  );
  PERFORM public.p2a_fixture_assert(
    (v_counts_after->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint
    AND (v_counts_after->>'events')::bigint = (v_counts_before->>'events')::bigint
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (v_counts_after->>'person_auth_accounts')::bigint = (v_counts_before->>'person_auth_accounts')::bigint,
    'a possible prior identity creates zero downstream facts'
  );

  -- ---- P-2B: invalid/ambiguous account link --------------------------------
  v_counts_before := public.p2a_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000007', true);
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_draft(
    'Invalid Link Org', 'Invalid Link Event', current_date + 4,
    'UTC', '92500000-0000-4000-8000-000000000007'
  );
  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    v_uncertain.outcome = 'identity_review_required' AND v_uncertain.tenant_id IS NULL,
    'an invalid/ambiguous account link returns identity_review_required and no draft data'
  );
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_last_organizer_audit_outcome('92400000-0000-4000-8000-000000000007') = 'invalid_existing_link'
    AND (v_counts_after->>'organizer_person_resolution_audit')::bigint
        = (v_counts_before->>'organizer_person_resolution_audit')::bigint + 1,
    'an invalid/ambiguous account link persists exactly one durable resolution-audit row'
  );
  PERFORM public.p2a_fixture_assert(
    (v_counts_after->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint
    AND (v_counts_after->>'events')::bigint = (v_counts_before->>'events')::bigint
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (v_counts_after->>'person_auth_accounts')::bigint = (v_counts_before->>'person_auth_accounts')::bigint,
    'an invalid/ambiguous account link creates zero downstream facts'
  );

  -- ---- P-2B: disputed identifier evidence ---------------------------------
  v_counts_before := public.p2a_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000008', true);
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_draft(
    'Disputed Org', 'Disputed Event', current_date + 4,
    'UTC', '92500000-0000-4000-8000-000000000008'
  );
  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    v_uncertain.outcome = 'identity_review_required' AND v_uncertain.tenant_id IS NULL,
    'disputed identifier evidence returns identity_review_required and no draft data'
  );
  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_last_organizer_audit_outcome('92400000-0000-4000-8000-000000000008') = 'ambiguous'
    AND (v_counts_after->>'organizer_person_resolution_audit')::bigint
        = (v_counts_before->>'organizer_person_resolution_audit')::bigint + 1,
    'disputed identifier evidence persists exactly one durable resolution-audit row'
  );
  PERFORM public.p2a_fixture_assert(
    (v_counts_after->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint
    AND (v_counts_after->>'events')::bigint = (v_counts_before->>'events')::bigint
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (v_counts_after->>'person_auth_accounts')::bigint = (v_counts_before->>'person_auth_accounts')::bigint,
    'disputed identifier evidence creates zero downstream facts'
  );

  -- ==== A: established role / household evidence is NOT zero evidence =======
  -- Role instance evidence (no person_identifiers row) still halts creation.
  v_counts_before := public.p2a_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000009', true);
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_draft(
    'Role Evidence Org', 'Role Evidence Event', current_date + 4,
    'UTC', '92500000-0000-4000-8000-000000000009'
  );
  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    v_uncertain.outcome = 'identity_confirmation_required'
    AND v_uncertain.organizer_person_id IS NULL
    AND public.p2a_fixture_last_organizer_audit_outcome('92400000-0000-4000-8000-000000000009') = 'needs_confirmation'
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (v_counts_after->>'person_auth_accounts')::bigint = (v_counts_before->>'person_auth_accounts')::bigint
    AND (v_counts_after->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint
    AND (v_counts_after->>'events')::bigint = (v_counts_before->>'events')::bigint,
    'a matching role-instance record is possible prior identity, not a duplicate Person'
  );

  -- Unresolved household-member evidence still halts creation.
  v_counts_before := public.p2a_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000010', true);
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_draft(
    'Household Evidence Org', 'Household Evidence Event', current_date + 4,
    'UTC', '92500000-0000-4000-8000-000000000010'
  );
  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    v_uncertain.outcome = 'identity_confirmation_required'
    AND public.p2a_fixture_last_organizer_audit_outcome('92400000-0000-4000-8000-000000000010') = 'needs_confirmation'
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (v_counts_after->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint,
    'a matching household-member record is possible prior identity, not a duplicate Person'
  );

  -- ==== B: an uncertain safe outcome is bound to (actor, key, fingerprint) ==
  -- Retry with the SAME key + SAME input replays the frozen outcome without a
  -- second resolution audit or ledger row.
  v_counts_before := public.p2a_fixture_counts();
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000006', true);
  SELECT * INTO v_uncertain_retry
  FROM public.create_self_service_organizer_draft(
    'Prior Match Org', 'Prior Match Event', current_date + 4,
    'UTC', '92500000-0000-4000-8000-000000000006'
  );
  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    v_uncertain_retry.outcome = 'identity_confirmation_required'
    AND (v_counts_after->>'organizer_person_resolution_audit')::bigint
        = (v_counts_before->>'organizer_person_resolution_audit')::bigint
    AND (v_counts_after->>'safe_outcome_ledger')::bigint
        = (v_counts_before->>'safe_outcome_ledger')::bigint
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint,
    'same key + same input replays the safe outcome with no second audit / ledger / Person'
  );

  -- Retry with the SAME key + CHANGED input still conflicts.
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_draft(
      'Prior Match Org CHANGED', 'Prior Match Event', current_date + 4,
      'UTC', '92500000-0000-4000-8000-000000000006'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Idempotency key was already used with different draft input.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'same key + changed input conflicts, even for a safe outcome');

  -- After external identity verification, a deliberate NEW attempt with a
  -- FRESH key creates the draft exactly once -- reusing the now-linked Person.
  v_prior_person_id := public.p2a_fixture_person_by_identifier('p2a-possible-prior@fixture.invalid');
  PERFORM public.p2a_fixture_link_account(v_prior_person_id, '92400000-0000-4000-8000-000000000006');
  v_counts_before := public.p2a_fixture_counts();
  SELECT * INTO v_uncertain
  FROM public.create_self_service_organizer_draft(
    'Prior Match Org', 'Prior Match Event', current_date + 4,
    'UTC', '92599000-0000-4000-8000-000000000006'
  );
  v_counts_after := public.p2a_fixture_counts();
  PERFORM public.p2a_fixture_assert(
    v_uncertain.outcome = 'created'
    AND v_uncertain.organizer_person_id = v_prior_person_id
    AND (v_counts_after->>'people')::bigint = (v_counts_before->>'people')::bigint
    AND (v_counts_after->>'tenants')::bigint = (v_counts_before->>'tenants')::bigint + 1
    AND (v_counts_after->>'events')::bigint = (v_counts_before->>'events')::bigint + 1,
    'a fresh key after verification creates the draft once, reusing the existing Person'
  );

  -- ==== C: ordinary Platform Admin direct RLS reads exclude private drafts ==
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000004', true);
  PERFORM public.p2a_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_created.tenant_id)
    AND EXISTS (SELECT 1 FROM public.tenants WHERE is_self_service_private_draft = false),
    'Platform Admin authenticated direct SELECT on tenants omits the private draft, keeps normal tenants'
  );
  PERFORM public.p2a_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_created.event_id)
    AND NOT EXISTS (SELECT 1 FROM public.events WHERE tenant_id = v_created.tenant_id)
    AND EXISTS (SELECT 1 FROM public.events WHERE name = 'P2A Fixture Control Event'),
    'Platform Admin authenticated direct SELECT/enumerate on events omits the private draft event, keeps normal events'
  );
  -- and a raw UPDATE to flip the private draft visible is refused too
  PERFORM public.p2a_fixture_assert(
    (WITH u AS (
       UPDATE public.events SET visible_to_members = true
       WHERE id = v_created.event_id
       RETURNING 1
     ) SELECT count(*) FROM u) = 0,
    'Platform Admin authenticated raw UPDATE cannot reach the private draft event'
  );

  -- ---- P-2A: browser roles cannot raw-write, cross-account reads denied --
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000001', true);
  v_failed := false;
  BEGIN
    INSERT INTO public.self_service_organizer_appointments (person_id, auth_user_id, tenant_id)
    VALUES (v_created.organizer_person_id, '92400000-0000-4000-8000-000000000001', v_created.tenant_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'authenticated browser role has no raw Organizer appointment write');

  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000003', true);
  PERFORM public.p2a_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.get_my_self_service_private_draft(v_created.event_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.list_my_self_service_private_drafts()
    ),
    'Organizer read RPCs are self-scoped and deny another verified account'
  );

  -- The ordinary existing Platform Tenant Administration workflow neither
  -- lists, details, enumerates the Events of, nor mutates a P-2A private
  -- self-service organization -- while still returning existing non-private
  -- Tenants unchanged.
  PERFORM set_config('request.jwt.claim.sub', '92400000-0000-4000-8000-000000000004', true);

  PERFORM public.p2a_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.list_tenants_for_administration() AS t
      WHERE t.id = v_created.tenant_id
    ),
    'ordinary Platform Admin tenant list omits the private self-service Tenant'
  );
  PERFORM public.p2a_fixture_assert(
    (SELECT count(*) FROM public.list_tenants_for_administration()) > 0,
    'ordinary Platform Admin tenant list still returns existing non-private Tenants'
  );

  v_failed := false;
  BEGIN
    PERFORM public.get_tenant_for_administration(v_created.tenant_id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'ordinary Platform Admin tenant detail rejects the private self-service Tenant');

  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_owned_events_for_administration(v_created.tenant_id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'ordinary Platform Admin owned-Event list rejects the private self-service Tenant');

  v_failed := false;
  BEGIN
    PERFORM public.set_tenant_active_status(v_created.tenant_id, false, 'fixture');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'ordinary Platform Admin active-status update rejects the private self-service Tenant');

  v_failed := false;
  BEGIN
    PERFORM public.update_tenant_metadata_for_administration(
      v_created.tenant_id, '{"display_name": "Renamed By Admin"}'::jsonb, 'fixture'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'ordinary Platform Admin metadata update rejects the private self-service Tenant');

  -- The remaining tenant-id-scoped administration reads also fail closed with
  -- the same non-disclosing "Tenant not found." -- identical to a missing id.
  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_hostname_mappings_for_administration(v_created.tenant_id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'Platform Admin hostname-mapping list rejects the private self-service Tenant');

  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_admin_assignments_for_administration(v_created.tenant_id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'Platform Admin admin-assignment list rejects the private self-service Tenant');

  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_administration_audit(v_created.tenant_id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'Platform Admin administration-audit list rejects the private self-service Tenant');

  -- Non-enumerating: a genuinely-random tenant id raises the identical message.
  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_hostname_mappings_for_administration(
      '99999999-0000-4000-8000-000000009999'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.p2a_fixture_assert(v_failed, 'a missing tenant id and a private-draft id are indistinguishable');

  -- Ordinary non-private tenant: these reads still behave normally (they must
  -- NOT raise "Tenant not found.").
  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_hostname_mappings_for_administration(public.p2a_fixture_any_non_private_tenant());
    PERFORM public.list_tenant_admin_assignments_for_administration(public.p2a_fixture_any_non_private_tenant());
    PERFORM public.list_tenant_administration_audit(public.p2a_fixture_any_non_private_tenant());
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  PERFORM public.p2a_fixture_assert(NOT v_failed, 'the three admin reads keep normal behavior for an ordinary non-private Tenant');

  PERFORM public.p2a_fixture_assert(
    public.p2a_fixture_private_draft_intact(v_created.tenant_id, v_created.event_id),
    'the private self-service Tenant + draft Event are untouched by the rejected ordinary admin surfaces'
  );
END;
$fixture$;

ROLLBACK;
