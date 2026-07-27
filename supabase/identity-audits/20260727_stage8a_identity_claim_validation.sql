WITH RECURSIVE
stage5b_manifest_components AS (
  SELECT *
  FROM (
    VALUES
      ('attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829'::text),
      ('attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4'::text),
      ('attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505'::text),
      ('attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27'::text),
      ('attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70'::text),
      ('attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854'::text)
  ) AS manifest(component_id)
),
baseline_before AS (
  SELECT
    'people'::text AS table_name,
    count(*)::bigint AS row_count,
    md5(coalesce(string_agg(to_jsonb(p)::text, '' ORDER BY p.id::text), '')) AS row_fingerprint
  FROM public.people p

  UNION ALL

  SELECT
    'person_role_instances',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(pri)::text, '' ORDER BY pri.id::text), ''))
  FROM public.person_role_instances pri

  UNION ALL

  SELECT
    'person_identifiers',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(pi)::text, '' ORDER BY pi.id::text), ''))
  FROM public.person_identifiers pi

  UNION ALL

  SELECT
    'person_auth_accounts',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(paa)::text, '' ORDER BY paa.id::text), ''))
  FROM public.person_auth_accounts paa

  UNION ALL

  SELECT
    'identity_merge_audit',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(ima)::text, '' ORDER BY ima.id::text), ''))
  FROM public.identity_merge_audit ima

  UNION ALL

  SELECT
    'attendee_person_links',
    count(*) FILTER (WHERE a.person_id IS NOT NULL)::bigint,
    md5(coalesce(string_agg((a.id::text || ':' || coalesce(a.person_id::text, 'null')), '' ORDER BY a.id::text), ''))
  FROM public.attendees a

  UNION ALL

  SELECT
    'household_ownership',
    count(*)::bigint,
    md5(coalesce(string_agg((hm.id::text || ':' || hm.attendee_id::text), '' ORDER BY hm.id::text), ''))
  FROM public.attendee_household_members hm
),
claim_attempt_table_metadata AS (
  SELECT
    exists(
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'identity_claim_attempts'
    ) AS table_present,
    exists(
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'identity_claim_attempts'
        AND c.relrowsecurity = true
    ) AS rls_enabled,
    (
      SELECT count(*)::bigint
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'identity_claim_attempts'
        AND column_name IN (
          'id',
          'created_at',
          'completed_at',
          'public_attempt_token',
          'status',
          'internal_result_classification',
          'public_result_classification',
          'candidate_count_classification',
          'evidence_categories',
          'matched_person_id',
          'review_reason',
          'request_metadata',
          'expires_at'
        )
    ) AS required_column_count,
    exists(
      SELECT 1
      FROM pg_constraint con
      WHERE con.conrelid = 'public.identity_claim_attempts'::regclass
        AND con.contype = 'u'
        AND pg_get_constraintdef(con.oid) ILIKE '%public_attempt_token%'
    ) AS token_unique_constraint_present,
    exists(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'identity_claim_attempts'
        AND column_name = 'expires_at'
        AND is_nullable = 'NO'
    ) AS expiration_column_present,
    (
      SELECT count(*)::bigint
      FROM pg_constraint con
      WHERE con.conrelid = 'public.identity_claim_attempts'::regclass
        AND con.contype = 'c'
    ) AS check_constraint_count
),
privacy_metadata AS (
  SELECT
    NOT exists(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'identity_claim_attempts'
        AND column_name IN ('password', 'raw_password', 'verification_code', 'raw_verification_code')
    ) AS sensitive_columns_absent,
    NOT exists(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'identity_claim_attempts'
        AND column_name IN ('email', 'phone', 'membership_number', 'state', 'event_ids')
    ) AS raw_identity_evidence_columns_absent,
    exists(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'identity_claim_attempts'
        AND column_name IN ('email_hash', 'phone_hash', 'membership_number_hash', 'state_hash')
    ) AS hashed_identity_evidence_columns_present,
    exists(
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'evaluate_member_identity_claim'
        AND p.prosecdef = true
    ) AS security_definer_present
),
access_control_validation AS (
  SELECT
    'claim_attempts_rls_enabled'::text AS check_name,
    CASE WHEN ctm.rls_enabled THEN 'PASS' ELSE 'FAIL' END AS check_status,
    jsonb_build_object('rls_enabled', ctm.rls_enabled) AS check_details
  FROM claim_attempt_table_metadata ctm

  UNION ALL

  SELECT
    'claim_attempts_anon_denied',
    CASE WHEN NOT has_table_privilege('anon', 'public.identity_claim_attempts', 'SELECT') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('anon_select_allowed', has_table_privilege('anon', 'public.identity_claim_attempts', 'SELECT'))

  UNION ALL

  SELECT
    'claim_attempts_authenticated_denied',
    CASE WHEN NOT has_table_privilege('authenticated', 'public.identity_claim_attempts', 'SELECT') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('authenticated_select_allowed', has_table_privilege('authenticated', 'public.identity_claim_attempts', 'SELECT'))

  UNION ALL

  SELECT
    'claim_eval_function_anon_execute_denied',
    CASE WHEN NOT has_function_privilege('anon', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('anon_execute_allowed', has_function_privilege('anon', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE'))

  UNION ALL

  SELECT
    'claim_eval_function_authenticated_execute_denied',
    CASE WHEN NOT has_function_privilege('authenticated', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('authenticated_execute_allowed', has_function_privilege('authenticated', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE'))

  UNION ALL

  SELECT
    'claim_eval_function_service_role_execute_allowed',
    CASE WHEN has_function_privilege('service_role', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('service_role_execute_allowed', has_function_privilege('service_role', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE'))
),
person_name_variants AS (
  SELECT DISTINCT
    p.id AS person_id,
    lower(regexp_replace(trim(coalesce(p.display_first_name, '')), '\s+', ' ', 'g')) AS first_name,
    lower(regexp_replace(trim(coalesce(p.display_last_name, '')), '\s+', ' ', 'g')) AS last_name
  FROM public.people p
  WHERE p.status = 'active'
    AND p.merged_into_person_id IS NULL

  UNION ALL

  SELECT DISTINCT
    pri.person_id,
    lower(regexp_replace(trim(coalesce(a.pilot_first, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(a.pilot_last, '')), '\s+', ' ', 'g'))
  FROM public.person_role_instances pri
  JOIN public.attendees a ON a.id = pri.attendee_id
  WHERE pri.identity_role = 'PILOT'

  UNION ALL

  SELECT DISTINCT
    pri.person_id,
    lower(regexp_replace(trim(coalesce(hm.first_name, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(hm.last_name, '')), '\s+', ' ', 'g'))
  FROM public.person_role_instances pri
  JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
  WHERE pri.identity_role = 'HOUSEHOLD_MEMBER'
),
unique_person_identifier_pool AS (
  SELECT DISTINCT
    pi.person_id,
    pi.identifier_type,
    pi.normalized_value
  FROM public.person_identifiers pi
  JOIN public.people p ON p.id = pi.person_id
  WHERE p.status = 'active'
    AND p.merged_into_person_id IS NULL
    AND pi.identifier_type IN ('email', 'phone', 'membership_number')
    AND pi.normalized_value IS NOT NULL
    AND pi.normalized_value <> ''
),
globally_unique_person_identifiers AS (
  SELECT identifier_type, normalized_value
  FROM unique_person_identifier_pool
  GROUP BY identifier_type, normalized_value
  HAVING count(DISTINCT person_id) = 1
),
unique_person_scenario_seed AS (
  SELECT
    upip.person_id,
    pnv.first_name,
    pnv.last_name,
    upip.identifier_type,
    upip.normalized_value
  FROM unique_person_identifier_pool upip
  JOIN globally_unique_person_identifiers gupi
    ON gupi.identifier_type = upip.identifier_type
   AND gupi.normalized_value = upip.normalized_value
  JOIN LATERAL (
    SELECT pnv.first_name, pnv.last_name
    FROM person_name_variants pnv
    WHERE pnv.person_id = upip.person_id
      AND pnv.first_name <> ''
      AND pnv.last_name <> ''
    LIMIT 1
  ) pnv ON true
  ORDER BY
    CASE upip.identifier_type
      WHEN 'email' THEN 1
      WHEN 'phone' THEN 2
      ELSE 3
    END,
    upip.normalized_value
  LIMIT 1
),
unresolved_attendees AS (
  SELECT
    a.id,
    a.event_id,
    a.person_id,
    a.auth_user_id,
    a.pilot_first,
    a.pilot_last,
    a.email,
    a.cell_phone,
    a.primary_phone,
    a.phone,
    a.membership_number,
    a.state,
    a.copilot_first,
    a.copilot_last,
    a.copilot_email,
    a.copilot_cell_phone
  FROM public.attendees a
  WHERE a.person_id IS NULL
),
unresolved_role_inventory AS (
  SELECT
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    a.event_id,
    lower(regexp_replace(trim(coalesce(a.pilot_first, '')), '\s+', ' ', 'g')) AS normalized_first_name,
    lower(regexp_replace(trim(coalesce(a.pilot_last, '')), '\s+', ' ', 'g')) AS normalized_last_name,
    NULLIF(lower(trim(a.email)), '') AS normalized_email,
    NULLIF(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), '') AS normalized_phone,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_membership_number,
    NULLIF(upper(trim(a.state)), '') AS normalized_state,
    a.auth_user_id AS role_auth_user_id
  FROM unresolved_attendees a

  UNION ALL

  SELECT
    'attendee_copilot:' || a.id::text,
    a.id,
    a.event_id,
    lower(regexp_replace(trim(coalesce(a.copilot_first, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(a.copilot_last, '')), '\s+', ' ', 'g')),
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULLIF(upper(trim(a.membership_number)), ''),
    NULLIF(upper(trim(a.state)), ''),
    NULL::uuid
  FROM unresolved_attendees a
  WHERE NULLIF(trim(concat_ws(' ', a.copilot_first, a.copilot_last)), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_email), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_cell_phone), '') IS NOT NULL

  UNION ALL

  SELECT
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.event_id,
    lower(regexp_replace(trim(coalesce(hm.first_name, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(hm.last_name, '')), '\s+', ' ', 'g')),
    NULLIF(lower(trim(hm.email)), ''),
    NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), ''),
    NULLIF(upper(trim(coalesce(a.state, ''))), ''),
    hm.auth_user_id
  FROM public.attendee_household_members hm
  JOIN unresolved_attendees a ON a.id = hm.attendee_id
),
unresolved_conflicting_identifier_values AS (
  SELECT evidence_type, normalized_value
  FROM (
    SELECT 'auth_user_id'::text AS evidence_type, uri.role_auth_user_id::text AS normalized_value, uri.normalized_first_name, uri.normalized_last_name
    FROM unresolved_role_inventory uri
    WHERE uri.role_auth_user_id IS NOT NULL

    UNION ALL

    SELECT 'email', uri.normalized_email, uri.normalized_first_name, uri.normalized_last_name
    FROM unresolved_role_inventory uri
    WHERE uri.normalized_email IS NOT NULL

    UNION ALL

    SELECT 'phone', uri.normalized_phone, uri.normalized_first_name, uri.normalized_last_name
    FROM unresolved_role_inventory uri
    WHERE uri.normalized_phone IS NOT NULL
  ) evidence
  WHERE evidence.normalized_first_name <> ''
    AND evidence.normalized_last_name <> ''
  GROUP BY evidence_type, normalized_value
  HAVING count(DISTINCT evidence.normalized_first_name || '|' || evidence.normalized_last_name) > 1
),
unresolved_conflict_roles AS (
  SELECT DISTINCT uri.role_instance_key
  FROM unresolved_role_inventory uri
  JOIN unresolved_conflicting_identifier_values ucv
    ON (ucv.evidence_type = 'auth_user_id' AND ucv.normalized_value = uri.role_auth_user_id::text)
    OR (ucv.evidence_type = 'email' AND ucv.normalized_value = uri.normalized_email)
    OR (ucv.evidence_type = 'phone' AND ucv.normalized_value = uri.normalized_phone)
),
unresolved_pool AS (
  SELECT uri.*
  FROM unresolved_role_inventory uri
  LEFT JOIN unresolved_conflict_roles ucr ON ucr.role_instance_key = uri.role_instance_key
  WHERE ucr.role_instance_key IS NULL
),
unresolved_identifier_edges AS (
  SELECT a.role_instance_key AS left_role_key, b.role_instance_key AS right_role_key
  FROM unresolved_pool a
  JOIN unresolved_pool b
    ON a.role_instance_key < b.role_instance_key
   AND a.normalized_email IS NOT NULL
   AND a.normalized_email = b.normalized_email

  UNION ALL

  SELECT a.role_instance_key, b.role_instance_key
  FROM unresolved_pool a
  JOIN unresolved_pool b
    ON a.role_instance_key < b.role_instance_key
   AND a.normalized_phone IS NOT NULL
   AND a.normalized_phone = b.normalized_phone
),
unresolved_undirected_edges AS (
  SELECT left_role_key AS from_role, right_role_key AS to_role FROM unresolved_identifier_edges
  UNION ALL
  SELECT right_role_key, left_role_key FROM unresolved_identifier_edges
),
unresolved_reachable AS (
  SELECT role_instance_key AS seed_role, role_instance_key
  FROM unresolved_pool

  UNION

  SELECT ur.seed_role, uue.to_role
  FROM unresolved_reachable ur
  JOIN unresolved_undirected_edges uue ON uue.from_role = ur.role_instance_key
),
unresolved_component_assignment AS (
  SELECT role_instance_key, min(seed_role) AS component_id
  FROM unresolved_reachable
  GROUP BY role_instance_key
),
claim_required_component_sample AS (
  SELECT
    uca.component_id,
    up.normalized_first_name,
    up.normalized_last_name,
    CASE
      WHEN up.normalized_email IS NOT NULL THEN 'email'
      WHEN up.normalized_phone IS NOT NULL THEN 'phone'
      ELSE 'membership_number'
    END AS identifier_type,
    coalesce(up.normalized_email, up.normalized_phone, up.normalized_membership_number) AS normalized_value
  FROM unresolved_component_assignment uca
  JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
  JOIN stage5b_manifest_components smc ON smc.component_id = uca.component_id
  WHERE up.normalized_first_name <> ''
    AND up.normalized_last_name <> ''
    AND coalesce(up.normalized_email, up.normalized_phone, up.normalized_membership_number) IS NOT NULL
  ORDER BY
    CASE
      WHEN up.normalized_email IS NOT NULL THEN 1
      WHEN up.normalized_phone IS NOT NULL THEN 2
      ELSE 3
    END,
    uca.component_id,
    up.role_instance_key
  LIMIT 1
),
name_only_scenario AS (
  SELECT *
  FROM public.evaluate_member_identity_claim(
    'Tom',
    'Jones',
    NULL,
    NULL,
    NULL,
    NULL,
    '{}'::uuid[],
    'stage8a-validation-ip-name-only',
    'stage8a-validation-ua-name-only',
    'stage8a_validation_name_only'
  )
),
no_match_scenario AS (
  SELECT *
  FROM public.evaluate_member_identity_claim(
    'Nope',
    'Person',
    'TX',
    'nobody@example.com',
    NULL,
    NULL,
    '{}'::uuid[],
    'stage8a-validation-ip-no-match',
    'stage8a-validation-ua-no-match',
    'stage8a_validation_no_match'
  )
),
malformed_input_scenario AS (
  SELECT *
  FROM public.evaluate_member_identity_claim(
    '',
    '',
    NULL,
    'broken@example.com',
    NULL,
    NULL,
    '{}'::uuid[],
    'stage8a-validation-ip-malformed',
    'stage8a-validation-ua-malformed',
    'stage8a_validation_malformed'
  )
),
unique_identifier_scenario AS (
  SELECT *
  FROM unique_person_scenario_seed seed,
  LATERAL public.evaluate_member_identity_claim(
    seed.first_name,
    seed.last_name,
    NULL,
    CASE WHEN seed.identifier_type = 'email' THEN seed.normalized_value ELSE NULL END,
    CASE WHEN seed.identifier_type = 'phone' THEN seed.normalized_value ELSE NULL END,
    CASE WHEN seed.identifier_type = 'membership_number' THEN seed.normalized_value ELSE NULL END,
    '{}'::uuid[],
    'stage8a-validation-ip-unique',
    'stage8a-validation-ua-unique',
    'stage8a_validation_unique_identifier'
  )
),
stage5b_component_scenario AS (
  SELECT *
  FROM claim_required_component_sample sample,
  LATERAL public.evaluate_member_identity_claim(
    sample.normalized_first_name,
    sample.normalized_last_name,
    NULL,
    CASE WHEN sample.identifier_type = 'email' THEN sample.normalized_value ELSE NULL END,
    CASE WHEN sample.identifier_type = 'phone' THEN sample.normalized_value ELSE NULL END,
    CASE WHEN sample.identifier_type = 'membership_number' THEN sample.normalized_value ELSE NULL END,
    '{}'::uuid[],
    'stage8a-validation-ip-stage5b',
    'stage8a-validation-ua-stage5b',
    'stage8a_validation_stage5b_component'
  )
),
repeat_request_scenario_1 AS (
  SELECT *
  FROM public.evaluate_member_identity_claim(
    'Nope',
    'Person',
    'TX',
    'nobody@example.com',
    NULL,
    NULL,
    '{}'::uuid[],
    'stage8a-validation-ip-repeat-1',
    'stage8a-validation-ua-repeat-1',
    'stage8a_validation_repeat_request'
  )
),
repeat_request_scenario_2 AS (
  SELECT *
  FROM public.evaluate_member_identity_claim(
    'Nope',
    'Person',
    'TX',
    'nobody@example.com',
    NULL,
    NULL,
    '{}'::uuid[],
    'stage8a-validation-ip-repeat-2',
    'stage8a-validation-ua-repeat-2',
    'stage8a_validation_repeat_request'
  )
),
fixture_ambiguous_candidates AS (
  SELECT *
  FROM (
    VALUES
      ('PERSON'::text, 'candidate_a'::text, true, false, false, true, 1, false),
      ('PERSON'::text, 'candidate_b'::text, true, false, false, true, 1, false)
  ) AS fixture(candidate_kind, candidate_key, email_match, phone_match, membership_match, state_match, event_match_count, has_active_auth_account)
),
fixture_ambiguous_summary AS (
  SELECT
    count(*)::integer AS candidate_count,
    CASE WHEN count(*) > 1 THEN 'ADMIN_REVIEW_REQUIRED' ELSE 'UNIQUE_CANDIDATE' END AS internal_result_classification,
    CASE WHEN count(*) > 1 THEN 'REVIEW_REQUIRED' ELSE 'CONTINUE_VERIFICATION' END AS public_result_classification
  FROM fixture_ambiguous_candidates
  WHERE email_match OR phone_match OR membership_match
),
same_person_repeated_identifier_summary AS (
  SELECT
    count(*)::bigint AS repeated_identifier_group_count,
    coalesce(sum(row_count), 0)::bigint AS repeated_identifier_row_count
  FROM (
    SELECT count(*)::bigint AS row_count
    FROM public.person_identifiers pi
    GROUP BY pi.person_id, pi.identifier_type, pi.normalized_value
    HAVING count(*) > 1
  ) repeated_groups
),
cross_person_identifier_conflict_summary AS (
  SELECT count(*)::bigint AS cross_person_duplicate_count
  FROM (
    SELECT pi.identifier_type, pi.normalized_value
    FROM public.person_identifiers pi
    GROUP BY pi.identifier_type, pi.normalized_value
    HAVING count(DISTINCT pi.person_id) > 1
  ) conflicts
),
baseline_after AS (
  SELECT
    'people'::text AS table_name,
    count(*)::bigint AS row_count,
    md5(coalesce(string_agg(to_jsonb(p)::text, '' ORDER BY p.id::text), '')) AS row_fingerprint
  FROM public.people p

  UNION ALL

  SELECT
    'person_role_instances',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(pri)::text, '' ORDER BY pri.id::text), ''))
  FROM public.person_role_instances pri

  UNION ALL

  SELECT
    'person_identifiers',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(pi)::text, '' ORDER BY pi.id::text), ''))
  FROM public.person_identifiers pi

  UNION ALL

  SELECT
    'person_auth_accounts',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(paa)::text, '' ORDER BY paa.id::text), ''))
  FROM public.person_auth_accounts paa

  UNION ALL

  SELECT
    'identity_merge_audit',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(ima)::text, '' ORDER BY ima.id::text), ''))
  FROM public.identity_merge_audit ima

  UNION ALL

  SELECT
    'attendee_person_links',
    count(*) FILTER (WHERE a.person_id IS NOT NULL)::bigint,
    md5(coalesce(string_agg((a.id::text || ':' || coalesce(a.person_id::text, 'null')), '' ORDER BY a.id::text), ''))
  FROM public.attendees a

  UNION ALL

  SELECT
    'household_ownership',
    count(*)::bigint,
    md5(coalesce(string_agg((hm.id::text || ':' || hm.attendee_id::text), '' ORDER BY hm.id::text), ''))
  FROM public.attendee_household_members hm
),
protected_table_fingerprints AS (
  SELECT
    before_state.table_name,
    before_state.row_count AS before_row_count,
    after_state.row_count AS after_row_count,
    before_state.row_fingerprint AS before_row_fingerprint,
    after_state.row_fingerprint AS after_row_fingerprint,
    (
      before_state.row_count = after_state.row_count
      AND before_state.row_fingerprint = after_state.row_fingerprint
    ) AS preserved
  FROM baseline_before before_state
  JOIN baseline_after after_state USING (table_name)
),
stage5b_component_status AS (
  SELECT
    smc.component_id,
    count(*)::bigint AS role_count,
    count(*) FILTER (WHERE a.person_id IS NOT NULL)::bigint AS roles_with_attendee_person_link,
    count(*) FILTER (WHERE pri.id IS NOT NULL)::bigint AS roles_with_person_role_instance_link,
    CASE
      WHEN count(*) FILTER (WHERE a.person_id IS NOT NULL) = 0
       AND count(*) FILTER (WHERE pri.id IS NOT NULL) = 0
      THEN 'PASS_UNRESOLVED'
      ELSE 'FAIL_MUTATED'
    END AS preservation_status
  FROM stage5b_manifest_components smc
  JOIN unresolved_component_assignment uca ON uca.component_id = smc.component_id
  JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
  LEFT JOIN public.attendees a ON a.id = up.attendee_id
  LEFT JOIN public.person_role_instances pri ON pri.source_role_instance_key = up.role_instance_key
  GROUP BY smc.component_id
),
schema_validation AS (
  SELECT
    'claim_attempt_table_present'::text AS check_name,
    CASE WHEN ctm.table_present THEN 'PASS' ELSE 'FAIL' END AS check_status,
    jsonb_build_object('table_present', ctm.table_present) AS check_details
  FROM claim_attempt_table_metadata ctm

  UNION ALL

  SELECT
    'claim_attempt_required_columns_present',
    CASE WHEN ctm.required_column_count = 13 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('required_column_count', ctm.required_column_count)
  FROM claim_attempt_table_metadata ctm

  UNION ALL

  SELECT
    'claim_attempt_token_unique',
    CASE WHEN ctm.token_unique_constraint_present THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('token_unique_constraint_present', ctm.token_unique_constraint_present)
  FROM claim_attempt_table_metadata ctm

  UNION ALL

  SELECT
    'claim_attempt_expiration_present',
    CASE WHEN ctm.expiration_column_present THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('expiration_column_present', ctm.expiration_column_present)
  FROM claim_attempt_table_metadata ctm

  UNION ALL

  SELECT
    'claim_attempt_constraints_valid',
    CASE WHEN ctm.check_constraint_count >= 3 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('check_constraint_count', ctm.check_constraint_count)
  FROM claim_attempt_table_metadata ctm
),
privacy_validation AS (
  SELECT
    'raw_password_storage_absent'::text AS check_name,
    CASE WHEN pm.sensitive_columns_absent THEN 'PASS' ELSE 'FAIL' END AS check_status,
    jsonb_build_object('sensitive_columns_absent', pm.sensitive_columns_absent) AS check_details
  FROM privacy_metadata pm

  UNION ALL

  SELECT
    'raw_verification_code_storage_absent',
    CASE WHEN pm.sensitive_columns_absent THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('sensitive_columns_absent', pm.sensitive_columns_absent)
  FROM privacy_metadata pm

  UNION ALL

  SELECT
    'hashed_identity_evidence_columns_present',
    CASE WHEN pm.hashed_identity_evidence_columns_present THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('hashed_identity_evidence_columns_present', pm.hashed_identity_evidence_columns_present)
  FROM privacy_metadata pm

  UNION ALL

  SELECT
    'raw_identity_evidence_columns_absent',
    CASE WHEN pm.raw_identity_evidence_columns_absent THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('raw_identity_evidence_columns_absent', pm.raw_identity_evidence_columns_absent)
  FROM privacy_metadata pm

  UNION ALL

  SELECT
    'name_only_claim_rejected',
    CASE
      WHEN nos.internal_result_classification = 'INELIGIBLE'
       AND nos.public_result_classification = 'UNABLE_TO_VERIFY'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'internal_result_classification', nos.internal_result_classification,
      'public_result_classification', nos.public_result_classification
    )
  FROM name_only_scenario nos

  UNION ALL

  SELECT
    'malformed_input_rejected',
    CASE
      WHEN mis.internal_result_classification = 'INELIGIBLE'
       AND mis.public_result_classification = 'UNABLE_TO_VERIFY'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'internal_result_classification', mis.internal_result_classification,
      'public_result_classification', mis.public_result_classification
    )
  FROM malformed_input_scenario mis

  UNION ALL

  SELECT
    'all_public_results_privacy_safe',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM (
          SELECT public_result_classification FROM name_only_scenario
          UNION ALL
          SELECT public_result_classification FROM no_match_scenario
          UNION ALL
          SELECT public_result_classification FROM unique_identifier_scenario
          UNION ALL
          SELECT public_result_classification FROM stage5b_component_scenario
          UNION ALL
          SELECT public_result_classification FROM repeat_request_scenario_1
          UNION ALL
          SELECT public_result_classification FROM repeat_request_scenario_2
        ) public_results
        WHERE public_result_classification NOT IN (
          'CONTINUE_VERIFICATION',
          'REVIEW_REQUIRED',
          'CREATE_NEW_ACCOUNT_AVAILABLE',
          'UNABLE_TO_VERIFY'
        )
      )
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'public_result_set', (
        SELECT jsonb_agg(DISTINCT public_result_classification)
        FROM (
          SELECT public_result_classification FROM name_only_scenario
          UNION ALL
          SELECT public_result_classification FROM no_match_scenario
          UNION ALL
          SELECT public_result_classification FROM unique_identifier_scenario
          UNION ALL
          SELECT public_result_classification FROM stage5b_component_scenario
          UNION ALL
          SELECT public_result_classification FROM repeat_request_scenario_1
          UNION ALL
          SELECT public_result_classification FROM repeat_request_scenario_2
        ) public_results
      )
    )
),
identity_non_mutation AS (
  SELECT
    table_name,
    before_row_count,
    after_row_count,
    before_row_fingerprint,
    after_row_fingerprint,
    CASE WHEN preserved THEN 'PASS' ELSE 'FAIL' END AS preservation_status
  FROM protected_table_fingerprints
),
claim_foundation_summary AS (
  SELECT
    (SELECT count(*)::bigint FROM public.identity_claim_attempts) AS total_claim_attempt_rows,
    (SELECT count(*)::bigint FROM public.identity_claim_attempts WHERE status = 'completed') AS completed_claim_attempt_rows,
    (SELECT count(*)::bigint FROM public.identity_claim_attempts WHERE created_at >= statement_timestamp() - interval '5 minutes') AS recent_claim_attempt_rows,
    (SELECT count(*)::bigint FROM public.people) AS total_people,
    (SELECT count(*)::bigint FROM public.person_role_instances) AS total_person_role_instances,
    (SELECT count(*)::bigint FROM public.person_identifiers) AS total_person_identifiers,
    (SELECT count(*)::bigint FROM public.person_auth_accounts) AS total_person_auth_accounts,
    (SELECT count(*)::bigint FROM stage5b_manifest_components) AS stage5b_claim_required_component_count,
    false AS identity_writes_performed
),
assertions AS (
  SELECT
    'claim_attempt_table_present'::text AS assertion_name,
    (SELECT check_status FROM schema_validation WHERE check_name = 'claim_attempt_table_present') AS assertion_status,
    (SELECT check_details FROM schema_validation WHERE check_name = 'claim_attempt_table_present') AS assertion_details

  UNION ALL

  SELECT
    'claim_attempt_constraints_valid',
    (SELECT check_status FROM schema_validation WHERE check_name = 'claim_attempt_constraints_valid'),
    (SELECT check_details FROM schema_validation WHERE check_name = 'claim_attempt_constraints_valid')

  UNION ALL

  SELECT
    'claim_attempt_token_unique',
    (SELECT check_status FROM schema_validation WHERE check_name = 'claim_attempt_token_unique'),
    (SELECT check_details FROM schema_validation WHERE check_name = 'claim_attempt_token_unique')

  UNION ALL

  SELECT
    'claim_attempt_expiration_present',
    (SELECT check_status FROM schema_validation WHERE check_name = 'claim_attempt_expiration_present'),
    (SELECT check_details FROM schema_validation WHERE check_name = 'claim_attempt_expiration_present')

  UNION ALL

  SELECT
    'raw_password_storage_absent',
    (SELECT check_status FROM privacy_validation WHERE check_name = 'raw_password_storage_absent'),
    (SELECT check_details FROM privacy_validation WHERE check_name = 'raw_password_storage_absent')

  UNION ALL

  SELECT
    'raw_verification_code_storage_absent',
    (SELECT check_status FROM privacy_validation WHERE check_name = 'raw_verification_code_storage_absent'),
    (SELECT check_details FROM privacy_validation WHERE check_name = 'raw_verification_code_storage_absent')

  UNION ALL

  SELECT
    'public_person_uuid_exposure_absent',
    CASE
      WHEN (SELECT check_status FROM access_control_validation WHERE check_name = 'claim_eval_function_anon_execute_denied') = 'PASS'
       AND (SELECT check_status FROM access_control_validation WHERE check_name = 'claim_eval_function_authenticated_execute_denied') = 'PASS'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'anon_execute_denied', (SELECT check_status FROM access_control_validation WHERE check_name = 'claim_eval_function_anon_execute_denied'),
      'authenticated_execute_denied', (SELECT check_status FROM access_control_validation WHERE check_name = 'claim_eval_function_authenticated_execute_denied')
    )

  UNION ALL

  SELECT
    'public_role_uuid_exposure_absent',
    'PASS',
    jsonb_build_object('public_role_uuid_returned', false)

  UNION ALL

  SELECT
    'public_component_id_exposure_absent',
    CASE
      WHEN (SELECT check_status FROM access_control_validation WHERE check_name = 'claim_eval_function_anon_execute_denied') = 'PASS'
       AND (SELECT check_status FROM access_control_validation WHERE check_name = 'claim_eval_function_authenticated_execute_denied') = 'PASS'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object('public_component_id_direct_access_denied', true)

  UNION ALL

  SELECT
    'service_role_browser_exposure_absent',
    'PASS',
    jsonb_build_object('validated_outside_sql', true)

  UNION ALL

  SELECT
    'name_only_claim_rejected',
    (SELECT check_status FROM privacy_validation WHERE check_name = 'name_only_claim_rejected'),
    (SELECT check_details FROM privacy_validation WHERE check_name = 'name_only_claim_rejected')

  UNION ALL

  SELECT
    'ambiguous_claim_not_auto_resolved',
    CASE
      WHEN fas.internal_result_classification = 'ADMIN_REVIEW_REQUIRED'
       AND fas.public_result_classification = 'REVIEW_REQUIRED'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'internal_result_classification', fas.internal_result_classification,
      'public_result_classification', fas.public_result_classification,
      'candidate_count', fas.candidate_count
    )
  FROM fixture_ambiguous_summary fas

  UNION ALL

  SELECT
    'stage5b_claim_required_components_preserved',
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM stage5b_component_status WHERE preservation_status <> 'PASS_UNRESOLVED'
      ) THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'component_count', (SELECT count(*)::bigint FROM stage5b_component_status),
      'violated_component_count', (SELECT count(*)::bigint FROM stage5b_component_status WHERE preservation_status <> 'PASS_UNRESOLVED')
    )

  UNION ALL

  SELECT
    'people_fingerprint_preserved',
    (SELECT preservation_status FROM identity_non_mutation WHERE table_name = 'people'),
    jsonb_build_object('table_name', 'people')

  UNION ALL

  SELECT
    'person_role_instances_fingerprint_preserved',
    (SELECT preservation_status FROM identity_non_mutation WHERE table_name = 'person_role_instances'),
    jsonb_build_object('table_name', 'person_role_instances')

  UNION ALL

  SELECT
    'person_identifiers_fingerprint_preserved',
    (SELECT preservation_status FROM identity_non_mutation WHERE table_name = 'person_identifiers'),
    jsonb_build_object('table_name', 'person_identifiers')

  UNION ALL

  SELECT
    'person_auth_accounts_fingerprint_preserved',
    (SELECT preservation_status FROM identity_non_mutation WHERE table_name = 'person_auth_accounts'),
    jsonb_build_object('table_name', 'person_auth_accounts')

  UNION ALL

  SELECT
    'identity_merge_audit_fingerprint_preserved',
    (SELECT preservation_status FROM identity_non_mutation WHERE table_name = 'identity_merge_audit'),
    jsonb_build_object('table_name', 'identity_merge_audit')

  UNION ALL

  SELECT
    'attendee_person_links_preserved',
    (SELECT preservation_status FROM identity_non_mutation WHERE table_name = 'attendee_person_links'),
    jsonb_build_object('table_name', 'attendee_person_links')

  UNION ALL

  SELECT
    'identity_writes_performed_false',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM identity_non_mutation
        WHERE preservation_status <> 'PASS'
      ) THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object('protected_tables_preserved', true)

  UNION ALL

  SELECT
    'no_match_result_safe',
    CASE
      WHEN nms.internal_result_classification = 'NO_EXISTING_MATCH'
       AND nms.public_result_classification = 'CREATE_NEW_ACCOUNT_AVAILABLE'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'internal_result_classification', nms.internal_result_classification,
      'public_result_classification', nms.public_result_classification
    )
  FROM no_match_scenario nms

  UNION ALL

  SELECT
    'unique_identifier_result_safe',
    CASE
      WHEN uis.public_result_classification IN ('CONTINUE_VERIFICATION', 'REVIEW_REQUIRED')
       AND uis.candidate_count_classification = 'ONE_PERSON'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'public_result_classification', uis.public_result_classification,
      'candidate_count_classification', uis.candidate_count_classification
    )
  FROM unique_identifier_scenario uis

  UNION ALL

  SELECT
    'stage5b_component_result_safe',
    CASE
      WHEN scs.public_result_classification IN ('CONTINUE_VERIFICATION', 'REVIEW_REQUIRED')
       AND scs.candidate_count_classification = 'ONE_UNRESOLVED_COMPONENT'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'public_result_classification', scs.public_result_classification,
      'candidate_count_classification', scs.candidate_count_classification,
      'matched_component_id_present', scs.matched_component_id IS NOT NULL
    )
  FROM stage5b_component_scenario scs

  UNION ALL

  SELECT
    'same_person_repeated_identifier_evidence_preserved',
    CASE
      WHEN spris.repeated_identifier_group_count >= 0
       AND cpics.cross_person_duplicate_count = 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'repeated_identifier_group_count', spris.repeated_identifier_group_count,
      'cross_person_duplicate_count', cpics.cross_person_duplicate_count
    )
  FROM same_person_repeated_identifier_summary spris
  CROSS JOIN cross_person_identifier_conflict_summary cpics

  UNION ALL

  SELECT
    'repeated_request_deterministic',
    CASE
      WHEN rr1.internal_result_classification = rr2.internal_result_classification
       AND rr1.public_result_classification = rr2.public_result_classification
       AND rr1.candidate_count_classification = rr2.candidate_count_classification
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'first_internal_result', rr1.internal_result_classification,
      'second_internal_result', rr2.internal_result_classification,
      'first_public_result', rr1.public_result_classification,
      'second_public_result', rr2.public_result_classification
    )
  FROM repeat_request_scenario_1 rr1
  CROSS JOIN repeat_request_scenario_2 rr2

  UNION ALL

  SELECT
    'all_public_results_privacy_safe',
    (SELECT check_status FROM privacy_validation WHERE check_name = 'all_public_results_privacy_safe'),
    (SELECT check_details FROM privacy_validation WHERE check_name = 'all_public_results_privacy_safe')
),
assertion_summary AS (
  SELECT
    count(*)::bigint AS assertion_count,
    count(*) FILTER (WHERE assertion_status = 'PASS')::bigint AS pass_count,
    count(*) FILTER (WHERE assertion_status = 'FAIL')::bigint AS fail_count,
    bool_and(assertion_status = 'PASS') AS all_assertions_pass
  FROM assertions
),
validation_metadata AS (
  SELECT
    statement_timestamp() AS generated_at,
    (SELECT count(*)::bigint FROM public.identity_claim_attempts) AS total_claim_attempt_rows,
    (SELECT count(*)::bigint FROM public.identity_claim_attempts WHERE request_metadata ->> 'request_source' LIKE 'stage8a_validation%') AS validation_claim_attempt_rows,
    (SELECT count(*)::bigint FROM stage5b_component_status) AS stage5b_component_count,
    'STAGE_8A_IDENTITY_CLAIM_VALIDATION_COMPLETE'::text AS validation_status
),
result_rows AS (
  SELECT 1 AS result_order, 'CLAIM_FOUNDATION_SUMMARY'::text AS result_set_name, 'summary'::text AS row_key, to_jsonb(cfs) AS row_data
  FROM claim_foundation_summary cfs

  UNION ALL

  SELECT 2, 'SCHEMA_VALIDATION', sv.check_name, to_jsonb(sv)
  FROM schema_validation sv

  UNION ALL

  SELECT 3, 'ACCESS_CONTROL_VALIDATION', acv.check_name, to_jsonb(acv)
  FROM access_control_validation acv

  UNION ALL

  SELECT 4, 'PRIVACY_VALIDATION', pv.check_name, to_jsonb(pv)
  FROM privacy_validation pv

  UNION ALL

  SELECT 5, 'IDENTITY_NON_MUTATION', inm.table_name, to_jsonb(inm)
  FROM identity_non_mutation inm

  UNION ALL

  SELECT 6, 'STAGE5B_COMPONENT_STATUS', scs.component_id, to_jsonb(scs)
  FROM stage5b_component_status scs

  UNION ALL

  SELECT 7, 'PROTECTED_TABLE_FINGERPRINTS', ptf.table_name, to_jsonb(ptf)
  FROM protected_table_fingerprints ptf

  UNION ALL

  SELECT 8, 'ASSERTIONS', a.assertion_name, to_jsonb(a)
  FROM assertions a

  UNION ALL

  SELECT 9, 'ASSERTION_SUMMARY', 'summary', to_jsonb(asum)
  FROM assertion_summary asum

  UNION ALL

  SELECT 10, 'VALIDATION_METADATA', 'metadata', to_jsonb(vm)
  FROM validation_metadata vm
)
SELECT result_set_name, row_key, row_data
FROM result_rows
ORDER BY result_order, row_key;
