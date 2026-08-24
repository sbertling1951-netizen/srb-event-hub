-- Tenant T3: governed Tenant Administration foundation.
--
-- Platform Administrators receive one bounded, audited command/read surface
-- for Tenant metadata, lifecycle, Tenant Admin assignments, hostname aliases,
-- and Tenant-owned Event inspection. Tenant creation is mechanically
-- inactive-first. Event ownership, ordinary Tenant authority, and the T2
-- inactive-Tenant operational freeze remain unchanged.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_administration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'tenant_created',
    'tenant_metadata_updated',
    'tenant_activated',
    'tenant_deactivated',
    'tenant_status_unchanged',
    'tenant_admin_assigned',
    'tenant_admin_reactivated',
    'tenant_admin_revoked',
    'tenant_admin_access_unchanged',
    'hostname_mapping_created',
    'hostname_mapping_activated',
    'hostname_mapping_deactivated',
    'hostname_mapping_status_unchanged'
  )),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_admin_user_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  target_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  hostname_mapping_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_administration_audit OWNER TO postgres;

CREATE INDEX IF NOT EXISTS tenant_administration_audit_tenant_idx
  ON public.tenant_administration_audit (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS tenant_administration_audit_target_admin_idx
  ON public.tenant_administration_audit (target_admin_user_id, occurred_at DESC)
  WHERE target_admin_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_administration_audit_hostname_idx
  ON public.tenant_administration_audit (hostname_mapping_id, occurred_at DESC)
  WHERE hostname_mapping_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_tenant_administration_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'tenant_administration_audit is immutable';
END;
$function$;

DROP TRIGGER IF EXISTS prevent_tenant_administration_audit_mutation_trigger
  ON public.tenant_administration_audit;

CREATE TRIGGER prevent_tenant_administration_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.tenant_administration_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_tenant_administration_audit_mutation();

ALTER TABLE public.tenant_administration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_administration_audit
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._require_platform_admin_actor()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  SELECT au.id
    INTO v_actor_admin_user_id
  FROM public.admin_users AS au
  WHERE au.user_id = auth.uid()
    AND au.is_active = true
    AND au.privilege_group = 'super_admin'
  ORDER BY au.id
  LIMIT 1;

  IF v_actor_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  RETURN v_actor_admin_user_id;
END;
$function$;

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
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

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
      FROM public.admin_tenant_access AS ata
      WHERE ata.tenant_id = t.id
        AND ata.is_active = true
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

CREATE OR REPLACE FUNCTION public.get_tenant_for_administration(p_tenant_id uuid)
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
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.list_tenants_for_administration() AS t
  WHERE t.id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_hostname_mappings_for_administration(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  hostname text,
  tenant_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT thm.id, thm.hostname, thm.tenant_id, thm.is_active,
         thm.created_at, thm.updated_at
  FROM public.tenant_hostname_mappings AS thm
  WHERE thm.tenant_id = p_tenant_id
  ORDER BY thm.hostname, thm.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_admin_assignments_for_administration(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  admin_user_id uuid,
  tenant_id uuid,
  assignment_is_active boolean,
  created_at timestamptz,
  created_by text,
  admin_email text,
  admin_display_name text,
  admin_is_active boolean,
  admin_privilege_group text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    ata.id,
    ata.admin_user_id,
    ata.tenant_id,
    ata.is_active,
    ata.created_at,
    ata.created_by,
    au.email,
    au.display_name,
    au.is_active,
    au.privilege_group
  FROM public.admin_tenant_access AS ata
  JOIN public.admin_users AS au ON au.id = ata.admin_user_id
  WHERE ata.tenant_id = p_tenant_id
  ORDER BY ata.is_active DESC, au.email, ata.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_owned_events_for_administration(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  name text,
  short_name text,
  start_date date,
  end_date date,
  status text,
  lifecycle_state text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.tenant_id,
    e.name,
    e.short_name,
    e.start_date,
    e.end_date,
    e.status,
    e.lifecycle_state,
    e.is_active,
    e.visible_to_members,
    e.created_at
  FROM public.events AS e
  WHERE e.tenant_id = p_tenant_id
  ORDER BY e.start_date DESC NULLS LAST, e.name, e.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_administration_audit(
  p_tenant_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  action text,
  actor_auth_user_id uuid,
  actor_admin_user_id uuid,
  actor_email text,
  target_admin_user_id uuid,
  target_admin_email text,
  hostname_mapping_id uuid,
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
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    taa.id,
    taa.tenant_id,
    taa.action,
    taa.actor_auth_user_id,
    taa.actor_admin_user_id,
    actor.email,
    taa.target_admin_user_id,
    target.email,
    taa.hostname_mapping_id,
    taa.reason,
    taa.before_state,
    taa.after_state,
    taa.occurred_at
  FROM public.tenant_administration_audit AS taa
  JOIN public.admin_users AS actor ON actor.id = taa.actor_admin_user_id
  LEFT JOIN public.admin_users AS target ON target.id = taa.target_admin_user_id
  WHERE taa.tenant_id = p_tenant_id
  ORDER BY taa.occurred_at DESC, taa.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_tenant_for_administration(
  p_organization_code text,
  p_slug text,
  p_organization_name text,
  p_display_name text,
  p_app_title text,
  p_app_tagline text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_favicon_url text DEFAULT NULL,
  p_primary_color text DEFAULT NULL,
  p_secondary_color text DEFAULT NULL,
  p_accent_color text DEFAULT NULL,
  p_tenant_type_id uuid DEFAULT NULL,
  p_post_event_edit_window_days integer DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_tenant public.tenants%ROWTYPE;
  v_organization_code text;
  v_slug text;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  v_organization_code := btrim(COALESCE(p_organization_code, ''));
  v_slug := lower(btrim(COALESCE(p_slug, '')));

  IF v_organization_code = '' THEN
    RAISE EXCEPTION 'Organization code is required.';
  END IF;

  IF v_slug = '' OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Slug must be a lowercase URL-safe value.';
  END IF;

  IF nullif(btrim(p_organization_name), '') IS NULL
    OR nullif(btrim(p_display_name), '') IS NULL
    OR nullif(btrim(p_app_title), '') IS NULL THEN
    RAISE EXCEPTION 'Organization name, display name, and app title are required.';
  END IF;

  IF p_tenant_type_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.tenant_types AS tt WHERE tt.id = p_tenant_type_id
    ) THEN
    RAISE EXCEPTION 'Tenant type not found.';
  END IF;

  IF p_post_event_edit_window_days IS NOT NULL
    AND p_post_event_edit_window_days < 0 THEN
    RAISE EXCEPTION 'Post-Event edit window must be zero or greater.';
  END IF;

  INSERT INTO public.tenants (
    organization_code,
    slug,
    organization_name,
    display_name,
    app_title,
    app_tagline,
    logo_url,
    favicon_url,
    primary_color,
    secondary_color,
    accent_color,
    is_active,
    tenant_type_id,
    post_event_edit_window_days
  )
  VALUES (
    v_organization_code,
    v_slug,
    btrim(p_organization_name),
    btrim(p_display_name),
    btrim(p_app_title),
    nullif(btrim(p_app_tagline), ''),
    nullif(btrim(p_logo_url), ''),
    nullif(btrim(p_favicon_url), ''),
    nullif(btrim(p_primary_color), ''),
    nullif(btrim(p_secondary_color), ''),
    nullif(btrim(p_accent_color), ''),
    false,
    p_tenant_type_id,
    p_post_event_edit_window_days
  )
  RETURNING * INTO v_tenant;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    reason,
    after_state
  )
  VALUES (
    v_tenant.id,
    'tenant_created',
    auth.uid(),
    v_actor_admin_user_id,
    nullif(btrim(p_reason), ''),
    to_jsonb(v_tenant)
  );

  RETURN v_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_tenant_metadata_for_administration(
  p_tenant_id uuid,
  p_patch jsonb,
  p_reason text DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_before public.tenants%ROWTYPE;
  v_after public.tenants%ROWTYPE;
  v_invalid_keys text[];
  v_tenant_type_id uuid;
  v_post_event_edit_window_days integer;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required.';
  END IF;

  IF p_patch IS NULL
    OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Tenant metadata patch must be a non-empty object.';
  END IF;

  SELECT array_agg(key ORDER BY key)
    INTO v_invalid_keys
  FROM jsonb_object_keys(p_patch) AS key
  WHERE key <> ALL (ARRAY[
    'organization_name',
    'display_name',
    'app_title',
    'app_tagline',
    'logo_url',
    'favicon_url',
    'primary_color',
    'secondary_color',
    'accent_color',
    'tenant_type_id',
    'post_event_edit_window_days'
  ]::text[]);

  IF v_invalid_keys IS NOT NULL THEN
    RAISE EXCEPTION 'Tenant metadata patch contains disallowed fields: %',
      array_to_string(v_invalid_keys, ', ');
  END IF;

  IF p_patch ? 'organization_name'
    AND nullif(btrim(p_patch ->> 'organization_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Organization name cannot be blank.';
  END IF;

  IF p_patch ? 'display_name'
    AND nullif(btrim(p_patch ->> 'display_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Display name cannot be blank.';
  END IF;

  IF p_patch ? 'app_title'
    AND nullif(btrim(p_patch ->> 'app_title'), '') IS NULL THEN
    RAISE EXCEPTION 'App title cannot be blank.';
  END IF;

  IF p_patch ? 'tenant_type_id' THEN
    IF jsonb_typeof(p_patch -> 'tenant_type_id') = 'null' THEN
      v_tenant_type_id := NULL;
    ELSE
      BEGIN
        v_tenant_type_id := (p_patch ->> 'tenant_type_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Tenant type id must be a UUID or null.';
      END;

      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_types AS tt WHERE tt.id = v_tenant_type_id
      ) THEN
        RAISE EXCEPTION 'Tenant type not found.';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'post_event_edit_window_days' THEN
    IF jsonb_typeof(p_patch -> 'post_event_edit_window_days') = 'null' THEN
      v_post_event_edit_window_days := NULL;
    ELSIF jsonb_typeof(p_patch -> 'post_event_edit_window_days') <> 'number'
      OR (p_patch ->> 'post_event_edit_window_days') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Post-Event edit window must be a non-negative integer or null.';
    ELSE
      v_post_event_edit_window_days := (p_patch ->> 'post_event_edit_window_days')::integer;
    END IF;
  END IF;

  SELECT *
    INTO v_before
  FROM public.tenants AS t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  UPDATE public.tenants AS t
  SET
    organization_name = CASE
      WHEN p_patch ? 'organization_name' THEN btrim(p_patch ->> 'organization_name')
      ELSE t.organization_name
    END,
    display_name = CASE
      WHEN p_patch ? 'display_name' THEN btrim(p_patch ->> 'display_name')
      ELSE t.display_name
    END,
    app_title = CASE
      WHEN p_patch ? 'app_title' THEN btrim(p_patch ->> 'app_title')
      ELSE t.app_title
    END,
    app_tagline = CASE
      WHEN p_patch ? 'app_tagline' THEN nullif(btrim(p_patch ->> 'app_tagline'), '')
      ELSE t.app_tagline
    END,
    logo_url = CASE
      WHEN p_patch ? 'logo_url' THEN nullif(btrim(p_patch ->> 'logo_url'), '')
      ELSE t.logo_url
    END,
    favicon_url = CASE
      WHEN p_patch ? 'favicon_url' THEN nullif(btrim(p_patch ->> 'favicon_url'), '')
      ELSE t.favicon_url
    END,
    primary_color = CASE
      WHEN p_patch ? 'primary_color' THEN nullif(btrim(p_patch ->> 'primary_color'), '')
      ELSE t.primary_color
    END,
    secondary_color = CASE
      WHEN p_patch ? 'secondary_color' THEN nullif(btrim(p_patch ->> 'secondary_color'), '')
      ELSE t.secondary_color
    END,
    accent_color = CASE
      WHEN p_patch ? 'accent_color' THEN nullif(btrim(p_patch ->> 'accent_color'), '')
      ELSE t.accent_color
    END,
    tenant_type_id = CASE
      WHEN p_patch ? 'tenant_type_id' THEN v_tenant_type_id
      ELSE t.tenant_type_id
    END,
    post_event_edit_window_days = CASE
      WHEN p_patch ? 'post_event_edit_window_days' THEN v_post_event_edit_window_days
      ELSE t.post_event_edit_window_days
    END,
    updated_at = now()
  WHERE t.id = p_tenant_id
  RETURNING * INTO v_after;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    reason,
    before_state,
    after_state
  )
  VALUES (
    p_tenant_id,
    'tenant_metadata_updated',
    auth.uid(),
    v_actor_admin_user_id,
    nullif(btrim(p_reason), ''),
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_active_status(
  p_tenant_id uuid,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_before public.tenants%ROWTYPE;
  v_after public.tenants%ROWTYPE;
  v_action text;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_tenant_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Tenant id and active status are required.';
  END IF;

  SELECT *
    INTO v_before
  FROM public.tenants AS t
  WHERE t.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  IF v_before.is_active = p_is_active THEN
    v_after := v_before;
    v_action := 'tenant_status_unchanged';
  ELSE
    UPDATE public.tenants AS t
    SET is_active = p_is_active,
        updated_at = now()
    WHERE t.id = p_tenant_id
    RETURNING * INTO v_after;

    v_action := CASE
      WHEN p_is_active THEN 'tenant_activated'
      ELSE 'tenant_deactivated'
    END;
  END IF;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    reason,
    before_state,
    after_state
  )
  VALUES (
    p_tenant_id,
    v_action,
    auth.uid(),
    v_actor_admin_user_id,
    nullif(btrim(p_reason), ''),
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_tenant_hostname_mapping(
  p_tenant_id uuid,
  p_hostname text,
  p_is_active boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS public.tenant_hostname_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_hostname text;
  v_mapping public.tenant_hostname_mappings%ROWTYPE;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_tenant_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Tenant id and hostname active status are required.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  v_hostname := lower(btrim(COALESCE(p_hostname, '')));

  IF v_hostname = ''
    OR char_length(v_hostname) > 253
    OR v_hostname !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$' THEN
    RAISE EXCEPTION 'Hostname must be a valid DNS hostname without scheme, port, path, query, fragment, or trailing dot.';
  END IF;

  INSERT INTO public.tenant_hostname_mappings (
    hostname,
    tenant_id,
    is_active
  )
  VALUES (
    v_hostname,
    p_tenant_id,
    p_is_active
  )
  RETURNING * INTO v_mapping;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    hostname_mapping_id,
    reason,
    after_state
  )
  VALUES (
    p_tenant_id,
    'hostname_mapping_created',
    auth.uid(),
    v_actor_admin_user_id,
    v_mapping.id,
    nullif(btrim(p_reason), ''),
    to_jsonb(v_mapping)
  );

  RETURN v_mapping;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_hostname_mapping_active_status(
  p_mapping_id uuid,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS public.tenant_hostname_mappings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_before public.tenant_hostname_mappings%ROWTYPE;
  v_after public.tenant_hostname_mappings%ROWTYPE;
  v_action text;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_mapping_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Hostname mapping id and active status are required.';
  END IF;

  SELECT *
    INTO v_before
  FROM public.tenant_hostname_mappings AS thm
  WHERE thm.id = p_mapping_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hostname mapping not found.';
  END IF;

  IF v_before.is_active = p_is_active THEN
    v_after := v_before;
    v_action := 'hostname_mapping_status_unchanged';
  ELSE
    UPDATE public.tenant_hostname_mappings AS thm
    SET is_active = p_is_active
    WHERE thm.id = p_mapping_id
    RETURNING * INTO v_after;

    v_action := CASE
      WHEN p_is_active THEN 'hostname_mapping_activated'
      ELSE 'hostname_mapping_deactivated'
    END;
  END IF;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    hostname_mapping_id,
    reason,
    before_state,
    after_state
  )
  VALUES (
    v_before.tenant_id,
    v_action,
    auth.uid(),
    v_actor_admin_user_id,
    p_mapping_id,
    nullif(btrim(p_reason), ''),
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$function$;

-- Preserve the existing callable signature for the Tenant Admin screen while
-- replacing caller-supplied p_granted_by as actor evidence with auth.uid().
-- The argument remains accepted for compatibility and is intentionally not
-- used as authoritative identity or audit reason.
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
DECLARE
  v_actor_admin_user_id uuid;
  v_target_admin_exists boolean;
  v_before public.admin_tenant_access%ROWTYPE;
  v_after public.admin_tenant_access%ROWTYPE;
  v_action text;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_admin_user_id IS NULL OR p_tenant_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Admin user id, Tenant id, and active status are required.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_users AS au WHERE au.id = p_admin_user_id
  ) INTO v_target_admin_exists;

  IF NOT v_target_admin_exists THEN
    RAISE EXCEPTION 'Admin user not found.';
  END IF;

  SELECT *
    INTO v_before
  FROM public.admin_tenant_access AS ata
  WHERE ata.admin_user_id = p_admin_user_id
    AND ata.tenant_id = p_tenant_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_before.is_active = p_is_active THEN
      v_after := v_before;
      v_action := 'tenant_admin_access_unchanged';
    ELSE
      UPDATE public.admin_tenant_access AS ata
      SET is_active = p_is_active
      WHERE ata.id = v_before.id
      RETURNING * INTO v_after;

      v_action := CASE
        WHEN p_is_active THEN 'tenant_admin_reactivated'
        ELSE 'tenant_admin_revoked'
      END;
    END IF;
  ELSIF p_is_active THEN
    INSERT INTO public.admin_tenant_access (
      admin_user_id,
      tenant_id,
      is_active,
      created_by
    )
    VALUES (
      p_admin_user_id,
      p_tenant_id,
      true,
      auth.uid()::text
    )
    RETURNING * INTO v_after;

    v_action := 'tenant_admin_assigned';
  ELSE
    v_action := 'tenant_admin_access_unchanged';
  END IF;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    target_admin_user_id,
    before_state,
    after_state
  )
  VALUES (
    p_tenant_id,
    v_action,
    auth.uid(),
    v_actor_admin_user_id,
    p_admin_user_id,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    CASE WHEN v_after.id IS NULL THEN NULL ELSE to_jsonb(v_after) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_admin_access(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  admin_user_id uuid,
  tenant_id uuid,
  is_active boolean,
  created_at timestamptz,
  created_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  RETURN QUERY
  SELECT
    ata.id,
    ata.admin_user_id,
    ata.tenant_id,
    ata.is_active,
    ata.created_at,
    ata.created_by
  FROM public.admin_tenant_access AS ata
  WHERE p_tenant_id IS NULL OR ata.tenant_id = p_tenant_id
  ORDER BY ata.created_at DESC, ata.id DESC;
END;
$function$;

ALTER FUNCTION public.prevent_tenant_administration_audit_mutation()
  OWNER TO postgres;
ALTER FUNCTION public._require_platform_admin_actor()
  OWNER TO postgres;
ALTER FUNCTION public.list_tenants_for_administration()
  OWNER TO postgres;
ALTER FUNCTION public.get_tenant_for_administration(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.list_tenant_hostname_mappings_for_administration(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.list_tenant_admin_assignments_for_administration(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.list_tenant_owned_events_for_administration(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.list_tenant_administration_audit(uuid, integer)
  OWNER TO postgres;
ALTER FUNCTION public.create_tenant_for_administration(
  text, text, text, text, text, text, text, text, text, text, text, uuid,
  integer, text
) OWNER TO postgres;
ALTER FUNCTION public.update_tenant_metadata_for_administration(uuid, jsonb, text)
  OWNER TO postgres;
ALTER FUNCTION public.set_tenant_active_status(uuid, boolean, text)
  OWNER TO postgres;
ALTER FUNCTION public.add_tenant_hostname_mapping(uuid, text, boolean, text)
  OWNER TO postgres;
ALTER FUNCTION public.set_tenant_hostname_mapping_active_status(uuid, boolean, text)
  OWNER TO postgres;
ALTER FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text)
  OWNER TO postgres;
ALTER FUNCTION public.list_tenant_admin_access(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_tenant_administration_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._require_platform_admin_actor()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenants_for_administration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tenant_for_administration(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenant_hostname_mappings_for_administration(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenant_admin_assignments_for_administration(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenant_owned_events_for_administration(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenant_administration_audit(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_tenant_for_administration(
  text, text, text, text, text, text, text, text, text, text, text, uuid,
  integer, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_tenant_metadata_for_administration(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_tenant_active_status(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_tenant_hostname_mapping(uuid, text, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_tenant_hostname_mapping_active_status(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tenant_admin_access(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_tenants_for_administration()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_for_administration(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_hostname_mappings_for_administration(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_assignments_for_administration(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_owned_events_for_administration(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_administration_audit(uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_for_administration(
  text, text, text, text, text, text, text, text, text, text, text, uuid,
  integer, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_metadata_for_administration(uuid, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_active_status(uuid, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_tenant_hostname_mapping(uuid, text, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_hostname_mapping_active_status(uuid, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_access(uuid)
  TO authenticated;

COMMENT ON TABLE public.tenant_administration_audit IS
  'Immutable Platform Administrator evidence for governed Tenant, hostname, and Tenant Admin assignment commands.';

COMMENT ON FUNCTION public.create_tenant_for_administration(
  text, text, text, text, text, text, text, text, text, text, text, uuid,
  integer, text
) IS
  'Creates one canonical Tenant as inactive. Does not create Events, mappings, assignments, Persons, or entitlements.';

COMMENT ON FUNCTION public.update_tenant_metadata_for_administration(uuid, jsonb, text) IS
  'Updates only the explicit Tenant presentation/configuration allowlist. Identity, aliases, status, ownership, mappings, and assignments are excluded.';

COMMENT ON FUNCTION public.set_tenant_active_status(uuid, boolean, text) IS
  'Idempotently sets the two-state Tenant lifecycle flag and records every request without rewriting preserved Tenant-owned records.';

COMMENT ON FUNCTION public.set_tenant_hostname_mapping_active_status(uuid, boolean, text) IS
  'Activates or deactivates a retained hostname alias. Deactivation is the safe removal path; T3 exposes no hard-delete or transfer command.';

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
