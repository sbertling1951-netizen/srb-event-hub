-- Governed one-time historical repair: raise attendees.participant_capacity
-- for imported attendees whose stored value understates the paid-slot
-- evidence already preserved in their own raw_import registration, per the
-- corrected import capacity rule (a nonblank Pilot is one paid slot; a
-- legitimate Co-Pilot in the SAME paid registration row is one additional
-- paid slot).
--
-- Scope and safeguards:
-- - Only source_type = 'imported' attendees are ever considered.
-- - A Co-Pilot is legitimate only when attendees.copilot_first is currently
--   nonblank -- this matches the corrected importer rule and excludes the
--   one known placeholder pattern found in production (a Co-Pilot Last Name
--   of "FAMILY" with no first name).
-- - The raw_import jsonb preserved at import time must independently show
--   both a nonblank "Pilot Name (First)" and a nonblank
--   "Co-Pilot Name (First)" in the SAME source row. This is the "same paid
--   registration" evidence requirement. Rows that do not independently carry
--   this confirmation (missing raw_import, or the two names not both present
--   together) are left untouched for manual review.
-- - The update can only ever raise participant_capacity, and only ever from
--   a value strictly below the derived capacity -- it never lowers an
--   existing value, so any higher administrator-confirmed capacity is
--   preserved untouched.
-- - Every precondition is re-evaluated against current production data at
--   execution time (not merely assumed from an earlier review), so the
--   migration fails closed on any row whose data no longer matches.
-- - attendee_household_members, People, identity, and participation history
--   are never touched.
-- - Rerunning this migration is a no-op: once a row's participant_capacity
--   reaches its derived value, it no longer satisfies the WHERE clause.

DO $$
DECLARE
  v_total_imported integer;
  v_candidates_evaluated integer;
  v_safe_candidates integer;
  v_manual_review_candidates integer;
  v_rows_updated integer;
  v_final_mismatch_count integer;
BEGIN
  SELECT count(*) INTO v_total_imported
  FROM public.attendees
  WHERE source_type = 'imported';

  WITH derived AS (
    SELECT
      a.id,
      a.participant_capacity AS stored_capacity,
      (a.copilot_first IS NOT NULL AND btrim(a.copilot_first) <> '')
        AS has_legitimate_copilot,
      (
        a.raw_import IS NOT NULL
        AND coalesce(btrim(a.raw_import ->> 'Pilot Name (First)'), '') <> ''
        AND coalesce(btrim(a.raw_import ->> 'Co-Pilot Name (First)'), '') <> ''
      ) AS raw_import_confirms_same_registration
    FROM public.attendees a
    WHERE a.source_type = 'imported'
  ),
  scored AS (
    SELECT
      id,
      stored_capacity,
      raw_import_confirms_same_registration,
      CASE WHEN has_legitimate_copilot THEN 2 ELSE 1 END AS derived_capacity
    FROM derived
  )
  SELECT
    count(*) FILTER (
      WHERE coalesce(stored_capacity, 0) < derived_capacity
    ),
    count(*) FILTER (
      WHERE coalesce(stored_capacity, 0) < derived_capacity
        AND raw_import_confirms_same_registration
    ),
    count(*) FILTER (
      WHERE coalesce(stored_capacity, 0) < derived_capacity
        AND NOT raw_import_confirms_same_registration
    )
  INTO v_candidates_evaluated, v_safe_candidates, v_manual_review_candidates
  FROM scored;

  RAISE NOTICE 'Imported attendees evaluated: %', v_total_imported;
  RAISE NOTICE 'Candidates evaluated (stored capacity below evidenced minimum): %',
    v_candidates_evaluated;
  RAISE NOTICE 'Safe automatic-correction candidates (same-registration evidence confirmed): %',
    v_safe_candidates;
  RAISE NOTICE 'Manual-review candidates (evidence not independently confirmed, left untouched): %',
    v_manual_review_candidates;

  WITH derived AS (
    SELECT
      a.id,
      a.participant_capacity AS stored_capacity,
      (a.copilot_first IS NOT NULL AND btrim(a.copilot_first) <> '')
        AS has_legitimate_copilot,
      (
        a.raw_import IS NOT NULL
        AND coalesce(btrim(a.raw_import ->> 'Pilot Name (First)'), '') <> ''
        AND coalesce(btrim(a.raw_import ->> 'Co-Pilot Name (First)'), '') <> ''
      ) AS raw_import_confirms_same_registration
    FROM public.attendees a
    WHERE a.source_type = 'imported'
  ),
  scored AS (
    SELECT
      id,
      stored_capacity,
      CASE WHEN has_legitimate_copilot THEN 2 ELSE 1 END AS derived_capacity
    FROM derived
    WHERE raw_import_confirms_same_registration
  ),
  qualified AS (
    SELECT id, derived_capacity
    FROM scored
    WHERE coalesce(stored_capacity, 0) < derived_capacity
  )
  UPDATE public.attendees AS a
  SET participant_capacity = qualified.derived_capacity
  FROM qualified
  WHERE a.id = qualified.id
    AND a.source_type = 'imported'
    AND coalesce(a.participant_capacity, 0) < qualified.derived_capacity;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  RAISE NOTICE 'Rows updated: %', v_rows_updated;
  RAISE NOTICE 'Rows skipped (no longer matched reviewed preconditions at execution time): %',
    v_safe_candidates - v_rows_updated;
  RAISE NOTICE 'Ambiguous/conflicting rows left untouched for manual review: %',
    v_manual_review_candidates;

  -- Final verification: recompute the same evidence-based mismatch check
  -- after the update. This is expected to equal exactly the manual-review
  -- count captured above (the rows this migration deliberately never
  -- touches).
  WITH derived AS (
    SELECT
      a.id,
      a.participant_capacity AS stored_capacity,
      (a.copilot_first IS NOT NULL AND btrim(a.copilot_first) <> '')
        AS has_legitimate_copilot
    FROM public.attendees a
    WHERE a.source_type = 'imported'
  ),
  scored AS (
    SELECT
      id,
      stored_capacity,
      CASE WHEN has_legitimate_copilot THEN 2 ELSE 1 END AS derived_capacity
    FROM derived
  )
  SELECT count(*) INTO v_final_mismatch_count
  FROM scored
  WHERE coalesce(stored_capacity, 0) < derived_capacity;

  RAISE NOTICE 'Final mismatch count (stored capacity still below evidenced minimum, expected to equal manual-review count): %',
    v_final_mismatch_count;

  IF v_final_mismatch_count <> v_manual_review_candidates THEN
    RAISE WARNING 'Final mismatch count (%) does not equal the manual-review candidate count (%) evaluated at the start of this migration -- production data may have changed during execution.',
      v_final_mismatch_count, v_manual_review_candidates;
  END IF;
END;
$$;
