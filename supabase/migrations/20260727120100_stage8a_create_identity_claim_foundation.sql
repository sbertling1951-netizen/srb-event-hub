/*
Stage 8A: Safe member self-claim foundation.

Scope:
- create a private identity-claim attempt audit table
- create a deterministic identity-claim evaluation function
- allow only narrow claim-attempt audit writes

Non-scope:
- no auth account creation
- no person merges
- no attendee ownership changes
- no Stage 5B component resolution
*/

CREATE TABLE IF NOT EXISTS public.identity_claim_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  public_attempt_token text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (
    status IN ('pending', 'completed', 'expired', 'error')
  ),
  internal_result_classification text NOT NULL CHECK (
    internal_result_classification IN (
      'UNIQUE_CANDIDATE',
      'ADDITIONAL_EVIDENCE_REQUIRED',
      'ADMIN_REVIEW_REQUIRED',
      'NO_EXISTING_MATCH',
      'INELIGIBLE',
      'EXPIRED',
      'ERROR'
    )
  ),
  public_result_classification text NOT NULL CHECK (
    public_result_classification IN (
      'CONTINUE_VERIFICATION',
      'REVIEW_REQUIRED',
      'CREATE_NEW_ACCOUNT_AVAILABLE',
      'UNABLE_TO_VERIFY'
    )
  ),
  candidate_count_classification text NOT NULL CHECK (
    candidate_count_classification IN (
      'NONE',
      'ONE_PERSON',
      'ONE_UNRESOLVED_COMPONENT',
      'MULTIPLE',
      'MIXED',
      'INELIGIBLE',
      'ERROR'
    )
  ),
  evidence_categories text[] NOT NULL DEFAULT '{}'::text[],
  matched_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  matched_component_id text,
  review_reason text,
  requested_event_count integer NOT NULL DEFAULT 0 CHECK (requested_event_count >= 0),
  matched_event_count integer NOT NULL DEFAULT 0 CHECK (matched_event_count >= 0),
  first_name_hash text,
  last_name_hash text,
  email_hash text,
  phone_hash text,
  membership_number_hash text,
  state_hash text,
  request_ip_hash text,
  user_agent_hash text,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  CONSTRAINT identity_claim_attempts_public_attempt_token_unique UNIQUE (public_attempt_token),
  CONSTRAINT identity_claim_attempts_single_match_target CHECK (
    num_nonnulls(matched_person_id, matched_component_id) <= 1
  ),
  CONSTRAINT identity_claim_attempts_completion_consistency CHECK (
    (status = 'pending' AND completed_at IS NULL)
    OR (status <> 'pending' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_claim_attempts_created_at_idx
  ON public.identity_claim_attempts (created_at);

CREATE INDEX IF NOT EXISTS identity_claim_attempts_status_idx
  ON public.identity_claim_attempts (status);

CREATE INDEX IF NOT EXISTS identity_claim_attempts_expires_at_idx
  ON public.identity_claim_attempts (expires_at);

CREATE INDEX IF NOT EXISTS identity_claim_attempts_matched_person_id_idx
  ON public.identity_claim_attempts (matched_person_id);

ALTER TABLE public.identity_claim_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_claim_attempts'
      AND policyname = 'deny_all_anonymous_identity_claim_attempts'
  ) THEN
    CREATE POLICY deny_all_anonymous_identity_claim_attempts
      ON public.identity_claim_attempts
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_claim_attempts'
      AND policyname = 'deny_all_authenticated_identity_claim_attempts'
  ) THEN
    CREATE POLICY deny_all_authenticated_identity_claim_attempts
      ON public.identity_claim_attempts
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.evaluate_member_identity_claim(
  p_first_name text,
  p_last_name text,
  p_home_state text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_membership_number text DEFAULT NULL,
  p_event_ids uuid[] DEFAULT NULL,
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL,
  p_request_source text DEFAULT 'member_activation_api'
)
RETURNS TABLE(
  attempt_id uuid,
  public_attempt_token text,
  internal_result_classification text,
  public_result_classification text,
  candidate_count_classification text,
  matched_person_id uuid,
  matched_component_id text,
  review_reason text,
  status text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_first_name text;
  v_last_name text;
  v_home_state text;
  v_email text;
  v_phone text;
  v_membership_number text;
  v_event_ids uuid[];
  v_valid_event_ids uuid[];
  v_requested_event_count integer;
  v_selected_event_count integer;
  v_evidence_categories text[];
  v_strong_input_count integer;
  v_supporting_input_count integer;
  v_additional_evidence_count integer;
  v_internal_result text;
  v_public_result text;
  v_candidate_count_classification text;
  v_matched_person_id uuid;
  v_matched_component_id text;
  v_review_reason text;
  v_matched_event_count integer;
  v_attempt_id uuid;
  v_public_attempt_token text;
  v_expires_at timestamptz;
BEGIN
  v_first_name := lower(regexp_replace(trim(coalesce(p_first_name, '')), '\s+', ' ', 'g'));
  v_last_name := lower(regexp_replace(trim(coalesce(p_last_name, '')), '\s+', ' ', 'g'));
  v_home_state := upper(trim(coalesce(p_home_state, '')));
  v_email := lower(trim(coalesce(p_email, '')));
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_membership_number := upper(trim(coalesce(p_membership_number, '')));
  v_expires_at := now() + interval '30 minutes';
  v_public_attempt_token :=
    md5(gen_random_uuid()::text || clock_timestamp()::text)
    || md5(random()::text || gen_random_uuid()::text);

  IF length(v_phone) = 11 AND left(v_phone, 1) = '1' THEN
    v_phone := substring(v_phone from 2);
  END IF;

  IF v_home_state = '' THEN
    v_home_state := NULL;
  END IF;

  IF v_email = '' THEN
    v_email := NULL;
  END IF;

  IF v_phone = '' THEN
    v_phone := NULL;
  END IF;

  IF v_membership_number = '' THEN
    v_membership_number := NULL;
  END IF;

  SELECT coalesce(array_agg(DISTINCT event_id ORDER BY event_id), '{}'::uuid[])
  INTO v_event_ids
  FROM unnest(coalesce(p_event_ids, '{}'::uuid[])) AS event_id
  WHERE event_id IS NOT NULL;

  v_requested_event_count := coalesce(array_length(v_event_ids, 1), 0);

  SELECT coalesce(array_agg(e.id ORDER BY e.id), '{}'::uuid[])
  INTO v_valid_event_ids
  FROM public.events e
  WHERE e.id = ANY(v_event_ids)
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN (
      'inactive',
      'archived',
      'complete',
      'completed',
      'closed',
      'draft'
    );

  v_selected_event_count := coalesce(array_length(v_valid_event_ids, 1), 0);
  v_evidence_categories := array_remove(
    ARRAY[
      CASE WHEN v_email IS NOT NULL THEN 'email' END,
      CASE WHEN v_phone IS NOT NULL THEN 'phone' END,
      CASE WHEN v_membership_number IS NOT NULL THEN 'membership_number' END,
      CASE WHEN v_home_state IS NOT NULL THEN 'state' END,
      CASE WHEN v_selected_event_count > 0 THEN 'event_history' END
    ],
    NULL
  );
  v_strong_input_count :=
    CASE WHEN v_email IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN v_phone IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN v_membership_number IS NOT NULL THEN 1 ELSE 0 END;
  v_supporting_input_count :=
    CASE WHEN v_home_state IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN v_selected_event_count > 0 THEN 1 ELSE 0 END;
  v_additional_evidence_count := coalesce(array_length(v_evidence_categories, 1), 0);

  IF v_first_name = '' OR v_last_name = '' THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'NAME_REQUIRED';
    v_matched_event_count := 0;
  ELSIF v_additional_evidence_count = 0 THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'ADDITIONAL_EVIDENCE_REQUIRED';
    v_matched_event_count := 0;
  ELSIF v_requested_event_count <> v_selected_event_count THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'INVALID_EVENT_SELECTION';
    v_matched_event_count := 0;
  ELSIF v_strong_input_count = 0 THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'STRONG_EVIDENCE_REQUIRED';
    v_matched_event_count := 0;
  ELSE
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
    canonical_candidates AS (
      SELECT DISTINCT pnv.person_id
      FROM person_name_variants pnv
      WHERE pnv.first_name = v_first_name
        AND pnv.last_name = v_last_name
    ),
    canonical_candidate_scores AS (
      SELECT
        'PERSON'::text AS candidate_kind,
        cc.person_id,
        NULL::text AS component_id,
        EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = cc.person_id
            AND pi.identifier_type = 'email'
            AND pi.normalized_value = v_email
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND (
              lower(trim(coalesce(a.email, ''))) = v_email
              OR lower(trim(coalesce(a.copilot_email, ''))) = v_email
            )
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
          WHERE pri.person_id = cc.person_id
            AND lower(trim(coalesce(hm.email, ''))) = v_email
        ) AS email_match,
        EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = cc.person_id
            AND pi.identifier_type = 'phone'
            AND pi.normalized_value = v_phone
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND (
              regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g') = v_phone
              OR regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') = v_phone
            )
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
          WHERE pri.person_id = cc.person_id
            AND regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') = v_phone
        ) AS phone_match,
        EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = cc.person_id
            AND pi.identifier_type = 'membership_number'
            AND pi.normalized_value = v_membership_number
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND upper(trim(coalesce(a.membership_number, ''))) = v_membership_number
            AND upper(trim(coalesce(a.membership_number, ''))) NOT IN ('F123456', 'F999999', 'FM22222', 'FM2222222')
        ) AS membership_match,
        EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND upper(trim(coalesce(a.state, ''))) = v_home_state
        ) AS state_match,
        (
          SELECT count(DISTINCT pri.event_id)::integer
          FROM public.person_role_instances pri
          WHERE pri.person_id = cc.person_id
            AND pri.event_id = ANY(v_valid_event_ids)
        ) AS event_match_count,
        EXISTS (
          SELECT 1
          FROM public.person_auth_accounts paa
          WHERE paa.person_id = cc.person_id
            AND paa.status = 'active'
        ) AS has_active_auth_account,
        false AS is_stage5b_component
      FROM canonical_candidates cc
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
        NULLIF(lower(regexp_replace(trim(coalesce(a.pilot_first, '')), '\s+', ' ', 'g')), '') AS normalized_first_name,
        NULLIF(lower(regexp_replace(trim(coalesce(a.pilot_last, '')), '\s+', ' ', 'g')), '') AS normalized_last_name,
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
        NULLIF(lower(regexp_replace(trim(coalesce(a.copilot_first, '')), '\s+', ' ', 'g')), ''),
        NULLIF(lower(regexp_replace(trim(coalesce(a.copilot_last, '')), '\s+', ' ', 'g')), ''),
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
        NULLIF(lower(regexp_replace(trim(coalesce(hm.first_name, '')), '\s+', ' ', 'g')), ''),
        NULLIF(lower(regexp_replace(trim(coalesce(hm.last_name, '')), '\s+', ' ', 'g')), ''),
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
      WHERE evidence.normalized_first_name IS NOT NULL
        AND evidence.normalized_last_name IS NOT NULL
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
    unresolved_component_candidates AS (
      SELECT DISTINCT uca.component_id
      FROM unresolved_component_assignment uca
      JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
      WHERE up.normalized_first_name = v_first_name
        AND up.normalized_last_name = v_last_name
    ),
    unresolved_candidate_scores AS (
      SELECT
        'UNRESOLVED_COMPONENT'::text AS candidate_kind,
        NULL::uuid AS person_id,
        ucc.component_id,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_email = v_email
        ) AS email_match,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_phone = v_phone
        ) AS phone_match,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_membership_number = v_membership_number
            AND up.normalized_membership_number NOT IN ('F123456', 'F999999', 'FM22222', 'FM2222222')
        ) AS membership_match,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_state = v_home_state
        ) AS state_match,
        (
          SELECT count(DISTINCT up.event_id)::integer
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.event_id = ANY(v_valid_event_ids)
        ) AS event_match_count,
        false AS has_active_auth_account,
        EXISTS (
          SELECT 1
          FROM stage5b_manifest_components smc
          WHERE smc.component_id = ucc.component_id
        ) AS is_stage5b_component
      FROM unresolved_component_candidates ucc
    ),
    combined_candidate_scores AS (
      SELECT * FROM canonical_candidate_scores
      UNION ALL
      SELECT * FROM unresolved_candidate_scores
    ),
    matched_candidates AS (
      SELECT
        ccs.*,
        (CASE WHEN ccs.email_match THEN 1 ELSE 0 END
          + CASE WHEN ccs.phone_match THEN 1 ELSE 0 END
          + CASE WHEN ccs.membership_match THEN 1 ELSE 0 END) AS strong_match_count,
        (CASE WHEN ccs.state_match THEN 1 ELSE 0 END
          + CASE WHEN ccs.event_match_count > 0 THEN 1 ELSE 0 END
          + CASE WHEN ccs.has_active_auth_account THEN 1 ELSE 0 END) AS supporting_match_count
      FROM combined_candidate_scores ccs
      WHERE ccs.email_match
         OR ccs.phone_match
         OR ccs.membership_match
    ),
    candidate_summary AS (
      SELECT
        count(*)::integer AS candidate_count,
        count(*) FILTER (WHERE candidate_kind = 'PERSON')::integer AS person_candidate_count,
        count(*) FILTER (WHERE candidate_kind = 'UNRESOLVED_COMPONENT')::integer AS component_candidate_count,
        coalesce(max(event_match_count), 0)::integer AS max_event_match_count
      FROM matched_candidates
    ),
    selected_candidate AS (
      SELECT mc.*
      FROM matched_candidates mc
      CROSS JOIN candidate_summary cs
      WHERE cs.candidate_count = 1
      LIMIT 1
    )
    SELECT
      CASE
        WHEN cs.candidate_count = 0 THEN 'NO_EXISTING_MATCH'
        WHEN cs.candidate_count > 1 THEN 'ADMIN_REVIEW_REQUIRED'
        WHEN sc.membership_match AND (sc.email_match OR sc.phone_match OR sc.state_match OR sc.event_match_count > 0 OR sc.has_active_auth_account) THEN 'UNIQUE_CANDIDATE'
        WHEN (CASE WHEN sc.email_match THEN 1 ELSE 0 END + CASE WHEN sc.phone_match THEN 1 ELSE 0 END + CASE WHEN sc.membership_match THEN 1 ELSE 0 END) >= 2 THEN 'UNIQUE_CANDIDATE'
        WHEN (sc.email_match OR sc.phone_match OR sc.membership_match)
          AND (sc.state_match OR sc.event_match_count > 0 OR sc.has_active_auth_account)
        THEN 'UNIQUE_CANDIDATE'
        ELSE 'ADDITIONAL_EVIDENCE_REQUIRED'
      END AS internal_result,
      CASE
        WHEN cs.candidate_count = 0 THEN 'CREATE_NEW_ACCOUNT_AVAILABLE'
        WHEN cs.candidate_count > 1 THEN 'REVIEW_REQUIRED'
        ELSE 'CONTINUE_VERIFICATION'
      END AS public_result,
      CASE
        WHEN cs.candidate_count = 0 THEN 'NONE'
        WHEN cs.person_candidate_count = 1 AND cs.component_candidate_count = 0 THEN 'ONE_PERSON'
        WHEN cs.person_candidate_count = 0 AND cs.component_candidate_count = 1 THEN 'ONE_UNRESOLVED_COMPONENT'
        WHEN cs.person_candidate_count > 0 AND cs.component_candidate_count > 0 THEN 'MIXED'
        ELSE 'MULTIPLE'
      END AS candidate_count_classification,
      sc.person_id,
      sc.component_id,
      CASE
        WHEN cs.candidate_count = 0 THEN 'NO_MATCHING_HISTORICAL_EVIDENCE'
        WHEN cs.candidate_count > 1 THEN 'MULTIPLE_INTERNAL_CANDIDATES'
        WHEN sc.is_stage5b_component THEN 'STAGE5B_CLAIM_REQUIRED_COMPONENT'
        WHEN sc.has_active_auth_account THEN 'EXISTING_AUTH_RELATIONSHIP_PRESENT'
        WHEN sc.email_match OR sc.phone_match OR sc.membership_match THEN 'CLAIM_CANDIDATE_IDENTIFIED'
        ELSE 'ADDITIONAL_EVIDENCE_REQUIRED'
      END AS review_reason,
      coalesce(sc.event_match_count, 0)::integer AS matched_event_count
    INTO
      v_internal_result,
      v_public_result,
      v_candidate_count_classification,
      v_matched_person_id,
      v_matched_component_id,
      v_review_reason,
      v_matched_event_count
    FROM candidate_summary cs
    LEFT JOIN selected_candidate sc ON true;
  END IF;

  INSERT INTO public.identity_claim_attempts AS attempt (
    completed_at,
    public_attempt_token,
    status,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    evidence_categories,
    matched_person_id,
    matched_component_id,
    review_reason,
    requested_event_count,
    matched_event_count,
    first_name_hash,
    last_name_hash,
    email_hash,
    phone_hash,
    membership_number_hash,
    state_hash,
    request_ip_hash,
    user_agent_hash,
    request_metadata,
    expires_at
  )
  VALUES (
    now(),
    v_public_attempt_token,
    'completed',
    v_internal_result,
    v_public_result,
    v_candidate_count_classification,
    coalesce(v_evidence_categories, '{}'::text[]),
    v_matched_person_id,
    v_matched_component_id,
    v_review_reason,
    v_selected_event_count,
    coalesce(v_matched_event_count, 0),
    CASE WHEN v_first_name = '' THEN NULL ELSE md5(v_first_name) END,
    CASE WHEN v_last_name = '' THEN NULL ELSE md5(v_last_name) END,
    CASE WHEN v_email IS NULL THEN NULL ELSE md5(v_email) END,
    CASE WHEN v_phone IS NULL THEN NULL ELSE md5(v_phone) END,
    CASE WHEN v_membership_number IS NULL THEN NULL ELSE md5(v_membership_number) END,
    CASE WHEN v_home_state IS NULL THEN NULL ELSE md5(v_home_state) END,
    p_request_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'request_source', coalesce(nullif(trim(coalesce(p_request_source, '')), ''), 'member_activation_api'),
      'selected_event_count', v_selected_event_count,
      'strong_input_count', v_strong_input_count,
      'supporting_input_count', v_supporting_input_count
    ),
    v_expires_at
  )
  RETURNING
    attempt.id,
    attempt.public_attempt_token,
    attempt.internal_result_classification,
    attempt.public_result_classification,
    attempt.candidate_count_classification,
    attempt.matched_person_id,
    attempt.matched_component_id,
    attempt.review_reason,
    attempt.status,
    attempt.expires_at
  INTO
    attempt_id,
    public_attempt_token,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    matched_person_id,
    matched_component_id,
    review_reason,
    status,
    expires_at;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON TABLE public.identity_claim_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.identity_claim_attempts FROM anon;
REVOKE ALL ON TABLE public.identity_claim_attempts FROM authenticated;

REVOKE ALL ON FUNCTION public.evaluate_member_identity_claim(text, text, text, text, text, text, uuid[], text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_member_identity_claim(text, text, text, text, text, text, uuid[], text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.evaluate_member_identity_claim(text, text, text, text, text, text, uuid[], text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_member_identity_claim(text, text, text, text, text, text, uuid[], text, text, text) TO service_role;
