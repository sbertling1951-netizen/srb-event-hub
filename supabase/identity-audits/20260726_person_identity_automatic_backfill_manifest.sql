/*
Authoritative automatic-attribution backfill manifest (read-only).

This file stores the immutable, reviewed manifest membership for
manifest_version 20260726_v1. It does not infer, reclassify, or
promote additional role instances during execution.

No database objects are created or modified.
*/

-- 1. MANIFEST_METADATA
SELECT
  'MANIFEST_METADATA'::text AS result_set_label,
  '20260726_v1'::text AS manifest_version,
  now() AS generated_at,
  17::bigint AS expected_automatic_role_instances,
  FALSE AS writes_performed,
  '20260724_auth_identity_attribution_audit.sql'::text AS authoritative_source_audit_filename,
  '2026-07-26'::date AS exact_set_verified_on,
  'Manifest membership is fixed to 17 approved role_instance_key values and cannot independently promote additional role instances.'::text AS safety_statement;

-- 2. AUTOMATIC_BACKFILL_MANIFEST
WITH fixed_manifest (
  manifest_version,
  role_instance_key,
  attendee_id,
  event_id,
  identity_role,
  household_member_id,
  auth_user_id,
  classification,
  classification_reason,
  automatic_attribution_basis,
  proposed_person_key,
  review_status,
  review_notes,
  event_name,
  event_code,
  current_person_id,
  normalized_first_name,
  normalized_last_name,
  display_first_name,
  display_last_name,
  membership_number,
  normalized_membership_number,
  normalized_email,
  normalized_phone,
  source_email_column,
  source_phone_column,
  existing_person_match_count,
  existing_auth_account_link_count,
  competing_claim_count,
  identifier_conflict_count,
  longitudinal_person_classification
) AS (
  VALUES
  ('20260726_v1', 'attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Saint George', 'Fall26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Camp Margaritaville', 'Spring26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460061', 'F460061', 'sbertling1951@gmail.com', '9514911297', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'P123456', 'P123456', 'sjjeanneret@gmail.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'F703086', 'F703086', 'sjjeanneret@gmail.com', '7852208673', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'batorson', 'Steve', 'Batorson', NULL, NULL, 'batorson@gmail.com', '5204446772', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:3ec28672-57c1-4904-854b-efba23210c1d', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'bud', 'vogt', 'Bud', 'Vogt', NULL, NULL, 'budvogt@juno.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', '9514911297', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:08374616-3cd4-433e-a761-838f2fa28848', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '08374616-3cd4-433e-a761-838f2fa28848'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'batorson', 'Steve', 'Batorson', NULL, NULL, 'batorson@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'household_member:2f482686-cb88-41b1-82d2-6b15731ef577', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'F703086', 'F703086', 'sjjeanneret@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'P123456', 'P123456', 'sjjeanneret@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'HOUSEHOLD_MEMBER', '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Saint George', 'Fall26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '9ec93e24-94f8-4faa-a2b5-1eab8629fefc'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:3ec28672-57c1-4904-854b-efba23210c1d', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'bud', 'vogt', 'Bud', 'Vogt', NULL, NULL, 'budvogt@juno.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid, '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:4180a4b6-334f-4daf-8111-ad2721b0c75e', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'janine', 'rowe', 'Janine', 'Rowe', 'F460062', 'F460062', 'fcoceventhost@gmail.com', '4042190279', 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'SINGLE_MATCH'),
  ('20260726_v1', 'household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'HOUSEHOLD_MEMBER', 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Camp Margaritaville', 'Spring26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460061', 'F460061', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE')
)
SELECT
  'AUTOMATIC_BACKFILL_MANIFEST'::text AS result_set_label,
  manifest_version,
  now() AS generated_at,
  role_instance_key,
  attendee_id,
  event_id,
  identity_role,
  household_member_id,
  auth_user_id,
  classification,
  classification_reason,
  automatic_attribution_basis,
  proposed_person_key,
  review_status,
  review_notes,
  event_name,
  event_code,
  current_person_id,
  normalized_first_name,
  normalized_last_name,
  display_first_name,
  display_last_name,
  membership_number,
  normalized_membership_number,
  normalized_email,
  normalized_phone,
  source_email_column,
  source_phone_column,
  existing_person_match_count,
  existing_auth_account_link_count,
  competing_claim_count,
  identifier_conflict_count,
  longitudinal_person_classification
FROM fixed_manifest
ORDER BY role_instance_key;

-- 3. MANIFEST_VALIDATION_SUMMARY
WITH fixed_manifest (
  manifest_version,
  role_instance_key,
  attendee_id,
  event_id,
  identity_role,
  household_member_id,
  auth_user_id,
  classification,
  classification_reason,
  automatic_attribution_basis,
  proposed_person_key,
  review_status,
  review_notes,
  event_name,
  event_code,
  current_person_id,
  normalized_first_name,
  normalized_last_name,
  display_first_name,
  display_last_name,
  membership_number,
  normalized_membership_number,
  normalized_email,
  normalized_phone,
  source_email_column,
  source_phone_column,
  existing_person_match_count,
  existing_auth_account_link_count,
  competing_claim_count,
  identifier_conflict_count,
  longitudinal_person_classification
) AS (
  VALUES
  ('20260726_v1', 'attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Saint George', 'Fall26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Camp Margaritaville', 'Spring26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460061', 'F460061', 'sbertling1951@gmail.com', '9514911297', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'P123456', 'P123456', 'sjjeanneret@gmail.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'PILOT', NULL, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'F703086', 'F703086', 'sjjeanneret@gmail.com', '7852208673', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'batorson', 'Steve', 'Batorson', NULL, NULL, 'batorson@gmail.com', '5204446772', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:3ec28672-57c1-4904-854b-efba23210c1d', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'bud', 'vogt', 'Bud', 'Vogt', NULL, NULL, 'budvogt@juno.com', NULL, 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'PILOT', NULL, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Role-scoped auth match with no competing claims.', 'ROLE_SCOPED_AUTH', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', '9514911297', 'email', 'phone|primary_phone|cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:08374616-3cd4-433e-a761-838f2fa28848', '6142b323-75df-4798-af3c-15863c8481ea'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '08374616-3cd4-433e-a761-838f2fa28848'::uuid, '9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9f9fe6c4-c9f4-4368-a632-7cb03adcbd7b', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'batorson', 'Steve', 'Batorson', NULL, NULL, 'batorson@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'household_member:2f482686-cb88-41b1-82d2-6b15731ef577', '2f2a83de-4ea1-4b82-8afe-932deb2d08ec'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '2f482686-cb88-41b1-82d2-6b15731ef577'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'F703086', 'F703086', 'sjjeanneret@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:53f34bd2-089d-42bd-a947-7a1ce08ea6d0', '098dfa2a-4606-4a55-aada-a1a2a09f57fc'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '53f34bd2-089d-42bd-a947-7a1ce08ea6d0'::uuid, 'd9b98c8a-d1c7-4358-8ef1-24be17d7490f'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:d9b98c8a-d1c7-4358-8ef1-24be17d7490f', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steve', 'jeanneret', 'Steve', 'Jeanneret', 'P123456', 'P123456', 'sjjeanneret@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:69741cc2-1a76-4270-97d7-1526c35e20b6', '04defd7f-f19a-430f-91ab-eba7e9214048'::uuid, '382a358b-7d2d-4390-a920-8013a70c560b'::uuid, 'HOUSEHOLD_MEMBER', '69741cc2-1a76-4270-97d7-1526c35e20b6'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Saint George', 'Fall26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:718c1f29-dcb5-4117-8e5a-06e5c3210442', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '718c1f29-dcb5-4117-8e5a-06e5c3210442'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:9d3b0a3d-dc70-4768-8b85-1943c2a1c22e', '1d1caab7-871d-4778-9422-18ad4a8d0f73'::uuid, '853f6934-8672-4219-ad59-520482098577'::uuid, 'HOUSEHOLD_MEMBER', '9d3b0a3d-dc70-4768-8b85-1943c2a1c22e'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Branson', 'Branson26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460062', 'F460062', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE'),
  ('20260726_v1', 'household_member:9ec93e24-94f8-4faa-a2b5-1eab8629fefc', '725889f5-6e79-473c-8c1e-f873f3e99456'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', '9ec93e24-94f8-4faa-a2b5-1eab8629fefc'::uuid, '3ec28672-57c1-4904-854b-efba23210c1d'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:3ec28672-57c1-4904-854b-efba23210c1d', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'bud', 'vogt', 'Bud', 'Vogt', NULL, NULL, 'budvogt@juno.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'DUPLICATE_ROLE_REPRESENTATION'),
  ('20260726_v1', 'household_member:a9b2f88b-6053-4dc8-98db-2641baed7f51', 'df4539c6-f85e-444c-a7bb-e77e3e9e9507'::uuid, '53136dfb-b039-40b1-9adf-dcb4d648ea87'::uuid, 'HOUSEHOLD_MEMBER', 'a9b2f88b-6053-4dc8-98db-2641baed7f51'::uuid, '4180a4b6-334f-4daf-8111-ad2721b0c75e'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:4180a4b6-334f-4daf-8111-ad2721b0c75e', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Amana Event & Annual Business Meeting', 'Summer26', NULL, 'janine', 'rowe', 'Janine', 'Rowe', 'F460062', 'F460062', 'fcoceventhost@gmail.com', '4042190279', 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'SINGLE_MATCH'),
  ('20260726_v1', 'household_member:eeb36787-6fb0-40e8-b4e0-bf8f5ef672db', '088a5803-d784-41e8-b416-e1472b0b3bc3'::uuid, '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'::uuid, 'HOUSEHOLD_MEMBER', 'eeb36787-6fb0-40e8-b4e0-bf8f5ef672db'::uuid, '9d970d10-c46e-47cc-ba8e-7fb23863acb6'::uuid, 'AUTOMATIC_ATTRIBUTION', 'Exact normalized email matches one auth account with no competing claims.', 'EXACT_EMAIL', 'auth:9d970d10-c46e-47cc-ba8e-7fb23863acb6', 'VALIDATED_FOR_BACKFILL', 'Validated automatic-attribution role instance from authoritative auth-identity attribution evidence.', 'Camp Margaritaville', 'Spring26', NULL, 'steven', 'bertling', 'Steven', 'Bertling', 'F460061', 'F460061', 'sbertling1951@gmail.com', NULL, 'household_email', 'household_cell_phone', 0, 0, 0, 0, 'REPEATED_CONSISTENT_PERSON_EVIDENCE')
),
manifest_stats AS (
  SELECT
    count(*)::bigint AS total_manifest_rows,
    count(DISTINCT role_instance_key)::bigint AS distinct_role_instance_keys,
    (count(*) - count(DISTINCT role_instance_key))::bigint AS duplicate_role_instance_key_count,
    count(*) FILTER (WHERE classification = 'AUTOMATIC_ATTRIBUTION')::bigint AS automatic_attribution_rows,
    count(*) FILTER (WHERE classification <> 'AUTOMATIC_ATTRIBUTION')::bigint AS non_automatic_rows,
    count(*) FILTER (WHERE attendee_id IS NULL)::bigint AS rows_missing_attendee_id,
    count(*) FILTER (WHERE identity_role IS NULL OR trim(identity_role) = '')::bigint AS rows_missing_identity_role,
    count(*) FILTER (WHERE auth_user_id IS NULL)::bigint AS rows_missing_auth_user_id,
    count(*) FILTER (WHERE proposed_person_key IS NULL OR trim(proposed_person_key) = '')::bigint AS rows_missing_proposed_person_key,
    coalesce(sum(competing_claim_count), 0)::bigint AS competing_claim_total,
    coalesce(sum(identifier_conflict_count), 0)::bigint AS identifier_conflict_total
  FROM fixed_manifest
)
SELECT
  'MANIFEST_VALIDATION_SUMMARY'::text AS result_set_label,
  ms.total_manifest_rows,
  ms.distinct_role_instance_keys,
  ms.duplicate_role_instance_key_count,
  ms.automatic_attribution_rows,
  ms.non_automatic_rows,
  ms.rows_missing_attendee_id,
  ms.rows_missing_identity_role,
  ms.rows_missing_auth_user_id,
  ms.rows_missing_proposed_person_key,
  ms.competing_claim_total,
  ms.identifier_conflict_total,
  FALSE AS writes_performed,
  CASE
    WHEN ms.total_manifest_rows = 17
      AND ms.distinct_role_instance_keys = 17
      AND ms.duplicate_role_instance_key_count = 0
      AND ms.automatic_attribution_rows = 17
      AND ms.non_automatic_rows = 0
      AND ms.rows_missing_attendee_id = 0
      AND ms.rows_missing_identity_role = 0
      AND ms.rows_missing_auth_user_id = 0
      AND ms.rows_missing_proposed_person_key = 0
      AND ms.competing_claim_total = 0
      AND ms.identifier_conflict_total = 0
    THEN 'READY_FOR_STAGE_1'
    ELSE 'MANIFEST_VALIDATION_FAILED'
  END AS validation_status
FROM manifest_stats ms;

-- 4. MANIFEST_SOURCE_DRIFT_CHECK
SELECT
  'MANIFEST_SOURCE_DRIFT_CHECK'::text AS result_set_label,
  '20260726_v1'::text AS manifest_version,
  17::bigint AS fixed_manifest_rows,
  NULL::bigint AS current_authoritative_automatic_rows,
  NULL::bigint AS fixed_keys_absent_from_current_audit_output,
  NULL::bigint AS current_audit_keys_absent_from_fixed_manifest,
  0::bigint AS duplicate_fixed_keys,
  NULL::bigint AS duplicate_current_audit_keys,
  NULL::boolean AS exact_set_match,
  'SOURCE_DRIFT_DETECTED_REVIEW_REQUIRED'::text AS drift_status,
  'Dynamic source drift comparison is intentionally omitted here to avoid re-embedding the attribution classifier pipeline. Use the separate read-only comparison probe against 20260724_auth_identity_attribution_audit.sql.'::text AS drift_check_note;
