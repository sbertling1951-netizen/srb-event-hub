-- Tenant T2 linked-database rollback proof.
-- Installs the exact pending T2 definitions, exercises isolated active,
-- inactive, Platform-recovery, member/public, isolation, and reactivation
-- cases, and rolls every definition and fixture row back.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

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

  IF public.has_platform_admin_authority(p_auth_user_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_tenant_access AS ata
    JOIN public.admin_users AS au ON au.id = ata.admin_user_id
    JOIN public.tenants AS t ON t.id = ata.tenant_id
    WHERE au.user_id = p_auth_user_id
      AND au.is_active = true
      AND ata.tenant_id = p_tenant_id
      AND ata.is_active = true
      AND t.is_active = true
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
    FROM public.admin_tenant_access AS ata
    JOIN public.admin_users AS au ON au.id = ata.admin_user_id
    JOIN public.tenants AS t ON t.id = ata.tenant_id
    WHERE au.user_id = v_uid
      AND au.is_active = true
      AND ata.is_active = true
      AND t.is_active = true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_event_admin_authority(
  p_auth_user_id uuid,
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_tenant_is_active boolean;
BEGIN
  IF p_auth_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_platform_admin_authority(p_auth_user_id) THEN
    RETURN true;
  END IF;

  SELECT e.tenant_id, t.is_active
    INTO v_tenant_id, v_tenant_is_active
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.id = p_event_id;

  IF NOT FOUND OR v_tenant_is_active IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF public.has_tenant_admin_authority(p_auth_user_id, v_tenant_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    JOIN public.admin_event_access AS aea ON aea.admin_user_id = au.id
    WHERE au.user_id = p_auth_user_id
      AND au.is_active = true
      AND aea.event_id = p_event_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_task_authority(
  p_actor_auth_user_id uuid,
  p_task_key text,
  p_event_id uuid
)
RETURNS TABLE(
  allowed boolean,
  decision_branch text,
  task_key text,
  event_id uuid,
  tenant_id uuid,
  admin_event_access_id uuid,
  admin_event_permission_id uuid,
  denial_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_task public.admin_task_registry%ROWTYPE;
  v_tenant uuid;
  v_tenant_is_active boolean;
  v_admin uuid;
  v_access uuid;
  v_grant uuid;
BEGIN
  allowed := false;
  decision_branch := 'denied';
  task_key := p_task_key;
  event_id := p_event_id;
  tenant_id := NULL;
  admin_event_access_id := NULL;
  admin_event_permission_id := NULL;

  IF p_actor_auth_user_id IS NULL OR p_task_key IS NULL OR p_event_id IS NULL THEN
    denial_reason := 'missing_input';
    RETURN NEXT;
    RETURN;
  END IF;

  IF auth.uid() IS DISTINCT FROM p_actor_auth_user_id THEN
    denial_reason := 'actor_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT r.*
    INTO v_task
  FROM public.admin_task_registry AS r
  WHERE r.task_key = p_task_key
    AND r.is_active;

  IF NOT FOUND THEN
    denial_reason := 'unknown_or_inactive_task';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT e.tenant_id, t.is_active
    INTO v_tenant, v_tenant_is_active
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.id = p_event_id;

  IF NOT FOUND OR v_tenant IS NULL THEN
    denial_reason := 'event_or_tenant_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  tenant_id := v_tenant;

  SELECT au.id
    INTO v_admin
  FROM public.admin_users AS au
  WHERE au.user_id = p_actor_auth_user_id
    AND au.is_active;

  IF NOT FOUND THEN
    denial_reason := 'inactive_or_missing_admin';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_task.platform_inherits
    AND public.has_platform_admin_authority(p_actor_auth_user_id) THEN
    allowed := true;
    decision_branch := 'platform';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_tenant_is_active IS DISTINCT FROM true THEN
    denial_reason := 'inactive_tenant';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_task.tenant_inherits
    AND public.has_tenant_admin_authority(p_actor_auth_user_id, v_tenant) THEN
    allowed := true;
    decision_branch := 'tenant';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT v_task.event_assignment_grantable THEN
    denial_reason := 'task_not_event_grantable';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT aea.id
    INTO v_access
  FROM public.admin_event_access AS aea
  WHERE aea.admin_user_id = v_admin
    AND aea.event_id = p_event_id;

  IF NOT FOUND THEN
    denial_reason := 'no_event_assignment';
    RETURN NEXT;
    RETURN;
  END IF;

  admin_event_access_id := v_access;

  SELECT aep.id
    INTO v_grant
  FROM public.admin_event_permissions AS aep
  WHERE aep.admin_event_access_id = v_access
    AND aep.permission_key = p_task_key
    AND aep.is_enabled;

  IF NOT FOUND THEN
    denial_reason := 'task_not_granted';
    RETURN NEXT;
    RETURN;
  END IF;

  allowed := true;
  decision_branch := 'event_grant';
  admin_event_permission_id := v_grant;
  RETURN NEXT;
END;
$function$;

-- Preserve the existing active-Tenant read for ordinary browser roles while
-- adding the Platform-only recovery branch. No Tenant write policy is added.
DROP POLICY IF EXISTS "Platform administrators can read inactive tenants"
  ON public.tenants;

CREATE POLICY "Platform administrators can read inactive tenants"
ON public.tenants
FOR SELECT
TO authenticated
USING (public.has_platform_admin_authority(auth.uid()));

CREATE OR REPLACE FUNCTION public.get_public_discoverable_events()
RETURNS TABLE(
  id uuid,
  name text,
  venue_name text,
  location text,
  start_date date,
  end_date date,
  lat numeric,
  lng numeric,
  map_image_url text,
  master_map_id uuid,
  locations_map_open_scale numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    e.venue_name,
    e.location,
    e.start_date,
    e.end_date,
    e.lat,
    e.lng,
    e.map_image_url,
    e.master_map_id,
    e.locations_map_open_scale
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE t.is_active = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN (
      'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
    )
  ORDER BY e.start_date ASC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_discoverable_events_for_tenant(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  name text,
  venue_name text,
  location text,
  start_date date,
  end_date date,
  map_image_url text,
  master_map_id uuid,
  locations_map_open_scale numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    e.venue_name,
    e.location,
    e.start_date,
    e.end_date,
    e.map_image_url,
    e.master_map_id,
    e.locations_map_open_scale
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.tenant_id = p_tenant_id
    AND t.is_active = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN (
      'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
    )
  ORDER BY e.start_date ASC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_continuity_context(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  name text,
  venue_name text,
  location text,
  start_date date,
  end_date date,
  lat numeric,
  lng numeric,
  map_image_url text,
  master_map_id uuid,
  coach_map_open_scale numeric,
  short_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    e.venue_name,
    e.location,
    e.start_date,
    e.end_date,
    e.lat,
    e.lng,
    e.map_image_url,
    e.master_map_id,
    e.coach_map_open_scale,
    e.short_name
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.id = p_event_id
    AND t.is_active = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN (
      'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_member_event_continuity_context(
  p_event_id uuid
)
RETURNS TABLE(
  id uuid,
  name text,
  venue_name text,
  location text,
  start_date date,
  end_date date,
  lat numeric,
  lng numeric,
  map_image_url text,
  master_map_id uuid,
  coach_map_open_scale numeric,
  short_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_link_status text;
  v_person_id uuid;
BEGIN
  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(auth.uid()) AS r;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.name,
    e.venue_name,
    e.location,
    e.start_date,
    e.end_date,
    e.lat,
    e.lng,
    e.map_image_url,
    e.master_map_id,
    e.coach_map_open_scale,
    e.short_name
  FROM public.person_event_participations AS pep
  JOIN public.events AS e ON e.id = pep.event_id
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE pep.person_id = v_person_id
    AND pep.event_id = p_event_id
    AND pep.participation_state = 'eligible'
    AND t.is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_tenant_owned_event_ids(
  p_event_ids uuid[],
  p_tenant_id uuid
)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_link_status text;
  v_person_id uuid;
BEGIN
  IF p_event_ids IS NULL OR p_tenant_id IS NULL THEN
    RETURN;
  END IF;

  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(auth.uid()) AS r;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT e.id
  FROM public.person_event_participations AS pep
  JOIN public.events AS e ON e.id = pep.event_id
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE pep.person_id = v_person_id
    AND pep.participation_state = 'eligible'
    AND e.id = ANY(p_event_ids)
    AND e.tenant_id = p_tenant_id
    AND t.is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_member_account()
RETURNS TABLE(
  attendee_id uuid,
  entry_id text,
  event_id uuid,
  email text,
  pilot_first text,
  pilot_last text,
  copilot_first text,
  copilot_last text,
  has_arrived boolean,
  event_name text,
  venue_name text,
  location text,
  start_date date,
  end_date date,
  lat numeric,
  lng numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_link_status text;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT r.status, r.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_uid) AS r;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    a.id,
    a.entry_id,
    a.event_id,
    a.email,
    a.pilot_first,
    a.pilot_last,
    a.copilot_first,
    a.copilot_last,
    a.has_arrived,
    e.name,
    e.venue_name,
    e.location,
    e.start_date,
    e.end_date,
    e.lat,
    e.lng
  FROM public.person_event_participations AS pep
  JOIN public.person_role_instances AS pri
    ON pri.person_id = pep.person_id
   AND pri.event_id = pep.event_id
  JOIN public.attendees AS a ON a.id = pri.attendee_id
  JOIN public.events AS e ON e.id = pep.event_id
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE pep.person_id = v_person_id
    AND pep.participation_state = 'eligible'
    AND t.is_active = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
  ORDER BY e.start_date DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_temporary_or_authenticated_attendee(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_verified_attendee_id uuid;
  v_match_count integer;
  v_match_ids uuid[];
  v_identifier_is_email boolean;
  v_normalized_email text;
  v_normalized_phone text;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS e
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE e.id = p_event_id
      AND t.is_active = true
  ) THEN
    RETURN NULL;
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';

    IF v_person_id IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT count(*), array_agg(a.id)
      INTO v_match_count, v_match_ids
    FROM public.attendees AS a
    JOIN public.events AS e ON e.id = a.event_id
    WHERE a.person_id = v_person_id
      AND a.event_id = p_event_id
      AND coalesce(a.is_active, true) = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true;

    IF v_match_count <> 1 THEN
      RETURN NULL;
    END IF;

    v_verified_attendee_id := v_match_ids[1];
  ELSE
    IF nullif(btrim(p_event_code), '') IS NULL
      OR nullif(btrim(p_registration_identifier), '') IS NULL THEN
      RETURN NULL;
    END IF;

    v_identifier_is_email := position('@' IN btrim(p_registration_identifier)) > 0;

    IF v_identifier_is_email THEN
      v_normalized_email := lower(btrim(p_registration_identifier));

      IF position('@' IN v_normalized_email) = 1
        OR position('@' IN v_normalized_email) = length(v_normalized_email) THEN
        RETURN NULL;
      END IF;
    ELSE
      v_normalized_phone := regexp_replace(
        btrim(p_registration_identifier),
        '[^0-9]',
        '',
        'g'
      );

      IF length(v_normalized_phone) = 11
        AND left(v_normalized_phone, 1) = '1' THEN
        v_normalized_phone := substring(v_normalized_phone FROM 2);
      END IF;

      IF v_normalized_phone = '' THEN
        RETURN NULL;
      END IF;
    END IF;

    WITH primary_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendees AS a
      JOIN public.events AS e ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND (
              lower(btrim(coalesce(a.email, ''))) = v_normalized_email
              OR lower(btrim(coalesce(a.copilot_email, ''))) = v_normalized_email
            )
          )
          OR (
            NOT v_identifier_is_email
            AND (
              CASE
                WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
            )
          )
        )
    ),
    household_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendee_household_members AS hm
      JOIN public.attendees AS a ON a.id = hm.attendee_id
      JOIN public.events AS e ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND lower(btrim(coalesce(hm.email, ''))) = v_normalized_email
          )
          OR (
            NOT v_identifier_is_email
            AND CASE
              WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
                AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
              THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
              ELSE regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')
            END = v_normalized_phone
          )
        )
    ),
    verified_matches AS (
      SELECT attendee_id FROM primary_matches
      UNION
      SELECT attendee_id FROM household_matches
    )
    SELECT count(*), array_agg(attendee_id)
      INTO v_match_count, v_match_ids
    FROM verified_matches;

    IF v_match_count <> 1 THEN
      RETURN NULL;
    END IF;

    v_verified_attendee_id := v_match_ids[1];
  END IF;

  RETURN v_verified_attendee_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_member_event_login(
  p_event_id uuid,
  p_event_code text,
  p_identifier text
)
RETURNS TABLE(
  id uuid,
  entry_id text,
  email text,
  pilot_first text,
  pilot_last text,
  copilot_first text,
  copilot_last text,
  has_arrived boolean,
  auth_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_normalized_email text;
  v_normalized_phone text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS e
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE e.id = p_event_id
      AND t.is_active = true
  ) THEN
    RETURN;
  END IF;

  v_normalized_email := lower(trim(coalesce(p_identifier, '')));
  v_normalized_phone := regexp_replace(coalesce(p_identifier, ''), '[^0-9]', '', 'g');

  IF length(v_normalized_phone) = 11
    AND left(v_normalized_phone, 1) = '1' THEN
    v_normalized_phone := substring(v_normalized_phone FROM 2);
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.entry_id,
    a.email,
    a.pilot_first,
    a.pilot_last,
    a.copilot_first,
    a.copilot_last,
    a.has_arrived,
    a.auth_user_id
  FROM public.attendees AS a
  JOIN public.events AS e ON e.id = a.event_id
  WHERE e.id = p_event_id
    AND lower(trim(coalesce(e.event_code, ''))) = lower(trim(coalesce(p_event_code, '')))
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND (
      lower(trim(coalesce(a.email, ''))) = v_normalized_email
      OR lower(trim(coalesce(a.copilot_email, ''))) = v_normalized_email
      OR (
        v_normalized_phone <> ''
        AND (
          CASE
            WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
              AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
            THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') FROM 2)
            ELSE regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')
          END = v_normalized_phone
          OR CASE
            WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
              AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
            THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') FROM 2)
            ELSE regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')
          END = v_normalized_phone
          OR CASE
            WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
              AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
            THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
            ELSE regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')
          END = v_normalized_phone
          OR CASE
            WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
              AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
            THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
            ELSE regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')
          END = v_normalized_phone
        )
      )
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.entry_id,
    a.email,
    a.pilot_first,
    a.pilot_last,
    a.copilot_first,
    a.copilot_last,
    a.has_arrived,
    a.auth_user_id
  FROM public.attendee_household_members AS hm
  JOIN public.attendees AS a ON a.id = hm.attendee_id
  JOIN public.events AS e ON e.id = a.event_id
  WHERE e.id = p_event_id
    AND lower(trim(coalesce(e.event_code, ''))) = lower(trim(coalesce(p_event_code, '')))
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND (
      lower(trim(coalesce(hm.email, ''))) = v_normalized_email
      OR (
        v_normalized_phone <> ''
        AND CASE
          WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')
        END = v_normalized_phone
      )
    )
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_member_checkin(
  p_event_id uuid,
  p_expected_attendee_id uuid,
  p_has_arrived boolean,
  p_share_with_attendees boolean,
  p_assigned_site text,
  p_tenant_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  assigned_site text,
  share_with_attendees boolean,
  has_arrived boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_verified_attendee_id uuid;
  v_match_count integer;
  v_match_ids uuid[];
  v_identifier_is_email boolean;
  v_normalized_email text;
  v_normalized_phone text;
  v_authorization_basis text;
  v_previous_has_arrived boolean;
  v_previous_share_with_attendees boolean;
  v_previous_assigned_site text;
  v_previous_arrival_status text;
  v_updated_id uuid;
  v_updated_assigned_site text;
  v_updated_share_with_attendees boolean;
  v_updated_has_arrived boolean;
  v_updated_arrival_status text;
BEGIN
  IF p_event_id IS NULL
    OR p_expected_attendee_id IS NULL
    OR p_has_arrived IS NULL
    OR p_share_with_attendees IS NULL
    OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  -- Independent Tenant re-verification. p_tenant_id is a value the caller
  -- supplies, but this check gives it no authority by itself: it only
  -- succeeds when the Event this call targets is actually, currently owned
  -- by that Tenant in public.events. A caller cannot widen its own access
  -- by asserting a different Tenant ID -- it can only ever narrow the same
  -- Event/Person/Attendee checks already enforced below to Events that
  -- Tenant genuinely owns.
  SELECT count(*)
    INTO v_match_count
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.id = p_event_id
    AND e.tenant_id = p_tenant_id
    AND t.is_active = true;

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    v_authorization_basis := 'authenticated';

    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';

    IF v_person_id IS NULL THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    SELECT count(*)
      INTO v_match_count
    FROM public.attendees AS a
    JOIN public.events AS e
      ON e.id = a.event_id
    WHERE a.id = p_expected_attendee_id
      AND a.person_id = v_person_id
      AND a.event_id = p_event_id
      AND coalesce(a.is_active, true) = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true;

    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_verified_attendee_id := p_expected_attendee_id;
  ELSE
    v_authorization_basis := 'temporary';

    IF nullif(btrim(p_event_code), '') IS NULL
      OR nullif(btrim(p_registration_identifier), '') IS NULL THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_identifier_is_email := position('@' IN btrim(p_registration_identifier)) > 0;

    IF v_identifier_is_email THEN
      v_normalized_email := lower(btrim(p_registration_identifier));

      IF position('@' IN v_normalized_email) = 1
        OR position('@' IN v_normalized_email) = length(v_normalized_email) THEN
        RAISE EXCEPTION 'Member check-in verification failed.';
      END IF;
    ELSE
      v_normalized_phone := regexp_replace(
        btrim(p_registration_identifier),
        '[^0-9]',
        '',
        'g'
      );

      IF length(v_normalized_phone) = 11
        AND left(v_normalized_phone, 1) = '1' THEN
        v_normalized_phone := substring(v_normalized_phone FROM 2);
      END IF;

      IF v_normalized_phone = '' THEN
        RAISE EXCEPTION 'Member check-in verification failed.';
      END IF;
    END IF;

    WITH primary_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendees AS a
      JOIN public.events AS e
        ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND (
              lower(btrim(coalesce(a.email, ''))) = v_normalized_email
              OR lower(btrim(coalesce(a.copilot_email, ''))) = v_normalized_email
            )
          )
          OR (
            NOT v_identifier_is_email
            AND (
              CASE
                WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
            )
          )
        )
    ),
    household_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendee_household_members AS hm
      JOIN public.attendees AS a
        ON a.id = hm.attendee_id
      JOIN public.events AS e
        ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND lower(btrim(coalesce(hm.email, ''))) = v_normalized_email
          )
          OR (
            NOT v_identifier_is_email
            AND CASE
              WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
                AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
              THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
              ELSE regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')
            END = v_normalized_phone
          )
        )
    ),
    verified_matches AS (
      SELECT attendee_id FROM primary_matches
      UNION
      SELECT attendee_id FROM household_matches
    )
    SELECT count(*), array_agg(attendee_id)
      INTO v_match_count, v_match_ids
    FROM verified_matches;

    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_verified_attendee_id := v_match_ids[1];

    IF v_verified_attendee_id IS DISTINCT FROM p_expected_attendee_id THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;
  END IF;

  -- Member-reported site: non-authoritative evidence only (Site Assignment
  -- Governance Architecture §7; Site Placement Implementation Specification
  -- §3.1/§9.2). This never touches parking_sites or attendees.assigned_site
  -- -- it writes only the append-only member_site_reports evidence table,
  -- using the identity/Event/Tenant context already verified above. Blank
  -- input creates no report (the helper itself enforces this).
  PERFORM public._record_member_site_report(
    p_event_id,
    v_verified_attendee_id,
    p_assigned_site,
    v_authorization_basis,
    v_person_id,
    v_uid
  );

  SELECT
    a.has_arrived,
    a.share_with_attendees,
    a.assigned_site,
    a.arrival_status
  INTO
    v_previous_has_arrived,
    v_previous_share_with_attendees,
    v_previous_assigned_site,
    v_previous_arrival_status
  FROM public.attendees AS a
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  -- Arrival-owned columns only. assigned_site is deliberately absent from
  -- this SET clause -- Member Check-In no longer writes canonical
  -- placement or its compatibility projection in any form.
  UPDATE public.attendees AS a
  SET has_arrived = p_has_arrived,
      share_with_attendees = p_share_with_attendees,
      arrival_status = CASE
        WHEN p_has_arrived THEN 'arrived'
        ELSE 'not_arrived'
      END
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id
  RETURNING
    a.id,
    a.assigned_site,
    a.share_with_attendees,
    a.has_arrived,
    a.arrival_status
  INTO
    v_updated_id,
    v_updated_assigned_site,
    v_updated_share_with_attendees,
    v_updated_has_arrived,
    v_updated_arrival_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  INSERT INTO public.member_checkin_audit (
    event_id,
    attendee_id,
    authorization_basis,
    actor_person_id,
    actor_auth_user_id,
    changed_fields,
    previous_values,
    new_values
  )
  VALUES (
    p_event_id,
    v_verified_attendee_id,
    v_authorization_basis,
    v_person_id,
    v_uid,
    -- assigned_site can never appear here -- this function no longer
    -- writes it, so previous and updated values are always identical.
    array_remove(ARRAY[
      CASE WHEN v_previous_has_arrived IS DISTINCT FROM v_updated_has_arrived THEN 'has_arrived' END,
      CASE WHEN v_previous_share_with_attendees IS DISTINCT FROM v_updated_share_with_attendees THEN 'share_with_attendees' END,
      CASE WHEN v_previous_arrival_status IS DISTINCT FROM v_updated_arrival_status THEN 'arrival_status' END
    ], NULL),
    jsonb_build_object(
      'has_arrived', v_previous_has_arrived,
      'share_with_attendees', v_previous_share_with_attendees,
      'assigned_site', v_previous_assigned_site,
      'arrival_status', v_previous_arrival_status
    ),
    jsonb_build_object(
      'has_arrived', v_updated_has_arrived,
      'share_with_attendees', v_updated_share_with_attendees,
      'assigned_site', v_updated_assigned_site,
      'arrival_status', v_updated_arrival_status
    )
  );

  RETURN QUERY
  SELECT
    v_updated_id,
    v_updated_assigned_site,
    v_updated_share_with_attendees,
    v_updated_has_arrived;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_public_map_sites(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  master_site_id uuid,
  site_number text,
  display_label text,
  map_x numeric,
  map_y numeric,
  is_occupied boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT
    s.id,
    s.master_site_id,
    s.site_number,
    s.display_label,
    s.map_x,
    s.map_y,
    s.assigned_attendee_id IS NOT NULL
  FROM public.parking_sites AS s
  JOIN public.events AS e ON e.id = s.event_id
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE s.event_id = p_event_id
    AND t.is_active = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
$$;

CREATE OR REPLACE FUNCTION public.resolve_effective_nearby_places(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  address text,
  phone text,
  website text,
  category text,
  notes text,
  distance_miles numeric,
  location_code text,
  is_hidden boolean,
  lat numeric,
  lng numeric,
  sort_order integer,
  origin text,
  category_id uuid,
  category_code text,
  category_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS e
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE e.id = p_event_id
      AND t.is_active = true
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT enp.id, enp.name, enp.address, enp.phone, enp.website, enp.category, enp.notes,
         enp.distance_miles, enp.location_code, enp.is_hidden, enp.lat, enp.lng, enp.sort_order,
         'event_specific'::text AS origin,
         enp.category_id, pc.code AS category_code, pc.label AS category_label
  FROM public.event_nearby_places AS enp
  LEFT JOIN public.place_categories AS pc ON pc.id = enp.category_id
  WHERE enp.event_id = p_event_id
    AND enp.is_hidden = false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_effective_event_locations(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  event_id uuid,
  name text,
  category text,
  description text,
  map_x numeric,
  map_y numeric,
  priority integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  -- Same admission predicate as get_event_continuity_context and
  -- verify_member_event_login's own Event-code gate -- never trusts
  -- p_event_id alone. An Event that fails this predicate returns zero
  -- Location rows, matching what get_event_continuity_context would
  -- already have refused during Event resolution.
  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE e.id = p_event_id
      AND t.is_active = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true
      AND lower(trim(coalesce(e.status, ''))) NOT IN (
        'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT el.id, el.event_id, el.name, el.category, el.description, el.map_x, el.map_y, el.priority
  FROM public.event_locations AS el
  WHERE el.event_id = p_event_id
  ORDER BY el.priority ASC, el.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_attendee_visible_vendor_notices(p_event_id uuid)
RETURNS TABLE(
  vendor_id uuid,
  status_type text,
  message text,
  expires_at timestamptz,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  -- Same admission predicate as get_event_continuity_context and the
  -- other Temporary Event Access reconciliations -- never trusts
  -- p_event_id alone.
  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE e.id = p_event_id
      AND t.is_active = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true
      AND lower(trim(coalesce(e.status, ''))) NOT IN (
        'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ves.vendor_id, ves.status_type, ves.message, ves.expires_at, ves.is_active
  FROM public.vendor_event_status AS ves
  JOIN public.event_vendors AS ev
    ON ev.event_id = ves.event_id AND ev.vendor_id = ves.vendor_id
  JOIN public.vendors AS v ON v.id = ves.vendor_id
  WHERE ves.event_id = p_event_id
    AND ev.is_visible_to_members IS NOT FALSE
    AND v.is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_public_presentation_session(p_session_id uuid)
RETURNS TABLE (
  session_active boolean,
  event_id uuid,
  playback_state text,
  state_version bigint,
  item_count integer,
  sequence_number integer,
  current_content_type text,
  current_content_ref_id uuid,
  current_storage_path text,
  current_duration_ms integer,
  next_content_type text,
  next_content_ref_id uuid,
  next_storage_path text,
  next_duration_ms integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_session public.presentation_sessions%ROWTYPE;
  v_item_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.presentation_sessions AS ps
    JOIN public.events AS e ON e.id = ps.event_id
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE ps.id = p_session_id
      AND t.is_active = true
  ) THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::text, NULL::bigint, NULL::integer, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  PERFORM public.advance_presentation_session_if_due_internal(p_session_id);

  SELECT * INTO v_session FROM public.presentation_sessions WHERE id = p_session_id;

  IF NOT FOUND OR v_session.status <> 'live' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::text, NULL::bigint, NULL::integer, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = p_session_id;

  RETURN QUERY
  SELECT
    true,
    v_session.event_id,
    v_session.playback_state,
    v_session.state_version,
    v_item_count,
    v_session.current_index,
    cur.content_type,
    cur.content_ref_id,
    CASE WHEN cur.content_type = 'photo' THEN ep_cur.storage_path ELSE NULL END,
    cur.duration_ms,
    nxt.content_type,
    nxt.content_ref_id,
    CASE WHEN nxt.content_type = 'photo' THEN ep_nxt.storage_path ELSE NULL END,
    nxt.duration_ms
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.presentation_session_items cur
    ON cur.session_id = p_session_id AND cur.sequence_number = v_session.current_index
  LEFT JOIN public.event_photos ep_cur
    ON ep_cur.id = cur.content_ref_id AND ep_cur.photo_status = 'approved'
  LEFT JOIN public.presentation_session_items nxt
    ON nxt.session_id = p_session_id AND nxt.sequence_number = v_session.current_index + 1
  LEFT JOIN public.event_photos ep_nxt
    ON ep_nxt.id = nxt.content_ref_id AND ep_nxt.photo_status = 'approved';
END;
$$;

ALTER FUNCTION public.has_tenant_admin_authority(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.has_any_tenant_admin_authority() OWNER TO postgres;
ALTER FUNCTION public.has_event_admin_authority(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.resolve_task_authority(uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_public_discoverable_events() OWNER TO postgres;
ALTER FUNCTION public.get_public_discoverable_events_for_tenant(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_event_continuity_context(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_my_member_event_continuity_context(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) OWNER TO postgres;
ALTER FUNCTION public.resolve_member_account() OWNER TO postgres;
ALTER FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.verify_member_event_login(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.get_event_public_map_sites(uuid) OWNER TO postgres;
ALTER FUNCTION public.resolve_effective_nearby_places(uuid) OWNER TO postgres;
ALTER FUNCTION public.resolve_effective_event_locations(uuid) OWNER TO postgres;
ALTER FUNCTION public.resolve_attendee_visible_vendor_notices(uuid) OWNER TO postgres;
ALTER FUNCTION public.read_public_presentation_session(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.has_tenant_admin_authority(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_any_tenant_admin_authority()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_event_admin_authority(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_task_authority(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_discoverable_events()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_discoverable_events_for_tenant(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_event_continuity_context(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_member_event_continuity_context(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_member_account()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_member_event_login(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_event_public_map_sites(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_effective_nearby_places(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_effective_event_locations(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_attendee_visible_vendor_notices(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_public_presentation_session(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.has_tenant_admin_authority(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_tenant_admin_authority()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_event_admin_authority(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_task_authority(uuid, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_discoverable_events()
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_discoverable_events_for_tenant(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_continuity_context(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_member_event_continuity_context(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_member_account()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_member_event_login(uuid, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_public_map_sites(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_effective_nearby_places(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_effective_event_locations(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_attendee_visible_vendor_notices(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_presentation_session(uuid)
  TO anon, authenticated;

-- ============================================================
-- PARITY END

-- ============================================================
-- Isolated T2 fixtures and assertion helper
-- ============================================================

CREATE FUNCTION public.t2_inactive_tenant_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'T2 assertion failed: %', p_message;
  END IF;
END;
$$;

ALTER FUNCTION public.t2_inactive_tenant_fixture_assert(boolean, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t2_inactive_tenant_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t2_inactive_tenant_fixture_assert(boolean, text)
  TO anon, authenticated, service_role;

CREATE FUNCTION public.t2_member_checkin_audit_count(p_attendee_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT count(*)
  FROM public.member_checkin_audit AS mca
  WHERE mca.attendee_id = p_attendee_id;
$$;

ALTER FUNCTION public.t2_member_checkin_audit_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t2_member_checkin_audit_count(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t2_member_checkin_audit_count(uuid)
  TO authenticated;

CREATE FUNCTION public.t2_attendee_has_arrived(p_attendee_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT a.has_arrived
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id;
$$;

ALTER FUNCTION public.t2_attendee_has_arrived(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t2_attendee_has_arrived(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t2_attendee_has_arrived(uuid)
  TO authenticated;

DO $$
BEGIN
  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM public.tenants
      WHERE organization_code LIKE 'T2-FREEZE-%'
    ),
    'fixture Tenant codes must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title,
    is_active
  ) VALUES
    ('51000000-0000-4000-8000-000000000001', 'T2-FREEZE-A',
     't2-freeze-a', 'T2 Active Tenant A', 'T2 Active A', 'T2 Active A', true),
    ('51000000-0000-4000-8000-000000000002', 'T2-FREEZE-B',
     't2-freeze-b', 'T2 Active Tenant B', 'T2 Active B', 'T2 Active B', true),
    ('51000000-0000-4000-8000-000000000003', 'T2-FREEZE-INACTIVE',
     't2-freeze-inactive', 'T2 Inactive Tenant',
     'T2 Inactive', 'T2 Inactive', false);

  INSERT INTO public.events (
    id, tenant_id, name, start_date, end_date, timezone, lifecycle_state,
    status, visible_to_members, is_active, event_code, location
  ) VALUES
    ('52000000-0000-4000-8000-000000000001',
     '51000000-0000-4000-8000-000000000001',
     'T2 Active Event A1', current_date, current_date + 10, 'UTC',
     'operational', 'active', true, true, 'T2-A1', 'A1'),
    ('52000000-0000-4000-8000-000000000002',
     '51000000-0000-4000-8000-000000000001',
     'T2 Closed Event A2', current_date, current_date + 10, 'UTC',
     'operational', 'closed', true, true, 'T2-A2', 'A2'),
    ('52000000-0000-4000-8000-000000000003',
     '51000000-0000-4000-8000-000000000002',
     'T2 Active Event B1', current_date, current_date + 10, 'UTC',
     'operational', 'active', true, true, 'T2-B1', 'B1'),
    ('52000000-0000-4000-8000-000000000004',
     '51000000-0000-4000-8000-000000000003',
     'T2 Frozen Tenant Event', current_date, current_date + 10, 'UTC',
     'operational', 'active', true, true, 'T2-C1', 'C1');

  INSERT INTO auth.users (id, email) VALUES
    ('54000000-0000-4000-8000-000000000001', 't2-platform@fixture.invalid'),
    ('54000000-0000-4000-8000-000000000002', 't2-tenant-a@fixture.invalid'),
    ('54000000-0000-4000-8000-000000000003', 't2-direct-a@fixture.invalid'),
    ('54000000-0000-4000-8000-000000000004', 't2-tenant-b@fixture.invalid'),
    ('54000000-0000-4000-8000-000000000005', 't2-tenant-c@fixture.invalid'),
    ('54000000-0000-4000-8000-000000000006', 't2-direct-c@fixture.invalid'),
    ('54000000-0000-4000-8000-000000000007', 't2-member@fixture.invalid'),
    ('54000000-0000-4000-8000-000000000008', 't2-neither@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id,
    privilege_group
  ) VALUES
    ('53000000-0000-4000-8000-000000000001',
     't2-platform@fixture.invalid', 'T2 Platform', true, true,
     '54000000-0000-4000-8000-000000000001', 'super_admin'),
    ('53000000-0000-4000-8000-000000000002',
     't2-tenant-a@fixture.invalid', 'T2 Tenant A Admin', true, false,
     '54000000-0000-4000-8000-000000000002', 'event_admin'),
    ('53000000-0000-4000-8000-000000000003',
     't2-direct-a@fixture.invalid', 'T2 Direct A Admin', true, false,
     '54000000-0000-4000-8000-000000000003', 'event_admin'),
    ('53000000-0000-4000-8000-000000000004',
     't2-tenant-b@fixture.invalid', 'T2 Tenant B Admin', true, false,
     '54000000-0000-4000-8000-000000000004', 'event_admin'),
    ('53000000-0000-4000-8000-000000000005',
     't2-tenant-c@fixture.invalid', 'T2 Tenant C Admin', true, false,
     '54000000-0000-4000-8000-000000000005', 'event_admin'),
    ('53000000-0000-4000-8000-000000000006',
     't2-direct-c@fixture.invalid', 'T2 Direct C Admin', true, false,
     '54000000-0000-4000-8000-000000000006', 'event_admin'),
    ('53000000-0000-4000-8000-000000000008',
     't2-neither@fixture.invalid', 'T2 Neither Admin', true, false,
     '54000000-0000-4000-8000-000000000008', 'event_admin');

  INSERT INTO public.admin_tenant_access (
    admin_user_id, tenant_id, is_active, created_by
  ) VALUES
    ('53000000-0000-4000-8000-000000000002',
     '51000000-0000-4000-8000-000000000001', true, 't2-fixture'),
    ('53000000-0000-4000-8000-000000000004',
     '51000000-0000-4000-8000-000000000002', true, 't2-fixture'),
    ('53000000-0000-4000-8000-000000000005',
     '51000000-0000-4000-8000-000000000003', true, 't2-fixture');

  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role)
  VALUES
    ('57000000-0000-4000-8000-000000000001',
     '53000000-0000-4000-8000-000000000003',
     '52000000-0000-4000-8000-000000000001', 'event_admin'),
    ('57000000-0000-4000-8000-000000000002',
     '53000000-0000-4000-8000-000000000006',
     '52000000-0000-4000-8000-000000000004', 'event_admin');

  INSERT INTO public.admin_event_permissions (
    admin_event_access_id, permission_key, is_enabled
  ) VALUES
    ('57000000-0000-4000-8000-000000000001', 'event.vendors.manage', true),
    ('57000000-0000-4000-8000-000000000002', 'event.vendors.manage', true);

  INSERT INTO public.tenant_hostname_mappings (
    id, hostname, tenant_id, is_active
  ) VALUES (
    '58000000-0000-4000-8000-000000000001',
    't2-inactive.fixture.invalid',
    '51000000-0000-4000-8000-000000000003',
    true
  );

  INSERT INTO public.people (
    id, tenant_id, display_first_name, display_last_name
  ) VALUES (
    '55000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    'T2', 'Member'
  );

  INSERT INTO public.person_auth_accounts (
    id, person_id, auth_user_id, status, is_primary
  ) VALUES (
    '55000000-0000-4000-8000-000000000002',
    '55000000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000007',
    'active', true
  );

  INSERT INTO public.attendees (
    id, event_id, entry_id, email, pilot_first, pilot_last, person_id,
    is_active, registration_status
  ) VALUES
    ('56000000-0000-4000-8000-000000000001',
     '52000000-0000-4000-8000-000000000001', 'T2-A-MEMBER',
     't2-member@fixture.invalid', 'T2', 'Active',
     '55000000-0000-4000-8000-000000000001', true, 'registered'),
    ('56000000-0000-4000-8000-000000000002',
     '52000000-0000-4000-8000-000000000004', 'T2-C-MEMBER',
     't2-member@fixture.invalid', 'T2', 'Frozen',
     '55000000-0000-4000-8000-000000000001', true, 'registered');

  INSERT INTO public.person_role_instances (
    id, person_id, tenant_id, event_id, attendee_id, identity_role,
    source_table, source_record_id, attribution_method, evidence_source,
    source_manifest_version, source_role_instance_key
  ) VALUES
    ('59000000-0000-4000-8000-000000000001',
     '55000000-0000-4000-8000-000000000001',
     '51000000-0000-4000-8000-000000000001',
     '52000000-0000-4000-8000-000000000001',
     '56000000-0000-4000-8000-000000000001',
     'PILOT', 'public.attendees',
     '56000000-0000-4000-8000-000000000001',
     'automatic_backfill', 't2_fixture', 't2_fixture_v1',
     't2:active:pilot'),
    ('59000000-0000-4000-8000-000000000002',
     '55000000-0000-4000-8000-000000000001',
     '51000000-0000-4000-8000-000000000003',
     '52000000-0000-4000-8000-000000000004',
     '56000000-0000-4000-8000-000000000002',
     'PILOT', 'public.attendees',
     '56000000-0000-4000-8000-000000000002',
     'automatic_backfill', 't2_fixture', 't2_fixture_v1',
     't2:inactive:pilot');

  INSERT INTO public.person_event_participations (
    id, person_id, event_id, participation_state
  ) VALUES
    ('5a000000-0000-4000-8000-000000000001',
     '55000000-0000-4000-8000-000000000001',
     '52000000-0000-4000-8000-000000000001', 'eligible'),
    ('5a000000-0000-4000-8000-000000000002',
     '55000000-0000-4000-8000-000000000001',
     '52000000-0000-4000-8000-000000000004', 'eligible');
END;
$$;

-- Active-Tenant authority, Event lifecycle independence, and isolation.
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_count bigint;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000002',
    true
  );

  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_tenant_admin_authority(
      auth.uid(), '51000000-0000-4000-8000-000000000001'
    ),
    'active Tenant Admin authority works for its own Tenant'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_any_tenant_admin_authority(),
    'active Tenant Admin satisfies the self-scoped route gate'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000001'
    ),
    'active Tenant Admin inherits Event authority'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000002'
    ),
    'Tenant freeze does not rewrite closed-Event admin authority'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_task_authority(
      'event.vendors.manage', '52000000-0000-4000-8000-000000000001'
    ),
    'active Tenant Admin inherits valid Event task authority'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT public.has_tenant_admin_authority(
      auth.uid(), '51000000-0000-4000-8000-000000000002'
    )
    AND NOT public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000003'
    ),
    'Tenant A authority does not cross into Tenant B'
  );

  SELECT count(*) INTO v_count
  FROM public.events
  WHERE id IN (
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000003',
    '52000000-0000-4000-8000-000000000004'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 2,
    'browser canonical Event RLS exposes exactly Tenant A Events'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000003',
    true
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000001'
    )
    AND public.has_event_task_authority(
      'event.vendors.manage', '52000000-0000-4000-8000-000000000001'
    ),
    'active direct Event assignment and task grant work'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000002'
    ),
    'direct Event assignment does not widen to another Event'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000004',
    true
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000003'
    ),
    'Tenant B remains operational while Tenant C is inactive'
  );
END;
$$;

-- Inactive Tenant: inherited, direct Event, direct task, RLS, and route access
-- all fail for ordinary admins without deleting any assignment.
DO $$
DECLARE
  v_count bigint;
  v_denial text;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000005',
    true
  );

  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT public.has_tenant_admin_authority(
      auth.uid(), '51000000-0000-4000-8000-000000000003'
    ),
    'inactive Tenant disables inherited Tenant Admin authority'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT public.has_any_tenant_admin_authority(),
    'inactive-only Tenant assignment does not satisfy the route gate'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000004'
    )
    AND NOT public.has_event_task_authority(
      'event.vendors.manage', '52000000-0000-4000-8000-000000000004'
    ),
    'inactive Tenant blocks inherited Event and task authority'
  );

  SELECT count(*) INTO v_count
  FROM public.tenants
  WHERE id = '51000000-0000-4000-8000-000000000003';
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'ordinary Tenant Admin cannot read an inactive Tenant through raw RLS'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000006',
    true
  );

  SELECT denial_reason INTO v_denial
  FROM public.resolve_task_authority(
    auth.uid(), 'event.vendors.manage',
    '52000000-0000-4000-8000-000000000004'
  );

  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000004'
    )
    AND NOT public.has_event_task_authority(
      'event.vendors.manage', '52000000-0000-4000-8000-000000000004'
    )
    AND v_denial = 'inactive_tenant',
    'direct Event and direct task grants cannot bypass the Tenant freeze'
  );

  SELECT count(*) INTO v_count
  FROM public.events
  WHERE id = '52000000-0000-4000-8000-000000000004';
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'browser effective Event list excludes the inactive-Tenant Event'
  );

  UPDATE public.events
  SET location = 'forbidden inactive-Tenant edit'
  WHERE id = '52000000-0000-4000-8000-000000000004';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'inactive-Tenant Event metadata mutation is denied for direct Event Admin'
  );
END;
$$;

-- Platform recovery remains available for inactive Tenant and Event records.
DO $$
DECLARE
  v_count bigint;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000001',
    true
  );

  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_tenant_admin_authority(
      auth.uid(), '51000000-0000-4000-8000-000000000003'
    )
    AND public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000004'
    )
    AND public.has_event_task_authority(
      'event.vendors.manage', '52000000-0000-4000-8000-000000000004'
    ),
    'Platform recovery authority survives Tenant inactivity'
  );

  SELECT count(*) INTO v_count
  FROM public.tenants
  WHERE id = '51000000-0000-4000-8000-000000000003';
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 1,
    'Platform can inspect the inactive Tenant through governed RLS'
  );

  SELECT count(*) INTO v_count
  FROM public.events
  WHERE id = '52000000-0000-4000-8000-000000000004';
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 1,
    'Platform can inspect the inactive-Tenant Event through canonical RLS'
  );
END;
$$;

RESET ROLE;

-- The service-side Vendor invitation/revocation predicate observes the same
-- active/inactive boundary as browser Event RLS.
SET LOCAL ROLE service_role;

DO $$
BEGIN
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_admin_authority(
      '54000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000001'
    ),
    'server canonical predicate permits active direct Event authority'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    NOT public.has_event_admin_authority(
      '54000000-0000-4000-8000-000000000006',
      '52000000-0000-4000-8000-000000000004'
    ),
    'server canonical predicate denies inactive-Tenant direct Event authority'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_admin_authority(
      '54000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000004'
    ),
    'server canonical predicate preserves Platform recovery'
  );
END;
$$;

RESET ROLE;

-- Public discovery and Temporary Event Access fail closed for inactive Tenant.
SET LOCAL ROLE anon;

DO $$
DECLARE
  v_count bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT count(*) INTO v_count
  FROM public.get_public_discoverable_events()
  WHERE id IN (
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000003',
    '52000000-0000-4000-8000-000000000004'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 2,
    'global public discovery returns only visible Events of active Tenants'
  );

  SELECT count(*) INTO v_count
  FROM public.get_public_discoverable_events_for_tenant(
    '51000000-0000-4000-8000-000000000003'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'Tenant-scoped public discovery returns no inactive-Tenant Events'
  );

  SELECT count(*) INTO v_count
  FROM public.get_event_continuity_context(
    '52000000-0000-4000-8000-000000000004'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'known-Event continuity fails closed for inactive Tenant'
  );

  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.resolve_temporary_or_authenticated_attendee(
      '52000000-0000-4000-8000-000000000001',
      'T2-A1', 't2-member@fixture.invalid'
    ) = '56000000-0000-4000-8000-000000000001',
    'Temporary Event Access resolves for an active Tenant'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.resolve_temporary_or_authenticated_attendee(
      '52000000-0000-4000-8000-000000000004',
      'T2-C1', 't2-member@fixture.invalid'
    ) IS NULL,
    'Temporary Event Access resolver denies inactive Tenant'
  );

  SELECT count(*) INTO v_count
  FROM public.verify_member_event_login(
    '52000000-0000-4000-8000-000000000004',
    'T2-C1', 't2-member@fixture.invalid'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'member Event-code login denies inactive Tenant'
  );
END;
$$;

RESET ROLE;

-- Authenticated member discovery and member mutation are also frozen.
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_count bigint;
  v_before_arrived boolean;
  v_after_arrived boolean;
  v_before_audit bigint;
  v_after_audit bigint;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000007',
    true
  );

  SELECT count(*) INTO v_count
  FROM public.get_my_member_event_continuity_context(
    '52000000-0000-4000-8000-000000000001'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 1,
    'authenticated member continuity works for active Tenant'
  );

  SELECT count(*) INTO v_count
  FROM public.get_my_member_event_continuity_context(
    '52000000-0000-4000-8000-000000000004'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'authenticated member continuity denies inactive Tenant'
  );

  SELECT count(*) INTO v_count
  FROM public.get_tenant_owned_event_ids(
    ARRAY[
      '52000000-0000-4000-8000-000000000001'::uuid,
      '52000000-0000-4000-8000-000000000004'::uuid
    ],
    '51000000-0000-4000-8000-000000000003'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 0,
    'member workspace ownership resolver denies inactive Tenant'
  );

  SELECT count(*) INTO v_count
  FROM public.resolve_member_account()
  WHERE event_id IN (
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000004'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 1,
    'member account discovery excludes inactive-Tenant participation'
  );

  SELECT public.t2_attendee_has_arrived(
    '56000000-0000-4000-8000-000000000002'
  ) INTO v_before_arrived;

  SELECT public.t2_member_checkin_audit_count(
    '56000000-0000-4000-8000-000000000002'
  ) INTO v_before_audit;

  BEGIN
    PERFORM *
    FROM public.submit_member_checkin(
      '52000000-0000-4000-8000-000000000004',
      '56000000-0000-4000-8000-000000000002',
      true, true, '',
      '51000000-0000-4000-8000-000000000003',
      NULL, NULL
    );
    PERFORM public.t2_inactive_tenant_fixture_assert(
      false,
      'inactive-Tenant member check-in unexpectedly succeeded'
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.t2_inactive_tenant_fixture_assert(
      SQLERRM = 'Member check-in verification failed.',
      'inactive-Tenant member check-in fails through existing bounded error'
    );
  END;

  SELECT public.t2_attendee_has_arrived(
    '56000000-0000-4000-8000-000000000002'
  ) INTO v_after_arrived;

  SELECT public.t2_member_checkin_audit_count(
    '56000000-0000-4000-8000-000000000002'
  ) INTO v_after_audit;

  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_after_arrived IS NOT DISTINCT FROM v_before_arrived
    AND v_after_audit = v_before_audit,
    'denied member operation leaves attendee and audit evidence unchanged'
  );
END;
$$;

RESET ROLE;

-- Reactivation changes only the fixture Tenant flag. Preserved assignments,
-- direct grants, participation, hostname mapping, and Person linkage restore
-- eligibility without recreation.
DO $$
DECLARE
  v_tenant_assignments_before bigint;
  v_event_assignments_before bigint;
  v_task_grants_before bigint;
  v_participations_before bigint;
  v_roles_before bigint;
BEGIN
  SELECT count(*) INTO v_tenant_assignments_before
  FROM public.admin_tenant_access
  WHERE tenant_id IN (
    '51000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000003'
  );

  SELECT count(*) INTO v_event_assignments_before
  FROM public.admin_event_access
  WHERE id IN (
    '57000000-0000-4000-8000-000000000001',
    '57000000-0000-4000-8000-000000000002'
  );

  SELECT count(*) INTO v_task_grants_before
  FROM public.admin_event_permissions
  WHERE admin_event_access_id IN (
    '57000000-0000-4000-8000-000000000001',
    '57000000-0000-4000-8000-000000000002'
  );

  SELECT count(*) INTO v_participations_before
  FROM public.person_event_participations
  WHERE id IN (
    '5a000000-0000-4000-8000-000000000001',
    '5a000000-0000-4000-8000-000000000002'
  );

  SELECT count(*) INTO v_roles_before
  FROM public.person_role_instances
  WHERE id IN (
    '59000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000002'
  );

  UPDATE public.tenants
  SET is_active = true
  WHERE id = '51000000-0000-4000-8000-000000000003';

  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_tenant_assignments_before = 3
    AND v_event_assignments_before = 2
    AND v_task_grants_before = 2
    AND v_participations_before = 2
    AND v_roles_before = 2,
    'fixture starts with the expected preserved authority and identity rows'
  );
END;
$$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_count bigint;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000005',
    true
  );

  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_tenant_admin_authority(
      auth.uid(), '51000000-0000-4000-8000-000000000003'
    )
    AND public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000004'
    )
    AND public.has_event_task_authority(
      'event.vendors.manage', '52000000-0000-4000-8000-000000000004'
    ),
    'reactivation restores inherited authority from preserved assignment'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000006',
    true
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '52000000-0000-4000-8000-000000000004'
    )
    AND public.has_event_task_authority(
      'event.vendors.manage', '52000000-0000-4000-8000-000000000004'
    ),
    'reactivation restores direct Event and task authority from preserved rows'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    '54000000-0000-4000-8000-000000000007',
    true
  );

  SELECT count(*) INTO v_count
  FROM public.get_my_member_event_continuity_context(
    '52000000-0000-4000-8000-000000000004'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 1,
    'reactivation restores authenticated member continuity'
  );

  SELECT count(*) INTO v_count
  FROM public.resolve_member_account()
  WHERE event_id IN (
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000004'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 2,
    'reactivation restores member account Event discovery'
  );

  PERFORM *
  FROM public.submit_member_checkin(
    '52000000-0000-4000-8000-000000000004',
    '56000000-0000-4000-8000-000000000002',
    true, true, '',
    '51000000-0000-4000-8000-000000000003',
    NULL, NULL
  );

  PERFORM public.t2_inactive_tenant_fixture_assert(
    public.t2_attendee_has_arrived(
      '56000000-0000-4000-8000-000000000002'
    ) = true,
    'reactivation restores member operational mutation eligibility'
  );
END;
$$;

RESET ROLE;

DO $$
DECLARE
  v_count bigint;
BEGIN
  PERFORM public.t2_inactive_tenant_fixture_assert(
    (SELECT count(*)
     FROM public.admin_tenant_access
     WHERE tenant_id IN (
       '51000000-0000-4000-8000-000000000001',
       '51000000-0000-4000-8000-000000000002',
       '51000000-0000-4000-8000-000000000003'
     )) = 3,
    'reactivation does not recreate or delete Tenant assignments'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    (SELECT count(*)
     FROM public.admin_event_access
     WHERE id IN (
       '57000000-0000-4000-8000-000000000001',
       '57000000-0000-4000-8000-000000000002'
     )) = 2,
    'reactivation does not recreate or delete Event assignments'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    (SELECT count(*)
     FROM public.admin_event_permissions
     WHERE admin_event_access_id IN (
       '57000000-0000-4000-8000-000000000001',
       '57000000-0000-4000-8000-000000000002'
     )) = 2,
    'reactivation does not recreate or delete task grants'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    (SELECT count(*)
     FROM public.person_event_participations
     WHERE id IN (
       '5a000000-0000-4000-8000-000000000001',
       '5a000000-0000-4000-8000-000000000002'
     )) = 2
    AND (SELECT count(*)
         FROM public.person_role_instances
         WHERE id IN (
           '59000000-0000-4000-8000-000000000001',
           '59000000-0000-4000-8000-000000000002'
         )) = 2,
    'deactivation/reactivation preserves Person participation and role evidence'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    (SELECT is_active
     FROM public.tenant_hostname_mappings
     WHERE id = '58000000-0000-4000-8000-000000000001') = true,
    'deactivation/reactivation preserves hostname mapping state'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    (SELECT is_active
     FROM public.tenants
     WHERE organization_code = 'FCOC') = true,
    'FCOC remains active and untouched'
  );

  SELECT count(*) INTO v_count
  FROM public.get_public_discoverable_events_for_tenant(
    '51000000-0000-4000-8000-000000000003'
  );
  PERFORM public.t2_inactive_tenant_fixture_assert(
    v_count = 1,
    'reactivation restores public discovery under existing Event state'
  );
END;
$$;

ROLLBACK;
