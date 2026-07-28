/*
Stage 1 identity backfill migration.

Scope:
- Resolve before create from the frozen 20260726_v1 manifest.
- Create people rows only when no safe existing person resolution exists.
- Create person_auth_accounts links for auth groups whose auth.users parents exist.
- Create person_identifiers rows from reliable manifest evidence.
- Create person_role_instances links only for manifest rows with complete source evidence.

Safety:
- Uses immutable manifest membership values (exact 17 rows).
- Fails on shape mismatch, conflicting evidence, or link conflicts.
- Does not update attendees.person_id.
*/

BEGIN;

CREATE TEMP TABLE stage1_manifest_rows (
  manifest_version text NOT NULL,
  role_instance_key text NOT NULL,
  attendee_id uuid NOT NULL,
  event_id uuid NOT NULL,
  identity_role text NOT NULL,
  household_member_id uuid,
  auth_user_id uuid NOT NULL,
  proposed_person_key text NOT NULL,
  current_person_id uuid,
  normalized_first_name text,
  normalized_last_name text,
  display_first_name text,
  display_last_name text,
  membership_number text,
  normalized_membership_number text,
  normalized_email text,
  normalized_phone text,
  review_status text NOT NULL,
  competing_claim_count integer NOT NULL,
  identifier_conflict_count integer NOT NULL
) ON COMMIT DROP;

INSERT INTO stage1_manifest_rows (
  manifest_version,
  role_instance_key,
  attendee_id,
  event_id,
  identity_role,
  household_member_id,
  auth_user_id,
  proposed_person_key,
  current_person_id,
  normalized_first_name,
  normalized_last_name,
  display_first_name,
  display_last_name,
  membership_number,
  normalized_membership_number,
  normalized_email,
  normalized_phone,
  review_status,
  competing_claim_count,
  identifier_conflict_count
)
VALUES
  ('20260726_v1', 'attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460061', 'F460061', 'sbertling1951@gmail.com', '9514911297', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'P123456', 'P123456', 'sjjeanneret@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'F703086', 'F703086', 'sjjeanneret@gmail.com', '7852208673', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', NULL, 'steve', 'batorson', 'Steve', 'Batorson', NULL, NULL, 'batorson@gmail.com', '5204446772', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'auth:3ec28672-57c1-4904-854b-efba23210c1d', NULL, 'bud', 'vogt', 'Bud', 'Vogt', NULL, NULL, 'budvogt@juno.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', '9514911297', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:08374616-3cd4-433e-a761-838f2fa28848', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '08374616-3cd4-433e-a761-838f2fa28848'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', NULL, 'steve', 'batorson', 'Steve', 'Batorson', NULL, NULL, 'batorson@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:2f482686-cb88-41b1-82d2-6b15731ef577', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'F703086', 'F703086', 'sjjeanneret@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'P123456', 'P123456', 'sjjeanneret@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'HOUSEHOLD_MEMBER', '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '9ec93e24-94f8-4faa-a2b5-1eab8629fefc'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'auth:3ec28672-57c1-4904-854b-efba23210c1d', NULL, 'bud', 'vogt', 'Bud', 'Vogt', NULL, NULL, 'budvogt@juno.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid, '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'auth:4180a4b6-334f-4daf-8111-ad2721b0c75e', NULL, 'janine', 'rowe', 'Janine', 'Rowe', 'F460062', 'F460062', 'fcoceventhost@gmail.com', '4042190279', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'HOUSEHOLD_MEMBER', 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460061', 'F460061', 'sbertling1951@gmail.com', NULL, 'VALIDATED_FOR_BACKFILL', 0, 0);

DO $$
DECLARE
  v_manifest_row_count bigint;
  v_distinct_role_instance_key_count bigint;
  v_distinct_auth_count bigint;
  v_distinct_proposed_person_key_count bigint;
  v_rows_with_null_auth bigint;
  v_rows_with_null_role_key bigint;
  v_rows_with_unsupported_role bigint;
  v_invalid_review_status_rows bigint;
  v_competing_claim_total bigint;
  v_identifier_conflict_total bigint;
  v_membership_type_supported boolean;
BEGIN
  SELECT count(*) INTO v_manifest_row_count FROM stage1_manifest_rows;
  SELECT count(DISTINCT role_instance_key) INTO v_distinct_role_instance_key_count FROM stage1_manifest_rows;
  SELECT count(DISTINCT auth_user_id) INTO v_distinct_auth_count FROM stage1_manifest_rows;
  SELECT count(DISTINCT proposed_person_key) INTO v_distinct_proposed_person_key_count FROM stage1_manifest_rows;
  SELECT count(*) INTO v_rows_with_null_auth FROM stage1_manifest_rows WHERE auth_user_id IS NULL;
  SELECT count(*) INTO v_rows_with_null_role_key FROM stage1_manifest_rows WHERE role_instance_key IS NULL OR trim(role_instance_key) = '';
  SELECT count(*) INTO v_rows_with_unsupported_role FROM stage1_manifest_rows WHERE identity_role NOT IN ('PILOT', 'HOUSEHOLD_MEMBER');

  SELECT count(*)
  INTO v_invalid_review_status_rows
  FROM stage1_manifest_rows
  WHERE manifest_version <> '20260726_v1'
     OR review_status <> 'VALIDATED_FOR_BACKFILL';

  SELECT coalesce(sum(competing_claim_count), 0), coalesce(sum(identifier_conflict_count), 0)
  INTO v_competing_claim_total, v_identifier_conflict_total
  FROM stage1_manifest_rows;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.person_identifiers'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%membership_number%'
  )
  INTO v_membership_type_supported;

  IF v_manifest_row_count <> 17 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: manifest_row_count % != 17', v_manifest_row_count;
  END IF;
  IF v_distinct_role_instance_key_count <> 17 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: distinct_role_instance_key_count % != 17', v_distinct_role_instance_key_count;
  END IF;
  IF v_distinct_auth_count <> 5 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: distinct_auth_count % != 5', v_distinct_auth_count;
  END IF;
  IF v_distinct_proposed_person_key_count <> 5 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: distinct_proposed_person_key_count % != 5', v_distinct_proposed_person_key_count;
  END IF;
  IF v_rows_with_null_auth <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: rows_with_null_auth % != 0', v_rows_with_null_auth;
  END IF;
  IF v_rows_with_null_role_key <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: rows_with_null_role_key % != 0', v_rows_with_null_role_key;
  END IF;
  IF v_rows_with_unsupported_role <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: rows_with_unsupported_role % != 0', v_rows_with_unsupported_role;
  END IF;
  IF v_invalid_review_status_rows <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: invalid_review_status_rows % != 0', v_invalid_review_status_rows;
  END IF;
  IF v_competing_claim_total <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: competing_claim_total % != 0', v_competing_claim_total;
  END IF;
  IF v_identifier_conflict_total <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: identifier_conflict_total % != 0', v_identifier_conflict_total;
  END IF;
  IF NOT v_membership_type_supported THEN
    RAISE EXCEPTION 'Stage1 assertion failed: person_identifiers does not support membership_number identifier_type';
  END IF;
END
$$;

DO $$
DECLARE
  v_name_conflict_count bigint;
BEGIN
  SELECT count(*)
  INTO v_name_conflict_count
  FROM (
    SELECT
      auth_user_id
    FROM stage1_manifest_rows
    GROUP BY auth_user_id
    HAVING count(DISTINCT normalized_first_name) FILTER (WHERE normalized_first_name IS NOT NULL AND trim(normalized_first_name) <> '') > 1
       OR count(DISTINCT normalized_last_name) FILTER (WHERE normalized_last_name IS NOT NULL AND trim(normalized_last_name) <> '') > 1
  ) conflicts;

  IF v_name_conflict_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: conflicting canonical names found in % auth groups', v_name_conflict_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_manifest_source_status ON COMMIT DROP AS
WITH source_eval AS (
  SELECT
    m.*,
    (ev.id IS NOT NULL) AS event_exists,
    (a.id IS NOT NULL) AS attendee_exists,
    (a.id IS NOT NULL AND a.event_id = m.event_id) AS attendee_event_matches_manifest,
    (m.identity_role = 'HOUSEHOLD_MEMBER') AS household_member_required,
    (hm.id IS NOT NULL) AS household_member_exists,
    (hm.id IS NOT NULL AND hm.attendee_id = m.attendee_id) AS household_member_attendee_matches_manifest,
    (hm.id IS NOT NULL AND hm.event_id = m.event_id) AS household_member_event_matches_manifest,
    (au.id IS NOT NULL) AS auth_user_exists,
    true::boolean AS tenant_relationship_consistent,
    CASE
      WHEN m.competing_claim_count <> 0 OR m.identifier_conflict_count <> 0
        THEN 'ambiguous_or_conflicting'::text
      WHEN m.identity_role = 'PILOT' AND m.household_member_id IS NOT NULL
        THEN 'source_inconsistent'::text
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND m.household_member_id IS NULL
        THEN 'source_inconsistent'::text
      WHEN m.identity_role = 'PILOT' AND m.role_instance_key NOT LIKE 'attendee_pilot:%'
        THEN 'source_inconsistent'::text
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND m.role_instance_key NOT LIKE 'household_member:%'
        THEN 'source_inconsistent'::text
      WHEN ev.id IS NULL OR a.id IS NULL
        THEN 'source_absent'::text
      WHEN a.event_id IS DISTINCT FROM m.event_id
        THEN 'source_inconsistent'::text
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND hm.id IS NULL
        THEN 'source_absent'::text
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND hm.attendee_id IS DISTINCT FROM m.attendee_id
        THEN 'source_inconsistent'::text
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND hm.event_id IS DISTINCT FROM m.event_id
        THEN 'source_inconsistent'::text
      ELSE 'source_eligible'::text
    END AS source_status,
    CASE
      WHEN m.competing_claim_count <> 0 OR m.identifier_conflict_count <> 0
        THEN 'manifest_conflict_flags_present'
      WHEN m.identity_role = 'PILOT' AND m.household_member_id IS NOT NULL
        THEN 'pilot_row_has_household_member_id'
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND m.household_member_id IS NULL
        THEN 'household_row_missing_household_member_id'
      WHEN m.identity_role = 'PILOT' AND m.role_instance_key NOT LIKE 'attendee_pilot:%'
        THEN 'pilot_role_key_prefix_mismatch'
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND m.role_instance_key NOT LIKE 'household_member:%'
        THEN 'household_role_key_prefix_mismatch'
      WHEN a.id IS NOT NULL AND a.event_id IS DISTINCT FROM m.event_id
        THEN 'attendee_event_mismatch'
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND hm.id IS NOT NULL AND hm.attendee_id IS DISTINCT FROM m.attendee_id
        THEN 'household_attendee_mismatch'
      WHEN m.identity_role = 'HOUSEHOLD_MEMBER' AND hm.id IS NOT NULL AND hm.event_id IS DISTINCT FROM m.event_id
        THEN 'household_event_mismatch'
      ELSE NULL
    END AS source_inconsistency_reason
  FROM stage1_manifest_rows m
  LEFT JOIN public.events ev
    ON ev.id = m.event_id
  LEFT JOIN public.attendees a
    ON a.id = m.attendee_id
  LEFT JOIN public.attendee_household_members hm
    ON hm.id = m.household_member_id
  LEFT JOIN auth.users au
    ON au.id = m.auth_user_id
)
SELECT
  se.*,
  CASE
    WHEN se.source_status = 'source_inconsistent'
      THEN 'source_inconsistent'::text
    WHEN se.source_status = 'ambiguous_or_conflicting'
      THEN 'ambiguous_or_conflicting'::text
    WHEN se.source_status = 'source_absent' AND se.auth_user_exists = false
      THEN 'source_and_auth_absent'::text
    WHEN se.source_status = 'source_absent' AND se.auth_user_exists = true
      THEN 'source_absent'::text
    WHEN se.source_status = 'source_eligible' AND se.auth_user_exists = false
      THEN 'auth_absent'::text
    WHEN se.source_status = 'source_eligible' AND se.auth_user_exists = true
      THEN 'eligible'::text
    ELSE 'source_inconsistent'::text
  END AS eligibility_class
FROM source_eval se;

CREATE TEMP TABLE stage1_eligible_manifest_rows ON COMMIT DROP AS
SELECT *
FROM stage1_manifest_source_status
WHERE source_status = 'source_eligible';

DO $$
DECLARE
  v_manifest_row_count bigint;
  v_eligible_row_count bigint;
  v_source_absent_row_count bigint;
  v_source_inconsistent_row_count bigint;
  v_ambiguous_or_conflicting_row_count bigint;
  v_eligible_auth_user_present_count bigint;
  v_eligible_auth_user_absent_count bigint;
BEGIN
  SELECT count(*) INTO v_manifest_row_count FROM stage1_manifest_rows;
  SELECT count(*) INTO v_eligible_row_count FROM stage1_eligible_manifest_rows;
  SELECT count(*) INTO v_source_absent_row_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class IN ('source_absent', 'source_and_auth_absent');
  SELECT count(*) INTO v_source_inconsistent_row_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class = 'source_inconsistent';
  SELECT count(*) INTO v_ambiguous_or_conflicting_row_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class = 'ambiguous_or_conflicting';
  SELECT count(*) INTO v_eligible_auth_user_present_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class = 'eligible';
  SELECT count(*) INTO v_eligible_auth_user_absent_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class = 'auth_absent';

  RAISE NOTICE 'STAGE1 manifest_row_count=%', v_manifest_row_count;
  RAISE NOTICE 'STAGE1 eligible_row_count=%', v_eligible_row_count;
  RAISE NOTICE 'STAGE1 source_absent_row_count=%', v_source_absent_row_count;
  RAISE NOTICE 'STAGE1 source_inconsistent_row_count=%', v_source_inconsistent_row_count;
  RAISE NOTICE 'STAGE1 ambiguous_or_conflicting_row_count=%', v_ambiguous_or_conflicting_row_count;
  RAISE NOTICE 'STAGE1 eligible_auth_user_present_count=%', v_eligible_auth_user_present_count;
  RAISE NOTICE 'STAGE1 eligible_auth_user_absent_count=%', v_eligible_auth_user_absent_count;

  IF v_source_inconsistent_row_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: source-inconsistent rows detected (%). See stage1_manifest_source_status.', v_source_inconsistent_row_count;
  END IF;

  IF v_ambiguous_or_conflicting_row_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: ambiguous/conflicting rows detected (%). See stage1_manifest_source_status.', v_ambiguous_or_conflicting_row_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_auth_groups ON COMMIT DROP AS
SELECT
  m.auth_user_id,
  count(*)::bigint AS manifest_role_instance_count,
  (array_agg(nullif(trim(m.display_first_name), '') ORDER BY CASE WHEN m.identity_role = 'PILOT' THEN 0 ELSE 1 END, m.role_instance_key)
    FILTER (WHERE nullif(trim(m.display_first_name), '') IS NOT NULL))[1] AS canonical_first_name,
  (array_agg(nullif(trim(m.display_last_name), '') ORDER BY CASE WHEN m.identity_role = 'PILOT' THEN 0 ELSE 1 END, m.role_instance_key)
    FILTER (WHERE nullif(trim(m.display_last_name), '') IS NOT NULL))[1] AS canonical_last_name
FROM stage1_eligible_manifest_rows m
GROUP BY m.auth_user_id;

CREATE TEMP TABLE stage1_auth_user_presence ON COMMIT DROP AS
SELECT
  g.auth_user_id,
  (au.id IS NOT NULL) AS auth_user_exists
FROM stage1_auth_groups g
LEFT JOIN auth.users au
  ON au.id = g.auth_user_id;

CREATE TEMP TABLE stage1_direct_auth_links ON COMMIT DROP AS
SELECT
  g.auth_user_id,
  paa.person_id,
  paa.status
FROM stage1_auth_groups g
JOIN public.person_auth_accounts paa
  ON paa.auth_user_id = g.auth_user_id;

CREATE TEMP TABLE stage1_pilot_attendee_people ON COMMIT DROP AS
SELECT DISTINCT
  m.auth_user_id,
  a.person_id
FROM stage1_eligible_manifest_rows m
JOIN public.attendees a
  ON a.id = m.attendee_id
WHERE m.identity_role = 'PILOT'
  AND a.person_id IS NOT NULL;

CREATE TEMP TABLE stage1_identifier_evidence ON COMMIT DROP AS
SELECT auth_user_id, role_instance_key, 'email'::text AS identifier_type, normalized_email AS normalized_value
FROM stage1_eligible_manifest_rows
WHERE normalized_email IS NOT NULL

UNION ALL

SELECT auth_user_id, role_instance_key, 'phone'::text AS identifier_type, normalized_phone AS normalized_value
FROM stage1_eligible_manifest_rows
WHERE normalized_phone IS NOT NULL

UNION ALL

SELECT auth_user_id, role_instance_key, 'membership_number'::text AS identifier_type, normalized_membership_number AS normalized_value
FROM stage1_eligible_manifest_rows
WHERE normalized_membership_number IS NOT NULL;

CREATE TEMP TABLE stage1_identifier_matches ON COMMIT DROP AS
SELECT
  ie.auth_user_id,
  ie.identifier_type,
  ie.normalized_value,
  pi.person_id
FROM stage1_identifier_evidence ie
JOIN public.person_identifiers pi
  ON pi.identifier_type = ie.identifier_type
 AND pi.normalized_value = ie.normalized_value;

CREATE TEMP TABLE stage1_identifier_value_cardinality ON COMMIT DROP AS
SELECT
  identifier_type,
  normalized_value,
  count(DISTINCT person_id)::bigint AS person_count
FROM stage1_identifier_matches
GROUP BY identifier_type, normalized_value;

CREATE TEMP TABLE stage1_identifier_unique_persons ON COMMIT DROP AS
SELECT DISTINCT
  im.auth_user_id,
  im.person_id
FROM stage1_identifier_matches im
JOIN stage1_identifier_value_cardinality vc
  ON vc.identifier_type = im.identifier_type
 AND vc.normalized_value = im.normalized_value
WHERE vc.person_count = 1;

CREATE TEMP TABLE stage1_reliable_existing_persons ON COMMIT DROP AS
SELECT auth_user_id, person_id, 'DIRECT_AUTH_ACTIVE'::text AS evidence_path
FROM stage1_direct_auth_links
WHERE status = 'active'

UNION ALL

SELECT auth_user_id, person_id, 'PILOT_ATTENDEE_PERSON_ID'::text AS evidence_path
FROM stage1_pilot_attendee_people

UNION ALL

SELECT auth_user_id, person_id, 'UNIQUE_IDENTIFIER_MATCH'::text AS evidence_path
FROM stage1_identifier_unique_persons;

DO $$
DECLARE
  v_multi_person_auth_count bigint;
  v_conflicting_direct_auth_count bigint;
BEGIN
  SELECT count(*)
  INTO v_multi_person_auth_count
  FROM (
    SELECT auth_user_id
    FROM stage1_reliable_existing_persons
    GROUP BY auth_user_id
    HAVING count(DISTINCT person_id) > 1
  ) q;

  IF v_multi_person_auth_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % auth groups resolve to multiple existing people', v_multi_person_auth_count;
  END IF;

  SELECT count(*)
  INTO v_conflicting_direct_auth_count
  FROM (
    SELECT d.auth_user_id
    FROM stage1_direct_auth_links d
    JOIN stage1_reliable_existing_persons r
      ON r.auth_user_id = d.auth_user_id
    WHERE d.status = 'active'
      AND d.person_id IS DISTINCT FROM r.person_id
    GROUP BY d.auth_user_id
  ) conflicts;

  IF v_conflicting_direct_auth_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % auth groups have direct-auth conflicting evidence', v_conflicting_direct_auth_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_group_resolution (
  auth_user_id uuid PRIMARY KEY,
  manifest_role_instance_count bigint NOT NULL,
  canonical_first_name text,
  canonical_last_name text,
  existing_person_id uuid,
  resolved_person_id uuid,
  created_person boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

CREATE TEMP TABLE stage1_unique_existing_persons ON COMMIT DROP AS
SELECT
  r.auth_user_id,
  r.person_id
FROM stage1_reliable_existing_persons r
JOIN (
  SELECT auth_user_id
  FROM stage1_reliable_existing_persons
  GROUP BY auth_user_id
  HAVING count(DISTINCT person_id) = 1
) unique_auth
  ON unique_auth.auth_user_id = r.auth_user_id
GROUP BY r.auth_user_id, r.person_id;

INSERT INTO stage1_group_resolution (
  auth_user_id,
  manifest_role_instance_count,
  canonical_first_name,
  canonical_last_name,
  existing_person_id,
  resolved_person_id
)
SELECT
  g.auth_user_id,
  g.manifest_role_instance_count,
  g.canonical_first_name,
  g.canonical_last_name,
  ep.person_id AS existing_person_id,
  ep.person_id AS resolved_person_id
FROM stage1_auth_groups g
LEFT JOIN stage1_unique_existing_persons ep
  ON ep.auth_user_id = g.auth_user_id;

DO $$
DECLARE
  v_group record;
  v_new_person_id uuid;
BEGIN
  FOR v_group IN
    SELECT
      auth_user_id,
      canonical_first_name,
      canonical_last_name
    FROM stage1_group_resolution
    WHERE existing_person_id IS NULL
    ORDER BY auth_user_id
  LOOP
    INSERT INTO public.people (
      display_first_name,
      display_last_name,
      preferred_name,
      status
    )
    VALUES (
      v_group.canonical_first_name,
      v_group.canonical_last_name,
      v_group.canonical_first_name,
      'active'::text
    )
    RETURNING id INTO v_new_person_id;

    UPDATE stage1_group_resolution
    SET resolved_person_id = v_new_person_id,
        created_person = true
    WHERE auth_user_id = v_group.auth_user_id;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_unresolved_group_count bigint;
  v_expected_new_people bigint;
  v_created_people bigint;
  v_created_name_mismatch_count bigint;
  v_shared_created_person_count bigint;
BEGIN
  SELECT count(*) INTO v_unresolved_group_count
  FROM stage1_group_resolution
  WHERE resolved_person_id IS NULL;

  IF v_unresolved_group_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: unresolved_group_count % != 0', v_unresolved_group_count;
  END IF;

  SELECT count(*) INTO v_expected_new_people
  FROM stage1_group_resolution
  WHERE existing_person_id IS NULL;

  SELECT count(*) INTO v_created_people
  FROM stage1_group_resolution
  WHERE created_person = true;

  IF v_created_people <> v_expected_new_people THEN
    RAISE EXCEPTION 'Stage1 assertion failed: created_people % != expected_new_people %', v_created_people, v_expected_new_people;
  END IF;

  SELECT count(*)
  INTO v_created_name_mismatch_count
  FROM stage1_group_resolution r
  JOIN public.people p
    ON p.id = r.resolved_person_id
  WHERE r.created_person = true
    AND (
      coalesce(p.display_first_name, '') <> coalesce(r.canonical_first_name, '')
      OR coalesce(p.display_last_name, '') <> coalesce(r.canonical_last_name, '')
    );

  IF v_created_name_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % newly created groups have people name mismatch', v_created_name_mismatch_count;
  END IF;

  SELECT count(*)
  INTO v_shared_created_person_count
  FROM (
    SELECT resolved_person_id
    FROM stage1_group_resolution
    GROUP BY resolved_person_id
    HAVING count(DISTINCT auth_user_id) > 1
       AND bool_or(created_person)
  ) shared_created;

  IF v_shared_created_person_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % newly created people are mapped to multiple auth groups', v_shared_created_person_count;
  END IF;
END
$$;

DO $$
DECLARE
  v_auth_link_conflict_count bigint;
  v_auth_link_nonactive_same_person_count bigint;
BEGIN
  SELECT count(*)
  INTO v_auth_link_conflict_count
  FROM stage1_group_resolution r
  JOIN public.person_auth_accounts paa
    ON paa.auth_user_id = r.auth_user_id
  WHERE paa.person_id <> r.resolved_person_id;

  IF v_auth_link_conflict_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % auth links already point to different people', v_auth_link_conflict_count;
  END IF;

  SELECT count(*)
  INTO v_auth_link_nonactive_same_person_count
  FROM stage1_group_resolution r
  JOIN public.person_auth_accounts paa
    ON paa.auth_user_id = r.auth_user_id
   AND paa.person_id = r.resolved_person_id
  WHERE paa.status <> 'active';

  IF v_auth_link_nonactive_same_person_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % existing auth links for resolved people are not active', v_auth_link_nonactive_same_person_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_inserted_person_auth_accounts ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO public.person_auth_accounts (
    person_id,
    auth_user_id,
    status,
    is_primary,
    linked_at,
    verified_at
  )
  SELECT
    r.resolved_person_id,
    r.auth_user_id,
    'active'::text,
    true,
    now(),
    now()
  FROM stage1_group_resolution r
  JOIN stage1_auth_user_presence aup
    ON aup.auth_user_id = r.auth_user_id
   AND aup.auth_user_exists = true
  LEFT JOIN public.person_auth_accounts paa
    ON paa.auth_user_id = r.auth_user_id
  WHERE paa.auth_user_id IS NULL
  RETURNING id, person_id, auth_user_id
)
SELECT *
FROM inserted;

CREATE TEMP TABLE stage1_identifier_candidates ON COMMIT DROP AS
SELECT
  r.resolved_person_id AS person_id,
  m.auth_user_id,
  m.identity_role,
  m.role_instance_key,
  'email'::text AS identifier_type,
  m.normalized_email AS normalized_value,
  CASE
    WHEN m.identity_role = 'PILOT' THEN 'attendee_record'::text
    ELSE 'attendee_household_member_record'::text
  END AS source_type,
  CASE
    WHEN m.identity_role = 'PILOT' THEN m.attendee_id
    ELSE m.household_member_id
  END AS source_record_id
FROM stage1_eligible_manifest_rows m
JOIN stage1_group_resolution r
  ON r.auth_user_id = m.auth_user_id
WHERE m.normalized_email IS NOT NULL

UNION

SELECT
  r.resolved_person_id AS person_id,
  m.auth_user_id,
  m.identity_role,
  m.role_instance_key,
  'phone'::text AS identifier_type,
  m.normalized_phone AS normalized_value,
  CASE
    WHEN m.identity_role = 'PILOT' THEN 'attendee_record'::text
    ELSE 'attendee_household_member_record'::text
  END AS source_type,
  CASE
    WHEN m.identity_role = 'PILOT' THEN m.attendee_id
    ELSE m.household_member_id
  END AS source_record_id
FROM stage1_eligible_manifest_rows m
JOIN stage1_group_resolution r
  ON r.auth_user_id = m.auth_user_id
WHERE m.normalized_phone IS NOT NULL

UNION

SELECT
  r.resolved_person_id AS person_id,
  m.auth_user_id,
  m.identity_role,
  m.role_instance_key,
  'membership_number'::text AS identifier_type,
  m.normalized_membership_number AS normalized_value,
  CASE
    WHEN m.identity_role = 'PILOT' THEN 'attendee_record'::text
    ELSE 'attendee_household_member_record'::text
  END AS source_type,
  CASE
    WHEN m.identity_role = 'PILOT' THEN m.attendee_id
    ELSE m.household_member_id
  END AS source_record_id
FROM stage1_eligible_manifest_rows m
JOIN stage1_group_resolution r
  ON r.auth_user_id = m.auth_user_id
WHERE m.normalized_membership_number IS NOT NULL;

DO $$
DECLARE
  v_identifier_conflict_count bigint;
BEGIN
  SELECT count(*)
  INTO v_identifier_conflict_count
  FROM stage1_identifier_candidates c
  JOIN public.person_identifiers pi
    ON pi.identifier_type = c.identifier_type
   AND pi.normalized_value = c.normalized_value
  WHERE pi.person_id <> c.person_id;

  IF v_identifier_conflict_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % identifiers already linked to a different person', v_identifier_conflict_count;
  END IF;
END
$$;

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
  c.person_id,
  c.identifier_type,
  c.normalized_value,
  c.normalized_value,
  c.source_type,
  c.source_record_id,
  'observed'::text,
  90,
  true,
  now(),
  now()
FROM stage1_identifier_candidates c
LEFT JOIN public.person_identifiers pi
  ON pi.person_id = c.person_id
 AND pi.identifier_type = c.identifier_type
 AND pi.normalized_value = c.normalized_value
 AND pi.source_type = c.source_type
 AND pi.source_record_id = c.source_record_id
WHERE pi.id IS NULL
  AND c.normalized_value IS NOT NULL
  AND trim(c.normalized_value) <> '';

DO $$
DECLARE
  v_role_key_conflict_count bigint;
BEGIN
  SELECT count(*)
  INTO v_role_key_conflict_count
  FROM stage1_eligible_manifest_rows m
  JOIN stage1_group_resolution r
    ON r.auth_user_id = m.auth_user_id
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key
  WHERE pri.person_id <> r.resolved_person_id;

  IF v_role_key_conflict_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: % source role instance keys are already linked to a different person', v_role_key_conflict_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_inserted_role_instances ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO public.person_role_instances (
    person_id,
    event_id,
    attendee_id,
    identity_role,
    household_member_id,
    source_table,
    source_record_id,
    attribution_method,
    evidence_source,
    source_manifest_version,
    source_role_instance_key,
    attributed_at
  )
  SELECT
    r.resolved_person_id,
    m.event_id,
    m.attendee_id,
    m.identity_role,
    m.household_member_id,
    CASE
      WHEN m.identity_role = 'PILOT' THEN 'public.attendees'
      ELSE 'public.attendee_household_members'
    END AS source_table,
    CASE
      WHEN m.identity_role = 'PILOT' THEN m.attendee_id
      ELSE m.household_member_id
    END AS source_record_id,
    'automatic_backfill'::text,
    '20260726_person_identity_automatic_backfill_manifest.sql'::text,
    m.manifest_version,
    m.role_instance_key,
    now()
  FROM stage1_eligible_manifest_rows m
  JOIN stage1_group_resolution r
    ON r.auth_user_id = m.auth_user_id
  ON CONFLICT (source_role_instance_key) DO NOTHING
  RETURNING id, person_id, source_role_instance_key
)
SELECT *
FROM inserted;

DO $$
DECLARE
  v_active_auth_link_count bigint;
  v_manifest_auth_group_count bigint;
  v_present_auth_user_count bigint;
  v_missing_auth_user_count bigint;
  v_expected_role_instance_count bigint;
  v_expected_resolved_people_count bigint;
  v_linked_role_instance_count bigint;
  v_linked_role_distinct_people bigint;
  v_missing_role_links bigint;
  v_auth_groups_not_single_person bigint;
  v_role_instances_multi_people bigint;
  v_role_vs_auth_person_mismatch_count bigint;
  v_role_event_mismatch_count bigint;
  v_role_attendee_mismatch_count bigint;
  v_role_household_mismatch_count bigint;
  v_created_person_name_mismatch_count bigint;
BEGIN
  SELECT count(*)
  INTO v_active_auth_link_count
  FROM public.person_auth_accounts paa
  JOIN stage1_group_resolution r
    ON r.auth_user_id = paa.auth_user_id
  WHERE paa.status = 'active'
    AND paa.person_id = r.resolved_person_id;

  SELECT count(DISTINCT auth_user_id)
  INTO v_manifest_auth_group_count
  FROM stage1_eligible_manifest_rows;

  SELECT count(*)
  INTO v_present_auth_user_count
  FROM stage1_auth_user_presence
  WHERE auth_user_exists = true;

  SELECT count(*)
  INTO v_missing_auth_user_count
  FROM stage1_auth_user_presence
  WHERE auth_user_exists = false;

  SELECT count(*)
  INTO v_expected_role_instance_count
  FROM stage1_eligible_manifest_rows;

  SELECT count(DISTINCT resolved_person_id)
  INTO v_expected_resolved_people_count
  FROM stage1_group_resolution;

  SELECT count(*)
  INTO v_linked_role_instance_count
  FROM stage1_eligible_manifest_rows m
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key;

  SELECT count(DISTINCT pri.person_id)
  INTO v_linked_role_distinct_people
  FROM stage1_eligible_manifest_rows m
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key;

  SELECT count(*)
  INTO v_missing_role_links
  FROM stage1_eligible_manifest_rows m
  LEFT JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key
  WHERE pri.id IS NULL;

  SELECT count(*)
  INTO v_auth_groups_not_single_person
  FROM (
    SELECT m.auth_user_id
    FROM stage1_eligible_manifest_rows m
    JOIN public.person_role_instances pri
      ON pri.source_role_instance_key = m.role_instance_key
    GROUP BY m.auth_user_id
    HAVING count(DISTINCT pri.person_id) <> 1
  ) q;

  SELECT count(*)
  INTO v_role_instances_multi_people
  FROM (
    SELECT source_role_instance_key
    FROM public.person_role_instances
    GROUP BY source_role_instance_key
    HAVING count(DISTINCT person_id) > 1
  ) q;

  SELECT count(*)
  INTO v_role_vs_auth_person_mismatch_count
  FROM stage1_eligible_manifest_rows m
  JOIN stage1_group_resolution r
    ON r.auth_user_id = m.auth_user_id
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key
  LEFT JOIN public.person_auth_accounts paa
    ON paa.auth_user_id = m.auth_user_id
   AND paa.status = 'active'
  WHERE paa.person_id IS NULL
     OR pri.person_id <> paa.person_id;

  SELECT count(*)
  INTO v_role_event_mismatch_count
  FROM stage1_eligible_manifest_rows m
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key
  WHERE pri.event_id IS DISTINCT FROM m.event_id;

  SELECT count(*)
  INTO v_role_attendee_mismatch_count
  FROM stage1_eligible_manifest_rows m
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key
  WHERE pri.attendee_id IS DISTINCT FROM m.attendee_id;

  SELECT count(*)
  INTO v_role_household_mismatch_count
  FROM stage1_eligible_manifest_rows m
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = m.role_instance_key
  WHERE pri.household_member_id IS DISTINCT FROM m.household_member_id;

  SELECT count(*)
  INTO v_created_person_name_mismatch_count
  FROM stage1_group_resolution r
  JOIN public.people p
    ON p.id = r.resolved_person_id
  WHERE r.created_person = true
    AND (
      coalesce(p.display_first_name, '') <> coalesce(r.canonical_first_name, '')
      OR coalesce(p.display_last_name, '') <> coalesce(r.canonical_last_name, '')
    );

  IF (v_present_auth_user_count + v_missing_auth_user_count) <> v_manifest_auth_group_count THEN
    RAISE EXCEPTION 'Stage1 assertion failed: present_auth_user_count % + missing_auth_user_count % != manifest_auth_group_count %',
      v_present_auth_user_count, v_missing_auth_user_count, v_manifest_auth_group_count;
  END IF;
  IF v_active_auth_link_count <> v_present_auth_user_count THEN
    RAISE EXCEPTION 'Stage1 assertion failed: active auth links % != present auth users %',
      v_active_auth_link_count, v_present_auth_user_count;
  END IF;
  IF v_linked_role_instance_count <> v_expected_role_instance_count THEN
    RAISE EXCEPTION 'Stage1 assertion failed: linked role instances % != expected eligible role instances %', v_linked_role_instance_count, v_expected_role_instance_count;
  END IF;
  IF v_linked_role_distinct_people <> v_expected_resolved_people_count THEN
    RAISE EXCEPTION 'Stage1 assertion failed: linked role distinct people % != expected resolved people %', v_linked_role_distinct_people, v_expected_resolved_people_count;
  END IF;
  IF v_missing_role_links <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: missing role links % != 0', v_missing_role_links;
  END IF;
  IF v_auth_groups_not_single_person <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: auth groups not resolving to exactly one person % != 0', v_auth_groups_not_single_person;
  END IF;
  IF v_role_instances_multi_people <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: role instances linked to multiple people % != 0', v_role_instances_multi_people;
  END IF;
  IF v_role_vs_auth_person_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: role-instance person_id vs active auth-link person_id mismatches % != 0', v_role_vs_auth_person_mismatch_count;
  END IF;
  IF v_role_event_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: role-instance event relationship mismatches % != 0', v_role_event_mismatch_count;
  END IF;
  IF v_role_attendee_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: role-instance attendee relationship mismatches % != 0', v_role_attendee_mismatch_count;
  END IF;
  IF v_role_household_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: role-instance household relationship mismatches % != 0', v_role_household_mismatch_count;
  END IF;
  IF v_created_person_name_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: created person name mismatches % != 0', v_created_person_name_mismatch_count;
  END IF;
END
$$;

SELECT
  r.auth_user_id,
  r.resolved_person_id,
  r.created_person,
  r.manifest_role_instance_count,
  r.canonical_first_name,
  r.canonical_last_name
FROM stage1_group_resolution r
ORDER BY r.auth_user_id;

SELECT
  m.manifest_version,
  m.auth_user_id,
  r.resolved_person_id,
  m.role_instance_key,
  m.event_id,
  m.identity_role,
  m.eligibility_class AS unresolved_reason
FROM stage1_manifest_source_status m
JOIN stage1_group_resolution r
  ON r.auth_user_id = m.auth_user_id
LEFT JOIN public.person_auth_accounts paa
  ON paa.auth_user_id = m.auth_user_id
 AND paa.person_id = r.resolved_person_id
 AND paa.status = 'active'
WHERE m.eligibility_class = 'auth_absent'
  AND paa.id IS NULL
ORDER BY m.auth_user_id, m.role_instance_key;

DO $$
DECLARE
  v_manifest_row_count bigint;
  v_eligible_row_count bigint;
  v_source_absent_row_count bigint;
  v_source_inconsistent_row_count bigint;
  v_eligible_auth_user_present_count bigint;
  v_eligible_auth_user_absent_count bigint;
  v_people_resolved_or_created_count bigint;
  v_role_instances_inserted_count bigint;
  v_auth_accounts_inserted_count bigint;
BEGIN
  SELECT count(*) INTO v_manifest_row_count FROM stage1_manifest_rows;
  SELECT count(*) INTO v_eligible_row_count FROM stage1_eligible_manifest_rows;
  SELECT count(*) INTO v_source_absent_row_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class IN ('source_absent', 'source_and_auth_absent');
  SELECT count(*) INTO v_source_inconsistent_row_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class = 'source_inconsistent';
  SELECT count(*) INTO v_eligible_auth_user_present_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class = 'eligible';
  SELECT count(*) INTO v_eligible_auth_user_absent_count
  FROM stage1_manifest_source_status
  WHERE eligibility_class = 'auth_absent';
  SELECT count(*) INTO v_people_resolved_or_created_count
  FROM stage1_group_resolution;
  SELECT count(*) INTO v_role_instances_inserted_count
  FROM stage1_inserted_role_instances;
  SELECT count(*) INTO v_auth_accounts_inserted_count
  FROM stage1_inserted_person_auth_accounts;

  RAISE NOTICE 'STAGE1 diagnostics manifest_row_count=%', v_manifest_row_count;
  RAISE NOTICE 'STAGE1 diagnostics eligible_row_count=%', v_eligible_row_count;
  RAISE NOTICE 'STAGE1 diagnostics source_absent_row_count=%', v_source_absent_row_count;
  RAISE NOTICE 'STAGE1 diagnostics source_inconsistent_row_count=%', v_source_inconsistent_row_count;
  RAISE NOTICE 'STAGE1 diagnostics eligible_auth_user_present_count=%', v_eligible_auth_user_present_count;
  RAISE NOTICE 'STAGE1 diagnostics eligible_auth_user_absent_count=%', v_eligible_auth_user_absent_count;
  RAISE NOTICE 'STAGE1 diagnostics people_resolved_or_created_count=%', v_people_resolved_or_created_count;
  RAISE NOTICE 'STAGE1 diagnostics role_instances_inserted_count=%', v_role_instances_inserted_count;
  RAISE NOTICE 'STAGE1 diagnostics auth_accounts_inserted_count=%', v_auth_accounts_inserted_count;
END
$$;

SELECT
  (SELECT count(*) FROM stage1_manifest_rows) AS manifest_role_instance_rows,
  (SELECT count(*) FROM stage1_eligible_manifest_rows) AS eligible_source_role_rows,
  (SELECT count(*) FROM stage1_manifest_source_status WHERE eligibility_class = 'source_absent') AS source_absent_rows,
  (SELECT count(*) FROM stage1_manifest_source_status WHERE eligibility_class = 'source_and_auth_absent') AS source_and_auth_absent_rows,
  (SELECT count(*) FROM stage1_manifest_source_status WHERE eligibility_class = 'source_inconsistent') AS source_inconsistent_rows,
  (SELECT count(*) FROM stage1_manifest_source_status WHERE eligibility_class = 'ambiguous_or_conflicting') AS ambiguous_or_conflicting_rows,
  (SELECT count(DISTINCT auth_user_id) FROM stage1_eligible_manifest_rows) AS eligible_auth_groups,
  (SELECT count(*) FROM stage1_auth_user_presence WHERE auth_user_exists = true) AS present_auth_users,
  (SELECT count(*) FROM stage1_auth_user_presence WHERE auth_user_exists = false) AS missing_auth_users,
  (SELECT count(*) FROM stage1_manifest_source_status WHERE eligibility_class = 'eligible') AS eligible_auth_users_present,
  (SELECT count(*) FROM stage1_manifest_source_status WHERE eligibility_class = 'auth_absent') AS eligible_auth_users_absent,
  (SELECT count(*) FROM stage1_group_resolution r JOIN stage1_auth_user_presence aup ON aup.auth_user_id = r.auth_user_id WHERE aup.auth_user_exists = false) AS unresolved_auth_link_candidates,
  (SELECT count(*) FROM stage1_group_resolution WHERE created_person = true) AS new_people_created,
  (SELECT count(*) FROM stage1_group_resolution) AS people_resolved_or_created,
  (SELECT count(*) FROM public.person_auth_accounts paa JOIN stage1_group_resolution r ON r.auth_user_id = paa.auth_user_id WHERE paa.status = 'active' AND paa.person_id = r.resolved_person_id) AS active_auth_links,
  (SELECT count(*) FROM stage1_inserted_person_auth_accounts) AS inserted_auth_accounts,
  (SELECT count(*) FROM public.person_auth_accounts paa JOIN stage1_auth_user_presence aup ON aup.auth_user_id = paa.auth_user_id WHERE aup.auth_user_exists = false) AS invalid_links_to_missing_auth_users,
  (SELECT count(*) FROM stage1_eligible_manifest_rows m JOIN public.person_role_instances pri ON pri.source_role_instance_key = m.role_instance_key) AS role_instance_links,
  (SELECT count(*) FROM stage1_inserted_role_instances) AS inserted_role_instances,
  (SELECT count(DISTINCT pri.person_id) FROM stage1_eligible_manifest_rows m JOIN public.person_role_instances pri ON pri.source_role_instance_key = m.role_instance_key) AS resolved_people,
  CASE
    WHEN (SELECT count(*) FROM stage1_manifest_source_status WHERE eligibility_class IN ('source_inconsistent', 'ambiguous_or_conflicting')) > 0
      THEN 'STAGE_1_ABORT_REQUIRED_SOURCE_CONFLICT'::text
    WHEN (SELECT count(*) FROM stage1_auth_user_presence WHERE auth_user_exists = false) > 0
      THEN 'STAGE_1_COMPLETE_WITH_UNRESOLVED_AUTH_USERS'::text
    ELSE 'STAGE_1_COMPLETE'::text
  END AS validation_status;

COMMIT;
