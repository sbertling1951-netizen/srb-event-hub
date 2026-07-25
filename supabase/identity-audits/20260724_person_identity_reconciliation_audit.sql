/*
Person identity reconciliation audit — evidence-only, read-only.

Purpose:
  Expose the actual production identity evidence (events, attendee
  registrations, household-member rows, normalized identifiers, existing
  auth accounts, and the person-identity foundation tables) so that it can
  be inspected before any merge or conversion rules are designed.

Scope boundaries:
  - This file contains only SELECT statements and CTEs. It does not
    mutate data, create objects, define functions, or rely on any object
    outside the base tables it reads from.
  - This is not a reconciliation engine, not a system that sorts records
    into candidate groups, and not a readiness assessment. It does not decide which
    records represent the same person, does not propose automatic links,
    does not label conflicts, and does not evaluate account-conversion
    readiness. It reports evidence and simple, factual counts only.
  - Every result set below is an independent, self-contained SELECT
    statement. None of them depend on a prior result set, a temporary
    table, or a view.

Schema notes (confirmed by direct repository inspection, not by live
database introspection — see the accompanying report for anything that
remains an assumption):
  - public.events: id, name, event_code, start_date, end_date. There is no
    separate URL-path column on events, so Amana matching uses only name
    and event_code.
  - public.attendees: id, event_id, entry_id,
    membership_number, email, phone, primary_phone, cell_phone,
    copilot_email, copilot_cell_phone, pilot_first, pilot_last,
    copilot_first, copilot_last, auth_user_id, person_id.
  - public.attendee_household_members: id, attendee_id, event_id, entry_id,
    person_role ('pilot' | 'copilot' | 'additional'), first_name, last_name,
    nickname, display_name, email, cell_phone, auth_user_id. Every
    attendee_household_members row is preserved as HOUSEHOLD_MEMBER
    evidence, regardless of person_role. person_role is carried through as
    an additional context column so a HOUSEHOLD_MEMBER row can be
    identified as representing a pilot, copilot, or additional household
    member. It is evidence context only, never used to filter rows out of
    the audit.
  - auth_user_id sourcing: for PILOT and COPILOT evidence rows (sourced
    from attendees), auth_user_id = attendees.auth_user_id. For
    HOUSEHOLD_MEMBER evidence rows (sourced from
    attendee_household_members), auth_user_id =
    attendee_household_members.auth_user_id — a household row's own auth
    account is never silently replaced with its parent attendee's auth
    account. The parent attendee's auth_user_id is carried separately as
    parent_attendee_auth_user_id (NULL for PILOT/COPILOT rows, since those
    rows already are the attendee row) for review context only. All
    cross-auth and cross-role aggregation below is computed from each
    row's own auth_user_id, so household-only auth accounts are included.
  - public.people, public.person_identifiers, public.person_auth_accounts,
    public.identity_merge_audit: as created by
    supabase/migrations/20260724_create_person_identity_foundation.sql.

Phone normalization rule applied everywhere in this file:
  - Strip every non-digit character from the raw value.
  - If the stripped value is exactly 11 digits and the first digit is 1,
    drop the leading 1.
  - Otherwise the stripped digit string is preserved as-is.
  - The raw digit count (before the leading-1 rule is applied) is always
    retained alongside the normalized value.
  - Each phone-bearing column (phone, primary_phone, cell_phone,
    copilot_cell_phone, household cell_phone) is normalized
    independently. No phone column is ever collapsed into another with
    COALESCE.
*/

-- =========================================================================
-- 1. AMANA_EVENT_RESOLUTION
-- =========================================================================
WITH amana_events AS (
  SELECT
    id,
    name,
    event_code,
    start_date,
    end_date
  FROM public.events
  WHERE (
    lower(coalesce(name, '')) LIKE '%amana%'
    OR lower(coalesce(event_code, '')) LIKE '%amana%'
  )
  AND start_date >= DATE '2026-01-01'
  AND start_date < DATE '2027-01-01'
),
match_count AS (
  SELECT count(*) AS total_matching_event_count FROM amana_events
)
SELECT
  'AMANA_EVENT_RESOLUTION' AS result_set_name,
  ae.id AS event_id,
  ae.name AS event_name,
  ae.event_code,
  ae.start_date,
  ae.end_date,
  mc.total_matching_event_count,
  CASE
    WHEN mc.total_matching_event_count = 0 THEN 'NO_AMANA_2026_EVENT'
    WHEN mc.total_matching_event_count = 1 THEN 'SINGLE_AMANA_2026_EVENT'
    ELSE 'AMBIGUOUS_AMANA_2026_EVENTS'
  END AS resolution_status
FROM match_count mc
LEFT JOIN amana_events ae ON mc.total_matching_event_count > 0
ORDER BY ae.start_date NULLS LAST, ae.end_date NULLS LAST, ae.id NULLS LAST;

-- =========================================================================
-- 2. CURRENT_IDENTITY_FOUNDATION_STATE
-- =========================================================================
SELECT
  'CURRENT_IDENTITY_FOUNDATION_STATE' AS result_set_name,
  (SELECT count(*) FROM public.attendees) AS total_attendee_rows,
  (SELECT count(*) FROM public.attendees WHERE auth_user_id IS NOT NULL) AS attendee_rows_with_auth_user_id,
  (SELECT count(*) FROM public.attendees WHERE auth_user_id IS NULL) AS attendee_rows_without_auth_user_id,
  (SELECT count(DISTINCT auth_user_id) FROM public.attendees WHERE auth_user_id IS NOT NULL) AS distinct_auth_user_id_count,
  (SELECT count(*) FROM public.attendees WHERE person_id IS NOT NULL) AS attendee_rows_with_person_id,
  (SELECT count(*) FROM public.attendees WHERE person_id IS NULL) AS attendee_rows_without_person_id,
  (SELECT count(*) FROM public.people) AS people_row_count,
  (SELECT count(*) FROM public.person_identifiers) AS person_identifiers_row_count,
  (SELECT count(*) FROM public.person_auth_accounts) AS person_auth_accounts_row_count,
  (SELECT count(*) FROM public.identity_merge_audit) AS identity_merge_audit_row_count;

-- =========================================================================
-- 3. NORMALIZED_ATTENDEE_EVIDENCE
-- =========================================================================
SELECT
  'NORMALIZED_ATTENDEE_EVIDENCE' AS result_set_name,
  a.id AS attendee_id,
  a.event_id,
  e.name AS event_name,
  e.event_code,
  a.entry_id,
  a.auth_user_id,
  a.person_id,
  a.pilot_first,
  a.pilot_last,
  a.copilot_first,
  a.copilot_last,
  a.membership_number AS raw_membership_number,
  NULLIF(upper(trim(a.membership_number)), '') AS normalized_membership_number,
  a.email AS raw_pilot_email,
  NULLIF(lower(trim(a.email)), '') AS normalized_pilot_email,
  a.copilot_email AS raw_copilot_email,
  NULLIF(lower(trim(a.copilot_email)), '') AS normalized_copilot_email,
  a.phone AS raw_phone,
  CASE WHEN a.phone IS NULL THEN NULL ELSE regexp_replace(a.phone, '[^0-9]', '', 'g') END AS phone_digits,
  CASE WHEN a.phone IS NULL THEN NULL ELSE length(regexp_replace(a.phone, '[^0-9]', '', 'g')) END AS phone_digit_count,
  CASE
    WHEN a.phone IS NULL THEN NULL
    WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
      AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
    ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
  END AS normalized_phone,
  a.primary_phone AS raw_primary_phone,
  CASE WHEN a.primary_phone IS NULL THEN NULL ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g') END AS primary_phone_digits,
  CASE WHEN a.primary_phone IS NULL THEN NULL ELSE length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) END AS primary_phone_digit_count,
  CASE
    WHEN a.primary_phone IS NULL THEN NULL
    WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
      AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
    ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
  END AS normalized_primary_phone,
  a.cell_phone AS raw_cell_phone,
  CASE WHEN a.cell_phone IS NULL THEN NULL ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g') END AS cell_phone_digits,
  CASE WHEN a.cell_phone IS NULL THEN NULL ELSE length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) END AS cell_phone_digit_count,
  CASE
    WHEN a.cell_phone IS NULL THEN NULL
    WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
      AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
    ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
  END AS normalized_cell_phone,
  a.copilot_cell_phone AS raw_copilot_cell_phone,
  CASE WHEN a.copilot_cell_phone IS NULL THEN NULL ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') END AS copilot_cell_phone_digits,
  CASE WHEN a.copilot_cell_phone IS NULL THEN NULL ELSE length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) END AS copilot_cell_phone_digit_count,
  CASE
    WHEN a.copilot_cell_phone IS NULL THEN NULL
    WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
      AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
    ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
  END AS normalized_copilot_cell_phone
FROM public.attendees a
LEFT JOIN public.events e ON e.id = a.event_id
ORDER BY a.id;

-- =========================================================================
-- 4. NORMALIZED_ROLE_EVIDENCE
-- =========================================================================
WITH role_evidence_raw AS (
  -- PILOT: membership_number
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  -- PILOT: email
  SELECT
    'PILOT'::text,
    'pilot:' || a.id::text,
    'email'::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text,
    a.email,
    NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  -- PILOT: phone
  SELECT
    'PILOT'::text,
    'pilot:' || a.id::text,
    'phone'::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text,
    a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  -- PILOT: primary_phone
  SELECT
    'PILOT'::text,
    'pilot:' || a.id::text,
    'primary_phone'::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text,
    a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  -- PILOT: cell_phone
  SELECT
    'PILOT'::text,
    'pilot:' || a.id::text,
    'cell_phone'::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text,
    a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  -- COPILOT: email
  SELECT
    'COPILOT'::text,
    'copilot:' || a.id::text,
    'copilot_email'::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text,
    a.copilot_email,
    NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  -- COPILOT: copilot_cell_phone
  SELECT
    'COPILOT'::text,
    'copilot:' || a.id::text,
    'copilot_cell_phone'::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text,
    a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  -- HOUSEHOLD_MEMBER: email (every household-member row is preserved;
  -- person_role is carried as a context column, not used to filter)
  SELECT
    'HOUSEHOLD_MEMBER'::text,
    'household:' || hm.id::text,
    'household_email'::text,
    hm.attendee_id,
    hm.id,
    hm.event_id,
    e.name,
    e.event_code,
    hm.auth_user_id,
    a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text,
    hm.email,
    NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  -- HOUSEHOLD_MEMBER: cell_phone (person_role carried as context, not filtered)
  SELECT
    'HOUSEHOLD_MEMBER'::text,
    'household:' || hm.id::text,
    'household_cell_phone'::text,
    hm.attendee_id,
    hm.id,
    hm.event_id,
    e.name,
    e.event_code,
    hm.auth_user_id,
    a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text,
    hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
)
SELECT
  'NORMALIZED_ROLE_EVIDENCE' AS result_set_name,
  source_role,
  source_row_id,
  identifier_source,
  attendee_id,
  household_member_id,
  event_id,
  event_name,
  event_code,
  auth_user_id,
  parent_attendee_auth_user_id,
  person_id,
  human_name_context,
  person_role,
  identifier_type,
  raw_value,
  raw_digit_count,
  normalized_value,
  is_low_confidence,
  low_confidence_reason
FROM role_evidence_final
ORDER BY source_role, attendee_id, identifier_source;

-- =========================================================================
-- 5. LOW_CONFIDENCE_IDENTIFIERS
-- =========================================================================
WITH role_evidence_raw AS (
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text, a.email, NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'primary_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text, a.copilot_email, NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text, a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_email'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text, hm.email, NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_cell_phone'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text, hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
)
SELECT
  'LOW_CONFIDENCE_IDENTIFIERS' AS result_set_name,
  source_role,
  source_row_id,
  identifier_source,
  attendee_id,
  household_member_id,
  event_id,
  event_name,
  event_code,
  auth_user_id,
  parent_attendee_auth_user_id,
  person_id,
  human_name_context,
  person_role,
  identifier_type,
  raw_value,
  raw_digit_count,
  normalized_value,
  low_confidence_reason
FROM role_evidence_final
WHERE is_low_confidence = true
ORDER BY identifier_type, normalized_value, source_role, source_row_id;

-- =========================================================================
-- 6. REPEATED_IDENTIFIER_EVIDENCE
-- =========================================================================
WITH role_evidence_raw AS (
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text, a.email, NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'primary_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text, a.copilot_email, NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text, a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_email'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text, hm.email, NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_cell_phone'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text, hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
),
grouped AS (
  SELECT
    identifier_type,
    normalized_value,
    count(*) AS source_row_count,
    count(DISTINCT attendee_id) AS distinct_attendee_count,
    count(DISTINCT event_id) AS distinct_event_count,
    count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) AS distinct_auth_user_count,
    string_agg(DISTINCT source_role, ', ' ORDER BY source_role) AS roles,
    string_agg(DISTINCT identifier_source, ', ' ORDER BY identifier_source) AS identifier_sources,
    string_agg(DISTINCT source_row_id, ', ' ORDER BY source_row_id) AS source_row_ids,
    string_agg(DISTINCT attendee_id::text, ', ' ORDER BY attendee_id::text) AS attendee_ids,
    string_agg(DISTINCT household_member_id::text, ', ' ORDER BY household_member_id::text) FILTER (WHERE household_member_id IS NOT NULL) AS household_member_ids,
    string_agg(DISTINCT NULLIF(human_name_context, ''), ', ' ORDER BY NULLIF(human_name_context, '')) AS human_name_contexts,
    string_agg(DISTINCT (coalesce(event_name, '') || ' [' || coalesce(event_code, '') || ']'), ', ' ORDER BY (coalesce(event_name, '') || ' [' || coalesce(event_code, '') || ']')) AS events,
    string_agg(DISTINCT auth_user_id::text, ', ' ORDER BY auth_user_id::text) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_user_ids,
    bool_or(is_low_confidence) AS contains_low_confidence_evidence,
    (count(DISTINCT source_role) > 1) AS cross_role,
    (count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) > 1) AS cross_auth,
    (count(DISTINCT event_id) > 1) AS cross_event_reuse
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
  GROUP BY identifier_type, normalized_value
  HAVING count(*) > 1
)
SELECT
  'REPEATED_IDENTIFIER_EVIDENCE' AS result_set_name,
  g.identifier_type,
  g.normalized_value,
  g.source_row_count,
  g.distinct_attendee_count,
  g.distinct_event_count,
  g.distinct_auth_user_count,
  g.roles,
  g.identifier_sources,
  g.source_row_ids,
  g.attendee_ids,
  g.household_member_ids,
  g.human_name_contexts,
  g.events,
  g.auth_user_ids,
  g.contains_low_confidence_evidence,
  g.cross_role,
  g.cross_auth,
  EXISTS (
    SELECT 1
    FROM role_evidence_final r1
    JOIN role_evidence_final r2
      ON r1.attendee_id = r2.attendee_id
     AND r1.source_role <> r2.source_role
    WHERE r1.identifier_type = g.identifier_type
      AND r1.normalized_value = g.normalized_value
      AND r2.identifier_type = g.identifier_type
      AND r2.normalized_value = g.normalized_value
  ) AS same_registration_cross_role,
  g.cross_event_reuse
FROM grouped g
ORDER BY g.identifier_type, g.normalized_value;

-- =========================================================================
-- 7. CROSS_AUTH_IDENTIFIER_REUSE
-- =========================================================================
WITH role_evidence_raw AS (
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text, a.email, NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'primary_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text, a.copilot_email, NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text, a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_email'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text, hm.email, NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_cell_phone'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text, hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
)
SELECT
  'CROSS_AUTH_IDENTIFIER_REUSE' AS result_set_name,
  identifier_type,
  normalized_value,
  count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) AS distinct_auth_user_count,
  string_agg(DISTINCT auth_user_id::text, ', ' ORDER BY auth_user_id::text) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_user_ids,
  string_agg(DISTINCT attendee_id::text, ', ' ORDER BY attendee_id::text) AS attendee_ids,
  string_agg(DISTINCT (coalesce(event_name, '') || ' [' || coalesce(event_code, '') || ']'), ', ' ORDER BY (coalesce(event_name, '') || ' [' || coalesce(event_code, '') || ']')) AS events,
  string_agg(DISTINCT source_role, ', ' ORDER BY source_role) AS roles,
  string_agg(DISTINCT identifier_source, ', ' ORDER BY identifier_source) AS identifier_sources,
  string_agg(DISTINCT NULLIF(human_name_context, ''), ', ' ORDER BY NULLIF(human_name_context, '')) AS human_name_contexts
FROM role_evidence_final
WHERE normalized_value IS NOT NULL
  AND is_low_confidence = false
GROUP BY identifier_type, normalized_value
HAVING count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) > 1
ORDER BY identifier_type, normalized_value;

-- =========================================================================
-- 8. CROSS_ROLE_IDENTIFIER_REUSE
-- =========================================================================
WITH role_evidence_raw AS (
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text, a.email, NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'primary_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text, a.copilot_email, NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text, a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_email'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text, hm.email, NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_cell_phone'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text, hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
),
grouped AS (
  SELECT
    identifier_type,
    normalized_value,
    string_agg(DISTINCT source_role, ', ' ORDER BY source_role) AS roles,
    string_agg(DISTINCT identifier_source, ', ' ORDER BY identifier_source) AS identifier_sources,
    count(DISTINCT NULLIF(human_name_context, '')) AS distinct_human_name_context_count,
    string_agg(DISTINCT NULLIF(human_name_context, ''), ', ' ORDER BY NULLIF(human_name_context, '')) AS human_name_contexts,
    string_agg(DISTINCT attendee_id::text, ', ' ORDER BY attendee_id::text) AS attendee_ids,
    string_agg(DISTINCT household_member_id::text, ', ' ORDER BY household_member_id::text) FILTER (WHERE household_member_id IS NOT NULL) AS household_member_ids,
    string_agg(DISTINCT (coalesce(event_name, '') || ' [' || coalesce(event_code, '') || ']'), ', ' ORDER BY (coalesce(event_name, '') || ' [' || coalesce(event_code, '') || ']')) AS events,
    string_agg(DISTINCT auth_user_id::text, ', ' ORDER BY auth_user_id::text) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_user_ids,
    (count(DISTINCT event_id) > 1) AS cross_event_reuse
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
    AND identifier_type IN ('email', 'phone')
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT source_role) > 1
)
SELECT
  'CROSS_ROLE_IDENTIFIER_REUSE' AS result_set_name,
  g.identifier_type,
  g.normalized_value,
  g.roles,
  g.identifier_sources,
  g.distinct_human_name_context_count,
  g.human_name_contexts,
  g.attendee_ids,
  g.household_member_ids,
  g.events,
  g.auth_user_ids,
  EXISTS (
    SELECT 1
    FROM role_evidence_final r1
    JOIN role_evidence_final r2
      ON r1.attendee_id = r2.attendee_id
     AND r1.source_role <> r2.source_role
    WHERE r1.identifier_type = g.identifier_type
      AND r1.normalized_value = g.normalized_value
      AND r2.identifier_type = g.identifier_type
      AND r2.normalized_value = g.normalized_value
  ) AS same_registration_cross_role,
  g.cross_event_reuse
FROM grouped g
ORDER BY g.identifier_type, g.normalized_value;

-- =========================================================================
-- 9. AUTH_ACCOUNT_HISTORY
-- =========================================================================
WITH role_evidence_raw AS (
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text, a.email, NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'primary_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text, a.copilot_email, NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text, a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_email'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text, hm.email, NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_cell_phone'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text, hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
),
auth_base AS (
  SELECT DISTINCT auth_user_id
  FROM public.attendees
  WHERE auth_user_id IS NOT NULL

  UNION

  SELECT DISTINCT auth_user_id
  FROM public.attendee_household_members
  WHERE auth_user_id IS NOT NULL
),
attendee_stats AS (
  SELECT
    a.auth_user_id,
    count(*) AS attendee_registration_count,
    count(DISTINCT a.event_id) AS distinct_event_count,
    string_agg(DISTINCT a.id::text, ', ' ORDER BY a.id::text) AS attendee_ids,
    string_agg(DISTINCT (coalesce(e.name, '') || ' [' || coalesce(e.event_code, '') || ']'), ', ' ORDER BY (coalesce(e.name, '') || ' [' || coalesce(e.event_code, '') || ']')) AS events
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.auth_user_id IS NOT NULL
  GROUP BY a.auth_user_id
),
identifier_stats AS (
  SELECT
    auth_user_id,
    string_agg(DISTINCT normalized_value, ', ' ORDER BY normalized_value) FILTER (WHERE identifier_type = 'membership_number' AND is_low_confidence = false) AS reliable_membership_numbers,
    string_agg(DISTINCT normalized_value, ', ' ORDER BY normalized_value) FILTER (WHERE identifier_type = 'email' AND is_low_confidence = false) AS reliable_emails,
    string_agg(DISTINCT normalized_value, ', ' ORDER BY normalized_value) FILTER (WHERE identifier_type = 'phone' AND is_low_confidence = false) AS reliable_phones,
    string_agg(DISTINCT NULLIF(human_name_context, ''), ', ' ORDER BY NULLIF(human_name_context, '')) AS human_name_contexts,
    count(*) FILTER (WHERE is_low_confidence = true) AS low_confidence_identifier_count
  FROM role_evidence_final
  WHERE auth_user_id IS NOT NULL
  GROUP BY auth_user_id
),
cross_auth_identifiers AS (
  SELECT identifier_type, normalized_value
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
    AND is_low_confidence = false
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) > 1
),
cross_role_identifiers AS (
  SELECT identifier_type, normalized_value
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
    AND identifier_type IN ('email', 'phone')
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT source_role) > 1
),
reuse_counts AS (
  SELECT
    re.auth_user_id,
    count(DISTINCT (re.identifier_type, re.normalized_value)) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM cross_auth_identifiers ca
        WHERE ca.identifier_type = re.identifier_type AND ca.normalized_value = re.normalized_value
      )
    ) AS cross_auth_reused_identifier_count,
    count(DISTINCT (re.identifier_type, re.normalized_value)) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM cross_role_identifiers cr
        WHERE cr.identifier_type = re.identifier_type AND cr.normalized_value = re.normalized_value
      )
    ) AS cross_role_reused_identifier_count
  FROM role_evidence_final re
  WHERE re.auth_user_id IS NOT NULL
  GROUP BY re.auth_user_id
)
SELECT
  'AUTH_ACCOUNT_HISTORY' AS result_set_name,
  ab.auth_user_id,
  coalesce(ats.attendee_registration_count, 0) AS attendee_registration_count,
  coalesce(ats.distinct_event_count, 0) AS distinct_event_count,
  ats.attendee_ids,
  ats.events,
  ids.reliable_membership_numbers,
  ids.reliable_emails,
  ids.reliable_phones,
  ids.human_name_contexts,
  coalesce(ids.low_confidence_identifier_count, 0) AS low_confidence_identifier_count,
  coalesce(rc.cross_auth_reused_identifier_count, 0) AS cross_auth_reused_identifier_count,
  coalesce(rc.cross_role_reused_identifier_count, 0) AS cross_role_reused_identifier_count
FROM auth_base ab
LEFT JOIN attendee_stats ats ON ats.auth_user_id = ab.auth_user_id
LEFT JOIN identifier_stats ids ON ids.auth_user_id = ab.auth_user_id
LEFT JOIN reuse_counts rc ON rc.auth_user_id = ab.auth_user_id
ORDER BY ab.auth_user_id;

-- =========================================================================
-- 10. AMANA_AUTH_ACCOUNT_HISTORY
-- =========================================================================
WITH amana_events AS (
  SELECT id
  FROM public.events
  WHERE (
    lower(coalesce(name, '')) LIKE '%amana%'
    OR lower(coalesce(event_code, '')) LIKE '%amana%'
  )
  AND start_date >= DATE '2026-01-01'
  AND start_date < DATE '2027-01-01'
),
match_count AS (
  SELECT count(*) AS matching_amana_event_count FROM amana_events
),
role_evidence_raw AS (
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text, a.email, NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'primary_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text, a.copilot_email, NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text, a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_email'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text, hm.email, NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_cell_phone'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text, hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
),
amana_auth_base AS (
  SELECT DISTINCT a.auth_user_id
  FROM public.attendees a
  WHERE a.auth_user_id IS NOT NULL
    AND a.event_id IN (SELECT id FROM amana_events)

  UNION

  SELECT DISTINCT hm.auth_user_id
  FROM public.attendee_household_members hm
  WHERE hm.auth_user_id IS NOT NULL
    AND hm.event_id IN (SELECT id FROM amana_events)
),
amana_stats AS (
  SELECT
    a.auth_user_id,
    string_agg(DISTINCT a.id::text, ', ' ORDER BY a.id::text) AS amana_attendee_ids,
    string_agg(DISTINCT (coalesce(e.name, '') || ' [' || coalesce(e.event_code, '') || ']'), ', ' ORDER BY (coalesce(e.name, '') || ' [' || coalesce(e.event_code, '') || ']')) AS amana_event_records
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.auth_user_id IS NOT NULL
    AND a.event_id IN (SELECT id FROM amana_events)
  GROUP BY a.auth_user_id
),
all_stats AS (
  SELECT
    a.auth_user_id,
    string_agg(DISTINCT a.id::text, ', ' ORDER BY a.id::text) AS all_attendee_ids,
    string_agg(DISTINCT (coalesce(e.name, '') || ' [' || coalesce(e.event_code, '') || ']'), ', ' ORDER BY (coalesce(e.name, '') || ' [' || coalesce(e.event_code, '') || ']')) AS all_event_records
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.auth_user_id IS NOT NULL
  GROUP BY a.auth_user_id
),
identifier_stats AS (
  SELECT
    auth_user_id,
    string_agg(DISTINCT normalized_value, ', ' ORDER BY normalized_value) FILTER (WHERE identifier_type = 'membership_number' AND is_low_confidence = false) AS reliable_membership_numbers,
    string_agg(DISTINCT normalized_value, ', ' ORDER BY normalized_value) FILTER (WHERE identifier_type = 'email' AND is_low_confidence = false) AS reliable_emails,
    string_agg(DISTINCT normalized_value, ', ' ORDER BY normalized_value) FILTER (WHERE identifier_type = 'phone' AND is_low_confidence = false) AS reliable_phones,
    count(*) FILTER (WHERE is_low_confidence = true) AS low_confidence_identifier_count
  FROM role_evidence_final
  WHERE auth_user_id IS NOT NULL
  GROUP BY auth_user_id
),
cross_auth_identifiers AS (
  SELECT identifier_type, normalized_value
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
    AND is_low_confidence = false
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) > 1
),
cross_role_identifiers AS (
  SELECT identifier_type, normalized_value
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
    AND identifier_type IN ('email', 'phone')
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT source_role) > 1
),
reuse_counts AS (
  SELECT
    re.auth_user_id,
    count(DISTINCT (re.identifier_type, re.normalized_value)) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM cross_auth_identifiers ca
        WHERE ca.identifier_type = re.identifier_type AND ca.normalized_value = re.normalized_value
      )
    ) AS cross_auth_reused_identifier_count,
    count(DISTINCT (re.identifier_type, re.normalized_value)) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM cross_role_identifiers cr
        WHERE cr.identifier_type = re.identifier_type AND cr.normalized_value = re.normalized_value
      )
    ) AS cross_role_reused_identifier_count
  FROM role_evidence_final re
  WHERE re.auth_user_id IS NOT NULL
  GROUP BY re.auth_user_id
)
SELECT
  'AMANA_AUTH_ACCOUNT_HISTORY' AS result_set_name,
  ab.auth_user_id,
  ams.amana_attendee_ids,
  ams.amana_event_records,
  als.all_attendee_ids,
  als.all_event_records,
  ids.reliable_membership_numbers,
  ids.reliable_emails,
  ids.reliable_phones,
  coalesce(ids.low_confidence_identifier_count, 0) AS low_confidence_identifier_count,
  coalesce(rc.cross_auth_reused_identifier_count, 0) AS cross_auth_reused_identifier_count,
  coalesce(rc.cross_role_reused_identifier_count, 0) AS cross_role_reused_identifier_count,
  mc.matching_amana_event_count,
  CASE
    WHEN mc.matching_amana_event_count = 0 THEN 'NO_AMANA_2026_EVENT'
    WHEN mc.matching_amana_event_count = 1 THEN 'SINGLE_AMANA_2026_EVENT'
    ELSE 'AMBIGUOUS_AMANA_2026_EVENTS'
  END AS amana_resolution_status
FROM amana_auth_base ab
CROSS JOIN match_count mc
LEFT JOIN amana_stats ams ON ams.auth_user_id = ab.auth_user_id
LEFT JOIN all_stats als ON als.auth_user_id = ab.auth_user_id
LEFT JOIN identifier_stats ids ON ids.auth_user_id = ab.auth_user_id
LEFT JOIN reuse_counts rc ON rc.auth_user_id = ab.auth_user_id
ORDER BY ab.auth_user_id;

-- =========================================================================
-- 11. AUDIT_SUMMARY
-- =========================================================================
WITH amana_events AS (
  SELECT id
  FROM public.events
  WHERE (
    lower(coalesce(name, '')) LIKE '%amana%'
    OR lower(coalesce(event_code, '')) LIKE '%amana%'
  )
  AND start_date >= DATE '2026-01-01'
  AND start_date < DATE '2027-01-01'
),
role_evidence_raw AS (
  SELECT
    'PILOT'::text AS source_role,
    'pilot:' || a.id::text AS source_row_id,
    'membership_number'::text AS identifier_source,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    a.auth_user_id,
    a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS human_name_context,
    'membership_number'::text AS identifier_type,
    a.membership_number AS raw_value,
    NULL::integer AS raw_digit_count,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_value,
    NULL::text AS person_role,
    NULL::uuid AS parent_attendee_auth_user_id
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.membership_number IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'email'::text, a.email, NULL::integer,
    NULLIF(lower(trim(a.email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.email IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.phone,
    length(regexp_replace(a.phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'primary_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.primary_phone,
    length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.primary_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.primary_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.primary_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.primary_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.primary_phone IS NOT NULL

  UNION ALL

  SELECT
    'PILOT'::text, 'pilot:' || a.id::text, 'cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.pilot_first, a.pilot_last),
    'phone'::text, a.cell_phone,
    length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_email'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'email'::text, a.copilot_email, NULL::integer,
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_email IS NOT NULL

  UNION ALL

  SELECT
    'COPILOT'::text, 'copilot:' || a.id::text, 'copilot_cell_phone'::text,
    a.id, NULL::uuid, a.event_id, e.name, e.event_code, a.auth_user_id, a.person_id,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    'phone'::text, a.copilot_cell_phone,
    length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g')
    END,
    NULL::text,
    NULL::uuid
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_email'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'email'::text, hm.email, NULL::integer,
    NULLIF(lower(trim(hm.email)), ''),
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.email IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text, 'household:' || hm.id::text, 'household_cell_phone'::text,
    hm.attendee_id, hm.id, hm.event_id, e.name, e.event_code, hm.auth_user_id, a.person_id,
    concat_ws(' ', hm.first_name, hm.last_name),
    'phone'::text, hm.cell_phone,
    length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')),
    CASE
      WHEN length(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), 1) = '1'
        THEN substring(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(hm.cell_phone, '[^0-9]', '', 'g')
    END,
    hm.person_role,
    a.auth_user_id
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
  WHERE hm.cell_phone IS NOT NULL
),
role_evidence AS (
  SELECT
    r.*,
    CASE
      WHEN r.identifier_type = 'membership_number' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value IN ('TEST', 'DEMO', 'EXAMPLE', 'UNKNOWN', 'NONE', 'N/A') THEN 'Placeholder-like membership value'
          WHEN r.normalized_value ~ '^0+$' THEN 'All-zero numeric membership value'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated characters in membership value'
          WHEN length(r.normalized_value) < 3 THEN 'Unreasonably short membership value'
          ELSE NULL
        END
      WHEN r.identifier_type = 'email' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.normalized_value NOT LIKE '%@%' THEN 'Email missing @ symbol'
          WHEN split_part(r.normalized_value, '@', 1) = '' THEN 'Email missing local part'
          WHEN split_part(r.normalized_value, '@', 2) = '' THEN 'Email missing domain'
          WHEN r.normalized_value LIKE '%example%' OR r.normalized_value LIKE '%test%' OR r.normalized_value LIKE '%demo%' THEN 'Obvious example/test/demo email pattern'
          ELSE NULL
        END
      WHEN r.identifier_type = 'phone' AND r.normalized_value IS NOT NULL THEN
        CASE
          WHEN r.raw_digit_count < 10 THEN 'Fewer than 10 digits'
          WHEN r.raw_digit_count > 11 THEN 'More than 11 digits'
          WHEN r.raw_digit_count = 11 AND length(r.normalized_value) = 11 THEN '11 digits not beginning with 1'
          WHEN r.normalized_value = repeat(left(r.normalized_value, 1), length(r.normalized_value)) THEN 'All repeated digits'
          WHEN r.normalized_value IN ('1234567890', '0123456789', '9876543210') THEN 'Sequential test pattern'
          ELSE NULL
        END
      ELSE NULL
    END AS low_confidence_reason
  FROM role_evidence_raw r
),
role_evidence_final AS (
  SELECT
    re.*,
    (re.low_confidence_reason IS NOT NULL) AS is_low_confidence
  FROM role_evidence re
),
repeated AS (
  SELECT identifier_type, normalized_value
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
  GROUP BY identifier_type, normalized_value
  HAVING count(*) > 1
),
cross_auth AS (
  SELECT identifier_type, normalized_value
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
    AND is_low_confidence = false
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL) > 1
),
cross_role AS (
  SELECT identifier_type, normalized_value
  FROM role_evidence_final
  WHERE normalized_value IS NOT NULL
    AND identifier_type IN ('email', 'phone')
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT source_role) > 1
)
SELECT
  'AUDIT_SUMMARY' AS result_set_name,
  (SELECT count(*) FROM amana_events) AS amana_matching_event_count,
  CASE
    WHEN (SELECT count(*) FROM amana_events) = 0 THEN 'NO_AMANA_2026_EVENT'
    WHEN (SELECT count(*) FROM amana_events) = 1 THEN 'SINGLE_AMANA_2026_EVENT'
    ELSE 'AMBIGUOUS_AMANA_2026_EVENTS'
  END AS amana_resolution_status,
  (SELECT count(*) FROM public.attendees) AS total_attendee_registrations,
  (SELECT count(DISTINCT auth_user_id) FROM public.attendees WHERE auth_user_id IS NOT NULL) AS total_distinct_auth_accounts,
  (SELECT count(*) FROM public.attendees WHERE person_id IS NOT NULL) AS total_attendee_rows_with_person_id,
  (SELECT count(*) FROM public.people) AS total_people_rows,
  (SELECT count(*) FROM role_evidence_final) AS total_normalized_identifier_evidence_rows,
  (SELECT count(*) FROM role_evidence_final WHERE is_low_confidence = true) AS total_low_confidence_identifier_rows,
  (SELECT count(*) FROM repeated) AS total_repeated_identifiers,
  (SELECT count(*) FROM cross_auth) AS total_cross_auth_reused_identifiers,
  (SELECT count(*) FROM cross_role) AS total_cross_role_reused_identifiers,
  (
    SELECT count(DISTINCT auth_user_id) FROM (
      SELECT a.auth_user_id
      FROM public.attendees a
      WHERE a.auth_user_id IS NOT NULL
        AND a.event_id IN (SELECT id FROM amana_events)

      UNION

      SELECT hm.auth_user_id
      FROM public.attendee_household_members hm
      WHERE hm.auth_user_id IS NOT NULL
        AND hm.event_id IN (SELECT id FROM amana_events)
    ) AS amana_auth_union
  ) AS total_authenticated_amana_users;
