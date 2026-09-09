-- Catalog P2: an optional, owner-private Registry Provider Catalog search and
-- attachment inside the existing private Registry Plan.
--
-- Governed by
-- docs/architecture/EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md
-- and docs/architecture/EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md.
-- Catalog P1 (20261008000000) remains an EMPTY Platform-Admin curation
-- foundation -- this migration adds no provider, seeds nothing, and does not
-- change one line of the P1 asset table, its audit table, or its four
-- Platform-Admin RPCs.
--
-- ===========================================================================
-- WHAT THIS MIGRATION IS
-- ===========================================================================
-- Four nullable columns on the EXISTING private Registry Plan table (a
-- catalog-asset reference plus a three-field snapshot of the approved public
-- card at the moment of selection); one new content-free selection audit
-- table; and four governed RPCs: search the active catalog by literal
-- provider-name prefix, attach/replace a selection, detach a selection, and
-- a catalog-aware sibling reader. Nothing else.
--
-- ===========================================================================
-- WHY THIS IS FOUR NULLABLE COLUMNS, NOT A NEW CHILD TABLE
-- ===========================================================================
-- A registry plan entry has AT MOST ONE catalog selection at a time (contract
-- §4: "attach/replace" replaces the prior selection in place; there is no
-- "many selections" concept). Four nullable columns on the existing row is
-- the correct additive-change shape per the Registry Plan contract's own
-- discipline (§H: "any later change to this field set adds nullable columns
-- ... it never renames, retypes, reorders, or removes what exists") and per
-- the Shared Planning Catalog contract's "no single generic planning table"
-- rule -- a separate one-row-per-selection table would just be this same
-- fact split across two tables for no reason. This is the SAME shape choice
-- 20261002000000 already made for the sibling Vendor Plan's contact fields.
--
-- ===========================================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ===========================================================================
--   * it does NOT touch list_my_private_draft_registry_plans,
--     add_my_private_draft_registry_plan, update_my_private_draft_registry_plan,
--     or delete_my_private_draft_registry_plan -- all four are BYTE-IDENTICAL
--     to 20261004000000. Ordinary Registry Plan saves can never see, clear,
--     or alter the catalog reference/snapshot, because those four functions'
--     SET clauses (verified unchanged below) simply never mention the four
--     new columns;
--   * it does NOT restate delete_self_service_organizer_event. This migration
--     adds no new table with a foreign key to public.events -- the four new
--     columns live ON the existing self_service_private_draft_registry_plans
--     row, already deleted by that function's existing
--     "DELETE FROM public.self_service_private_draft_registry_plans WHERE
--     event_id = ..." statement (20261004000000), and the new
--     registry_plan_catalog_selection_audit table below carries NO foreign
--     key to public.events (by design -- see §2), so the fail-closed
--     dependency scan never discovers or blocks on it either;
--   * it does NOT create, weaken, or bypass has_platform_admin_authority,
--     has_tenant_admin_authority, has_event_task_authority, or
--     has_vendor_catalog_admin_authority;
--   * it does NOT grant Platform Administration any read of private
--     selection activity -- the new audit table carries the same RLS-on,
--     REVOKE-ALL, zero-CREATE-POLICY posture as every other governed table in
--     this codebase, and this migration adds no read RPC for it;
--   * it does NOT fetch, open, preview, unfurl, crawl, or health-check the
--     public_website value at any point -- attach copies it as opaque text,
--     exactly like every other snapshot field;
--   * it does NOT create a reverse usage report, a per-asset reference count,
--     or any table that lets a query start from a catalog asset and find the
--     Events or People that selected it;
--   * it does NOT seed a single provider row -- Catalog P1 remains empty
--     after this migration, exactly as before it.
--
-- ===========================================================================
-- STRICT IDENTITY: NO no_link FALLBACK FOR CATALOG OPERATIONS
-- ===========================================================================
-- Every ordinary Registry Plan RPC (list/add/update/delete, all untouched
-- above) still accepts the existing self-service organizer owner predicate,
-- which includes the narrow no_link backward-compatibility branch
-- (v_link_status = 'no_link' AND oa.auth_user_id = v_actor) established by
-- P-2C. Catalog P2 is DELIBERATELY NARROWER: search / attach / detach / the
-- new catalog-aware list all require v_link_status = 'resolved' -- an
-- EXACTLY resolved canonical Person -- and nothing else. A no_link or
-- invalid_or_ambiguous caller is refused with the bare, non-enumerating
-- sentinel 'identity_resolution_required', revealing no plan or catalog
-- content, exactly as the contract requires (§4): "The existing no_link
-- account fallback is not an approved long-term authorization path for
-- catalog search or catalog selection. An unresolved account must complete
-- that identity-resolution process before it can access these operations."
-- A no_link organizer's ORDINARY Registry Plan (list/add/update/delete) is
-- completely unaffected and keeps working exactly as it does today.
--
-- Authorization for the strict operations is a NEW, separate helper
-- (_organizer_private_draft_registry_catalog_authorize), not a change to the
-- existing _organizer_private_draft_registry_plan_authorize
-- (20261004000000), which remains untouched and still governs the four
-- ordinary RPCs above.
--
-- ===========================================================================
-- SNAPSHOT-AT-SAVE, NEVER LIVE
-- ===========================================================================
-- Attach/replace copies the catalog asset's CURRENT approved card fields into
-- the plan row's own snapshot columns, inside the same locked transaction
-- that verifies the asset is active. Nothing here, and no RPC this migration
-- adds, ever re-reads live catalog data to "refresh" an existing snapshot --
-- a later catalog correction, deactivation, or reactivation never rewrites an
-- existing private snapshot (contract §4: "Stored snapshots never
-- automatically refresh after catalog edits, retirement, deactivation, or
-- reactivation"). A deactivated asset simply becomes unsearchable and
-- unselectable going forward; an existing snapshot pointing at it remains
-- fully visible to its owner exactly as saved.
--
-- ===========================================================================
-- RUNTIME: NOT applied to any database (local, linked, or production) during
-- this task, and its linked rollback fixture
-- (supabase/integration-tests/20261009000000_registry_plan_catalog_selection_rollback.sql)
-- was NOT executed, per this task's explicit read-only-until-separately-
-- authorized instruction. Proven only by the accompanying static structural
-- test.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Four nullable columns on the EXISTING private Registry Plan table.
--    Snapshot completeness is a real database constraint: either every
--    catalog field is NULL (no selection) or every one is present together
--    (a complete selection) -- never a partial state.
-- ---------------------------------------------------------------------------
ALTER TABLE public.self_service_private_draft_registry_plans
  ADD COLUMN catalog_asset_id uuid
    REFERENCES public.registry_provider_catalog_assets(id) ON DELETE RESTRICT,
  ADD COLUMN catalog_provider_name_snapshot text
    CHECK (catalog_provider_name_snapshot IS NULL OR length(catalog_provider_name_snapshot) <= 200),
  ADD COLUMN catalog_description_snapshot text
    CHECK (catalog_description_snapshot IS NULL OR length(catalog_description_snapshot) <= 300),
  ADD COLUMN catalog_website_snapshot text
    CHECK (catalog_website_snapshot IS NULL OR length(catalog_website_snapshot) <= 500);

COMMENT ON COLUMN public.self_service_private_draft_registry_plans.catalog_asset_id IS
  'Catalog P2: stable reference to a Catalog P1 provider asset. ON DELETE RESTRICT -- no CASCADE, no SET NULL, no automatic relinking; the catalog has no hard-delete path at all. NULL means no selection.';
COMMENT ON COLUMN public.self_service_private_draft_registry_plans.catalog_provider_name_snapshot IS
  'Private snapshot of the catalog card as it existed at selection time. Never automatically refreshed by a later catalog correction, deactivation, or reactivation.';

ALTER TABLE public.self_service_private_draft_registry_plans
  ADD CONSTRAINT self_service_private_draft_registry_plans_catalog_snapshot_complete
  CHECK (
    (
      catalog_asset_id IS NULL
      AND catalog_provider_name_snapshot IS NULL
      AND catalog_description_snapshot IS NULL
      AND catalog_website_snapshot IS NULL
    )
    OR (
      catalog_asset_id IS NOT NULL
      AND catalog_provider_name_snapshot IS NOT NULL
      AND catalog_description_snapshot IS NOT NULL
      AND catalog_website_snapshot IS NOT NULL
    )
  );

CREATE INDEX self_service_private_draft_registry_plans_catalog_asset_idx
  ON public.self_service_private_draft_registry_plans (catalog_asset_id)
  WHERE catalog_asset_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Content-free, append-only selection audit. Deliberately PLAIN uuid
--    columns for event_id and registry_plan_id -- NOT foreign keys -- so (a)
--    this table is never discovered by the events fail-closed dependency
--    scan and never blocks or is coupled to Draft/plan deletion, matching
--    self_service_event_deletion_audit's own established reasoning
--    (20260926000000), and (b) it NEVER stores catalog_asset_id at all, so
--    no row here can ever become a durable Event-to-provider association --
--    the one thing the contract most explicitly forbids (§5: "No reverse
--    selection list, cross-event usage report, popularity analytics ... may
--    be derived from private references").
-- ---------------------------------------------------------------------------
CREATE TABLE public.registry_plan_catalog_selection_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  registry_plan_id uuid NOT NULL,
  organizer_person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('attached', 'replaced', 'detached')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.registry_plan_catalog_selection_audit OWNER TO postgres;

COMMENT ON TABLE public.registry_plan_catalog_selection_audit IS
  'Catalog P2 owner-private selection audit. Content-free by construction: no provider name, description, website, actual registry URL, note, status, search query, selection payload, usage count, or catalog_asset_id -- storing that last one paired with event_id would itself be the forbidden Event-to-provider association. Append-only. No Platform-Admin or browser read path exists for this table.';

CREATE INDEX registry_plan_catalog_selection_audit_event_idx
  ON public.registry_plan_catalog_selection_audit (event_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_registry_plan_catalog_selection_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'registry_plan_catalog_selection_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_registry_plan_catalog_selection_audit_mutation()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_registry_plan_catalog_selection_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_registry_plan_catalog_selection_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.registry_plan_catalog_selection_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_registry_plan_catalog_selection_audit_mutation();

ALTER TABLE public.registry_plan_catalog_selection_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registry_plan_catalog_selection_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helper: STRICT owner authorization for catalog-related
--    operations only. Byte-for-byte the same eligible-private-Draft
--    predicate as _organizer_private_draft_registry_plan_authorize
--    (20261004000000) MINUS the no_link OR-branch -- see the header note
--    above. Never calls has_event_task_authority, has_tenant_admin_authority,
--    or any vendor/catalog-admin authority.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_draft_registry_catalog_authorize(p_event_id uuid)
RETURNS TABLE(organizer_appointment_id uuid, organizer_person_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_appt uuid;
  v_appt_person uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Using the registry provider catalog requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Using the registry provider catalog requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  -- STRICT: only an exactly resolved canonical Person may reach the catalog.
  -- Bare, non-enumerating sentinel -- it says nothing about whether a Draft
  -- exists, only that identity resolution must complete first.
  IF v_link_status <> 'resolved' THEN
    RAISE EXCEPTION 'identity_resolution_required';
  END IF;

  SELECT oa.id, oa.person_id
    INTO v_appt, v_appt_person
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  WHERE d.event_id = p_event_id
    AND oa.is_active = true
    AND oa.person_id = v_person_id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  LIMIT 1;

  IF v_appt IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  RETURN QUERY SELECT v_appt, v_appt_person;
END;
$function$;

ALTER FUNCTION public._organizer_private_draft_registry_catalog_authorize(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_draft_registry_catalog_authorize(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Search: active assets only, literal case-insensitive PREFIX match (not
--    LIKE -- so '%' and '_' are ordinary characters and can never act as
--    wildcards), a minimum of two characters, alphabetical order, capped at
--    10 results. Returns ONLY the three approved card fields plus the stable
--    asset id -- no category, no rank, no popularity, nothing else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_my_private_draft_registry_provider_catalog(
  p_event_id uuid,
  p_query text
)
RETURNS TABLE(
  id uuid,
  provider_name text,
  short_description text,
  public_website text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_query text := btrim(p_query);
BEGIN
  PERFORM public._organizer_private_draft_registry_catalog_authorize(p_event_id);

  -- Blank or a single character returns NO rows -- never a browse surface.
  IF v_query IS NULL OR length(v_query) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.id, a.provider_name, a.short_description, a.public_website
  FROM public.registry_provider_catalog_assets AS a
  WHERE a.is_active = true
    AND left(lower(a.provider_name), length(v_query)) = lower(v_query)
  ORDER BY a.provider_name, a.id
  LIMIT 10;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Attach / replace: the ONE explicit action that ever writes the catalog
--    reference and its snapshot. Locks BOTH the plan row and the catalog
--    asset row before checking is_active, so a concurrent deactivation and
--    a concurrent attach can never race into a partial or inconsistent
--    result -- see the header note above.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_my_private_draft_registry_plan_catalog_selection(
  p_event_id uuid,
  p_registry_plan_id uuid,
  p_catalog_asset_id uuid
)
RETURNS TABLE(
  id uuid,
  provider_name text,
  registry_url text,
  planning_status text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz,
  catalog_asset_id uuid,
  catalog_provider_name_snapshot text,
  catalog_description_snapshot text,
  catalog_website_snapshot text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_organizer_appointment_id uuid;
  v_organizer_person_id uuid;
  v_plan public.self_service_private_draft_registry_plans%ROWTYPE;
  v_asset public.registry_provider_catalog_assets%ROWTYPE;
  v_row public.self_service_private_draft_registry_plans%ROWTYPE;
  v_action text;
BEGIN
  SELECT organizer_appointment_id, organizer_person_id
    INTO v_organizer_appointment_id, v_organizer_person_id
  FROM public._organizer_private_draft_registry_catalog_authorize(p_event_id);

  IF p_registry_plan_id IS NULL THEN
    RAISE EXCEPTION 'Registry plan entry not found.';
  END IF;

  -- Every bare `id`/`event_id`/`catalog_asset_id` reference below is
  -- table-aliased and alias-qualified on purpose: this function's own
  -- RETURNS TABLE declares OUT columns named id / catalog_asset_id / ...,
  -- and PL/pgSQL exposes RETURNS TABLE columns as in-scope variables for
  -- the whole function body, so an unqualified `id` in a WHERE clause is a
  -- genuine ambiguity between that OUT variable and the table column, not
  -- just a style preference.
  SELECT * INTO v_plan
  FROM public.self_service_private_draft_registry_plans AS rp
  WHERE rp.id = p_registry_plan_id AND rp.event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registry plan entry not found.';
  END IF;

  IF p_catalog_asset_id IS NULL THEN
    RAISE EXCEPTION 'A catalog provider is required.';
  END IF;

  SELECT * INTO v_asset
  FROM public.registry_provider_catalog_assets AS a
  WHERE a.id = p_catalog_asset_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registry provider catalog asset not found.';
  END IF;

  -- Requires the asset to be active AT THIS EXACT LOCKED INSTANT.
  IF NOT v_asset.is_active THEN
    RAISE EXCEPTION 'registry_provider_catalog_asset_inactive';
  END IF;

  v_action := CASE WHEN v_plan.catalog_asset_id IS NULL THEN 'attached' ELSE 'replaced' END;

  -- Only the four catalog columns are written. provider_name, registry_url,
  -- planning_status, and organizer_note -- the organizer's own typed facts
  -- -- are never touched by this statement.
  UPDATE public.self_service_private_draft_registry_plans AS rp
  SET catalog_asset_id = v_asset.id,
      catalog_provider_name_snapshot = v_asset.provider_name,
      catalog_description_snapshot = v_asset.short_description,
      catalog_website_snapshot = v_asset.public_website,
      updated_at = now()
  WHERE rp.id = p_registry_plan_id AND rp.event_id = p_event_id
  RETURNING * INTO v_row;

  INSERT INTO public.registry_plan_catalog_selection_audit (
    event_id, registry_plan_id, organizer_person_id, actor_auth_user_id, action
  ) VALUES (
    p_event_id, p_registry_plan_id, v_organizer_person_id, auth.uid(), v_action
  );

  RETURN QUERY SELECT
    v_row.id, v_row.provider_name, v_row.registry_url, v_row.planning_status, v_row.organizer_note,
    v_row.created_at, v_row.updated_at, v_row.catalog_asset_id, v_row.catalog_provider_name_snapshot,
    v_row.catalog_description_snapshot, v_row.catalog_website_snapshot;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Detach: clears ONLY the four catalog columns. Every ordinary typed
--    field is preserved untouched. Writes an audit row only when a selection
--    genuinely existed to remove -- calling detach on an already-unselected
--    entry is a harmless no-op with no spurious audit noise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detach_my_private_draft_registry_plan_catalog_selection(
  p_event_id uuid,
  p_registry_plan_id uuid
)
RETURNS TABLE(
  id uuid,
  provider_name text,
  registry_url text,
  planning_status text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz,
  catalog_asset_id uuid,
  catalog_provider_name_snapshot text,
  catalog_description_snapshot text,
  catalog_website_snapshot text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_organizer_appointment_id uuid;
  v_organizer_person_id uuid;
  v_plan public.self_service_private_draft_registry_plans%ROWTYPE;
  v_row public.self_service_private_draft_registry_plans%ROWTYPE;
  v_had_selection boolean;
BEGIN
  SELECT organizer_appointment_id, organizer_person_id
    INTO v_organizer_appointment_id, v_organizer_person_id
  FROM public._organizer_private_draft_registry_catalog_authorize(p_event_id);

  -- See the identical note in attach_my_private_draft_registry_plan_catalog_selection
  -- above: this function's own RETURNS TABLE declares an `id` OUT column,
  -- so every bare `id`/`event_id` reference below is table-aliased and
  -- alias-qualified to avoid a genuine ambiguity, not just for style.
  SELECT * INTO v_plan
  FROM public.self_service_private_draft_registry_plans AS rp
  WHERE rp.id = p_registry_plan_id AND rp.event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registry plan entry not found.';
  END IF;

  v_had_selection := v_plan.catalog_asset_id IS NOT NULL;

  -- Only the four catalog columns are written. provider_name, registry_url,
  -- planning_status, and organizer_note are never touched by this statement.
  UPDATE public.self_service_private_draft_registry_plans AS rp
  SET catalog_asset_id = NULL,
      catalog_provider_name_snapshot = NULL,
      catalog_description_snapshot = NULL,
      catalog_website_snapshot = NULL,
      updated_at = now()
  WHERE rp.id = p_registry_plan_id AND rp.event_id = p_event_id
  RETURNING * INTO v_row;

  IF v_had_selection THEN
    INSERT INTO public.registry_plan_catalog_selection_audit (
      event_id, registry_plan_id, organizer_person_id, actor_auth_user_id, action
    ) VALUES (
      p_event_id, p_registry_plan_id, v_organizer_person_id, auth.uid(), 'detached'
    );
  END IF;

  RETURN QUERY SELECT
    v_row.id, v_row.provider_name, v_row.registry_url, v_row.planning_status, v_row.organizer_note,
    v_row.created_at, v_row.updated_at, v_row.catalog_asset_id, v_row.catalog_provider_name_snapshot,
    v_row.catalog_description_snapshot, v_row.catalog_website_snapshot;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Catalog-aware sibling reader. A NEW function, NOT a change to
--    list_my_private_draft_registry_plans (20261004000000), which stays
--    byte-identical below and keeps serving every existing caller -- including
--    a no_link organizer, who keeps full ordinary Registry Plan read access
--    forever. This reader requires the STRICT resolved-only authorize (it
--    surfaces catalog-sourced snapshot content, so it is itself a
--    catalog-related read per the contract), returns every plan entry's
--    existing seven fields plus its four catalog columns verbatim -- it never
--    re-derives a selection from live catalog data, and it never hides an
--    existing snapshot because the referenced asset has since gone inactive.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_private_draft_registry_plans_with_catalog(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  provider_name text,
  registry_url text,
  planning_status text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz,
  catalog_asset_id uuid,
  catalog_provider_name_snapshot text,
  catalog_description_snapshot text,
  catalog_website_snapshot text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_registry_catalog_authorize(p_event_id);

  RETURN QUERY
  SELECT rp.id, rp.provider_name, rp.registry_url, rp.planning_status, rp.organizer_note,
         rp.created_at, rp.updated_at, rp.catalog_asset_id, rp.catalog_provider_name_snapshot,
         rp.catalog_description_snapshot, rp.catalog_website_snapshot
  FROM public.self_service_private_draft_registry_plans AS rp
  WHERE rp.event_id = p_event_id
  ORDER BY rp.created_at, rp.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Ownership and ACLs for the five new functions. Internal helper granted
--    to nobody; the four public RPCs are authenticated-only.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.search_my_private_draft_registry_provider_catalog(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.attach_my_private_draft_registry_plan_catalog_selection(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.detach_my_private_draft_registry_plan_catalog_selection(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.list_my_private_draft_registry_plans_with_catalog(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.search_my_private_draft_registry_provider_catalog(uuid, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.attach_my_private_draft_registry_plan_catalog_selection(uuid, uuid, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.detach_my_private_draft_registry_plan_catalog_selection(uuid, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_my_private_draft_registry_plans_with_catalog(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.search_my_private_draft_registry_provider_catalog(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_my_private_draft_registry_plan_catalog_selection(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detach_my_private_draft_registry_plan_catalog_selection(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_private_draft_registry_plans_with_catalog(uuid) TO authenticated;

COMMIT;
