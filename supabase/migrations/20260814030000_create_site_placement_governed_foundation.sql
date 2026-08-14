-- Site Placement Governed Mutation Foundation.
--
-- Implements the missing governed ordinary Site Placement Authority
-- boundary required by the Accepted architecture
-- (docs/architecture/EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md).
-- This is an Authority/governance foundation only. It does NOT call
-- public.assert_event_lifecycle_mutable and does not enforce Lifecycle --
-- that remains a distinct, later, explicitly-approved stage (Stage 3D+).
--
-- Repository/live-truth preflight (LEM Site Placement Foundation audit,
-- 2026-08-14) found record_site_placement had never been implemented
-- (zero trace in any migration, app code, or the live database) --
-- confirming Stage 3D's finding that current reality is still direct
-- browser writes with a non-Event-scoped legacy Authority predicate.
-- This migration builds the operation the spec describes, scoped to
-- what current data can safely support:
--
--   - public.parking_sites.event_id is NULL on 0 of 702 live rows --
--     safe to rely on as the Event-scope boundary.
--   - The current-placement uniqueness invariant (spec Section 6) has
--     zero live violations -- safe to add as a real constraint, not
--     just an RPC-level check.
--   - public.parking_sites.master_site_id is populated on only 292 of
--     702 live rows -- legacy free-text-only inventory predates the
--     master-map-linked model. Spec Section 6 calls for making
--     master_site_id NOT NULL and validating that a placed site belongs
--     to the Event's currently selected master map; neither is safely
--     applicable today without a separate, explicitly-scoped data
--     backfill/repair (the kind of work parking_repair_*/
--     master_site_identity_correction already exist to do carefully,
--     not something this foundation silently attempts). This migration
--     therefore validates only that the target site row belongs to the
--     correct Event (event_id match) -- the invariant current data can
--     actually support -- and does not attempt the deeper
--     selected-master-map membership check. This is a known, deliberate,
--     explicitly temporary scope limit, not an oversight; see the
--     accompanying report.
--
-- LEM Pre-Apply Correction (2026-08-14): the first draft of this
-- migration deliberately simplified spec Section 5's lock-set-
-- expansion-with-retry algorithm and Section 7's event_sequence ledger,
-- reasoning current UI call shapes only ever involve two rows. On
-- re-review against the specification text itself, both are normative
-- (imperative "must"/"It rolls back... and restarts..." language, no
-- "future"/"optional" qualifier -- contrast with places the same
-- document explicitly marks something as deferred, e.g. "A future
-- cross-table schema backstop may be added... but is not required for
-- this design"), and both are fully implementable against current
-- schema/data (unlike master_site_id, there is no live data conflict).
-- This migration now implements both faithfully. See the accompanying
-- report for the full normativity analysis.
--
-- Scope still deliberately excludes, as a "foundation" rather than the
-- complete specification:
--   - The Section 3.1 trusted Member-Report handoff and retiring
--     submit_member_checkin's own direct parking_sites write. That RPC
--     writes placement as member self-report activity, not ordinary
--     Admin mutation -- out of scope for this pass on the same grounds
--     Stage 3C/3D already established for participant-driven writes,
--     and integrating it safely means touching an already-hardened,
--     multi-migration identity/Tenant-verification chain, which is its
--     own explicitly-scoped follow-up.
--
-- Consumer classification (Phase 3): this migration does not move any
-- existing browser write. See the accompanying report for the full
-- placement-vs-map-configuration classification of every current
-- parking_sites/event_map_settings write site; retiring the ordinary
-- placement writes (app/admin/parking/page.tsx,
-- app/admin/checkin/page.tsx) behind this operation is left for a
-- separate, explicitly-scoped follow-up given the UI regression risk of
-- an unreviewed browser refactor. No direct-write table grant is
-- narrowed here as a result -- narrowing before consumers migrate would
-- break the currently-working Admin workflows Stage 3D's own grant
-- hardening pass was careful to preserve.

BEGIN;

-- ============================================================
-- 1. Current-placement invariant. Zero live violations confirmed by
--    preflight (see header). This is the real backstop Phase 2 item 7
--    requires -- not merely an RPC-level check.
-- ============================================================

ALTER TABLE public.parking_sites
  ADD CONSTRAINT parking_sites_one_current_site_per_attendee_per_event
  UNIQUE (event_id, assigned_attendee_id);

-- Note: this is a full unique constraint, not a partial one, because
-- Postgres UNIQUE constraints already treat NULL as distinct from every
-- other NULL -- an unlimited number of (event_id, NULL) rows (vacant
-- sites) remain permitted without a WHERE clause. A partial index would
-- express the same rule with no behavioral difference here.

-- ============================================================
-- 2. Event-local placement sequence. One row per Event, locked and
--    incremented inside the same transaction as every history write --
--    the monotonic, Event-local ordering spec Section 7 requires
--    ("It, not occurred_at, defines replay order"). Internal only.
-- ============================================================

CREATE TABLE public.event_placement_sequence (
  event_id uuid PRIMARY KEY REFERENCES public.events(id),
  current_value bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.event_placement_sequence OWNER TO postgres;
ALTER TABLE public.event_placement_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_placement_sequence FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._allocate_event_placement_sequence(p_event_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_value bigint;
BEGIN
  INSERT INTO public.event_placement_sequence (event_id) VALUES (p_event_id)
    ON CONFLICT (event_id) DO NOTHING;

  UPDATE public.event_placement_sequence
  SET current_value = current_value + 1
  WHERE event_id = p_event_id
  RETURNING current_value INTO v_value;

  RETURN v_value;
END;
$$;

ALTER FUNCTION public._allocate_event_placement_sequence(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._allocate_event_placement_sequence(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 3. Append-only placement history. Immutable by construction: no role
--    is ever granted INSERT/UPDATE/DELETE; only the SECURITY DEFINER
--    operation below writes it, running as its postgres owner.
--    event_sequence + operation_row_ordinal give deterministic
--    Event-local replay order (spec Section 7); a primary placement row
--    and its displaced-attendee row from the same call share one
--    event_sequence and are distinguished by operation_row_ordinal.
-- ============================================================

CREATE TABLE public.site_placement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL,
  event_sequence bigint NOT NULL,
  operation_row_ordinal integer NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id),
  action text NOT NULL CHECK (action IN ('assign', 'reassign', 'correct', 'clear', 'confirm')),
  requested_site_id uuid REFERENCES public.parking_sites(id),
  outcome text NOT NULL CHECK (outcome IN ('applied', 'confirmed', 'rejected')),
  rejection_code text,
  previous_site_id uuid REFERENCES public.parking_sites(id),
  previous_site_label text,
  resulting_site_id uuid REFERENCES public.parking_sites(id),
  resulting_site_label text,
  displaced_attendee_id uuid REFERENCES public.attendees(id),
  displaced_previous_site_id uuid REFERENCES public.parking_sites(id),
  evidence_source text NOT NULL CHECK (
    evidence_source IN (
      'parking_staff', 'checkin_staff', 'event_admin',
      'member_reported', 'park_provided', 'field_qr_verification'
    )
  ),
  note text,
  actor_auth_user_id uuid NOT NULL,
  actor_admin_user_id uuid,
  authority_basis text NOT NULL CHECK (authority_basis IN ('parking_manage', 'checkin_manage')),
  idempotency_key uuid NOT NULL UNIQUE,
  CONSTRAINT site_placement_history_rejection_code_matches_outcome CHECK (
    (outcome = 'rejected' AND rejection_code IS NOT NULL)
    OR (outcome <> 'rejected' AND rejection_code IS NULL)
  ),
  CONSTRAINT site_placement_history_event_sequence_ordinal_unique
    UNIQUE (event_id, event_sequence, operation_row_ordinal)
);

CREATE INDEX site_placement_history_attendee_idx
  ON public.site_placement_history (attendee_id, occurred_at);
CREATE INDEX site_placement_history_event_sequence_idx
  ON public.site_placement_history (event_id, event_sequence, operation_row_ordinal);
CREATE INDEX site_placement_history_operation_idx
  ON public.site_placement_history (operation_id);

ALTER TABLE public.site_placement_history OWNER TO postgres;
ALTER TABLE public.site_placement_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.site_placement_history FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 4. record_site_placement. The sole authoritative mutation boundary
--    for ordinary Site Placement. Authority (has_event_task_authority)
--    is established first and is completely unchanged/unmoved; no
--    Lifecycle guard exists in this function -- see header.
--
--    Locking follows spec Section 5's universal order: every candidate
--    parking-site row is locked (ascending canonical text id order),
--    then every candidate attendee row (ascending order), before any
--    read that decides the outcome. This operation's signature is
--    inherently single-attendee/single-target-site, so the candidate
--    set is structurally bounded to at most two site rows (the
--    attendee's current site, if any, and the requested target) and at
--    most two attendee rows (the caller's attendee, and whoever
--    currently occupies the target, if anyone) -- there is no larger
--    N-row case this signature can ever produce. If the post-lock
--    reread finds a relationship outside that locked set (someone else
--    changed it between the non-locking discovery read and lock
--    acquisition), the attempt raises a local signal caught by the
--    enclosing loop; PL/pgSQL's EXCEPTION handling rolls back
--    everything acquired since entering that block, releasing the
--    stale locks, and the loop recomputes and retries from fresh state
--    -- exactly spec Section 5's "rolls back, recomputes the complete
--    set from fresh state, and restarts" rule. A small fixed retry
--    bound (5) applies; exceeding it returns the spec's own
--    `placement_state_unstable` rejection with no authoritative
--    mutation.
-- ============================================================

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
