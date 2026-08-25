-- Tenant T9 linked integration and rollback proof.
--
-- Installs the exact pending authority definitions in one outer transaction.
-- Fixture-only rows prove parity, exclusivity, caller boundaries, T3/T5/T6
-- behavior, lifecycle, RLS, and zero-residue rollback.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- Do not make the source switch when either active substrate cannot be paired
-- one-to-one through the exact, currently eligible canonical identity chain.
-- This reports aggregate counts only: identities remain private and no repair,
-- link, appointment, or legacy row is created by this gate.
CREATE OR REPLACE FUNCTION public._assert_person_tenant_administrator_cutover_parity()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_legacy_without_appointment bigint;
  v_appointment_without_legacy bigint;
BEGIN
  SELECT count(*)
    INTO v_legacy_without_appointment
  FROM public.admin_tenant_access AS ata
  JOIN public.admin_users AS legacy_au
    ON legacy_au.id = ata.admin_user_id
  WHERE ata.is_active
    AND (
      SELECT count(*)
      FROM public.person_auth_accounts AS paa
      JOIN public.people AS p
        ON p.id = paa.person_id
       AND p.status = 'active'
      JOIN auth.users AS u ON u.id = paa.auth_user_id
      JOIN public.admin_users AS au
        ON au.user_id = u.id
       AND au.is_active
      JOIN public.person_tenant_administrator_appointments AS ptaa
        ON ptaa.person_id = p.id
       AND ptaa.tenant_id = ata.tenant_id
       AND ptaa.is_active
      WHERE paa.auth_user_id = legacy_au.user_id
        AND paa.status = 'active'
        AND paa.is_primary = true
    ) <> 1;

  SELECT count(*)
    INTO v_appointment_without_legacy
  FROM public.person_tenant_administrator_appointments AS ptaa
  WHERE ptaa.is_active
    AND (
      SELECT count(*)
      FROM public.people AS p
      JOIN public.person_auth_accounts AS paa
        ON paa.person_id = p.id
       AND paa.status = 'active'
       AND paa.is_primary = true
      JOIN auth.users AS u ON u.id = paa.auth_user_id
      JOIN public.admin_users AS au
        ON au.user_id = u.id
       AND au.is_active
      JOIN public.admin_tenant_access AS ata
        ON ata.admin_user_id = au.id
       AND ata.tenant_id = ptaa.tenant_id
       AND ata.is_active
      WHERE p.id = ptaa.person_id
        AND p.status = 'active'
    ) <> 1;

  IF v_legacy_without_appointment <> 0 OR v_appointment_without_legacy <> 0 THEN
    RAISE EXCEPTION
      'T9 Person-backed Tenant Administrator parity gate failed: % active legacy assignments lack exactly one eligible same-Tenant appointment; % active appointments lack exactly one eligible same-Tenant legacy assignment.',
      v_legacy_without_appointment,
      v_appointment_without_legacy;
  END IF;
END;
$function$;

-- This call is deliberately adjacent to the resolver replacement below. The
-- transaction aborts before any authority definition changes on parity drift.
DO $parity$
BEGIN
  PERFORM public._assert_person_tenant_administrator_cutover_parity();
END;
$parity$;

CREATE OR REPLACE FUNCTION public.has_tenant_admin_authority(
  p_auth_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_auth_user_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  -- Platform authority is intentionally independent of Person x Tenant
  -- appointments and keeps the established inactive-Tenant recovery branch.
  IF public.has_platform_admin_authority(p_auth_user_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.person_tenant_administrator_appointments AS ptaa
    JOIN public.people AS p
      ON p.id = ptaa.person_id
     AND p.status = 'active'
    JOIN public.person_auth_accounts AS paa
      ON paa.person_id = p.id
     AND paa.auth_user_id = p_auth_user_id
     AND paa.status = 'active'
     AND paa.is_primary = true
    JOIN auth.users AS u ON u.id = paa.auth_user_id
    JOIN public.admin_users AS au
      ON au.user_id = u.id
     AND au.is_active
    JOIN public.tenants AS t
      ON t.id = ptaa.tenant_id
     AND t.is_active
    WHERE ptaa.tenant_id = p_tenant_id
      AND ptaa.is_active
      AND (
        SELECT count(*)
        FROM public.admin_users AS exact_au
        WHERE exact_au.user_id = p_auth_user_id
          AND exact_au.is_active
      ) = 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_platform_admin_authority(v_uid) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.person_tenant_administrator_appointments AS ptaa
    JOIN public.people AS p
      ON p.id = ptaa.person_id
     AND p.status = 'active'
    JOIN public.person_auth_accounts AS paa
      ON paa.person_id = p.id
     AND paa.auth_user_id = v_uid
     AND paa.status = 'active'
     AND paa.is_primary = true
    JOIN auth.users AS u ON u.id = paa.auth_user_id
    JOIN public.admin_users AS au
      ON au.user_id = u.id
     AND au.is_active
    JOIN public.tenants AS t
      ON t.id = ptaa.tenant_id
     AND t.is_active
    WHERE ptaa.is_active
      AND (
        SELECT count(*)
        FROM public.admin_users AS exact_au
        WHERE exact_au.user_id = v_uid
          AND exact_au.is_active
      ) = 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_tenant_admin_access()
RETURNS TABLE (
  tenant_id uuid,
  display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF public.has_platform_admin_authority(v_uid) THEN
    RETURN QUERY
    SELECT t.id, t.display_name
    FROM public.tenants AS t
    WHERE t.is_active
    ORDER BY t.display_name, t.id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.id, t.display_name
  FROM public.person_tenant_administrator_appointments AS ptaa
  JOIN public.people AS p
    ON p.id = ptaa.person_id
   AND p.status = 'active'
  JOIN public.person_auth_accounts AS paa
    ON paa.person_id = p.id
   AND paa.auth_user_id = v_uid
   AND paa.status = 'active'
   AND paa.is_primary = true
  JOIN auth.users AS u ON u.id = paa.auth_user_id
  JOIN public.admin_users AS au
    ON au.user_id = u.id
   AND au.is_active
  JOIN public.tenants AS t
    ON t.id = ptaa.tenant_id
   AND t.is_active
  WHERE ptaa.is_active
    AND (
      SELECT count(*)
      FROM public.admin_users AS exact_au
      WHERE exact_au.user_id = v_uid
        AND exact_au.is_active
    ) = 1
  ORDER BY t.display_name, t.id;
END;
$function$;

-- Preserve the T3 summary contract while counting only currently effective
-- Person-backed appointments. An appointment on an inactive Tenant remains
-- retained history but is not an effective Tenant Administrator.
CREATE OR REPLACE FUNCTION public.list_tenants_for_administration()
RETURNS TABLE(
  id uuid,
  organization_code text,
  slug text,
  organization_name text,
  display_name text,
  app_title text,
  app_tagline text,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  is_active boolean,
  tenant_type_id uuid,
  tenant_type_code text,
  tenant_type_label text,
  post_event_edit_window_days integer,
  created_at timestamptz,
  updated_at timestamptz,
  owned_event_count bigint,
  active_tenant_admin_count bigint,
  hostname_mapping_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  RETURN QUERY
  SELECT
    t.id,
    t.organization_code,
    t.slug,
    t.organization_name,
    t.display_name,
    t.app_title,
    t.app_tagline,
    t.logo_url,
    t.favicon_url,
    t.primary_color,
    t.secondary_color,
    t.accent_color,
    t.is_active,
    t.tenant_type_id,
    tt.code,
    tt.label,
    t.post_event_edit_window_days,
    t.created_at,
    t.updated_at,
    (SELECT count(*) FROM public.events AS e WHERE e.tenant_id = t.id),
    (
      SELECT count(*)
      FROM public.person_tenant_administrator_appointments AS ptaa
      JOIN public.people AS p
        ON p.id = ptaa.person_id
       AND p.status = 'active'
      JOIN public.person_auth_accounts AS paa
        ON paa.person_id = p.id
       AND paa.status = 'active'
       AND paa.is_primary = true
      JOIN auth.users AS u ON u.id = paa.auth_user_id
      JOIN public.admin_users AS au
        ON au.user_id = u.id
       AND au.is_active
      WHERE ptaa.tenant_id = t.id
        AND ptaa.is_active
        AND t.is_active
        AND (
          SELECT count(*)
          FROM public.admin_users AS exact_au
          WHERE exact_au.user_id = paa.auth_user_id
            AND exact_au.is_active
        ) = 1
    ),
    (
      SELECT count(*)
      FROM public.tenant_hostname_mappings AS thm
      WHERE thm.tenant_id = t.id
    )
  FROM public.tenants AS t
  LEFT JOIN public.tenant_types AS tt ON tt.id = t.tenant_type_id
  ORDER BY t.display_name, t.organization_code, t.id;
END;
$function$;

-- This is a Platform-only display/read surface. It selects People only when
-- their single active canonical account-to-Admin chain is already proven; no
-- email, name, membership, or legacy assignment participates in identity.
CREATE OR REPLACE FUNCTION public.list_eligible_person_tenant_administrator_candidates_for_administration()
RETURNS TABLE(
  person_id uuid,
  admin_user_id uuid,
  admin_email text,
  admin_display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  RETURN QUERY
  WITH canonical_candidates AS (
    SELECT
      p.id AS person_id,
      au.id AS admin_user_id,
      au.email AS admin_email,
      au.display_name AS admin_display_name,
      count(*) OVER (PARTITION BY p.id) AS canonical_identity_count
    FROM public.people AS p
    JOIN public.person_auth_accounts AS paa
      ON paa.person_id = p.id
     AND paa.status = 'active'
     AND paa.is_primary = true
    JOIN auth.users AS u ON u.id = paa.auth_user_id
    JOIN public.admin_users AS au
      ON au.user_id = u.id
     AND au.is_active
    WHERE p.status = 'active'
  )
  SELECT
    c.person_id,
    c.admin_user_id,
    c.admin_email,
    c.admin_display_name
  FROM canonical_candidates AS c
  WHERE c.canonical_identity_count = 1
  ORDER BY c.admin_email, c.person_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_administrator_appointments_for_administration(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  person_id uuid,
  tenant_id uuid,
  appointment_is_active boolean,
  is_effective boolean,
  created_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  admin_user_id uuid,
  admin_email text,
  admin_display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  IF p_tenant_id IS NULL OR NOT EXISTS (
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
    (
      ptaa.is_active
      AND t.is_active
      AND identity.admin_user_id IS NOT NULL
    ) AS is_effective,
    ptaa.created_at,
    ptaa.activated_at,
    ptaa.revoked_at,
    identity.admin_user_id,
    identity.admin_email,
    identity.admin_display_name
  FROM public.person_tenant_administrator_appointments AS ptaa
  JOIN public.tenants AS t ON t.id = ptaa.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      au.id AS admin_user_id,
      au.email AS admin_email,
      au.display_name AS admin_display_name
    FROM public.people AS p
    JOIN public.person_auth_accounts AS paa
      ON paa.person_id = p.id
     AND paa.status = 'active'
     AND paa.is_primary = true
    JOIN auth.users AS u ON u.id = paa.auth_user_id
    JOIN public.admin_users AS au
      ON au.user_id = u.id
     AND au.is_active
    WHERE p.id = ptaa.person_id
      AND p.status = 'active'
      AND (
        SELECT count(*)
        FROM public.admin_users AS exact_au
        WHERE exact_au.user_id = paa.auth_user_id
          AND exact_au.is_active
      ) = 1
  ) AS identity ON true
  WHERE ptaa.tenant_id = p_tenant_id
  ORDER BY ptaa.is_active DESC, ptaa.created_at DESC, ptaa.id;
END;
$function$;

-- The sole former T3 write command is deliberately closed rather than
-- delegated. The migrated T3 UI invokes the canonical T8 Person appointment
-- command directly, so no deployed application consumer requires this legacy
-- Admin-User-keyed signature and it cannot become a misleading second API.
CREATE OR REPLACE FUNCTION public.set_tenant_admin_access(
  p_admin_user_id uuid,
  p_tenant_id uuid,
  p_is_active boolean,
  p_granted_by text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();
  RAISE EXCEPTION 'set_tenant_admin_access is retired; use the governed Person-backed appointment command.';
END;
$function$;

ALTER FUNCTION public.has_tenant_admin_authority(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.has_any_tenant_admin_authority() OWNER TO postgres;
ALTER FUNCTION public.list_my_tenant_admin_access() OWNER TO postgres;
ALTER FUNCTION public.list_tenants_for_administration() OWNER TO postgres;
ALTER FUNCTION public._assert_person_tenant_administrator_cutover_parity()
  OWNER TO postgres;
ALTER FUNCTION public.list_eligible_person_tenant_administrator_candidates_for_administration()
  OWNER TO postgres;
ALTER FUNCTION public.list_tenant_administrator_appointments_for_administration(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.has_tenant_admin_authority(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_any_tenant_admin_authority()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_tenant_admin_access()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenants_for_administration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._assert_person_tenant_administrator_cutover_parity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_eligible_person_tenant_administrator_candidates_for_administration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenant_administrator_appointments_for_administration(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.has_tenant_admin_authority(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_tenant_admin_authority()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_tenant_admin_access()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenants_for_administration()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_eligible_person_tenant_administrator_candidates_for_administration()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_administrator_appointments_for_administration(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) IS
  'T9 ordinary Tenant authority derives only from exact active canonical Person x Tenant appointments; Platform authority remains separate.';
COMMENT ON FUNCTION public.list_my_tenant_admin_access() IS
  'T9 self-scoped active Tenant list derived only from exact active canonical Person x Tenant appointments.';
COMMENT ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) IS
  'Retired at T9. Legacy admin_tenant_access is historical evidence only and grants no authority.';

-- ============================================================
-- PARITY END

CREATE FUNCTION public.t9_fixture_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'T9 assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.t9_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t9_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t9_fixture_assert(boolean, text) TO authenticated;

CREATE TEMP TABLE t9_preexisting_legacy_snapshot ON COMMIT DROP AS
SELECT id, md5(to_jsonb(ata)::text) AS row_hash
FROM public.admin_tenant_access AS ata;

CREATE TEMP TABLE t9_preexisting_event_snapshot ON COMMIT DROP AS
SELECT id, tenant_id, md5(to_jsonb(e)::text) AS row_hash
FROM public.events AS e;

CREATE TEMP TABLE t9_created_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_auth_user_id uuid NOT NULL
) ON COMMIT DROP;
GRANT INSERT ON t9_created_events TO authenticated;

DO $fixture$
BEGIN
  PERFORM public.t9_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants
      WHERE organization_code IN ('T9-FIXTURE-ACTIVE-A', 'T9-FIXTURE-ACTIVE-B', 'T9-FIXTURE-INACTIVE')
    ),
    'fixture Tenant codes must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title, is_active
  ) VALUES
    ('90000000-0000-4000-8000-000000000001', 'T9-FIXTURE-ACTIVE-A',
     't9-fixture-active-a', 'T9 Fixture Active Tenant A', 'T9 Active Tenant A', 'T9 Active Tenant A', true),
    ('90000000-0000-4000-8000-000000000002', 'T9-FIXTURE-ACTIVE-B',
     't9-fixture-active-b', 'T9 Fixture Active Tenant B', 'T9 Active Tenant B', 'T9 Active Tenant B', true),
    ('90000000-0000-4000-8000-000000000003', 'T9-FIXTURE-INACTIVE',
     't9-fixture-inactive', 'T9 Fixture Inactive Tenant', 'T9 Inactive Tenant', 'T9 Inactive Tenant', false);

  INSERT INTO public.events (id, name, tenant_id, location) VALUES
    ('91000000-0000-4000-8000-000000000001', 'T9 Tenant A Event',
     '90000000-0000-4000-8000-000000000001', 'T9 fixture location'),
    ('91000000-0000-4000-8000-000000000002', 'T9 Tenant B Event',
     '90000000-0000-4000-8000-000000000002', 'T9 fixture location');

  INSERT INTO auth.users (id, email) VALUES
    ('92000000-0000-4000-8000-000000000001', 't9-platform@fixture.invalid'),
    ('92000000-0000-4000-8000-000000000002', 't9-tenant-admin@fixture.invalid'),
    ('92000000-0000-4000-8000-000000000003', 't9-direct-event@fixture.invalid'),
    ('92000000-0000-4000-8000-000000000004', 't9-inactive-admin@fixture.invalid'),
    ('92000000-0000-4000-8000-000000000005', 't9-legacy-only@fixture.invalid'),
    ('92000000-0000-4000-8000-000000000006', 't9-inactive-person@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id, privilege_group
  ) VALUES
    ('93000000-0000-4000-8000-000000000001', 't9-platform@fixture.invalid',
     'T9 Platform', true, true, '92000000-0000-4000-8000-000000000001', 'super_admin'),
    ('93000000-0000-4000-8000-000000000002', 't9-tenant-admin@fixture.invalid',
     'T9 Tenant Administrator', true, false, '92000000-0000-4000-8000-000000000002', 'event_admin'),
    ('93000000-0000-4000-8000-000000000003', 't9-direct-event@fixture.invalid',
     'T9 Direct Event Administrator', true, false, '92000000-0000-4000-8000-000000000003', 'event_admin'),
    ('93000000-0000-4000-8000-000000000004', 't9-inactive-admin@fixture.invalid',
     'T9 Inactive Administrator', false, false, '92000000-0000-4000-8000-000000000004', 'event_admin'),
    ('93000000-0000-4000-8000-000000000005', 't9-legacy-only@fixture.invalid',
     'T9 Legacy Only Administrator', true, false, '92000000-0000-4000-8000-000000000005', 'event_admin'),
    ('93000000-0000-4000-8000-000000000006', 't9-inactive-person@fixture.invalid',
     'T9 Inactive Person Administrator', true, false, '92000000-0000-4000-8000-000000000006', 'event_admin');

  INSERT INTO public.people (id, display_first_name, display_last_name, status) VALUES
    ('94000000-0000-4000-8000-000000000001', 'T9', 'TenantAdmin', 'active'),
    ('94000000-0000-4000-8000-000000000002', 'T9', 'LegacyOnly', 'active'),
    ('94000000-0000-4000-8000-000000000003', 'T9', 'InactiveAdmin', 'active'),
    ('94000000-0000-4000-8000-000000000004', 'T9', 'InactivePerson', 'inactive');

  INSERT INTO public.person_auth_accounts (
    id, person_id, auth_user_id, status, is_primary
  ) VALUES
    ('95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
     '92000000-0000-4000-8000-000000000002', 'active', true),
    ('95000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002',
     '92000000-0000-4000-8000-000000000005', 'active', true),
    ('95000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000003',
     '92000000-0000-4000-8000-000000000004', 'active', true),
    ('95000000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000004',
     '92000000-0000-4000-8000-000000000006', 'active', true);

  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES (
    '96000000-0000-4000-0000-000000000001',
    '93000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000001',
    'event_admin'
  );

  INSERT INTO public.admin_tenant_access (id, admin_user_id, tenant_id, is_active, created_by)
  VALUES (
    '97000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001', true, 'T9 fixture only'
  );
END;
$fixture$;

SET LOCAL ROLE authenticated;
DO $fixture$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
  PERFORM public.set_person_tenant_administrator_appointment(
    '94000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    true, 'T9 cutover parity fixture appointment'
  );
END;
$fixture$;
RESET ROLE;

DO $fixture$
DECLARE
  v_failed boolean;
BEGIN
  -- The exact pending migration gate accepts the paired state.
  PERFORM public._assert_person_tenant_administrator_cutover_parity();

  -- Every failure branch is transactional: setup plus the failed helper call is
  -- rolled back by the PL/pgSQL exception block.
  v_failed := false;
  BEGIN
    INSERT INTO public.admin_tenant_access (id, admin_user_id, tenant_id, is_active)
    VALUES ('97000000-0000-4000-8000-000000000101',
            '93000000-0000-4000-8000-000000000003',
            '90000000-0000-4000-8000-000000000001', true);
    PERFORM public._assert_person_tenant_administrator_cutover_parity();
  EXCEPTION WHEN others THEN
    v_failed := position('T9 Person-backed Tenant Administrator parity gate failed' IN SQLERRM) = 1;
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'parity gate rejects missing Person linkage');

  v_failed := false;
  BEGIN
    INSERT INTO public.admin_users (
      id, email, display_name, is_active, is_super_admin, user_id, privilege_group
    ) VALUES (
      '93000000-0000-4000-8000-000000000101', 't9-duplicate@fixture.invalid',
      'T9 Duplicate Identity', true, false,
      '92000000-0000-4000-8000-000000000002', 'event_admin'
    );
    PERFORM public._assert_person_tenant_administrator_cutover_parity();
  EXCEPTION WHEN others THEN
    v_failed := position('T9 Person-backed Tenant Administrator parity gate failed' IN SQLERRM) = 1;
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'parity gate rejects nonexact canonical identity');

  v_failed := false;
  BEGIN
    INSERT INTO public.admin_tenant_access (id, admin_user_id, tenant_id, is_active)
    VALUES ('97000000-0000-4000-8000-000000000102',
            '93000000-0000-4000-8000-000000000005',
            '90000000-0000-4000-8000-000000000001', true);
    PERFORM public._assert_person_tenant_administrator_cutover_parity();
  EXCEPTION WHEN others THEN
    v_failed := position('T9 Person-backed Tenant Administrator parity gate failed' IN SQLERRM) = 1;
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'parity gate rejects missing appointment');

  v_failed := false;
  BEGIN
    INSERT INTO public.person_tenant_administrator_appointments (
      person_id, tenant_id, is_active, appointment_basis
    ) VALUES (
      '94000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002', true, 'platform_appointment'
    );
    PERFORM public._assert_person_tenant_administrator_cutover_parity();
  EXCEPTION WHEN others THEN
    v_failed := position('T9 Person-backed Tenant Administrator parity gate failed' IN SQLERRM) = 1;
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'parity gate rejects wrong-Tenant appointment');

  v_failed := false;
  BEGIN
    UPDATE public.person_tenant_administrator_appointments
       SET is_active = false, revoked_at = now()
     WHERE person_id = '94000000-0000-4000-8000-000000000001'
       AND tenant_id = '90000000-0000-4000-8000-000000000001';
    PERFORM public._assert_person_tenant_administrator_cutover_parity();
  EXCEPTION WHEN others THEN
    v_failed := position('T9 Person-backed Tenant Administrator parity gate failed' IN SQLERRM) = 1;
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'parity gate rejects revoked appointment');

  v_failed := false;
  BEGIN
    INSERT INTO public.person_tenant_administrator_appointments (
      person_id, tenant_id, is_active, appointment_basis
    ) VALUES (
      '94000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000002', true, 'platform_appointment'
    );
    PERFORM public._assert_person_tenant_administrator_cutover_parity();
  EXCEPTION WHEN others THEN
    v_failed := position('T9 Person-backed Tenant Administrator parity gate failed' IN SQLERRM) = 1;
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'parity gate rejects unmatched active appointment');
END;
$fixture$;

DO $fixture$
BEGIN
  -- Retained but invalid fixture records prove resolver fail-closed behavior
  -- after the one-time transactional parity gate has completed.
  INSERT INTO public.admin_tenant_access (id, admin_user_id, tenant_id, is_active) VALUES
    ('97000000-0000-4000-8000-000000000002',
     '93000000-0000-4000-8000-000000000005',
     '90000000-0000-4000-8000-000000000002', true),
    ('97000000-0000-4000-8000-000000000003',
     '93000000-0000-4000-8000-000000000004',
     '90000000-0000-4000-8000-000000000001', true),
    ('97000000-0000-4000-8000-000000000004',
     '93000000-0000-4000-8000-000000000006',
     '90000000-0000-4000-8000-000000000001', true);

  INSERT INTO public.person_tenant_administrator_appointments (
    person_id, tenant_id, is_active, appointment_basis
  ) VALUES
    ('94000000-0000-4000-8000-000000000003',
     '90000000-0000-4000-8000-000000000001', true, 'platform_appointment'),
    ('94000000-0000-4000-8000-000000000004',
     '90000000-0000-4000-8000-000000000001', true, 'platform_appointment');
END;
$fixture$;

CREATE TEMP TABLE t9_legacy_after_cutover_setup ON COMMIT DROP AS
SELECT id, md5(to_jsonb(ata)::text) AS row_hash
FROM public.admin_tenant_access AS ata;
GRANT SELECT ON t9_legacy_after_cutover_setup TO authenticated;

SET LOCAL ROLE authenticated;
DO $fixture$
DECLARE
  v_created record;
  v_task_allowed boolean;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
  PERFORM public.t9_fixture_assert(
    public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000001')
    AND NOT public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000002')
    AND public.has_any_tenant_admin_authority()
    AND (SELECT count(*) FROM public.list_my_tenant_admin_access()
         WHERE tenant_id = '90000000-0000-4000-8000-000000000001') = 1,
    'valid Person-backed Tenant Admin has exact Tenant and T6 discovery authority'
  );
  PERFORM public.t9_fixture_assert(
    public.has_event_admin_authority(auth.uid(), '91000000-0000-4000-8000-000000000001')
    AND NOT public.has_event_admin_authority(auth.uid(), '91000000-0000-4000-8000-000000000002'),
    'Tenant appointment dynamically inherits only same-Tenant Event authority'
  );
  SELECT allowed INTO v_task_allowed
  FROM public.resolve_task_authority(
    auth.uid(), 'event.definition.manage', '91000000-0000-4000-8000-000000000001'
  );
  PERFORM public.t9_fixture_assert(
    v_task_allowed,
    'Tenant appointment reaches unchanged tenant-inherited task authority'
  );

  SELECT * INTO v_created
  FROM public.create_event_for_tenant(
    '90000000-0000-4000-8000-000000000001',
    'T9 Provisioned Event', current_date + 30, 'UTC'
  );
  PERFORM public.t9_fixture_assert(
    v_created.tenant_id = '90000000-0000-4000-8000-000000000001'::uuid
    AND public.has_event_admin_authority(auth.uid(), v_created.id),
    'T5 creation keeps explicit Tenant ownership and inherits Event administration'
  );
  INSERT INTO t9_created_events (id, tenant_id, actor_auth_user_id)
  VALUES (v_created.id, v_created.tenant_id, auth.uid());

  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000005', true);
  PERFORM public.t9_fixture_assert(
    NOT public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000002')
    AND NOT public.has_any_tenant_admin_authority(),
    'legacy-only Tenant Admin has no authority after cutover'
  );

  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
  PERFORM public.t9_fixture_assert(
    public.has_event_admin_authority(auth.uid(), '91000000-0000-4000-8000-000000000001')
    AND NOT public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000001'),
    'direct Event Admin remains Event-only'
  );
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '90000000-0000-4000-8000-000000000001',
      'T9 Direct Event Admin Denial', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Event creation requires active Platform or Tenant Admin authority.';
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'direct Event Admin cannot use T5 provisioning');

  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000004', true);
  PERFORM public.t9_fixture_assert(
    NOT public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000001'),
    'inactive Admin is denied despite retained appointment and legacy row'
  );
  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000006', true);
  PERFORM public.t9_fixture_assert(
    NOT public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000001'),
    'inactive Person is denied despite retained appointment and legacy row'
  );

  v_failed := false;
  BEGIN
    INSERT INTO public.events (tenant_id, name, end_date, timezone)
    VALUES (
      '90000000-0000-4000-8000-000000000001',
      'T9 Raw Authenticated Insert', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'raw authenticated Event INSERT remains closed');
END;
$fixture$;
RESET ROLE;

DO $fixture$
BEGIN
  PERFORM public.t9_fixture_assert(
    EXISTS (
      SELECT 1
      FROM t9_created_events AS created
      JOIN public.event_definition_command_audit AS a
        ON a.event_id = created.id
       AND a.tenant_id = created.tenant_id
       AND a.actor_auth_user_id = created.actor_auth_user_id
       AND a.action = 'event_created'
    ),
    'T5 creation retains immutable authenticated actor evidence'
  );
END;
$fixture$;

SET LOCAL ROLE authenticated;
DO $fixture$
DECLARE
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
  PERFORM public.t9_fixture_assert(
    EXISTS (
      SELECT 1
      FROM public.list_eligible_person_tenant_administrator_candidates_for_administration()
      WHERE person_id = '94000000-0000-4000-8000-000000000001'
        AND admin_user_id = '93000000-0000-4000-8000-000000000002'
    )
    AND EXISTS (
      SELECT 1
      FROM public.list_tenant_administrator_appointments_for_administration(
        '90000000-0000-4000-8000-000000000001'
      )
      WHERE person_id = '94000000-0000-4000-8000-000000000001'
        AND appointment_is_active AND is_effective
    ),
    'T3 appointment reads use canonical Person identity only'
  );

  PERFORM public.set_person_tenant_administrator_appointment(
    '94000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002',
    true, 'T9 multi-Tenant appointment'
  );
  PERFORM public.set_person_tenant_administrator_appointment(
    '94000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002',
    true, 'T9 unchanged appointment'
  );
  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
  PERFORM public.t9_fixture_assert(
    public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000002')
    AND (SELECT count(*) FROM public.list_my_tenant_admin_access()
         WHERE tenant_id = '90000000-0000-4000-8000-000000000002') = 1,
    'multi-Tenant authority is independently derived per appointment'
  );

  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
  PERFORM public.set_person_tenant_administrator_appointment(
    '94000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002',
    false, 'T9 revoke second Tenant'
  );
  PERFORM public.t9_fixture_assert(
    NOT public.has_tenant_admin_authority(
      '92000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000002'
    ),
    'revoked appointment denies ordinary authority'
  );
  PERFORM public.set_person_tenant_administrator_appointment(
    '94000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002',
    true, 'T9 reactivate second Tenant'
  );
  PERFORM public.t9_fixture_assert(
    public.has_tenant_admin_authority(
      '92000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000002'
    ),
    'reactivation restores derived ordinary authority'
  );

  PERFORM public.set_person_tenant_administrator_appointment(
    '94000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000003',
    true, 'T9 inactive Tenant retained appointment'
  );
  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
  PERFORM public.t9_fixture_assert(
    NOT public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000003'),
    'inactive Tenant denies ordinary appointment authority'
  );

  PERFORM set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
  PERFORM public.t9_fixture_assert(
    public.has_tenant_admin_authority(auth.uid(), '90000000-0000-4000-8000-000000000003')
    AND (SELECT count(*) FROM public.list_my_tenant_admin_access()) = (
      SELECT count(*) FROM public.tenants WHERE is_active
    ),
    'Platform recovery remains independent and T6 list stays active-Tenant scoped'
  );
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '90000000-0000-4000-8000-000000000003',
      'T9 Inactive Tenant Provisioning Denial', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN others THEN
    v_failed := SQLERRM = 'Owning Tenant must be active.';
  END;
  PERFORM public.t9_fixture_assert(v_failed, 'T5 preserves inactive-Tenant denial');

  v_failed := false;
  BEGIN
    PERFORM public.set_tenant_admin_access(
      '93000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000001',
      true, NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  PERFORM public.t9_fixture_assert(
    v_failed,
    'retired legacy setter has no authenticated execution surface'
  );
END;
$fixture$;
RESET ROLE;

DO $fixture$
BEGIN
  PERFORM public.t9_fixture_assert(
    (SELECT count(*) FROM public.person_tenant_administrator_appointments
     WHERE person_id = '94000000-0000-4000-8000-000000000001'
       AND tenant_id = '90000000-0000-4000-8000-000000000002') = 1
    AND (SELECT count(*) FROM public.person_tenant_administrator_appointment_audit
         WHERE person_id = '94000000-0000-4000-8000-000000000001'
           AND tenant_id = '90000000-0000-4000-8000-000000000002') = 4
    AND NOT EXISTS (
      (SELECT id, row_hash FROM t9_legacy_after_cutover_setup
       EXCEPT
       SELECT id, md5(to_jsonb(ata)::text) FROM public.admin_tenant_access AS ata)
      UNION ALL
      (SELECT id, md5(to_jsonb(ata)::text) FROM public.admin_tenant_access AS ata
       EXCEPT
       SELECT id, row_hash FROM t9_legacy_after_cutover_setup)
    ),
    'appointment lifecycle never mutates legacy assignments, duplicates lineage, or omits audit evidence'
  );
END;
$fixture$;

SET LOCAL ROLE anon;
DO $fixture$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.has_any_tenant_admin_authority();
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'T9 assertion failed: anonymous caller has no Tenant authority execution surface';
  END IF;
END;
$fixture$;
RESET ROLE;

DO $fixture$
BEGIN
  PERFORM public.t9_fixture_assert(
    NOT EXISTS (
      (SELECT id, row_hash FROM t9_preexisting_legacy_snapshot
       EXCEPT
       SELECT id, md5(to_jsonb(ata)::text)
       FROM public.admin_tenant_access AS ata
       WHERE ata.id IN (SELECT id FROM t9_preexisting_legacy_snapshot))
      UNION ALL
      (SELECT id, md5(to_jsonb(ata)::text)
       FROM public.admin_tenant_access AS ata
       WHERE ata.id IN (SELECT id FROM t9_preexisting_legacy_snapshot)
       EXCEPT
       SELECT id, row_hash FROM t9_preexisting_legacy_snapshot)
    ),
    'pre-existing legacy evidence remains byte/value-equivalent'
  );
  PERFORM public.t9_fixture_assert(
    NOT EXISTS (
      (SELECT id, tenant_id, row_hash FROM t9_preexisting_event_snapshot
       EXCEPT
       SELECT id, tenant_id, md5(to_jsonb(e)::text)
       FROM public.events AS e
       WHERE e.id IN (SELECT id FROM t9_preexisting_event_snapshot))
      UNION ALL
      (SELECT id, tenant_id, md5(to_jsonb(e)::text)
       FROM public.events AS e
       WHERE e.id IN (SELECT id FROM t9_preexisting_event_snapshot)
       EXCEPT
       SELECT id, tenant_id, row_hash FROM t9_preexisting_event_snapshot)
    ),
    'pre-existing Event rows remain byte/value-equivalent'
  );
  PERFORM public.t9_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM public.events AS e
      WHERE e.id = '91000000-0000-4000-8000-000000000001'
        AND e.tenant_id <> '90000000-0000-4000-8000-000000000001'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.events AS e
      WHERE e.id = '91000000-0000-4000-8000-000000000002'
        AND e.tenant_id <> '90000000-0000-4000-8000-000000000002'
    ),
    'no fixture Event ownership is copied or reassigned'
  );
END;
$fixture$;

ROLLBACK;
