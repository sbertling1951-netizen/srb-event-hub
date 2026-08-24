-- Tenant T8 linked integration and rollback proof.
--
-- Installs the exact pending appointment definitions inside one outer
-- transaction, exercises isolated canonical identity and authority fixtures,
-- and rolls back definitions, temporary helpers, triggers, and rows together.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE TABLE public.person_tenant_administrator_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  appointment_basis text NOT NULL DEFAULT 'platform_appointment'
    CHECK (appointment_basis = 'platform_appointment'),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT person_tenant_administrator_appointments_unique
    UNIQUE (person_id, tenant_id),
  CONSTRAINT person_tenant_administrator_appointments_lifecycle_check CHECK (
    (is_active = true AND revoked_at IS NULL)
    OR (is_active = false AND revoked_at IS NOT NULL)
  )
);

ALTER TABLE public.person_tenant_administrator_appointments OWNER TO postgres;

CREATE INDEX person_tenant_administrator_appointments_tenant_active_idx
  ON public.person_tenant_administrator_appointments (tenant_id, person_id)
  WHERE is_active = true;

CREATE INDEX person_tenant_administrator_appointments_person_idx
  ON public.person_tenant_administrator_appointments (person_id, tenant_id);

ALTER TABLE public.person_tenant_administrator_appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_tenant_administrator_appointments
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.person_tenant_administrator_appointment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES public.person_tenant_administrator_appointments(id)
    ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'appointed',
    'revoked',
    'reactivated',
    'unchanged'
  )),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_admin_user_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_tenant_administrator_appointment_audit_unchanged_check CHECK (
    appointment_id IS NOT NULL OR action = 'unchanged'
  )
);

ALTER TABLE public.person_tenant_administrator_appointment_audit OWNER TO postgres;

CREATE INDEX person_tenant_administrator_appointment_audit_tenant_idx
  ON public.person_tenant_administrator_appointment_audit (tenant_id, occurred_at DESC);

CREATE INDEX person_tenant_administrator_appointment_audit_appointment_idx
  ON public.person_tenant_administrator_appointment_audit (appointment_id, occurred_at DESC)
  WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_person_tenant_administrator_appointment_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'person_tenant_administrator_appointment_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_person_tenant_administrator_appointment_audit_mutation()
  OWNER TO postgres;

DROP TRIGGER IF EXISTS prevent_person_tenant_administrator_appointment_audit_mutation_trigger
  ON public.person_tenant_administrator_appointment_audit;

CREATE TRIGGER prevent_person_tenant_administrator_appointment_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.person_tenant_administrator_appointment_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_person_tenant_administrator_appointment_audit_mutation();

ALTER TABLE public.person_tenant_administrator_appointment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_tenant_administrator_appointment_audit
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_person_tenant_administrator_appointment(
  p_person_id uuid,
  p_tenant_id uuid,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_canonical_identity_count integer;
  v_before public.person_tenant_administrator_appointments%ROWTYPE;
  v_after public.person_tenant_administrator_appointments%ROWTYPE;
  v_action text;
  v_reason text;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'Person id is required.';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required.';
  END IF;

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'Appointment active status is required.';
  END IF;

  v_reason := nullif(btrim(p_reason), '');
  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Appointment reason must be 500 characters or fewer.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenants AS t
    WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  -- This is the exact canonical account -> Person eligibility chain. It
  -- deliberately does not use email, names, memberships, legacy assignment,
  -- or a copied Person id on admin_users. Any missing or non-singleton chain
  -- fails closed before an appointment can be created or transitioned.
  SELECT count(*)
    INTO v_canonical_identity_count
  FROM public.people AS p
  JOIN public.person_auth_accounts AS paa
    ON paa.person_id = p.id
   AND paa.status = 'active'
   AND paa.is_primary = true
  JOIN auth.users AS u ON u.id = paa.auth_user_id
  JOIN public.admin_users AS au
    ON au.user_id = u.id
   AND au.is_active = true
  WHERE p.id = p_person_id
    AND p.status = 'active';

  IF v_canonical_identity_count <> 1 THEN
    RAISE EXCEPTION 'Person does not have exactly one active canonical Administrator identity.';
  END IF;

  SELECT *
    INTO v_before
  FROM public.person_tenant_administrator_appointments AS ptaa
  WHERE ptaa.person_id = p_person_id
    AND ptaa.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND AND p_is_active THEN
    INSERT INTO public.person_tenant_administrator_appointments (
      person_id,
      tenant_id,
      is_active,
      appointment_basis
    ) VALUES (
      p_person_id,
      p_tenant_id,
      true,
      'platform_appointment'
    )
    RETURNING * INTO v_after;
    v_action := 'appointed';
  ELSIF NOT FOUND THEN
    v_action := 'unchanged';
  ELSIF v_before.is_active = p_is_active THEN
    v_after := v_before;
    v_action := 'unchanged';
  ELSIF p_is_active THEN
    UPDATE public.person_tenant_administrator_appointments
       SET is_active = true,
           activated_at = now(),
           revoked_at = NULL
     WHERE id = v_before.id
     RETURNING * INTO v_after;
    v_action := 'reactivated';
  ELSE
    UPDATE public.person_tenant_administrator_appointments
       SET is_active = false,
           revoked_at = now()
     WHERE id = v_before.id
     RETURNING * INTO v_after;
    v_action := 'revoked';
  END IF;

  INSERT INTO public.person_tenant_administrator_appointment_audit (
    appointment_id,
    person_id,
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    reason,
    before_state,
    after_state
  ) VALUES (
    v_after.id,
    p_person_id,
    p_tenant_id,
    v_action,
    auth.uid(),
    v_actor_admin_user_id,
    v_reason,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    CASE WHEN v_after.id IS NULL THEN NULL ELSE to_jsonb(v_after) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_person_tenant_administrator_appointments_for_administration(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  person_id uuid,
  tenant_id uuid,
  is_active boolean,
  appointment_basis text,
  created_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  IF p_tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    ptaa.id,
    ptaa.person_id,
    ptaa.tenant_id,
    ptaa.is_active,
    ptaa.appointment_basis,
    ptaa.created_at,
    ptaa.activated_at,
    ptaa.revoked_at
  FROM public.person_tenant_administrator_appointments AS ptaa
  WHERE p_tenant_id IS NULL OR ptaa.tenant_id = p_tenant_id
  ORDER BY ptaa.tenant_id, ptaa.person_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(
  p_tenant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  appointment_id uuid,
  person_id uuid,
  tenant_id uuid,
  action text,
  actor_auth_user_id uuid,
  actor_admin_user_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  IF p_tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    ptaaa.id,
    ptaaa.appointment_id,
    ptaaa.person_id,
    ptaaa.tenant_id,
    ptaaa.action,
    ptaaa.actor_auth_user_id,
    ptaaa.actor_admin_user_id,
    ptaaa.reason,
    ptaaa.before_state,
    ptaaa.after_state,
    ptaaa.occurred_at
  FROM public.person_tenant_administrator_appointment_audit AS ptaaa
  WHERE p_tenant_id IS NULL OR ptaaa.tenant_id = p_tenant_id
  ORDER BY ptaaa.occurred_at DESC, ptaaa.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$function$;

ALTER FUNCTION public.set_person_tenant_administrator_appointment(uuid, uuid, boolean, text)
  OWNER TO postgres;
ALTER FUNCTION public.list_person_tenant_administrator_appointments_for_administration(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(uuid, integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_person_tenant_administrator_appointment(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_person_tenant_administrator_appointments_for_administration(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_person_tenant_administrator_appointment(uuid, uuid, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_person_tenant_administrator_appointments_for_administration(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(uuid, integer)
  TO authenticated;

COMMENT ON TABLE public.person_tenant_administrator_appointments IS
  'T8 parallel Person x Tenant Administrator affiliation. It grants no live authority until a separately accepted cutover.';
COMMENT ON TABLE public.person_tenant_administrator_appointment_audit IS
  'Immutable lifecycle evidence for the parallel T8 appointment substrate.';

-- ============================================================
-- PARITY END
-- ============================================================

CREATE FUNCTION public.t8_appointment_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'T8 assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.t8_appointment_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t8_appointment_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t8_appointment_fixture_assert(boolean, text)
  TO authenticated;

CREATE TEMP TABLE t8_preexisting_authority_baseline ON COMMIT DROP AS
SELECT
  md5(pg_get_functiondef('public.has_tenant_admin_authority(uuid,uuid)'::regprocedure))
    AS has_tenant_hash,
  md5(pg_get_functiondef('public.has_any_tenant_admin_authority()'::regprocedure))
    AS has_any_tenant_hash,
  md5(pg_get_functiondef('public.has_event_admin_authority(uuid,uuid)'::regprocedure))
    AS has_event_hash,
  md5(pg_get_functiondef('public.resolve_task_authority(uuid,text,uuid)'::regprocedure))
    AS task_authority_hash,
  has_table_privilege('authenticated', 'public.events', 'INSERT')
    AS authenticated_events_insert_grant;

CREATE TEMP TABLE t8_preexisting_event_snapshot ON COMMIT DROP AS
SELECT e.id, md5(to_jsonb(e)::text) AS row_hash
FROM public.events AS e;

CREATE TEMP TABLE t8_preexisting_legacy_assignment_snapshot ON COMMIT DROP AS
SELECT ata.id, md5(to_jsonb(ata)::text) AS row_hash
FROM public.admin_tenant_access AS ata;

DO $fixture$
BEGIN
  PERFORM public.t8_appointment_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants
      WHERE organization_code IN ('T8-FIXTURE-ACTIVE-A', 'T8-FIXTURE-ACTIVE-B', 'T8-FIXTURE-INACTIVE')
    ),
    'fixture Tenant codes must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title,
    is_active
  ) VALUES
    ('80000000-0000-4000-8000-000000000001', 'T8-FIXTURE-ACTIVE-A',
     't8-fixture-active-a', 'T8 Fixture Active Tenant A',
     'T8 Active Tenant A', 'T8 Active Tenant A', true),
    ('80000000-0000-4000-8000-000000000002', 'T8-FIXTURE-ACTIVE-B',
     't8-fixture-active-b', 'T8 Fixture Active Tenant B',
     'T8 Active Tenant B', 'T8 Active Tenant B', true),
    ('80000000-0000-4000-8000-000000000003', 'T8-FIXTURE-INACTIVE',
     't8-fixture-inactive', 'T8 Fixture Inactive Tenant',
     'T8 Inactive Tenant', 'T8 Inactive Tenant', false);

  INSERT INTO public.events (id, name, tenant_id, location) VALUES (
    '81000000-0000-4000-8000-000000000001',
    'T8 Direct Event Admin Event',
    '80000000-0000-4000-8000-000000000001',
    'T8 fixture location'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('83000000-0000-4000-8000-000000000001', 't8-platform@fixture.invalid'),
    ('83000000-0000-4000-8000-000000000002', 't8-confirmed@fixture.invalid'),
    ('83000000-0000-4000-8000-000000000003', 't8-ordinary@fixture.invalid'),
    ('83000000-0000-4000-8000-000000000004', 't8-direct-event@fixture.invalid'),
    ('83000000-0000-4000-8000-000000000005', 't8-absent@fixture.invalid'),
    ('83000000-0000-4000-8000-000000000006', 't8-ambiguous@fixture.invalid'),
    ('83000000-0000-4000-8000-000000000007', 't8-conflicting@fixture.invalid'),
    ('83000000-0000-4000-8000-000000000008', 't8-forced-failure@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id,
    privilege_group
  ) VALUES
    ('82000000-0000-4000-8000-000000000001', 't8-platform@fixture.invalid',
     'T8 Platform', true, true,
     '83000000-0000-4000-8000-000000000001', 'super_admin'),
    ('82000000-0000-4000-8000-000000000002', 't8-confirmed@fixture.invalid',
     'T8 Confirmed Administrator', true, false,
     '83000000-0000-4000-8000-000000000002', 'event_admin'),
    ('82000000-0000-4000-8000-000000000003', 't8-ordinary@fixture.invalid',
     'T8 Ordinary Administrator', true, false,
     '83000000-0000-4000-8000-000000000003', 'event_admin'),
    ('82000000-0000-4000-8000-000000000004', 't8-direct-event@fixture.invalid',
     'T8 Direct Event Administrator', true, false,
     '83000000-0000-4000-8000-000000000004', 'event_admin'),
    ('82000000-0000-4000-8000-000000000005', 't8-absent@fixture.invalid',
     'T8 Absent Identity Administrator', true, false,
     '83000000-0000-4000-8000-000000000005', 'event_admin'),
    ('82000000-0000-4000-8000-000000000006', 't8-ambiguous@fixture.invalid',
     'T8 Ambiguous Administrator A', true, false,
     '83000000-0000-4000-8000-000000000006', 'event_admin'),
    ('82000000-0000-4000-8000-000000000007', 't8-ambiguous-secondary@fixture.invalid',
     'T8 Ambiguous Administrator B', true, false,
     '83000000-0000-4000-8000-000000000006', 'event_admin'),
    ('82000000-0000-4000-8000-000000000008', 't8-conflicting@fixture.invalid',
     'T8 Conflicting Identity Administrator', true, false,
     '83000000-0000-4000-8000-000000000007', 'event_admin'),
    ('82000000-0000-4000-8000-000000000009', 't8-forced-failure@fixture.invalid',
     'T8 Forced Failure Administrator', true, false,
     '83000000-0000-4000-8000-000000000008', 'event_admin');

  INSERT INTO public.people (
    id, display_first_name, display_last_name, status
  ) VALUES
    ('84000000-0000-4000-8000-000000000001', 'T8', 'Confirmed', 'active'),
    ('84000000-0000-4000-8000-000000000002', 'T8', 'Absent', 'active'),
    ('84000000-0000-4000-8000-000000000003', 'T8', 'Ambiguous', 'active'),
    ('84000000-0000-4000-8000-000000000004', 'T8', 'Conflicting', 'active'),
    ('84000000-0000-4000-8000-000000000005', 'T8', 'Failure', 'active');

  INSERT INTO public.person_auth_accounts (
    id, person_id, auth_user_id, status, is_primary
  ) VALUES
    ('85000000-0000-4000-8000-000000000001',
     '84000000-0000-4000-8000-000000000001',
     '83000000-0000-4000-8000-000000000002', 'active', true),
    ('85000000-0000-4000-8000-000000000002',
     '84000000-0000-4000-8000-000000000003',
     '83000000-0000-4000-8000-000000000006', 'active', true),
    ('85000000-0000-4000-8000-000000000003',
     '84000000-0000-4000-8000-000000000004',
     '83000000-0000-4000-8000-000000000007', 'disputed', false),
    ('85000000-0000-4000-8000-000000000004',
     '84000000-0000-4000-8000-000000000005',
     '83000000-0000-4000-8000-000000000008', 'active', true);

  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role)
  VALUES (
    '86000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000004',
    '81000000-0000-4000-8000-000000000001',
    'event_admin'
  );
END;
$fixture$;

SET LOCAL ROLE authenticated;

-- The first governed write runs through the real authenticated execution
-- surface. Subsequent fixture-only state assertions run as the linked owner
-- because raw appointment and audit tables are intentionally closed.
DO $fixture$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
  PERFORM public.set_person_tenant_administrator_appointment(
    '84000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    true,
    'T8 initial Platform appointment'
  );
END;
$fixture$;

RESET ROLE;

DO $fixture$
DECLARE
  v_appointment_id uuid;
  v_reactivated_id uuid;
  v_count bigint;
  v_failed boolean;
  v_allowed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);

  -- active canonical Person can be appointed only by Platform Administrator.
  PERFORM public.t8_appointment_fixture_assert(
    NOT public.has_tenant_admin_authority(
      '83000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000001'
    ),
    'confirmed Person has no legacy Tenant authority despite appointment'
  );

  SELECT id INTO v_appointment_id
  FROM public.person_tenant_administrator_appointments
  WHERE person_id = '84000000-0000-4000-8000-000000000001'
    AND tenant_id = '80000000-0000-4000-8000-000000000001';

  PERFORM public.t8_appointment_fixture_assert(
    v_appointment_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.person_tenant_administrator_appointments
      WHERE id = v_appointment_id
        AND is_active = true
        AND appointment_basis = 'platform_appointment'
        AND revoked_at IS NULL
    ),
    'Platform creates one active retained appointment lineage'
  );
  PERFORM public.t8_appointment_fixture_assert(
    EXISTS (
      SELECT 1
      FROM public.person_tenant_administrator_appointment_audit
      WHERE appointment_id = v_appointment_id
        AND action = 'appointed'
        AND actor_auth_user_id = '83000000-0000-4000-8000-000000000001'
        AND actor_admin_user_id = '82000000-0000-4000-8000-000000000001'
        AND reason = 'T8 initial Platform appointment'
    ),
    'appointment stores authenticated Platform actor and bounded audit reason'
  );

  PERFORM public.set_person_tenant_administrator_appointment(
    '84000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    true,
    'same active state'
  );
  PERFORM public.t8_appointment_fixture_assert(
    (SELECT count(*) FROM public.person_tenant_administrator_appointments
     WHERE person_id = '84000000-0000-4000-8000-000000000001'
       AND tenant_id = '80000000-0000-4000-8000-000000000001') = 1
    AND EXISTS (
      SELECT 1
      FROM public.person_tenant_administrator_appointment_audit
      WHERE appointment_id = v_appointment_id AND action = 'unchanged'
    ),
    'repeat active command retains one lineage and records unchanged evidence'
  );

  PERFORM public.set_person_tenant_administrator_appointment(
    '84000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    false,
    'T8 governed revocation'
  );
  PERFORM public.t8_appointment_fixture_assert(
    EXISTS (
      SELECT 1
      FROM public.person_tenant_administrator_appointments
      WHERE id = v_appointment_id
        AND is_active = false
        AND revoked_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.person_tenant_administrator_appointment_audit
      WHERE appointment_id = v_appointment_id AND action = 'revoked'
    ),
    'revocation retains the appointment lineage and immutable evidence'
  );

  PERFORM public.set_person_tenant_administrator_appointment(
    '84000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    true,
    'T8 governed reactivation'
  );
  SELECT id INTO v_reactivated_id
  FROM public.person_tenant_administrator_appointments
  WHERE person_id = '84000000-0000-4000-8000-000000000001'
    AND tenant_id = '80000000-0000-4000-8000-000000000001';
  PERFORM public.t8_appointment_fixture_assert(
    v_reactivated_id = v_appointment_id
    AND EXISTS (
      SELECT 1
      FROM public.person_tenant_administrator_appointments
      WHERE id = v_appointment_id
        AND is_active = true
        AND revoked_at IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.person_tenant_administrator_appointment_audit
      WHERE appointment_id = v_appointment_id AND action = 'reactivated'
    ),
    'reactivation reuses the retained appointment lineage without duplication'
  );

  -- Multiple Tenant appointments are exact and independent; this remains a
  -- parallel fact and must not infer any cross-Tenant authority.
  PERFORM public.set_person_tenant_administrator_appointment(
    '84000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    true,
    'T8 second exact Tenant appointment'
  );
  PERFORM public.t8_appointment_fixture_assert(
    (SELECT count(*) FROM public.list_person_tenant_administrator_appointments_for_administration(
      '80000000-0000-4000-8000-000000000002'
    )) = 1,
    'Platform appointment read is exact-Tenant scoped and includes retained state'
  );

  -- ADR-014 keeps inactive-Tenant appointment management available to
  -- Platform recovery. The persisted parallel fact must never bypass T2.
  PERFORM public.set_person_tenant_administrator_appointment(
    '84000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000003',
    true,
    'T8 inactive Tenant retained appointment'
  );
  PERFORM public.t8_appointment_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.person_tenant_administrator_appointments
      WHERE person_id = '84000000-0000-4000-8000-000000000001'
        AND tenant_id = '80000000-0000-4000-8000-000000000003'
        AND is_active = true
    )
    AND NOT public.has_tenant_admin_authority(
      '83000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003'
    ),
    'inactive Tenant retains the parallel appointment but receives no authority'
  );

  -- absent canonical Person identity fails closed.
  v_failed := false;
  BEGIN
    PERFORM public.set_person_tenant_administrator_appointment(
      '84000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000001',
      true,
      'must fail absent'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Person does not have exactly one active canonical Administrator identity.';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed
    AND NOT EXISTS (
      SELECT 1 FROM public.person_tenant_administrator_appointments
      WHERE person_id = '84000000-0000-4000-8000-000000000002'
    ),
    'absent canonical Person identity fails closed'
  );

  -- ambiguous canonical Person identity fails closed.
  v_failed := false;
  BEGIN
    PERFORM public.set_person_tenant_administrator_appointment(
      '84000000-0000-4000-8000-000000000003',
      '80000000-0000-4000-8000-000000000001',
      true,
      'must fail ambiguous'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Person does not have exactly one active canonical Administrator identity.';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed
    AND NOT EXISTS (
      SELECT 1 FROM public.person_tenant_administrator_appointments
      WHERE person_id = '84000000-0000-4000-8000-000000000003'
    ),
    'ambiguous canonical Person identity fails closed'
  );

  -- conflicting canonical Person identity fails closed.
  v_failed := false;
  BEGIN
    PERFORM public.set_person_tenant_administrator_appointment(
      '84000000-0000-4000-8000-000000000004',
      '80000000-0000-4000-8000-000000000001',
      true,
      'must fail conflicting'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Person does not have exactly one active canonical Administrator identity.';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed
    AND NOT EXISTS (
      SELECT 1 FROM public.person_tenant_administrator_appointments
      WHERE person_id = '84000000-0000-4000-8000-000000000004'
    ),
    'conflicting canonical Person identity fails closed'
  );

  v_failed := false;
  BEGIN
    PERFORM public.set_person_tenant_administrator_appointment(
      '84000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000099',
      true,
      'must fail nonexistent Tenant'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Tenant not found.';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'Platform appointment command requires an existing canonical Tenant'
  );

  -- appointment lifecycle does not change legacy Tenant authority.
  PERFORM set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000002', true);
  PERFORM public.t8_appointment_fixture_assert(
    NOT public.has_any_tenant_admin_authority()
    AND NOT public.has_tenant_admin_authority(
      auth.uid(), '80000000-0000-4000-8000-000000000001'
    )
    AND NOT public.has_event_admin_authority(
      auth.uid(), '81000000-0000-4000-8000-000000000001'
    ),
    'Person appointment grants zero live Tenant or Event authority during T8'
  );
  SELECT allowed INTO v_allowed
  FROM public.resolve_task_authority(
    auth.uid(), 'event.definition.manage', '81000000-0000-4000-8000-000000000001'
  );
  PERFORM public.t8_appointment_fixture_assert(
    NOT v_allowed,
    'Person appointment grants zero live task authority during T8'
  );

  -- Direct Event Admin stays Event-only and cannot manage a Tenant appointment.
  PERFORM set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000004', true);
  PERFORM public.t8_appointment_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '81000000-0000-4000-8000-000000000001'
    )
    AND NOT public.has_tenant_admin_authority(
      auth.uid(), '80000000-0000-4000-8000-000000000001'
    ),
    'direct Event Admin remains Event-only despite the T8 foundation'
  );
  v_failed := false;
  BEGIN
    PERFORM public.set_person_tenant_administrator_appointment(
      '84000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      false,
      'direct Event Admin must not manage appointments'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'direct Event Admin cannot manage a Tenant appointment'
  );

  -- Authenticated non-Platform callers receive no command or read surface.
  PERFORM set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN
    PERFORM public.set_person_tenant_administrator_appointment(
      '84000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      false,
      'ordinary caller must not manage appointments'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'authenticated non-Platform caller cannot manage a Tenant appointment'
  );
  v_failed := false;
  BEGIN
    PERFORM 1
    FROM public.list_person_tenant_administrator_appointments_for_administration(
      '80000000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'authenticated non-Platform caller cannot read appointment history'
  );

END;
$fixture$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_failed boolean;
BEGIN
  -- Table closure: authenticated callers have governed functions only.
  v_failed := false;
  BEGIN
    INSERT INTO public.person_tenant_administrator_appointments (
      person_id, tenant_id, is_active, appointment_basis
    ) VALUES (
      '84000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',
      true,
      'platform_appointment'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'authenticated caller cannot write the raw appointment table'
  );

  -- raw authenticated Event INSERT remains closed.
  v_failed := false;
  BEGIN
    INSERT INTO public.events (id, name, tenant_id, location) VALUES (
      '81000000-0000-4000-8000-000000000099',
      'T8 raw authenticated Event write',
      '80000000-0000-4000-8000-000000000001',
      'must remain denied'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'raw authenticated Event INSERT remains closed'
  );
END;
$fixture$;

RESET ROLE;

-- anon has no appointment execution surface at all, independently of the
-- Platform-only runtime checks granted to authenticated callers.
SET LOCAL ROLE anon;
DO $fixture$
BEGIN
  PERFORM public.set_person_tenant_administrator_appointment(
    '84000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    false,
    'anon must not execute'
  );
  RAISE EXCEPTION 'T8 assertion failed: anon unexpectedly executed appointment command';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$fixture$;
RESET ROLE;

CREATE FUNCTION public.t8_appointment_fixture_force_audit_failure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF current_setting('app.t8_force_audit_failure', true) = 'on' THEN
    RAISE EXCEPTION 'T8 forced audit write failure';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER t8_appointment_fixture_force_audit_failure_trigger
BEFORE INSERT ON public.person_tenant_administrator_appointment_audit
FOR EACH ROW
EXECUTE FUNCTION public.t8_appointment_fixture_force_audit_failure();

DO $fixture$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.t8_force_audit_failure', 'on', true);
  BEGIN
    PERFORM public.set_person_tenant_administrator_appointment(
      '84000000-0000-4000-8000-000000000005',
      '80000000-0000-4000-8000-000000000001',
      true,
      'forced audit failure'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'T8 forced audit write failure';
  END;
  PERFORM set_config('app.t8_force_audit_failure', 'off', true);
  PERFORM public.t8_appointment_fixture_assert(
    v_failed
    AND NOT EXISTS (
      SELECT 1 FROM public.person_tenant_administrator_appointments
      WHERE person_id = '84000000-0000-4000-8000-000000000005'
        AND tenant_id = '80000000-0000-4000-8000-000000000001'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.person_tenant_administrator_appointment_audit
      WHERE person_id = '84000000-0000-4000-8000-000000000005'
        AND tenant_id = '80000000-0000-4000-8000-000000000001'
    ),
    'forced audit failure rolls back the appointment mutation in the same transaction'
  );
END;
$fixture$;

RESET ROLE;

DO $fixture$
DECLARE
  v_failed boolean;
BEGIN
  -- Audit history cannot be changed even under table-owner execution.
  v_failed := false;
  BEGIN
    UPDATE public.person_tenant_administrator_appointment_audit
       SET reason = 'tampered'
     WHERE id = (
       SELECT a.id
       FROM public.person_tenant_administrator_appointment_audit AS a
       WHERE a.appointment_id = (
         SELECT id FROM public.person_tenant_administrator_appointments
         WHERE person_id = '84000000-0000-4000-8000-000000000001'
           AND tenant_id = '80000000-0000-4000-8000-000000000001'
       )
       ORDER BY a.id
       LIMIT 1
     );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'person_tenant_administrator_appointment_audit is immutable';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'audit UPDATE is blocked even for table owner execution'
  );

  v_failed := false;
  BEGIN
    DELETE FROM public.person_tenant_administrator_appointment_audit
     WHERE id = (
       SELECT a.id
       FROM public.person_tenant_administrator_appointment_audit AS a
       WHERE a.appointment_id = (
         SELECT id FROM public.person_tenant_administrator_appointments
         WHERE person_id = '84000000-0000-4000-8000-000000000001'
           AND tenant_id = '80000000-0000-4000-8000-000000000001'
       )
       ORDER BY a.id
       LIMIT 1
     );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'person_tenant_administrator_appointment_audit is immutable';
  END;
  PERFORM public.t8_appointment_fixture_assert(
    v_failed,
    'audit DELETE is blocked even for table owner execution'
  );

  PERFORM public.t8_appointment_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM t8_preexisting_event_snapshot AS s
      LEFT JOIN public.events AS e ON e.id = s.id
      WHERE e.id IS NULL OR md5(to_jsonb(e)::text) IS DISTINCT FROM s.row_hash
    )
    AND EXISTS (
      SELECT 1 FROM public.events
      WHERE id = '81000000-0000-4000-8000-000000000001'
        AND tenant_id = '80000000-0000-4000-8000-000000000001'
        AND name = 'T8 Direct Event Admin Event'
    ),
    'appointment lifecycle does not change Event authority or Event ownership'
  );

  PERFORM public.t8_appointment_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM t8_preexisting_legacy_assignment_snapshot AS s
      LEFT JOIN public.admin_tenant_access AS ata ON ata.id = s.id
      WHERE ata.id IS NULL OR md5(to_jsonb(ata)::text) IS DISTINCT FROM s.row_hash
    )
    AND (SELECT count(*) FROM public.admin_tenant_access) =
        (SELECT count(*) FROM t8_preexisting_legacy_assignment_snapshot),
    'existing admin_tenant_access behavior remains unchanged'
  );

  PERFORM public.t8_appointment_fixture_assert(
    (SELECT has_tenant_hash FROM t8_preexisting_authority_baseline) =
      md5(pg_get_functiondef('public.has_tenant_admin_authority(uuid,uuid)'::regprocedure))
    AND (SELECT has_any_tenant_hash FROM t8_preexisting_authority_baseline) =
      md5(pg_get_functiondef('public.has_any_tenant_admin_authority()'::regprocedure))
    AND (SELECT has_event_hash FROM t8_preexisting_authority_baseline) =
      md5(pg_get_functiondef('public.has_event_admin_authority(uuid,uuid)'::regprocedure))
    AND (SELECT task_authority_hash FROM t8_preexisting_authority_baseline) =
      md5(pg_get_functiondef('public.resolve_task_authority(uuid,text,uuid)'::regprocedure))
    AND (SELECT authenticated_events_insert_grant FROM t8_preexisting_authority_baseline) =
      has_table_privilege('authenticated', 'public.events', 'INSERT'),
    'pre-existing canonical authority definitions remain byte/value-equivalent'
  );
END;
$fixture$;

ROLLBACK;
