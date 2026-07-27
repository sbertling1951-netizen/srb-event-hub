/*
Stage 8B validation audit.

This script performs structural/security checks and behavior checks in one explicit
transaction that is always rolled back. It intentionally leaves no persistent
Stage 8A/8B synthetic residue in the linked database.
*/

BEGIN;

CREATE TEMP TABLE stage8b_assertions (
  assertion_name text PRIMARY KEY,
  assertion_status text NOT NULL,
  assertion_details jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;

WITH object_checks AS (
  SELECT 'verification_challenges_table_present'::text AS check_name,
         CASE WHEN to_regclass('public.identity_claim_verification_challenges') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         jsonb_build_object('table', 'public.identity_claim_verification_challenges') AS details
  UNION ALL
  SELECT 'component_resolutions_table_present',
         CASE WHEN to_regclass('public.identity_component_resolutions') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('table', 'public.identity_component_resolutions')
  UNION ALL
  SELECT 'activation_audit_table_present',
         CASE WHEN to_regclass('public.identity_activation_audit') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('table', 'public.identity_activation_audit')
  UNION ALL
  SELECT 'begin_verification_function_present',
         CASE WHEN to_regprocedure('public.begin_member_identity_claim_verification(text,text,text,text,integer,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('function', 'public.begin_member_identity_claim_verification')
  UNION ALL
  SELECT 'consume_verification_function_present',
         CASE WHEN to_regprocedure('public.consume_member_identity_claim_verification(text,text,text,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('function', 'public.consume_member_identity_claim_verification')
  UNION ALL
  SELECT 'finalize_activation_function_present',
         CASE WHEN to_regprocedure('public.finalize_member_identity_activation(text,uuid,text,text,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('function', 'public.finalize_member_identity_activation')
),
privilege_checks AS (
  SELECT 'stage8a_eval_still_service_role_only'::text AS check_name,
         CASE
           WHEN NOT has_function_privilege('anon', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.evaluate_member_identity_claim(text,text,text,text,text,text,uuid[],text,text,text)', 'EXECUTE')
           THEN 'PASS' ELSE 'FAIL' END AS status,
         jsonb_build_object('function', 'public.evaluate_member_identity_claim') AS details
  UNION ALL
  SELECT 'stage8b_begin_service_role_only',
         CASE
           WHEN NOT has_function_privilege('anon', 'public.begin_member_identity_claim_verification(text,text,text,text,integer,text,text,text)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.begin_member_identity_claim_verification(text,text,text,text,integer,text,text,text)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.begin_member_identity_claim_verification(text,text,text,text,integer,text,text,text)', 'EXECUTE')
           THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('function', 'public.begin_member_identity_claim_verification')
  UNION ALL
  SELECT 'stage8b_consume_service_role_only',
         CASE
           WHEN NOT has_function_privilege('anon', 'public.consume_member_identity_claim_verification(text,text,text,text,text,text)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.consume_member_identity_claim_verification(text,text,text,text,text,text)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.consume_member_identity_claim_verification(text,text,text,text,text,text)', 'EXECUTE')
           THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('function', 'public.consume_member_identity_claim_verification')
  UNION ALL
  SELECT 'stage8b_finalize_service_role_only',
         CASE
           WHEN NOT has_function_privilege('anon', 'public.finalize_member_identity_activation(text,uuid,text,text,text,text,text)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.finalize_member_identity_activation(text,uuid,text,text,text,text,text)', 'EXECUTE')
            AND has_function_privilege('service_role', 'public.finalize_member_identity_activation(text,uuid,text,text,text,text,text)', 'EXECUTE')
           THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('function', 'public.finalize_member_identity_activation')
),
rls_checks AS (
  SELECT 'verification_challenges_rls_enabled'::text AS check_name,
         CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS status,
         jsonb_build_object('table', 'public.identity_claim_verification_challenges') AS details
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'identity_claim_verification_challenges'
  UNION ALL
  SELECT 'component_resolutions_rls_enabled',
         CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('table', 'public.identity_component_resolutions')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'identity_component_resolutions'
  UNION ALL
  SELECT 'activation_audit_rls_enabled',
         CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('table', 'public.identity_activation_audit')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'identity_activation_audit'
),
search_path_checks AS (
  SELECT
    'fixed_search_path_' || p.proname AS check_name,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg
        WHERE cfg = 'search_path=public'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    jsonb_build_object('function', p.proname, 'proconfig', coalesce(p.proconfig, '{}'::text[])) AS details
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'evaluate_member_identity_claim',
      'get_unresolved_identity_component_roles',
      'begin_member_identity_claim_verification',
      'consume_member_identity_claim_verification',
      'finalize_member_identity_activation'
    )
),
all_checks AS (
  SELECT * FROM object_checks
  UNION ALL
  SELECT * FROM privilege_checks
  UNION ALL
  SELECT * FROM rls_checks
  UNION ALL
  SELECT * FROM search_path_checks
)
INSERT INTO stage8b_assertions (assertion_name, assertion_status, assertion_details)
SELECT check_name, status, details
FROM all_checks;

DO $$
DECLARE
  v_people_count_before bigint;
  v_people_count_after bigint;
  v_person_auth_count_before bigint;
  v_person_auth_count_after bigint;
  v_stage5b_role_count_before bigint;
  v_stage5b_role_count_after bigint;
  v_component_resolution_count_before bigint;
  v_component_resolution_count_after bigint;

  v_primary_auth_user_id uuid;
  v_primary_person_id uuid;
  v_conflict_person_id uuid;

  v_email text;
  v_phone text;
  v_channel text;
  v_destination_hash text;

  v_success_attempt_id uuid;
  v_success_attempt_token text;
  v_expired_attempt_id uuid;
  v_expired_attempt_token text;
  v_limit_attempt_id uuid;
  v_limit_attempt_token text;
  v_conflict_attempt_id uuid;
  v_conflict_attempt_token text;

  v_begin_status text;
  v_consume_status text;
  v_replay_status text;
  v_expired_status text;
  v_limit_final_status text;

  v_finalize_status_1 text;
  v_finalize_status_2 text;
  v_activated_person_1 uuid;
  v_activated_person_2 uuid;
  v_auth_link_created_1 boolean;
  v_auth_link_created_2 boolean;

  v_failed_attempt_count integer;
  v_challenge_status text;
  v_conflict_error text;

  i integer;
BEGIN
  SELECT count(*) INTO v_people_count_before FROM public.people;
  SELECT count(*) INTO v_person_auth_count_before FROM public.person_auth_accounts;
  SELECT count(*) INTO v_stage5b_role_count_before
  FROM public.person_role_instances
  WHERE source_manifest_version = '20260727_stage5b_identity_resolution_manifest.sql';
  SELECT count(*) INTO v_component_resolution_count_before
  FROM public.identity_component_resolutions;

  SELECT paa.auth_user_id, paa.person_id
  INTO v_primary_auth_user_id, v_primary_person_id
  FROM public.person_auth_accounts paa
  WHERE paa.status = 'active'
  ORDER BY paa.updated_at DESC NULLS LAST, paa.created_at DESC
  LIMIT 1;

  IF v_primary_auth_user_id IS NULL OR v_primary_person_id IS NULL THEN
    INSERT INTO stage8b_assertions VALUES (
      'fixture_existing_auth_link_available',
      'FAIL',
      jsonb_build_object('reason', 'no_active_person_auth_account_found')
    );
    RETURN;
  END IF;

  INSERT INTO stage8b_assertions VALUES (
    'fixture_existing_auth_link_available',
    'PASS',
    jsonb_build_object('auth_user_id', v_primary_auth_user_id, 'person_id', v_primary_person_id)
  );

  SELECT u.email, u.phone
  INTO v_email, v_phone
  FROM auth.users u
  WHERE u.id = v_primary_auth_user_id;

  IF v_phone IS NOT NULL AND btrim(v_phone) <> '' THEN
    v_channel := 'sms';
    v_destination_hash := md5(regexp_replace(v_phone, '[^0-9]', '', 'g'));
  ELSIF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
    v_channel := 'email';
    v_destination_hash := md5(lower(btrim(v_email)));
  ELSE
    INSERT INTO stage8b_assertions VALUES (
      'fixture_contact_available',
      'FAIL',
      jsonb_build_object('reason', 'auth_user_has_no_email_or_phone', 'auth_user_id', v_primary_auth_user_id)
    );
    RETURN;
  END IF;

  INSERT INTO stage8b_assertions VALUES (
    'fixture_contact_available',
    'PASS',
    jsonb_build_object('channel', v_channel)
  );

  SELECT paa.person_id
  INTO v_conflict_person_id
  FROM public.person_auth_accounts paa
  WHERE paa.person_id <> v_primary_person_id
  ORDER BY paa.updated_at DESC NULLS LAST, paa.created_at DESC
  LIMIT 1;

  IF v_conflict_person_id IS NULL THEN
    INSERT INTO stage8b_assertions VALUES (
      'fixture_conflict_person_available',
      'FAIL',
      jsonb_build_object('reason', 'no_second_person_with_auth_link_found')
    );
    RETURN;
  END IF;

  INSERT INTO stage8b_assertions VALUES (
    'fixture_conflict_person_available',
    'PASS',
    jsonb_build_object('conflict_person_id', v_conflict_person_id)
  );

  INSERT INTO public.identity_claim_attempts (
    completed_at,
    public_attempt_token,
    status,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    evidence_categories,
    matched_person_id,
    requested_event_count,
    matched_event_count,
    first_name_hash,
    last_name_hash,
    email_hash,
    phone_hash,
    expires_at,
    request_metadata
  ) VALUES (
    now(),
    md5(gen_random_uuid()::text || clock_timestamp()::text),
    'completed',
    'UNIQUE_CANDIDATE',
    'CONTINUE_VERIFICATION',
    'ONE_PERSON',
    ARRAY[v_channel],
    v_primary_person_id,
    0,
    0,
    md5('stage8b'),
    md5('success'),
    CASE WHEN v_channel = 'email' THEN v_destination_hash ELSE NULL END,
    CASE WHEN v_channel = 'sms' THEN v_destination_hash ELSE NULL END,
    now() + interval '30 minutes',
    jsonb_build_object('request_source', 'stage8b_validation_success')
  ) RETURNING id, public_attempt_token INTO v_success_attempt_id, v_success_attempt_token;

  SELECT verification_status
  INTO v_begin_status
  FROM public.begin_member_identity_claim_verification(
    v_success_attempt_token,
    v_channel,
    v_destination_hash,
    md5('111111'),
    600,
    md5('127.0.0.1'),
    md5('stage8b-validator'),
    'stage8b_validation'
  )
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'verification_begin_pending',
    CASE WHEN v_begin_status = 'PENDING' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('verification_status', coalesce(v_begin_status, 'NULL'))
  );

  SELECT verification_status
  INTO v_consume_status
  FROM public.consume_member_identity_claim_verification(
    v_success_attempt_token,
    v_channel,
    v_destination_hash,
    md5('111111'),
    md5('127.0.0.1'),
    md5('stage8b-validator')
  )
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'verification_consume_verified',
    CASE WHEN v_consume_status = 'VERIFIED' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('verification_status', coalesce(v_consume_status, 'NULL'))
  );

  SELECT verification_status
  INTO v_replay_status
  FROM public.consume_member_identity_claim_verification(
    v_success_attempt_token,
    v_channel,
    v_destination_hash,
    md5('111111'),
    md5('127.0.0.1'),
    md5('stage8b-validator')
  )
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'verification_replay_rejected',
    CASE WHEN v_replay_status = 'REJECTED' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('verification_status', coalesce(v_replay_status, 'NULL'))
  );

  SELECT activation_status, activated_person_id, auth_link_created
  INTO v_finalize_status_1, v_activated_person_1, v_auth_link_created_1
  FROM public.finalize_member_identity_activation(
    v_success_attempt_token,
    v_primary_auth_user_id,
    v_channel,
    v_destination_hash,
    md5('127.0.0.1'),
    md5('stage8b-validator'),
    'stage8b_validation'
  )
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'finalize_activation_success',
    CASE
      WHEN v_finalize_status_1 = 'ACTIVATED'
       AND v_activated_person_1 = v_primary_person_id
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'activation_status', coalesce(v_finalize_status_1, 'NULL'),
      'activated_person_id', v_activated_person_1,
      'expected_person_id', v_primary_person_id
    )
  );

  INSERT INTO stage8b_assertions VALUES (
    'existing_auth_user_reused',
    CASE WHEN v_auth_link_created_1 = false THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('auth_link_created', coalesce(v_auth_link_created_1, false))
  );

  SELECT activation_status, activated_person_id, auth_link_created
  INTO v_finalize_status_2, v_activated_person_2, v_auth_link_created_2
  FROM public.finalize_member_identity_activation(
    v_success_attempt_token,
    v_primary_auth_user_id,
    v_channel,
    v_destination_hash,
    md5('127.0.0.1'),
    md5('stage8b-validator'),
    'stage8b_validation'
  )
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'finalize_idempotent_retry',
    CASE
      WHEN v_finalize_status_2 = 'ACTIVATED'
       AND v_activated_person_2 = v_primary_person_id
       AND v_auth_link_created_2 = false
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'activation_status', coalesce(v_finalize_status_2, 'NULL'),
      'activated_person_id', v_activated_person_2,
      'auth_link_created', coalesce(v_auth_link_created_2, false)
    )
  );

  INSERT INTO public.identity_claim_attempts (
    completed_at,
    public_attempt_token,
    status,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    evidence_categories,
    matched_person_id,
    requested_event_count,
    matched_event_count,
    first_name_hash,
    last_name_hash,
    email_hash,
    phone_hash,
    expires_at,
    request_metadata
  ) VALUES (
    now(),
    md5(gen_random_uuid()::text || clock_timestamp()::text),
    'completed',
    'UNIQUE_CANDIDATE',
    'CONTINUE_VERIFICATION',
    'ONE_PERSON',
    ARRAY[v_channel],
    v_primary_person_id,
    0,
    0,
    md5('stage8b'),
    md5('expired'),
    CASE WHEN v_channel = 'email' THEN v_destination_hash ELSE NULL END,
    CASE WHEN v_channel = 'sms' THEN v_destination_hash ELSE NULL END,
    now() + interval '30 minutes',
    jsonb_build_object('request_source', 'stage8b_validation_expired')
  ) RETURNING id, public_attempt_token INTO v_expired_attempt_id, v_expired_attempt_token;

  PERFORM public.begin_member_identity_claim_verification(
    v_expired_attempt_token,
    v_channel,
    v_destination_hash,
    md5('333333'),
    600,
    md5('127.0.0.1'),
    md5('stage8b-validator'),
    'stage8b_validation'
  );

  UPDATE public.identity_claim_verification_challenges
  SET expires_at = now() - interval '1 second', updated_at = now()
  WHERE attempt_id = v_expired_attempt_id
    AND channel = v_channel
    AND destination_hash = v_destination_hash
    AND status = 'pending';

  SELECT verification_status
  INTO v_expired_status
  FROM public.consume_member_identity_claim_verification(
    v_expired_attempt_token,
    v_channel,
    v_destination_hash,
    md5('333333'),
    md5('127.0.0.1'),
    md5('stage8b-validator')
  )
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'expired_challenge_rejected',
    CASE WHEN v_expired_status = 'EXPIRED' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('verification_status', coalesce(v_expired_status, 'NULL'))
  );

  INSERT INTO public.identity_claim_attempts (
    completed_at,
    public_attempt_token,
    status,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    evidence_categories,
    matched_person_id,
    requested_event_count,
    matched_event_count,
    first_name_hash,
    last_name_hash,
    email_hash,
    phone_hash,
    expires_at,
    request_metadata
  ) VALUES (
    now(),
    md5(gen_random_uuid()::text || clock_timestamp()::text),
    'completed',
    'UNIQUE_CANDIDATE',
    'CONTINUE_VERIFICATION',
    'ONE_PERSON',
    ARRAY[v_channel],
    v_primary_person_id,
    0,
    0,
    md5('stage8b'),
    md5('limits'),
    CASE WHEN v_channel = 'email' THEN v_destination_hash ELSE NULL END,
    CASE WHEN v_channel = 'sms' THEN v_destination_hash ELSE NULL END,
    now() + interval '30 minutes',
    jsonb_build_object('request_source', 'stage8b_validation_limits')
  ) RETURNING id, public_attempt_token INTO v_limit_attempt_id, v_limit_attempt_token;

  PERFORM public.begin_member_identity_claim_verification(
    v_limit_attempt_token,
    v_channel,
    v_destination_hash,
    md5('222222'),
    600,
    md5('127.0.0.1'),
    md5('stage8b-validator'),
    'stage8b_validation'
  );

  FOR i IN 1..5 LOOP
    PERFORM public.consume_member_identity_claim_verification(
      v_limit_attempt_token,
      v_channel,
      v_destination_hash,
      md5('000000'),
      md5('127.0.0.1'),
      md5('stage8b-validator')
    );
  END LOOP;

  SELECT c.failed_attempt_count, c.status
  INTO v_failed_attempt_count, v_challenge_status
  FROM public.identity_claim_verification_challenges c
  WHERE c.attempt_id = v_limit_attempt_id
    AND c.channel = v_channel
    AND c.destination_hash = v_destination_hash
  ORDER BY c.created_at DESC
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'wrong_code_attempt_limit_enforced',
    CASE
      WHEN v_failed_attempt_count = 5 AND v_challenge_status = 'failed'
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'failed_attempt_count', coalesce(v_failed_attempt_count, -1),
      'challenge_status', coalesce(v_challenge_status, 'NULL')
    )
  );

  SELECT verification_status
  INTO v_limit_final_status
  FROM public.consume_member_identity_claim_verification(
    v_limit_attempt_token,
    v_channel,
    v_destination_hash,
    md5('222222'),
    md5('127.0.0.1'),
    md5('stage8b-validator')
  )
  LIMIT 1;

  INSERT INTO stage8b_assertions VALUES (
    'post_limit_consume_rejected',
    CASE WHEN v_limit_final_status = 'REJECTED' THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('verification_status', coalesce(v_limit_final_status, 'NULL'))
  );

  INSERT INTO public.identity_claim_attempts (
    completed_at,
    public_attempt_token,
    status,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    evidence_categories,
    matched_person_id,
    requested_event_count,
    matched_event_count,
    first_name_hash,
    last_name_hash,
    email_hash,
    phone_hash,
    expires_at,
    request_metadata
  ) VALUES (
    now(),
    md5(gen_random_uuid()::text || clock_timestamp()::text),
    'completed',
    'UNIQUE_CANDIDATE',
    'CONTINUE_VERIFICATION',
    'ONE_PERSON',
    ARRAY[v_channel],
    v_conflict_person_id,
    0,
    0,
    md5('stage8b'),
    md5('conflict'),
    CASE WHEN v_channel = 'email' THEN v_destination_hash ELSE NULL END,
    CASE WHEN v_channel = 'sms' THEN v_destination_hash ELSE NULL END,
    now() + interval '30 minutes',
    jsonb_build_object('request_source', 'stage8b_validation_conflict')
  ) RETURNING id, public_attempt_token INTO v_conflict_attempt_id, v_conflict_attempt_token;

  PERFORM public.begin_member_identity_claim_verification(
    v_conflict_attempt_token,
    v_channel,
    v_destination_hash,
    md5('444444'),
    600,
    md5('127.0.0.1'),
    md5('stage8b-validator'),
    'stage8b_validation'
  );

  PERFORM public.consume_member_identity_claim_verification(
    v_conflict_attempt_token,
    v_channel,
    v_destination_hash,
    md5('444444'),
    md5('127.0.0.1'),
    md5('stage8b-validator')
  );

  BEGIN
    PERFORM public.finalize_member_identity_activation(
      v_conflict_attempt_token,
      v_primary_auth_user_id,
      v_channel,
      v_destination_hash,
      md5('127.0.0.1'),
      md5('stage8b-validator'),
      'stage8b_validation'
    );

    INSERT INTO stage8b_assertions VALUES (
      'auth_ownership_conflict_rejected',
      'FAIL',
      jsonb_build_object('reason', 'finalize_did_not_raise')
    );
  EXCEPTION WHEN OTHERS THEN
    v_conflict_error := SQLERRM;
    INSERT INTO stage8b_assertions VALUES (
      'auth_ownership_conflict_rejected',
      CASE WHEN position('ownership violation' in lower(v_conflict_error)) > 0 THEN 'PASS' ELSE 'FAIL' END,
      jsonb_build_object('error', v_conflict_error)
    );
  END;

  SELECT count(*) INTO v_people_count_after FROM public.people;
  SELECT count(*) INTO v_person_auth_count_after FROM public.person_auth_accounts;
  SELECT count(*) INTO v_stage5b_role_count_after
  FROM public.person_role_instances
  WHERE source_manifest_version = '20260727_stage5b_identity_resolution_manifest.sql';
  SELECT count(*) INTO v_component_resolution_count_after
  FROM public.identity_component_resolutions;

  INSERT INTO stage8b_assertions VALUES (
    'canonical_people_preserved',
    CASE WHEN v_people_count_before = v_people_count_after THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('before', v_people_count_before, 'after', v_people_count_after)
  );

  INSERT INTO stage8b_assertions VALUES (
    'person_auth_row_count_preserved',
    CASE WHEN v_person_auth_count_before = v_person_auth_count_after THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('before', v_person_auth_count_before, 'after', v_person_auth_count_after)
  );

  INSERT INTO stage8b_assertions VALUES (
    'unrelated_stage5b_components_unchanged',
    CASE WHEN v_stage5b_role_count_before = v_stage5b_role_count_after THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('before', v_stage5b_role_count_before, 'after', v_stage5b_role_count_after)
  );

  INSERT INTO stage8b_assertions VALUES (
    'component_resolution_rows_preserved',
    CASE WHEN v_component_resolution_count_before = v_component_resolution_count_after THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('before', v_component_resolution_count_before, 'after', v_component_resolution_count_after)
  );
END
$$;

SELECT
  'STAGE8B_VALIDATION_ASSERTIONS'::text AS result_set_name,
  assertion_name::text AS row_key,
  jsonb_build_object(
    'status', assertion_status,
    'details', assertion_details
  ) AS row_data
FROM stage8b_assertions
ORDER BY assertion_name;

WITH summary AS (
  SELECT
    count(*)::int AS assertion_count,
    count(*) FILTER (WHERE assertion_status = 'PASS')::int AS pass_count,
    count(*) FILTER (WHERE assertion_status = 'FAIL')::int AS fail_count
  FROM stage8b_assertions
)
SELECT
  'STAGE8B_ASSERTION_SUMMARY'::text AS result_set_name,
  'summary'::text AS row_key,
  jsonb_build_object(
    'assertion_count', assertion_count,
    'pass_count', pass_count,
    'fail_count', fail_count,
    'all_passed', (fail_count = 0),
    'transaction_rolled_back', true
  ) AS row_data
FROM summary;

ROLLBACK;
