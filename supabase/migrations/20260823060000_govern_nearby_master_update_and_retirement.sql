-- Nearby Event/Tenant/Shared Scope Model -- Stage 1: governed canonical
-- Nearby-place update and retirement.
--
-- Two new SECURITY DEFINER RPCs replace the architectural need for the
-- raw, ungoverned public.nearby_master client .update()/.delete() calls
-- app/admin/nearby/page.tsx currently makes -- not wired to that page in
-- this migration (UI adoption is a separate, later stage). Stage 2
-- (per-place Event association, populating event_nearby_places.
-- source_master_id), Stage 3 (the unified editor), scope conversion,
-- and duplicate-merge tooling are explicitly out of scope here.
--
-- LIVE-RLS PREFLIGHT (read fresh against the linked database before
-- writing anything below, per instruction -- not assumed from migration
-- history): public.nearby_master carries RLS the tracked migration
-- history never recorded. One ALL-command policy ("Admins can manage
-- nearby master", TO authenticated, USING/WITH CHECK
-- admin_users.privilege_group IN ('super_admin','event_admin',
-- 'content_admin')) and two redundant open SELECT policies ("Anyone can
-- view nearby master", "public read nearby_master", TO anon+authenticated,
-- USING (true)). Table-level grants additionally show anon holding the
-- full undifferentiated privilege set (SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER) -- the same historical drift pattern
-- already reconciled for event_nearby_places (20260819090000) and
-- master_maps (20260819150000), but never applied here. anon's raw
-- INSERT/UPDATE/DELETE grants are RLS-inert (only `authenticated` is
-- listed in "Admins can manage nearby master"'s roles); anon's SELECT is
-- live and reachable (an explicit anon-role policy); anon's TRUNCATE is,
-- as in every sibling case, never RLS-governed and therefore a real,
-- separate gap. This is real, previously-undocumented drift -- and it is
-- NOT reconciled by this migration. Neither new RPC below depends on, is
-- weakened by, or requires touching this policy/grant state: both are
-- SECURITY DEFINER, owned by postgres, so table RLS never applies to
-- their own internal reads/writes regardless of the calling role's raw
-- table privileges -- exactly the same reasoning that already let
-- record_tenant_place (Stage 0) work correctly regardless of this same
-- drift. Per instruction, Stage 1 proceeds narrowly, leaving this policy/
-- grant state untouched; it remains open for a separate, deliberate
-- reconciliation decision, not silently normalized here.
--
-- CONCURRENCY: public.nearby_master carries no updated_at, no version,
-- and no revision counter of any kind (confirmed live -- only
-- `created_at`). Neither RPC below invents one. Both use plain
-- last-write-wins UPDATE semantics, identical to the concurrency
-- characteristics of the raw .update() call they replace -- no
-- regression, and no new versioning system built solely for this stage.
--
-- SHAPE PRECEDENT: both RPCs follow public.update_presentation_deck /
-- public.archive_presentation_deck (20260813170000) exactly -- load the
-- target row first, authorize from what was loaded (never a caller
-- claim), validate, then a single unconditional UPDATE ... RETURNING.
-- Neither calls assert_event_lifecycle_mutable: that guard is scoped to
-- an Event's own lifecycle and has no meaning here -- a reusable
-- nearby_master row belongs to a Tenant or the whole platform, never to
-- one Event, so there is no single Event lifecycle state to consult.
--
-- AUTHORITY: derived exclusively from the target row's own stored
-- `scope`/`tenant_id` -- never from a caller-supplied parameter.
-- tenant_specific -> has_tenant_admin_authority(auth.uid(), tenant_id)
-- (Tenant Admin for that exact Tenant, or Super Admin -- verified live in
-- this same preflight to check has_platform_admin_authority first).
-- shared_public -> has_platform_admin_authority(auth.uid()) (Super Admin
-- only, launch default -- a Tenant Admin may propose a Shared candidate
-- since Stage 0, but may not directly edit or retire an approved Shared
-- canonical record merely because contributed_by_tenant_id matches their
-- Tenant; that would be curation authority reaching into global-catalog
-- governance, exactly the boundary Stage 0's header already establishes
-- for record_tenant_place/review_shared_place).
--
-- AUDIT: per the approved Nearby Scope Model design, a dedicated
-- nearby_master_command_audit table (mirroring place_category_command_
-- audit, 20260821250000) was explicitly classified as deferrable, not
-- required for launch. No general-purpose audit mechanism already
-- covers nearby_master mutations. Consistent with that decision, no
-- audit table is added here; full command history for these two
-- operations remains deferred to a later, separately authorized stage.

-- ---------------------------------------------------------------------------
-- 1. public.update_nearby_master_place -- canonical metadata only.
--
-- Editable fields mirror exactly what app/admin/nearby/page.tsx's
-- current Stored Place editor (StoredPlaceForm) already exposes, plus
-- location_code (also present there, alongside lat/lng): name, address,
-- phone, website (-> link), category + category_id (kept as an explicit
-- pair, never re-derived here -- the same caller-keeps-them-in-lockstep
-- contract record_tenant_place already establishes), notes (->
-- description), lat, lng, location_code.
--
-- Never touched by this RPC, at all: scope, tenant_id,
-- contributed_by_tenant_id, review_status, reviewed_by, reviewed_at,
-- status, source_type, evidence_quality, created_by, created_at, area_id,
-- hours -- area_id and hours are not part of the current Stored Place
-- editor's field set either, so neither is added here merely because the
-- column exists. This is metadata maintenance only, never a scope-
-- conversion path.
--
-- Validation matches record_tenant_place's own precedent exactly: name
-- required (trimmed check, stored value untrimmed, matching that
-- function's own established behavior bit-for-bit); no other field is
-- validated or normalized inside the RPC, trusting caller-normalized
-- input, exactly as record_tenant_place already does.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_nearby_master_place(
  p_place_id uuid,
  p_name text,
  p_category_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_location_code text DEFAULT NULL
)
RETURNS public.nearby_master
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_scope text;
  v_tenant_id uuid;
  v_row public.nearby_master%ROWTYPE;
BEGIN
  SELECT nm.scope, nm.tenant_id INTO v_scope, v_tenant_id
  FROM public.nearby_master AS nm
  WHERE nm.id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_nearby_master_place: no nearby_master row % found', p_place_id;
  END IF;

  IF v_scope = 'tenant_specific' THEN
    IF NOT public.has_tenant_admin_authority(auth.uid(), v_tenant_id) THEN
      RAISE EXCEPTION 'update_nearby_master_place: caller is not an active Tenant Admin (or Super Admin) for tenant %', v_tenant_id;
    END IF;
  ELSIF v_scope = 'shared_public' THEN
    IF NOT public.has_platform_admin_authority(auth.uid()) THEN
      RAISE EXCEPTION 'update_nearby_master_place: caller is not an active super_admin';
    END IF;
  ELSE
    RAISE EXCEPTION 'update_nearby_master_place: place % has an unrecognized scope %', p_place_id, v_scope;
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'update_nearby_master_place: name is required';
  END IF;

  UPDATE public.nearby_master
  SET
    name = p_name,
    category = p_category,
    category_id = p_category_id,
    address = p_address,
    phone = p_phone,
    link = p_website,
    lat = p_lat,
    lng = p_lng,
    description = p_notes,
    location_code = p_location_code
  WHERE id = p_place_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.update_nearby_master_place(
  uuid, text, uuid, text, text, text, text, numeric, numeric, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_nearby_master_place(
  uuid, text, uuid, text, text, text, text, numeric, numeric, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_nearby_master_place(
  uuid, text, uuid, text, text, text, text, numeric, numeric, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.retire_nearby_master_place -- archive, never hard delete.
--
-- Default (and only) action is public.nearby_master.status = 'archived'
-- (the table's existing three-value status vocabulary -- active/hidden/
-- archived, live since the original baseline table). A hard DELETE is
-- not implemented in this stage -- nothing in the approved architecture
-- or established codebase convention clearly requires one, and archival
-- alone already satisfies "retire without destroying Event history":
-- since this is a plain UPDATE, it can never violate any FK, and no
-- event_nearby_places row (whether or not it happens to reference this
-- place via source_master_id) is read, written, or affected in any way.
--
-- Idempotent by construction, matching archive_presentation_deck's own
-- established shape exactly: the UPDATE has no `AND status <> 'archived'`
-- guard, so retiring an already-archived place is a safe no-op that
-- still succeeds and still returns the current reference counts --
-- never an error for that reason alone.
--
-- Reference counts are informational only, never a gate: because
-- retirement never deletes the row, no reference count can ever make
-- retirement unsafe, so none blocks it. Verified live, not assumed from
-- the prior audit's own inventory: two additional live FKs reference
-- nearby_master beyond the two the prior audit already named --
-- events.selected_nearby_master_id (ON DELETE SET NULL) and
-- nearby_event.master_id (ON DELETE SET NULL) -- both confirmed-dead
-- application-code paths (nearby_event itself has zero live consumers),
-- yet nearby_event.master_id alone carries 36 live legacy rows today.
-- Both are surfaced, summed, and clearly labeled `legacy_reference_count`
-- so a future UI can distinguish real operational impact
-- (event_place_references, tenant_relevance_references) from inert
-- legacy-table noise, rather than silently dropping evidence the
-- preflight actually found.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.retire_nearby_master_place(p_place_id uuid)
RETURNS TABLE (
  id uuid,
  status text,
  scope text,
  tenant_id uuid,
  event_place_references integer,
  tenant_relevance_references integer,
  legacy_reference_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_scope text;
  v_tenant_id uuid;
BEGIN
  SELECT nm.scope, nm.tenant_id INTO v_scope, v_tenant_id
  FROM public.nearby_master AS nm
  WHERE nm.id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'retire_nearby_master_place: no nearby_master row % found', p_place_id;
  END IF;

  IF v_scope = 'tenant_specific' THEN
    IF NOT public.has_tenant_admin_authority(auth.uid(), v_tenant_id) THEN
      RAISE EXCEPTION 'retire_nearby_master_place: caller is not an active Tenant Admin (or Super Admin) for tenant %', v_tenant_id;
    END IF;
  ELSIF v_scope = 'shared_public' THEN
    IF NOT public.has_platform_admin_authority(auth.uid()) THEN
      RAISE EXCEPTION 'retire_nearby_master_place: caller is not an active super_admin';
    END IF;
  ELSE
    RAISE EXCEPTION 'retire_nearby_master_place: place % has an unrecognized scope %', p_place_id, v_scope;
  END IF;

  UPDATE public.nearby_master
  SET status = 'archived'
  WHERE id = p_place_id;

  RETURN QUERY
  SELECT
    nm.id,
    nm.status,
    nm.scope,
    nm.tenant_id,
    (
      SELECT count(*)::integer FROM public.event_nearby_places AS enp
      WHERE enp.source_master_id = nm.id
    ) AS event_place_references,
    (
      SELECT count(*)::integer FROM public.tenant_place_relevance AS tpr
      WHERE tpr.place_id = nm.id
    ) AS tenant_relevance_references,
    (
      (SELECT count(*)::integer FROM public.events AS e WHERE e.selected_nearby_master_id = nm.id)
      + (SELECT count(*)::integer FROM public.nearby_event AS ne WHERE ne.master_id = nm.id)
    ) AS legacy_reference_count
  FROM public.nearby_master AS nm
  WHERE nm.id = p_place_id;
END;
$function$;

ALTER FUNCTION public.retire_nearby_master_place(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.retire_nearby_master_place(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retire_nearby_master_place(uuid) TO authenticated;
