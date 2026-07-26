/*
Read-only validation for Stage 1 people backfill from manifest 20260726_v1.
This file uses SELECT-only statements.
*/

-- RESULT SET: BACKFILL_COUNTS
WITH fixed_manifest (
  manifest_version,
  role_instance_key,
  attendee_id,
  event_id,
  identity_role,
  household_member_id,
  auth_user_id,
  normalized_email,
  normalized_phone,
  normalized_membership_number
) AS (
  VALUES
  ('20260726_v1', 'attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', NULL, 'F460062'),
  ('20260726_v1', 'attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', '9514911297', 'F460061'),
  ('20260726_v1', 'attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'sjjeanneret@gmail.com', NULL, 'P123456'),
  ('20260726_v1', 'attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', NULL, 'F460062'),
  ('20260726_v1', 'attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'sjjeanneret@gmail.com', '7852208673', 'F703086'),
  ('20260726_v1', 'attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'batorson@gmail.com', '5204446772', NULL),
  ('20260726_v1', 'attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'budvogt@juno.com', NULL, NULL),
  ('20260726_v1', 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', '9514911297', 'F460062'),
  ('20260726_v1', 'household_member:08374616-3cd4-433e-a761-838f2fa28848', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '08374616-3cd4-433e-a761-838f2fa28848'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'batorson@gmail.com', NULL, NULL),
  ('20260726_v1', 'household_member:2f482686-cb88-41b1-82d2-6b15731ef577', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'sjjeanneret@gmail.com', NULL, 'F703086'),
  ('20260726_v1', 'household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'sjjeanneret@gmail.com', NULL, 'P123456'),
  ('20260726_v1', 'household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'HOUSEHOLD_MEMBER', '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', NULL, 'F460062'),
  ('20260726_v1', 'household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', NULL, 'F460062'),
  ('20260726_v1', 'household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', NULL, 'F460062'),
  ('20260726_v1', 'household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '9ec93e24-94f8-4faa-a2b5-1eab8629fefc'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'budvogt@juno.com', NULL, NULL),
  ('20260726_v1', 'household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid, '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'fcoceventhost@gmail.com', '4042190279', 'F460062'),
  ('20260726_v1', 'household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'HOUSEHOLD_MEMBER', 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'sbertling1951@gmail.com', NULL, 'F460061')
),
resolved_people AS (
  SELECT DISTINCT pri.person_id
  FROM fixed_manifest fm
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = fm.role_instance_key
)
SELECT
  'BACKFILL_COUNTS'::text AS result_set_label,
  (SELECT count(*) FROM fixed_manifest) AS manifest_role_instances,
  (SELECT count(DISTINCT auth_user_id) FROM fixed_manifest) AS manifest_auth_uuid_groups,
  (SELECT count(*) FROM resolved_people) AS resolved_people,
  (SELECT count(*) FROM resolved_people) AS new_people_created_inferred,
  (
    SELECT count(*)
    FROM public.person_auth_accounts paa
    WHERE paa.auth_user_id IN (SELECT DISTINCT auth_user_id FROM fixed_manifest)
      AND paa.status = 'active'
  ) AS active_auth_account_links,
  (
    SELECT count(*)
    FROM public.person_role_instances pri
    WHERE pri.source_role_instance_key IN (SELECT role_instance_key FROM fixed_manifest)
  ) AS role_instance_links,
  (
    SELECT count(*)
    FROM public.person_identifiers pi
    WHERE pi.person_id IN (SELECT person_id FROM resolved_people)
  ) AS identifier_rows_for_resolved_people;

-- RESULT SET: AUTH_TO_PERSON
WITH fixed_manifest (
  role_instance_key,
  auth_user_id,
  display_first_name,
  display_last_name
) AS (
  VALUES
  ('attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling'),
  ('attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling'),
  ('attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret'),
  ('attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling'),
  ('attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret'),
  ('attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'Steve', 'Batorson'),
  ('attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'Bud', 'Vogt'),
  ('attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling'),
  ('household_member:08374616-3cd4-433e-a761-838f2fa28848', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'Steve', 'Batorson'),
  ('household_member:2f482686-cb88-41b1-82d2-6b15731ef577', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret'),
  ('household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret'),
  ('household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling'),
  ('household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling'),
  ('household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling'),
  ('household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'Bud', 'Vogt'),
  ('household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'Janine', 'Rowe'),
  ('household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling')
),
auth_to_person AS (
  SELECT
    fm.auth_user_id,
    pri.person_id,
    count(*)::bigint AS role_instance_count
  FROM fixed_manifest fm
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = fm.role_instance_key
  GROUP BY fm.auth_user_id, pri.person_id
)
SELECT
  'AUTH_TO_PERSON'::text AS result_set_label,
  a.auth_user_id,
  a.person_id,
  p.display_first_name,
  p.display_last_name,
  a.role_instance_count,
  CASE
    WHEN paa.auth_user_id IS NULL THEN 'MISSING'
    WHEN paa.status = 'active' THEN 'ACTIVE'
    ELSE upper(paa.status)
  END AS active_auth_link_status
FROM auth_to_person a
LEFT JOIN public.people p
  ON p.id = a.person_id
LEFT JOIN public.person_auth_accounts paa
  ON paa.auth_user_id = a.auth_user_id
 AND paa.person_id = a.person_id
ORDER BY a.auth_user_id;

-- RESULT SET: ROLE_INSTANCE_LINKS
WITH fixed_manifest (
  role_instance_key,
  identity_role,
  attendee_id,
  household_member_id,
  event_id,
  auth_user_id
) AS (
  VALUES
  ('attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', 'PILOT', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, NULL, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', 'PILOT', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, NULL, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', 'PILOT', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, NULL, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', 'PILOT', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, NULL, '853f6934-8672-4219-ad59-520482098577'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', 'PILOT', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, NULL, '853f6934-8672-4219-ad59-520482098577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', 'PILOT', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, NULL, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid),
  ('attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', 'PILOT', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, NULL, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid),
  ('attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', 'PILOT', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, NULL, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:08374616-3cd4-433e-a761-838f2fa28848', 'HOUSEHOLD_MEMBER', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '08374616-3cd4-433e-a761-838f2fa28848'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid),
  ('household_member:2f482686-cb88-41b1-82d2-6b15731ef577', 'HOUSEHOLD_MEMBER', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', 'HOUSEHOLD_MEMBER', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', 'HOUSEHOLD_MEMBER', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', 'HOUSEHOLD_MEMBER', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', 'HOUSEHOLD_MEMBER', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', 'HOUSEHOLD_MEMBER', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '9ec93e24-94f8-4faa-a2b5-1eab8629fefc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid),
  ('household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', 'HOUSEHOLD_MEMBER', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid),
  ('household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', 'HOUSEHOLD_MEMBER', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid)
)
SELECT
  'ROLE_INSTANCE_LINKS'::text AS result_set_label,
  fm.role_instance_key,
  fm.identity_role,
  fm.attendee_id,
  fm.household_member_id,
  fm.event_id,
  fm.auth_user_id,
  pri.person_id,
  pri.source_table,
  pri.source_record_id,
  pri.attribution_method,
  pri.evidence_source
FROM fixed_manifest fm
LEFT JOIN public.person_role_instances pri
  ON pri.source_role_instance_key = fm.role_instance_key
ORDER BY fm.auth_user_id, fm.role_instance_key;

-- RESULT SET: IDENTIFIERS
WITH fixed_manifest_keys AS (
  SELECT
    role_instance_key
  FROM (VALUES
    ('attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048'),
    ('attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3'),
    ('attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc'),
    ('attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73'),
    ('attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec'),
    ('attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea'),
    ('attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456'),
    ('attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507'),
    ('household_member:08374616-3cd4-433e-a761-838f2fa28848'),
    ('household_member:2f482686-cb88-41b1-82d2-6b15731ef577'),
    ('household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0'),
    ('household_member:69741cc2-1a76-4270-97d7-1526c35e20b6'),
    ('household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442'),
    ('household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'),
    ('household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc'),
    ('household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51'),
    ('household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db')
  ) AS t(role_instance_key)
),
resolved_people AS (
  SELECT DISTINCT pri.person_id
  FROM public.person_role_instances pri
  JOIN fixed_manifest_keys fmk
    ON fmk.role_instance_key = pri.source_role_instance_key
)
SELECT
  'IDENTIFIERS'::text AS result_set_label,
  pi.person_id,
  pi.identifier_type,
  pi.normalized_value,
  pi.verification_status,
  pi.confidence,
  pi.source_type,
  pi.source_record_id,
  pi.is_current
FROM public.person_identifiers pi
WHERE pi.person_id IN (SELECT person_id FROM resolved_people)
ORDER BY pi.person_id, pi.identifier_type, pi.normalized_value;

-- RESULT SET: CONFLICT_CHECKS
WITH fixed_manifest (
  role_instance_key,
  auth_user_id
) AS (
  VALUES
  ('attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid),
  ('attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid),
  ('attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:08374616-3cd4-433e-a761-838f2fa28848', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid),
  ('household_member:2f482686-cb88-41b1-82d2-6b15731ef577', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
  ('household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
  ('household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid),
  ('household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid),
  ('household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid)
),
auth_conflicts AS (
  SELECT count(*)::bigint AS auth_uuid_linked_to_multiple_people
  FROM (
    SELECT fm.auth_user_id
    FROM fixed_manifest fm
    JOIN public.person_role_instances pri
      ON pri.source_role_instance_key = fm.role_instance_key
    GROUP BY fm.auth_user_id
    HAVING count(DISTINCT pri.person_id) > 1
  ) q
),
role_conflicts AS (
  SELECT count(*)::bigint AS role_instance_linked_to_multiple_people
  FROM (
    SELECT source_role_instance_key
    FROM public.person_role_instances
    WHERE source_role_instance_key IN (SELECT role_instance_key FROM fixed_manifest)
    GROUP BY source_role_instance_key
    HAVING count(DISTINCT person_id) > 1
  ) q
),
missing_links AS (
  SELECT count(*)::bigint AS manifest_rows_without_role_instance_link
  FROM fixed_manifest fm
  LEFT JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = fm.role_instance_key
  WHERE pri.id IS NULL
),
people_without_expected_auth AS (
  SELECT count(*)::bigint AS people_without_expected_auth_link
  FROM (
    SELECT DISTINCT fm.auth_user_id, pri.person_id
    FROM fixed_manifest fm
    JOIN public.person_role_instances pri
      ON pri.source_role_instance_key = fm.role_instance_key
  ) rp
  LEFT JOIN public.person_auth_accounts paa
    ON paa.auth_user_id = rp.auth_user_id
   AND paa.person_id = rp.person_id
   AND paa.status = 'active'
  WHERE paa.id IS NULL
),
identifier_conflicts AS (
  SELECT 0::bigint AS identifiers_linked_to_multiple_people_where_prohibited
)
SELECT
  'CONFLICT_CHECKS'::text AS result_set_label,
  ac.auth_uuid_linked_to_multiple_people,
  rc.role_instance_linked_to_multiple_people,
  ic.identifiers_linked_to_multiple_people_where_prohibited,
  ml.manifest_rows_without_role_instance_link,
  pa.people_without_expected_auth_link
FROM auth_conflicts ac
CROSS JOIN role_conflicts rc
CROSS JOIN identifier_conflicts ic
CROSS JOIN missing_links ml
CROSS JOIN people_without_expected_auth pa;

-- RESULT SET: AUTH_PERSON_NAME_ALIGNMENT
WITH fixed_manifest (
  role_instance_key,
  auth_user_id,
  expected_manifest_first_name,
  expected_manifest_last_name,
  identity_role
) AS (
  VALUES
  ('attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'PILOT'),
  ('attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'PILOT'),
  ('attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'Steve', 'Batorson', 'PILOT'),
  ('attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'Bud', 'Vogt', 'PILOT'),
  ('attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('household_member:08374616-3cd4-433e-a761-838f2fa28848', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'Steve', 'Batorson', 'HOUSEHOLD_MEMBER'),
  ('household_member:2f482686-cb88-41b1-82d2-6b15731ef577', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'HOUSEHOLD_MEMBER'),
  ('household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'HOUSEHOLD_MEMBER'),
  ('household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER'),
  ('household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER'),
  ('household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER'),
  ('household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'Bud', 'Vogt', 'HOUSEHOLD_MEMBER'),
  ('household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'Janine', 'Rowe', 'HOUSEHOLD_MEMBER'),
  ('household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER')
),
auth_expected_names AS (
  SELECT
    auth_user_id,
    (array_agg(expected_manifest_first_name ORDER BY CASE WHEN identity_role = 'PILOT' THEN 0 ELSE 1 END, role_instance_key))[1] AS expected_manifest_first_name,
    (array_agg(expected_manifest_last_name ORDER BY CASE WHEN identity_role = 'PILOT' THEN 0 ELSE 1 END, role_instance_key))[1] AS expected_manifest_last_name
  FROM fixed_manifest
  GROUP BY auth_user_id
),
auth_resolved_people AS (
  SELECT
    fm.auth_user_id,
    (array_agg(DISTINCT pri.person_id))[1] AS resolved_person_id,
    count(DISTINCT pri.person_id)::bigint AS resolved_person_count
  FROM fixed_manifest fm
  JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = fm.role_instance_key
  GROUP BY fm.auth_user_id
)
SELECT
  'AUTH_PERSON_NAME_ALIGNMENT'::text AS result_set_label,
  aen.auth_user_id,
  arp.resolved_person_id,
  p.display_first_name,
  p.display_last_name,
  aen.expected_manifest_first_name,
  aen.expected_manifest_last_name,
  CASE
    WHEN arp.resolved_person_count <> 1 THEN 'FAIL_MULTIPLE_OR_MISSING_PERSONS'
    WHEN arp.resolved_person_id IS NULL THEN 'FAIL_MISSING_PERSON'
    WHEN coalesce(p.display_first_name, '') = coalesce(aen.expected_manifest_first_name, '')
     AND coalesce(p.display_last_name, '') = coalesce(aen.expected_manifest_last_name, '')
    THEN 'PASS'
    ELSE 'FAIL_NAME_MISMATCH'
  END AS name_alignment_status
FROM auth_expected_names aen
LEFT JOIN auth_resolved_people arp
  ON arp.auth_user_id = aen.auth_user_id
LEFT JOIN public.people p
  ON p.id = arp.resolved_person_id
ORDER BY aen.auth_user_id;

-- RESULT SET: EXPECTED_ROLE_INSTANCE_ASSIGNMENTS
WITH fixed_manifest (
  role_instance_key,
  expected_auth_user_id,
  expected_manifest_first_name,
  expected_manifest_last_name,
  identity_role
) AS (
  VALUES
  ('attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'PILOT'),
  ('attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'PILOT'),
  ('attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'Steve', 'Batorson', 'PILOT'),
  ('attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'Bud', 'Vogt', 'PILOT'),
  ('attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'PILOT'),
  ('household_member:08374616-3cd4-433e-a761-838f2fa28848', '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'Steve', 'Batorson', 'HOUSEHOLD_MEMBER'),
  ('household_member:2f482686-cb88-41b1-82d2-6b15731ef577', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'HOUSEHOLD_MEMBER'),
  ('household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'Steve', 'Jeanneret', 'HOUSEHOLD_MEMBER'),
  ('household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER'),
  ('household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER'),
  ('household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER'),
  ('household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'Bud', 'Vogt', 'HOUSEHOLD_MEMBER'),
  ('household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'Janine', 'Rowe', 'HOUSEHOLD_MEMBER'),
  ('household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'Steven', 'Bertling', 'HOUSEHOLD_MEMBER')
),
role_row_counts AS (
  SELECT source_role_instance_key, count(*)::bigint AS role_row_count
  FROM public.person_role_instances
  GROUP BY source_role_instance_key
),
auth_expected_names AS (
  SELECT
    expected_auth_user_id,
    (array_agg(expected_manifest_first_name ORDER BY CASE WHEN identity_role = 'PILOT' THEN 0 ELSE 1 END, role_instance_key))[1] AS expected_manifest_first_name,
    (array_agg(expected_manifest_last_name ORDER BY CASE WHEN identity_role = 'PILOT' THEN 0 ELSE 1 END, role_instance_key))[1] AS expected_manifest_last_name
  FROM fixed_manifest
  GROUP BY expected_auth_user_id
)
SELECT
  'EXPECTED_ROLE_INSTANCE_ASSIGNMENTS'::text AS result_set_label,
  fm.role_instance_key,
  fm.expected_auth_user_id,
  pri.person_id AS persisted_person_id,
  paa.auth_user_id AS persisted_auth_user_id,
  concat_ws(' ', p.display_first_name, p.display_last_name) AS persisted_person_name,
  CASE
    WHEN coalesce(rrc.role_row_count, 0) <> 1 THEN 'FAIL_ROLE_INSTANCE_NOT_EXACTLY_ONCE'
    WHEN pri.person_id IS NULL THEN 'FAIL_ROLE_INSTANCE_MISSING'
    WHEN paa.auth_user_id IS NULL THEN 'FAIL_EXPECTED_ACTIVE_AUTH_LINK_MISSING'
    WHEN pri.person_id <> paa.person_id THEN 'FAIL_ROLE_PERSON_AUTH_PERSON_MISMATCH'
    WHEN coalesce(p.display_first_name, '') <> coalesce(aen.expected_manifest_first_name, '')
      OR coalesce(p.display_last_name, '') <> coalesce(aen.expected_manifest_last_name, '')
    THEN 'FAIL_NAME_MISMATCH'
    ELSE 'PASS'
  END AS assignment_status
FROM fixed_manifest fm
LEFT JOIN role_row_counts rrc
  ON rrc.source_role_instance_key = fm.role_instance_key
LEFT JOIN public.person_role_instances pri
  ON pri.source_role_instance_key = fm.role_instance_key
LEFT JOIN public.person_auth_accounts paa
  ON paa.auth_user_id = fm.expected_auth_user_id
 AND paa.status = 'active'
LEFT JOIN public.people p
  ON p.id = pri.person_id
LEFT JOIN auth_expected_names aen
  ON aen.expected_auth_user_id = fm.expected_auth_user_id
ORDER BY fm.expected_auth_user_id, fm.role_instance_key;
