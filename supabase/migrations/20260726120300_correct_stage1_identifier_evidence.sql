/*
Replay-safe correction of Stage 1 identifier evidence.

This migration only operates on Stage 1 records that actually exist in the
current database and that have complete, internally consistent provenance.

Rules:
- Missing source data -> deterministic no-op.
- Present but contradictory data -> fail.
- Membership-number formatting alone is never used to classify non-member values.
*/

BEGIN;

CREATE TEMP TABLE stage1_known_nonmember_membership_evidence ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    (
      'household_member:69741cc2-1a76-4270-97d7-1526c35e20b6'::text,
      '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid,
      'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid,
      'F460062'::text
    ),
    (
      'household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442'::text,
      '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid,
      'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid,
      'F460062'::text
    ),
    (
      'household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::text,
      '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid,
      'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid,
      'F460062'::text
    ),
    (
      'household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::text,
      'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid,
      'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid,
      'F460061'::text
    ),
    (
      'household_member:2f482686-cb88-41b1-82d2-6b15731ef577'::text,
      '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid,
      'c1ab66d8-4cee-4056-ad26-b0036422e6d4'::uuid,
      'F703086'::text
    ),
    (
      'household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::text,
      '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid,
      'c1ab66d8-4cee-4056-ad26-b0036422e6d4'::uuid,
      'P123456'::text
    ),
    (
      'household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51'::text,
      'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid,
      'd05e4c7b-f427-46f4-8b60-26694de97c72'::uuid,
      'F460062'::text
    )
) AS v(source_role_instance_key, source_record_id, person_id, normalized_value);

CREATE TEMP TABLE stage1_role_context ON COMMIT DROP AS
SELECT
  pri.id AS role_instance_id,
  pri.person_id,
  pri.event_id,
  pri.attendee_id,
  pri.household_member_id,
  pri.identity_role,
  pri.source_table,
  pri.source_record_id,
  pri.source_manifest_version,
  pri.source_role_instance_key,
  hm.id AS hm_id,
  hm.attendee_id AS hm_attendee_id,
  hm.event_id AS hm_event_id,
  a.id AS attendee_exists_id,
  NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS attendee_membership_normalized,
  regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') AS attendee_phone_normalized
FROM public.person_role_instances pri
LEFT JOIN public.attendee_household_members hm
  ON hm.id = pri.household_member_id
LEFT JOIN public.attendees a
  ON a.id = pri.attendee_id
WHERE pri.source_manifest_version = '20260726_v1'
  AND pri.source_role_instance_key IN (
    'household_member:08374616-3cd4-433e-a761-838f2fa28848',
    'household_member:2f482686-cb88-41b1-82d2-6b15731ef577',
    'household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0',
    'household_member:69741cc2-1a76-4270-97d7-1526c35e20b6',
    'household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442',
    'household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e',
    'household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc',
    'household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51',
    'household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db',
    'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507'
  );

CREATE TEMP TABLE stage1_household_membership_candidates ON COMMIT DROP AS
SELECT
  pi.id AS identifier_id,
  pi.person_id,
  pi.normalized_value,
  pi.identifier_value,
  pi.source_record_id,
  rc.attendee_id,
  rc.event_id,
  rc.source_role_instance_key,
  rc.attendee_membership_normalized,
  (
    rc.identity_role = 'HOUSEHOLD_MEMBER'
    AND rc.source_table = 'public.attendee_household_members'
    AND rc.source_record_id = rc.household_member_id
    AND rc.hm_id IS NOT NULL
    AND rc.hm_attendee_id = rc.attendee_id
    AND rc.hm_event_id = rc.event_id
    AND rc.attendee_exists_id IS NOT NULL
    AND pi.source_record_id = rc.household_member_id
    AND pi.person_id = rc.person_id
  ) AS relation_consistent,
  (
    pi.normalized_value IS NOT NULL
    AND rc.attendee_membership_normalized IS NOT NULL
    AND pi.normalized_value = rc.attendee_membership_normalized
  ) AS source_membership_match,
  (
    kne.source_record_id IS NOT NULL
  ) AS is_explicit_known_nonmember,
  CASE
    WHEN kne.source_record_id IS NOT NULL THEN 'explicit_known_nonmember'::text
    WHEN pi.normalized_value IS NULL OR trim(pi.normalized_value) = '' THEN 'unknown_unclassified'::text
    ELSE 'unknown_unclassified'::text
  END AS classification
FROM public.person_identifiers pi
JOIN stage1_role_context rc
  ON rc.identity_role = 'HOUSEHOLD_MEMBER'
 AND rc.household_member_id = pi.source_record_id
LEFT JOIN stage1_known_nonmember_membership_evidence kne
  ON kne.source_role_instance_key = rc.source_role_instance_key
 AND kne.source_record_id = pi.source_record_id
 AND kne.person_id = pi.person_id
 AND kne.normalized_value = pi.normalized_value
WHERE pi.identifier_type = 'membership_number'
  AND pi.source_type = 'attendee_household_member_record';

CREATE TEMP TABLE stage1_phone_repair_anchor ON COMMIT DROP AS
SELECT
  rc.role_instance_id,
  rc.person_id,
  rc.attendee_id,
  rc.source_role_instance_key,
  rc.attendee_phone_normalized,
  (
    rc.identity_role = 'PILOT'
    AND rc.source_table = 'public.attendees'
    AND rc.source_record_id = rc.attendee_id
    AND rc.attendee_exists_id IS NOT NULL
    AND rc.source_role_instance_key = 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507'
    AND rc.attendee_id = 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid
    AND rc.attendee_phone_normalized = '3217040695'
  ) AS anchor_consistent
FROM stage1_role_context rc
WHERE rc.source_role_instance_key = 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507';

DO $$
DECLARE
  v_correction_candidate_count bigint;
  v_known_nonmember_count bigint;
  v_valid_person_specific_count bigint;
  v_unknown_unclassified_count bigint;
  v_source_match_count bigint;
  v_corrected_count bigint;
  v_contradictory_count bigint;
BEGIN
  SELECT count(*)
  INTO v_correction_candidate_count
  FROM stage1_household_membership_candidates;

  SELECT count(*)
  INTO v_known_nonmember_count
  FROM stage1_household_membership_candidates
  WHERE source_membership_match = true
    AND is_explicit_known_nonmember = true;

  SELECT 0::bigint
  INTO v_valid_person_specific_count;

  SELECT count(*)
  INTO v_unknown_unclassified_count
  FROM stage1_household_membership_candidates
  WHERE source_membership_match = true
    AND is_explicit_known_nonmember = false;

  SELECT count(*)
  INTO v_source_match_count
  FROM stage1_household_membership_candidates
  WHERE source_membership_match = true;

  SELECT
    (
      SELECT count(*)
      FROM stage1_household_membership_candidates c
      WHERE c.relation_consistent = true
        AND c.source_membership_match = true
        AND c.is_explicit_known_nonmember = true
    )
    +
    (
      SELECT count(*)
      FROM stage1_phone_repair_anchor a
      WHERE a.anchor_consistent = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = a.person_id
            AND pi.identifier_type = 'phone'
            AND pi.normalized_value = '3217040695'
            AND pi.source_type = 'attendee_record'
            AND pi.source_record_id = a.attendee_id
        )
    )
  INTO v_corrected_count;

  SELECT
    (
      SELECT count(*)
      FROM stage1_household_membership_candidates c
      WHERE c.relation_consistent = false
         OR c.source_membership_match = false
    )
    +
    (
      SELECT count(*)
      FROM stage1_phone_repair_anchor a
      WHERE a.anchor_consistent = false
    )
    +
    (
      SELECT count(*)
      FROM stage1_phone_repair_anchor a
      JOIN public.person_identifiers pi
        ON pi.identifier_type = 'phone'
       AND pi.normalized_value = '3217040695'
      WHERE a.anchor_consistent = true
        AND NOT (
          pi.person_id = a.person_id
          AND pi.source_type = 'attendee_record'
          AND pi.source_record_id = a.attendee_id
        )
    )
  INTO v_contradictory_count;

  RAISE NOTICE 'IDENTIFIER_CORRECTION candidate_count=%', v_correction_candidate_count;
  RAISE NOTICE 'IDENTIFIER_CORRECTION explicit_known_nonmember_count=%', v_known_nonmember_count;
  RAISE NOTICE 'IDENTIFIER_CORRECTION valid_person_specific_count=%', v_valid_person_specific_count;
  RAISE NOTICE 'IDENTIFIER_CORRECTION unknown_unclassified_count=%', v_unknown_unclassified_count;
  RAISE NOTICE 'IDENTIFIER_CORRECTION source_match_count=%', v_source_match_count;
  RAISE NOTICE 'IDENTIFIER_CORRECTION corrected_count=%', v_corrected_count;
  RAISE NOTICE 'IDENTIFIER_CORRECTION contradictory_count=%', v_contradictory_count;

  IF v_contradictory_count <> 0 THEN
    RAISE EXCEPTION 'Identifier correction precheck failed: contradictory_count % != 0', v_contradictory_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_deleted_membership_rows ON COMMIT DROP AS
WITH deleted AS (
  DELETE FROM public.person_identifiers pi
  USING stage1_household_membership_candidates c
  WHERE pi.id = c.identifier_id
    AND c.relation_consistent = true
    AND c.source_membership_match = true
    AND c.is_explicit_known_nonmember = true
  RETURNING pi.id
)
SELECT *
FROM deleted;

CREATE TEMP TABLE stage1_inserted_phone_rows ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO public.person_identifiers (
    person_id,
    identifier_type,
    identifier_value,
    normalized_value,
    source_type,
    source_record_id,
    verification_status,
    confidence,
    is_current,
    first_seen_at,
    last_seen_at
  )
  SELECT
    a.person_id,
    'phone'::text,
    attendees.cell_phone,
    a.attendee_phone_normalized,
    'attendee_record'::text,
    a.attendee_id,
    'observed'::text,
    90,
    true,
    now(),
    now()
  FROM stage1_phone_repair_anchor a
  JOIN public.attendees attendees
    ON attendees.id = a.attendee_id
  WHERE a.anchor_consistent = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.person_identifiers pi
      WHERE pi.person_id = a.person_id
        AND pi.identifier_type = 'phone'
        AND pi.normalized_value = a.attendee_phone_normalized
        AND pi.source_type = 'attendee_record'
        AND pi.source_record_id = a.attendee_id
    )
  RETURNING id, person_id, normalized_value, source_record_id
)
SELECT *
FROM inserted;

DO $$
DECLARE
  v_contradictory_count bigint;
BEGIN
  SELECT
    (
      SELECT count(*)
      FROM stage1_household_membership_candidates c
      WHERE c.relation_consistent = true
        AND c.source_membership_match = true
        AND c.is_explicit_known_nonmember = true
        AND EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.id = c.identifier_id
        )
    )
    +
    (
      SELECT count(*)
      FROM stage1_phone_repair_anchor a
      WHERE a.anchor_consistent = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = a.person_id
            AND pi.identifier_type = 'phone'
            AND pi.normalized_value = '3217040695'
            AND pi.source_type = 'attendee_record'
            AND pi.source_record_id = a.attendee_id
        )
    )
  INTO v_contradictory_count;

  IF v_contradictory_count <> 0 THEN
    RAISE EXCEPTION 'Identifier correction postcheck failed: contradictory_count % != 0', v_contradictory_count;
  END IF;
END
$$;

SELECT
  (SELECT count(*) FROM stage1_household_membership_candidates) AS correction_candidate_count,
  (SELECT count(*) FROM stage1_household_membership_candidates WHERE source_membership_match = true AND is_explicit_known_nonmember = true) AS explicit_known_nonmember_values_count,
  0::bigint AS valid_person_specific_membership_values_count,
  (SELECT count(*) FROM stage1_household_membership_candidates WHERE source_membership_match = true AND is_explicit_known_nonmember = false) AS unknown_membership_values_count,
  (SELECT count(*) FROM stage1_household_membership_candidates WHERE source_membership_match = true) AS source_match_count,
  (SELECT count(*) FROM stage1_deleted_membership_rows) AS deleted_household_membership_rows,
  (SELECT count(*) FROM stage1_inserted_phone_rows) AS inserted_phone_rows,
  (
    (SELECT count(*) FROM stage1_deleted_membership_rows)
    +
    (SELECT count(*) FROM stage1_inserted_phone_rows)
  ) AS corrected_rows,
  (
    (SELECT count(*) FROM stage1_household_membership_candidates c WHERE c.relation_consistent = false OR c.source_membership_match = false)
    +
    (SELECT count(*) FROM stage1_phone_repair_anchor a WHERE a.anchor_consistent = false)
    +
    (
      SELECT count(*)
      FROM stage1_phone_repair_anchor a
      JOIN public.person_identifiers pi
        ON pi.identifier_type = 'phone'
       AND pi.normalized_value = '3217040695'
      WHERE a.anchor_consistent = true
        AND NOT (
          pi.person_id = a.person_id
          AND pi.source_type = 'attendee_record'
          AND pi.source_record_id = a.attendee_id
        )
    )
  ) AS contradictory_rows,
  'STAGE_1_IDENTIFIER_CORRECTION_COMPLETE'::text AS validation_status;

COMMIT;
