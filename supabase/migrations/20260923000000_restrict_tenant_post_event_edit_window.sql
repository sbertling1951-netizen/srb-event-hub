-- ---------------------------------------------------------------------------
-- Tenant Branding P-1D.1 -- restrict the TENANT-level post-Event editing
-- window to NULL or 0-59.
--
-- Accepted product decision:
--   * Blank / NULL  = the Platform default of 60 days (unchanged -- the
--     COALESCE(event_override, tenant_value, 60) fallback in
--     public.event_effective_lifecycle_state() still applies).
--   * An explicit tenant value may only make the tenant's normal
--     preservation policy STRICTER than the Platform default: 0-59.
--       - 0    = no post-Event editing after the Event ends.
--       - 1-59 = the tenant's shorter standard editing window.
--   * 60 is a redundant representation of the Platform default: existing
--     tenant rows storing EXACTLY 60 are normalized to NULL by this
--     migration (behavior-preserving -- the resolver's COALESCE(.., .., 60)
--     produces the identical effective window). Going forward, a submitted
--     value of 60 is REJECTED by the RPCs and the CHECK; an administrator
--     selects Platform-default behavior by leaving the field blank.
--   * A value > 60 is NOT automatically convertible and requires explicit
--     review. If ANY tenant row stores a value > 60 this migration ABORTS
--     before normalizing or changing anything. Editing windows LONGER than
--     the Platform default are a governed SINGLE-EVENT exception (P-1E),
--     applied through public.events.post_event_edit_window_days.
--
-- Scope / ORDER of this migration (all in one transaction):
--   1. Pre-flight guard -- abort (NO data change, NO constraint change,
--      NO RPC change) if any tenant row stores post_event_edit_window_days
--      > 60. Runs FIRST, before any UPDATE.
--   2. Approved historical normalization: UPDATE tenants storing EXACTLY 60
--      -> NULL. Only runs once step 1 has confirmed no value > 60 exists.
--      0-59 and existing NULLs are never touched.
--   3. Tighten ONLY public.tenants.post_event_edit_window_days's CHECK
--      constraint to NULL OR 0-59.
--   4. CREATE OR REPLACE the two governed tenant-metadata write RPCs with
--      the same 0-59 ceiling (defense in depth; clean error message). The
--      RPCs do NOT normalize a newly submitted 60 -- they reject it.
--
-- Explicitly OUT of scope / unchanged:
--   * public.events.post_event_edit_window_days -- its CHECK stays
--     `IS NULL OR >= 0`; NOT normalized; the P-1E single-Event override may
--     legitimately exceed 60.
--   * public.event_effective_lifecycle_state() -- the resolver, its
--     COALESCE(event, tenant, 60) hierarchy, and its Event-local day-
--     boundary / DST math are untouched. This is why 60 -> NULL is
--     behavior-preserving.
--   * public.assert_event_lifecycle_mutable() and every mutation gate.
--   * Historical-Event behavior and the prospective-policy-change concern
--     (both remain P-1E's responsibility).
--   * RPC signatures, authority (_require_platform_admin_actor), the audit
--     insert, the patch key allowlist, and every other validation branch.
-- ---------------------------------------------------------------------------

BEGIN;

-- 1. Pre-flight (runs FIRST -- before the step-2 UPDATE): a tenant value
--    > 60 is not automatically convertible. Abort the whole transaction
--    with NO data change, NO normalization, NO constraint change, NO RPC
--    change.
DO $$
DECLARE
  v_offending text;
BEGIN
  SELECT string_agg(
           format('%s (%s) = %s',
                  t.organization_code, t.id, t.post_event_edit_window_days),
           ', ' ORDER BY t.organization_code)
    INTO v_offending
  FROM public.tenants AS t
  WHERE t.post_event_edit_window_days IS NOT NULL
    AND t.post_event_edit_window_days > 60;

  IF v_offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Aborting 20260923000000: tenant rows store post_event_edit_window_days > 60 and are NOT automatically convertible: %. A value above the 60-day Platform default requires explicit review (it is a governed single-Event exception, not a tenant-wide policy). No normalization, constraint, or RPC change was made.',
      v_offending;
  END IF;
END $$;

-- 2. Approved historical normalization: EXACTLY 60 -> NULL. Behavior-
--    preserving via COALESCE(event, tenant, 60). Never touches 0-59 or
--    existing NULLs; never touches public.events.
UPDATE public.tenants
SET post_event_edit_window_days = NULL
WHERE post_event_edit_window_days = 60;

-- 3. Tighten the TENANT-level CHECK constraint only.
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_post_event_edit_window_days_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_post_event_edit_window_days_check
  CHECK (
    post_event_edit_window_days IS NULL
    OR post_event_edit_window_days BETWEEN 0 AND 59
  );

-- public.events.post_event_edit_window_days is DELIBERATELY LEFT ALONE:
-- events_post_event_edit_window_days_check stays `IS NULL OR >= 0`.

-- 4. Governed RPC validation -- CREATE OR REPLACE, signatures unchanged,
--    exactly one validation branch tightened in each.

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
    AND (p_post_event_edit_window_days < 0 OR p_post_event_edit_window_days > 59) THEN
    RAISE EXCEPTION 'Tenant Post-Event edit window must be blank (Platform default of 60 days) or an integer from 0 through 59.';
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
      IF v_post_event_edit_window_days > 59 THEN
        RAISE EXCEPTION 'Tenant Post-Event edit window must be blank (Platform default of 60 days) or an integer from 0 through 59.';
      END IF;
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

COMMIT;
