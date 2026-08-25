-- Tenant T9: atomic Person-backed Tenant Administrator authority cutover.
--
-- ADR-015 requires exactly one ordinary Tenant-authority source. This
-- migration first proves live parity between active legacy assignments and
-- active canonical Person x Tenant appointments, then replaces the ordinary
-- resolver/read surface in this same transaction. Platform recovery remains a
-- separate authority path. Legacy assignments are retained as history only.

BEGIN;

-- ============================================================
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
-- ============================================================

COMMIT;
