-- Stage 6C: Govern Event parking inventory synchronization.
--
-- WHAT WAS WRONG (pre-existing, on main):
--   public.parking_sites (INSERT/UPDATE/DELETE) RLS gated on a single
--   GLOBAL role test --
--     admin_users.is_active
--     AND privilege_group IN ('super_admin','event_admin','parking')
--   -- with NO tenant, event, or platform-authority scope (admin_users has
--   no tenant_id). The Master Maps editor (app/admin/master-maps/[id]/
--   page.tsx) then performed direct, ungoverned browser writes to the
--   Event's parking inventory:
--     * publishToSelectedEvent  -- DELETE every parking_sites row for the
--       admin working Event, then bulk INSERT vacant rows from whatever map
--       is loaded (a draft, in the button's own guard). Non-transactional.
--       Destroys assigned_attendee_id / notes / master_site_id on every row
--       it removes. The Accepted Site Placement Implementation Specification
--       (docs/architecture/EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_
--       SPECIFICATION.md §6.1) explicitly PROHIBITS this "delete all then
--       recreate vacant" operation once placement governance exists (it has
--       since 20260814030000). It is also already blocked at the
--       site_placement_history FK (NO ACTION) on any placement-active Event.
--     * safeSyncToSelectedEvent -- per-row UPDATE/INSERT loop keyed on a
--       lowercased site_number (NOT the canonical master_site_id), silently
--       orphans a row whose master site was removed or renumbered, inserts
--       new rows WITHOUT master_site_id (breaking lib/canonicalAttendee
--       Placement label joins), non-atomic (bails mid-loop on first error).
--
-- GOVERNING MODEL (Stage 6C, approved):
--   1. Event parking inventory is Event-scoped. Canonical mutation
--      authority = public.has_event_task_authority('event.parking.manage',
--      event_id) -- the same Event-scoped task authority
--      record_site_placement and materialize_event_parking_site already use
--      (20260817150000). Platform / owning-Tenant admins inherit it through
--      resolve_task_authority (event.parking.manage is
--      platform_inherits = TRUE, tenant_inherits = TRUE).
--   2. record_site_placement stays the SOLE canonical occupancy command
--      (assign / unassign / reassign / correct / displacement). Stage 6C
--      synchronization NEVER mutates occupancy: never
--      parking_sites.assigned_attendee_id, never attendees.assigned_site,
--      never site_placement_history, never event_placement_sequence.
--   3. materialize_event_parking_site stays the add-only per-site primitive.
--      Its authority and semantics are unchanged; Stage 6C reuses the SAME
--      add-only shape in bulk.
--   4. The new governed sync command,
--      sync_master_map_parking_inventory_to_event, implements Specification
--      §6.1: it may create missing UNOCCUPIED inventory and update only
--      non-placement display metadata; it is idempotent; it REPORTS a
--      conflict (never deletes, never renumbers an occupied row) whenever a
--      source site was removed/renumbered and the Event row is occupied, or
--      identity across map versions is ambiguous.
--   5. Destructive Publish-to-Event is RETIRED (the UI change, separate
--      commit). There is no destructive reset RPC in Stage 6C. First-time
--      materialization and ongoing reconciliation are the SAME governed sync.
--   6. Orphan / removal behavior in Stage 6C v1 is REPORT ONLY. No
--      parking_sites row is ever deleted -- not even a vacant one. A vacant
--      orphan is counted; an occupied orphan is a conflict.
--   7. Concurrency: apply mode locks every parking_sites row for the Event
--      FOR UPDATE in ascending id::text order -- the same canonical order
--      record_site_placement uses for its parking-site lock set (spec
--      Section 5) -- so a concurrent sync or record_site_placement on an
--      affected row serializes deterministically with no lock-order cycle
--      (sync never acquires an attendee lock; record_site_placement
--      acquires parking-site locks before attendee locks). Source
--      assumptions (selected map + master_maps.revision) are re-verified
--      under that lock before any write. Preview acquires no locks and
--      never mutates.
--
-- OUT OF SCOPE (unchanged, verified by the guard block and by
-- doesNotMatch assertions in the linked test):
--   record_site_placement, materialize_event_parking_site,
--   _allocate_event_placement_sequence, site_placement_history,
--   event_placement_sequence, assert_event_lifecycle_mutable, the Parking
--   Admin page's RPC call sites, Check-In behavior, canonicalAttendee
--   Placement readers, the parking_repair_* / master_site_identity_
--   correction / parking_inventory_quiescence machinery (the
--   parking_sites_enforce_repair_quiescence BEFORE-ROW trigger continues to
--   govern every sync write automatically -- Stage 6C references none of
--   it), Stage 6A event_map_settings governance, Stage 6B master-map
--   lifecycle, copy_master_map_to_event (left exactly as Stage 6B left it:
--   object retained, authenticated EXECUTE unavailable, service_role
--   EXECUTE retained, body unchanged, no caller added), the public /
--   anonymous parking_sites SELECT breadth.
--
-- RUNTIME: verified. Fresh from-zero replay of the full chain
-- (npm run db:verify-replay) applies this migration with no errors, and
-- the linked BEGIN..ROLLBACK fixture
-- (supabase/integration-tests/20260916000000_govern_event_parking_inventory_sync_rollback.sql)
-- was executed against that disposable local database. Production database
-- and production migration ledger were NOT changed by this migration file.

BEGIN;

-- ============================================================
-- 0. Guard checks -- fail closed if the world is not what Stage 6C expects.
-- ============================================================
DO $guard$
BEGIN
  IF (SELECT oid FROM pg_roles WHERE rolname = 'authenticated') IS NULL THEN
    RAISE EXCEPTION 'Stage 6C aborted: authenticated role is absent';
  END IF;

  IF to_regprocedure('public.has_event_task_authority(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6C aborted: has_event_task_authority(text,uuid) is absent';
  END IF;

  -- The two canonical placement/inventory RPCs Stage 6C reuses UNCHANGED
  -- must be present at their current signatures.
  IF to_regprocedure('public.record_site_placement(uuid,text,uuid,uuid,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6C aborted: record_site_placement is absent (must remain untouched)';
  END IF;
  IF to_regprocedure('public.materialize_event_parking_site(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6C aborted: materialize_event_parking_site is absent (must remain untouched)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_task_registry
    WHERE task_key = 'event.parking.manage'
      AND scope = 'event' AND is_active IS TRUE
      AND platform_inherits IS TRUE AND tenant_inherits IS TRUE
  ) THEN
    RAISE EXCEPTION 'Stage 6C aborted: event.parking.manage is not an active platform/tenant-inheriting Event task';
  END IF;

  -- Stage 6B concurrency token on the source of truth for a sync.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.master_maps'::regclass
      AND attname = 'revision' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Stage 6C aborted: master_maps.revision (Stage 6B) is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'parking_sites' AND c.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'Stage 6C aborted: RLS is not enabled on parking_sites';
  END IF;

  -- The exact legacy write policies this migration retargets must be present.
  IF (
    SELECT count(*) FROM pg_policy
    WHERE polrelid = 'public.parking_sites'::regclass
      AND polname IN (
        'Admins can insert parking sites',
        'Admins can update parking sites',
        'Admins can delete parking sites'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Stage 6C aborted: legacy parking_sites write policies are absent or renamed';
  END IF;

  -- The partial unique index materialize_event_parking_site's ON CONFLICT
  -- relies on -- the sync's bulk add reuses the same target.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'parking_sites_event_master_site_unique') THEN
    RAISE EXCEPTION 'Stage 6C aborted: parking_sites_event_master_site_unique partial index is absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'parking_sites_one_current_site_per_attendee_per_event') THEN
    RAISE EXCEPTION 'Stage 6C aborted: parking_sites_one_current_site_per_attendee_per_event is absent';
  END IF;

  -- The governed-repair quiescence trigger must remain attached; the sync
  -- writes through the table so this BEFORE-ROW trigger keeps governing it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.parking_sites'::regclass
      AND tgname = 'parking_sites_enforce_repair_quiescence'
  ) THEN
    RAISE EXCEPTION 'Stage 6C aborted: parking_sites_enforce_repair_quiescence trigger is absent';
  END IF;

  IF to_regclass('public.event_map_settings') IS NULL THEN
    RAISE EXCEPTION 'Stage 6C aborted: event_map_settings is absent';
  END IF;
END;
$guard$;

-- ============================================================
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

COMMIT;
