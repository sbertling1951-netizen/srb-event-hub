-- Nearby Event/Tenant/Shared Scope Model -- Stage 2.5: safe linked-place
-- Event reassignment (Part A) + deliberate nearby_master RLS/grant
-- reconciliation (Part B). Stage 3 (unified editor, Move UI, scope/
-- destination selectors) is explicitly not part of this migration.
--
-- CONSUMER AUDIT (fresh, exhaustive, before Part B changes anything):
-- repository-wide grep of every `.from("nearby_master")` call finds
-- exactly one file -- app/admin/nearby/page.tsx, an authenticated Admin
-- surface gated by AdminRouteGuard requiredTask="event.nearby.manage".
-- No anon-facing page, component, or member-side surface reads
-- nearby_master directly, anywhere. The only anon-reachable Nearby data
-- path is public.resolve_effective_nearby_places, which reads
-- event_nearby_places exclusively (its nearby_master UNION branch has
-- been disabled since 20260811120000, pending an unrelated geographic-
-- constraint design). public.search_shared_places is SECURITY DEFINER
-- and already authenticated-only per its own grant (20260811120000) --
-- unaffected by anything below. Conclusion: no accepted live path
-- requires direct anon table access to nearby_master, for SELECT or any
-- mutation.
--
-- admin_users.privilege_group live distribution (informs Part B's
-- authenticated-bridge decision): 2 super_admin, 8 event_admin, 1
-- checkin, 0 content_admin -- the CHECK constraint still permits
-- content_admin even though no row currently uses it. The overwhelming
-- majority of today's admins are event_admin -- exactly the population
-- the legacy "Admins can manage nearby master" policy currently lets
-- write nearby_master directly, and exactly who still depends on
-- app/admin/nearby/page.tsx's Stored Place panel (5 raw write call
-- sites: saveStoredPlace insert+update, deleteStoredPlace delete,
-- bulkGeocodeStoredPlaces/reGeocodeStoredPlace lat/lng-only updates) --
-- none of which Stage 3 has replaced yet.

-- ---------------------------------------------------------------------------
-- PART A -- public.reassign_event_nearby_place
--
-- Closes the exact gap Stage 2's own closeout flagged: the raw
-- event_nearby_places UPDATE path safely re-checks
-- has_event_task_authority against the destination event_id (RLS's
-- WITH CHECK, unchanged, still correct) but has no knowledge of whether
-- a linked place's reuse scope remains valid for that destination's
-- Tenant. This RPC is the dedicated governed replacement for a raw
-- `.update({event_id: ...})` on a source_master_id-linked row; no
-- existing RPC already owns cross-Event reassignment (checked: no
-- "reassign"/"move" operation anywhere in this schema relocates a
-- resource between two independently-authorized parents the way this
-- one must), so encoding the missing scope check into RLS instead of a
-- dedicated function was rejected -- RLS has no way to consult
-- nearby_master's scope/tenant_id from an event_nearby_places policy
-- without either a cross-table subquery baked into the policy itself
-- (fragile, hard to reason about, diverges from every other governed-
-- write precedent in this schema) or exactly the function this migration
-- adds.
--
-- Authority: BOTH the source and destination Event's
-- has_event_task_authority('event.nearby.manage', ...) are required --
-- mirroring exactly what the existing raw UPDATE's RLS already checks
-- (USING against the old row's event_id, WITH CHECK against the new
-- one), so this RPC is never less permissive than the path it replaces,
-- only additionally scope-aware. Knowing an event_nearby_places row's
-- UUID never substitutes for either authority check.
--
-- Event Only (source_master_id IS NULL): no reusable-scope concept
-- applies at all -- ownership simply follows the destination Event, so
-- once both authority checks pass the move proceeds with no further
-- validation. No fuzzy name/address duplicate detection is invented for
-- these rows (none has ever existed for them, and inventing one now
-- would manufacture false identity from display text) -- an Event Only
-- move can never conflict with anything at the destination by
-- construction.
--
-- Tenant-linked (scope = 'tenant_specific'): destination Event's
-- tenant_id must equal the linked place's tenant_id exactly (IS
-- DISTINCT FROM, matching associate_nearby_master_place_with_event's own
-- comparison) -- a Tenant-scoped reusable place can never move into
-- another Tenant's Event, closing the exact gap this stage exists to
-- close.
--
-- Shared-linked (scope = 'shared_public'): no tenant match required --
-- any destination Event already authorized above may receive it.
--
-- CANONICAL-STATE QUESTION, decided: moving an already-linked place is
-- NOT blocked by the master's current status/review_status, even if it
-- has since become archived/hidden or (hypothetically) fallen out of
-- pending_review. Event rows are historical snapshots (§ Stage 2's own
-- header: "an Event's historical Nearby list is already immune to the
-- canonical place being edited, retired, or archived later"); a move
-- relocates an EXISTING, already-valid reference rather than creating a
-- new one, so it does not fall under "preventing creation of new invalid
-- reuse" -- that is exactly what associate_nearby_master_place_with_event
-- (Stage 2) already gates for brand-new associations, and remains
-- unchanged. Only the Tenant/scope match is re-validated on move; no
-- status or review_status check exists in this function at all.
--
-- Duplicate destination: if the destination Event already has a row
-- linked to the same source_master_id, the move raises a named
-- conflict exception rather than either creating a second linked row or
-- silently returning the destination's unrelated existing row as if the
-- source row had moved (it would not have -- the source row would still
-- exist, untouched, at its original Event, which is not what "moved"
-- means). Event Only rows have no such conflict concept and are never
-- checked.
--
-- Row identity, snapshot fields, source_master_id: all preserved.
-- The UPDATE's SET clause touches only event_id and sort_order -- name,
-- address, phone, website, category, category_id, notes, location_code,
-- lat, lng, is_hidden, distance_miles, source_master_id are all
-- untouched, exactly matching "preserve the Event snapshot fields."
-- sort_order is appended after the destination Event's current maximum,
-- the same convention associate_nearby_master_place_with_event (Stage 2)
-- and the existing admin editor's own saveEventPlace() already use for a
-- newly-arriving row. nearby_master itself is only ever read here, never
-- written.
--
-- Lifecycle: assert_event_lifecycle_mutable is checked for BOTH the
-- source and destination Event, matching this RPC's Event-scoped-write
-- classification exactly like associate_nearby_master_place_with_event
-- (Stage 2) already established for this exact table.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reassign_event_nearby_place(
  p_event_place_id uuid,
  p_destination_event_id uuid
)
RETURNS public.event_nearby_places
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.event_nearby_places%ROWTYPE;
  v_source_event_id uuid;
  v_destination_tenant_id uuid;
  v_place public.nearby_master%ROWTYPE;
  v_existing public.event_nearby_places%ROWTYPE;
  v_sort_order integer;
BEGIN
  SELECT * INTO v_row
  FROM public.event_nearby_places
  WHERE id = p_event_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reassign_event_nearby_place: event nearby place % not found', p_event_place_id;
  END IF;

  v_source_event_id := v_row.event_id;

  IF NOT public.has_event_task_authority('event.nearby.manage', v_source_event_id) THEN
    RAISE EXCEPTION 'reassign_event_nearby_place: caller is not authorized to manage nearby places for the source event %', v_source_event_id;
  END IF;

  IF NOT public.has_event_task_authority('event.nearby.manage', p_destination_event_id) THEN
    RAISE EXCEPTION 'reassign_event_nearby_place: caller is not authorized to manage nearby places for the destination event %', p_destination_event_id;
  END IF;

  IF p_destination_event_id = v_source_event_id THEN
    RETURN v_row;
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_source_event_id);
  PERFORM public.assert_event_lifecycle_mutable(p_destination_event_id);

  SELECT e.tenant_id INTO v_destination_tenant_id
  FROM public.events AS e
  WHERE e.id = p_destination_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reassign_event_nearby_place: destination event % not found', p_destination_event_id;
  END IF;

  IF v_row.source_master_id IS NOT NULL THEN
    SELECT nm.* INTO v_place
    FROM public.nearby_master AS nm
    WHERE nm.id = v_row.source_master_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'reassign_event_nearby_place: linked master place % no longer exists', v_row.source_master_id;
    END IF;

    IF v_place.scope = 'tenant_specific' THEN
      IF v_place.tenant_id IS DISTINCT FROM v_destination_tenant_id THEN
        RAISE EXCEPTION 'reassign_event_nearby_place: place % belongs to a different tenant than destination event %', v_place.id, p_destination_event_id;
      END IF;
    ELSIF v_place.scope = 'shared_public' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'reassign_event_nearby_place: place % has an unrecognized scope %', v_place.id, v_place.scope;
    END IF;

    SELECT * INTO v_existing
    FROM public.event_nearby_places
    WHERE event_id = p_destination_event_id AND source_master_id = v_row.source_master_id;

    IF FOUND THEN
      RAISE EXCEPTION 'reassign_event_nearby_place: destination event % already has this place associated (event_nearby_places %)', p_destination_event_id, v_existing.id;
    END IF;
  END IF;

  v_sort_order := COALESCE(
    (SELECT max(sort_order) FROM public.event_nearby_places WHERE event_id = p_destination_event_id),
    0
  ) + 1;

  UPDATE public.event_nearby_places
  SET event_id = p_destination_event_id,
      sort_order = v_sort_order
  WHERE id = p_event_place_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.reassign_event_nearby_place(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reassign_event_nearby_place(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reassign_event_nearby_place(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- PART B -- reconcile the live nearby_master RLS/grant drift.
--
-- EXACT PRE-CHANGE STATE (verified live, immediately before this
-- migration): RLS enabled; three policies absent from tracked migration
-- history until now -- "Admins can manage nearby master" (FOR ALL, TO
-- authenticated, USING/WITH CHECK admin_users.privilege_group IN
-- ('super_admin','event_admin','content_admin')), "Anyone can view
-- nearby master" and "public read nearby_master" (both FOR SELECT, TO
-- anon+authenticated, USING (true) -- functionally identical
-- duplicates). Table grants: anon held the full undifferentiated set
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER).
--
-- ANON: revoked entirely. The consumer audit above found no accepted
-- live path -- anon or otherwise -- ever reads nearby_master directly;
-- INSERT/UPDATE/DELETE were already RLS-inert (no permissive policy ever
-- named anon for mutation); TRUNCATE was the one genuinely live,
-- ungoverned gap (Postgres never subjects TRUNCATE to RLS regardless of
-- policy) -- closed here, matching the exact precedent already applied
-- to event_nearby_places (20260819090000) and master_maps
-- (20260819150000). anon's previously-live, reachable SELECT
-- (USING (true) explicitly named anon) is also closed -- both open
-- SELECT policies are dropped and replaced by one authenticated-only
-- policy below.
--
-- AUTHENTICATED SELECT: preserved, unchanged in effect -- still every
-- authenticated caller, still unconditional. The two duplicate policies
-- are consolidated into one, dropping only the anon role from their
-- combined effect; no authenticated consumer's read behavior changes.
--
-- AUTHENTICATED WRITE ("Admins can manage nearby master"): PRESERVED, not
-- removed, as a deliberate, temporary, now-explicitly-tracked
-- compatibility bridge -- renamed to
-- nearby_master_legacy_authenticated_write_bridge with this exact
-- comment attached, functionally identical predicate (same three
-- privilege_group values, unchanged -- neither broadened nor narrowed).
-- Removing it now would strand the 8 of 11 live admin_users rows in
-- privilege_group 'event_admin' -- the population Stages 0-2's governed
-- model deliberately does NOT grant Tenant/Shared canonical-place write
-- authority to (has_tenant_admin_authority/has_platform_admin_authority,
-- not privilege_group, is the canonical model) -- out of the one
-- production UI (app/admin/nearby/page.tsx's Stored Place panel) that
-- still depends on raw writes for 5 call sites: saveStoredPlace's
-- insert+update, deleteStoredPlace's hard delete, and
-- bulkGeocodeStoredPlaces/reGeocodeStoredPlace's lat/lng-only updates.
-- Fully retiring this bridge requires migrating all five call sites to
-- record_tenant_place/update_nearby_master_place/
-- retire_nearby_master_place (or a governed equivalent for the two
-- geocode-only updates) inside a new Stored Place editor -- that is
-- Stage 3 UI work, explicitly out of scope here. Stage 3 MUST drop this
-- policy (`DROP POLICY nearby_master_legacy_authenticated_write_bridge
-- ON public.nearby_master;`) once every one of those five call sites is
-- migrated to a governed RPC, and not before.
--
-- No canonical governed RPC's own access is affected by any of this:
-- record_tenant_place, update_nearby_master_place,
-- retire_nearby_master_place, associate_nearby_master_place_with_event,
-- review_shared_place, search_shared_places, and this migration's own
-- reassign_event_nearby_place are all SECURITY DEFINER, owned by
-- postgres -- table RLS has never applied to their internal reads/writes
-- and still does not.
-- ---------------------------------------------------------------------------

DROP POLICY "Admins can manage nearby master" ON public.nearby_master;
DROP POLICY "Anyone can view nearby master" ON public.nearby_master;
DROP POLICY "public read nearby_master" ON public.nearby_master;

CREATE POLICY nearby_master_authenticated_select_policy
  ON public.nearby_master
  FOR SELECT
  TO authenticated
  USING (true);

-- TEMPORARY, deliberately preserved -- see PART B comment above for the
-- exact retirement condition. Not a new capability: identical predicate
-- to the policy it replaces.
CREATE POLICY nearby_master_legacy_authenticated_write_bridge
  ON public.nearby_master
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users AS au
      WHERE au.user_id = auth.uid()
        AND au.is_active = true
        AND au.privilege_group = ANY (ARRAY['super_admin', 'event_admin', 'content_admin'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users AS au
      WHERE au.user_id = auth.uid()
        AND au.is_active = true
        AND au.privilege_group = ANY (ARRAY['super_admin', 'event_admin', 'content_admin'])
    )
  );

REVOKE ALL ON TABLE public.nearby_master FROM anon;
