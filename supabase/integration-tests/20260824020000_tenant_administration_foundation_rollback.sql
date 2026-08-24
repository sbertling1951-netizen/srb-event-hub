-- Tenant T3 linked integration and rollback proof.
-- Installs the exact pending migration definitions inside one outer transaction,
-- exercises isolated fixtures, and rolls back definitions and data together.

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



-- Fixture assertions follow below.

CREATE FUNCTION public.t3_tenant_administration_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'T3 assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.t3_tenant_administration_fixture_assert(boolean, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t3_tenant_administration_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t3_tenant_administration_fixture_assert(boolean, text)
  TO anon, authenticated;

CREATE FUNCTION public.t3_tenant_administration_fixture_audit_count(
  p_tenant_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT count(*)
  FROM public.tenant_administration_audit AS taa
  WHERE taa.tenant_id = p_tenant_id;
$function$;

ALTER FUNCTION public.t3_tenant_administration_fixture_audit_count(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t3_tenant_administration_fixture_audit_count(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t3_tenant_administration_fixture_audit_count(uuid)
  TO anon, authenticated;

CREATE FUNCTION public.t3_tenant_administration_fixture_tenant_id(
  p_organization_code text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT t.id
  FROM public.tenants AS t
  WHERE t.organization_code = p_organization_code;
$function$;

ALTER FUNCTION public.t3_tenant_administration_fixture_tenant_id(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t3_tenant_administration_fixture_tenant_id(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t3_tenant_administration_fixture_tenant_id(text)
  TO anon, authenticated;

CREATE FUNCTION public.t3_tenant_administration_fixture_tenant_type_id(
  p_code text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT tt.id
  FROM public.tenant_types AS tt
  WHERE tt.code = p_code;
$function$;

ALTER FUNCTION public.t3_tenant_administration_fixture_tenant_type_id(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t3_tenant_administration_fixture_tenant_type_id(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t3_tenant_administration_fixture_tenant_type_id(text)
  TO anon, authenticated;

CREATE FUNCTION public.t3_tenant_administration_fixture_related_count(
  p_kind text,
  p_tenant_id uuid,
  p_admin_user_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  CASE p_kind
    WHEN 'event' THEN
      RETURN (SELECT count(*) FROM public.events AS e WHERE e.tenant_id = p_tenant_id);
    WHEN 'hostname' THEN
      RETURN (
        SELECT count(*)
        FROM public.tenant_hostname_mappings AS thm
        WHERE thm.tenant_id = p_tenant_id
      );
    WHEN 'assignment' THEN
      RETURN (
        SELECT count(*)
        FROM public.admin_tenant_access AS ata
        WHERE ata.tenant_id = p_tenant_id
          AND (p_admin_user_id IS NULL OR ata.admin_user_id = p_admin_user_id)
      );
    WHEN 'person' THEN
      RETURN (SELECT count(*) FROM public.people AS p WHERE p.tenant_id = p_tenant_id);
    ELSE
      RAISE EXCEPTION 'Unknown fixture relationship kind: %', p_kind;
  END CASE;
END;
$function$;

ALTER FUNCTION public.t3_tenant_administration_fixture_related_count(text, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t3_tenant_administration_fixture_related_count(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t3_tenant_administration_fixture_related_count(text, uuid, uuid)
  TO anon, authenticated;

CREATE TEMP TABLE t3_production_tenant_snapshot AS
SELECT to_jsonb(t) AS tenant_state
FROM public.tenants AS t
WHERE t.organization_code = 'FCOC';

DO $fixture$
BEGIN
  PERFORM public.t3_tenant_administration_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants AS t
      WHERE t.organization_code LIKE 'T3-FIXTURE-%'
    ),
    'fixture Tenant codes are unused before setup'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('64000000-0000-4000-8000-000000000001', 't3-platform@fixture.invalid'),
    ('64000000-0000-4000-8000-000000000002', 't3-ordinary@fixture.invalid'),
    ('64000000-0000-4000-8000-000000000003', 't3-target-admin@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id,
    privilege_group
  ) VALUES
    (
      '63000000-0000-4000-8000-000000000001',
      't3-platform@fixture.invalid', 'T3 Platform', true, true,
      '64000000-0000-4000-8000-000000000001', 'super_admin'
    ),
    (
      '63000000-0000-4000-8000-000000000002',
      't3-ordinary@fixture.invalid', 'T3 Ordinary Admin', true, false,
      '64000000-0000-4000-8000-000000000002', 'event_admin'
    ),
    (
      '63000000-0000-4000-8000-000000000003',
      't3-target-admin@fixture.invalid', 'T3 Target Admin', true, false,
      '64000000-0000-4000-8000-000000000003', 'event_admin'
    );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title,
    is_active
  ) VALUES
    (
      '61000000-0000-4000-8000-000000000001',
      'T3-FIXTURE-ACTIVE', 't3-fixture-active',
      'T3 Existing Active Tenant', 'T3 Existing Active', 'T3 Existing Active',
      true
    ),
    (
      '61000000-0000-4000-8000-000000000002',
      'T3-FIXTURE-INACTIVE', 't3-fixture-inactive',
      'T3 Existing Inactive Tenant', 'T3 Existing Inactive',
      'T3 Existing Inactive', false
    );
END;
$fixture$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_created_active boolean;
  v_count bigint;
  v_failed boolean;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '64000000-0000-4000-8000-000000000001',
    true
  );

  SELECT created.id, created.is_active
    INTO v_created_id, v_created_active
  FROM public.create_tenant_for_administration(
    'T3-FIXTURE-CREATED',
    't3-fixture-created',
    'T3 Created Organization',
    'T3 Created Tenant',
    'T3 Created App',
    'Created inactive by T3',
    NULL,
    NULL,
    '#111111',
    '#222222',
    '#333333',
    NULL,
    30,
    'fixture creation'
  ) AS created;

  PERFORM public.t3_tenant_administration_fixture_assert(
    v_created_id IS NOT NULL AND v_created_active = false,
    'Platform creates a Tenant and creation is mechanically inactive'
  );

  v_count := public.t3_tenant_administration_fixture_related_count(
    'event', v_created_id
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 0,
    'Tenant creation creates no Event'
  );

  v_count := public.t3_tenant_administration_fixture_related_count(
    'hostname', v_created_id
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 0,
    'Tenant creation creates no hostname mapping'
  );

  v_count := public.t3_tenant_administration_fixture_related_count(
    'assignment', v_created_id
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 0,
    'Tenant creation creates no Tenant Admin assignment'
  );

  v_count := public.t3_tenant_administration_fixture_related_count(
    'person', v_created_id
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 0,
    'Tenant creation creates no Person'
  );

  SELECT count(*) INTO v_count
  FROM public.list_tenant_administration_audit(v_created_id, 100) AS taa
  WHERE taa.tenant_id = v_created_id
    AND taa.action = 'tenant_created'
    AND taa.actor_auth_user_id = '64000000-0000-4000-8000-000000000001'
    AND taa.actor_admin_user_id = '63000000-0000-4000-8000-000000000001'
    AND (taa.after_state ->> 'is_active')::boolean = false;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'Tenant creation records authoritative actor and inactive after-state'
  );

  SELECT count(*) INTO v_count
  FROM public.list_tenants_for_administration() AS t
  WHERE t.id IN (
    '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000002',
    v_created_id
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 3,
    'Platform Tenant list includes active and inactive Tenants'
  );

  SELECT count(*) INTO v_count
  FROM public.get_tenant_for_administration(v_created_id) AS t
  WHERE t.is_active = false
    AND t.owned_event_count = 0
    AND t.active_tenant_admin_count = 0
    AND t.hostname_mapping_count = 0;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'Platform Tenant detail returns authoritative metadata and counts'
  );

  v_failed := false;
  BEGIN
    PERFORM public.create_tenant_for_administration(
      'T3-FIXTURE-CREATED', 't3-fixture-another-slug',
      'Duplicate Code', 'Duplicate Code', 'Duplicate Code'
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed,
    'duplicate organization code is rejected by the canonical uniqueness constraint'
  );

  v_failed := false;
  BEGIN
    PERFORM public.create_tenant_for_administration(
      'T3-FIXTURE-ANOTHER-CODE', 't3-fixture-created',
      'Duplicate Slug', 'Duplicate Slug', 'Duplicate Slug'
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed,
    'duplicate slug is rejected by the canonical uniqueness constraint'
  );

  v_count := public.t3_tenant_administration_fixture_audit_count(v_created_id);
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'failed duplicate creation does not fabricate audit success'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_before_audit_count bigint;
  v_failed boolean;
BEGIN
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );

  v_before_audit_count := public.t3_tenant_administration_fixture_audit_count(v_created_id);

  PERFORM set_config(
    'request.jwt.claim.sub',
    '64000000-0000-4000-8000-000000000002',
    true
  );

  v_failed := false;
  BEGIN
    PERFORM public.list_tenants_for_administration();
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed,
    'ordinary authenticated caller cannot list administrative Tenants'
  );

  v_failed := false;
  BEGIN
    PERFORM public.create_tenant_for_administration(
      'T3-FIXTURE-UNAUTHORIZED', 't3-fixture-unauthorized',
      'Unauthorized', 'Unauthorized', 'Unauthorized'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed
    AND NOT EXISTS (
      SELECT 1 FROM public.tenants AS t
      WHERE t.organization_code = 'T3-FIXTURE-UNAUTHORIZED'
    ),
    'ordinary authenticated caller cannot create a Tenant'
  );

  v_failed := false;
  BEGIN
    PERFORM public.set_tenant_admin_access(
      '63000000-0000-4000-8000-000000000002',
      v_created_id,
      true,
      'self-elevation attempt'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed
    AND public.t3_tenant_administration_fixture_related_count(
      'assignment',
      v_created_id,
      '63000000-0000-4000-8000-000000000002'
    ) = 0,
    'ordinary caller cannot self-elevate into Tenant Admin authority'
  );

  PERFORM public.t3_tenant_administration_fixture_assert(
    public.t3_tenant_administration_fixture_audit_count(v_created_id)
      = v_before_audit_count,
    'unauthorized reads and mutations create no success audit evidence'
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
    PERFORM public.list_tenants_for_administration();
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;

  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed,
    'anon has no Tenant administration execution surface'
  );
END;
$fixture$;

RESET ROLE;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_tenant_type_id uuid;
  v_before public.tenants%ROWTYPE;
  v_after public.tenants%ROWTYPE;
  v_audit_count bigint;
  v_failed boolean;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '64000000-0000-4000-8000-000000000001',
    true
  );
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );
  v_tenant_type_id := public.t3_tenant_administration_fixture_tenant_type_id(
    'rv_club'
  );

  SELECT * INTO v_before
  FROM public.tenants AS t
  WHERE t.id = v_created_id;

  SELECT * INTO v_after
  FROM public.update_tenant_metadata_for_administration(
    v_created_id,
    jsonb_build_object(
      'organization_name', 'T3 Updated Organization',
      'display_name', 'T3 Updated Display',
      'app_title', 'T3 Updated App',
      'app_tagline', 'T3 Updated Tagline',
      'logo_url', 'https://fixture.invalid/logo.svg',
      'favicon_url', 'https://fixture.invalid/favicon.ico',
      'primary_color', '#010101',
      'secondary_color', '#020202',
      'accent_color', '#030303',
      'tenant_type_id', v_tenant_type_id,
      'post_event_edit_window_days', 0
    ),
    'fixture metadata update'
  );

  PERFORM public.t3_tenant_administration_fixture_assert(
    v_after.organization_name = 'T3 Updated Organization'
    AND v_after.display_name = 'T3 Updated Display'
    AND v_after.app_title = 'T3 Updated App'
    AND v_after.app_tagline = 'T3 Updated Tagline'
    AND v_after.logo_url = 'https://fixture.invalid/logo.svg'
    AND v_after.favicon_url = 'https://fixture.invalid/favicon.ico'
    AND v_after.primary_color = '#010101'
    AND v_after.secondary_color = '#020202'
    AND v_after.accent_color = '#030303'
    AND v_after.tenant_type_id = v_tenant_type_id
    AND v_after.post_event_edit_window_days = 0,
    'metadata command exercises every approved field and preserves explicit zero'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_after.id = v_before.id
    AND v_after.organization_code = v_before.organization_code
    AND v_after.slug = v_before.slug
    AND v_after.is_active = v_before.is_active,
    'metadata command cannot alter Tenant identity or lifecycle'
  );

  SELECT * INTO v_after
  FROM public.update_tenant_metadata_for_administration(
    v_created_id,
    '{"display_name":"T3 Omitted Fields Preserved"}'::jsonb,
    'fixture omitted fields'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_after.display_name = 'T3 Omitted Fields Preserved'
    AND v_after.app_title = 'T3 Updated App'
    AND v_after.app_tagline = 'T3 Updated Tagline'
    AND v_after.logo_url = 'https://fixture.invalid/logo.svg'
    AND v_after.post_event_edit_window_days = 0,
    'omitted metadata fields preserve their canonical values'
  );

  v_audit_count := public.t3_tenant_administration_fixture_audit_count(v_created_id);
  v_failed := false;
  BEGIN
    PERFORM public.update_tenant_metadata_for_administration(
      v_created_id,
      jsonb_build_object(
        'id', gen_random_uuid(),
        'organization_code', 'T3-FIXTURE-MUTATED',
        'slug', 't3-fixture-mutated',
        'is_active', true
      ),
      'disallowed identity mutation'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE 'Tenant metadata patch contains disallowed fields:%';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed
    AND public.t3_tenant_administration_fixture_audit_count(v_created_id)
      = v_audit_count,
    'disallowed identity and lifecycle fields fail closed without success audit'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    EXISTS (
      SELECT 1
      FROM public.tenants AS t
      WHERE t.id = v_created_id
        AND t.organization_code = 'T3-FIXTURE-CREATED'
        AND t.slug = 't3-fixture-created'
        AND t.is_active = false
    ),
    'failed disallowed patch leaves canonical Tenant unchanged'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_mapping public.tenant_hostname_mappings%ROWTYPE;
  v_after public.tenant_hostname_mappings%ROWTYPE;
  v_audit_count bigint;
  v_failed boolean;
  v_count bigint;
BEGIN
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );

  SELECT * INTO v_mapping
  FROM public.add_tenant_hostname_mapping(
    v_created_id,
    '  T3-CREATED.FIXTURE.INVALID  ',
    true,
    'fixture hostname creation'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_mapping.hostname = 't3-created.fixture.invalid'
    AND v_mapping.tenant_id = v_created_id
    AND v_mapping.is_active = true,
    'hostname command normalizes and creates one governed active alias'
  );
  SELECT count(*) INTO v_count
  FROM public.list_tenant_hostname_mappings_for_administration(v_created_id) AS h
  WHERE h.id = v_mapping.id
    AND h.hostname = 't3-created.fixture.invalid'
    AND h.is_active = true;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'Platform hostname inspection returns the retained canonical mapping'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM public.list_tenants_for_administration() AS t
      JOIN public.list_tenant_hostname_mappings_for_administration(v_created_id) AS h
        ON h.tenant_id = t.id
      WHERE h.id = v_mapping.id
        AND h.is_active = true
        AND t.is_active = true
    ),
    'active hostname row does not make an inactive Tenant operational'
  );

  v_audit_count := public.t3_tenant_administration_fixture_audit_count(
    '61000000-0000-4000-8000-000000000002'
  );
  v_failed := false;
  BEGIN
    PERFORM public.add_tenant_hostname_mapping(
      '61000000-0000-4000-8000-000000000002',
      't3-created.fixture.invalid',
      true,
      'forbidden transfer attempt'
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed
    AND public.t3_tenant_administration_fixture_audit_count(
      '61000000-0000-4000-8000-000000000002'
    ) = v_audit_count,
    'canonical hostname uniqueness blocks reassignment without success audit'
  );

  SELECT * INTO v_after
  FROM public.set_tenant_hostname_mapping_active_status(
    v_mapping.id, false, 'fixture safe removal'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_after.id = v_mapping.id
    AND v_after.tenant_id = v_created_id
    AND v_after.hostname = v_mapping.hostname
    AND v_after.is_active = false,
    'safe hostname removal deactivates the retained row without transfer or deletion'
  );

  SELECT * INTO v_after
  FROM public.set_tenant_hostname_mapping_active_status(
    v_mapping.id, false, 'fixture idempotent safe removal'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_after.id = v_mapping.id AND v_after.is_active = false,
    'repeated hostname deactivation is idempotent'
  );

  SELECT * INTO v_after
  FROM public.set_tenant_hostname_mapping_active_status(
    v_mapping.id, true, 'fixture hostname reactivation'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_after.id = v_mapping.id
    AND v_after.tenant_id = v_created_id
    AND v_after.hostname = v_mapping.hostname
    AND v_after.is_active = true,
    'hostname reactivation preserves canonical ownership and identity'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_assignment_id uuid;
  v_created_at timestamptz;
  v_created_by text;
  v_count bigint;
  v_audit_count bigint;
  v_failed boolean;
BEGIN
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );

  PERFORM public.set_tenant_admin_access(
    '63000000-0000-4000-8000-000000000003',
    v_created_id,
    true,
    'caller-controlled text must not become actor evidence'
  );
  SELECT a.id, a.created_at, a.created_by
    INTO v_assignment_id, v_created_at, v_created_by
  FROM public.list_tenant_admin_access(v_created_id) AS a
  WHERE a.admin_user_id = '63000000-0000-4000-8000-000000000003';
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_assignment_id IS NOT NULL
    AND v_created_by = '64000000-0000-4000-8000-000000000001',
    'Tenant Admin assignment stores authenticated actor identity, not caller text'
  );

  PERFORM public.set_tenant_admin_access(
    '63000000-0000-4000-8000-000000000003',
    v_created_id,
    true,
    'same-state assignment'
  );
  SELECT count(*) INTO v_count
  FROM public.list_tenant_admin_access(v_created_id) AS a
  WHERE a.id = v_assignment_id
    AND a.is_active = true
    AND a.created_at = v_created_at
    AND a.created_by = v_created_by;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'repeated Tenant Admin assignment is idempotent and creates no duplicate'
  );

  PERFORM public.set_tenant_admin_access(
    '63000000-0000-4000-8000-000000000003',
    v_created_id,
    false,
    'revoke retained assignment'
  );
  SELECT count(*) INTO v_count
  FROM public.list_tenant_admin_assignments_for_administration(v_created_id) AS a
  WHERE a.id = v_assignment_id
    AND a.admin_user_id = '63000000-0000-4000-8000-000000000003'
    AND a.assignment_is_active = false
    AND a.created_at = v_created_at
    AND a.created_by = v_created_by;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'revoked Tenant Admin assignment remains inspectable as retained history'
  );

  PERFORM public.set_tenant_admin_access(
    '63000000-0000-4000-8000-000000000003',
    v_created_id,
    true,
    'reactivate retained assignment'
  );
  SELECT count(*) INTO v_count
  FROM public.list_tenant_admin_access(v_created_id) AS a
  WHERE a.id = v_assignment_id
    AND a.is_active = true;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1
    AND public.t3_tenant_administration_fixture_related_count(
      'assignment',
      v_created_id,
      '63000000-0000-4000-8000-000000000003'
    ) = 1,
    'Tenant Admin reactivation reuses the one canonical assignment row'
  );

  v_audit_count := public.t3_tenant_administration_fixture_audit_count(v_created_id);
  v_failed := false;
  BEGIN
    PERFORM public.set_tenant_admin_access(
      '63000000-0000-4000-8000-000000000099',
      v_created_id,
      true,
      'missing Admin'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Admin user not found.';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed
    AND public.t3_tenant_administration_fixture_audit_count(v_created_id)
      = v_audit_count,
    'unknown Admin assignment fails closed without audit success evidence'
  );

  SELECT count(*) INTO v_count
  FROM public.list_tenant_administration_audit(v_created_id, 100) AS a
  WHERE a.target_admin_user_id = '63000000-0000-4000-8000-000000000003'
    AND a.actor_auth_user_id = '64000000-0000-4000-8000-000000000001'
    AND a.actor_admin_user_id = '63000000-0000-4000-8000-000000000001'
    AND a.action IN (
      'tenant_admin_assigned',
      'tenant_admin_access_unchanged',
      'tenant_admin_revoked',
      'tenant_admin_reactivated'
    );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 4,
    'assignment, idempotency, revocation, and reactivation have authoritative audit evidence'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_mapping_id uuid;
  v_before_audit_count bigint;
  v_failed boolean;
BEGIN
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );
  SELECT h.id INTO v_mapping_id
  FROM public.list_tenant_hostname_mappings_for_administration(v_created_id) AS h
  WHERE h.hostname = 't3-created.fixture.invalid';
  v_before_audit_count := public.t3_tenant_administration_fixture_audit_count(v_created_id);

  PERFORM set_config(
    'request.jwt.claim.sub',
    '64000000-0000-4000-8000-000000000002',
    true
  );
  v_failed := false;
  BEGIN
    PERFORM public.set_tenant_hostname_mapping_active_status(
      v_mapping_id, false, 'unauthorized hostname mutation'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed
    AND public.t3_tenant_administration_fixture_audit_count(v_created_id)
      = v_before_audit_count,
    'ordinary authenticated caller cannot mutate hostname state or audit success'
  );
END;
$fixture$;

RESET ROLE;

INSERT INTO public.events (
  id, tenant_id, name, short_name, start_date, end_date, timezone,
  lifecycle_state, status, visible_to_members, is_active, event_code, location
)
VALUES (
  '62000000-0000-4000-8000-000000000001',
  public.t3_tenant_administration_fixture_tenant_id('T3-FIXTURE-CREATED'),
  'T3 Created Tenant Event', 'T3 Event', current_date, current_date + 5, 'UTC',
  'operational', 'active', true, true, 'T3-EVENT', 'Fixture Venue'
);

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_assignment_id uuid;
  v_mapping_id uuid;
  v_assignment_count bigint;
  v_mapping_count bigint;
  v_count bigint;
  v_tenant public.tenants%ROWTYPE;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '64000000-0000-4000-8000-000000000001',
    true
  );
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );
  SELECT a.id INTO v_assignment_id
  FROM public.list_tenant_admin_access(v_created_id) AS a
  WHERE a.admin_user_id = '63000000-0000-4000-8000-000000000003';
  SELECT h.id INTO v_mapping_id
  FROM public.list_tenant_hostname_mappings_for_administration(v_created_id) AS h
  WHERE h.hostname = 't3-created.fixture.invalid';
  v_assignment_count := public.t3_tenant_administration_fixture_related_count(
    'assignment', v_created_id
  );
  v_mapping_count := public.t3_tenant_administration_fixture_related_count(
    'hostname', v_created_id
  );

  SELECT * INTO v_tenant
  FROM public.set_tenant_active_status(
    v_created_id, false, 'fixture already inactive'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_tenant.is_active = false
    AND NOT public.has_tenant_admin_authority(
      '64000000-0000-4000-8000-000000000003', v_created_id
    )
    AND NOT public.has_event_admin_authority(
      '64000000-0000-4000-8000-000000000003',
      '62000000-0000-4000-8000-000000000001'
    ),
    'inactive Tenant freezes retained Tenant and Event authority'
  );
  SELECT count(*) INTO v_count
  FROM public.get_public_discoverable_events_for_tenant(v_created_id) AS e
  WHERE e.id = '62000000-0000-4000-8000-000000000001';
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 0,
    'inactive Tenant hides its retained Event from public discovery'
  );

  SELECT * INTO v_tenant
  FROM public.set_tenant_active_status(
    v_created_id, true, 'fixture activation'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_tenant.is_active = true
    AND public.has_tenant_admin_authority(
      '64000000-0000-4000-8000-000000000003', v_created_id
    )
    AND public.has_event_admin_authority(
      '64000000-0000-4000-8000-000000000003',
      '62000000-0000-4000-8000-000000000001'
    ),
    'activation restores authority through the retained canonical assignment'
  );
  SELECT count(*) INTO v_count
  FROM public.get_public_discoverable_events_for_tenant(v_created_id) AS e
  WHERE e.id = '62000000-0000-4000-8000-000000000001';
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'activation restores public discovery through the retained Event'
  );

  SELECT * INTO v_tenant
  FROM public.set_tenant_active_status(
    v_created_id, false, 'fixture deactivation'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_tenant.is_active = false
    AND NOT public.has_tenant_admin_authority(
      '64000000-0000-4000-8000-000000000003', v_created_id
    ),
    'deactivation reapplies the reversible operational freeze'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    public.t3_tenant_administration_fixture_related_count('event', v_created_id) = 1
    AND public.t3_tenant_administration_fixture_related_count('assignment', v_created_id)
      = v_assignment_count
    AND public.t3_tenant_administration_fixture_related_count('hostname', v_created_id)
      = v_mapping_count,
    'deactivation preserves Event, assignment, and hostname records'
  );
  SELECT count(*) INTO v_count
  FROM public.list_tenant_owned_events_for_administration(v_created_id) AS e
  WHERE e.id = '62000000-0000-4000-8000-000000000001'
    AND e.tenant_id = v_created_id;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_count = 1,
    'Platform can inspect retained Event ownership while Tenant is inactive'
  );

  SELECT * INTO v_tenant
  FROM public.set_tenant_active_status(
    v_created_id, true, 'fixture reactivation'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_tenant.is_active = true
    AND public.t3_tenant_administration_fixture_related_count('event', v_created_id) = 1
    AND public.t3_tenant_administration_fixture_related_count(
      'assignment',
      v_created_id,
      '63000000-0000-4000-8000-000000000003'
    ) = 1
    AND public.t3_tenant_administration_fixture_related_count('hostname', v_created_id) = 1,
    'reactivation reuses all retained canonical records without duplication'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    EXISTS (
      SELECT 1
      FROM public.list_tenant_admin_access(v_created_id) AS a
      WHERE a.id = v_assignment_id AND a.is_active = true
    )
    AND EXISTS (
      SELECT 1
      FROM public.list_tenant_hostname_mappings_for_administration(v_created_id) AS h
      WHERE h.id = v_mapping_id AND h.is_active = true
    ),
    'reactivation preserves assignment and hostname row identities'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_failed boolean;
BEGIN
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );
  PERFORM set_config(
    'request.jwt.claim.sub',
    '64000000-0000-4000-8000-000000000003',
    true
  );

  v_failed := false;
  BEGIN
    PERFORM public.list_tenant_administration_audit(v_created_id, 100);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Tenant administration requires active Platform Administrator authority.';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed,
    'Tenant Admin authority does not imply Platform Tenant administration authority'
  );
END;
$fixture$;

DO $fixture$
DECLARE
  v_created_id uuid;
  v_action_count bigint;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '64000000-0000-4000-8000-000000000001',
    true
  );
  v_created_id := public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  );

  SELECT count(DISTINCT a.action) INTO v_action_count
  FROM public.list_tenant_administration_audit(v_created_id, 500) AS a
  WHERE a.action IN (
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
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_action_count = 13,
    'durable audit covers every successful Tenant administration command outcome'
  );
END;
$fixture$;

RESET ROLE;

DO $fixture$
DECLARE
  v_audit_id uuid;
  v_failed boolean;
BEGIN
  SELECT taa.id INTO v_audit_id
  FROM public.tenant_administration_audit AS taa
  WHERE taa.tenant_id = public.t3_tenant_administration_fixture_tenant_id(
    'T3-FIXTURE-CREATED'
  )
  ORDER BY taa.occurred_at, taa.id
  LIMIT 1;

  v_failed := false;
  BEGIN
    UPDATE public.tenant_administration_audit
    SET reason = 'forbidden mutation'
    WHERE id = v_audit_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'tenant_administration_audit is immutable';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed,
    'audit UPDATE is blocked even for table owner execution'
  );

  v_failed := false;
  BEGIN
    DELETE FROM public.tenant_administration_audit
    WHERE id = v_audit_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'tenant_administration_audit is immutable';
  END;
  PERFORM public.t3_tenant_administration_fixture_assert(
    v_failed,
    'audit DELETE is blocked even for table owner execution'
  );
END;
$fixture$;

DO $fixture$
BEGIN
  PERFORM public.t3_tenant_administration_fixture_assert(
    EXISTS (
      SELECT 1
      FROM t3_production_tenant_snapshot AS snapshot
      JOIN public.tenants AS t
        ON t.organization_code = 'FCOC'
       AND to_jsonb(t) = snapshot.tenant_state
    ),
    'pre-existing FCOC Tenant remains byte/value-equivalent and active'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    (SELECT t.is_active FROM public.tenants AS t WHERE t.organization_code = 'FCOC'),
    'FCOC remains active'
  );
  PERFORM public.t3_tenant_administration_fixture_assert(
    public.t3_tenant_administration_fixture_related_count(
      'event',
      public.t3_tenant_administration_fixture_tenant_id('T3-FIXTURE-CREATED')
    ) = 1,
    'fixture has exactly one retained Event before outer rollback'
  );
END;
$fixture$;

ROLLBACK;
