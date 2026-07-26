-- ============================================================================
-- 20260724_auth_identity_attribution_audit.sql
--
-- READ-ONLY EVIDENCE AUDIT. Every statement below is a self-contained
-- SELECT ... WITH ... query. This file contains no INSERT, UPDATE, DELETE,
-- CREATE, ALTER, DROP, DO, CALL, function, view, or temp-table statement,
-- and it must never be executed as part of an automated migration or
-- application code path. It is intended to be run manually, read-only,
-- against a copy of production data or a read replica, for human review.
--
-- PURPOSE
-- This audit proposes candidate links between registration roles
-- (PILOT / COPILOT / HOUSEHOLD_MEMBER) and auth.users accounts, as
-- preparation for a future person-identity backfill. It does not assign,
-- merge, or create any person identity. It only classifies the strength
-- and shape of existing evidence.
--
-- WHY THIS FILE WAS REDESIGNED
-- A prior version of this audit joined every registration role against
-- every auth user (JOIN auth_users_canonical au ON TRUE) and then tried to
-- classify the resulting Cartesian product. That approach manufactures
-- ambiguity and contradictions that do not actually exist in the data: a
-- role with no real relationship to a given auth user still produced a
-- comparison row against it, and once enough of those accumulate, roles
-- start to look "contested" purely as an artifact of the join, not because
-- the evidence disagrees with itself.
--
-- This version generates candidates evidence-first. A role instance is
-- only ever compared against an auth.users row when there is a concrete,
-- equality-based reason to do so:
--   - the role's own source row carries a role-scoped auth_user_id, or
--   - the role's normalized email exactly equals the auth user's
--     normalized email, or
--   - one of the role's normalized phone numbers exactly equals the auth
--     user's normalized phone number.
-- Every join in this file is an equality join on one of those three
-- evidence types. There is no unconditional join anywhere in this file.
--
-- Names are never used to originate a candidate. They are only consulted,
-- as a single combined corroboration signal, once a role instance already
-- has exactly one matching auth user from the evidence above. A first-name
-- match, a last-name match, and a full-name match are not treated as three
-- independent positive signals; the strongest available combination of
-- first+last (or display/full name as a fallback) collapses to one
-- boolean, so name evidence can only support or fail to support an
-- already-evidenced candidate, never manufacture one on its own.
-- A unique exact normalized email or unique exact normalized phone match to
-- exactly one auth.users account is treated as system-verified authentication
-- evidence because those identifiers are used by the login system to create or
-- resolve the auth account. Name agreement remains diagnostic corroboration
-- only and is not required once a unique login identifier has matched. A role
-- with stored contact information but no matching auth.users account is labeled
-- UNVERIFIED_NO_AUTH_ACCOUNT, meaning no authenticated login has yet occurred;
-- it is not treated as a failed or weak verification.
--
-- Contradictions (CONTRADICTORY_IDENTIFIER_EVIDENCE) are only ever
-- detected within a single role instance's own evidence -- e.g. its
-- role-scoped auth account and its exact-email match disagree.
--
-- REPEATED REGISTRATIONS ARE NOT AUTOMATICALLY CONFLICTS
-- The same auth account legitimately matching more than one role instance
-- is not, by itself, evidence of a conflict. A durable person may
-- correctly appear as pilot or copilot at multiple events, as a household
-- member at multiple events, or represented in both attendees and
-- attendee_household_members within a single registration -- and matching
-- the same auth account across those rows can be positive longitudinal
-- identity evidence rather than a problem. When more than one role
-- instance strongly matches the same auth account, this file compares
-- those rows only against each other (never against unrelated people who
-- simply happen to exist in the database) using conservative descriptors
-- -- normalized full name together, exact normalized email, exact
-- normalized phone, plus event/registration context -- and classifies the
-- group as:
--   REPEATED_CONSISTENT_PERSON_EVIDENCE: descriptors agree (or do not
--     conflict) across rows spanning more than one event.
--   DUPLICATE_ROLE_REPRESENTATION: descriptors agree (or do not conflict)
--     and every matched row is within the same event/registration -- e.g.
--     the same person listed both as the pilot's attendees row and as a
--     household member row.
--   COMPETING_PERSON_CLAIMS: at least one descriptor dimension (name,
--     email, or phone) disagrees between two of the matched rows and no
--     other dimension corroborates a match between them -- a genuine
--     conflict, not a repeat registration.
-- Names remain corroborating evidence only in this comparison; they never
-- originate a candidate on their own, consistent with the rule above.
-- Only COMPETING_PERSON_CLAIMS overrides a row's attribution_disposition
-- and removes it from automatic-attribution eligibility.
--
-- ROLE-SCOPED VS. REGISTRATION-CONTEXT AUTH EVIDENCE
-- attendees.auth_user_id is treated as role-scoped evidence for the PILOT
-- role (the pilot is the named primary registrant on that row), but only
-- as registration-context evidence for the COPILOT role, because the
-- schema has no copilot-specific auth column and there is no database-
-- level proof that the authenticated account belongs to the copilot
-- rather than the pilot. attendee_household_members.auth_user_id is
-- treated as role-scoped for that household member specifically (it is
-- the member's own column); the parent attendee's auth_user_id is kept as
-- separate registration-context evidence
-- (registration_context_auth_user_id), never silently merged into the
-- household member's own auth identity. Registration-context evidence is
-- never used, by itself, to originate an identity match; it is reported
-- (REGISTRATION_CONTEXT_ONLY) but never promoted into an automatic
-- attribution candidate.
--
-- PHONE NORMALIZATION CONVENTION
-- Strip all non-digit characters. If the result is exactly 11 digits and
-- the leading digit is '1', strip the leading '1'. Otherwise the stripped
-- digit string is used as-is. Multiple raw phone columns are never
-- COALESCE-collapsed into a single value; each is normalized and compared
-- independently.
--
-- FCOC MEMBERSHIP NUMBER RULE (preserved exactly, not re-derived)
-- Membership numbers identify the household membership, not a person, and
-- may represent up to six people. They are carried in this audit only as
-- diagnostic context and never participate in auth or identity matching.
--
-- SCHEMA FACTS THIS FILE DEPENDS ON (confirmed via information_schema
-- against production earlier in this project; re-verify before reuse if
-- the schema may have changed):
--   public.attendees: id, event_id, auth_user_id, person_id, email, phone,
--     primary_phone, cell_phone, pilot_first, pilot_last, copilot_first,
--     copilot_last, copilot_email, copilot_cell_phone, membership_number.
--     No registration_id column.
--   public.attendee_household_members: id, attendee_id, event_id,
--     auth_user_id, email, cell_phone, first_name, last_name, person_role
--     ('pilot' | 'copilot' | 'additional'). No person_id column yet.
--   public.events: id, name, event_code. No slug column.
--   public.person_auth_accounts: id, person_id, auth_user_id, status,
--     is_primary, linked_at, verified_at, retired_at, created_at,
--     updated_at. No provider or provider_subject column -- a prior
--     version of this file's EXISTING_PERSON_AUTH_LINKS result set
--     referenced paa.provider / paa.provider_subject, which do not exist
--     on this table; that reference has been corrected below.
--   auth.users: id, email, phone, raw_user_meta_data, created_at,
--     last_sign_in_at.
-- ============================================================================

-- RESULT SET 1: AUTH_ATTRIBUTION_METADATA
-- Observed row counts and the fixed business rule this audit must never
-- violate. No role-to-auth comparison happens in this statement.
-- ============================================================================
SELECT
  'AUTH_ATTRIBUTION_METADATA'::text AS result_set_label,
  now() AS generated_at,
  (SELECT count(*) FROM public.attendees) AS total_attendee_rows,
  (SELECT count(*) FROM public.attendee_household_members) AS total_household_member_rows,
  (SELECT count(*) FROM auth.users) AS total_auth_user_rows,
  (SELECT count(*) FROM public.person_auth_accounts) AS total_existing_person_auth_links,
  (SELECT count(*) FROM public.people) AS total_person_rows,
  'evidence-first candidate generation; no unconditional (ON TRUE) joins in this file'::text AS attribution_methodology,
  'Membership numbers identify the household membership, not a person, and may represent up to six people. They must never participate in person identity resolution.'::text AS confirmed_membership_rule;

-- ============================================================================
-- RESULT SET 2: AUTH_USER_SOURCE_DATA
-- Normalized auth.users rows with diagnostic flags. This statement never
-- references any registration role, so it carries no risk of the
-- cross-join flaw; it exists purely to expose what the auth-side evidence
-- actually looks like.
-- ============================================================================
WITH
auth_users_normalized AS (
  SELECT
    u.id AS auth_user_id,
    u.email AS auth_email_raw,
    NULLIF(lower(trim(coalesce(u.email, ''))), '') AS auth_email_normalized,
    u.phone AS auth_phone_raw,
    CASE
      WHEN length(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), '')
    END AS auth_phone_normalized,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'first_name')::text, ''))), '') AS metadata_first_name,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'last_name')::text, ''))), '') AS metadata_last_name,
    NULLIF(lower(trim(coalesce(coalesce((u.raw_user_meta_data ->> 'display_name')::text, (u.raw_user_meta_data ->> 'full_name')::text), ''))), '') AS metadata_display_name,
    u.created_at AS auth_created_at,
    u.last_sign_in_at AS auth_last_sign_in_at
  FROM auth.users AS u
)
SELECT
  'AUTH_USER_SOURCE_DATA'::text AS result_set_label,
  auth_user_id,
  auth_email_raw,
  auth_email_normalized,
  auth_phone_raw,
  auth_phone_normalized,
  metadata_first_name,
  metadata_last_name,
  metadata_display_name,
  auth_created_at,
  auth_last_sign_in_at,
  (auth_email_normalized IS NULL AND auth_phone_normalized IS NULL) AS no_usable_contact_identifier,
  (metadata_first_name IS NULL AND metadata_last_name IS NULL AND metadata_display_name IS NULL) AS no_usable_metadata_name
FROM auth_users_normalized
ORDER BY auth_created_at;

-- ============================================================================
-- RESULT SET 3: REGISTRATION_ROLE_CANDIDATES
-- One row per registration role instance (PILOT, COPILOT, or
-- HOUSEHOLD_MEMBER), with its own identifying evidence and its own
-- role-scoped vs. registration-context auth columns kept separate. This
-- is the full candidate population before any auth-side matching happens.
-- ============================================================================
WITH
role_evidence AS (
  SELECT
    'PILOT'::text AS role_type,
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id AS event_id,
    e.name AS event_name,
    e.event_code AS event_code,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS role_person_name_raw,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS role_first_name_normalized,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS role_last_name_normalized,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS identifier_email_normalized,
    CASE
      WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_1,
    CASE
      WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_2,
    CASE
      WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_3,
    a.auth_user_id AS role_scoped_auth_user_id,
    NULL::uuid AS registration_context_auth_user_id,
    a.membership_number::text AS membership_number,
    NULL::text AS source_person_role
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id

  UNION ALL

  SELECT
    'COPILOT'::text,
    'attendee_copilot:' || a.id::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    NULL::uuid,
    a.auth_user_id,
    a.membership_number::text,
    NULL::text
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_first IS NOT NULL
     OR a.copilot_last IS NOT NULL
     OR a.copilot_email IS NOT NULL
     OR a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text,
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.id,
    hm.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', hm.first_name, hm.last_name),
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    hm.auth_user_id,
    a.auth_user_id,
    a.membership_number::text,
    hm.person_role
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
)
SELECT
  'REGISTRATION_ROLE_CANDIDATES'::text AS result_set_label,
  role_type,
  role_instance_key,
  attendee_id,
  household_member_id,
  event_id,
  event_name,
  event_code,
  role_person_name_raw,
  role_first_name_normalized,
  role_last_name_normalized,
  identifier_email_normalized,
  identifier_phone_normalized_1,
  identifier_phone_normalized_2,
  identifier_phone_normalized_3,
  role_scoped_auth_user_id,
  registration_context_auth_user_id,
  membership_number,
  source_person_role
FROM role_evidence
ORDER BY role_type, event_id, role_instance_key;

-- ============================================================================
-- RESULT SET 4: AUTH_USER_ROLE_MATCH_CANDIDATES
-- The core evidence-first candidate pipeline. Every join below is an
-- equality join on role-scoped auth id, exact normalized email, or exact
-- normalized phone -- never an unconditional join. Name evidence is only
-- consulted once a role instance already has exactly one such candidate.
-- Contradictions within a single role instance's own evidence
-- (CONTRADICTORY_IDENTIFIER_EVIDENCE) are unchanged from the prior version.
--
-- Multi-row conflicts (the same auth account matching more than one role
-- instance) are no longer flagged just because more than one row matched.
-- A durable person legitimately appears more than once: as pilot/copilot/
-- household member at multiple registrations, or represented in both
-- attendees and attendee_household_members within one registration. Those
-- rows are compared only against each other (never against unrelated
-- people), and strong identifiers (exact normalized email, exact
-- normalized phone) are evaluated separately from name corroboration --
-- a matching name can never reconcile a genuine email or phone
-- disagreement; only another strong identifier can. Registration identity
-- is attendee_id, not event_id -- two different registrations at the same
-- event are never treated as the same registration. Groups are classified
-- as:
--   REPEATED_CONSISTENT_PERSON_EVIDENCE: no unresolved conflict, and the
--     matched rows span more than one distinct attendee_id (registration).
--   DUPLICATE_ROLE_REPRESENTATION: no unresolved conflict, and every
--     matched row shares the same attendee_id (e.g. also listed as a
--     household member on the same registration).
--   COMPETING_PERSON_CLAIMS: an unresolved strong-identifier conflict
--     (differing email or phone with no other strong identifier to
--     reconcile it), or -- only when no strong identifier data exists at
--     all -- a name disagreement.
-- Only COMPETING_PERSON_CLAIMS overrides attribution_disposition and
-- removes automatic-candidate eligibility; the other two do not downgrade
-- the row merely because it recurs. The audit now also derives a separate
-- identification_assurance_level so the same row can be classified as:
--   AUTOMATIC_ATTRIBUTION applies when role-scoped auth evidence exists or
--     when a unique exact normalized email or phone matches exactly one
--     auth.users account,
--   ACCEPTABLE_CLAIM_VERIFICATION (non-conflicting, with usable names,
--     a known event, and enough contextual evidence to justify asking the
--     person verification questions), or
--   INSUFFICIENT_FOR_IDENTITY_CLAIM (everything else). Claim verification
--   authorizes only the question-and-answer workflow; it never authorizes
--   automatic identity linking.
-- ============================================================================
WITH
role_evidence AS (
  SELECT
    'PILOT'::text AS role_type,
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id AS event_id,
    e.name AS event_name,
    e.event_code AS event_code,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS role_person_name_raw,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS role_first_name_normalized,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS role_last_name_normalized,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS identifier_email_normalized,
    CASE
      WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_1,
    CASE
      WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_2,
    CASE
      WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_3,
    a.auth_user_id AS role_scoped_auth_user_id,
    NULL::uuid AS registration_context_auth_user_id,
    a.membership_number::text AS membership_number,
    NULL::text AS source_person_role
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id

  UNION ALL

  SELECT
    'COPILOT'::text,
    'attendee_copilot:' || a.id::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    NULL::uuid,
    a.auth_user_id,
    a.membership_number::text,
    NULL::text
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_first IS NOT NULL
     OR a.copilot_last IS NOT NULL
     OR a.copilot_email IS NOT NULL
     OR a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text,
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.id,
    hm.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', hm.first_name, hm.last_name),
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    hm.auth_user_id,
    a.auth_user_id,
    a.membership_number::text,
    hm.person_role
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
),
auth_users_normalized AS (
  SELECT
    u.id AS auth_user_id,
    u.email AS auth_email_raw,
    NULLIF(lower(trim(coalesce(u.email, ''))), '') AS auth_email_normalized,
    u.phone AS auth_phone_raw,
    CASE
      WHEN length(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), '')
    END AS auth_phone_normalized,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'first_name')::text, ''))), '') AS metadata_first_name,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'last_name')::text, ''))), '') AS metadata_last_name,
    NULLIF(lower(trim(coalesce(coalesce((u.raw_user_meta_data ->> 'display_name')::text, (u.raw_user_meta_data ->> 'full_name')::text), ''))), '') AS metadata_display_name,
    u.created_at AS auth_created_at,
    u.last_sign_in_at AS auth_last_sign_in_at
  FROM auth.users AS u
),
strong_evidence_matches AS (
  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id AS matched_auth_user_id,
    'ROLE_SCOPED'::text AS evidence_type
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_user_id = re.role_scoped_auth_user_id
  WHERE re.role_scoped_auth_user_id IS NOT NULL

  UNION ALL

  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id,
    'EXACT_EMAIL'::text
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_email_normalized = re.identifier_email_normalized
  WHERE re.identifier_email_normalized IS NOT NULL

  UNION ALL

  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id,
    'EXACT_PHONE'::text
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_phone_normalized IS NOT NULL
    AND au.auth_phone_normalized IN (
      re.identifier_phone_normalized_1,
      re.identifier_phone_normalized_2,
      re.identifier_phone_normalized_3
    )
  WHERE re.identifier_phone_normalized_1 IS NOT NULL
     OR re.identifier_phone_normalized_2 IS NOT NULL
     OR re.identifier_phone_normalized_3 IS NOT NULL
),
role_evidence_summary AS (
  SELECT
    re.role_type,
    re.role_instance_key,
    re.attendee_id,
    re.household_member_id,
    re.event_id,
    re.event_name,
    re.event_code,
    re.role_person_name_raw,
    re.role_first_name_normalized,
    re.role_last_name_normalized,
    re.identifier_email_normalized,
    re.identifier_phone_normalized_1,
    re.identifier_phone_normalized_2,
    re.identifier_phone_normalized_3,
    re.role_scoped_auth_user_id,
    re.registration_context_auth_user_id,
    re.membership_number,
    re.source_person_role,
    (SELECT count(DISTINCT sem.matched_auth_user_id)
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS distinct_matched_auth_user_count,
    (SELECT array_agg(DISTINCT sem.matched_auth_user_id)
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS matched_auth_user_ids,
    (SELECT bool_or(sem.evidence_type = 'ROLE_SCOPED')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_role_scoped_match,
    (SELECT bool_or(sem.evidence_type = 'EXACT_EMAIL')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_exact_email_match,
    (SELECT bool_or(sem.evidence_type = 'EXACT_PHONE')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_exact_phone_match
  FROM role_evidence re
),
name_support AS (
  SELECT
    res.role_instance_key,
    CASE
      WHEN res.distinct_matched_auth_user_count = 1 THEN (
        SELECT
          CASE
            WHEN au.metadata_first_name IS NOT NULL AND au.metadata_last_name IS NOT NULL
                 AND res.role_first_name_normalized IS NOT NULL AND res.role_last_name_normalized IS NOT NULL
              THEN (au.metadata_first_name = res.role_first_name_normalized
                    AND au.metadata_last_name = res.role_last_name_normalized)
            WHEN au.metadata_display_name IS NOT NULL AND res.role_person_name_raw IS NOT NULL
                 AND NULLIF(lower(trim(res.role_person_name_raw)), '') IS NOT NULL
              THEN (au.metadata_display_name = NULLIF(lower(trim(res.role_person_name_raw)), ''))
            ELSE FALSE
          END
        FROM auth_users_normalized au
        WHERE au.auth_user_id = res.matched_auth_user_ids[1]
      )
      ELSE FALSE
    END AS name_support
  FROM role_evidence_summary res
),
role_disposition AS (
  SELECT
    res.*,
    ns.name_support,
    CASE
      WHEN res.distinct_matched_auth_user_count > 1 THEN 'CONTRADICTORY_IDENTIFIER_EVIDENCE'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_role_scoped_match THEN 'ROLE_SCOPED_AUTH_MATCH'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_email_match AND res.has_exact_phone_match THEN 'EXACT_EMAIL_AND_PHONE_MATCH'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_email_match THEN 'AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_phone_match THEN 'AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE'
      WHEN res.distinct_matched_auth_user_count = 1 THEN 'INSUFFICIENT_EVIDENCE'
      WHEN res.distinct_matched_auth_user_count = 0 AND res.registration_context_auth_user_id IS NOT NULL THEN 'REGISTRATION_CONTEXT_ONLY'
      WHEN res.distinct_matched_auth_user_count = 0
           AND (res.identifier_email_normalized IS NOT NULL
                OR res.identifier_phone_normalized_1 IS NOT NULL
                OR res.identifier_phone_normalized_2 IS NOT NULL
                OR res.identifier_phone_normalized_3 IS NOT NULL) THEN 'UNVERIFIED_NO_AUTH_ACCOUNT'
      ELSE 'NO_MATCH'
    END AS pre_override_disposition
  FROM role_evidence_summary res
  LEFT JOIN name_support ns ON ns.role_instance_key = res.role_instance_key
),
longitudinal_group_input AS (
  SELECT
    rd.role_instance_key,
    rd.matched_auth_user_ids[1] AS matched_auth_user_id,
    rd.attendee_id,
    rd.event_id,
    rd.role_type,
    CASE
      WHEN rd.role_first_name_normalized IS NOT NULL AND rd.role_last_name_normalized IS NOT NULL
        THEN rd.role_first_name_normalized || '|' || rd.role_last_name_normalized
      ELSE NULL
    END AS name_descriptor,
    rd.identifier_email_normalized AS email_descriptor,
    array_remove(ARRAY[rd.identifier_phone_normalized_1, rd.identifier_phone_normalized_2, rd.identifier_phone_normalized_3], NULL) AS phone_descriptors
  FROM role_disposition rd
  WHERE rd.distinct_matched_auth_user_count = 1
    AND rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
),
longitudinal_pair_evaluation AS (
  SELECT
    g1.matched_auth_user_id,
    g1.role_instance_key AS role_instance_key_a,
    g2.role_instance_key AS role_instance_key_b,
    g1.attendee_id AS attendee_id_a,
    g2.attendee_id AS attendee_id_b,
    (g1.attendee_id = g2.attendee_id) AS same_registration,
    (g1.email_descriptor IS NOT NULL AND g2.email_descriptor IS NOT NULL AND g1.email_descriptor = g2.email_descriptor) AS email_match,
    (g1.email_descriptor IS NOT NULL AND g2.email_descriptor IS NOT NULL AND g1.email_descriptor <> g2.email_descriptor) AS email_conflict,
    (cardinality(g1.phone_descriptors) > 0 AND cardinality(g2.phone_descriptors) > 0 AND (g1.phone_descriptors && g2.phone_descriptors)) AS phone_match,
    (cardinality(g1.phone_descriptors) > 0 AND cardinality(g2.phone_descriptors) > 0 AND NOT (g1.phone_descriptors && g2.phone_descriptors)) AS phone_conflict,
    (g1.name_descriptor IS NOT NULL AND g2.name_descriptor IS NOT NULL AND g1.name_descriptor = g2.name_descriptor) AS name_match,
    (g1.name_descriptor IS NOT NULL AND g2.name_descriptor IS NOT NULL AND g1.name_descriptor <> g2.name_descriptor) AS name_conflict
  FROM longitudinal_group_input g1
  JOIN longitudinal_group_input g2
    ON g1.matched_auth_user_id = g2.matched_auth_user_id
   AND g1.role_instance_key < g2.role_instance_key
),
longitudinal_pair_analysis AS (
  SELECT
    p.*,
    (p.email_match OR p.phone_match) AS strong_identifier_match,
    ((p.email_conflict OR p.phone_conflict) AND NOT (p.email_match OR p.phone_match)) AS strong_identifier_conflict,
    ((p.email_conflict OR p.phone_conflict) AND (p.email_match OR p.phone_match)) AS conflict_reconciled_by_strong_identifier,
    (
      ((p.email_conflict OR p.phone_conflict) AND NOT (p.email_match OR p.phone_match))
      OR (p.name_conflict AND NOT (p.email_match OR p.phone_match))
    ) AS is_conflicting_pair
  FROM longitudinal_pair_evaluation p
),
longitudinal_group_summary AS (
  SELECT
    g.matched_auth_user_id,
    count(DISTINCT g.role_instance_key) AS matched_role_instance_count,
    count(DISTINCT g.attendee_id) AS distinct_attendee_id_count,
    count(DISTINCT g.event_id) AS distinct_event_count,
    count(DISTINCT (coalesce(g.email_descriptor, '') || '|' || coalesce(g.name_descriptor, '') || '|' || array_to_string(g.phone_descriptors, ','))) AS distinct_person_descriptor_count,
    coalesce(bool_or(a.is_conflicting_pair), FALSE) AS has_conflicting_pair,
    coalesce(bool_or(a.strong_identifier_match), FALSE) AS group_has_strong_identifier_match,
    coalesce(bool_or(a.strong_identifier_conflict), FALSE) AS group_has_strong_identifier_conflict,
    coalesce(bool_or(a.name_match), FALSE) AS group_has_name_match,
    coalesce(bool_or(a.name_conflict), FALSE) AS group_has_name_conflict,
    coalesce(bool_or(a.conflict_reconciled_by_strong_identifier), FALSE) AS group_has_conflict_reconciled_by_strong_identifier,
    coalesce(bool_or(a.same_registration AND NOT a.is_conflicting_pair), FALSE) AS same_registration_duplicate_representation_exists,
    NULLIF(concat_ws('; ',
      CASE WHEN bool_or(a.is_conflicting_pair AND a.email_conflict) THEN 'differing normalized email addresses' END,
      CASE WHEN bool_or(a.is_conflicting_pair AND a.phone_conflict) THEN 'differing normalized phone numbers' END,
      CASE WHEN bool_or(a.is_conflicting_pair AND a.name_conflict AND NOT a.email_conflict AND NOT a.phone_conflict) THEN 'differing normalized person names with no email or phone evidence available to corroborate or reconcile' END
    ), '') AS competing_person_reason
  FROM longitudinal_group_input g
  LEFT JOIN longitudinal_pair_analysis a ON a.matched_auth_user_id = g.matched_auth_user_id
  GROUP BY g.matched_auth_user_id
),
longitudinal_classification AS (
  SELECT
    lgs.*,
    CASE
      WHEN lgs.matched_role_instance_count <= 1 THEN 'SINGLE_MATCH'
      WHEN lgs.has_conflicting_pair THEN 'COMPETING_PERSON_CLAIMS'
      WHEN lgs.distinct_attendee_id_count > 1 THEN 'REPEATED_CONSISTENT_PERSON_EVIDENCE'
      ELSE 'DUPLICATE_ROLE_REPRESENTATION'
    END AS longitudinal_person_classification
  FROM longitudinal_group_summary lgs
),
final_disposition AS (
  SELECT
    rd.*,
    lc.matched_role_instance_count AS longitudinal_matched_role_instance_count,
    lc.distinct_attendee_id_count AS longitudinal_distinct_attendee_id_count,
    lc.distinct_event_count AS longitudinal_distinct_event_count,
    lc.distinct_person_descriptor_count AS longitudinal_distinct_person_descriptor_count,
    lc.group_has_strong_identifier_match,
    lc.group_has_strong_identifier_conflict,
    lc.group_has_name_match,
    lc.group_has_name_conflict,
    lc.group_has_conflict_reconciled_by_strong_identifier,
    lc.same_registration_duplicate_representation_exists,
    lc.competing_person_reason,
    lc.longitudinal_person_classification,
    CASE
      WHEN lc.matched_auth_user_id IS NULL THEN NULL
      ELSE NOT lc.has_conflicting_pair
    END AS longitudinal_consistent,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE)
      THEN 'COMPETING_PERSON_CLAIMS'
      ELSE rd.pre_override_disposition
    END AS attribution_disposition,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE) = FALSE
      THEN 'AUTOMATIC_ATTRIBUTION'
      WHEN coalesce(lc.has_conflicting_pair, FALSE) = TRUE
           OR rd.pre_override_disposition IN ('CONTRADICTORY_IDENTIFIER_EVIDENCE','COMPETING_PERSON_CLAIMS')
      THEN 'INSUFFICIENT_FOR_IDENTITY_CLAIM'
      WHEN rd.role_first_name_normalized IS NOT NULL
           AND rd.role_last_name_normalized IS NOT NULL
           AND rd.event_id IS NOT NULL
           AND rd.event_name IS NOT NULL
           AND (
             rd.identifier_email_normalized IS NOT NULL
             OR rd.identifier_phone_normalized_1 IS NOT NULL
             OR rd.identifier_phone_normalized_2 IS NOT NULL
             OR rd.identifier_phone_normalized_3 IS NOT NULL
             OR rd.role_scoped_auth_user_id IS NOT NULL
             OR rd.registration_context_auth_user_id IS NOT NULL
           )
      THEN 'ACCEPTABLE_CLAIM_VERIFICATION'
      ELSE 'INSUFFICIENT_FOR_IDENTITY_CLAIM'
    END AS identification_assurance_level,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE) = FALSE
      THEN FALSE
      WHEN coalesce(lc.has_conflicting_pair, FALSE) = TRUE
           OR rd.pre_override_disposition IN ('CONTRADICTORY_IDENTIFIER_EVIDENCE','COMPETING_PERSON_CLAIMS')
      THEN FALSE
      WHEN rd.role_first_name_normalized IS NOT NULL
           AND rd.role_last_name_normalized IS NOT NULL
           AND rd.event_id IS NOT NULL
           AND rd.event_name IS NOT NULL
           AND (
             rd.identifier_email_normalized IS NOT NULL
             OR rd.identifier_phone_normalized_1 IS NOT NULL
             OR rd.identifier_phone_normalized_2 IS NOT NULL
             OR rd.identifier_phone_normalized_3 IS NOT NULL
             OR rd.role_scoped_auth_user_id IS NOT NULL
             OR rd.registration_context_auth_user_id IS NOT NULL
           )
      THEN TRUE
      ELSE FALSE
    END AS is_acceptable_claim_verification_candidate,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE) = FALSE
      THEN 'Existing evidence is sufficient for automatic attribution.'
      WHEN coalesce(lc.has_conflicting_pair, FALSE) = TRUE
           OR rd.pre_override_disposition IN ('CONTRADICTORY_IDENTIFIER_EVIDENCE','COMPETING_PERSON_CLAIMS')
      THEN 'Do not present this row as a claim candidate without human review.'
      WHEN rd.role_first_name_normalized IS NOT NULL
           AND rd.role_last_name_normalized IS NOT NULL
           AND rd.event_id IS NOT NULL
           AND rd.event_name IS NOT NULL
           AND (
             rd.identifier_email_normalized IS NOT NULL
             OR rd.identifier_phone_normalized_1 IS NOT NULL
             OR rd.identifier_phone_normalized_2 IS NOT NULL
             OR rd.identifier_phone_normalized_3 IS NOT NULL
             OR rd.role_scoped_auth_user_id IS NOT NULL
             OR rd.registration_context_auth_user_id IS NOT NULL
           )
      THEN 'Ask the person to verify which events they have attended and their home state before creating or linking an account.'
      ELSE 'Do not present this row as a claim candidate without human review.'
    END AS recommended_identity_verification_action
  FROM role_disposition rd
  LEFT JOIN longitudinal_classification lc
    ON lc.matched_auth_user_id = rd.matched_auth_user_ids[1]
   AND rd.distinct_matched_auth_user_count = 1
)
SELECT
  'AUTH_USER_ROLE_MATCH_CANDIDATES'::text AS result_set_label,
  role_type,
  role_instance_key,
  attendee_id,
  household_member_id,
  event_id,
  event_name,
  event_code,
  role_person_name_raw,
  identifier_email_normalized,
  identifier_phone_normalized_1,
  identifier_phone_normalized_2,
  identifier_phone_normalized_3,
  role_scoped_auth_user_id,
  registration_context_auth_user_id,
  membership_number,
  source_person_role,
  distinct_matched_auth_user_count,
  matched_auth_user_ids,
  has_role_scoped_match,
  has_exact_email_match,
  has_exact_phone_match,
  name_support,
  matched_auth_user_ids[1] AS longitudinal_matched_auth_user_id,
  longitudinal_matched_role_instance_count,
  longitudinal_distinct_attendee_id_count,
  longitudinal_distinct_event_count,
  longitudinal_distinct_person_descriptor_count,
  longitudinal_consistent,
  group_has_strong_identifier_match AS strong_identifier_match,
  group_has_strong_identifier_conflict AS strong_identifier_conflict,
  group_has_name_match AS name_match,
  group_has_name_conflict AS name_conflict,
  group_has_conflict_reconciled_by_strong_identifier AS conflict_reconciled_by_strong_identifier,
  same_registration_duplicate_representation_exists,
  longitudinal_person_classification,
  competing_person_reason,
  attribution_disposition,
  identification_assurance_level,
  is_acceptable_claim_verification_candidate,
  recommended_identity_verification_action,
  (attribution_disposition IN (
     'ROLE_SCOPED_AUTH_MATCH',
     'EXACT_EMAIL_AND_PHONE_MATCH',
     'AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL',
     'AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE'
   )) AS is_automatic_attribution_candidate
FROM final_disposition
WHERE longitudinal_person_classification = 'REPEATED_CONSISTENT_PERSON_EVIDENCE'
ORDER BY longitudinal_matched_auth_user_id, role_type, event_id, role_instance_key;

-- ============================================================================
-- RESULT SET 5: AUTH_USER_ATTRIBUTION_SUMMARY
-- Counts of role instances by disposition, identity assurance level,
-- role type, and longitudinal person classification. Rebuilds the same
-- evidence-first pipeline as result set 4 (self-contained, per this audit's
-- rule that no statement depends on another), then aggregates it.
-- longitudinal_person_classification is NULL for rows that never entered
-- the longitudinal grouping (no strong single match at all),
-- 'SINGLE_MATCH' when exactly one strong match exists for that auth
-- account, and REPEATED_CONSISTENT_PERSON_EVIDENCE /
-- DUPLICATE_ROLE_REPRESENTATION / COMPETING_PERSON_CLAIMS otherwise,
-- using attendee_id (registration), not event_id, as the identity key for
-- "duplicate" vs. "repeated." Automatic attribution remains unchanged;
-- this summary additionally distinguishes claim-verification candidates
-- from rows that are insufficient for any identity claim workflow.
-- ============================================================================
WITH
role_evidence AS (
  SELECT
    'PILOT'::text AS role_type,
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id AS event_id,
    e.name AS event_name,
    e.event_code AS event_code,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS role_person_name_raw,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS role_first_name_normalized,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS role_last_name_normalized,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS identifier_email_normalized,
    CASE
      WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_1,
    CASE
      WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_2,
    CASE
      WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_3,
    a.auth_user_id AS role_scoped_auth_user_id,
    NULL::uuid AS registration_context_auth_user_id,
    a.membership_number::text AS membership_number,
    NULL::text AS source_person_role
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id

  UNION ALL

  SELECT
    'COPILOT'::text,
    'attendee_copilot:' || a.id::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    NULL::uuid,
    a.auth_user_id,
    a.membership_number::text,
    NULL::text
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_first IS NOT NULL
     OR a.copilot_last IS NOT NULL
     OR a.copilot_email IS NOT NULL
     OR a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text,
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.id,
    hm.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', hm.first_name, hm.last_name),
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    hm.auth_user_id,
    a.auth_user_id,
    a.membership_number::text,
    hm.person_role
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
),
auth_users_normalized AS (
  SELECT
    u.id AS auth_user_id,
    u.email AS auth_email_raw,
    NULLIF(lower(trim(coalesce(u.email, ''))), '') AS auth_email_normalized,
    u.phone AS auth_phone_raw,
    CASE
      WHEN length(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), '')
    END AS auth_phone_normalized,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'first_name')::text, ''))), '') AS metadata_first_name,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'last_name')::text, ''))), '') AS metadata_last_name,
    NULLIF(lower(trim(coalesce(coalesce((u.raw_user_meta_data ->> 'display_name')::text, (u.raw_user_meta_data ->> 'full_name')::text), ''))), '') AS metadata_display_name,
    u.created_at AS auth_created_at,
    u.last_sign_in_at AS auth_last_sign_in_at
  FROM auth.users AS u
),
strong_evidence_matches AS (
  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id AS matched_auth_user_id,
    'ROLE_SCOPED'::text AS evidence_type
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_user_id = re.role_scoped_auth_user_id
  WHERE re.role_scoped_auth_user_id IS NOT NULL

  UNION ALL

  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id,
    'EXACT_EMAIL'::text
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_email_normalized = re.identifier_email_normalized
  WHERE re.identifier_email_normalized IS NOT NULL

  UNION ALL

  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id,
    'EXACT_PHONE'::text
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_phone_normalized IS NOT NULL
    AND au.auth_phone_normalized IN (
      re.identifier_phone_normalized_1,
      re.identifier_phone_normalized_2,
      re.identifier_phone_normalized_3
    )
  WHERE re.identifier_phone_normalized_1 IS NOT NULL
     OR re.identifier_phone_normalized_2 IS NOT NULL
     OR re.identifier_phone_normalized_3 IS NOT NULL
),
role_evidence_summary AS (
  SELECT
    re.role_type,
    re.role_instance_key,
    re.attendee_id,
    re.household_member_id,
    re.event_id,
    re.event_name,
    re.event_code,
    re.role_person_name_raw,
    re.role_first_name_normalized,
    re.role_last_name_normalized,
    re.identifier_email_normalized,
    re.identifier_phone_normalized_1,
    re.identifier_phone_normalized_2,
    re.identifier_phone_normalized_3,
    re.role_scoped_auth_user_id,
    re.registration_context_auth_user_id,
    re.membership_number,
    re.source_person_role,
    (SELECT count(DISTINCT sem.matched_auth_user_id)
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS distinct_matched_auth_user_count,
    (SELECT array_agg(DISTINCT sem.matched_auth_user_id)
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS matched_auth_user_ids,
    (SELECT bool_or(sem.evidence_type = 'ROLE_SCOPED')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_role_scoped_match,
    (SELECT bool_or(sem.evidence_type = 'EXACT_EMAIL')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_exact_email_match,
    (SELECT bool_or(sem.evidence_type = 'EXACT_PHONE')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_exact_phone_match
  FROM role_evidence re
),
name_support AS (
  SELECT
    res.role_instance_key,
    CASE
      WHEN res.distinct_matched_auth_user_count = 1 THEN (
        SELECT
          CASE
            WHEN au.metadata_first_name IS NOT NULL AND au.metadata_last_name IS NOT NULL
                 AND res.role_first_name_normalized IS NOT NULL AND res.role_last_name_normalized IS NOT NULL
              THEN (au.metadata_first_name = res.role_first_name_normalized
                    AND au.metadata_last_name = res.role_last_name_normalized)
            WHEN au.metadata_display_name IS NOT NULL AND res.role_person_name_raw IS NOT NULL
                 AND NULLIF(lower(trim(res.role_person_name_raw)), '') IS NOT NULL
              THEN (au.metadata_display_name = NULLIF(lower(trim(res.role_person_name_raw)), ''))
            ELSE FALSE
          END
        FROM auth_users_normalized au
        WHERE au.auth_user_id = res.matched_auth_user_ids[1]
      )
      ELSE FALSE
    END AS name_support
  FROM role_evidence_summary res
),
role_disposition AS (
  SELECT
    res.*,
    ns.name_support,
    CASE
      WHEN res.distinct_matched_auth_user_count > 1 THEN 'CONTRADICTORY_IDENTIFIER_EVIDENCE'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_role_scoped_match THEN 'ROLE_SCOPED_AUTH_MATCH'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_email_match AND res.has_exact_phone_match THEN 'EXACT_EMAIL_AND_PHONE_MATCH'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_email_match THEN 'AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_phone_match THEN 'AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE'
      WHEN res.distinct_matched_auth_user_count = 1 THEN 'INSUFFICIENT_EVIDENCE'
      WHEN res.distinct_matched_auth_user_count = 0 AND res.registration_context_auth_user_id IS NOT NULL THEN 'REGISTRATION_CONTEXT_ONLY'
      WHEN res.distinct_matched_auth_user_count = 0
           AND (res.identifier_email_normalized IS NOT NULL
                OR res.identifier_phone_normalized_1 IS NOT NULL
                OR res.identifier_phone_normalized_2 IS NOT NULL
                OR res.identifier_phone_normalized_3 IS NOT NULL) THEN 'UNVERIFIED_NO_AUTH_ACCOUNT'
      ELSE 'NO_MATCH'
    END AS pre_override_disposition
  FROM role_evidence_summary res
  LEFT JOIN name_support ns ON ns.role_instance_key = res.role_instance_key
),
longitudinal_group_input AS (
  SELECT
    rd.role_instance_key,
    rd.matched_auth_user_ids[1] AS matched_auth_user_id,
    rd.attendee_id,
    rd.event_id,
    rd.role_type,
    CASE
      WHEN rd.role_first_name_normalized IS NOT NULL AND rd.role_last_name_normalized IS NOT NULL
        THEN rd.role_first_name_normalized || '|' || rd.role_last_name_normalized
      ELSE NULL
    END AS name_descriptor,
    rd.identifier_email_normalized AS email_descriptor,
    array_remove(ARRAY[rd.identifier_phone_normalized_1, rd.identifier_phone_normalized_2, rd.identifier_phone_normalized_3], NULL) AS phone_descriptors
  FROM role_disposition rd
  WHERE rd.distinct_matched_auth_user_count = 1
    AND rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
),
longitudinal_pair_evaluation AS (
  SELECT
    g1.matched_auth_user_id,
    g1.role_instance_key AS role_instance_key_a,
    g2.role_instance_key AS role_instance_key_b,
    g1.attendee_id AS attendee_id_a,
    g2.attendee_id AS attendee_id_b,
    (g1.attendee_id = g2.attendee_id) AS same_registration,
    (g1.email_descriptor IS NOT NULL AND g2.email_descriptor IS NOT NULL AND g1.email_descriptor = g2.email_descriptor) AS email_match,
    (g1.email_descriptor IS NOT NULL AND g2.email_descriptor IS NOT NULL AND g1.email_descriptor <> g2.email_descriptor) AS email_conflict,
    (cardinality(g1.phone_descriptors) > 0 AND cardinality(g2.phone_descriptors) > 0 AND (g1.phone_descriptors && g2.phone_descriptors)) AS phone_match,
    (cardinality(g1.phone_descriptors) > 0 AND cardinality(g2.phone_descriptors) > 0 AND NOT (g1.phone_descriptors && g2.phone_descriptors)) AS phone_conflict,
    (g1.name_descriptor IS NOT NULL AND g2.name_descriptor IS NOT NULL AND g1.name_descriptor = g2.name_descriptor) AS name_match,
    (g1.name_descriptor IS NOT NULL AND g2.name_descriptor IS NOT NULL AND g1.name_descriptor <> g2.name_descriptor) AS name_conflict
  FROM longitudinal_group_input g1
  JOIN longitudinal_group_input g2
    ON g1.matched_auth_user_id = g2.matched_auth_user_id
   AND g1.role_instance_key < g2.role_instance_key
),
longitudinal_pair_analysis AS (
  SELECT
    p.*,
    (p.email_match OR p.phone_match) AS strong_identifier_match,
    ((p.email_conflict OR p.phone_conflict) AND NOT (p.email_match OR p.phone_match)) AS strong_identifier_conflict,
    ((p.email_conflict OR p.phone_conflict) AND (p.email_match OR p.phone_match)) AS conflict_reconciled_by_strong_identifier,
    (
      ((p.email_conflict OR p.phone_conflict) AND NOT (p.email_match OR p.phone_match))
      OR (p.name_conflict AND NOT (p.email_match OR p.phone_match))
    ) AS is_conflicting_pair
  FROM longitudinal_pair_evaluation p
),
longitudinal_group_summary AS (
  SELECT
    g.matched_auth_user_id,
    count(DISTINCT g.role_instance_key) AS matched_role_instance_count,
    count(DISTINCT g.attendee_id) AS distinct_attendee_id_count,
    count(DISTINCT g.event_id) AS distinct_event_count,
    count(DISTINCT (coalesce(g.email_descriptor, '') || '|' || coalesce(g.name_descriptor, '') || '|' || array_to_string(g.phone_descriptors, ','))) AS distinct_person_descriptor_count,
    coalesce(bool_or(a.is_conflicting_pair), FALSE) AS has_conflicting_pair,
    coalesce(bool_or(a.strong_identifier_match), FALSE) AS group_has_strong_identifier_match,
    coalesce(bool_or(a.strong_identifier_conflict), FALSE) AS group_has_strong_identifier_conflict,
    coalesce(bool_or(a.name_match), FALSE) AS group_has_name_match,
    coalesce(bool_or(a.name_conflict), FALSE) AS group_has_name_conflict,
    coalesce(bool_or(a.conflict_reconciled_by_strong_identifier), FALSE) AS group_has_conflict_reconciled_by_strong_identifier,
    coalesce(bool_or(a.same_registration AND NOT a.is_conflicting_pair), FALSE) AS same_registration_duplicate_representation_exists,
    NULLIF(concat_ws('; ',
      CASE WHEN bool_or(a.is_conflicting_pair AND a.email_conflict) THEN 'differing normalized email addresses' END,
      CASE WHEN bool_or(a.is_conflicting_pair AND a.phone_conflict) THEN 'differing normalized phone numbers' END,
      CASE WHEN bool_or(a.is_conflicting_pair AND a.name_conflict AND NOT a.email_conflict AND NOT a.phone_conflict) THEN 'differing normalized person names with no email or phone evidence available to corroborate or reconcile' END
    ), '') AS competing_person_reason
  FROM longitudinal_group_input g
  LEFT JOIN longitudinal_pair_analysis a ON a.matched_auth_user_id = g.matched_auth_user_id
  GROUP BY g.matched_auth_user_id
),
longitudinal_classification AS (
  SELECT
    lgs.*,
    CASE
      WHEN lgs.matched_role_instance_count <= 1 THEN 'SINGLE_MATCH'
      WHEN lgs.has_conflicting_pair THEN 'COMPETING_PERSON_CLAIMS'
      WHEN lgs.distinct_attendee_id_count > 1 THEN 'REPEATED_CONSISTENT_PERSON_EVIDENCE'
      ELSE 'DUPLICATE_ROLE_REPRESENTATION'
    END AS longitudinal_person_classification
  FROM longitudinal_group_summary lgs
),
final_disposition AS (
  SELECT
    rd.*,
    lc.matched_role_instance_count AS longitudinal_matched_role_instance_count,
    lc.distinct_attendee_id_count AS longitudinal_distinct_attendee_id_count,
    lc.distinct_event_count AS longitudinal_distinct_event_count,
    lc.distinct_person_descriptor_count AS longitudinal_distinct_person_descriptor_count,
    lc.group_has_strong_identifier_match,
    lc.group_has_strong_identifier_conflict,
    lc.group_has_name_match,
    lc.group_has_name_conflict,
    lc.group_has_conflict_reconciled_by_strong_identifier,
    lc.same_registration_duplicate_representation_exists,
    lc.competing_person_reason,
    lc.longitudinal_person_classification,
    CASE
      WHEN lc.matched_auth_user_id IS NULL THEN NULL
      ELSE NOT lc.has_conflicting_pair
    END AS longitudinal_consistent,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE)
      THEN 'COMPETING_PERSON_CLAIMS'
      ELSE rd.pre_override_disposition
    END AS attribution_disposition,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE) = FALSE
      THEN 'AUTOMATIC_ATTRIBUTION'
      WHEN coalesce(lc.has_conflicting_pair, FALSE) = TRUE
           OR rd.pre_override_disposition IN ('CONTRADICTORY_IDENTIFIER_EVIDENCE','COMPETING_PERSON_CLAIMS')
      THEN 'INSUFFICIENT_FOR_IDENTITY_CLAIM'
      WHEN rd.role_first_name_normalized IS NOT NULL
           AND rd.role_last_name_normalized IS NOT NULL
           AND rd.event_id IS NOT NULL
           AND rd.event_name IS NOT NULL
           AND (
             rd.identifier_email_normalized IS NOT NULL
             OR rd.identifier_phone_normalized_1 IS NOT NULL
             OR rd.identifier_phone_normalized_2 IS NOT NULL
             OR rd.identifier_phone_normalized_3 IS NOT NULL
             OR rd.role_scoped_auth_user_id IS NOT NULL
             OR rd.registration_context_auth_user_id IS NOT NULL
           )
      THEN 'ACCEPTABLE_CLAIM_VERIFICATION'
      ELSE 'INSUFFICIENT_FOR_IDENTITY_CLAIM'
    END AS identification_assurance_level
  FROM role_disposition rd
  LEFT JOIN longitudinal_classification lc
    ON lc.matched_auth_user_id = rd.matched_auth_user_ids[1]
   AND rd.distinct_matched_auth_user_count = 1
)
SELECT
  'AUTH_USER_ATTRIBUTION_SUMMARY'::text AS result_set_label,
  role_type,
  attribution_disposition,
  identification_assurance_level,
  longitudinal_person_classification,
  count(*) AS role_instance_count,
  count(*) FILTER (
    WHERE attribution_disposition IN (
      'ROLE_SCOPED_AUTH_MATCH',
      'EXACT_EMAIL_AND_PHONE_MATCH',
      'AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL',
      'AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE'
    )
  ) AS automatic_attribution_candidate_count,
  count(*) FILTER (WHERE identification_assurance_level = 'ACCEPTABLE_CLAIM_VERIFICATION') AS acceptable_claim_verification_candidate_count,
  count(*) FILTER (WHERE identification_assurance_level = 'INSUFFICIENT_FOR_IDENTITY_CLAIM') AS insufficient_for_identity_claim_count,
  count(*) FILTER (WHERE same_registration_duplicate_representation_exists) AS same_registration_duplicate_representation_count,
  count(*) FILTER (WHERE group_has_strong_identifier_conflict) AS strong_identifier_conflict_count,
  count(*) FILTER (WHERE group_has_conflict_reconciled_by_strong_identifier) AS conflict_reconciled_by_strong_identifier_count
FROM final_disposition
GROUP BY role_type, attribution_disposition, identification_assurance_level, longitudinal_person_classification
ORDER BY role_type, attribution_disposition, identification_assurance_level, longitudinal_person_classification;

-- ============================================================================
-- RESULT SET 6: EXISTING_PERSON_AUTH_LINKS
-- Links that already exist in public.person_auth_accounts today, with
-- their real columns (status, is_primary, linked_at, verified_at,
-- retired_at). A prior version of this result set referenced
-- paa.provider / paa.provider_subject, columns that do not exist on this
-- table per the confirmed migration schema; that reference has been
-- removed rather than guessed at.
-- ============================================================================
SELECT
  'EXISTING_PERSON_AUTH_LINKS'::text AS result_set_label,
  paa.id AS person_auth_account_id,
  paa.person_id,
  paa.auth_user_id,
  paa.status,
  paa.is_primary,
  paa.linked_at,
  paa.verified_at,
  paa.retired_at,
  paa.created_at,
  paa.updated_at,
  u.email AS auth_email_raw,
  u.phone AS auth_phone_raw
FROM public.person_auth_accounts paa
LEFT JOIN auth.users u ON u.id = paa.auth_user_id
ORDER BY paa.created_at;

-- ============================================================================
-- RESULT SET 7: PERSON_RELATIONSHIP_SCHEMA_GAP
-- Distinguishes what information_schema actually reports (observed_*
-- columns) from this audit's interpretation of what that fact means
-- (recommendation_* columns, explicitly labeled as recommendations, never
-- presented as observed database facts).
-- ============================================================================
SELECT
  'PERSON_RELATIONSHIP_SCHEMA_GAP'::text AS result_set_label,
  'attendees.person_id'::text AS relation_and_column,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendees' AND column_name = 'person_id'
  ) AS observed_column_exists,
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendees' AND column_name = 'person_id') AS observed_data_type,
  (SELECT ccu.table_name FROM information_schema.key_column_usage kcu
     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = kcu.constraint_name
     WHERE kcu.table_schema = 'public' AND kcu.table_name = 'attendees' AND kcu.column_name = 'person_id'
     LIMIT 1) AS observed_foreign_key_target,
  TRUE AS is_recommendation,
  'attendees.person_id links a registration row to a person, but the schema alone does not say which role (pilot, copilot, or neither) that person is. Treating it as "the pilot" is an interpretation this audit makes, not a fact the database asserts.'::text AS recommendation_text

UNION ALL

SELECT
  'PERSON_RELATIONSHIP_SCHEMA_GAP'::text AS result_set_label,
  'attendee_household_members.person_id'::text,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendee_household_members' AND column_name = 'person_id'
  ),
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendee_household_members' AND column_name = 'person_id'),
  NULL::text,
  TRUE,
  'This column does not exist yet. Without it, an individual household member cannot be linked to a person row directly; any backfill would have to either add this column or link household members to a person only through auth_user_id / person_auth_accounts. This is a recommendation for future schema work, not a description of current schema.'::text

UNION ALL

SELECT
  'PERSON_RELATIONSHIP_SCHEMA_GAP'::text AS result_set_label,
  'person_auth_accounts.auth_user_id uniqueness'::text,
  EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public' AND tc.table_name = 'person_auth_accounts'
      AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      AND kcu.column_name = 'auth_user_id'
  ),
  NULL::text,
  NULL::text,
  TRUE,
  'If a unique constraint on auth_user_id is observed to be absent here, do not assume the database enforces one-auth-account-to-one-person; re-verify before relying on that guarantee elsewhere in this project.'::text;

-- ============================================================================
-- RESULT SET 8: AUTH_ATTRIBUTION_SUMMARY
-- Top-level rollup: how many role instances are safe automatic-attribution
-- candidates, how many are acceptable claim-verification candidates, how
-- many are insufficient for any identity claim workflow, and how many have
-- no usable evidence at all -- plus, separately, how many distinct auth
-- accounts show repeated-but-consistent evidence (across distinct
-- registrations), same-registration duplication (same attendee_id), or a
-- genuine competing-person conflict. Rebuilds the pipeline self-contained,
-- as in result sets 4 and 5. Claim verification authorizes asking the
-- person verification questions only; it never authorizes automatic
-- identity linking.
-- ============================================================================
WITH
role_evidence AS (
  SELECT
    'PILOT'::text AS role_type,
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    NULL::uuid AS household_member_id,
    a.event_id AS event_id,
    e.name AS event_name,
    e.event_code AS event_code,
    concat_ws(' ', a.pilot_first, a.pilot_last) AS role_person_name_raw,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS role_first_name_normalized,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS role_last_name_normalized,
    NULLIF(lower(trim(coalesce(a.email, ''))), '') AS identifier_email_normalized,
    CASE
      WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_1,
    CASE
      WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_2,
    CASE
      WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END AS identifier_phone_normalized_3,
    a.auth_user_id AS role_scoped_auth_user_id,
    NULL::uuid AS registration_context_auth_user_id,
    a.membership_number::text AS membership_number,
    NULL::text AS source_person_role
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id

  UNION ALL

  SELECT
    'COPILOT'::text,
    'attendee_copilot:' || a.id::text,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', a.copilot_first, a.copilot_last),
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    NULL::uuid,
    a.auth_user_id,
    a.membership_number::text,
    NULL::text
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.copilot_first IS NOT NULL
     OR a.copilot_last IS NOT NULL
     OR a.copilot_email IS NOT NULL
     OR a.copilot_cell_phone IS NOT NULL

  UNION ALL

  SELECT
    'HOUSEHOLD_MEMBER'::text,
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.id,
    hm.event_id,
    e.name,
    e.event_code,
    concat_ws(' ', hm.first_name, hm.last_name),
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.email, ''))), ''),
    CASE
      WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), '')
    END,
    NULL::text,
    NULL::text,
    hm.auth_user_id,
    a.auth_user_id,
    a.membership_number::text,
    hm.person_role
  FROM public.attendee_household_members hm
  LEFT JOIN public.attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
),
auth_users_normalized AS (
  SELECT
    u.id AS auth_user_id,
    u.email AS auth_email_raw,
    NULLIF(lower(trim(coalesce(u.email, ''))), '') AS auth_email_normalized,
    u.phone AS auth_phone_raw,
    CASE
      WHEN length(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')) = 11
           AND left(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') from 2)
      ELSE NULLIF(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), '')
    END AS auth_phone_normalized,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'first_name')::text, ''))), '') AS metadata_first_name,
    NULLIF(lower(trim(coalesce((u.raw_user_meta_data ->> 'last_name')::text, ''))), '') AS metadata_last_name,
    NULLIF(lower(trim(coalesce(coalesce((u.raw_user_meta_data ->> 'display_name')::text, (u.raw_user_meta_data ->> 'full_name')::text), ''))), '') AS metadata_display_name,
    u.created_at AS auth_created_at,
    u.last_sign_in_at AS auth_last_sign_in_at
  FROM auth.users AS u
),
strong_evidence_matches AS (
  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id AS matched_auth_user_id,
    'ROLE_SCOPED'::text AS evidence_type
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_user_id = re.role_scoped_auth_user_id
  WHERE re.role_scoped_auth_user_id IS NOT NULL

  UNION ALL

  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id,
    'EXACT_EMAIL'::text
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_email_normalized = re.identifier_email_normalized
  WHERE re.identifier_email_normalized IS NOT NULL

  UNION ALL

  SELECT
    re.role_type,
    re.role_instance_key,
    au.auth_user_id,
    'EXACT_PHONE'::text
  FROM role_evidence re
  JOIN auth_users_normalized au ON au.auth_phone_normalized IS NOT NULL
    AND au.auth_phone_normalized IN (
      re.identifier_phone_normalized_1,
      re.identifier_phone_normalized_2,
      re.identifier_phone_normalized_3
    )
  WHERE re.identifier_phone_normalized_1 IS NOT NULL
     OR re.identifier_phone_normalized_2 IS NOT NULL
     OR re.identifier_phone_normalized_3 IS NOT NULL
),
role_evidence_summary AS (
  SELECT
    re.role_type,
    re.role_instance_key,
    re.attendee_id,
    re.household_member_id,
    re.event_id,
    re.event_name,
    re.event_code,
    re.role_person_name_raw,
    re.role_first_name_normalized,
    re.role_last_name_normalized,
    re.identifier_email_normalized,
    re.identifier_phone_normalized_1,
    re.identifier_phone_normalized_2,
    re.identifier_phone_normalized_3,
    re.role_scoped_auth_user_id,
    re.registration_context_auth_user_id,
    re.membership_number,
    re.source_person_role,
    (SELECT count(DISTINCT sem.matched_auth_user_id)
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS distinct_matched_auth_user_count,
    (SELECT array_agg(DISTINCT sem.matched_auth_user_id)
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS matched_auth_user_ids,
    (SELECT bool_or(sem.evidence_type = 'ROLE_SCOPED')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_role_scoped_match,
    (SELECT bool_or(sem.evidence_type = 'EXACT_EMAIL')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_exact_email_match,
    (SELECT bool_or(sem.evidence_type = 'EXACT_PHONE')
       FROM strong_evidence_matches sem
      WHERE sem.role_instance_key = re.role_instance_key) AS has_exact_phone_match
  FROM role_evidence re
),
name_support AS (
  SELECT
    res.role_instance_key,
    CASE
      WHEN res.distinct_matched_auth_user_count = 1 THEN (
        SELECT
          CASE
            WHEN au.metadata_first_name IS NOT NULL AND au.metadata_last_name IS NOT NULL
                 AND res.role_first_name_normalized IS NOT NULL AND res.role_last_name_normalized IS NOT NULL
              THEN (au.metadata_first_name = res.role_first_name_normalized
                    AND au.metadata_last_name = res.role_last_name_normalized)
            WHEN au.metadata_display_name IS NOT NULL AND res.role_person_name_raw IS NOT NULL
                 AND NULLIF(lower(trim(res.role_person_name_raw)), '') IS NOT NULL
              THEN (au.metadata_display_name = NULLIF(lower(trim(res.role_person_name_raw)), ''))
            ELSE FALSE
          END
        FROM auth_users_normalized au
        WHERE au.auth_user_id = res.matched_auth_user_ids[1]
      )
      ELSE FALSE
    END AS name_support
  FROM role_evidence_summary res
),
role_disposition AS (
  SELECT
    res.*,
    ns.name_support,
    CASE
      WHEN res.distinct_matched_auth_user_count > 1 THEN 'CONTRADICTORY_IDENTIFIER_EVIDENCE'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_role_scoped_match THEN 'ROLE_SCOPED_AUTH_MATCH'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_email_match AND res.has_exact_phone_match THEN 'EXACT_EMAIL_AND_PHONE_MATCH'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_email_match THEN 'AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL'
      WHEN res.distinct_matched_auth_user_count = 1 AND res.has_exact_phone_match THEN 'AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE'
      WHEN res.distinct_matched_auth_user_count = 1 THEN 'INSUFFICIENT_EVIDENCE'
      WHEN res.distinct_matched_auth_user_count = 0 AND res.registration_context_auth_user_id IS NOT NULL THEN 'REGISTRATION_CONTEXT_ONLY'
      WHEN res.distinct_matched_auth_user_count = 0
           AND (res.identifier_email_normalized IS NOT NULL
                OR res.identifier_phone_normalized_1 IS NOT NULL
                OR res.identifier_phone_normalized_2 IS NOT NULL
                OR res.identifier_phone_normalized_3 IS NOT NULL) THEN 'UNVERIFIED_NO_AUTH_ACCOUNT'
      ELSE 'NO_MATCH'
    END AS pre_override_disposition
  FROM role_evidence_summary res
  LEFT JOIN name_support ns ON ns.role_instance_key = res.role_instance_key
),
longitudinal_group_input AS (
  SELECT
    rd.role_instance_key,
    rd.matched_auth_user_ids[1] AS matched_auth_user_id,
    rd.attendee_id,
    rd.event_id,
    rd.role_type,
    CASE
      WHEN rd.role_first_name_normalized IS NOT NULL AND rd.role_last_name_normalized IS NOT NULL
        THEN rd.role_first_name_normalized || '|' || rd.role_last_name_normalized
      ELSE NULL
    END AS name_descriptor,
    rd.identifier_email_normalized AS email_descriptor,
    array_remove(ARRAY[rd.identifier_phone_normalized_1, rd.identifier_phone_normalized_2, rd.identifier_phone_normalized_3], NULL) AS phone_descriptors
  FROM role_disposition rd
  WHERE rd.distinct_matched_auth_user_count = 1
    AND rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
),
longitudinal_pair_evaluation AS (
  SELECT
    g1.matched_auth_user_id,
    g1.role_instance_key AS role_instance_key_a,
    g2.role_instance_key AS role_instance_key_b,
    g1.attendee_id AS attendee_id_a,
    g2.attendee_id AS attendee_id_b,
    (g1.attendee_id = g2.attendee_id) AS same_registration,
    (g1.email_descriptor IS NOT NULL AND g2.email_descriptor IS NOT NULL AND g1.email_descriptor = g2.email_descriptor) AS email_match,
    (g1.email_descriptor IS NOT NULL AND g2.email_descriptor IS NOT NULL AND g1.email_descriptor <> g2.email_descriptor) AS email_conflict,
    (cardinality(g1.phone_descriptors) > 0 AND cardinality(g2.phone_descriptors) > 0 AND (g1.phone_descriptors && g2.phone_descriptors)) AS phone_match,
    (cardinality(g1.phone_descriptors) > 0 AND cardinality(g2.phone_descriptors) > 0 AND NOT (g1.phone_descriptors && g2.phone_descriptors)) AS phone_conflict,
    (g1.name_descriptor IS NOT NULL AND g2.name_descriptor IS NOT NULL AND g1.name_descriptor = g2.name_descriptor) AS name_match,
    (g1.name_descriptor IS NOT NULL AND g2.name_descriptor IS NOT NULL AND g1.name_descriptor <> g2.name_descriptor) AS name_conflict
  FROM longitudinal_group_input g1
  JOIN longitudinal_group_input g2
    ON g1.matched_auth_user_id = g2.matched_auth_user_id
   AND g1.role_instance_key < g2.role_instance_key
),
longitudinal_pair_analysis AS (
  SELECT
    p.*,
    (p.email_match OR p.phone_match) AS strong_identifier_match,
    ((p.email_conflict OR p.phone_conflict) AND NOT (p.email_match OR p.phone_match)) AS strong_identifier_conflict,
    ((p.email_conflict OR p.phone_conflict) AND (p.email_match OR p.phone_match)) AS conflict_reconciled_by_strong_identifier,
    (
      ((p.email_conflict OR p.phone_conflict) AND NOT (p.email_match OR p.phone_match))
      OR (p.name_conflict AND NOT (p.email_match OR p.phone_match))
    ) AS is_conflicting_pair
  FROM longitudinal_pair_evaluation p
),
longitudinal_group_summary AS (
  SELECT
    g.matched_auth_user_id,
    count(DISTINCT g.role_instance_key) AS matched_role_instance_count,
    count(DISTINCT g.attendee_id) AS distinct_attendee_id_count,
    count(DISTINCT g.event_id) AS distinct_event_count,
    count(DISTINCT (coalesce(g.email_descriptor, '') || '|' || coalesce(g.name_descriptor, '') || '|' || array_to_string(g.phone_descriptors, ','))) AS distinct_person_descriptor_count,
    coalesce(bool_or(a.is_conflicting_pair), FALSE) AS has_conflicting_pair,
    coalesce(bool_or(a.strong_identifier_match), FALSE) AS group_has_strong_identifier_match,
    coalesce(bool_or(a.strong_identifier_conflict), FALSE) AS group_has_strong_identifier_conflict,
    coalesce(bool_or(a.name_match), FALSE) AS group_has_name_match,
    coalesce(bool_or(a.name_conflict), FALSE) AS group_has_name_conflict,
    coalesce(bool_or(a.conflict_reconciled_by_strong_identifier), FALSE) AS group_has_conflict_reconciled_by_strong_identifier,
    coalesce(bool_or(a.same_registration AND NOT a.is_conflicting_pair), FALSE) AS same_registration_duplicate_representation_exists,
    NULLIF(concat_ws('; ',
      CASE WHEN bool_or(a.is_conflicting_pair AND a.email_conflict) THEN 'differing normalized email addresses' END,
      CASE WHEN bool_or(a.is_conflicting_pair AND a.phone_conflict) THEN 'differing normalized phone numbers' END,
      CASE WHEN bool_or(a.is_conflicting_pair AND a.name_conflict AND NOT a.email_conflict AND NOT a.phone_conflict) THEN 'differing normalized person names with no email or phone evidence available to corroborate or reconcile' END
    ), '') AS competing_person_reason
  FROM longitudinal_group_input g
  LEFT JOIN longitudinal_pair_analysis a ON a.matched_auth_user_id = g.matched_auth_user_id
  GROUP BY g.matched_auth_user_id
),
longitudinal_classification AS (
  SELECT
    lgs.*,
    CASE
      WHEN lgs.matched_role_instance_count <= 1 THEN 'SINGLE_MATCH'
      WHEN lgs.has_conflicting_pair THEN 'COMPETING_PERSON_CLAIMS'
      WHEN lgs.distinct_attendee_id_count > 1 THEN 'REPEATED_CONSISTENT_PERSON_EVIDENCE'
      ELSE 'DUPLICATE_ROLE_REPRESENTATION'
    END AS longitudinal_person_classification
  FROM longitudinal_group_summary lgs
),
final_disposition AS (
  SELECT
    rd.*,
    lc.matched_role_instance_count AS longitudinal_matched_role_instance_count,
    lc.distinct_attendee_id_count AS longitudinal_distinct_attendee_id_count,
    lc.distinct_event_count AS longitudinal_distinct_event_count,
    lc.distinct_person_descriptor_count AS longitudinal_distinct_person_descriptor_count,
    lc.group_has_strong_identifier_match,
    lc.group_has_strong_identifier_conflict,
    lc.group_has_name_match,
    lc.group_has_name_conflict,
    lc.group_has_conflict_reconciled_by_strong_identifier,
    lc.same_registration_duplicate_representation_exists,
    lc.competing_person_reason,
    lc.longitudinal_person_classification,
    CASE
      WHEN lc.matched_auth_user_id IS NULL THEN NULL
      ELSE NOT lc.has_conflicting_pair
    END AS longitudinal_consistent,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE)
      THEN 'COMPETING_PERSON_CLAIMS'
      ELSE rd.pre_override_disposition
    END AS attribution_disposition,
    CASE
      WHEN rd.pre_override_disposition IN ('ROLE_SCOPED_AUTH_MATCH','EXACT_EMAIL_AND_PHONE_MATCH','AUTH_ACCOUNT_VERIFIED_BY_EXACT_EMAIL','AUTH_ACCOUNT_VERIFIED_BY_EXACT_PHONE')
           AND coalesce(lc.has_conflicting_pair, FALSE) = FALSE
      THEN 'AUTOMATIC_ATTRIBUTION'
      WHEN coalesce(lc.has_conflicting_pair, FALSE) = TRUE
           OR rd.pre_override_disposition IN ('CONTRADICTORY_IDENTIFIER_EVIDENCE','COMPETING_PERSON_CLAIMS')
      THEN 'INSUFFICIENT_FOR_IDENTITY_CLAIM'
      WHEN rd.role_first_name_normalized IS NOT NULL
           AND rd.role_last_name_normalized IS NOT NULL
           AND rd.event_id IS NOT NULL
           AND rd.event_name IS NOT NULL
           AND (
             rd.identifier_email_normalized IS NOT NULL
             OR rd.identifier_phone_normalized_1 IS NOT NULL
             OR rd.identifier_phone_normalized_2 IS NOT NULL
             OR rd.identifier_phone_normalized_3 IS NOT NULL
             OR rd.role_scoped_auth_user_id IS NOT NULL
             OR rd.registration_context_auth_user_id IS NOT NULL
           )
      THEN 'ACCEPTABLE_CLAIM_VERIFICATION'
      ELSE 'INSUFFICIENT_FOR_IDENTITY_CLAIM'
    END AS identification_assurance_level
  FROM role_disposition rd
  LEFT JOIN longitudinal_classification lc
    ON lc.matched_auth_user_id = rd.matched_auth_user_ids[1]
   AND rd.distinct_matched_auth_user_count = 1
)
SELECT
  'AUTH_ATTRIBUTION_SUMMARY'::text AS result_set_label,
  (SELECT count(*) FROM final_disposition) AS total_role_instances,
  (SELECT count(*) FROM final_disposition
    WHERE identification_assurance_level = 'AUTOMATIC_ATTRIBUTION') AS automatic_attribution_candidate_count,
  (SELECT count(*) FROM final_disposition
    WHERE identification_assurance_level = 'ACCEPTABLE_CLAIM_VERIFICATION') AS acceptable_claim_verification_candidate_count,
  (SELECT count(*) FROM final_disposition
    WHERE identification_assurance_level = 'INSUFFICIENT_FOR_IDENTITY_CLAIM') AS insufficient_for_identity_claim_count,
  (SELECT count(*) FROM final_disposition WHERE attribution_disposition = 'REGISTRATION_CONTEXT_ONLY') AS registration_context_only_count,
  (SELECT count(*) FROM final_disposition WHERE attribution_disposition = 'COMPETING_PERSON_CLAIMS') AS competing_person_claims_role_instance_count,
  (SELECT count(*) FROM final_disposition WHERE attribution_disposition = 'CONTRADICTORY_IDENTIFIER_EVIDENCE') AS contradictory_identifier_evidence_count,
  (SELECT count(*) FROM final_disposition WHERE attribution_disposition = 'INSUFFICIENT_EVIDENCE') AS insufficient_evidence_count,
  (SELECT count(*) FROM final_disposition WHERE attribution_disposition = 'NO_MATCH') AS no_match_count,
  (SELECT count(DISTINCT matched_auth_user_id) FROM longitudinal_classification WHERE longitudinal_person_classification = 'REPEATED_CONSISTENT_PERSON_EVIDENCE') AS distinct_auth_accounts_with_repeated_consistent_evidence,
  (SELECT count(DISTINCT matched_auth_user_id) FROM longitudinal_classification WHERE longitudinal_person_classification = 'DUPLICATE_ROLE_REPRESENTATION') AS distinct_auth_accounts_with_duplicate_role_representation,
  (SELECT count(DISTINCT matched_auth_user_id) FROM longitudinal_classification WHERE longitudinal_person_classification = 'COMPETING_PERSON_CLAIMS') AS distinct_auth_accounts_with_competing_person_claims,
  (SELECT count(DISTINCT matched_auth_user_id) FROM longitudinal_classification WHERE has_conflicting_pair AND group_has_strong_identifier_conflict) AS distinct_auth_accounts_with_strong_identifier_conflict,
  (SELECT count(DISTINCT matched_auth_user_id) FROM longitudinal_classification WHERE has_conflicting_pair AND NOT group_has_strong_identifier_conflict) AS distinct_auth_accounts_with_name_only_conflict,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendee_household_members' AND column_name = 'person_id'
  ) AS observed_household_member_person_id_column_exists,
  'Automatic-attribution candidates are the only dispositions safe to backfill without human review. REPEATED_CONSISTENT_PERSON_EVIDENCE and DUPLICATE_ROLE_REPRESENTATION are not conflicts and do not block automatic attribution by themselves; duplicate/repeated status is determined by attendee_id (registration), not event_id. COMPETING_PERSON_CLAIMS and CONTRADICTORY_IDENTIFIER_EVIDENCE are genuine conflicts and require a human decision before any person link is created. A matching name never overrides a genuine email or phone disagreement; only another strong identifier can reconcile one.'::text AS recommendation_text
;
