/*
Populate the authoritative attendee-to-person bridge from validated PILOT role
instances without changing Stage 1 identity truth.
*/

BEGIN;

LOCK TABLE public.people,
  public.person_role_instances,
  public.person_identifiers,
  public.person_auth_accounts IN SHARE MODE;

LOCK TABLE public.attendees IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE stage2_protected_table_fingerprints (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_fingerprint text NOT NULL
) ON COMMIT DROP;

INSERT INTO stage2_protected_table_fingerprints (table_name, row_count, row_fingerprint)
SELECT
  'people',
  count(*),
  md5(coalesce(string_agg(to_jsonb(p)::text, '' ORDER BY p.id::text), ''))
FROM public.people p
UNION ALL
SELECT
  'person_role_instances',
  count(*),
  md5(coalesce(string_agg(to_jsonb(pri)::text, '' ORDER BY pri.id::text), ''))
FROM public.person_role_instances pri
UNION ALL
SELECT
  'person_identifiers',
  count(*),
  md5(coalesce(string_agg(to_jsonb(pi)::text, '' ORDER BY pi.id::text), ''))
FROM public.person_identifiers pi
UNION ALL
SELECT
  'person_auth_accounts',
  count(*),
  md5(coalesce(string_agg(to_jsonb(paa)::text, '' ORDER BY paa.id::text), ''))
FROM public.person_auth_accounts paa;

CREATE TEMP TABLE stage2_existing_attendee_bridges ON COMMIT DROP AS
SELECT id AS attendee_id, person_id
FROM public.attendees
WHERE person_id IS NOT NULL;

CREATE TEMP TABLE stage2_attendee_person_candidates ON COMMIT DROP AS
SELECT
  pri.id AS role_instance_id,
  pri.attendee_id,
  pri.person_id
FROM public.person_role_instances pri
WHERE pri.identity_role = 'PILOT';

CREATE TEMP TABLE stage2_attendee_bridge_execution (
  candidate_count bigint NOT NULL,
  expected_update_count bigint NOT NULL,
  updated_count bigint NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_candidate_count bigint;
  v_duplicate_pilot_attendees bigint;
  v_multi_person_attendees bigint;
  v_invalid_people bigint;
  v_missing_attendees bigint;
  v_conflicting_existing_bridges bigint;
  v_expected_update_count bigint;
  v_updated_count bigint;
  v_overwritten_existing_bridges bigint;
  v_invalid_populated_attendees bigint;
  v_protected_table_changes bigint;
BEGIN
  SELECT count(*)
  INTO v_candidate_count
  FROM stage2_attendee_person_candidates;

  SELECT count(*)
  INTO v_duplicate_pilot_attendees
  FROM (
    SELECT attendee_id
    FROM stage2_attendee_person_candidates
    GROUP BY attendee_id
    HAVING count(*) > 1
  ) duplicates;

  IF v_duplicate_pilot_attendees <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge precheck failed: % attendees have duplicate PILOT role instances',
      v_duplicate_pilot_attendees;
  END IF;

  SELECT count(*)
  INTO v_multi_person_attendees
  FROM (
    SELECT attendee_id
    FROM stage2_attendee_person_candidates
    GROUP BY attendee_id
    HAVING count(DISTINCT person_id) > 1
  ) conflicts;

  IF v_multi_person_attendees <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge precheck failed: % attendees resolve to multiple canonical people',
      v_multi_person_attendees;
  END IF;

  SELECT count(*)
  INTO v_invalid_people
  FROM stage2_attendee_person_candidates candidate
  LEFT JOIN public.people p ON p.id = candidate.person_id
  WHERE p.id IS NULL
     OR p.status <> 'active'
     OR p.merged_into_person_id IS NOT NULL;

  IF v_invalid_people <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge precheck failed: % PILOT role instances reference missing, inactive, or merged people',
      v_invalid_people;
  END IF;

  SELECT count(*)
  INTO v_missing_attendees
  FROM stage2_attendee_person_candidates candidate
  LEFT JOIN public.attendees a ON a.id = candidate.attendee_id
  WHERE a.id IS NULL;

  IF v_missing_attendees <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge precheck failed: % PILOT role instances reference missing attendees',
      v_missing_attendees;
  END IF;

  SELECT count(*)
  INTO v_conflicting_existing_bridges
  FROM stage2_attendee_person_candidates candidate
  JOIN public.attendees a ON a.id = candidate.attendee_id
  WHERE a.person_id IS NOT NULL
    AND a.person_id IS DISTINCT FROM candidate.person_id;

  IF v_conflicting_existing_bridges <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge precheck failed: % non-null attendee bridges conflict with PILOT role truth',
      v_conflicting_existing_bridges;
  END IF;

  SELECT count(*)
  INTO v_expected_update_count
  FROM stage2_attendee_person_candidates candidate
  JOIN public.attendees a ON a.id = candidate.attendee_id
  WHERE a.person_id IS NULL;

  UPDATE public.attendees a
  SET person_id = candidate.person_id
  FROM stage2_attendee_person_candidates candidate
  WHERE a.id = candidate.attendee_id
    AND a.person_id IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_expected_update_count THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge update failed: updated % rows; expected %',
      v_updated_count, v_expected_update_count;
  END IF;

  SELECT count(*)
  INTO v_overwritten_existing_bridges
  FROM stage2_existing_attendee_bridges existing
  LEFT JOIN public.attendees a ON a.id = existing.attendee_id
  WHERE a.id IS NULL
     OR a.person_id IS DISTINCT FROM existing.person_id;

  IF v_overwritten_existing_bridges <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge postcheck failed: % existing non-null person_id values changed',
      v_overwritten_existing_bridges;
  END IF;

  SELECT count(*)
  INTO v_invalid_populated_attendees
  FROM (
    SELECT a.id
    FROM public.attendees a
    LEFT JOIN public.people p ON p.id = a.person_id
    LEFT JOIN public.person_role_instances pri
      ON pri.attendee_id = a.id
     AND pri.identity_role = 'PILOT'
    WHERE a.person_id IS NOT NULL
    GROUP BY a.id, a.person_id, p.id, p.status, p.merged_into_person_id
    HAVING p.id IS NULL
       OR p.status <> 'active'
       OR p.merged_into_person_id IS NOT NULL
       OR count(pri.id) <> 1
       OR count(*) FILTER (WHERE pri.person_id = a.person_id) <> 1
  ) invalid;

  IF v_invalid_populated_attendees <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge postcheck failed: % populated attendees lack one matching active canonical PILOT person',
      v_invalid_populated_attendees;
  END IF;

  WITH current_fingerprints AS (
    SELECT
      'people'::text AS table_name,
      count(*) AS row_count,
      md5(coalesce(string_agg(to_jsonb(p)::text, '' ORDER BY p.id::text), '')) AS row_fingerprint
    FROM public.people p
    UNION ALL
    SELECT
      'person_role_instances',
      count(*),
      md5(coalesce(string_agg(to_jsonb(pri)::text, '' ORDER BY pri.id::text), ''))
    FROM public.person_role_instances pri
    UNION ALL
    SELECT
      'person_identifiers',
      count(*),
      md5(coalesce(string_agg(to_jsonb(pi)::text, '' ORDER BY pi.id::text), ''))
    FROM public.person_identifiers pi
    UNION ALL
    SELECT
      'person_auth_accounts',
      count(*),
      md5(coalesce(string_agg(to_jsonb(paa)::text, '' ORDER BY paa.id::text), ''))
    FROM public.person_auth_accounts paa
  )
  SELECT count(*)
  INTO v_protected_table_changes
  FROM stage2_protected_table_fingerprints before_state
  FULL JOIN current_fingerprints current_state USING (table_name)
  WHERE before_state.table_name IS NULL
     OR current_state.table_name IS NULL
     OR before_state.row_count IS DISTINCT FROM current_state.row_count
     OR before_state.row_fingerprint IS DISTINCT FROM current_state.row_fingerprint;

  IF v_protected_table_changes <> 0 THEN
    RAISE EXCEPTION 'Stage 2 attendee bridge postcheck failed: % protected identity tables changed',
      v_protected_table_changes;
  END IF;

  INSERT INTO stage2_attendee_bridge_execution (
    candidate_count,
    expected_update_count,
    updated_count
  )
  VALUES (
    v_candidate_count,
    v_expected_update_count,
    v_updated_count
  );
END
$$;

SELECT
  execution.candidate_count,
  execution.expected_update_count,
  execution.updated_count,
  (SELECT count(*) FROM public.attendees WHERE person_id IS NOT NULL) AS populated_attendees,
  (SELECT count(*) FROM public.attendees WHERE person_id IS NULL) AS unpopulated_attendees,
  'STAGE_2_ATTENDEE_PERSON_BRIDGE_COMPLETE'::text AS validation_status
FROM stage2_attendee_bridge_execution execution;

COMMIT;