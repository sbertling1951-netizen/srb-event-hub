-- Stage 6C: Govern Event parking inventory synchronization -- linked proof.
--
-- Installs the exact Stage 6C parity block inside one outer transaction,
-- exercises sync_master_map_parking_inventory_to_event + the RLS/grant
-- retarget against real fixture data, and rolls everything back. Proves:
-- Event-scoped task authority is required and inherited authority works
-- (platform inherits; explicit event grant authorizes; a legacy global
-- privilege_group value alone does NOT; an admin for another Event is
-- refused; anon is refused); stale selected-map / stale revision are
-- refused; occupancy / notes / row id / attendees.assigned_site /
-- site_placement_history are never touched by a sync; display-only
-- reconciliation is applied to occupied rows; a vacant row is fully
-- resynced; an unambiguous successor identity relinks master_site_id
-- (occupied rows too) without occupancy mutation; ambiguous successor
-- matches, occupied orphans, and occupied renumbers are reported as
-- conflicts with ZERO mutation; a vacant orphan is reported but never
-- deleted; a manual (master_site_id IS NULL) row is untouched; missing
-- inventory materializes vacant; apply is idempotent; direct browser
-- INSERT/UPDATE/DELETE on parking_sites is closed and the retargeted RLS
-- requires has_event_task_authority; record_site_placement and
-- materialize_event_parking_site are untouched.
--
-- Executed once against a disposable local database (npm run
-- db:verify-replay stack) during Stage 6C implementation; NOT run against
-- production.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Grant hardening -- no browser-reachable role performs a direct
--    INSERT/UPDATE/DELETE on parking_sites any more; the governed
--    SECURITY DEFINER RPCs (record_site_placement,
--    materialize_event_parking_site, and
--    sync_master_map_parking_inventory_to_event below), all owned by
--    postgres, are the only mutation path. SELECT / REFERENCES / TRIGGER
--    are retained -- Parking Admin, the realtime subscriptions, the
--    Attendees roster reader, and the public map surfaces all read the
--    table. REVOKE of an absent privilege is a no-op, so this is safe
--    whether or not production's ambient grant state matches -- same
--    posture as 20260814020000 / 20260915000000.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parking_sites FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. RLS retarget -- defense-in-depth. If a direct-mutation grant is ever
--    re-introduced out of band, the policy requires canonical Event-scoped
--    authority instead of the legacy global privilege_group. The SELECT
--    policies ("Admins can view parking sites", "Public read parking",
--    "public read parking_sites") are deliberately left byte-for-byte
--    untouched. The legacy write-policy names are asserted present by the
--    guard block; the drops here use IF EXISTS so this whole block is
--    idempotent (safe to replay, safe to install standalone in the linked
--    fixture).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert parking sites" ON public.parking_sites;
DROP POLICY IF EXISTS "Event parking admins can insert parking sites" ON public.parking_sites;
CREATE POLICY "Event parking admins can insert parking sites"
  ON public.parking_sites
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_event_task_authority('event.parking.manage', event_id));

DROP POLICY IF EXISTS "Admins can update parking sites" ON public.parking_sites;
DROP POLICY IF EXISTS "Event parking admins can update parking sites" ON public.parking_sites;
CREATE POLICY "Event parking admins can update parking sites"
  ON public.parking_sites
  FOR UPDATE
  TO authenticated
  USING (public.has_event_task_authority('event.parking.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.parking.manage', event_id));

DROP POLICY IF EXISTS "Admins can delete parking sites" ON public.parking_sites;
DROP POLICY IF EXISTS "Event parking admins can delete parking sites" ON public.parking_sites;
CREATE POLICY "Event parking admins can delete parking sites"
  ON public.parking_sites
  FOR DELETE
  TO authenticated
  USING (public.has_event_task_authority('event.parking.manage', event_id));

-- ---------------------------------------------------------------------------
-- 3. sync_master_map_parking_inventory_to_event -- the governed inventory
--    synchronization command (Specification §6.1).
--
--    p_event_id                        the Event whose inventory is synced
--    p_expected_selected_master_map_id the caller's belief of the Event's
--                                      currently-selected master map (CAS)
--    p_expected_map_revision           the caller's belief of that map's
--                                      master_maps.revision (Stage 6B CAS)
--    p_apply                           false = preview (no mutation);
--                                      true  = apply, all-or-nothing
--
--    Returns a single row:
--      outcome         'previewed' | 'applied' | 'rejected'
--      rejection_code  NULL unless rejected
--                      ('no_selected_master_map' | 'stale_selected_map'
--                       | 'stale_master_map' | 'unresolved_conflicts')
--      added           vacant rows created (or that would be) from selected
--                      master sites with no Event inventory row
--      reconciled      existing rows whose template-derived display fields
--                      were (or would be) refreshed -- vacant rows also
--                      resync site_number; occupied rows NEVER do
--      relinked        occupied-or-vacant rows whose master_site_id was
--                      (or would be) migrated to the unambiguous successor
--                      site on the newly-selected map version
--      orphaned_vacant vacant rows no longer on the selected map -- REPORTED
--                      ONLY, never deleted
--      manual_rows     rows with master_site_id IS NULL -- left untouched
--      conflicts       jsonb array; each element:
--                        { parking_site_id, master_site_id, site_number,
--                          kind, detail }
--                      kind IN ('occupied_orphan','occupied_renumber',
--                               'ambiguous_successor_match',
--                               'successor_collision')
--
--    Apply performs NO mutation when conflicts is non-empty
--    (rejection_code = 'unresolved_conflicts'); the operator resolves the
--    conflicts through record_site_placement and re-runs. A vacant orphan
--    is NOT a conflict and does not block apply.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_master_map_parking_inventory_to_event(
  p_event_id uuid,
  p_expected_selected_master_map_id uuid,
  p_expected_map_revision integer,
  p_apply boolean DEFAULT false
)
RETURNS TABLE(
  outcome text,
  rejection_code text,
  added integer,
  reconciled integer,
  relinked integer,
  orphaned_vacant integer,
  manual_rows integer,
  conflicts jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_selected uuid;
  v_selected_recheck uuid;
  v_map public.master_maps%ROWTYPE;
  v_rev_recheck integer;
  v_conflicts jsonb := '[]'::jsonb;
  v_added integer := 0;
  v_reconciled integer := 0;
  v_relinked integer := 0;
  v_orphan_vacant integer := 0;
  v_manual integer := 0;
  v_covered uuid[] := ARRAY[]::uuid[];
  v_plan jsonb[] := ARRAY[]::jsonb[];
  v_action jsonb;
  r record;
  v_cur_mms public.master_map_sites%ROWTYPE;
  v_old_mms public.master_map_sites%ROWTYPE;
  v_old_group text;
  v_norm text;
  v_old_dupes integer;
  v_cands uuid[];
  v_cand_count integer;
  v_target_mms public.master_map_sites%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Authority. Canonical Event-scoped task authority only -- never a raw
  -- privilege_group check. Covers a nonexistent Event too: resolve_task_
  -- authority requires a real Event/Tenant lookup before any inherit
  -- branch, so an unknown p_event_id fails closed here with the same
  -- 'authorization_denied' a caller without Event access would see.
  IF NOT public.has_event_task_authority('event.parking.manage', p_event_id) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  -- Resolve the live source of truth: the Event's currently-selected
  -- master map (never a map identity accepted from the caller).
  SELECT ems.selected_master_map_id INTO v_selected
  FROM public.event_map_settings AS ems
  WHERE ems.event_id = p_event_id;

  IF v_selected IS NULL THEN
    RETURN QUERY SELECT 'rejected'::text, 'no_selected_master_map'::text,
      0, 0, 0, 0, 0, '[]'::jsonb;
    RETURN;
  END IF;

  IF v_selected IS DISTINCT FROM p_expected_selected_master_map_id THEN
    RETURN QUERY SELECT 'rejected'::text, 'stale_selected_map'::text,
      0, 0, 0, 0, 0, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_map FROM public.master_maps WHERE id = v_selected;
  IF NOT FOUND
     OR p_expected_map_revision IS NULL
     OR v_map.revision IS DISTINCT FROM p_expected_map_revision THEN
    RETURN QUERY SELECT 'rejected'::text, 'stale_master_map'::text,
      0, 0, 0, 0, 0, '[]'::jsonb;
    RETURN;
  END IF;

  -- Apply: deterministic row locking. Lock every parking_sites row for the
  -- Event FOR UPDATE in ascending id::text order -- the same canonical
  -- order record_site_placement uses for its parking-site lock set. The
  -- sync never acquires an attendee lock, so there is no lock-order cycle
  -- with record_site_placement (which locks parking sites before
  -- attendees). Then re-verify the source assumptions under the lock.
  IF p_apply THEN
    PERFORM 1
    FROM public.parking_sites
    WHERE event_id = p_event_id
    ORDER BY id::text
    FOR UPDATE;

    SELECT ems.selected_master_map_id INTO v_selected_recheck
    FROM public.event_map_settings AS ems
    WHERE ems.event_id = p_event_id;
    IF v_selected_recheck IS DISTINCT FROM v_selected THEN
      RETURN QUERY SELECT 'rejected'::text, 'stale_selected_map'::text,
        0, 0, 0, 0, 0, '[]'::jsonb;
      RETURN;
    END IF;

    SELECT revision INTO v_rev_recheck FROM public.master_maps WHERE id = v_selected;
    IF v_rev_recheck IS DISTINCT FROM v_map.revision THEN
      RETURN QUERY SELECT 'rejected'::text, 'stale_master_map'::text,
        0, 0, 0, 0, 0, '[]'::jsonb;
      RETURN;
    END IF;
  END IF;

  -- --------------------------------------------------------------------
  -- Analysis pass -- identical for preview and apply. Never mutates.
  -- --------------------------------------------------------------------
  FOR r IN
    SELECT ps.id,
           ps.master_site_id,
           ps.site_number,
           ps.display_label,
           ps.map_x,
           ps.map_y,
           ps.map_image_url,
           (ps.assigned_attendee_id IS NOT NULL) AS occupied
    FROM public.parking_sites AS ps
    WHERE ps.event_id = p_event_id
    ORDER BY ps.id::text
  LOOP
    -- Event-local / manual inventory -- left completely untouched.
    IF r.master_site_id IS NULL THEN
      v_manual := v_manual + 1;
      CONTINUE;
    END IF;

    -- A. Exact match: the row is linked to a site on the currently
    --    selected map version. Reconcile template display fields only.
    SELECT * INTO v_cur_mms
    FROM public.master_map_sites AS mms
    WHERE mms.id = r.master_site_id AND mms.master_map_id = v_selected;

    IF FOUND THEN
      v_covered := v_covered || r.master_site_id;

      IF r.occupied THEN
        -- Never renumber an occupied row (spec / Stage 6C item 9).
        IF v_cur_mms.site_number IS DISTINCT FROM r.site_number THEN
          v_conflicts := v_conflicts || jsonb_build_object(
            'parking_site_id', r.id, 'master_site_id', r.master_site_id,
            'site_number', r.site_number, 'kind', 'occupied_renumber',
            'detail', 'the selected map renumbers this occupied site to ' || coalesce(v_cur_mms.site_number, '(null)'));
          CONTINUE;
        END IF;
        IF v_cur_mms.display_label IS DISTINCT FROM r.display_label
           OR v_cur_mms.map_x IS DISTINCT FROM r.map_x
           OR v_cur_mms.map_y IS DISTINCT FROM r.map_y
           OR v_map.map_image_url IS DISTINCT FROM r.map_image_url THEN
          v_reconciled := v_reconciled + 1;
          v_plan := v_plan || jsonb_build_object(
            'kind', 'reconcile_display', 'id', r.id,
            'display_label', v_cur_mms.display_label,
            'map_x', v_cur_mms.map_x, 'map_y', v_cur_mms.map_y,
            'map_image_url', v_map.map_image_url);
        END IF;
      ELSE
        -- Vacant: full template resync, site_number included.
        IF v_cur_mms.site_number IS DISTINCT FROM r.site_number
           OR v_cur_mms.display_label IS DISTINCT FROM r.display_label
           OR v_cur_mms.map_x IS DISTINCT FROM r.map_x
           OR v_cur_mms.map_y IS DISTINCT FROM r.map_y
           OR v_map.map_image_url IS DISTINCT FROM r.map_image_url THEN
          v_reconciled := v_reconciled + 1;
          v_plan := v_plan || jsonb_build_object(
            'kind', 'reconcile_full', 'id', r.id,
            'site_number', v_cur_mms.site_number,
            'display_label', v_cur_mms.display_label,
            'map_x', v_cur_mms.map_x, 'map_y', v_cur_mms.map_y,
            'map_image_url', v_map.map_image_url);
        END IF;
      END IF;
      CONTINUE;
    END IF;

    -- The row's master_site_id points somewhere other than the selected
    -- map. parking_sites.master_site_id -> master_map_sites(id) is a real
    -- FK, so this row always exists.
    SELECT * INTO v_old_mms FROM public.master_map_sites AS mms WHERE mms.id = r.master_site_id;
    SELECT map_group INTO v_old_group FROM public.master_maps WHERE id = v_old_mms.master_map_id;

    -- B. Controlled successor-map identity reconciliation. Only when the
    --    old map shares a non-null map_group lineage with the selected
    --    map, and the normalized site_number resolves to EXACTLY ONE site
    --    on the selected map with NO ambiguity on the old map and NO
    --    collision with another Event row. Exactly one candidate ->
    --    relink; more than one (or old-map ambiguity) -> conflict; ZERO
    --    candidates -> the site was removed from the lineage, fall through
    --    to orphan handling.
    v_norm := lower(btrim(r.site_number));

    IF v_map.map_group IS NOT NULL
       AND v_old_group IS NOT DISTINCT FROM v_map.map_group
       AND v_old_mms.master_map_id IS DISTINCT FROM v_selected
       AND v_norm IS NOT NULL AND v_norm <> '' THEN

      SELECT count(*) INTO v_old_dupes
      FROM public.master_map_sites
      WHERE master_map_id = v_old_mms.master_map_id
        AND lower(btrim(site_number)) = v_norm;

      SELECT array_agg(id ORDER BY id::text) INTO v_cands
      FROM public.master_map_sites
      WHERE master_map_id = v_selected
        AND lower(btrim(site_number)) = v_norm;
      v_cand_count := coalesce(array_length(v_cands, 1), 0);

      IF v_cand_count = 1 AND v_old_dupes = 1 THEN
        IF EXISTS (
          SELECT 1 FROM public.parking_sites
          WHERE event_id = p_event_id AND master_site_id = v_cands[1] AND id <> r.id
        ) THEN
          v_conflicts := v_conflicts || jsonb_build_object(
            'parking_site_id', r.id, 'master_site_id', r.master_site_id,
            'site_number', r.site_number, 'kind', 'successor_collision',
            'detail', 'another Event parking row is already linked to the successor site');
          CONTINUE;
        END IF;

        SELECT * INTO v_target_mms FROM public.master_map_sites WHERE id = v_cands[1];

        -- Relinking is an identity-reference migration, permitted even on
        -- an occupied row -- but it must not renumber an occupied row.
        IF r.occupied AND v_target_mms.site_number IS DISTINCT FROM r.site_number THEN
          v_conflicts := v_conflicts || jsonb_build_object(
            'parking_site_id', r.id, 'master_site_id', r.master_site_id,
            'site_number', r.site_number, 'kind', 'occupied_renumber',
            'detail', 'the successor identity match would renumber this occupied site to '
              || coalesce(v_target_mms.site_number, '(null)'));
          CONTINUE;
        END IF;

        v_relinked := v_relinked + 1;
        v_covered := v_covered || v_cands[1];
        IF r.occupied THEN
          v_plan := v_plan || jsonb_build_object(
            'kind', 'relink_display', 'id', r.id, 'master_site_id', v_cands[1],
            'display_label', v_target_mms.display_label,
            'map_x', v_target_mms.map_x, 'map_y', v_target_mms.map_y,
            'map_image_url', v_map.map_image_url);
        ELSE
          v_plan := v_plan || jsonb_build_object(
            'kind', 'relink_full', 'id', r.id, 'master_site_id', v_cands[1],
            'site_number', v_target_mms.site_number,
            'display_label', v_target_mms.display_label,
            'map_x', v_target_mms.map_x, 'map_y', v_target_mms.map_y,
            'map_image_url', v_map.map_image_url);
        END IF;
        CONTINUE;

      ELSIF v_cand_count > 1 OR v_old_dupes <> 1 THEN
        v_conflicts := v_conflicts || jsonb_build_object(
          'parking_site_id', r.id, 'master_site_id', r.master_site_id,
          'site_number', r.site_number, 'kind', 'ambiguous_successor_match',
          'detail', format('old-map matches=%s, selected-map matches=%s',
            v_old_dupes, v_cand_count));
        CONTINUE;
      END IF;
      -- v_cand_count = 0: the site is gone from the lineage. Fall through.
    END IF;

    -- C. True orphan -- no lineage, lineage but blank site_number, or
    --    lineage with zero successor candidates. Report only; never delete.
    IF r.occupied THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'parking_site_id', r.id, 'master_site_id', r.master_site_id,
        'site_number', r.site_number, 'kind', 'occupied_orphan',
        'detail', 'this occupied inventory row no longer corresponds to the selected map');
    ELSE
      v_orphan_vacant := v_orphan_vacant + 1;
    END IF;
  END LOOP;

  -- Missing inventory: selected-map sites with no Event row (and not a
  -- planned relink target).
  SELECT count(*)::integer INTO v_added
  FROM public.master_map_sites AS mms
  WHERE mms.master_map_id = v_selected
    AND NOT (mms.id = ANY (v_covered))
    AND NOT EXISTS (
      SELECT 1 FROM public.parking_sites AS ps
      WHERE ps.event_id = p_event_id AND ps.master_site_id = mms.id
    );

  -- --------------------------------------------------------------------
  -- Preview: report, no mutation.
  -- --------------------------------------------------------------------
  IF NOT p_apply THEN
    RETURN QUERY SELECT 'previewed'::text, NULL::text,
      v_added, v_reconciled, v_relinked, v_orphan_vacant, v_manual, v_conflicts;
    RETURN;
  END IF;

  -- --------------------------------------------------------------------
  -- Apply: all-or-nothing. Any conflict -> zero mutation.
  -- --------------------------------------------------------------------
  IF jsonb_array_length(v_conflicts) > 0 THEN
    RETURN QUERY SELECT 'rejected'::text, 'unresolved_conflicts'::text,
      v_added, v_reconciled, v_relinked, v_orphan_vacant, v_manual, v_conflicts;
    RETURN;
  END IF;

  FOREACH v_action IN ARRAY v_plan LOOP
    IF v_action->>'kind' = 'reconcile_display' THEN
      UPDATE public.parking_sites SET
        display_label = v_action->>'display_label',
        map_x = (v_action->>'map_x')::numeric,
        map_y = (v_action->>'map_y')::numeric,
        map_image_url = v_action->>'map_image_url'
      WHERE id = (v_action->>'id')::uuid;

    ELSIF v_action->>'kind' = 'reconcile_full' THEN
      UPDATE public.parking_sites SET
        site_number = v_action->>'site_number',
        display_label = v_action->>'display_label',
        map_x = (v_action->>'map_x')::numeric,
        map_y = (v_action->>'map_y')::numeric,
        map_image_url = v_action->>'map_image_url'
      WHERE id = (v_action->>'id')::uuid;

    ELSIF v_action->>'kind' = 'relink_display' THEN
      UPDATE public.parking_sites SET
        master_site_id = (v_action->>'master_site_id')::uuid,
        display_label = v_action->>'display_label',
        map_x = (v_action->>'map_x')::numeric,
        map_y = (v_action->>'map_y')::numeric,
        map_image_url = v_action->>'map_image_url'
      WHERE id = (v_action->>'id')::uuid;

    ELSIF v_action->>'kind' = 'relink_full' THEN
      UPDATE public.parking_sites SET
        master_site_id = (v_action->>'master_site_id')::uuid,
        site_number = v_action->>'site_number',
        display_label = v_action->>'display_label',
        map_x = (v_action->>'map_x')::numeric,
        map_y = (v_action->>'map_y')::numeric,
        map_image_url = v_action->>'map_image_url'
      WHERE id = (v_action->>'id')::uuid;
    END IF;
  END LOOP;

  INSERT INTO public.parking_sites (
    event_id, master_site_id, site_number, display_label, map_x, map_y, map_image_url
  )
  SELECT p_event_id, mms.id, mms.site_number, mms.display_label, mms.map_x, mms.map_y, v_map.map_image_url
  FROM public.master_map_sites AS mms
  WHERE mms.master_map_id = v_selected
    AND NOT (mms.id = ANY (v_covered))
    AND NOT EXISTS (
      SELECT 1 FROM public.parking_sites AS ps
      WHERE ps.event_id = p_event_id AND ps.master_site_id = mms.id
    )
  ON CONFLICT (event_id, master_site_id) WHERE master_site_id IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT 'applied'::text, NULL::text,
    v_added, v_reconciled, v_relinked, v_orphan_vacant, v_manual, v_conflicts;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Ownership + ACL. Governed browser RPC: authenticated EXECUTE only,
--    authority decided inside the body -- exactly the record_site_placement
--    / materialize_event_parking_site posture.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.sync_master_map_parking_inventory_to_event(uuid, uuid, integer, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.sync_master_map_parking_inventory_to_event(uuid, uuid, integer, boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sync_master_map_parking_inventory_to_event(uuid, uuid, integer, boolean)
  TO authenticated;

-- ============================================================
-- PARITY END

-- ============================================================
-- Fixture assertion helper
-- ============================================================
CREATE FUNCTION public.stage6c_fixture_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $fn$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Stage 6C fixture assertion failed: %', p_message;
  END IF;
END;
$fn$;
ALTER FUNCTION public.stage6c_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stage6c_fixture_assert(boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.stage6c_fixture_assert(boolean, text) TO authenticated;

-- ============================================================
-- Fixture data
-- ============================================================
DO $setup$
BEGIN
  PERFORM public.stage6c_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.tenants WHERE organization_code LIKE 'S6C-FX%'),
    'fixture tenant codes must be unused before setup'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('6c000000-0000-4000-8000-000000000001', 's6c-platform@fixture.invalid'),
    ('6c000000-0000-4000-8000-000000000002', 's6c-parking-a@fixture.invalid'),
    ('6c000000-0000-4000-8000-000000000003', 's6c-event-admin-b@fixture.invalid'),
    ('6c000000-0000-4000-8000-000000000004', 's6c-global-parking@fixture.invalid'),
    ('6c000000-0000-4000-8000-000000000005', 's6c-plain@fixture.invalid');

  INSERT INTO public.admin_users (id, email, display_name, is_active, is_super_admin, user_id, privilege_group) VALUES
    ('6ca00000-0000-4000-8000-000000000001', 's6c-platform@fixture.invalid', 'S6C Platform', true, true,  '6c000000-0000-4000-8000-000000000001', 'super_admin'),
    ('6ca00000-0000-4000-8000-000000000002', 's6c-parking-a@fixture.invalid', 'S6C Parking A', true, false, '6c000000-0000-4000-8000-000000000002', 'read_only'),
    ('6ca00000-0000-4000-8000-000000000003', 's6c-event-admin-b@fixture.invalid', 'S6C Event Admin B', true, false, '6c000000-0000-4000-8000-000000000003', 'event_admin'),
    ('6ca00000-0000-4000-8000-000000000004', 's6c-global-parking@fixture.invalid', 'S6C Global Parking', true, false, '6c000000-0000-4000-8000-000000000004', 'parking'),
    ('6ca00000-0000-4000-8000-000000000005', 's6c-plain@fixture.invalid', 'S6C Plain', true, false, '6c000000-0000-4000-8000-000000000005', 'read_only');

  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title, is_active) VALUES
    ('6c700000-0000-4000-8000-00000000000a', 'S6C-FX-A', 's6c-fx-a', 'S6C Fixture Org A', 'S6C A', 'S6C A', true),
    ('6c700000-0000-4000-8000-00000000000b', 'S6C-FX-B', 's6c-fx-b', 'S6C Fixture Org B', 'S6C B', 'S6C B', true);

  INSERT INTO public.events (id, tenant_id, name, location, start_date, end_date, timezone, lifecycle_state, status, visible_to_members, is_active) VALUES
    ('6ce00000-0000-4000-8000-00000000000a', '6c700000-0000-4000-8000-00000000000a', 'S6C Fixture Event A', 'loc', current_date - 2, current_date + 5, 'UTC', 'operational', 'Draft', false, false),
    ('6ce00000-0000-4000-8000-00000000000b', '6c700000-0000-4000-8000-00000000000b', 'S6C Fixture Event B', 'loc', current_date - 2, current_date + 5, 'UTC', 'operational', 'Draft', false, false),
    ('6ce00000-0000-4000-8000-00000000000c', '6c700000-0000-4000-8000-00000000000a', 'S6C Fixture Event C', 'loc', current_date - 2, current_date + 5, 'UTC', 'operational', 'Draft', false, false),
    ('6ce00000-0000-4000-8000-00000000000d', '6c700000-0000-4000-8000-00000000000a', 'S6C Fixture Event D', 'loc', current_date - 2, current_date + 5, 'UTC', 'operational', 'Draft', false, false);

  -- Parking A holds an EXPLICIT event grant of event.parking.manage on
  -- Events A and C (its admin_users.privilege_group is read_only -- it has
  -- NO legacy global authority). Event Admin B holds it only on Event B.
  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES
    ('6c500000-0000-4000-8000-00000000000a', '6ca00000-0000-4000-8000-000000000002', '6ce00000-0000-4000-8000-00000000000a', 'parking'),
    ('6c500000-0000-4000-8000-00000000000c', '6ca00000-0000-4000-8000-000000000002', '6ce00000-0000-4000-8000-00000000000c', 'parking'),
    ('6c500000-0000-4000-8000-00000000000b', '6ca00000-0000-4000-8000-000000000003', '6ce00000-0000-4000-8000-00000000000b', 'event_admin');

  INSERT INTO public.admin_event_permissions (admin_event_access_id, permission_key, is_enabled) VALUES
    ('6c500000-0000-4000-8000-00000000000a', 'event.parking.manage', true),
    ('6c500000-0000-4000-8000-00000000000c', 'event.parking.manage', true),
    ('6c500000-0000-4000-8000-00000000000b', 'event.parking.manage', true);

  -- Master-map lineage. MAP_PUB is the current published version for the
  -- 'S6C FX Park' group; MAP_OLD is a superseded/archived version in the
  -- same lineage; MAP_OTHER is an unrelated lineage.
  INSERT INTO public.master_maps (id, name, map_group, map_image_url, status, is_read_only, site_count, revision) VALUES
    ('6cb00000-0000-4000-8000-0000000000a1', 'S6C FX Map',       'S6C FX Park',    'https://x/pub.png', 'published', true, 5, 5),
    ('6cb00000-0000-4000-8000-0000000000a0', 'S6C FX Map (old)', 'S6C FX Park',    'https://x/old.png', 'archived',  true, 8, 9),
    ('6cb00000-0000-4000-8000-0000000000ff', 'S6C Other Map',    'S6C Other Park', 'https://x/oth.png', 'published', true, 1, 0);

  INSERT INTO public.master_map_sites (id, master_map_id, site_number, display_label, map_x, map_y) VALUES
    -- MAP_PUB (A1..A5)
    ('6cc00000-0000-4000-8000-0000000000b1', '6cb00000-0000-4000-8000-0000000000a1', 'A1', 'Site A1', 10, 10),
    ('6cc00000-0000-4000-8000-0000000000b2', '6cb00000-0000-4000-8000-0000000000a1', 'A2', 'Site A2', 20, 20),
    ('6cc00000-0000-4000-8000-0000000000b3', '6cb00000-0000-4000-8000-0000000000a1', 'A3', 'Site A3', 30, 30),
    ('6cc00000-0000-4000-8000-0000000000b4', '6cb00000-0000-4000-8000-0000000000a1', 'A4', 'Site A4', 40, 40),
    ('6cc00000-0000-4000-8000-0000000000b5', '6cb00000-0000-4000-8000-0000000000a1', 'A5', 'Site A5', 50, 50),
    -- MAP_OLD (A1,A2,A3,A5 overlap; A9 + GONE removed from PUB; DUP/dup are
    -- case variants -- master_map_sites is unique on the exact site_number,
    -- so this is how a real normalized-identity ambiguity arises)
    ('6cc00000-0000-4000-8000-0000000000c1', '6cb00000-0000-4000-8000-0000000000a0', 'A1',   'Old A1',   11, 11),
    ('6cc00000-0000-4000-8000-0000000000c2', '6cb00000-0000-4000-8000-0000000000a0', 'A2',   'Old A2',   22, 22),
    ('6cc00000-0000-4000-8000-0000000000c3', '6cb00000-0000-4000-8000-0000000000a0', 'A3',   'Old A3',   33, 33),
    ('6cc00000-0000-4000-8000-0000000000c5', '6cb00000-0000-4000-8000-0000000000a0', 'A5',   'Old A5',   55, 55),
    ('6cc00000-0000-4000-8000-0000000000c9', '6cb00000-0000-4000-8000-0000000000a0', 'A9',   'Old A9',   99, 99),
    ('6cc00000-0000-4000-8000-0000000000cf', '6cb00000-0000-4000-8000-0000000000a0', 'GONE', 'Old GONE', 66, 66),
    ('6cc00000-0000-4000-8000-0000000000ca', '6cb00000-0000-4000-8000-0000000000a0', 'DUP',  'Old DUP a', 77, 77),
    ('6cc00000-0000-4000-8000-0000000000cb', '6cb00000-0000-4000-8000-0000000000a0', 'dup',  'Old DUP b', 78, 78),
    -- MAP_OTHER
    ('6cc00000-0000-4000-8000-0000000000e1', '6cb00000-0000-4000-8000-0000000000ff', 'Z1', 'Other Z1', 5, 5);

  INSERT INTO public.event_map_settings (event_id, selected_master_map_id) VALUES
    ('6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1'),
    ('6ce00000-0000-4000-8000-00000000000c', '6cb00000-0000-4000-8000-0000000000a1');
  -- Event D deliberately has NO event_map_settings row.

  INSERT INTO public.attendees (id, event_id) VALUES
    ('6cf00000-0000-4000-8000-0000000000a2', '6ce00000-0000-4000-8000-00000000000a'),
    ('6cf00000-0000-4000-8000-0000000000a4', '6ce00000-0000-4000-8000-00000000000a'),
    ('6cf00000-0000-4000-8000-0000000000a6', '6ce00000-0000-4000-8000-00000000000a'),
    ('6cf00000-0000-4000-8000-0000000000a8', '6ce00000-0000-4000-8000-00000000000a'),
    ('6cf00000-0000-4000-8000-0000000000c2', '6ce00000-0000-4000-8000-00000000000c'),
    ('6cf00000-0000-4000-8000-0000000000c4', '6ce00000-0000-4000-8000-00000000000c');

  -- Event A inventory -- the full conflict/reconcile matrix. Occupancy is
  -- established directly here (Event A only does preview + a rejected apply
  -- that mutates nothing).
  INSERT INTO public.parking_sites
    (id, event_id, master_site_id, site_number, display_label, map_x, map_y, map_image_url, assigned_attendee_id, notes) VALUES
    ('6cd00000-0000-4000-8000-000000000011', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000b1', 'A1', 'STALE A1', 1, 1, 'https://x/stale.png', NULL, NULL),
    ('6cd00000-0000-4000-8000-000000000012', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000b2', 'A2', 'STALE A2', 2, 2, 'https://x/stale.png', '6cf00000-0000-4000-8000-0000000000a2', 'KEEP ME A'),
    ('6cd00000-0000-4000-8000-000000000013', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000c3', 'A3', 'Old A3', 33, 33, 'https://x/old.png', NULL, NULL),
    ('6cd00000-0000-4000-8000-000000000014', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000c5', 'A5', 'Old A5', 55, 55, 'https://x/old.png', '6cf00000-0000-4000-8000-0000000000a4', 'KEEP ME B'),
    ('6cd00000-0000-4000-8000-000000000015', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000ca', 'DUP', 'Old DUP a', 77, 77, 'https://x/old.png', NULL, NULL),
    ('6cd00000-0000-4000-8000-000000000016', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000e1', 'Z1', 'Other Z1', 5, 5, 'https://x/oth.png', '6cf00000-0000-4000-8000-0000000000a6', NULL),
    ('6cd00000-0000-4000-8000-000000000017', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000c9', 'A9', 'Old A9', 99, 99, 'https://x/old.png', NULL, NULL),
    ('6cd00000-0000-4000-8000-000000000018', '6ce00000-0000-4000-8000-00000000000a', '6cc00000-0000-4000-8000-0000000000cf', 'GONE', 'Old GONE', 66, 66, 'https://x/old.png', '6cf00000-0000-4000-8000-0000000000a8', NULL),
    ('6cd00000-0000-4000-8000-000000000019', '6ce00000-0000-4000-8000-00000000000a', NULL, 'MANUAL-1', 'Manual One', 4, 4, NULL, NULL, 'manual note');

  -- Event C inventory -- a clean set with NO conflicts (for the apply path).
  INSERT INTO public.parking_sites
    (id, event_id, master_site_id, site_number, display_label, map_x, map_y, map_image_url, assigned_attendee_id, notes) VALUES
    ('6cd00000-0000-4000-8000-000000000101', '6ce00000-0000-4000-8000-00000000000c', '6cc00000-0000-4000-8000-0000000000b1', 'A1', 'C STALE A1', 1, 1, 'https://x/stale.png', NULL, NULL),
    ('6cd00000-0000-4000-8000-000000000102', '6ce00000-0000-4000-8000-00000000000c', '6cc00000-0000-4000-8000-0000000000b2', 'A2', 'C STALE A2', 2, 2, 'https://x/stale.png', NULL, 'C2 NOTE'),
    ('6cd00000-0000-4000-8000-000000000103', '6ce00000-0000-4000-8000-00000000000c', '6cc00000-0000-4000-8000-0000000000c3', 'A3', 'Old A3', 33, 33, 'https://x/old.png', NULL, NULL),
    ('6cd00000-0000-4000-8000-000000000104', '6ce00000-0000-4000-8000-00000000000c', '6cc00000-0000-4000-8000-0000000000c5', 'A5', 'Old A5', 55, 55, 'https://x/old.png', NULL, 'C4 NOTE'),
    ('6cd00000-0000-4000-8000-000000000105', '6ce00000-0000-4000-8000-00000000000c', NULL, 'C-MANUAL', 'C Manual', 7, 7, NULL, NULL, NULL);
END;
$setup$;

-- ============================================================
-- Exercise
-- ============================================================
DO $exercise$
DECLARE
  v_row record;
  v_failed boolean;
  v_err text;
  v_hist_before integer;
  v_hist_after integer;
BEGIN
  -- Occupy the two Event C rows through the CANONICAL command so the
  -- projection + history exist and can be asserted unchanged after sync.
  PERFORM set_config('request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true);
  PERFORM public.record_site_placement(
    '6cf00000-0000-4000-8000-0000000000c2', 'assign', gen_random_uuid(),
    '6cd00000-0000-4000-8000-000000000102', 'event_admin', NULL, false);
  PERFORM public.record_site_placement(
    '6cf00000-0000-4000-8000-0000000000c4', 'assign', gen_random_uuid(),
    '6cd00000-0000-4000-8000-000000000104', 'event_admin', NULL, false);

  PERFORM public.stage6c_fixture_assert(
    (SELECT assigned_site FROM public.attendees WHERE id = '6cf00000-0000-4000-8000-0000000000c2') = 'C STALE A2',
    'record_site_placement wrote the assigned_site projection from the row display_label at placement time'
  );

  -- =====================================================================
  -- Authority.
  -- =====================================================================
  -- Anonymous.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN
    PERFORM public.sync_master_map_parking_inventory_to_event(
      '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'unauthorized'; END;
  PERFORM public.stage6c_fixture_assert(v_failed, 'anonymous caller cannot sync -- unauthorized');

  -- Plain admin, no authority on the Event.
  PERFORM set_config('request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000005', true);
  v_failed := false;
  BEGIN
    PERFORM public.sync_master_map_parking_inventory_to_event(
      '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'authorization_denied'; END;
  PERFORM public.stage6c_fixture_assert(v_failed, 'a plain admin with no Event authority is denied');

  -- Legacy global privilege_group = 'parking', but NO event grant.
  PERFORM set_config('request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN
    PERFORM public.sync_master_map_parking_inventory_to_event(
      '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'authorization_denied'; END;
  PERFORM public.stage6c_fixture_assert(v_failed,
    'a legacy global privilege_group=parking value alone does NOT authorize a sync');

  -- Event Admin for a DIFFERENT Event (B) -- denied on Event A.
  PERFORM set_config('request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN
    PERFORM public.sync_master_map_parking_inventory_to_event(
      '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'authorization_denied'; END;
  PERFORM public.stage6c_fixture_assert(v_failed,
    'an admin holding event.parking.manage on another Event is denied on this Event');

  -- Explicit event grant on Event A authorizes (read_only privilege_group).
  PERFORM set_config('request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  PERFORM public.stage6c_fixture_assert(v_row.outcome = 'previewed',
    'an explicit event.parking.manage grant authorizes the sync');

  -- Platform admin inherits it on every Event.
  PERFORM set_config('request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  PERFORM public.stage6c_fixture_assert(v_row.outcome = 'previewed',
    'a platform admin inherits event.parking.manage for the sync');

  -- =====================================================================
  -- Stale-source protection (platform admin, Event C).
  -- =====================================================================
  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000c', '6cb00000-0000-4000-8000-0000000000a0', 5, false);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'rejected' AND v_row.rejection_code = 'stale_selected_map',
    'a wrong expected selected-map id is refused as stale_selected_map'
  );

  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000c', '6cb00000-0000-4000-8000-0000000000a1', 999, false);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'rejected' AND v_row.rejection_code = 'stale_master_map',
    'a wrong expected map revision is refused as stale_master_map'
  );

  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000d', NULL, 0, false);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'rejected' AND v_row.rejection_code = 'no_selected_master_map',
    'an Event with no selected master map is refused as no_selected_master_map'
  );

  -- =====================================================================
  -- Event A preview -- the full matrix.
  -- =====================================================================
  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'previewed'
      AND v_row.added = 1            -- A4
      AND v_row.reconciled = 2       -- A1 vacant full, A2 occupied display
      AND v_row.relinked = 2         -- A3 vacant, A5 occupied
      AND v_row.orphaned_vacant = 1  -- A9
      AND v_row.manual_rows = 1      -- MANUAL-1
      AND jsonb_array_length(v_row.conflicts) = 3,
    format('Event A preview matrix: added=%s reconciled=%s relinked=%s orphan_vacant=%s manual=%s conflicts=%s',
      v_row.added, v_row.reconciled, v_row.relinked, v_row.orphaned_vacant, v_row.manual_rows,
      jsonb_array_length(v_row.conflicts))
  );
  PERFORM public.stage6c_fixture_assert(
    (SELECT count(*) FROM jsonb_array_elements(v_row.conflicts) c WHERE c->>'kind' = 'occupied_orphan') = 2
      AND (SELECT count(*) FROM jsonb_array_elements(v_row.conflicts) c WHERE c->>'kind' = 'ambiguous_successor_match') = 1,
    'Event A conflicts: 2 occupied orphans (Z1 out-of-lineage, GONE removed-in-lineage) + 1 ambiguous DUP'
  );

  -- Preview mutated nothing.
  PERFORM public.stage6c_fixture_assert(
    (SELECT count(*) FROM public.parking_sites WHERE event_id = '6ce00000-0000-4000-8000-00000000000a') = 9
      AND (SELECT master_site_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000013')
          = '6cc00000-0000-4000-8000-0000000000c3'
      AND (SELECT display_label FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000011') = 'STALE A1',
    'preview does not mutate any parking_sites row'
  );

  -- =====================================================================
  -- Event A apply -- conflicts present -> zero mutation.
  -- =====================================================================
  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000a', '6cb00000-0000-4000-8000-0000000000a1', 5, true);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'rejected' AND v_row.rejection_code = 'unresolved_conflicts',
    'apply with unresolved conflicts is rejected'
  );
  PERFORM public.stage6c_fixture_assert(
    (SELECT count(*) FROM public.parking_sites WHERE event_id = '6ce00000-0000-4000-8000-00000000000a') = 9
      AND (SELECT master_site_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000013')
          = '6cc00000-0000-4000-8000-0000000000c3'
      AND (SELECT display_label FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000011') = 'STALE A1'
      AND (SELECT assigned_attendee_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000012')
          = '6cf00000-0000-4000-8000-0000000000a2'
      AND (SELECT notes FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000012') = 'KEEP ME A',
    'a rejected apply leaves every parking_sites row untouched (no partial mutation)'
  );

  -- =====================================================================
  -- Event C apply -- clean, all-or-nothing.
  -- =====================================================================
  SELECT count(*)::integer INTO v_hist_before FROM public.site_placement_history
    WHERE event_id = '6ce00000-0000-4000-8000-00000000000c';

  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000c', '6cb00000-0000-4000-8000-0000000000a1', 5, false);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'previewed' AND v_row.added = 1 AND v_row.reconciled = 2
      AND v_row.relinked = 2 AND v_row.orphaned_vacant = 0 AND v_row.manual_rows = 1
      AND jsonb_array_length(v_row.conflicts) = 0,
    'Event C preview: 1 add, 2 reconcile, 2 relink, 0 orphan, 1 manual, 0 conflicts'
  );

  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000c', '6cb00000-0000-4000-8000-0000000000a1', 5, true);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'applied' AND v_row.added = 1 AND v_row.reconciled = 2 AND v_row.relinked = 2,
    'Event C apply succeeds with the previewed counts'
  );

  -- Occupancy / notes / id / projection / history preserved on the occupied
  -- rows through a display-only reconcile AND through an identity relink.
  PERFORM public.stage6c_fixture_assert(
    (SELECT assigned_attendee_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000102')
        = '6cf00000-0000-4000-8000-0000000000c2'
      AND (SELECT notes FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000102') = 'C2 NOTE'
      AND (SELECT site_number FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000102') = 'A2'
      AND (SELECT display_label FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000102') = 'Site A2'
      AND (SELECT map_x FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000102') = 20,
    'occupied exact-match row: occupancy + notes + site_number kept; display fields reconciled'
  );
  PERFORM public.stage6c_fixture_assert(
    (SELECT assigned_site FROM public.attendees WHERE id = '6cf00000-0000-4000-8000-0000000000c2') = 'C STALE A2',
    'attendees.assigned_site projection is NEVER touched by a sync -- still the placement-time label'
  );
  PERFORM public.stage6c_fixture_assert(
    (SELECT assigned_attendee_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000104')
        = '6cf00000-0000-4000-8000-0000000000c4'
      AND (SELECT master_site_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000104')
          = '6cc00000-0000-4000-8000-0000000000b5'
      AND (SELECT notes FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000104') = 'C4 NOTE',
    'occupied successor row: master_site_id relinked to the current map; occupancy + notes unchanged'
  );

  SELECT count(*)::integer INTO v_hist_after FROM public.site_placement_history
    WHERE event_id = '6ce00000-0000-4000-8000-00000000000c';
  PERFORM public.stage6c_fixture_assert(v_hist_before = v_hist_after AND v_hist_before = 2,
    'site_placement_history is never written by a sync');

  -- Vacant rows fully resynced; missing A4 materialized; manual row untouched.
  PERFORM public.stage6c_fixture_assert(
    (SELECT display_label FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000101') = 'Site A1'
      AND (SELECT map_x FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000101') = 10
      AND (SELECT master_site_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000103')
          = '6cc00000-0000-4000-8000-0000000000b3',
    'vacant exact row resynced; vacant successor row relinked to the selected map'
  );
  PERFORM public.stage6c_fixture_assert(
    EXISTS (
      SELECT 1 FROM public.parking_sites
      WHERE event_id = '6ce00000-0000-4000-8000-00000000000c'
        AND master_site_id = '6cc00000-0000-4000-8000-0000000000b4'
        AND assigned_attendee_id IS NULL AND site_number = 'A4'
    ),
    'a selected-map site with no Event row materializes as a vacant row'
  );
  PERFORM public.stage6c_fixture_assert(
    (SELECT master_site_id FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000105') IS NULL
      AND (SELECT site_number FROM public.parking_sites WHERE id = '6cd00000-0000-4000-8000-000000000105') = 'C-MANUAL',
    'a manual (master_site_id IS NULL) row is left completely untouched'
  );

  -- Idempotent re-run.
  SELECT * INTO v_row FROM public.sync_master_map_parking_inventory_to_event(
    '6ce00000-0000-4000-8000-00000000000c', '6cb00000-0000-4000-8000-0000000000a1', 5, true);
  PERFORM public.stage6c_fixture_assert(
    v_row.outcome = 'applied' AND v_row.added = 0 AND v_row.reconciled = 0
      AND v_row.relinked = 0 AND v_row.orphaned_vacant = 0,
    'a second apply is a no-op -- the sync is idempotent'
  );
  PERFORM public.stage6c_fixture_assert(
    (SELECT count(*) FROM public.parking_sites WHERE event_id = '6ce00000-0000-4000-8000-00000000000c') = 6,
    'Event C settled at 6 rows (5 original + materialized A4); nothing deleted'
  );

  -- =====================================================================
  -- Direct-table mutation boundary + retargeted RLS.
  -- =====================================================================
  PERFORM public.stage6c_fixture_assert(
    has_table_privilege('authenticated', 'public.parking_sites', 'INSERT') = false
      AND has_table_privilege('authenticated', 'public.parking_sites', 'UPDATE') = false
      AND has_table_privilege('authenticated', 'public.parking_sites', 'DELETE') = false
      AND has_table_privilege('anon', 'public.parking_sites', 'INSERT') = false,
    'no browser role retains a direct INSERT/UPDATE/DELETE grant on parking_sites'
  );
  PERFORM public.stage6c_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polrelid = 'public.parking_sites'::regclass
        AND polname LIKE 'Admins can %' AND polcmd <> 'r'
    ),
    'the legacy global privilege_group write policies are gone'
  );
  PERFORM public.stage6c_fixture_assert(
    (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'public.parking_sites'::regclass
         AND polname LIKE 'Event parking admins can %'
         AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ~ 'has_event_task_authority') = 3,
    'the three retargeted write policies require has_event_task_authority'
  );
  PERFORM public.stage6c_fixture_assert(
    EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.parking_sites'::regclass
              AND polname = 'Admins can view parking sites' AND polcmd = 'r')
      AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.parking_sites'::regclass
              AND polname = 'public read parking_sites' AND polcmd = 'r')
      AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.parking_sites'::regclass
              AND polname = 'Public read parking' AND polcmd = 'r'),
    'the SELECT policies are deliberately left untouched'
  );

  -- =====================================================================
  -- The canonical placement / inventory RPCs are untouched.
  -- =====================================================================
  PERFORM public.stage6c_fixture_assert(
    to_regprocedure('public.record_site_placement(uuid,text,uuid,uuid,text,text,boolean)') IS NOT NULL
      AND to_regprocedure('public.materialize_event_parking_site(uuid,uuid)') IS NOT NULL
      AND has_function_privilege('authenticated', 'public.record_site_placement(uuid,text,uuid,uuid,text,text,boolean)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.materialize_event_parking_site(uuid,uuid)', 'EXECUTE'),
    'record_site_placement and materialize_event_parking_site remain present and authenticated-executable'
  );
END;
$exercise$;

ROLLBACK;

-- Only FIXTURE objects are checked. The Stage 6C function / policies /
-- grants are the migration's own -- whether they are present after ROLLBACK
-- (migration already applied) or absent (migration not yet applied) is a
-- property of the migration, not fixture residue.
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE organization_code LIKE 'S6C-FX%')
     OR EXISTS (SELECT 1 FROM public.admin_users WHERE email LIKE 's6c-%@fixture.invalid')
     OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 's6c-%@fixture.invalid')
     OR EXISTS (SELECT 1 FROM public.master_maps WHERE name LIKE 'S6C %')
     OR to_regprocedure('public.stage6c_fixture_assert(boolean,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Stage 6C rollback left fixture residue';
  END IF;
END;
$post$;
