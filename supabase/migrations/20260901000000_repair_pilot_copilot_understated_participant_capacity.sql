-- Governed one-time historical repair: raise attendees.participant_capacity
-- from 1 -> 2 for the confirmed set of active registrations whose stored
-- capacity understates a genuine, already-materialized Pilot + Co-Pilot
-- roster of two identified participants.
--
-- WHY A NEW REPAIR IS NEEDED
-- 20260805140000_repair_imported_participant_capacity corrected the same
-- class of understatement, but only for source_type = 'imported' rows whose
-- raw_import jsonb independently carried both a nonblank "Pilot Name (First)"
-- and "Co-Pilot Name (First)". The read-only diagnosis for this workstream
-- proved that exactly those two gates are why 11 rows were missed:
--   * 8 are source_type = 'manual' (hand-created in the admin attendee
--     editor, which historically defaulted participant_capacity to 1 and
--     never raised it for a Co-Pilot typed into the same form); and
--   * 3 are source_type = 'imported' but have raw_import = NULL, so the
--     evidence gate in 20260805140000 excluded them and left them "for
--     manual review".
-- This migration therefore does NOT consider source_type or raw_import at
-- all. Its entire evidence basis is the live, canonical roster:
-- attendees.participant_capacity, attendees.copilot_first, and the
-- materialized public.attendee_household_members rows -- the same three
-- facts the Member Dashboard itself reads to compute "N of M".
--
-- ELIGIBILITY (re-evaluated from live data at execution time; ALL required)
--   1. attendees.is_active = true
--   2. attendees.participant_capacity = 1   (raise-only: a value that is
--      NULL, 2, or anything > 1 is never touched)
--   3. nullif(btrim(attendees.copilot_first), '') IS NOT NULL
--   4. a materialized attendee_household_members row exists for the
--      attendee with person_role = 'copilot'
--   5. the attendee's total attendee_household_members row count >= 2
--      (the "resulting registered participant roster count" the member UI
--      shows -- get_my_household_members applies no status filter, so this
--      is a plain row count)
--
-- REPAIR: participant_capacity 1 -> 2. Nothing else on the attendee row,
-- and no attendee_household_members row, is ever written. The value is set
-- to exactly 2 (not to the roster count): a >2 roster at capacity 1 is a
-- distinct condition -- an unaccounted additional participant -- that must
-- remain a visible warning for separate review, not be silently absorbed
-- here. The diagnosis confirmed all 11 current rows have a roster of
-- exactly 2 (Pilot + Co-Pilot, no 'additional' row).
--
-- GOVERNED CAPACITY-INCREASE ARCHITECTURE IS PRESERVED
--   * The BEFORE UPDATE trigger attendees_enforce_capacity_increase_via_rpc
--     (20260805150000) rejects any UPDATE that raises participant_capacity
--     unless the transaction-local flag epicentrax.capacity_increase_authorized
--     is 'true'. This migration sets that same flag, transaction-locally,
--     immediately before each raise-guarded UPDATE and clears it immediately
--     after -- exactly as public.record_participant_capacity_increase does.
--   * One public.participant_capacity_adjustments audit row is written for
--     every repaired attendee, carrying previous_capacity = 1,
--     new_capacity = 2, and a fixed repair reason in `note`.
--   * public.record_participant_capacity_increase re-authorizes on
--     auth.uid() + event.attendees.manage and cannot run inside a migration
--     (no authenticated session). A historical repair is a Platform
--     Administration maintenance action, exercised through the audited
--     migration procedure itself -- per ADR-000 and
--     EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md §5, that authority is
--     organizational and is never represented as an in-application admin
--     identity. Part 1 below makes participant_capacity_adjustments able to
--     record such an actor-less row explicitly and safely, without
--     weakening the invariant for the administrator RPC path.
--
-- RERUN SAFETY: every statement is idempotent, and the repair is defined so
-- that a legitimate LATER capacity increase on one of these registrations
-- can never make a rerun fail.
--   * First-run eligibility is still exactly participant_capacity = 1 plus
--     the full five-condition roster test, and the first-run scope must
--     still equal the reviewed 11 exactly.
--   * The repair itself is still strictly 1 -> 2. It never lowers, and
--     never overwrites, any capacity that is already >= 2.
--   * On any later run: a reviewed row with participant_capacity >= 2
--     counts as already repaired, whether it is at 2, 3, or higher. The
--     rerun branch succeeds as a no-op when NO reviewed row still qualifies
--     for this 1 -> 2 repair AND no reviewed row that is present sits below
--     participant_capacity 2.
--   * It still fails closed if a reviewed row is present below capacity 2
--     (whether or not it re-qualifies for the repair), or if the set of
--     rows currently eligible for a 1 -> 2 repair is anything other than
--     the reviewed 11 -- a new, unreviewed occurrence is not silently
--     absorbed by re-running this migration.
--
-- Scope of change: public.participant_capacity_adjustments (Part 1, additive
-- + constraint tightening) and, on a first run only, exactly 11 rows of
-- public.attendees (Part 2, participant_capacity 1 -> 2 only). No function,
-- policy, grant, trigger, Person, Participation, Relationship, Identity, or
-- attendee_household_members row is altered.

BEGIN;

-- ---------------------------------------------------------------------------
-- Part 1. Let participant_capacity_adjustments record an actor-less
--         historical-repair adjustment.
--
-- The table was designed for administrator-initiated increases only:
-- actor_admin_user_id and actor_auth_user_id are NOT NULL FKs into the
-- application identity tables. A governed historical repair has no such
-- actor and must not borrow a real administrator's identity. This adds an
-- explicit discriminator and replaces the blanket NOT NULLs with a
-- conditional CHECK that is exactly as strict as before for the
-- 'administrator' path (both actor columns still required) and permits a
-- fully actor-less row only when adjustment_source = 'historical_repair'.
--
-- Every statement here is idempotent, so the whole migration is rerun-safe.
-- ---------------------------------------------------------------------------

ALTER TABLE public.participant_capacity_adjustments
  ADD COLUMN IF NOT EXISTS adjustment_source text NOT NULL DEFAULT 'administrator';

COMMENT ON COLUMN public.participant_capacity_adjustments.adjustment_source IS
  'Who/what performed this increase. ''administrator'' (default): an '
  'authenticated Event Administrator via record_participant_capacity_increase; '
  'both actor columns are required. ''historical_repair'': a governed '
  'one-time data-correction migration exercised through the audited Platform '
  'maintenance procedure; both actor columns are NULL and `note` states the '
  'repair reason.';

ALTER TABLE public.participant_capacity_adjustments
  DROP CONSTRAINT IF EXISTS participant_capacity_adjustments_adjustment_source_check;
ALTER TABLE public.participant_capacity_adjustments
  ADD CONSTRAINT participant_capacity_adjustments_adjustment_source_check
  CHECK (adjustment_source IN ('administrator', 'historical_repair'));

ALTER TABLE public.participant_capacity_adjustments
  ALTER COLUMN actor_admin_user_id DROP NOT NULL;
ALTER TABLE public.participant_capacity_adjustments
  ALTER COLUMN actor_auth_user_id DROP NOT NULL;

ALTER TABLE public.participant_capacity_adjustments
  DROP CONSTRAINT IF EXISTS participant_capacity_adjustments_actor_presence_check;
ALTER TABLE public.participant_capacity_adjustments
  ADD CONSTRAINT participant_capacity_adjustments_actor_presence_check CHECK (
    (
      adjustment_source = 'administrator'
      AND actor_admin_user_id IS NOT NULL
      AND actor_auth_user_id IS NOT NULL
    )
    OR (
      adjustment_source = 'historical_repair'
      AND actor_admin_user_id IS NULL
      AND actor_auth_user_id IS NULL
      AND note IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- Part 2. The one-time data repair, fully self-verifying. Any deviation
--         from the reviewed expectation raises an exception, which rolls
--         back the entire migration (Part 1 included).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  -- The reviewed scope: the exact 11 attendee rows confirmed by the
  -- read-only diagnosis (2 in Branson, 9 in "Amana Event & Annual Business
  -- Meeting"). Re-derived live eligibility must equal this set exactly on a
  -- first run, or the migration aborts for re-review.
  c_expected_ids constant uuid[] := ARRAY[
    '098dfa2a-4606-4a55-aada-a1a2a09f57fc',  -- Amana  - Jeanneret (imported)
    '1d1caab7-871d-4778-9422-18ad4a8d0f73',  -- Branson - Bertling (manual)
    '2c6b7688-c2fd-4824-92a3-b02ea9e3ff05',  -- Amana  - Smith (manual)
    '2f2a83de-4ea1-4b82-8afe-932deb2d08ec',  -- Branson - Jeanneret (imported)
    '6142b323-75df-4798-af3c-15863c8481ea',  -- Amana  - Batorson (manual)
    '658eb33c-864c-49de-84ee-54f85b8ec266',  -- Amana  - Feindel (manual)
    '90cdce02-8b78-4960-90cf-68c8b53b86e4',  -- Amana  - Pate (manual)
    'c7d257fa-b9e1-4326-8522-5781d71775ea',  -- Amana  - Darsow (manual)
    'd1344088-24a1-4305-892e-790d349b9bf1',  -- Amana  - Benzenhazer/Kiger (imported)
    'defa3cdd-c7dd-4166-a449-610957d6543e',  -- Amana  - Shawgo (manual)
    'ee51a0ab-c68a-4162-ac15-4825ecebe529'   -- Amana  - Fournier (manual)
  ]::uuid[];

  c_repair_note constant text :=
    'Historical Pilot + Co-Pilot capacity correction (20260901000000). '
    || 'participant_capacity was stored as 1 on a registration whose '
    || 'materialized roster holds a genuine Pilot and Co-Pilot (>= 2 '
    || 'identified participants). Raised 1 -> 2 to match the accepted import '
    || 'capacity rule: a nonblank Pilot is one paid slot and a legitimate '
    || 'Co-Pilot in the same registration is one additional paid slot. '
    || 'Eligibility was evaluated from the live canonical roster only '
    || '(participant_capacity, copilot_first, attendee_household_members), '
    || 'not from how the registration was originally created, which is why '
    || 'the 20260805140000 repair did not reach these rows.';

  v_eligible_ids         uuid[];
  v_reviewed_below_two   uuid[];
  v_reviewed_at_or_above integer;
  v_audit_rows_written   integer;
  v_second_pass_rows     integer;
  v_still_eligible       integer;
  v_others_before        text;
  v_others_after         text;
  v_no_copilot_before    text;
  v_no_copilot_after     text;
BEGIN
  -- (A) Live eligibility, all five conditions.
  SELECT coalesce(array_agg(a.id ORDER BY a.id), ARRAY[]::uuid[])
    INTO v_eligible_ids
  FROM public.attendees AS a
  WHERE a.is_active = true
    AND a.participant_capacity = 1
    AND nullif(btrim(coalesce(a.copilot_first, '')), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.attendee_household_members AS hm
      WHERE hm.attendee_id = a.id
        AND hm.person_role = 'copilot'
    )
    AND (
      SELECT count(*)
      FROM public.attendee_household_members AS hm2
      WHERE hm2.attendee_id = a.id
    ) >= 2;

  -- (B) Fingerprints of everything this migration must NOT change:
  --     every attendee outside the reviewed scope, and (separately) every
  --     capacity = 1 attendee that has no real Co-Pilot household row.
  SELECT md5(coalesce(string_agg(
           a.id::text || '=' || coalesce(a.participant_capacity::text, 'null'),
           ',' ORDER BY a.id), ''))
    INTO v_others_before
  FROM public.attendees AS a
  WHERE NOT (a.id = ANY (c_expected_ids));

  SELECT md5(coalesce(string_agg(
           a.id::text || '=' || coalesce(a.participant_capacity::text, 'null'),
           ',' ORDER BY a.id), ''))
    INTO v_no_copilot_before
  FROM public.attendees AS a
  WHERE a.participant_capacity = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.attendee_household_members AS hm
      WHERE hm.attendee_id = a.id
        AND hm.person_role = 'copilot'
    );

  -- (C) Any reviewed row that is PRESENT and sitting below participant_capacity
  --     2. A reviewed row that is absent (fresh / shadow database, migration
  --     replay) is not "below 2" -- it simply is not there.
  SELECT coalesce(array_agg(a.id ORDER BY a.id), ARRAY[]::uuid[])
    INTO v_reviewed_below_two
  FROM public.attendees AS a
  WHERE a.id = ANY (c_expected_ids)
    AND (a.participant_capacity IS NULL OR a.participant_capacity < 2);

  -- (D) Nothing currently qualifies for this 1 -> 2 repair.
  IF array_length(v_eligible_ids, 1) IS NULL THEN
    IF array_length(v_reviewed_below_two, 1) IS NOT NULL THEN
      RAISE EXCEPTION
        'Fail-closed: reviewed row(s) % are present with participant_capacity below 2 but do not qualify for this repair (Co-Pilot household row missing, roster < 2, or inactive). Manual review required.',
        v_reviewed_below_two;
    END IF;

    RAISE NOTICE
      'No-op: no reviewed registration still qualifies for this historical 1 -> 2 repair, and no reviewed row is present below participant_capacity 2. Repair already applied (or not applicable to this database).';
    RETURN;
  END IF;

  -- (E) Something qualifies. On a genuine first run that must be exactly the
  --     reviewed 11 -- no more, no fewer, no substitutions. A reviewed row
  --     already repaired (or a brand-new unreviewed occurrence) fails closed
  --     here: a new occurrence needs its own review, not a rerun of this one.
  IF NOT (v_eligible_ids OPERATOR(pg_catalog.@>) c_expected_ids
          AND c_expected_ids OPERATOR(pg_catalog.@>) v_eligible_ids) THEN
    RAISE EXCEPTION
      'Fail-closed: the set of rows currently eligible for this 1 -> 2 repair (%) is not the reviewed 11-row scope (%). Either a reviewed row was already changed, or an unreviewed occurrence exists; re-review before running this migration.',
      v_eligible_ids, c_expected_ids;
  END IF;

  IF array_length(v_eligible_ids, 1) <> 11 THEN
    RAISE EXCEPTION 'Expected exactly 11 eligible rows, found %.', array_length(v_eligible_ids, 1);
  END IF;

  RAISE NOTICE 'Eligibility verified: exactly 11 rows qualify and match the reviewed scope.';

  -- (F) Authorize the trigger-guarded increase, transaction-locally, for
  --     exactly the one UPDATE below -- mirrors record_participant_capacity_increase.
  PERFORM set_config('epicentrax.capacity_increase_authorized', 'true', true);

  -- One statement: raise the eligible rows, and write exactly one audit row
  -- per row actually raised (driven off the UPDATE's own RETURNING set, so
  -- the audit ledger can never diverge from what changed). ROW_COUNT after
  -- this statement is the number of audit rows inserted, which is 1:1 with
  -- the number of attendee rows raised.
  WITH raised AS (
    UPDATE public.attendees AS a
    SET participant_capacity = 2
    WHERE a.id = ANY (v_eligible_ids)
      AND a.participant_capacity = 1          -- raise-only guard
    RETURNING a.id AS attendee_id, a.event_id AS event_id
  )
  INSERT INTO public.participant_capacity_adjustments (
    attendee_id,
    event_id,
    previous_capacity,
    new_capacity,
    actor_admin_user_id,
    actor_auth_user_id,
    note,
    adjustment_source
  )
  SELECT
    raised.attendee_id,
    raised.event_id,
    1,
    2,
    NULL,
    NULL,
    c_repair_note,
    'historical_repair'
  FROM raised;

  -- ROW_COUNT here is the audit-INSERT row count, which is 1:1 with the
  -- attendee rows actually raised 1 -> 2 by the CTE above.
  GET DIAGNOSTICS v_audit_rows_written = ROW_COUNT;

  -- Independently recount the reviewed rows now at participant_capacity >= 2
  -- (2 from this repair, or higher from a legitimate prior increase -- this
  -- check never insists on exactly 2).
  SELECT count(*)
    INTO v_reviewed_at_or_above
  FROM public.attendees AS a
  WHERE a.id = ANY (c_expected_ids)
    AND a.participant_capacity >= 2;

  -- Clear the authorization immediately; nothing else in this migration
  -- may raise participant_capacity.
  PERFORM set_config('epicentrax.capacity_increase_authorized', 'false', true);

  -- (G) Verify: exactly 11 rows were raised, one audit row each, and every
  --     reviewed row now sits at participant_capacity >= 2.
  IF v_audit_rows_written <> 11 THEN
    RAISE EXCEPTION 'Expected to raise 11 rows (with 11 audit rows), got %.', v_audit_rows_written;
  END IF;
  IF v_reviewed_at_or_above <> 11 THEN
    RAISE EXCEPTION 'Expected all 11 reviewed rows at participant_capacity >= 2, found %.', v_reviewed_at_or_above;
  END IF;

  PERFORM 1
  FROM public.attendees
  WHERE id = ANY (c_expected_ids)
    AND (participant_capacity IS NULL OR participant_capacity < 2);
  IF FOUND THEN
    RAISE EXCEPTION 'Post-repair: at least one reviewed row is still below participant_capacity 2.';
  END IF;

  -- (H) No unrelated attendee changed capacity.
  SELECT md5(coalesce(string_agg(
           a.id::text || '=' || coalesce(a.participant_capacity::text, 'null'),
           ',' ORDER BY a.id), ''))
    INTO v_others_after
  FROM public.attendees AS a
  WHERE NOT (a.id = ANY (c_expected_ids));
  IF v_others_after IS DISTINCT FROM v_others_before THEN
    RAISE EXCEPTION 'Collateral change: participant_capacity of an attendee outside the reviewed scope changed.';
  END IF;

  -- (I) Rows at capacity 1 with no real Co-Pilot household row are untouched.
  SELECT md5(coalesce(string_agg(
           a.id::text || '=' || coalesce(a.participant_capacity::text, 'null'),
           ',' ORDER BY a.id), ''))
    INTO v_no_copilot_after
  FROM public.attendees AS a
  WHERE a.participant_capacity = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.attendee_household_members AS hm
      WHERE hm.attendee_id = a.id
        AND hm.person_role = 'copilot'
    );
  IF v_no_copilot_after IS DISTINCT FROM v_no_copilot_before THEN
    RAISE EXCEPTION 'A capacity = 1 row without a Co-Pilot household member changed.';
  END IF;

  -- (J) Idempotency: eligibility is now empty.
  SELECT count(*)
    INTO v_still_eligible
  FROM public.attendees AS a
  WHERE a.is_active = true
    AND a.participant_capacity = 1
    AND nullif(btrim(coalesce(a.copilot_first, '')), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.attendee_household_members AS hm
      WHERE hm.attendee_id = a.id AND hm.person_role = 'copilot'
    )
    AND (
      SELECT count(*) FROM public.attendee_household_members AS hm2
      WHERE hm2.attendee_id = a.id
    ) >= 2;
  IF v_still_eligible <> 0 THEN
    RAISE EXCEPTION 'Not idempotent: % rows would still be eligible on a rerun.', v_still_eligible;
  END IF;

  -- (K) Idempotency: a second raise-only UPDATE touches zero rows.
  PERFORM set_config('epicentrax.capacity_increase_authorized', 'true', true);
  WITH second_pass AS (
    UPDATE public.attendees AS a
    SET participant_capacity = 2
    WHERE a.id = ANY (c_expected_ids)
      AND a.participant_capacity = 1
    RETURNING 1
  )
  SELECT count(*) INTO v_second_pass_rows FROM second_pass;
  PERFORM set_config('epicentrax.capacity_increase_authorized', 'false', true);
  IF v_second_pass_rows <> 0 THEN
    RAISE EXCEPTION 'Not idempotent: a second UPDATE changed % rows.', v_second_pass_rows;
  END IF;

  RAISE NOTICE
    'Repair complete and verified: 11 rows raised participant_capacity 1 -> 2, 11 historical_repair audit rows written, no collateral change, rerun is a no-op.';
END;
$$;

COMMIT;
