/*
Stage 1 identity backfill migration.

Scope:
- Creates public.people rows only from frozen manifest membership.
- Does not create person_identifiers.
- Does not create person_auth_accounts.
- Does not update attendees.
- Does not rerun identity classification.

Safety:
- Uses explicit immutable manifest rows for version 20260726_v1.
- Groups only by frozen proposed_person_key.
- Fails on any blocked group or invariant violation.
*/

CREATE TEMP TABLE stage1_manifest_rows (
  manifest_version text NOT NULL,
  role_instance_key text NOT NULL,
  attendee_id uuid NOT NULL,
  identity_role text NOT NULL,
  household_member_id uuid,
  auth_user_id uuid NOT NULL,
  proposed_person_key text NOT NULL,
  current_person_id uuid,
  display_first_name text,
  display_last_name text,
  normalized_first_name text,
  normalized_last_name text,
  membership_number text,
  normalized_membership_number text,
  review_status text NOT NULL,
  competing_claim_count integer NOT NULL,
  identifier_conflict_count integer NOT NULL
) ON COMMIT DROP;

INSERT INTO stage1_manifest_rows (
  manifest_version,
  role_instance_key,
  attendee_id,
  identity_role,
  household_member_id,
  auth_user_id,
  proposed_person_key,
  current_person_id,
  display_first_name,
  display_last_name,
  normalized_first_name,
  normalized_last_name,
  membership_number,
  normalized_membership_number,
  review_status,
  competing_claim_count,
  identifier_conflict_count
)
VALUES
  ('20260726_v1', 'attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460062', 'F460062', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460061', 'F460061', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'Steve', 'Jeanneret', 'steve', 'jeanneret', 'P123456', 'P123456', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460062', 'F460062', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'Steve', 'Jeanneret', 'steve', 'jeanneret', 'F703086', 'F703086', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, 'PILOT', NULL, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', NULL, 'Steve', 'Batorson', 'steve', 'batorson', NULL, NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, 'PILOT', NULL, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'auth:3ec28672-57c1-4904-854b-efba23210c1d', NULL, 'Bud', 'Vogt', 'bud', 'vogt', NULL, NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460062', 'F460062', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:08374616-3cd4-433e-a761-838f2fa28848', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, 'HOUSEHOLD_MEMBER', '08374616-3cd4-433e-a761-838f2fa28848'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', NULL, 'Steve', 'Batorson', 'steve', 'batorson', NULL, NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:2f482686-cb88-41b1-82d2-6b15731ef577', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, 'HOUSEHOLD_MEMBER', '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'Steve', 'Jeanneret', 'steve', 'jeanneret', 'F703086', 'F703086', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, 'HOUSEHOLD_MEMBER', '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', NULL, 'Steve', 'Jeanneret', 'steve', 'jeanneret', 'P123456', 'P123456', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, 'HOUSEHOLD_MEMBER', '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460062', 'F460062', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, 'HOUSEHOLD_MEMBER', '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460062', 'F460062', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, 'HOUSEHOLD_MEMBER', '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460062', 'F460062', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, 'HOUSEHOLD_MEMBER', '9ec93e24-94f8-4faa-a2b5-1eab8629fefc'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'auth:3ec28672-57c1-4904-854b-efba23210c1d', NULL, 'Bud', 'Vogt', 'bud', 'vogt', NULL, NULL, 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, 'HOUSEHOLD_MEMBER', 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid, '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'auth:4180a4b6-334f-4daf-8111-ad2721b0c75e', NULL, 'Janine', 'Rowe', 'janine', 'rowe', 'F460062', 'F460062', 'VALIDATED_FOR_BACKFILL', 0, 0),
  ('20260726_v1', 'household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, 'HOUSEHOLD_MEMBER', 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', NULL, 'Steven', 'Bertling', 'steven', 'bertling', 'F460061', 'F460061', 'VALIDATED_FOR_BACKFILL', 0, 0)
;

CREATE TEMP TABLE stage1_group_plan ON COMMIT DROP AS
WITH grouped AS (
  SELECT
    m.manifest_version,
    m.proposed_person_key,
    count(*)::bigint AS manifest_role_instance_count,
    count(DISTINCT m.role_instance_key)::bigint AS distinct_role_instance_key_count,
    count(DISTINCT m.current_person_id) FILTER (WHERE m.current_person_id IS NOT NULL)::bigint AS distinct_current_person_count,
    (array_agg(DISTINCT m.current_person_id) FILTER (WHERE m.current_person_id IS NOT NULL))[1] AS resolved_existing_person_id_from_manifest,
    count(DISTINCT lower(trim(m.display_first_name))) FILTER (WHERE nullif(trim(m.display_first_name), '') IS NOT NULL)::bigint AS distinct_nonblank_first_name_count,
    count(DISTINCT lower(trim(m.display_last_name))) FILTER (WHERE nullif(trim(m.display_last_name), '') IS NOT NULL)::bigint AS distinct_nonblank_last_name_count,
    (array_agg(nullif(trim(m.display_first_name), '') ORDER BY CASE WHEN m.identity_role = 'PILOT' THEN 0 ELSE 1 END, m.role_instance_key)
      FILTER (WHERE nullif(trim(m.display_first_name), '') IS NOT NULL))[1] AS canonical_first_name,
    (array_agg(nullif(trim(m.display_last_name), '') ORDER BY CASE WHEN m.identity_role = 'PILOT' THEN 0 ELSE 1 END, m.role_instance_key)
      FILTER (WHERE nullif(trim(m.display_last_name), '') IS NOT NULL))[1] AS canonical_last_name
  FROM stage1_manifest_rows m
  GROUP BY m.manifest_version, m.proposed_person_key
),
deterministic_ids AS (
  SELECT
    g.*,
    (
      substr(md5(g.manifest_version || '|' || g.proposed_person_key), 1, 8) || '-' ||
      substr(md5(g.manifest_version || '|' || g.proposed_person_key), 9, 4) || '-' ||
      substr(md5(g.manifest_version || '|' || g.proposed_person_key), 13, 4) || '-' ||
      substr(md5(g.manifest_version || '|' || g.proposed_person_key), 17, 4) || '-' ||
      substr(md5(g.manifest_version || '|' || g.proposed_person_key), 21, 12)
    )::uuid AS proposed_new_person_id
  FROM grouped g
),
with_existing AS (
  SELECT
    d.*,
    p.id AS deterministic_existing_person_id
  FROM deterministic_ids d
  LEFT JOIN public.people p
    ON p.id = d.proposed_new_person_id
),
planned AS (
  SELECT
    w.manifest_version,
    w.proposed_person_key,
    w.manifest_role_instance_count,
    w.distinct_role_instance_key_count,
    w.distinct_current_person_count,
    CASE
      WHEN w.distinct_current_person_count = 1 THEN w.resolved_existing_person_id_from_manifest
      WHEN w.distinct_current_person_count = 0 THEN w.deterministic_existing_person_id
      ELSE NULL
    END AS resolved_existing_person_id,
    w.proposed_new_person_id,
    w.canonical_first_name,
    w.canonical_last_name,
    CASE
      WHEN w.proposed_person_key IS NULL OR trim(w.proposed_person_key) = '' THEN 'MISSING_PROPOSED_PERSON_KEY'
      WHEN w.distinct_role_instance_key_count <> w.manifest_role_instance_count THEN 'DUPLICATE_ROLE_INSTANCE_KEYS_IN_GROUP'
      WHEN w.distinct_current_person_count > 1 THEN 'MULTIPLE_EXISTING_PERSON_IDS_IN_GROUP'
      WHEN w.distinct_current_person_count = 1
           AND w.deterministic_existing_person_id IS NOT NULL
           AND w.resolved_existing_person_id_from_manifest <> w.deterministic_existing_person_id
      THEN 'MANIFEST_EXISTING_PERSON_ID_CONFLICTS_WITH_DETERMINISTIC_MAPPING'
      WHEN w.distinct_current_person_count = 0
           AND (w.distinct_nonblank_first_name_count > 1 OR w.distinct_nonblank_last_name_count > 1)
      THEN 'CONFLICTING_CANONICAL_NAMES_WITHOUT_EXISTING_PERSON'
      ELSE NULL
    END AS blocking_reason
  FROM with_existing w
)
SELECT
  p.manifest_version,
  p.proposed_person_key,
  p.manifest_role_instance_count,
  p.resolved_existing_person_id,
  p.proposed_new_person_id,
  CASE
    WHEN p.blocking_reason IS NOT NULL THEN 'BLOCKED_REVIEW_REQUIRED'
    WHEN p.resolved_existing_person_id IS NOT NULL THEN 'USE_EXISTING_PERSON'
    ELSE 'CREATE_NEW_PERSON'
  END AS action,
  p.canonical_first_name,
  p.canonical_last_name,
  p.blocking_reason,
  array_remove(ARRAY[p.resolved_existing_person_id, p.proposed_new_person_id]::uuid[], NULL) AS existing_person_ids_found
FROM planned p;

DO $$
DECLARE
  v_manifest_row_count bigint;
  v_distinct_role_instance_key_count bigint;
  v_duplicate_role_instance_key_count bigint;
  v_invalid_review_status_rows bigint;
  v_competing_claim_total bigint;
  v_identifier_conflict_total bigint;
  v_distinct_proposed_person_groups bigint;
  v_blocked_group_count bigint;
BEGIN
  SELECT count(*) INTO v_manifest_row_count FROM stage1_manifest_rows;
  SELECT count(DISTINCT role_instance_key) INTO v_distinct_role_instance_key_count FROM stage1_manifest_rows;
  v_duplicate_role_instance_key_count := v_manifest_row_count - v_distinct_role_instance_key_count;

  SELECT count(*)
  INTO v_invalid_review_status_rows
  FROM stage1_manifest_rows
  WHERE manifest_version <> '20260726_v1'
     OR review_status <> 'VALIDATED_FOR_BACKFILL';

  SELECT coalesce(sum(competing_claim_count), 0), coalesce(sum(identifier_conflict_count), 0)
  INTO v_competing_claim_total, v_identifier_conflict_total
  FROM stage1_manifest_rows;

  SELECT count(*), count(*) FILTER (WHERE action = 'BLOCKED_REVIEW_REQUIRED')
  INTO v_distinct_proposed_person_groups, v_blocked_group_count
  FROM stage1_group_plan;

  IF v_manifest_row_count <> 17 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: manifest_row_count % != 17', v_manifest_row_count;
  END IF;
  IF v_distinct_role_instance_key_count <> 17 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: distinct_role_instance_key_count % != 17', v_distinct_role_instance_key_count;
  END IF;
  IF v_duplicate_role_instance_key_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: duplicate_role_instance_key_count % != 0', v_duplicate_role_instance_key_count;
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
  IF v_distinct_proposed_person_groups <= 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: distinct_proposed_person_groups % <= 0', v_distinct_proposed_person_groups;
  END IF;
  IF v_blocked_group_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: blocked_group_count % != 0', v_blocked_group_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_inserted_people (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO public.people (
    id,
    display_first_name,
    display_last_name,
    preferred_name,
    status
  )
  SELECT
    gp.proposed_new_person_id AS id,
    gp.canonical_first_name AS display_first_name,
    gp.canonical_last_name AS display_last_name,
    gp.canonical_first_name AS preferred_name,
    'active'::text AS status
  FROM stage1_group_plan gp
  WHERE gp.action = 'CREATE_NEW_PERSON'
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO stage1_inserted_people (id)
SELECT id
FROM inserted;

DO $$
DECLARE
  v_create_new_group_count bigint;
  v_inserted_person_count bigint;
BEGIN
  SELECT count(*) INTO v_create_new_group_count
  FROM stage1_group_plan
  WHERE action = 'CREATE_NEW_PERSON';

  SELECT count(*) INTO v_inserted_person_count
  FROM stage1_inserted_people;

  IF v_inserted_person_count <> v_create_new_group_count THEN
    RAISE EXCEPTION 'Stage1 assertion failed: inserted_person_count % != create_new_group_count %',
      v_inserted_person_count, v_create_new_group_count;
  END IF;
END
$$;

CREATE TEMP TABLE stage1_group_verification ON COMMIT DROP AS
SELECT
  gp.manifest_version,
  gp.proposed_person_key,
  gp.action,
  CASE
    WHEN gp.action = 'USE_EXISTING_PERSON' THEN gp.resolved_existing_person_id
    WHEN gp.action = 'CREATE_NEW_PERSON' THEN gp.proposed_new_person_id
    ELSE NULL::uuid
  END AS person_id,
  CASE
    WHEN gp.action = 'CREATE_NEW_PERSON' AND ip.id IS NOT NULL THEN TRUE
    ELSE FALSE
  END AS person_created,
  gp.canonical_first_name,
  gp.canonical_last_name,
  gp.manifest_role_instance_count,
  CASE
    WHEN gp.action = 'BLOCKED_REVIEW_REQUIRED' THEN 'BLOCKED'
    WHEN gp.action IN ('USE_EXISTING_PERSON', 'CREATE_NEW_PERSON') THEN 'RESOLVED'
    ELSE 'UNRESOLVED'
  END AS validation_status,
  gp.blocking_reason
FROM stage1_group_plan gp
LEFT JOIN stage1_inserted_people ip
  ON ip.id = gp.proposed_new_person_id;

DO $$
DECLARE
  v_unresolved_group_count bigint;
  v_groups_with_multiple_people bigint;
BEGIN
  SELECT count(*)
  INTO v_unresolved_group_count
  FROM stage1_group_verification
  WHERE person_id IS NULL;

  SELECT count(*)
  INTO v_groups_with_multiple_people
  FROM (
    SELECT proposed_person_key
    FROM stage1_group_verification
    GROUP BY proposed_person_key
    HAVING count(DISTINCT person_id) > 1
  ) q;

  IF v_unresolved_group_count <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: unresolved_group_count % != 0', v_unresolved_group_count;
  END IF;
  IF v_groups_with_multiple_people <> 0 THEN
    RAISE EXCEPTION 'Stage1 assertion failed: groups_with_multiple_people % != 0', v_groups_with_multiple_people;
  END IF;
END
$$;

-- Required verification output: one row per proposed person group.
SELECT
  manifest_version,
  proposed_person_key,
  action,
  person_id,
  person_created,
  canonical_first_name,
  canonical_last_name,
  manifest_role_instance_count,
  validation_status
FROM stage1_group_verification
ORDER BY proposed_person_key;

-- Required verification summary.
SELECT
  (SELECT count(*) FROM stage1_manifest_rows) AS manifest_role_instance_rows,
  (SELECT count(*) FROM stage1_group_plan) AS distinct_proposed_person_groups,
  (SELECT count(*) FROM stage1_group_plan WHERE action = 'USE_EXISTING_PERSON') AS existing_people_reused,
  (SELECT count(*) FROM stage1_inserted_people) AS new_people_created,
  (SELECT count(*) FROM stage1_group_plan WHERE action = 'BLOCKED_REVIEW_REQUIRED') AS blocked_groups,
  (SELECT count(*) FROM stage1_group_verification WHERE person_id IS NULL) AS unresolved_groups,
  (
    SELECT count(*)
    FROM (
      SELECT person_id
      FROM stage1_group_verification
      GROUP BY person_id
      HAVING person_id IS NOT NULL AND count(*) > 1
    ) dup
  ) AS duplicate_resolved_person_mappings,
  CASE
    WHEN (SELECT count(*) FROM stage1_manifest_rows) = 17
     AND (SELECT count(*) FROM stage1_group_plan) > 0
     AND (SELECT count(*) FROM stage1_group_plan WHERE action = 'BLOCKED_REVIEW_REQUIRED') = 0
     AND (SELECT count(*) FROM stage1_group_verification WHERE person_id IS NULL) = 0
     AND (
       SELECT count(*)
       FROM (
         SELECT person_id
         FROM stage1_group_verification
         GROUP BY person_id
         HAVING person_id IS NOT NULL AND count(*) > 1
       ) dup
     ) = 0
    THEN 'STAGE_1_COMPLETE'
    ELSE 'STAGE_1_VALIDATION_FAILED'
  END AS validation_status;
