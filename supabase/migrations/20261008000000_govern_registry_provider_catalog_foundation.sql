-- Catalog P1: the separate, empty, Platform-Admin-governed Registry
-- Provider Catalog and its curation workspace.
--
-- Governed by docs/architecture/EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md
-- (specializing EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md §H stage 1:
-- "Catalog contract and curation... Nothing is exposed to organizers yet.").
--
-- ===========================================================================
-- WHAT THIS MIGRATION IS
-- ===========================================================================
-- A platform-owned, shared-catalog ASSET table plus a content-free curation
-- AUDIT table, and four Platform-Admin-only governed RPCs to list, create,
-- correct, and activate/deactivate an asset. Nothing else.
--
-- ===========================================================================
-- WHAT THIS MIGRATION IS NOT (deliberately, per the CMD-LEM's P1 boundary)
-- ===========================================================================
--   * NO organizer-facing search, browse, or selection surface of any kind --
--     no RPC in this migration is reachable by anything other than a
--     Platform Administrator;
--   * NO private Registry Plan change -- self_service_private_draft_registry_plans
--     and its RPCs (20261004000000) are untouched and unreferenced;
--   * NO catalog-asset-ID snapshot, private-plan reference, or "selection"
--     concept of any kind;
--   * NO seed data -- the ONLY INSERT into the asset table anywhere in this
--     migration is inside create_registry_provider_catalog_asset, and this
--     migration performs zero calls to it. A fresh apply leaves the catalog
--     EMPTY;
--   * NO vendors / event_vendors / Nearby / maps / tenant read or write of
--     any kind;
--   * NO category, geography, alias, ranking, popularity, import, or
--     external API connection;
--   * NO website fetch, open, preview, unfurl, crawl, or health-check --
--     public_website is opaque display text, exactly like the Private
--     Registry Plan's own actual-registry URL;
--   * NO hard-delete path and no automatic retirement -- there is no DELETE
--     RPC and no DELETE statement anywhere in this file;
--   * NO new or modified global authority helper -- this migration reads
--     the existing public.has_platform_admin_authority(uuid) unchanged and
--     defines no Platform / Tenant / Event authority predicate of its own.
--
-- ===========================================================================
-- ACCESS MODEL
-- ===========================================================================
-- Both tables: RLS ENABLED, ALL privileges REVOKEd from PUBLIC, anon,
-- authenticated, AND service_role, and ZERO CREATE POLICY anywhere in this
-- file. This is deliberately stricter than Stage 6B's master_maps pattern
-- (which retargeted RLS policies to allow direct authenticated writes under
-- has_platform_admin_authority): the CMD-LEM requires "no permissive
-- public/member/tenant policy" and "deny direct browser/service-role table
-- access," so every read and write -- including the Platform Admin's own --
-- goes through a governed SECURITY DEFINER RPC (owner postgres), which
-- bypasses RLS as the table owner exactly like every other governed
-- surface in this codebase. Direct table access is denied to every browser
-- role, with no exception for an admin session.
--
-- Every mutating RPC: derives the actor from auth.uid() only; calls
-- has_platform_admin_authority(auth.uid()) and fails closed with a plain,
-- non-content-bearing message for anyone else (an unauthenticated caller, an
-- inactive admin, a Tenant Administrator, an Event Administrator, a
-- Vendor-Catalog Administrator, an organizer, a vendor, or anon/service_role
-- attempting a direct RPC call); locks the target asset FOR UPDATE and
-- requires an exact p_expected_revision match on every update / activation
-- change (raising the bare sentinel 'stale_registry_provider_catalog_asset'
-- on mismatch, with zero row mutation); and writes exactly one audit row
-- per successful mutation. No RPC in this file joins, reads, counts, or
-- otherwise discloses self_service_private_draft_registry_plans, any other
-- private-plan table, an Event, a Tenant, or an organizer/Person identity.
--
-- ===========================================================================
-- CURATION AUDIT
-- ===========================================================================
-- registry_provider_catalog_curation_audit holds ONLY: an audit id, the
-- catalog asset id, the acting Platform Admin's admin_users.id, one of four
-- action values, the revision before and after the action, and a timestamp.
-- It is append-only (a BEFORE UPDATE OR DELETE trigger raises on any attempt
-- to touch an existing row, the same immutability pattern already used by
-- self_service_event_deletion_audit, 20260926000000) and carries NO provider
-- name, description, website, JSON payload, before/after row state,
-- free-text reason, private-plan data, usage count, or Event/Tenant/Person
-- reference of any kind. This migration adds no RPC that reads the audit
-- table: the required P1 UI (list, create, correct, activate/deactivate,
-- active/inactive status) does not call for a curation-history view, so
-- none is built. A governed administrative read may be added later as its
-- own separately scoped, separately authorized change if the UI ever needs
-- one.
--
-- RUNTIME: this migration was NOT applied to any database (local, linked,
-- or production) during this task, and its linked rollback fixture
-- (supabase/integration-tests/20261008000000_registry_provider_catalog_foundation_rollback.sql)
-- was NOT executed, per this task's explicit read-only-until-separately-
-- authorized instruction. Both are proven only by the accompanying static
-- structural test (supabase/migrations/20261008000000_....test.ts) and by
-- direct correspondence to already-proven syntax and authority patterns
-- elsewhere in this exact migration corpus (GENERATED ALWAYS AS ... STORED:
-- 20260805150000; immutable append-only audit table: 20260926000000; the
-- has_platform_admin_authority(uuid) lock-and-CAS shape: 20260915000000).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The platform-shared catalog asset table.
--    A DEDICATED table for this one asset category, per the Shared Planning
--    Catalog contract's explicit prohibition on one generic polymorphic
--    planning/catalog table (§C, "No single generic planning table").
--    Platform-owned: no event_id, no tenant_id, no organizer/Person column
--    of any kind -- this is a description, never a private planning record.
-- ---------------------------------------------------------------------------
CREATE TABLE public.registry_provider_catalog_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The organizer/admin-facing display name, exactly as a Platform Admin
  -- typed it. Never rewritten by normalization.
  provider_name text NOT NULL
    CONSTRAINT registry_provider_catalog_assets_provider_name_valid
    CHECK (btrim(provider_name) <> '' AND length(btrim(provider_name)) <= 200),

  -- Collision-detection key ONLY (contract §5, "normalize provider names
  -- only to detect a collision"). GENERATED so it can never drift from
  -- provider_name and never needs its own INSERT/UPDATE argument -- the
  -- same GENERATED ALWAYS AS ... STORED shape already proven in this
  -- migration corpus (participant_capacity_adjustments.quantity_added,
  -- 20260805150000). lower()/btrim()/regexp_replace() with a literal
  -- pattern are all IMMUTABLE, so this is a legal generation expression.
  normalized_name text GENERATED ALWAYS AS (
    regexp_replace(lower(btrim(provider_name)), '\s+', ' ', 'g')
  ) STORED,

  -- Required per contract §3. Length-bounded for storage safety only --
  -- no format, scheme, or content validation, matching the Registry Plan's
  -- own treatment of opaque organizer-facing text.
  short_description text NOT NULL
    CONSTRAINT registry_provider_catalog_assets_short_description_valid
    CHECK (btrim(short_description) <> '' AND length(btrim(short_description)) <= 300),

  -- OPAQUE, INERT DISPLAY TEXT. Required per contract §3. Deliberately NO
  -- format/scheme check and NO uniqueness constraint (contract §5: "Website
  -- uniqueness must not be enforced as an identity rule") -- this value is
  -- never fetched, opened, previewed, crawled, unfurled, or health-checked
  -- by anything in this migration or any RPC it defines.
  public_website text NOT NULL
    CONSTRAINT registry_provider_catalog_assets_public_website_valid
    CHECK (btrim(public_website) <> '' AND length(btrim(public_website)) <= 500),

  -- Inactive-first, per contract §3: "Platform Admin creates assets inactive
  -- by default and explicitly activates them after review."
  is_active boolean NOT NULL DEFAULT false,

  -- Optimistic-concurrency token. Reliable by construction: RLS forbids
  -- direct writes below, so the governed RPCs are the sole mutation path,
  -- exactly like master_maps.revision (20260915000000).
  revision integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.registry_provider_catalog_assets OWNER TO postgres;

COMMENT ON TABLE public.registry_provider_catalog_assets IS
  'Catalog P1: platform-owned, Platform-Admin-governed Registry Provider Catalog assets. No event/tenant/organizer ownership. No organizer-facing surface exists yet -- creation, correction, and activation are Platform-Admin-only.';
COMMENT ON COLUMN public.registry_provider_catalog_assets.normalized_name IS
  'Collision-detection key only, generated from provider_name. Never independently writable, never displayed as a separate field, never an identity or search key beyond duplicate-name detection.';
COMMENT ON COLUMN public.registry_provider_catalog_assets.public_website IS
  'Opaque public display text only. Never fetched, opened, previewed, crawled, unfurled, or health-checked by EpicentraX.';
COMMENT ON COLUMN public.registry_provider_catalog_assets.is_active IS
  'Defaults to false. An asset is visible to any future organizer-facing surface only after an explicit Platform Admin activation -- a separate, later-gated capability not built by this migration.';

-- Enforces contract §5's "An unresolved normalized-name collision blocks
-- creation until manually resolved" -- a real database constraint, not an
-- application-level check, so it holds under concurrent creation too.
-- Deliberately the ONLY uniqueness constraint on this table: public_website
-- is intentionally NOT unique.
ALTER TABLE public.registry_provider_catalog_assets
  ADD CONSTRAINT registry_provider_catalog_assets_normalized_name_key
  UNIQUE (normalized_name);

-- Admin-list ordering support only; not a search or discovery index.
CREATE INDEX registry_provider_catalog_assets_active_name_idx
  ON public.registry_provider_catalog_assets (is_active, provider_name);

ALTER TABLE public.registry_provider_catalog_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registry_provider_catalog_assets
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The content-free curation audit. Append-only; immutable by trigger,
--    exactly like self_service_event_deletion_audit (20260926000000).
-- ---------------------------------------------------------------------------
CREATE TABLE public.registry_provider_catalog_curation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_asset_id uuid NOT NULL
    REFERENCES public.registry_provider_catalog_assets(id) ON DELETE RESTRICT,
  -- The acting Platform Admin, referenced by admin_users.id -- the same
  -- actor_admin_user_id shape already used by event_definition_command_audit
  -- (20260824030000) and participant_capacity_adjustments (20260805150000).
  actor_admin_user_id uuid NOT NULL
    REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'asset_created', 'asset_corrected', 'asset_activated', 'asset_deactivated'
  )),
  revision_before integer NOT NULL CHECK (revision_before >= 0),
  revision_after integer NOT NULL CHECK (revision_after >= revision_before),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.registry_provider_catalog_curation_audit OWNER TO postgres;

COMMENT ON TABLE public.registry_provider_catalog_curation_audit IS
  'Catalog P1 curation audit. Content-free by construction: no provider name, description, website, JSON payload, before/after row state, free-text reason, private-plan data, usage count, or Event/Tenant/Person reference. Append-only -- see the immutability trigger below.';

CREATE INDEX registry_provider_catalog_curation_audit_asset_idx
  ON public.registry_provider_catalog_curation_audit (catalog_asset_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_registry_provider_catalog_curation_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'registry_provider_catalog_curation_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_registry_provider_catalog_curation_audit_mutation()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_registry_provider_catalog_curation_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_registry_provider_catalog_curation_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.registry_provider_catalog_curation_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_registry_provider_catalog_curation_audit_mutation();

ALTER TABLE public.registry_provider_catalog_curation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registry_provider_catalog_curation_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helper: fail closed unless the caller is an authenticated,
--    active Platform Administrator; return that admin's admin_users.id for
--    use as the audit actor. Never calls has_tenant_admin_authority,
--    has_event_task_authority, has_vendor_catalog_admin_authority, or any
--    other authority predicate -- Platform authority only, exactly as the
--    contract requires ("No curation authority in this pilot" for Tenant
--    administrators; "No access through this planning surface" for every
--    other actor, §5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._registry_provider_catalog_authorize()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_admin_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Registry provider catalog management requires an authenticated Platform Administrator account.';
  END IF;

  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Registry provider catalog management requires Platform Administrator authority.';
  END IF;

  SELECT au.id INTO v_admin_user_id
  FROM public.admin_users AS au
  WHERE au.user_id = auth.uid()
    AND au.is_active = true
    AND au.privilege_group = 'super_admin'
  LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Registry provider catalog management requires Platform Administrator authority.';
  END IF;

  RETURN v_admin_user_id;
END;
$function$;

ALTER FUNCTION public._registry_provider_catalog_authorize() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._registry_provider_catalog_authorize()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Internal helper: lock one asset FOR UPDATE and enforce the exact
--    expected-revision compare-and-swap. Callers must already have passed
--    _registry_provider_catalog_authorize(). Raises the bare sentinel
--    'stale_registry_provider_catalog_asset' on a revision mismatch, the
--    same bare-sentinel convention as 'stale_master_map' (20260915000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._registry_provider_catalog_lock(
  p_asset_id uuid,
  p_expected_revision integer
)
RETURNS public.registry_provider_catalog_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.registry_provider_catalog_assets%ROWTYPE;
BEGIN
  IF p_asset_id IS NULL THEN
    RAISE EXCEPTION 'A registry provider catalog asset id is required.';
  END IF;

  SELECT * INTO v_row
  FROM public.registry_provider_catalog_assets
  WHERE id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registry provider catalog asset not found.';
  END IF;

  IF p_expected_revision IS NULL OR v_row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale_registry_provider_catalog_asset';
  END IF;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public._registry_provider_catalog_lock(uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._registry_provider_catalog_lock(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Shared field validation. All three catalog fields are REQUIRED (unlike
--    the private planning tools' mostly-optional fields) -- a catalog card
--    needs all three to be a card at all. Length-only checks; no format,
--    scheme, category, geography, or content validation of any kind.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._registry_provider_catalog_validate(
  p_provider_name text,
  p_short_description text,
  p_public_website text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_provider_name IS NULL OR btrim(p_provider_name) = '' OR length(btrim(p_provider_name)) > 200 THEN
    RAISE EXCEPTION 'A registry provider name of 1 to 200 characters is required.';
  END IF;
  IF p_short_description IS NULL OR btrim(p_short_description) = '' OR length(btrim(p_short_description)) > 300 THEN
    RAISE EXCEPTION 'A short public description of 1 to 300 characters is required.';
  END IF;
  IF p_public_website IS NULL OR btrim(p_public_website) = '' OR length(btrim(p_public_website)) > 500 THEN
    RAISE EXCEPTION 'A public provider website of 1 to 500 characters is required.';
  END IF;
END;
$function$;

ALTER FUNCTION public._registry_provider_catalog_validate(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._registry_provider_catalog_validate(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. List: every asset, active AND inactive, for Platform Admin curation
--    only. Returns rows and nothing derived -- no usage count, no reference
--    count, no "where used," no private-plan join of any kind.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_registry_provider_catalog_assets_for_platform_admin()
RETURNS TABLE(
  id uuid,
  provider_name text,
  short_description text,
  public_website text,
  is_active boolean,
  revision integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._registry_provider_catalog_authorize();

  RETURN QUERY
  SELECT a.id, a.provider_name, a.short_description, a.public_website,
         a.is_active, a.revision, a.created_at, a.updated_at
  FROM public.registry_provider_catalog_assets AS a
  ORDER BY a.provider_name, a.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Create: ALWAYS inactive. This is the ONLY INSERT into the asset table
--    anywhere in this migration -- a fresh apply seeds nothing, and this
--    migration never calls this function itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_registry_provider_catalog_asset(
  p_provider_name text,
  p_short_description text,
  p_public_website text
)
RETURNS TABLE(
  id uuid,
  provider_name text,
  short_description text,
  public_website text,
  is_active boolean,
  revision integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_admin_user_id uuid;
  v_name text := btrim(p_provider_name);
  v_description text := btrim(p_short_description);
  v_website text := btrim(p_public_website);
  v_row public.registry_provider_catalog_assets%ROWTYPE;
BEGIN
  v_admin_user_id := public._registry_provider_catalog_authorize();
  PERFORM public._registry_provider_catalog_validate(v_name, v_description, v_website);

  BEGIN
    INSERT INTO public.registry_provider_catalog_assets (
      provider_name, short_description, public_website, is_active
    ) VALUES (
      v_name, v_description, v_website, false
    ) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'registry_provider_name_collision';
  END;

  INSERT INTO public.registry_provider_catalog_curation_audit (
    catalog_asset_id, actor_admin_user_id, action, revision_before, revision_after
  ) VALUES (
    v_row.id, v_admin_user_id, 'asset_created', 0, v_row.revision
  );

  RETURN QUERY SELECT
    v_row.id, v_row.provider_name, v_row.short_description, v_row.public_website,
    v_row.is_active, v_row.revision, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Update: correct display fields only. Never touches is_active -- that
--    is exclusively set_registry_provider_catalog_asset_active_status's
--    job, kept as a separate explicit control per the CMD-LEM's requirement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_registry_provider_catalog_asset(
  p_asset_id uuid,
  p_expected_revision integer,
  p_provider_name text,
  p_short_description text,
  p_public_website text
)
RETURNS TABLE(
  id uuid,
  provider_name text,
  short_description text,
  public_website text,
  is_active boolean,
  revision integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_admin_user_id uuid;
  v_current public.registry_provider_catalog_assets%ROWTYPE;
  v_name text := btrim(p_provider_name);
  v_description text := btrim(p_short_description);
  v_website text := btrim(p_public_website);
  v_row public.registry_provider_catalog_assets%ROWTYPE;
BEGIN
  v_admin_user_id := public._registry_provider_catalog_authorize();
  v_current := public._registry_provider_catalog_lock(p_asset_id, p_expected_revision);
  PERFORM public._registry_provider_catalog_validate(v_name, v_description, v_website);

  BEGIN
    UPDATE public.registry_provider_catalog_assets AS a
    SET provider_name = v_name,
        short_description = v_description,
        public_website = v_website,
        revision = a.revision + 1,
        updated_at = now()
    WHERE a.id = p_asset_id
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'registry_provider_name_collision';
  END;

  INSERT INTO public.registry_provider_catalog_curation_audit (
    catalog_asset_id, actor_admin_user_id, action, revision_before, revision_after
  ) VALUES (
    v_row.id, v_admin_user_id, 'asset_corrected', v_current.revision, v_row.revision
  );

  RETURN QUERY SELECT
    v_row.id, v_row.provider_name, v_row.short_description, v_row.public_website,
    v_row.is_active, v_row.revision, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Activate / deactivate: the ONE explicit control that ever changes
--    is_active. Never writable by update_registry_provider_catalog_asset.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_registry_provider_catalog_asset_active_status(
  p_asset_id uuid,
  p_expected_revision integer,
  p_is_active boolean
)
RETURNS TABLE(
  id uuid,
  provider_name text,
  short_description text,
  public_website text,
  is_active boolean,
  revision integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_admin_user_id uuid;
  v_current public.registry_provider_catalog_assets%ROWTYPE;
  v_row public.registry_provider_catalog_assets%ROWTYPE;
BEGIN
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'An active status is required.';
  END IF;

  v_admin_user_id := public._registry_provider_catalog_authorize();
  v_current := public._registry_provider_catalog_lock(p_asset_id, p_expected_revision);

  UPDATE public.registry_provider_catalog_assets AS a
  SET is_active = p_is_active,
      revision = a.revision + 1,
      updated_at = now()
  WHERE a.id = p_asset_id
  RETURNING * INTO v_row;

  INSERT INTO public.registry_provider_catalog_curation_audit (
    catalog_asset_id, actor_admin_user_id, action, revision_before, revision_after
  ) VALUES (
    v_row.id, v_admin_user_id,
    CASE WHEN p_is_active THEN 'asset_activated' ELSE 'asset_deactivated' END,
    v_current.revision, v_row.revision
  );

  RETURN QUERY SELECT
    v_row.id, v_row.provider_name, v_row.short_description, v_row.public_website,
    v_row.is_active, v_row.revision, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Ownership and ACLs. Internal helpers granted to nobody; the four
--     public RPCs are authenticated-only (the RPC's own internal
--     authorize() call is the real boundary -- a merely-authenticated
--     non-Platform-Admin caller reaches the function but is refused inside
--     it, exactly like every other governed RPC in this codebase).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.list_registry_provider_catalog_assets_for_platform_admin() OWNER TO postgres;
ALTER FUNCTION public.create_registry_provider_catalog_asset(text, text, text) OWNER TO postgres;
ALTER FUNCTION public.update_registry_provider_catalog_asset(uuid, integer, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.set_registry_provider_catalog_asset_active_status(uuid, integer, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_registry_provider_catalog_assets_for_platform_admin()
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_registry_provider_catalog_asset(text, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_registry_provider_catalog_asset(uuid, integer, text, text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_registry_provider_catalog_asset_active_status(uuid, integer, boolean)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_registry_provider_catalog_assets_for_platform_admin()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_registry_provider_catalog_asset(text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_registry_provider_catalog_asset(uuid, integer, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_registry_provider_catalog_asset_active_status(uuid, integer, boolean)
  TO authenticated;

COMMIT;
