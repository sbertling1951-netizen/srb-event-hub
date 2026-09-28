-- Pap approved the current 271-site Saint George map on 2026-09-28,
-- then explicitly authorized a history-preserving repair for immediate use.
-- The three legacy rows include retained placement-history references.
-- Preserve their identities and contents; retire them from operational reads.
-- Reconnect the 271 exact equivalents through the existing owner-only,
-- individually audited stale-map correction lifecycle. No history is rewritten.
-- Approval: Codex task 01a0e8f3-9858-7470-9704-9a4d6a485b99.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

ALTER TABLE public.parking_sites
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retirement_reason text,
  ADD CONSTRAINT parking_sites_retirement_shape CHECK (
    (retired_at IS NULL AND retirement_reason IS NULL)
    OR (retired_at IS NOT NULL AND nullif(btrim(retirement_reason), '') IS NOT NULL
        AND assigned_attendee_id IS NULL)
  );

COMMENT ON COLUMN public.parking_sites.retired_at IS
  'Owner-maintenance retirement of vacant inventory. Retains the row and all history references; excluded from browser operational reads and cannot be occupied.';
COMMENT ON COLUMN public.parking_sites.retirement_reason IS
  'Required approval/change reference and reason for owner-maintenance retirement.';

-- Restrictive policy intersects existing SELECT policies. It grants no new
-- access. Owner-only audit/history operations retain the historical rows.
CREATE POLICY "Operational parking reads exclude retired inventory"
  ON public.parking_sites AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (retired_at IS NULL);

DO $repair$
DECLARE
  v_event constant uuid := '382a358b-7d2d-4390-a920-8013a70c560b';
  v_selected constant uuid := 'adf95966-86c0-4071-8c93-3effc385b787';
  v_previous constant uuid := 'e053b78a-d075-4f4d-a7c5-95a13deaa58a';
  v_retire constant uuid[] := ARRAY[
    '0d68a7a5-d65c-461b-9ddb-27b3d16a0d38'::uuid,
    '9e0b6f7f-89f7-4260-aab4-a6239b2ad525'::uuid,
    'fa3cfd3b-47d6-40f1-866d-bd610814f49c'::uuid
  ];
  v_approval constant text := 'Pap: use the current 271 sites; preserve history; restore map immediately. Codex 01a0e8f3-9858-7470-9704-9a4d6a485b99, 2026-09-28.';
  v_hash text;
  v_id uuid;
  v_correction uuid;
  v_result jsonb;
  v_corrected integer := 0;
  v_retired integer;
BEGIN
  -- Fresh replay / unrelated environments: schema only, no invented Event.
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event) THEN
    RETURN;
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Saint George repair requires the owner maintenance role';
  END IF;

  -- ALTER already holds the parking table lock through COMMIT. Keep the
  -- selected map, source markers and maintenance-window state stable too.
  LOCK TABLE public.parking_inventory_quiescence IN SHARE MODE;
  LOCK TABLE public.master_map_sites IN SHARE MODE;
  PERFORM 1 FROM public.event_map_settings WHERE event_id = v_event FOR UPDATE;
  PERFORM 1 FROM public.master_maps WHERE id IN (v_selected, v_previous) ORDER BY id FOR SHARE;

  IF (SELECT count(*) FROM public.event_map_settings
      WHERE event_id = v_event AND selected_master_map_id = v_selected) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.master_maps WHERE id = v_selected AND status = 'published' AND revision = 12)
     OR NOT EXISTS (SELECT 1 FROM public.master_maps WHERE id = v_previous AND status = 'archived' AND revision = 336)
  THEN
    RAISE EXCEPTION 'Saint George selected map or source revision changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.parking_inventory_quiescence WHERE event_id = v_event AND released_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.master_site_identity_correction WHERE event_id = v_event AND status IN ('draft','approved'))
  THEN
    RAISE EXCEPTION 'Saint George already has an active maintenance operation';
  END IF;

  SELECT md5(jsonb_agg(to_jsonb(p) - 'retired_at' - 'retirement_reason' ORDER BY p.id)::text)
    INTO v_hash FROM public.parking_sites p WHERE event_id = v_event;
  IF v_hash IS DISTINCT FROM 'b07505230c7b45394d89a8cf2a4f3e5e'
     OR (SELECT count(*) FROM public.parking_sites WHERE event_id = v_event) <> 274
     OR EXISTS (SELECT 1 FROM public.parking_sites WHERE event_id = v_event AND assigned_attendee_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.attendees WHERE event_id = v_event AND nullif(btrim(assigned_site), '') IS NOT NULL)
     OR (SELECT count(*) FROM public.master_map_sites WHERE master_map_id = v_selected) <> 271
  THEN
    RAISE EXCEPTION 'Saint George frozen inventory or placement state changed';
  END IF;

  FOR v_id IN
    SELECT p.id FROM public.parking_sites p
    JOIN public.master_map_sites s ON s.id = p.master_site_id
    WHERE p.event_id = v_event AND s.master_map_id = v_previous
      AND NOT (p.id = ANY(v_retire)) ORDER BY p.id
  LOOP
    -- The existing functions re-prove venue, generation, exact four-field
    -- equivalence, uniqueness, vacancy, frozen state and retained identity.
    v_correction := public.propose_master_site_identity_correction(v_id);
    v_result := public.review_master_site_identity_correction(v_correction);
    IF (v_result->>'expected_new_map_id')::uuid IS DISTINCT FROM v_selected
       OR (v_result->>'expected_old_map_id')::uuid IS DISTINCT FROM v_previous
    THEN
      RAISE EXCEPTION 'Correction proposal escaped approved map scope';
    END IF;
    PERFORM public.approve_master_site_identity_correction(v_correction, v_approval);
    PERFORM public.apply_master_site_identity_correction(v_correction);
    v_result := public.review_master_site_identity_correction(v_correction);
    IF v_result->>'status' IS DISTINCT FROM 'applied' THEN
      RAISE EXCEPTION 'Correction failed for %, rolling back entire repair: %', v_id, v_result->>'exclusion_reason';
    END IF;
    v_corrected := v_corrected + 1;
  END LOOP;
  IF v_corrected <> 271 THEN
    RAISE EXCEPTION 'Expected 271 corrections, got %', v_corrected;
  END IF;

  UPDATE public.parking_sites
    SET retired_at = transaction_timestamp(),
        retirement_reason = 'Obsolete pre-current-map inventory; original identity and placement history retained. ' || v_approval
    WHERE event_id = v_event AND id = ANY(v_retire)
      AND assigned_attendee_id IS NULL AND retired_at IS NULL;
  GET DIAGNOSTICS v_retired = ROW_COUNT;
  IF v_retired <> 3 THEN
    RAISE EXCEPTION 'Expected three retained historical rows, got %', v_retired;
  END IF;

  IF (SELECT count(*) FROM public.parking_sites WHERE event_id = v_event) <> 274
     OR (SELECT count(*) FROM public.parking_sites WHERE event_id = v_event AND retired_at IS NULL) <> 271
     OR EXISTS (
       SELECT 1 FROM public.parking_sites p LEFT JOIN public.master_map_sites s ON s.id=p.master_site_id
       WHERE p.event_id=v_event AND p.retired_at IS NULL
         AND (s.master_map_id IS DISTINCT FROM v_selected OR p.assigned_attendee_id IS NOT NULL)
     )
     OR (SELECT count(DISTINCT master_site_id) FROM public.parking_sites WHERE event_id=v_event AND retired_at IS NULL) <> 271
  THEN
    RAISE EXCEPTION 'Saint George final inventory verification failed';
  END IF;
END;
$repair$;

COMMIT;
