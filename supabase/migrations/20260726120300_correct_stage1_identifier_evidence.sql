/*
Correct Stage 1 identifier evidence without changing canonical people,
auth-account links, role instances, or source records.
*/

BEGIN;

DO $$
DECLARE
  v_household_membership_count bigint;
  v_exact_household_membership_count bigint;
  v_attendee_membership_count bigint;
  v_attendee_membership_source_match_count bigint;
  v_phone_source_count bigint;
  v_resolved_person_count bigint;
  v_existing_phone_count bigint;
BEGIN
  SELECT count(*)
  INTO v_household_membership_count
  FROM public.person_identifiers
  WHERE identifier_type = 'membership_number'
    AND source_type = 'attendee_household_member_record';

  WITH expected_rows (id, person_id, normalized_value, source_record_id) AS (
    VALUES
      ('25bfccbc-74ec-49c2-808f-5cf0f41655bc'::uuid, 'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid, 'F460062'::text, '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid),
      ('22a01b63-e8a5-4163-b314-410cd9df1a56'::uuid, 'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid, 'F460062'::text, '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid),
      ('d3416ec3-dffb-4f61-ac4a-03a09022df41'::uuid, 'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid, 'F460062'::text, '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid),
      ('36e6b08a-ef51-4c66-9543-e4f223cae4c8'::uuid, 'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid, 'F460061'::text, 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid),
      ('6084e753-cfdd-4e12-b892-0530e32697e2'::uuid, 'c1ab66d8-4cee-4056-ad26-b0036422e6d4'::uuid, 'F703086'::text, '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid),
      ('6aae7e72-b94a-4b37-9399-75714e235540'::uuid, 'c1ab66d8-4cee-4056-ad26-b0036422e6d4'::uuid, 'P123456'::text, '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid),
      ('5321db70-af65-41d9-bd1a-40e7a05b38b3'::uuid, 'd05e4c7b-f427-46f4-8b60-26694de97c72'::uuid, 'F460062'::text, 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid)
  )
  SELECT count(*)
  INTO v_exact_household_membership_count
  FROM public.person_identifiers pi
  JOIN expected_rows e
    ON e.id = pi.id
   AND e.person_id = pi.person_id
   AND e.normalized_value = pi.normalized_value
   AND e.source_record_id = pi.source_record_id
  WHERE pi.identifier_type = 'membership_number'
    AND pi.identifier_value = pi.normalized_value
    AND pi.source_type = 'attendee_household_member_record';

  IF v_household_membership_count NOT IN (0, 7) THEN
    RAISE EXCEPTION 'Identifier correction precheck failed: household membership row count % is neither 7 nor 0',
      v_household_membership_count;
  END IF;

  IF v_exact_household_membership_count <> v_household_membership_count THEN
    RAISE EXCEPTION 'Identifier correction precheck failed: only % of % household membership rows match the approved repair set',
      v_exact_household_membership_count, v_household_membership_count;
  END IF;

  SELECT count(*)
  INTO v_attendee_membership_count
  FROM public.person_identifiers
  WHERE identifier_type = 'membership_number'
    AND source_type = 'attendee_record';

  SELECT count(*)
  INTO v_attendee_membership_source_match_count
  FROM public.person_identifiers pi
  JOIN public.attendees a
    ON a.id = pi.source_record_id
   AND NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') = pi.normalized_value
  WHERE pi.identifier_type = 'membership_number'
    AND pi.source_type = 'attendee_record';

  IF v_attendee_membership_count <> 6
     OR v_attendee_membership_source_match_count <> 6 THEN
    RAISE EXCEPTION 'Identifier correction precheck failed: valid attendee memberships count %, source matches %; expected 6 and 6',
      v_attendee_membership_count, v_attendee_membership_source_match_count;
  END IF;

  SELECT count(*)
  INTO v_phone_source_count
  FROM public.attendees
  WHERE id = 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid
    AND regexp_replace(coalesce(cell_phone, ''), '[^0-9]', '', 'g') = '3217040695';

  IF v_phone_source_count <> 1 THEN
    RAISE EXCEPTION 'Identifier correction precheck failed: expected Steven cell phone source was not found exactly once';
  END IF;

  SELECT count(DISTINCT pri.person_id)
  INTO v_resolved_person_count
  FROM public.person_role_instances pri
  JOIN public.person_auth_accounts paa
    ON paa.person_id = pri.person_id
   AND paa.auth_user_id = '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid
   AND paa.status = 'active'
  WHERE pri.source_role_instance_key = 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507'
    AND pri.attendee_id = 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid
    AND pri.identity_role = 'PILOT';

  IF v_resolved_person_count <> 1 THEN
    RAISE EXCEPTION 'Identifier correction precheck failed: omitted phone source did not resolve to exactly one person';
  END IF;

  SELECT count(*)
  INTO v_existing_phone_count
  FROM public.person_identifiers pi
  WHERE pi.identifier_type = 'phone'
    AND pi.normalized_value = '3217040695'
    AND NOT (
      pi.person_id = 'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid
      AND pi.source_type = 'attendee_record'
      AND pi.source_record_id = 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid
    );

  IF v_existing_phone_count <> 0 THEN
    RAISE EXCEPTION 'Identifier correction precheck failed: 3217040695 has an unexpected existing identifier assignment';
  END IF;
END
$$;

DELETE FROM public.person_identifiers
WHERE id IN (
  '25bfccbc-74ec-49c2-808f-5cf0f41655bc'::uuid,
  '22a01b63-e8a5-4163-b314-410cd9df1a56'::uuid,
  'd3416ec3-dffb-4f61-ac4a-03a09022df41'::uuid,
  '36e6b08a-ef51-4c66-9543-e4f223cae4c8'::uuid,
  '6084e753-cfdd-4e12-b892-0530e32697e2'::uuid,
  '6aae7e72-b94a-4b37-9399-75714e235540'::uuid,
  '5321db70-af65-41d9-bd1a-40e7a05b38b3'::uuid
);

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
  pri.person_id,
  'phone'::text,
  a.cell_phone,
  regexp_replace(a.cell_phone, '[^0-9]', '', 'g'),
  'attendee_record'::text,
  a.id,
  'observed'::text,
  90,
  true,
  now(),
  now()
FROM public.attendees a
JOIN public.person_role_instances pri
  ON pri.source_role_instance_key = 'attendee_pilot:' || a.id::text
 AND pri.identity_role = 'PILOT'
JOIN public.person_auth_accounts paa
  ON paa.person_id = pri.person_id
 AND paa.auth_user_id = '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid
 AND paa.status = 'active'
WHERE a.id = 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid
  AND regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') = '3217040695'
  AND NOT EXISTS (
    SELECT 1
    FROM public.person_identifiers pi
    WHERE pi.person_id = pri.person_id
      AND pi.identifier_type = 'phone'
      AND pi.normalized_value = '3217040695'
      AND pi.source_type = 'attendee_record'
      AND pi.source_record_id = a.id
  );

DO $$
DECLARE
  v_household_membership_count bigint;
  v_attendee_membership_count bigint;
  v_attendee_membership_source_match_count bigint;
  v_phone_count bigint;
BEGIN
  SELECT count(*)
  INTO v_household_membership_count
  FROM public.person_identifiers
  WHERE identifier_type = 'membership_number'
    AND source_type = 'attendee_household_member_record';

  SELECT count(*)
  INTO v_attendee_membership_count
  FROM public.person_identifiers
  WHERE identifier_type = 'membership_number'
    AND source_type = 'attendee_record';

  SELECT count(*)
  INTO v_attendee_membership_source_match_count
  FROM public.person_identifiers pi
  JOIN public.attendees a
    ON a.id = pi.source_record_id
   AND NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') = pi.normalized_value
  WHERE pi.identifier_type = 'membership_number'
    AND pi.source_type = 'attendee_record';

  SELECT count(*)
  INTO v_phone_count
  FROM public.person_identifiers
  WHERE person_id = 'af243f99-5fae-4350-8eb6-ae7938f12640'::uuid
    AND identifier_type = 'phone'
    AND normalized_value = '3217040695'
    AND source_type = 'attendee_record'
    AND source_record_id = 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid;

  IF v_household_membership_count <> 0
     OR v_attendee_membership_count <> 6
     OR v_attendee_membership_source_match_count <> 6
     OR v_phone_count <> 1 THEN
    RAISE EXCEPTION 'Identifier correction postcheck failed: household memberships %, attendee memberships %, source matches %, repaired phones %',
      v_household_membership_count,
      v_attendee_membership_count,
      v_attendee_membership_source_match_count,
      v_phone_count;
  END IF;
END
$$;

SELECT
  (SELECT count(*) FROM public.person_identifiers WHERE identifier_type = 'membership_number' AND source_type = 'attendee_household_member_record') AS household_membership_identifiers,
  (SELECT count(*) FROM public.person_identifiers WHERE identifier_type = 'membership_number' AND source_type = 'attendee_record') AS attendee_membership_identifiers,
  (SELECT count(*) FROM public.person_identifiers WHERE identifier_type = 'phone' AND normalized_value = '3217040695' AND source_type = 'attendee_record' AND source_record_id = 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid) AS repaired_phone_identifiers,
  'STAGE_1_IDENTIFIER_CORRECTION_COMPLETE'::text AS validation_status;

COMMIT;
