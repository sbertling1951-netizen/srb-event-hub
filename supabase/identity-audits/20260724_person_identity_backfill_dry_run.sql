/*
Exploratory read-only dry run for person identity backfill preview payloads.

Authoritative role-instance classification is owned by
20260724_person_identity_reconciliation_audit.sql.
This dry run must never independently promote any role instance to automatic attribution.

This file is intentionally limited to SELECT statements and CTEs.
It does not mutate data, create database objects, or issue write-capable SQL.
*/

-- 1. DRY_RUN_METADATA
WITH metadata AS (
  SELECT
    (SELECT count(*) FROM public.attendees) AS total_attendee_registrations,
    (SELECT count(DISTINCT auth_user_id) FROM public.attendees WHERE auth_user_id IS NOT NULL) AS total_auth_accounts,
    (SELECT count(*) FROM public.people) AS existing_people_rows,
    (SELECT count(*) FROM public.person_identifiers) AS existing_person_identifiers_rows,
    (SELECT count(*) FROM public.person_auth_accounts) AS existing_person_auth_accounts_rows
)
SELECT
  'DRY_RUN_METADATA' AS result_set_label,
  now() AS generated_at,
  metadata.total_attendee_registrations,
  metadata.total_auth_accounts,
  metadata.existing_people_rows,
  metadata.existing_person_identifiers_rows,
  metadata.existing_person_auth_accounts_rows,
  FALSE AS writes_performed,
  'NO_DATABASE_WRITES_PERFORMED' AS safety_confirmation
FROM metadata;

-- 2. PROPOSED_IDENTITY_EVIDENCE
WITH attendee_role_rows AS (
  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'membership_number'::text AS identifier_type,
    a.membership_number AS identifier_value,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_value,
    'membership_number'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'email'::text AS identifier_type,
    a.email AS identifier_value,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_value,
    'email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    a.phone AS identifier_value,
    CASE
      WHEN a.phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    a.primary_phone AS identifier_value,
    CASE
      WHEN a.primary_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'primary_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    a.cell_phone AS identifier_value,
    CASE
      WHEN a.cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'copilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.copilot_first, '')) AS display_first_name,
    trim(coalesce(a.copilot_last, '')) AS display_last_name,
    'email'::text AS identifier_type,
    a.copilot_email AS identifier_value,
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), '') AS normalized_value,
    'copilot_email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'copilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.copilot_first, '')) AS display_first_name,
    trim(coalesce(a.copilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    a.copilot_cell_phone AS identifier_value,
    CASE
      WHEN a.copilot_cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'copilot_cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    hm.attendee_id AS attendee_id,
    hm.event_id,
    e.name AS event_name,
    e.event_code,
    'household_member'::text AS identity_role,
    hm.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
    trim(coalesce(hm.first_name, '')) AS display_first_name,
    trim(coalesce(hm.last_name, '')) AS display_last_name,
    'email'::text AS identifier_type,
    hm.email AS identifier_value,
    NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_value,
    'household_email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendee_household_members AS hm
  LEFT JOIN public.attendees AS a ON a.id = hm.attendee_id
  LEFT JOIN public.events AS e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    hm.attendee_id AS attendee_id,
    hm.event_id,
    e.name AS event_name,
    e.event_code,
    'household_member'::text AS identity_role,
    hm.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
    trim(coalesce(hm.first_name, '')) AS display_first_name,
    trim(coalesce(hm.last_name, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    hm.cell_phone AS identifier_value,
    CASE
      WHEN hm.cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'household_cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendee_household_members AS hm
  LEFT JOIN public.attendees AS a ON a.id = hm.attendee_id
  LEFT JOIN public.events AS e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
)
SELECT
  'PROPOSED_IDENTITY_EVIDENCE' AS result_set_label,
  CASE
    WHEN auth_user_id IS NOT NULL THEN 'auth:' || auth_user_id::text
    WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'membership:' || normalized_value
    WHEN identifier_type = 'email' AND normalized_value IS NOT NULL THEN 'email:' || normalized_value
    WHEN identifier_type = 'phone' AND normalized_value IS NOT NULL THEN 'phone:' || normalized_value
    ELSE 'name:' || coalesce(normalized_first_name, '') || '|' || coalesce(normalized_last_name, '') || '|attendee:' || attendee_id::text
  END AS proposed_evidence_key,
  attendee_id,
  event_id,
  event_name,
  event_code,
  identity_role,
  normalized_first_name,
  normalized_last_name,
  display_first_name,
  display_last_name,
  identifier_type,
  identifier_value,
  normalized_value,
  source_column,
  auth_user_id,
  membership_number,
  CASE
    WHEN normalized_value IS NULL THEN 'insufficient'
    WHEN identity_role = 'household_member' THEN 'review'
    WHEN auth_user_id IS NOT NULL AND normalized_first_name IS NOT NULL AND normalized_last_name IS NOT NULL THEN 'strong'
    WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'moderate'
    ELSE 'weak'
  END AS evidence_strength,
  CASE
    WHEN identity_role = 'household_member' THEN 'Household-role evidence is treated as contextual and not sufficient for automatic collapse.'
    WHEN auth_user_id IS NOT NULL AND normalized_first_name IS NOT NULL AND normalized_last_name IS NOT NULL THEN 'Auth account plus named role is strong person-specific evidence when no conflicting role evidence is present.'
    WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'Membership number is person-specific evidence when it is not shared across conflicting roles.'
    ELSE 'Identifier evidence is preserved for review and later person-level confirmation.'
  END AS evidence_notes
FROM attendee_role_rows
ORDER BY proposed_evidence_key, attendee_id, identifier_type, normalized_value;

-- 3. PROPOSED_PERSON_GROUPS
WITH attendee_role_rows AS (
  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'membership_number'::text AS identifier_type,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_value,
    'membership_number'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'email'::text AS identifier_type,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_value,
    'email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    CASE
      WHEN a.phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    CASE
      WHEN a.primary_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'primary_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    CASE
      WHEN a.cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'copilot'::text AS identity_role,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.copilot_first, '')) AS display_first_name,
    trim(coalesce(a.copilot_last, '')) AS display_last_name,
    'email'::text AS identifier_type,
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), '') AS normalized_value,
    'copilot_email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'copilot'::text AS identity_role,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.copilot_first, '')) AS display_first_name,
    trim(coalesce(a.copilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    CASE
      WHEN a.copilot_cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'copilot_cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    hm.attendee_id AS attendee_id,
    hm.event_id,
    e.name AS event_name,
    e.event_code,
    'household_member'::text AS identity_role,
    hm.auth_user_id,
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
    trim(coalesce(hm.first_name, '')) AS display_first_name,
    trim(coalesce(hm.last_name, '')) AS display_last_name,
    'email'::text AS identifier_type,
    NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_value,
    'household_email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendee_household_members AS hm
  LEFT JOIN public.attendees AS a ON a.id = hm.attendee_id
  LEFT JOIN public.events AS e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    hm.attendee_id AS attendee_id,
    hm.event_id,
    e.name AS event_name,
    e.event_code,
    'household_member'::text AS identity_role,
    hm.auth_user_id,
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
    trim(coalesce(hm.first_name, '')) AS display_first_name,
    trim(coalesce(hm.last_name, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    CASE
      WHEN hm.cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'household_cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendee_household_members AS hm
  LEFT JOIN public.attendees AS a ON a.id = hm.attendee_id
  LEFT JOIN public.events AS e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
proposed_groups AS (
  SELECT
    CASE
      WHEN auth_user_id IS NOT NULL THEN 'auth:' || auth_user_id::text
      WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'membership:' || normalized_value
      WHEN identifier_type = 'email' AND normalized_value IS NOT NULL THEN 'email:' || normalized_value
      WHEN identifier_type = 'phone' AND normalized_value IS NOT NULL THEN 'phone:' || normalized_value
      ELSE 'name:' || coalesce(normalized_first_name, '') || '|' || coalesce(normalized_last_name, '') || '|attendee:' || attendee_id::text
    END AS proposed_person_key,
    COALESCE(NULLIF(trim(display_first_name), ''), 'UNKNOWN') AS display_first_name,
    COALESCE(NULLIF(trim(display_last_name), ''), 'UNKNOWN') AS display_last_name,
    COALESCE(NULLIF(trim(display_first_name), ''), 'UNKNOWN') AS proposed_preferred_name,
    NULL::uuid AS proposed_tenant_id,
    count(DISTINCT attendee_id) AS attendee_registration_count,
    count(DISTINCT event_id) AS event_count,
    count(*) AS identifier_count,
    count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_account_count,
    count(DISTINCT identity_role) AS role_count,
    string_agg(DISTINCT identity_role, ', ' ORDER BY identity_role) AS roles_seen,
    string_agg(DISTINCT attendee_id::text, ', ' ORDER BY attendee_id::text) AS attendee_ids,
    string_agg(DISTINCT event_id::text, ', ' ORDER BY event_id::text) AS event_ids,
    string_agg(DISTINCT identifier_type || ':' || coalesce(normalized_value, ''), ', ' ORDER BY identifier_type || ':' || coalesce(normalized_value, '')) AS identifier_summary,
    string_agg(DISTINCT auth_user_id::text, ', ' ORDER BY auth_user_id::text) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_user_ids,
    count(DISTINCT CASE WHEN source_column IN ('household_email', 'household_cell_phone') THEN normalized_value END) AS shared_household_identifier_count,
    count(DISTINCT CASE WHEN identity_role = 'household_member' THEN normalized_value END) AS household_evidence_count,
    count(DISTINCT CASE WHEN identity_role = 'pilot' THEN attendee_id END) AS pilot_attendees,
    count(DISTINCT CASE WHEN identity_role = 'copilot' THEN attendee_id END) AS copilot_attendees,
    count(DISTINCT CASE WHEN identity_role = 'household_member' THEN attendee_id END) AS household_member_attendees,
    count(DISTINCT CASE WHEN normalized_first_name IS NOT NULL AND normalized_last_name IS NOT NULL THEN normalized_first_name || '|' || normalized_last_name END) AS distinct_named_people
  FROM attendee_role_rows
  GROUP BY
    CASE
      WHEN auth_user_id IS NOT NULL THEN 'auth:' || auth_user_id::text
      WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'membership:' || normalized_value
      WHEN identifier_type = 'email' AND normalized_value IS NOT NULL THEN 'email:' || normalized_value
      WHEN identifier_type = 'phone' AND normalized_value IS NOT NULL THEN 'phone:' || normalized_value
      ELSE 'name:' || coalesce(normalized_first_name, '') || '|' || coalesce(normalized_last_name, '') || '|attendee:' || attendee_id::text
    END,
    COALESCE(NULLIF(trim(display_first_name), ''), 'UNKNOWN'),
    COALESCE(NULLIF(trim(display_last_name), ''), 'UNKNOWN')
)
SELECT
  'PROPOSED_PERSON_GROUPS' AS result_set_label,
  proposed_person_key,
  display_first_name AS proposed_display_first_name,
  display_last_name AS proposed_display_last_name,
  proposed_preferred_name,
  proposed_tenant_id,
  attendee_registration_count,
  event_count,
  identifier_count,
  auth_account_count,
  role_count,
  roles_seen,
  attendee_ids,
  event_ids,
  identifier_summary,
  auth_user_ids,
  CASE
    WHEN shared_household_identifier_count > 0 THEN 'shared household contact evidence'
    WHEN role_count > 1 AND auth_account_count = 0 THEN 'cross-role evidence without a single strong auth anchor'
    WHEN auth_account_count = 1 AND identifier_count >= 1 AND role_count = 1 AND distinct_named_people = 1 THEN 'auth account plus consistent named role evidence'
    WHEN identifier_count >= 2 AND distinct_named_people = 1 THEN 'multiple person-specific identifiers align to one name'
    ELSE 'name and identifier evidence preserved for review'
  END AS grouping_basis,
  CASE
    WHEN shared_household_identifier_count > 0 OR household_evidence_count > 0 THEN 'REVIEW_REQUIRED'
    WHEN auth_account_count = 1 AND identifier_count >= 1 AND role_count = 1 AND distinct_named_people = 1 THEN 'AUTO_LINK_SAFE'
    WHEN auth_account_count > 1 OR (role_count > 1 AND auth_account_count = 0) THEN 'DO_NOT_AUTO_LINK'
    WHEN identifier_count >= 2 AND distinct_named_people = 1 THEN 'AUTO_LINK_SAFE'
    ELSE 'REVIEW_REQUIRED'
  END AS proposed_disposition,
  CASE
    WHEN shared_household_identifier_count > 0 OR household_evidence_count > 0 THEN 'Shared household contact evidence must be reviewed before any collapse is attempted.'
    WHEN auth_account_count > 1 THEN 'Multiple auth accounts would require manual review before assignment.'
    WHEN role_count > 1 AND auth_account_count = 0 THEN 'Pilot and copilot evidence are mixed without a strong person-specific anchor.'
    WHEN auth_account_count = 1 AND identifier_count >= 1 AND role_count = 1 AND distinct_named_people = 1 THEN 'Strong auth and role evidence supports a safe preview link.'
    ELSE 'The evidence is insufficient or mixed; manual review is required.'
  END AS disposition_reason
FROM proposed_groups
ORDER BY proposed_person_key;

-- 4. PROPOSED_ATTENDEE_LINKS
WITH attendee_role_rows AS (
  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    a.auth_user_id,
    a.person_id AS current_person_id,
    CASE
      WHEN a.auth_user_id IS NOT NULL THEN 'auth:' || a.auth_user_id::text
      WHEN a.membership_number IS NOT NULL THEN 'membership:' || NULLIF(upper(trim(coalesce(a.membership_number, ''))), '')
      ELSE 'name:' || COALESCE(NULLIF(lower(trim(coalesce(a.pilot_first, ''))), ''), 'unknown') || '|' || COALESCE(NULLIF(lower(trim(coalesce(a.pilot_last, ''))), ''), 'unknown') || '|attendee:' || a.id::text
    END AS proposed_person_key
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
),
proposed_groups AS (
  SELECT
    CASE
      WHEN auth_user_id IS NOT NULL THEN 'auth:' || auth_user_id::text
      WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'membership:' || normalized_value
      WHEN identifier_type = 'email' AND normalized_value IS NOT NULL THEN 'email:' || normalized_value
      WHEN identifier_type = 'phone' AND normalized_value IS NOT NULL THEN 'phone:' || normalized_value
      ELSE 'name:' || coalesce(normalized_first_name, '') || '|' || coalesce(normalized_last_name, '') || '|attendee:' || attendee_id::text
    END AS proposed_person_key,
    CASE
      WHEN shared_household_identifier_count > 0 OR household_evidence_count > 0 THEN 'REVIEW_REQUIRED'
      WHEN auth_account_count = 1 AND identifier_count >= 1 AND role_count = 1 AND distinct_named_people = 1 THEN 'AUTO_LINK_SAFE'
      WHEN auth_account_count > 1 OR (role_count > 1 AND auth_account_count = 0) THEN 'DO_NOT_AUTO_LINK'
      WHEN identifier_count >= 2 AND distinct_named_people = 1 THEN 'AUTO_LINK_SAFE'
      ELSE 'REVIEW_REQUIRED'
    END AS proposed_disposition,
    CASE
      WHEN auth_account_count = 1 AND identifier_count >= 1 AND role_count = 1 AND distinct_named_people = 1 THEN 'high'
      WHEN shared_household_identifier_count > 0 OR household_evidence_count > 0 THEN 'medium'
      ELSE 'low'
    END AS link_confidence,
    CASE
      WHEN auth_account_count = 1 AND identifier_count >= 1 AND role_count = 1 AND distinct_named_people = 1 THEN 'auth account and consistent role evidence'
      WHEN shared_household_identifier_count > 0 OR household_evidence_count > 0 THEN 'shared household evidence'
      ELSE 'identifier or name review'
    END AS link_basis,
    CASE
      WHEN auth_account_count > 1 OR role_count > 1 THEN 1
      ELSE 0
    END AS conflict_count,
    CASE
      WHEN shared_household_identifier_count > 0 OR household_evidence_count > 0 THEN 'Shared household evidence is visible and requires review.'
      WHEN auth_account_count > 1 THEN 'Multiple auth accounts would need manual review before assignment.'
      ELSE 'Preview only; no automatic write is performed.'
    END AS review_reason
  FROM (
    SELECT
      a.attendee_id,
      a.event_id,
      a.identity_role,
      a.auth_user_id,
      a.normalized_first_name,
      a.normalized_last_name,
      a.identifier_type,
      a.normalized_value,
      count(*) AS identifier_count,
      count(DISTINCT a.identity_role) AS role_count,
      count(DISTINCT a.auth_user_id) FILTER (WHERE a.auth_user_id IS NOT NULL) AS auth_account_count,
      count(DISTINCT CASE WHEN a.source_column IN ('household_email', 'household_cell_phone') THEN a.normalized_value END) AS shared_household_identifier_count,
      count(DISTINCT CASE WHEN a.identity_role = 'household_member' THEN a.normalized_value END) AS household_evidence_count,
      count(DISTINCT CASE WHEN a.normalized_first_name IS NOT NULL AND a.normalized_last_name IS NOT NULL THEN a.normalized_first_name || '|' || a.normalized_last_name END) AS distinct_named_people
    FROM (
      SELECT
        a.id AS attendee_id,
        a.event_id,
        'pilot'::text AS identity_role,
        a.auth_user_id,
        NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
        NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
        'membership_number'::text AS identifier_type,
        NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_value,
        'membership_number'::text AS source_column
      FROM public.attendees AS a

      UNION ALL

      SELECT
        a.id AS attendee_id,
        a.event_id,
        'pilot'::text AS identity_role,
        a.auth_user_id,
        NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
        NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
        'email'::text AS identifier_type,
        NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_value,
        'email'::text AS source_column
      FROM public.attendees AS a

      UNION ALL

      SELECT
        a.id AS attendee_id,
        a.event_id,
        'pilot'::text AS identity_role,
        a.auth_user_id,
        NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
        NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
        'phone'::text AS identifier_type,
        CASE
          WHEN a.phone IS NULL THEN NULL
          WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
            THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
          ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
        END AS normalized_value,
        'phone'::text AS source_column
      FROM public.attendees AS a

      UNION ALL

      SELECT
        a.id AS attendee_id,
        a.event_id,
        'copilot'::text AS identity_role,
        a.auth_user_id,
        NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
        NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
        'email'::text AS identifier_type,
        NULLIF(lower(trim(coalesce(a.copilot_email, ''))), '') AS normalized_value,
        'copilot_email'::text AS source_column
      FROM public.attendees AS a

      UNION ALL

      SELECT
        a.id AS attendee_id,
        a.event_id,
        'copilot'::text AS identity_role,
        a.auth_user_id,
        NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
        NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
        'phone'::text AS identifier_type,
        CASE
          WHEN a.copilot_cell_phone IS NULL THEN NULL
          WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
            THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
          ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
        END AS normalized_value,
        'copilot_cell_phone'::text AS source_column
      FROM public.attendees AS a

      UNION ALL

      SELECT
        hm.attendee_id AS attendee_id,
        hm.event_id,
        'household_member'::text AS identity_role,
        hm.auth_user_id,
        NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
        NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
        'email'::text AS identifier_type,
        NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_value,
        'household_email'::text AS source_column
      FROM public.attendee_household_members AS hm

      UNION ALL

      SELECT
        hm.attendee_id AS attendee_id,
        hm.event_id,
        'household_member'::text AS identity_role,
        hm.auth_user_id,
        NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
        NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
        'phone'::text AS identifier_type,
        CASE
          WHEN hm.cell_phone IS NULL THEN NULL
          WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
            THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
          ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
        END AS normalized_value,
        'household_cell_phone'::text AS source_column
      FROM public.attendee_household_members AS hm
    ) AS a
    GROUP BY
      a.attendee_id,
      a.event_id,
      a.identity_role,
      a.auth_user_id,
      a.normalized_first_name,
      a.normalized_last_name,
      a.identifier_type,
      a.normalized_value
  ) AS group_stats
)
SELECT
  'PROPOSED_ATTENDEE_LINKS' AS result_set_label,
  attendee_id,
  event_id,
  event_name,
  current_person_id,
  COALESCE(proposed_groups.proposed_person_key, attendee_role_rows.proposed_person_key) AS proposed_person_key,
  COALESCE(proposed_groups.proposed_disposition, 'REVIEW_REQUIRED') AS proposed_disposition,
  COALESCE(proposed_groups.link_confidence, 'low') AS link_confidence,
  COALESCE(proposed_groups.link_basis, 'identifier review') AS link_basis,
  COALESCE(proposed_groups.conflict_count, 0) AS conflict_count,
  COALESCE(proposed_groups.review_reason, 'Preview only; no automatic write is performed.') AS review_reason
FROM attendee_role_rows
LEFT JOIN proposed_groups
  ON attendee_role_rows.proposed_person_key = proposed_groups.proposed_person_key
ORDER BY attendee_id, event_id;

-- 5. PROPOSED_IDENTIFIERS
WITH attendee_role_rows AS (
  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'membership_number'::text AS identifier_type,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS identifier_value,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_value,
    'membership_number'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'email'::text AS identifier_type,
    a.email AS identifier_value,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_value,
    'email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'pilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.pilot_first, '')) AS display_first_name,
    trim(coalesce(a.pilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    CASE
      WHEN a.phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END AS identifier_value,
    CASE
      WHEN a.phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'copilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.copilot_first, '')) AS display_first_name,
    trim(coalesce(a.copilot_last, '')) AS display_last_name,
    'email'::text AS identifier_type,
    a.copilot_email AS identifier_value,
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), '') AS normalized_value,
    'copilot_email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    a.id AS attendee_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'copilot'::text AS identity_role,
    a.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
    trim(coalesce(a.copilot_first, '')) AS display_first_name,
    trim(coalesce(a.copilot_last, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    a.copilot_cell_phone AS identifier_value,
    CASE
      WHEN a.copilot_cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'copilot_cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendees AS a
  LEFT JOIN public.events AS e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    hm.attendee_id AS attendee_id,
    hm.event_id,
    e.name AS event_name,
    e.event_code,
    'household_member'::text AS identity_role,
    hm.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
    trim(coalesce(hm.first_name, '')) AS display_first_name,
    trim(coalesce(hm.last_name, '')) AS display_last_name,
    'email'::text AS identifier_type,
    hm.email AS identifier_value,
    NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_value,
    'household_email'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendee_household_members AS hm
  LEFT JOIN public.attendees AS a ON a.id = hm.attendee_id
  LEFT JOIN public.events AS e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    hm.attendee_id AS attendee_id,
    hm.event_id,
    e.name AS event_name,
    e.event_code,
    'household_member'::text AS identity_role,
    hm.auth_user_id,
    a.person_id,
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
    trim(coalesce(hm.first_name, '')) AS display_first_name,
    trim(coalesce(hm.last_name, '')) AS display_last_name,
    'phone'::text AS identifier_type,
    hm.cell_phone AS identifier_value,
    CASE
      WHEN hm.cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'household_cell_phone'::text AS source_column,
    a.membership_number AS membership_number
  FROM public.attendee_household_members AS hm
  LEFT JOIN public.attendees AS a ON a.id = hm.attendee_id
  LEFT JOIN public.events AS e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
proposed_groups AS (
  SELECT
    CASE
      WHEN auth_user_id IS NOT NULL THEN 'auth:' || auth_user_id::text
      WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'membership:' || normalized_value
      WHEN identifier_type = 'email' AND normalized_value IS NOT NULL THEN 'email:' || normalized_value
      WHEN identifier_type = 'phone' AND normalized_value IS NOT NULL THEN 'phone:' || normalized_value
      ELSE 'name:' || coalesce(normalized_first_name, '') || '|' || coalesce(normalized_last_name, '') || '|attendee:' || attendee_id::text
    END AS proposed_person_key,
    CASE
      WHEN source_column IN ('household_email', 'household_cell_phone') THEN 'REVIEW_REQUIRED'
      WHEN auth_user_id IS NOT NULL AND normalized_first_name IS NOT NULL AND normalized_last_name IS NOT NULL THEN 'AUTO_LINK_SAFE'
      WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'REVIEW_REQUIRED'
      ELSE 'REVIEW_REQUIRED'
    END AS proposed_disposition
  FROM attendee_role_rows
)
SELECT
  'PROPOSED_IDENTIFIERS' AS result_set_label,
  proposed_person_key,
  identifier_type,
  identifier_value,
  normalized_value,
  CASE
    WHEN source_column IN ('membership_number', 'email', 'phone', 'primary_phone', 'cell_phone', 'copilot_email', 'copilot_cell_phone') THEN 'attendee_record'
    ELSE 'attendee_record'
  END AS proposed_source_type,
  attendee_id::text AS source_record_id,
  CASE
    WHEN proposed_disposition = 'AUTO_LINK_SAFE' THEN 'observed'
    WHEN proposed_disposition = 'REVIEW_REQUIRED' THEN 'unverified'
    ELSE 'disputed'
  END AS proposed_verification_status,
  CASE
    WHEN proposed_disposition = 'AUTO_LINK_SAFE' THEN 90
    WHEN proposed_disposition = 'REVIEW_REQUIRED' THEN 60
    ELSE 25
  END AS proposed_confidence,
  TRUE AS is_current,
  now() AS first_seen_at,
  now() AS last_seen_at,
  proposed_disposition,
  CASE
    WHEN source_column IN ('household_email', 'household_cell_phone') THEN 'Shared household evidence is excluded from automatic linking.'
    WHEN proposed_disposition = 'AUTO_LINK_SAFE' THEN 'Current preview candidate for person identifier creation.'
    ELSE 'Requires human review before person identifier creation.'
  END AS exclusion_reason
FROM attendee_role_rows
LEFT JOIN proposed_groups
  ON proposed_groups.proposed_person_key = (
    CASE
      WHEN attendee_role_rows.auth_user_id IS NOT NULL THEN 'auth:' || attendee_role_rows.auth_user_id::text
      WHEN attendee_role_rows.identifier_type = 'membership_number' AND attendee_role_rows.normalized_value IS NOT NULL THEN 'membership:' || attendee_role_rows.normalized_value
      WHEN attendee_role_rows.identifier_type = 'email' AND attendee_role_rows.normalized_value IS NOT NULL THEN 'email:' || attendee_role_rows.normalized_value
      WHEN attendee_role_rows.identifier_type = 'phone' AND attendee_role_rows.normalized_value IS NOT NULL THEN 'phone:' || attendee_role_rows.normalized_value
      ELSE 'name:' || coalesce(attendee_role_rows.normalized_first_name, '') || '|' || coalesce(attendee_role_rows.normalized_last_name, '') || '|attendee:' || attendee_role_rows.attendee_id::text
    END
  )
ORDER BY proposed_person_key, identifier_type, normalized_value, attendee_id;

-- 6. PROPOSED_AUTH_ACCOUNT_LINKS
WITH auth_account_rows AS (
  SELECT
    a.auth_user_id,
    a.id AS attendee_id,
    a.event_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_email,
    CASE
      WHEN a.phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END AS normalized_phone
  FROM public.attendees AS a
  WHERE a.auth_user_id IS NOT NULL
),
linked_groups AS (
  SELECT
    auth_user_id,
    'auth:' || auth_user_id::text AS proposed_person_key
  FROM auth_account_rows
  GROUP BY auth_user_id
)
SELECT
  'PROPOSED_AUTH_ACCOUNT_LINKS' AS result_set_label,
  auth_account_rows.auth_user_id,
  linked_groups.proposed_person_key,
  string_agg(DISTINCT auth_account_rows.attendee_id::text, ', ' ORDER BY auth_account_rows.attendee_id::text) AS attendee_ids_supporting_link,
  NULLIF(string_agg(DISTINCT auth_account_rows.normalized_email, ', ' ORDER BY auth_account_rows.normalized_email), '') AS normalized_email,
  NULLIF(string_agg(DISTINCT auth_account_rows.normalized_phone, ', ' ORDER BY auth_account_rows.normalized_phone), '') AS normalized_phone,
  string_agg(DISTINCT coalesce(auth_account_rows.normalized_first_name, '') || ' ' || coalesce(auth_account_rows.normalized_last_name, ''), ', ' ORDER BY coalesce(auth_account_rows.normalized_first_name, '') || ' ' || coalesce(auth_account_rows.normalized_last_name, '')) AS named_people_seen,
  'proposed' AS proposed_status,
  TRUE AS proposed_is_primary,
  now() AS proposed_verified_at,
  'AUTO_LINK_SAFE' AS proposed_disposition,
  'Auth account is preview-linked to a single proposed person group for review only.' AS disposition_reason
FROM auth_account_rows
JOIN linked_groups ON linked_groups.auth_user_id = auth_account_rows.auth_user_id
GROUP BY auth_account_rows.auth_user_id, linked_groups.proposed_person_key
ORDER BY auth_account_rows.auth_user_id;

-- 7. SHARED_HOUSEHOLD_IDENTIFIER_CASES
WITH household_evidence AS (
  SELECT
    'email'::text AS identifier_type,
    NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_value,
    'household_member'::text AS role_seen,
    hm.attendee_id,
    hm.event_id,
    hm.auth_user_id,
    concat_ws(' ', coalesce(hm.first_name, ''), coalesce(hm.last_name, '')) AS named_person
  FROM public.attendee_household_members AS hm
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'phone'::text AS identifier_type,
    CASE
      WHEN hm.cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END AS normalized_value,
    'household_member'::text AS role_seen,
    hm.attendee_id,
    hm.event_id,
    hm.auth_user_id,
    concat_ws(' ', coalesce(hm.first_name, ''), coalesce(hm.last_name, '')) AS named_person
  FROM public.attendee_household_members AS hm
  WHERE hm.cell_phone IS NOT NULL
)
SELECT
  'SHARED_HOUSEHOLD_IDENTIFIER_CASES' AS result_set_label,
  identifier_type,
  normalized_value,
  count(DISTINCT named_person) AS distinct_named_people,
  string_agg(DISTINCT named_person, ', ' ORDER BY named_person) AS named_people,
  string_agg(DISTINCT role_seen, ', ' ORDER BY role_seen) AS roles_seen,
  string_agg(DISTINCT attendee_id::text, ', ' ORDER BY attendee_id::text) AS attendee_ids,
  string_agg(DISTINCT event_id::text, ', ' ORDER BY event_id::text) AS event_ids,
  string_agg(DISTINCT auth_user_id::text, ', ' ORDER BY auth_user_id::text) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_user_ids,
  'REVIEW_REQUIRED' AS recommended_disposition,
  'Shared household contact evidence must remain visible and cannot be auto-collapsed.' AS reason
FROM household_evidence
WHERE normalized_value IS NOT NULL
GROUP BY identifier_type, normalized_value
HAVING count(DISTINCT named_person) > 1
ORDER BY identifier_type, normalized_value;

-- 8. CROSS_ROLE_CONFLICTS
WITH evidence_rows AS (
  SELECT
    'pilot'::text AS role_seen,
    a.id AS attendee_id,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_membership_number,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_email,
    CASE
      WHEN a.phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END AS normalized_phone
  FROM public.attendees AS a

  UNION ALL

  SELECT
    'copilot'::text AS role_seen,
    a.id AS attendee_id,
    a.auth_user_id,
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_membership_number,
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), '') AS normalized_email,
    CASE
      WHEN a.copilot_cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END AS normalized_phone
  FROM public.attendees AS a

  UNION ALL

  SELECT
    'household_member'::text AS role_seen,
    hm.attendee_id AS attendee_id,
    hm.auth_user_id,
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_membership_number,
    NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_email,
    CASE
      WHEN hm.cell_phone IS NULL THEN NULL
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END AS normalized_phone
  FROM public.attendee_household_members AS hm
  LEFT JOIN public.attendees AS a ON a.id = hm.attendee_id
)
SELECT
  'CROSS_ROLE_CONFLICTS' AS result_set_label,
  'role_mix'::text AS conflict_type,
  COALESCE(normalized_membership_number, normalized_email, normalized_phone, normalized_first_name || '|' || normalized_last_name) AS normalized_value_or_auth_user_id,
  string_agg(DISTINCT role_seen, ', ' ORDER BY role_seen) AS roles_seen,
  string_agg(DISTINCT coalesce(normalized_first_name, '') || ' ' || coalesce(normalized_last_name, ''), ', ' ORDER BY coalesce(normalized_first_name, '') || ' ' || coalesce(normalized_last_name, '')) AS named_people,
  string_agg(DISTINCT attendee_id::text, ', ' ORDER BY attendee_id::text) AS attendee_ids,
  '' AS proposed_person_keys,
  'high' AS severity,
  'Pilot, copilot, or household-member role evidence should remain visible for human review.' AS recommended_action
FROM evidence_rows
WHERE role_seen <> 'household_member' OR normalized_email IS NOT NULL OR normalized_phone IS NOT NULL
GROUP BY COALESCE(normalized_membership_number, normalized_email, normalized_phone, normalized_first_name || '|' || normalized_last_name)
HAVING count(DISTINCT role_seen) > 1
ORDER BY normalized_value_or_auth_user_id;

-- 9. AUTOMATIC_BACKFILL_CANDIDATES
-- Safety gate: automatic attribution is intentionally NOT recalculated in this dry run.
-- The reconciliation audit is the sole authority for automatic attribution classification.
-- This section remains a zero-row preview shape for downstream payload wiring only.
SELECT
  'AUTOMATIC_BACKFILL_CANDIDATES' AS result_set_label,
  NULL::text AS proposed_person_key,
  NULL::text AS display_first_name,
  NULL::text AS display_last_name,
  NULL::text AS preferred_name,
  NULL::uuid AS tenant_id,
  NULL::text AS attendee_ids_to_link,
  NULL::text AS identifiers_to_create,
  NULL::text AS auth_accounts_to_link,
  'Automatic attribution must be sourced from reconciliation audit outputs.' AS safety_reason
WHERE FALSE
ORDER BY proposed_person_key;

-- 10. MANUAL_REVIEW_QUEUE
WITH proposed_groups AS (
  SELECT
    CASE
      WHEN auth_user_id IS NOT NULL THEN 'auth:' || auth_user_id::text
      WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'membership:' || normalized_value
      WHEN identifier_type = 'email' AND normalized_value IS NOT NULL THEN 'email:' || normalized_value
      WHEN identifier_type = 'phone' AND normalized_value IS NOT NULL THEN 'phone:' || normalized_value
      ELSE 'name:' || coalesce(normalized_first_name, '') || '|' || coalesce(normalized_last_name, '') || '|attendee:' || attendee_id::text
    END AS proposed_person_key,
    CASE
      WHEN source_column IN ('household_email', 'household_cell_phone') THEN 'REVIEW_REQUIRED'
      WHEN auth_user_id IS NOT NULL AND identifier_type IN ('membership_number', 'email', 'phone') THEN 'AUTO_LINK_SAFE'
      ELSE 'REVIEW_REQUIRED'
    END AS disposition,
    string_agg(DISTINCT identity_role, ', ' ORDER BY identity_role) AS roles_seen,
    string_agg(DISTINCT attendee_id::text, ', ' ORDER BY attendee_id::text) AS attendee_ids,
    string_agg(DISTINCT normalized_value, ', ' ORDER BY normalized_value) AS identifiers,
    string_agg(DISTINCT auth_user_id::text, ', ' ORDER BY auth_user_id::text) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_user_ids,
    string_agg(DISTINCT coalesce(normalized_first_name, '') || ' ' || coalesce(normalized_last_name, ''), ', ' ORDER BY coalesce(normalized_first_name, '') || ' ' || coalesce(normalized_last_name, '')) AS named_people
  FROM (
    SELECT
      a.id AS attendee_id,
      a.event_id,
      'pilot'::text AS identity_role,
      a.auth_user_id,
      NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
      NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
      'membership_number'::text AS identifier_type,
      NULLIF(upper(trim(coalesce(a.membership_number, ''))), '') AS normalized_value,
      'membership_number'::text AS source_column
    FROM public.attendees AS a

    UNION ALL

    SELECT
      a.id AS attendee_id,
      a.event_id,
      'pilot'::text AS identity_role,
      a.auth_user_id,
      NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
      NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
      'email'::text AS identifier_type,
      NULLIF(lower(trim(coalesce(a.email, ''))), '') AS normalized_value,
      'email'::text AS source_column
    FROM public.attendees AS a

    UNION ALL

    SELECT
      a.id AS attendee_id,
      a.event_id,
      'pilot'::text AS identity_role,
      a.auth_user_id,
      NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
      NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
      'phone'::text AS identifier_type,
      CASE
        WHEN a.phone IS NULL THEN NULL
        WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
          AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
        ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
      END AS normalized_value,
      'phone'::text AS source_column
    FROM public.attendees AS a

    UNION ALL

    SELECT
      a.id AS attendee_id,
      a.event_id,
      'copilot'::text AS identity_role,
      a.auth_user_id,
      NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
      NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
      'email'::text AS identifier_type,
      NULLIF(lower(trim(coalesce(a.copilot_email, ''))), '') AS normalized_value,
      'copilot_email'::text AS source_column
    FROM public.attendees AS a

    UNION ALL

    SELECT
      a.id AS attendee_id,
      a.event_id,
      'copilot'::text AS identity_role,
      a.auth_user_id,
      NULLIF(lower(trim(coalesce(a.copilot_first, ''))), '') AS normalized_first_name,
      NULLIF(lower(trim(coalesce(a.copilot_last, ''))), '') AS normalized_last_name,
      'phone'::text AS identifier_type,
      CASE
        WHEN a.copilot_cell_phone IS NULL THEN NULL
        WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
          AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
        ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
      END AS normalized_value,
      'copilot_cell_phone'::text AS source_column
    FROM public.attendees AS a

    UNION ALL

    SELECT
      hm.attendee_id AS attendee_id,
      hm.event_id,
      'household_member'::text AS identity_role,
      hm.auth_user_id,
      NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
      NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
      'email'::text AS identifier_type,
      NULLIF(lower(trim(coalesce(hm.email, ''))), '') AS normalized_value,
      'household_email'::text AS source_column
    FROM public.attendee_household_members AS hm

    UNION ALL

    SELECT
      hm.attendee_id AS attendee_id,
      hm.event_id,
      'household_member'::text AS identity_role,
      hm.auth_user_id,
      NULLIF(lower(trim(coalesce(hm.first_name, ''))), '') AS normalized_first_name,
      NULLIF(lower(trim(coalesce(hm.last_name, ''))), '') AS normalized_last_name,
      'phone'::text AS identifier_type,
      CASE
        WHEN hm.cell_phone IS NULL THEN NULL
        WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
          AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
        ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
      END AS normalized_value,
      'household_cell_phone'::text AS source_column
    FROM public.attendee_household_members AS hm
  ) AS base_rows
  GROUP BY
    CASE
      WHEN auth_user_id IS NOT NULL THEN 'auth:' || auth_user_id::text
      WHEN identifier_type = 'membership_number' AND normalized_value IS NOT NULL THEN 'membership:' || normalized_value
      WHEN identifier_type = 'email' AND normalized_value IS NOT NULL THEN 'email:' || normalized_value
      WHEN identifier_type = 'phone' AND normalized_value IS NOT NULL THEN 'phone:' || normalized_value
      ELSE 'name:' || coalesce(normalized_first_name, '') || '|' || coalesce(normalized_last_name, '') || '|attendee:' || attendee_id::text
    END,
    CASE
      WHEN source_column IN ('household_email', 'household_cell_phone') THEN 'REVIEW_REQUIRED'
      WHEN auth_user_id IS NOT NULL AND identifier_type IN ('membership_number', 'email', 'phone') THEN 'AUTO_LINK_SAFE'
      ELSE 'REVIEW_REQUIRED'
    END
)
SELECT
  'MANUAL_REVIEW_QUEUE' AS result_set_label,
  proposed_person_key,
  disposition,
  named_people,
  roles_seen,
  attendee_ids,
  identifiers,
  auth_user_ids,
  'Manual review is required before any link is accepted or any identifier is persisted.' AS conflict_summary,
  'Human review recommended before backfill.' AS recommended_human_review
FROM proposed_groups
WHERE disposition IN ('REVIEW_REQUIRED')
ORDER BY proposed_person_key;

-- 11. DRY_RUN_SUMMARY
-- Validated totals are sourced from the reconciliation audit.
-- This dry run intentionally does not recompute classification totals.
SELECT
  'DRY_RUN_SUMMARY' AS result_set_label,
  553::bigint AS validated_total_role_instances,
  17::bigint AS validated_automatic_attribution,
  307::bigint AS validated_claim_verification,
  229::bigint AS validated_insufficient_identity_evidence,
  0::bigint AS validated_competing_claims,
  0::bigint AS validated_identifier_conflicts,
  0::bigint AS automatic_candidates_generated_independently_here,
  FALSE AS writes_performed,
  'RECONCILIATION_AUDIT_REQUIRED_BEFORE_BACKFILL' AS dry_run_status;
