/*
Read-only identifier evidence manifest generator for the approved Stage 1 roles.

Each output row is one actual source-field occurrence. Pilot phone fields are
expanded independently. Household membership numbers are intentionally absent
because attendee_household_members has no membership-number column.
*/

WITH approved_roles (
  role_instance_key,
  identity_role,
  attendee_id,
  household_member_id,
  auth_user_id
) AS (
  VALUES
    ('attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', 'PILOT', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
    ('attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', 'PILOT', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
    ('attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', 'PILOT', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
    ('attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', 'PILOT', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
    ('attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', 'PILOT', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
    ('attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', 'PILOT', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, NULL, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid),
    ('attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', 'PILOT', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, NULL, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid),
    ('attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', 'PILOT', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
    ('household_member:08374616-3cd4-433e-a761-838f2fa28848', 'HOUSEHOLD_MEMBER', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '08374616-3cd4-433e-a761-838f2fa28848'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid),
    ('household_member:2f482686-cb88-41b1-82d2-6b15731ef577', 'HOUSEHOLD_MEMBER', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
    ('household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', 'HOUSEHOLD_MEMBER', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid),
    ('household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', 'HOUSEHOLD_MEMBER', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
    ('household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', 'HOUSEHOLD_MEMBER', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
    ('household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', 'HOUSEHOLD_MEMBER', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid),
    ('household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', 'HOUSEHOLD_MEMBER', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '9ec93e24-94f8-4faa-a2b5-1eab8629fefc'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid),
    ('household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', 'HOUSEHOLD_MEMBER', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid, '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid),
    ('household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', 'HOUSEHOLD_MEMBER', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid)
),
pilot_identifiers AS (
  SELECT
    ar.role_instance_key,
    ar.auth_user_id,
    'email'::text AS identifier_type,
    a.email AS identifier_value,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_value,
    'attendee_record'::text AS source_type,
    a.id AS source_record_id,
    'email'::text AS source_column
  FROM approved_roles ar
  JOIN public.attendees a ON a.id = ar.attendee_id
  WHERE ar.identity_role = 'PILOT'
    AND NULLIF(trim(coalesce(a.email, '')), '') IS NOT NULL

  UNION ALL

  SELECT
    ar.role_instance_key,
    ar.auth_user_id,
    'phone'::text,
    phone_source.raw_value,
    CASE
      WHEN length(regexp_replace(phone_source.raw_value, '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(phone_source.raw_value, '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(phone_source.raw_value, '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(phone_source.raw_value, '[^0-9]', '', 'g'), '')
    END,
    'attendee_record'::text,
    a.id,
    phone_source.source_column
  FROM approved_roles ar
  JOIN public.attendees a ON a.id = ar.attendee_id
  CROSS JOIN LATERAL (VALUES
    ('phone'::text, a.phone),
    ('primary_phone'::text, a.primary_phone),
    ('cell_phone'::text, a.cell_phone)
  ) AS phone_source(source_column, raw_value)
  WHERE ar.identity_role = 'PILOT'
    AND NULLIF(trim(coalesce(phone_source.raw_value, '')), '') IS NOT NULL

  UNION ALL

  SELECT
    ar.role_instance_key,
    ar.auth_user_id,
    'membership_number'::text,
    a.membership_number,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), ''),
    'attendee_record'::text,
    a.id,
    'membership_number'::text
  FROM approved_roles ar
  JOIN public.attendees a ON a.id = ar.attendee_id
  WHERE ar.identity_role = 'PILOT'
    AND NULLIF(trim(coalesce(a.membership_number, '')), '') IS NOT NULL
),
household_identifiers AS (
  SELECT
    ar.role_instance_key,
    ar.auth_user_id,
    'email'::text AS identifier_type,
    hm.email AS identifier_value,
    NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_value,
    'attendee_household_member_record'::text AS source_type,
    hm.id AS source_record_id,
    'email'::text AS source_column
  FROM approved_roles ar
  JOIN public.attendee_household_members hm ON hm.id = ar.household_member_id
  WHERE ar.identity_role = 'HOUSEHOLD_MEMBER'
    AND NULLIF(trim(coalesce(hm.email, '')), '') IS NOT NULL

  UNION ALL

  SELECT
    ar.role_instance_key,
    ar.auth_user_id,
    'phone'::text,
    hm.cell_phone,
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), '')
    END,
    'attendee_household_member_record'::text,
    hm.id,
    'cell_phone'::text
  FROM approved_roles ar
  JOIN public.attendee_household_members hm ON hm.id = ar.household_member_id
  WHERE ar.identity_role = 'HOUSEHOLD_MEMBER'
    AND NULLIF(trim(coalesce(hm.cell_phone, '')), '') IS NOT NULL
),
identifier_manifest AS (
  SELECT * FROM pilot_identifiers
  UNION ALL
  SELECT * FROM household_identifiers
)
SELECT
  'STAGE_1_IDENTIFIER_EVIDENCE_MANIFEST'::text AS result_set_label,
  role_instance_key,
  auth_user_id,
  identifier_type,
  identifier_value,
  normalized_value,
  source_type,
  source_record_id,
  source_column
FROM identifier_manifest
WHERE normalized_value IS NOT NULL
ORDER BY role_instance_key, identifier_type, source_column, normalized_value;
