-- Nearby Stored-Area authority / lifecycle repair (P1).
--
-- WHAT WAS WRONG (pre-existing since Stage 2.5 / Stage 3, on main):
--   public.upsert_stored_area_place, public.delete_stored_area_place and
--   public.assert_stored_area_management_authority all gated on a single
--   global check --
--     admin_users.is_active
--     AND privilege_group IN ('super_admin','event_admin','content_admin')
--   -- with NO tenant, event, platform-catalog, or per-row scope. That is a
--   plain global role-membership test (privilege_group is one column on the
--   admin_users row, not a per-tenant/per-event grant). Consequences:
--     * any active event_admin / content_admin could rewrite, reassign the
--       parent of, or HARD-DELETE (`DELETE FROM public.nearby_master`) any
--       shared_public catalog row in the legacy Stored-Area bucket
--       (area_id IS NOT NULL) -- data every tenant's Nearby experience
--       reads -- merely by knowing (or enumerating) its id;
--     * delete_stored_area_place physically deleted the canonical row,
--       cascading tenant_place_relevance and diverging from the canonical
--       archive-only lifecycle (retire_nearby_master_place);
--     * a caller could not be stopped from turning a "new contribution"
--       into an edit of an existing canonical row by supplying an id.
--
-- GOVERNING PRODUCT MODEL (ratified) -- see
-- docs/architecture/EPICENTRAX_NEARBY_KNOWLEDGE_AND_TENANT_CURATION_ARCHITECTURE.md
-- section 16:
--   1. Event Admin or higher may CONTRIBUTE new places into Stored Areas /
--      the shared catalog.
--   2. Contribution does not create permanent catalog ownership.
--   3. Within their own Event, Event Admins control the Event's
--      RELATIONSHIP to a place (associate / hide / remove) -- not the
--      canonical row.
--   4. Once saved into the shared/app-wide catalog, the canonical record is
--      system data.
--   5. Canonical shared-catalog governance = Super Admin / System Admin.
--   6. Historical Event/Tenant-scoped data = Tenant Admin or higher.
--   7. Normal governed lifecycle is archive/retire, never hard delete.
--   8. Removing a catalog place from one Event must never destroy the
--      canonical record or affect other Events.
--
-- THE SPLIT THIS MIGRATION IMPLEMENTS:
--   A. Contribution / creation (p_place_id IS NULL new place; new Stored
--      Area container) -> public.assert_stored_area_contribution_authority
--      (p_event_id): real governed Event authority
--      (has_event_task_authority('event.nearby.manage', p_event_id)),
--      Event lifecycle mutable, fail-closed if no Event context. This is
--      the SAME capability the rest of the Nearby subsystem already uses
--      (associate_nearby_master_place_with_event,
--      reuse_nearby_places_by_google_place_id_for_event) -- resolve_task_
--      authority grants it to platform admins, the Event's tenant admins,
--      and holders of an explicit event grant, i.e. "Event Admin or
--      higher". No new broad cross-platform write permission is invented.
--   B. Canonical shared-record modification (edit / reassign parent /
--      retire an EXISTING shared_public catalog row) ->
--      public.assert_stored_area_canonical_authority():
--      has_platform_admin_authority(auth.uid()) only. Contributing a place
--      never grants its contributor later edit/delete authority over it.
--   C. Event-specific hide / remove is unchanged and already governed --
--      it operates on public.event_nearby_places via that table's own
--      has_event_task_authority('event.nearby.manage', event_id) RLS
--      (20260811230000). Not touched here.
--   D. delete_stored_area_place no longer hard-deletes. Its callable
--      signature is preserved; it now delegates to the canonical
--      retire_nearby_master_place (status = 'archived', idempotent, no
--      cascade, referential history preserved). The name is retained for
--      caller compatibility and documented as retire-not-delete.
--
-- SCOPE GUARD: every path that touches an existing nearby_master row still
-- requires area_id IS NOT NULL (the legacy Stored-Area bucket) AND
-- scope = 'shared_public'. A tenant_specific row is refused with a pointer
-- to update_nearby_master_place / retire_nearby_master_place -- this
-- migration does not widen into tenant/history governance (model rule 6)
-- and does not touch nearby_master_authenticated_select_policy (P2).
--
-- NOT CHANGED: nearby_master RLS (no write policy exists; all writes are
-- SECURITY DEFINER RPCs owned by postgres), the P2 SELECT policy, the
-- db3c009 curated-list builder (it never calls these functions), Member
-- Nearby resolution, Reusable Area Lists.
--
-- RUNTIME: created, NOT applied. No local Supabase/PostgreSQL is available
-- in this environment (same constraint recorded for 20260911000000 and the
-- rest of this workstream). Only static / source-shape assertions and the
-- byte-equal parity check ran. The linked BEGIN..ROLLBACK fixture
-- (supabase/integration-tests/20260912000000_stored_area_contribution_and_
-- canonical_authority_rollback.sql) is ready to execute but has not been
-- run against a database.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- ---------------------------------------------------------------------------
-- A. Contribution authority -- governed Event authority, never global
--    privilege_group. Internal helper: REVOKE-only, called exclusively by
--    the SECURITY DEFINER functions below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_stored_area_contribution_authority(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Stored Area contribution requires a working Event context.';
  END IF;

  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'Stored Area contribution requires event.nearby.manage authority for the working Event %.', p_event_id;
  END IF;

  -- Genuinely Event-originated: an archived / indeterminate Event cannot be
  -- used as an authority anchor for a new contribution.
  PERFORM public.assert_event_lifecycle_mutable(p_event_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- B. Canonical authority -- System Admin only. Internal helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_stored_area_canonical_authority()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Shared Nearby catalog changes require System Administrator authority.';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- assert_stored_area_management_authority -- signature preserved for
-- compatibility. The global privilege_group check is REMOVED; it now
-- enforces canonical (System Admin) authority. It is no longer wired into
-- any mutation path (upsert_stored_area_place and create_stored_area call
-- the specific split helpers directly) -- retained only so any
-- out-of-tree caller fails safe rather than silently keeping the old
-- broad gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_stored_area_management_authority()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public.assert_stored_area_canonical_authority();
END;
$function$;

-- ---------------------------------------------------------------------------
-- create_stored_area -- CONTRIBUTION. Gains p_event_id; authority switches
-- from the global privilege_group check to governed Event contribution
-- authority. Body is otherwise byte-identical to 20260825010000 (the
-- name-reconciliation guards and the two atomic inserts are unchanged).
-- ---------------------------------------------------------------------------
DROP FUNCTION public.create_stored_area(text, text, numeric, text, text, text);

CREATE FUNCTION public.create_stored_area(
  p_name text,
  p_description text DEFAULT NULL,
  p_google_radius_miles numeric DEFAULT NULL,
  p_google_custom_search text DEFAULT NULL,
  p_google_search_city text DEFAULT NULL,
  p_google_search_state text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS public.nearby_area_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_name text := nullif(btrim(p_name), '');
  v_description text := nullif(btrim(p_description), '');
  v_parent public.nearby_areas%ROWTYPE;
  v_template public.nearby_area_templates%ROWTYPE;
BEGIN
  PERFORM public.assert_stored_area_contribution_authority(p_event_id);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Stored Area name is required.';
  END IF;

  -- A pre-existing same-name legacy record needs explicit reconciliation;
  -- neither name equality nor a prior template is identity evidence.
  IF EXISTS (
    SELECT 1
    FROM public.nearby_area_templates AS t
    WHERE lower(btrim(t.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A Stored Area template named % already exists and requires explicit parent reconciliation.', v_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.nearby_areas AS a
    WHERE lower(btrim(a.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A legacy Nearby Area named % already exists and requires explicit parent reconciliation.', v_name;
  END IF;

  INSERT INTO public.nearby_areas (name, description)
  VALUES (v_name, v_description)
  RETURNING * INTO v_parent;

  INSERT INTO public.nearby_area_templates (
    nearby_area_id,
    name,
    description,
    google_radius_miles,
    google_custom_search,
    google_search_city,
    google_search_state,
    google_last_run
  ) VALUES (
    v_parent.id,
    v_name,
    v_description,
    p_google_radius_miles,
    nullif(btrim(p_google_custom_search), ''),
    nullif(btrim(p_google_search_city), ''),
    nullif(btrim(p_google_search_state), ''),
    NULL
  )
  RETURNING * INTO v_template;

  RETURN v_template;
END;
$function$;

-- ---------------------------------------------------------------------------
-- upsert_stored_area_place -- the authority SPLIT.
--
--   p_place_id IS NULL  -> CONTRIBUTION: assert_stored_area_contribution_
--                          authority(p_event_id). Creates a shared_public
--                          catalog row (status 'active', review_status
--                          'approved' -- identical to the column defaults
--                          the legacy insert relied on; there is no review
--                          step for this bucket in the governing model).
--                          created_by is stamped for provenance;
--                          contribution confers no later edit authority.
--   p_place_id NOT NULL -> CANONICAL MODIFICATION: assert_stored_area_
--                          canonical_authority() (System Admin only). The
--                          target must be a Stored-Area bucket row
--                          (area_id IS NOT NULL) AND scope 'shared_public'.
--
-- The branch is purely `p_place_id IS NULL`, and the authority decision is
-- the FIRST statement -- before the template is resolved and before any
-- existing row is read. A caller supplying an arbitrary id, another row's
-- id, or an alternate template id cannot turn a contribution into a
-- canonical edit; a template id never confers authority (it is only a
-- parent lookup, and its existence is not probed until authority passes).
-- Gains p_event_id (trailing, DEFAULT NULL) -- ignored on the canonical
-- path, required on the contribution path.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
);

CREATE FUNCTION public.upsert_stored_area_place(
  p_place_id uuid,
  p_template_id uuid,
  p_name text,
  p_category_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_location_code text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS public.nearby_master
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_nearby_area_id uuid;
  v_existing_area_id uuid;
  v_existing_scope text;
  v_row public.nearby_master%ROWTYPE;
BEGIN
  -- Authority FIRST, branched on p_place_id, before any data probe.
  IF p_place_id IS NULL THEN
    PERFORM public.assert_stored_area_contribution_authority(p_event_id);
  ELSE
    PERFORM public.assert_stored_area_canonical_authority();
  END IF;

  IF p_template_id IS NULL THEN
    RAISE EXCEPTION 'Stored Area template identity is required.';
  END IF;

  SELECT t.nearby_area_id
  INTO v_nearby_area_id
  FROM public.nearby_area_templates AS t
  WHERE t.id = p_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area template % not found.', p_template_id;
  END IF;

  IF v_nearby_area_id IS NULL THEN
    RAISE EXCEPTION 'Stored Area template % has no explicit Nearby Area parent mapping.', p_template_id;
  END IF;

  IF p_place_id IS NULL THEN
    -- CONTRIBUTION: create a new shared_public catalog row.
    INSERT INTO public.nearby_master (
      area_id, name, category, category_id, address, phone, link,
      description, location_code, lat, lng,
      scope, status, review_status, created_by
    ) VALUES (
      v_nearby_area_id, p_name, p_category, p_category_id, p_address, p_phone, p_website,
      p_notes, p_location_code, p_lat, p_lng,
      'shared_public', 'active', 'approved', auth.uid()::text
    )
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  -- CANONICAL MODIFICATION (authority already asserted above).
  SELECT area_id, scope
  INTO v_existing_area_id, v_existing_scope
  FROM public.nearby_master
  WHERE id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area place % not found.', p_place_id;
  END IF;

  IF v_existing_area_id IS NULL THEN
    RAISE EXCEPTION 'Place % is not a Stored Area place.', p_place_id;
  END IF;

  IF v_existing_scope IS DISTINCT FROM 'shared_public' THEN
    RAISE EXCEPTION 'Place % is a tenant-scoped catalog record; use update_nearby_master_place.', p_place_id;
  END IF;

  UPDATE public.nearby_master
  SET
    area_id = v_nearby_area_id,
    name = p_name,
    category = p_category,
    category_id = p_category_id,
    address = p_address,
    phone = p_phone,
    link = p_website,
    description = p_notes,
    location_code = p_location_code,
    lat = p_lat,
    lng = p_lng
  WHERE id = p_place_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- delete_stored_area_place -- callable signature preserved; semantics are
-- now governed RETIRE / ARCHIVE, never physical deletion.
--
-- Delegates to the canonical public.retire_nearby_master_place, which for a
-- shared_public row enforces has_platform_admin_authority, sets
-- status = 'archived' (idempotent), performs NO cascade, and leaves every
-- event_nearby_places / tenant_place_relevance / nearby_area_list_members /
-- provider-identity reference intact. Removing a catalog place from one
-- Event is a separate concern handled on event_nearby_places and never
-- reaches this function.
--
-- The name is retained only so the single existing caller
-- (app/admin/nearby/page.tsx deleteStoredPlace) keeps working; it is
-- documented UI-side as "Retire", not "Delete".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_stored_area_place(p_place_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_area_id uuid;
  v_scope text;
BEGIN
  SELECT area_id, scope
  INTO v_area_id, v_scope
  FROM public.nearby_master
  WHERE id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stored Area place % not found.', p_place_id;
  END IF;

  IF v_area_id IS NULL THEN
    RAISE EXCEPTION 'Place % is not a Stored Area place.', p_place_id;
  END IF;

  IF v_scope IS DISTINCT FROM 'shared_public' THEN
    RAISE EXCEPTION 'Place % is a tenant-scoped catalog record; use retire_nearby_master_place.', p_place_id;
  END IF;

  -- Canonical governed retirement. retire_nearby_master_place re-derives
  -- authority from the row's own scope (shared_public -> System Admin) and
  -- archives without deleting or cascading.
  PERFORM public.retire_nearby_master_place(p_place_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Ownership + ACL hardening. Internal assert_* helpers stay REVOKE-only
-- (no role may call them directly). The three browser-reachable RPCs keep
-- their existing "authenticated EXECUTE, nothing else" posture -- the
-- authority decision is entirely inside the function body.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.assert_stored_area_contribution_authority(uuid) OWNER TO postgres;
ALTER FUNCTION public.assert_stored_area_canonical_authority() OWNER TO postgres;
ALTER FUNCTION public.assert_stored_area_management_authority() OWNER TO postgres;
ALTER FUNCTION public.create_stored_area(text, text, numeric, text, text, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid
) OWNER TO postgres;
ALTER FUNCTION public.delete_stored_area_place(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_stored_area_contribution_authority(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_stored_area_canonical_authority()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_stored_area_management_authority()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_stored_area(text, text, numeric, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_stored_area_place(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_stored_area(text, text, numeric, text, text, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_stored_area_place(uuid)
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
