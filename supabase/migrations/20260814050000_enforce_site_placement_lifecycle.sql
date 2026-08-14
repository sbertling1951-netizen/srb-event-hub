-- Site Placement Governed Write Cutover -- Lifecycle enforcement.
--
-- Attaches Stage 3A's Lifecycle guard to public.record_site_placement,
-- the canonical ordinary Admin placement doorway (Site Placement
-- Governed Mutation Foundation, 2026-08-14). Exactly one line is added,
-- in the same position this pattern has used in every other Stage 3A/3B
-- domain: immediately after Authority is fully established (both
-- has_event_task_authority calls, the override check, and the
-- actor_admin_user_id lookup), before any other post-Authority logic --
-- here, before the race-safety wrapper that contains every branch of
-- the operation (clear, and the assign/reassign/correct/confirm retry
-- loop). Nothing else in the function body changes: same validation,
-- same locking/retry mechanics, same event_sequence/history model, same
-- idempotency behavior, same return shape, same error codes for every
-- pre-existing failure mode.
--
-- public.assert_event_lifecycle_mutable(event_id) is Stage 1's
-- unmodified resolver-backed guard, reused verbatim: operational and
-- post_event both pass; archived raises 'event_archived'; an
-- indeterminate Lifecycle (nonexistent Event, missing end_date, or
-- missing/invalid timezone) raises 'event_lifecycle_indeterminate'.
-- Authority is unchanged and still evaluated first -- an unauthorized
-- actor is rejected before Lifecycle is ever consulted, exactly as
-- every other gated domain in this codebase.
--
-- public.materialize_event_parking_site is NOT gated here. It creates
-- Event parking inventory from a master-map template site -- the same
-- "Event map projection creates inventory" step the Accepted
-- specification (Section 6.1) already classifies as part of governed
-- map publication/synchronization, not ordinary placement content. That
-- is the same Category B (map/master-map configuration) the Stage 3D
-- audit and the Site Placement Consumer Migration report already
-- excluded from this domain's Lifecycle/Authority-cutover scope; see
-- the accompanying report for the recommendation and rationale.
--
-- parking_repair_*, master_site_identity_correction, and the quiescence
-- infrastructure are untouched -- governed repair/correction machinery,
-- deliberately independent of Lifecycle by design.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_site_placement(
  p_attendee_id uuid,
  p_action text,
  p_idempotency_key uuid,
  p_site_id uuid DEFAULT NULL,
  p_evidence_source text DEFAULT 'event_admin',
  p_note text DEFAULT NULL,
  p_override_occupied_site boolean DEFAULT false
)
RETURNS TABLE(
  outcome text,
  action text,
  history_id uuid,
  event_id uuid,
  attendee_id uuid,
  previous_site_id uuid,
  previous_site_label text,
  resulting_site_id uuid,
  resulting_site_label text,
  displaced_attendee_id uuid,
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_admin_id uuid;
  v_event_id uuid;
  v_has_full boolean;
  v_has_restricted boolean;
  v_authority_basis text;
  v_operation_id uuid := gen_random_uuid();
  v_existing public.site_placement_history%ROWTYPE;
  v_history_id uuid;
  v_event_sequence bigint;
  v_retry_count integer := 0;
  v_max_retries constant integer := 5;
  v_current_site_id uuid;
  v_current_site_label text;
  v_target public.parking_sites%ROWTYPE;
  v_target_occupant_pre uuid;
  v_rejection_code text;
  v_displaced_attendee_id uuid;
  v_displaced_site_label text;
  v_site_lock_ids uuid[];
  v_attendee_lock_ids uuid[];
  v_lock_id uuid;
  v_stale boolean;
  v_row_still_current boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_action NOT IN ('assign', 'reassign', 'correct', 'clear', 'confirm') THEN
    RAISE EXCEPTION 'action_state_invalid';
  END IF;

  IF p_evidence_source NOT IN (
    'parking_staff', 'checkin_staff', 'event_admin',
    'member_reported', 'park_provided', 'field_qr_verification'
  ) THEN
    RAISE EXCEPTION 'action_state_invalid';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'action_state_invalid';
  END IF;

  IF p_action <> 'clear' AND p_site_id IS NULL THEN
    RAISE EXCEPTION 'site_not_found';
  END IF;

  -- Idempotency replay: a prior completed call with this exact key.
  SELECT * INTO v_existing
  FROM public.site_placement_history
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.attendee_id <> p_attendee_id
       OR v_existing.action <> p_action
       OR v_existing.requested_site_id IS DISTINCT FROM p_site_id THEN
      RAISE EXCEPTION 'idempotency_key_reused_conflict';
    END IF;

    RETURN QUERY SELECT
      v_existing.outcome, v_existing.action, v_existing.id, v_existing.event_id,
      v_existing.attendee_id, v_existing.previous_site_id, v_existing.previous_site_label,
      v_existing.resulting_site_id, v_existing.resulting_site_label,
      v_existing.displaced_attendee_id, v_existing.rejection_code;
    RETURN;
  END IF;

  -- Event identity: derived from the attendee, never accepted from the
  -- caller -- structurally prevents a cross-Event request.
  SELECT a.event_id INTO v_event_id FROM public.attendees AS a WHERE a.id = p_attendee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found';
  END IF;

  -- Authority. Canonical Event-scoped task authority only -- never
  -- client-side can_assign_parking or a raw privilege_group check.
  v_has_full := public.has_event_task_authority('event.parking.manage', v_event_id);
  v_has_restricted := public.has_event_task_authority('event.checkin.manage', v_event_id);

  IF NOT v_has_full AND NOT v_has_restricted THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  IF p_override_occupied_site AND NOT v_has_full THEN
    RAISE EXCEPTION 'override_not_permitted';
  END IF;

  v_authority_basis := CASE WHEN v_has_full THEN 'parking_manage' ELSE 'checkin_manage' END;

  SELECT au.id INTO v_actor_admin_id FROM public.admin_users AS au WHERE au.user_id = v_actor AND au.is_active;

  -- Lifecycle. Authority is fully established above; this is the only
  -- new line in this migration. operational/post_event pass; archived
  -- raises 'event_archived'; indeterminate raises
  -- 'event_lifecycle_indeterminate'. Never a substitute for Authority --
  -- always evaluated after it, never before.
  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Race-safety net: two genuinely concurrent calls sharing the same
  -- caller-supplied idempotency_key can both pass the lookup above (no
  -- row existed yet for either). Only one of their history INSERTs can
  -- win the idempotency_key UNIQUE constraint; the loser lands here,
  -- fetches the winner's now-committed-in-this-transaction row, and
  -- returns it exactly as an ordinary replay would -- never a raw
  -- constraint-violation error to the caller.
  BEGIN

  ----------------------------------------------------------------
  -- clear: single-row operation. No second row can ever be involved,
  -- so no lock-set expansion is possible -- a direct post-lock recheck
  -- of the one locked row is sufficient.
  ----------------------------------------------------------------
  IF p_action = 'clear' THEN
    SELECT ps.id, ps.display_label INTO v_current_site_id, v_current_site_label
    FROM public.parking_sites AS ps
    WHERE ps.event_id = v_event_id AND ps.assigned_attendee_id = p_attendee_id;

    IF v_current_site_id IS NOT NULL THEN
      PERFORM 1 FROM public.parking_sites WHERE id = v_current_site_id FOR UPDATE;
      PERFORM 1 FROM public.attendees WHERE id = p_attendee_id FOR UPDATE;

      SELECT (ps.assigned_attendee_id = p_attendee_id) INTO v_row_still_current
      FROM public.parking_sites AS ps WHERE ps.id = v_current_site_id;

      IF NOT coalesce(v_row_still_current, false) THEN
        v_current_site_id := NULL;
        v_current_site_label := NULL;
      END IF;
    END IF;

    v_event_sequence := public._allocate_event_placement_sequence(v_event_id);

    IF v_current_site_id IS NULL THEN
      INSERT INTO public.site_placement_history (
        operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id,
        outcome, rejection_code, evidence_source, note, actor_auth_user_id, actor_admin_user_id,
        authority_basis, idempotency_key
      ) VALUES (
        v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id,
        'rejected', 'attendee_unplaced', p_evidence_source, p_note, v_actor, v_actor_admin_id,
        v_authority_basis, p_idempotency_key
      ) RETURNING id INTO v_history_id;

      RETURN QUERY SELECT 'rejected'::text, p_action, v_history_id, v_event_id, p_attendee_id,
        NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid, 'attendee_unplaced'::text;
      RETURN;
    END IF;

    UPDATE public.parking_sites SET assigned_attendee_id = NULL WHERE id = v_current_site_id;

    INSERT INTO public.site_placement_history (
      operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id, outcome,
      previous_site_id, previous_site_label, resulting_site_id, resulting_site_label,
      evidence_source, note, actor_auth_user_id, actor_admin_user_id, authority_basis, idempotency_key
    ) VALUES (
      v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id, 'applied',
      v_current_site_id, v_current_site_label, NULL, NULL,
      p_evidence_source, p_note, v_actor, v_actor_admin_id, v_authority_basis, p_idempotency_key
    ) RETURNING id INTO v_history_id;

    RETURN QUERY SELECT 'applied'::text, p_action, v_history_id, v_event_id, p_attendee_id,
      v_current_site_id, v_current_site_label, NULL::uuid, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  ----------------------------------------------------------------
  -- assign / reassign / correct / confirm: bounded lock-set-expansion
  -- retry loop.
  ----------------------------------------------------------------
  <<retry_loop>>
  LOOP
    v_retry_count := v_retry_count + 1;

    IF v_retry_count > v_max_retries THEN
      v_event_sequence := public._allocate_event_placement_sequence(v_event_id);

      INSERT INTO public.site_placement_history (
        operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id,
        outcome, rejection_code, evidence_source, note, actor_auth_user_id, actor_admin_user_id,
        authority_basis, idempotency_key
      ) VALUES (
        v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id,
        'rejected', 'placement_state_unstable', p_evidence_source, p_note, v_actor, v_actor_admin_id,
        v_authority_basis, p_idempotency_key
      ) RETURNING id INTO v_history_id;

      RETURN QUERY SELECT 'rejected'::text, p_action, v_history_id, v_event_id, p_attendee_id,
        NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid, 'placement_state_unstable'::text;
      RETURN;
    END IF;

    BEGIN
      -- Phase A: non-locking discovery reads only (spec Section 5).
      SELECT ps.id INTO v_current_site_id
      FROM public.parking_sites AS ps
      WHERE ps.event_id = v_event_id AND ps.assigned_attendee_id = p_attendee_id;

      SELECT ps2.assigned_attendee_id INTO v_target_occupant_pre
      FROM public.parking_sites AS ps2
      WHERE ps2.id = p_site_id AND ps2.event_id = v_event_id;

      SELECT array_agg(x ORDER BY x::text) INTO v_site_lock_ids
      FROM (SELECT DISTINCT x FROM unnest(ARRAY[v_current_site_id, p_site_id]) AS x WHERE x IS NOT NULL) AS distinct_sites;

      SELECT array_agg(x ORDER BY x::text) INTO v_attendee_lock_ids
      FROM (SELECT DISTINCT x FROM unnest(ARRAY[p_attendee_id, v_target_occupant_pre]) AS x WHERE x IS NOT NULL) AS distinct_attendees;

      -- Phase B: every site lock first, then every attendee lock, both
      -- in ascending canonical order -- no site-to-attendee-to-site
      -- interleaving, matching the universal order spec Section 5
      -- requires to prevent deadlock between concurrent overlapping
      -- requests (including a reciprocal pair each targeting the
      -- other's current site).
      FOREACH v_lock_id IN ARRAY v_site_lock_ids LOOP
        PERFORM 1 FROM public.parking_sites WHERE id = v_lock_id FOR UPDATE;
      END LOOP;
      FOREACH v_lock_id IN ARRAY v_attendee_lock_ids LOOP
        PERFORM 1 FROM public.attendees WHERE id = v_lock_id FOR UPDATE;
      END LOOP;

      -- Phase C: reread every relationship now that every lock is held.
      v_stale := false;

      SELECT ps.id, ps.display_label INTO v_current_site_id, v_current_site_label
      FROM public.parking_sites AS ps
      WHERE ps.event_id = v_event_id AND ps.assigned_attendee_id = p_attendee_id;

      IF v_current_site_id IS NOT NULL AND NOT (v_current_site_id = ANY (v_site_lock_ids)) THEN
        v_stale := true;
      END IF;

      v_target := NULL;
      IF NOT v_stale THEN
        SELECT * INTO v_target FROM public.parking_sites AS ps
        WHERE ps.id = p_site_id AND ps.event_id = v_event_id;

        IF v_target.id IS NOT NULL AND v_target.assigned_attendee_id IS NOT NULL
           AND NOT (v_target.assigned_attendee_id = ANY (v_attendee_lock_ids)) THEN
          v_stale := true;
        END IF;
      END IF;

      IF v_stale THEN
        -- A relationship outside the locked set appeared between
        -- discovery and lock acquisition. Signal the enclosing loop;
        -- the EXCEPTION handler below rolls back everything acquired
        -- since entering this block (releasing every lock just taken)
        -- and the loop restarts from fresh non-locking discovery.
        RAISE EXCEPTION 'site_placement_lock_set_expanded' USING ERRCODE = 'P0001';
      END IF;

      EXIT retry_loop;
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        CONTINUE retry_loop;
    END;
  END LOOP;

  -- Lock set is stable: v_current_site_id/v_current_site_label and
  -- v_target now reflect locked, current-committed truth.

  IF v_target.id IS NULL THEN
    -- Covers both a nonexistent site and a cross-Event site id -- the
    -- caller learns nothing about whether the id exists in another Event.
    v_event_sequence := public._allocate_event_placement_sequence(v_event_id);

    INSERT INTO public.site_placement_history (
      operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id,
      outcome, rejection_code, evidence_source, note, actor_auth_user_id, actor_admin_user_id,
      authority_basis, idempotency_key
    ) VALUES (
      v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id,
      'rejected', 'site_not_found', p_evidence_source, p_note, v_actor, v_actor_admin_id,
      v_authority_basis, p_idempotency_key
    ) RETURNING id INTO v_history_id;

    RETURN QUERY SELECT 'rejected'::text, p_action, v_history_id, v_event_id, p_attendee_id,
      NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid, 'site_not_found'::text;
    RETURN;
  END IF;

  v_rejection_code := NULL;

  IF p_action = 'assign' THEN
    IF v_current_site_id IS NOT NULL THEN
      v_rejection_code := 'attendee_already_placed';
    END IF;
  ELSIF p_action IN ('reassign', 'correct') THEN
    IF v_current_site_id IS NULL THEN
      v_rejection_code := 'attendee_unplaced';
    ELSIF v_current_site_id = p_site_id THEN
      v_rejection_code := 'action_state_invalid';
    END IF;
  ELSIF p_action = 'confirm' THEN
    IF v_current_site_id IS NULL THEN
      v_rejection_code := 'attendee_unplaced';
    ELSIF v_current_site_id <> p_site_id THEN
      v_rejection_code := 'action_state_invalid';
    END IF;
  END IF;

  IF v_rejection_code IS NOT NULL THEN
    v_event_sequence := public._allocate_event_placement_sequence(v_event_id);

    INSERT INTO public.site_placement_history (
      operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id,
      outcome, rejection_code, previous_site_id, previous_site_label,
      evidence_source, note, actor_auth_user_id, actor_admin_user_id, authority_basis, idempotency_key
    ) VALUES (
      v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id,
      'rejected', v_rejection_code, v_current_site_id, v_current_site_label,
      p_evidence_source, p_note, v_actor, v_actor_admin_id, v_authority_basis, p_idempotency_key
    ) RETURNING id INTO v_history_id;

    RETURN QUERY SELECT 'rejected'::text, p_action, v_history_id, v_event_id, p_attendee_id,
      v_current_site_id, v_current_site_label, NULL::uuid, NULL::text, NULL::uuid, v_rejection_code;
    RETURN;
  END IF;

  IF p_action = 'confirm' THEN
    v_event_sequence := public._allocate_event_placement_sequence(v_event_id);

    INSERT INTO public.site_placement_history (
      operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id, outcome,
      previous_site_id, previous_site_label, resulting_site_id, resulting_site_label,
      evidence_source, note, actor_auth_user_id, actor_admin_user_id, authority_basis, idempotency_key
    ) VALUES (
      v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id, 'confirmed',
      v_current_site_id, v_current_site_label, v_current_site_id, v_current_site_label,
      p_evidence_source, p_note, v_actor, v_actor_admin_id, v_authority_basis, p_idempotency_key
    ) RETURNING id INTO v_history_id;

    RETURN QUERY SELECT 'confirmed'::text, p_action, v_history_id, v_event_id, p_attendee_id,
      v_current_site_id, v_current_site_label, v_current_site_id, v_current_site_label, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- assign / reassign / correct now proceed to mutate. Handle
  -- displacement of a different occupant of the target site -- both
  -- rows involved are already locked (v_target's row via the site lock
  -- set; the occupant's attendee row via the attendee lock set).
  IF v_target.assigned_attendee_id IS NOT NULL AND v_target.assigned_attendee_id <> p_attendee_id THEN
    IF NOT p_override_occupied_site THEN
      v_event_sequence := public._allocate_event_placement_sequence(v_event_id);

      INSERT INTO public.site_placement_history (
        operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id,
        outcome, rejection_code, previous_site_id, previous_site_label,
        evidence_source, note, actor_auth_user_id, actor_admin_user_id, authority_basis, idempotency_key
      ) VALUES (
        v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id,
        'rejected', 'site_occupied', v_current_site_id, v_current_site_label,
        p_evidence_source, p_note, v_actor, v_actor_admin_id, v_authority_basis, p_idempotency_key
      ) RETURNING id INTO v_history_id;

      RETURN QUERY SELECT 'rejected'::text, p_action, v_history_id, v_event_id, p_attendee_id,
        v_current_site_id, v_current_site_label, NULL::uuid, NULL::text, NULL::uuid, 'site_occupied'::text;
      RETURN;
    END IF;

    v_displaced_attendee_id := v_target.assigned_attendee_id;
    v_displaced_site_label := v_target.display_label;
  END IF;

  IF v_current_site_id IS NOT NULL THEN
    UPDATE public.parking_sites SET assigned_attendee_id = NULL WHERE id = v_current_site_id;
  END IF;

  UPDATE public.parking_sites SET assigned_attendee_id = p_attendee_id WHERE id = p_site_id;

  v_event_sequence := public._allocate_event_placement_sequence(v_event_id);

  INSERT INTO public.site_placement_history (
    operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id, outcome,
    previous_site_id, previous_site_label, resulting_site_id, resulting_site_label,
    displaced_attendee_id, displaced_previous_site_id,
    evidence_source, note, actor_auth_user_id, actor_admin_user_id, authority_basis, idempotency_key
  ) VALUES (
    v_operation_id, v_event_sequence, 0, v_event_id, p_attendee_id, p_action, p_site_id, 'applied',
    v_current_site_id, v_current_site_label, p_site_id, v_target.display_label,
    v_displaced_attendee_id, CASE WHEN v_displaced_attendee_id IS NOT NULL THEN p_site_id END,
    p_evidence_source, p_note, v_actor, v_actor_admin_id, v_authority_basis, p_idempotency_key
  ) RETURNING id INTO v_history_id;

  IF v_displaced_attendee_id IS NOT NULL THEN
    INSERT INTO public.site_placement_history (
      operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id, outcome,
      previous_site_id, previous_site_label, resulting_site_id, resulting_site_label,
      evidence_source, note, actor_auth_user_id, actor_admin_user_id, authority_basis, idempotency_key
    ) VALUES (
      v_operation_id, v_event_sequence, 1, v_event_id, v_displaced_attendee_id, 'clear', NULL, 'applied',
      p_site_id, v_displaced_site_label, NULL, NULL,
      p_evidence_source, 'displaced by authorized override', v_actor, v_actor_admin_id, v_authority_basis, gen_random_uuid()
    );
  END IF;

  RETURN QUERY SELECT 'applied'::text, p_action, v_history_id, v_event_id, p_attendee_id,
    v_current_site_id, v_current_site_label, p_site_id, v_target.display_label, v_displaced_attendee_id, NULL::text;

  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing FROM public.site_placement_history WHERE idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN QUERY SELECT
          v_existing.outcome, v_existing.action, v_existing.id, v_existing.event_id,
          v_existing.attendee_id, v_existing.previous_site_id, v_existing.previous_site_label,
          v_existing.resulting_site_id, v_existing.resulting_site_label,
          v_existing.displaced_attendee_id, v_existing.rejection_code;
        RETURN;
      END IF;
      RAISE;
  END;
END;
$$;

ALTER FUNCTION public.record_site_placement(uuid, text, uuid, uuid, text, text, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_site_placement(uuid, text, uuid, uuid, text, text, boolean)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_site_placement(uuid, text, uuid, uuid, text, text, boolean)
TO authenticated;

COMMIT;
