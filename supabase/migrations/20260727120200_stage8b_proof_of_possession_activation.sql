/*
Stage 8B: Proof-of-possession and controlled identity activation.

Extends Stage 8A by adding:
- one-time verification challenges
- replay-resistant challenge consumption
- idempotent person/auth linking
- controlled Stage 5B component resolution after verified possession

Preserves Stage 8A guarantees:
- evaluate_member_identity_claim remains unchanged and read-only except claim-attempt logging
- privacy-safe public classifications remain unchanged
*/

CREATE TABLE IF NOT EXISTS public.identity_claim_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  attempt_id uuid NOT NULL REFERENCES public.identity_claim_attempts(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination_hash text NOT NULL,
  code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'expired', 'failed', 'cancelled')),
  failed_attempt_count integer NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_ip_hash text,
  user_agent_hash text,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT identity_claim_verification_challenges_pending_consumed_consistency CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status <> 'consumed' AND consumed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_claim_verification_challenges_attempt_idx
  ON public.identity_claim_verification_challenges (attempt_id);

CREATE INDEX IF NOT EXISTS identity_claim_verification_challenges_status_idx
  ON public.identity_claim_verification_challenges (status);

CREATE INDEX IF NOT EXISTS identity_claim_verification_challenges_expires_idx
  ON public.identity_claim_verification_challenges (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS identity_claim_verification_pending_unique
  ON public.identity_claim_verification_challenges (attempt_id, channel, destination_hash)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.identity_component_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  component_id text NOT NULL UNIQUE,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  resolved_by_attempt_id uuid REFERENCES public.identity_claim_attempts(id) ON DELETE SET NULL,
  resolution_method text NOT NULL DEFAULT 'member_claim_verified' CHECK (
    resolution_method IN ('member_claim_verified')
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS identity_component_resolutions_person_idx
  ON public.identity_component_resolutions (person_id);

CREATE TABLE IF NOT EXISTS public.identity_activation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  attempt_id uuid REFERENCES public.identity_claim_attempts(id) ON DELETE SET NULL,
  challenge_id uuid REFERENCES public.identity_claim_verification_challenges(id) ON DELETE SET NULL,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  component_id text,
  action text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'rejected', 'error')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_ip_hash text,
  user_agent_hash text
);

CREATE INDEX IF NOT EXISTS identity_activation_audit_attempt_idx
  ON public.identity_activation_audit (attempt_id);

CREATE INDEX IF NOT EXISTS identity_activation_audit_created_idx
  ON public.identity_activation_audit (created_at);

ALTER TABLE public.identity_claim_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_component_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_activation_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_identity_claim_verification_challenges_updated_at'
      AND tgrelid = 'public.identity_claim_verification_challenges'::regclass
  ) THEN
    CREATE TRIGGER set_identity_claim_verification_challenges_updated_at
      BEFORE UPDATE ON public.identity_claim_verification_challenges
      FOR EACH ROW
      EXECUTE FUNCTION public.set_identity_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_identity_component_resolutions_updated_at'
      AND tgrelid = 'public.identity_component_resolutions'::regclass
  ) THEN
    CREATE TRIGGER set_identity_component_resolutions_updated_at
      BEFORE UPDATE ON public.identity_component_resolutions
      FOR EACH ROW
      EXECUTE FUNCTION public.set_identity_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_claim_verification_challenges'
      AND policyname = 'deny_all_anonymous_identity_claim_verification_challenges'
  ) THEN
    CREATE POLICY deny_all_anonymous_identity_claim_verification_challenges
      ON public.identity_claim_verification_challenges
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_claim_verification_challenges'
      AND policyname = 'deny_all_authenticated_identity_claim_verification_challenges'
  ) THEN
    CREATE POLICY deny_all_authenticated_identity_claim_verification_challenges
      ON public.identity_claim_verification_challenges
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_component_resolutions'
      AND policyname = 'deny_all_anonymous_identity_component_resolutions'
  ) THEN
    CREATE POLICY deny_all_anonymous_identity_component_resolutions
      ON public.identity_component_resolutions
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_component_resolutions'
      AND policyname = 'deny_all_authenticated_identity_component_resolutions'
  ) THEN
    CREATE POLICY deny_all_authenticated_identity_component_resolutions
      ON public.identity_component_resolutions
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_activation_audit'
      AND policyname = 'deny_all_anonymous_identity_activation_audit'
  ) THEN
    CREATE POLICY deny_all_anonymous_identity_activation_audit
      ON public.identity_activation_audit
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_activation_audit'
      AND policyname = 'deny_all_authenticated_identity_activation_audit'
  ) THEN
    CREATE POLICY deny_all_authenticated_identity_activation_audit
      ON public.identity_activation_audit
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.person_role_instances
  DROP CONSTRAINT IF EXISTS person_role_instances_attribution_method_check;

ALTER TABLE public.person_role_instances
  ADD CONSTRAINT person_role_instances_attribution_method_check
  CHECK (attribution_method IN ('automatic_backfill', 'member_claim_verified'));

CREATE OR REPLACE FUNCTION public.get_unresolved_identity_component_roles(
  p_component_id text
)
RETURNS TABLE(
  role_instance_key text,
  attendee_id uuid,
  event_id uuid,
  identity_role text,
  household_member_id uuid,
  source_table text,
  source_record_id uuid,
  normalized_first_name text,
  normalized_last_name text,
  normalized_email text,
  normalized_phone text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH RECURSIVE
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
    'PILOT'::text AS identity_role,
    NULL::uuid AS household_member_id,
    'public.attendees'::text AS source_table,
    a.id AS source_record_id,
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
    'COPILOT'::text,
    NULL::uuid,
    'public.attendees'::text,
    a.id,
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
    'HOUSEHOLD_MEMBER'::text,
    hm.id,
    'public.attendee_household_members'::text,
    hm.id,
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
)
SELECT
  up.role_instance_key,
  up.attendee_id,
  up.event_id,
  up.identity_role,
  up.household_member_id,
  up.source_table,
  up.source_record_id,
  up.normalized_first_name,
  up.normalized_last_name,
  up.normalized_email,
  up.normalized_phone
FROM unresolved_pool up
JOIN unresolved_component_assignment uca
  ON uca.role_instance_key = up.role_instance_key
WHERE uca.component_id = p_component_id;
$$;

CREATE OR REPLACE FUNCTION public.begin_member_identity_claim_verification(
  p_attempt_token text,
  p_channel text,
  p_destination_hash text,
  p_code_hash text,
  p_expires_in_seconds integer DEFAULT 600,
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL,
  p_request_source text DEFAULT 'member_activation_api'
)
RETURNS TABLE(
  verification_status text,
  public_result_classification text,
  expires_at timestamptz,
  can_send_code boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_attempt public.identity_claim_attempts%ROWTYPE;
  v_expires_at timestamptz;
  v_recent_count bigint;
  v_destination_matches boolean := false;
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.identity_claim_attempts
  WHERE public_attempt_token = p_attempt_token
  LIMIT 1;

  IF v_attempt.id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, 'UNABLE_TO_VERIFY'::text, NULL::timestamptz, false;
    RETURN;
  END IF;

  IF v_attempt.expires_at < now()
     OR v_attempt.public_result_classification <> 'CONTINUE_VERIFICATION'
     OR v_attempt.status <> 'completed'
  THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      'verification_challenge_requested',
      'rejected',
      jsonb_build_object('reason', 'attempt_not_eligible'),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, 'UNABLE_TO_VERIFY'::text, NULL::timestamptz, false;
    RETURN;
  END IF;

  IF p_channel = 'email' THEN
    v_destination_matches := (v_attempt.email_hash IS NOT NULL AND v_attempt.email_hash = p_destination_hash);
  ELSIF p_channel = 'sms' THEN
    v_destination_matches := (v_attempt.phone_hash IS NOT NULL AND v_attempt.phone_hash = p_destination_hash);
  END IF;

  IF NOT v_destination_matches THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      'verification_challenge_requested',
      'rejected',
      jsonb_build_object('reason', 'destination_hash_mismatch', 'channel', p_channel),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, 'UNABLE_TO_VERIFY'::text, NULL::timestamptz, false;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_recent_count
  FROM public.identity_claim_verification_challenges c
  WHERE c.attempt_id = v_attempt.id
    AND c.channel = p_channel
    AND c.created_at >= now() - interval '15 minutes';

  IF v_recent_count >= 5 THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      'verification_challenge_requested',
      'rejected',
      jsonb_build_object('reason', 'rate_limited', 'channel', p_channel),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, 'UNABLE_TO_VERIFY'::text, NULL::timestamptz, false;
    RETURN;
  END IF;

  UPDATE public.identity_claim_verification_challenges
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE attempt_id = v_attempt.id
    AND channel = p_channel
    AND destination_hash = p_destination_hash
    AND status = 'pending';

  v_expires_at := now() + make_interval(secs => greatest(60, least(coalesce(p_expires_in_seconds, 600), 3600)));

  INSERT INTO public.identity_claim_verification_challenges (
    attempt_id,
    channel,
    destination_hash,
    code_hash,
    expires_at,
    request_ip_hash,
    user_agent_hash,
    request_metadata
  ) VALUES (
    v_attempt.id,
    p_channel,
    p_destination_hash,
    p_code_hash,
    v_expires_at,
    p_request_ip_hash,
    p_user_agent_hash,
    jsonb_build_object('request_source', coalesce(nullif(trim(coalesce(p_request_source, '')), ''), 'member_activation_api'))
  );

  INSERT INTO public.identity_activation_audit (
    attempt_id,
    action,
    status,
    details,
    request_ip_hash,
    user_agent_hash
  ) VALUES (
    v_attempt.id,
    'verification_challenge_requested',
    'ok',
    jsonb_build_object('channel', p_channel, 'expires_at', v_expires_at),
    p_request_ip_hash,
    p_user_agent_hash
  );

  RETURN QUERY SELECT 'PENDING'::text, 'CONTINUE_VERIFICATION'::text, v_expires_at, true;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_member_identity_claim_verification(
  p_attempt_token text,
  p_channel text,
  p_destination_hash text,
  p_code_hash text,
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL
)
RETURNS TABLE(
  verification_status text,
  public_result_classification text,
  attempt_id uuid,
  challenge_id uuid,
  matched_person_id uuid,
  matched_component_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_attempt public.identity_claim_attempts%ROWTYPE;
  v_challenge public.identity_claim_verification_challenges%ROWTYPE;
  v_failed_count integer;
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.identity_claim_attempts
  WHERE public_attempt_token = p_attempt_token
  LIMIT 1;

  IF v_attempt.id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, 'UNABLE_TO_VERIFY'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.identity_claim_verification_challenges c
  WHERE c.attempt_id = v_attempt.id
    AND c.channel = p_channel
    AND c.destination_hash = p_destination_hash
    AND c.status = 'pending'
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_challenge.id IS NULL THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      'verification_challenge_consumed',
      'rejected',
      jsonb_build_object('reason', 'no_pending_challenge', 'channel', p_channel),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, 'UNABLE_TO_VERIFY'::text, v_attempt.id, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_challenge.expires_at < now() THEN
    UPDATE public.identity_claim_verification_challenges
    SET status = 'expired', updated_at = now()
    WHERE id = v_challenge.id;

    INSERT INTO public.identity_activation_audit (
      attempt_id,
      challenge_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      v_challenge.id,
      'verification_challenge_consumed',
      'rejected',
      jsonb_build_object('reason', 'challenge_expired'),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'EXPIRED'::text, 'UNABLE_TO_VERIFY'::text, v_attempt.id, v_challenge.id, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_challenge.code_hash <> p_code_hash THEN
    v_failed_count := v_challenge.failed_attempt_count + 1;

    UPDATE public.identity_claim_verification_challenges
    SET
      failed_attempt_count = v_failed_count,
      status = CASE WHEN v_failed_count >= v_challenge.max_attempts THEN 'failed' ELSE 'pending' END,
      updated_at = now()
    WHERE id = v_challenge.id;

    INSERT INTO public.identity_activation_audit (
      attempt_id,
      challenge_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      v_challenge.id,
      'verification_challenge_consumed',
      'rejected',
      jsonb_build_object('reason', 'code_mismatch', 'failed_attempt_count', v_failed_count),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, 'UNABLE_TO_VERIFY'::text, v_attempt.id, v_challenge.id, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  UPDATE public.identity_claim_verification_challenges
  SET
    status = 'consumed',
    consumed_at = now(),
    updated_at = now()
  WHERE id = v_challenge.id;

  INSERT INTO public.identity_activation_audit (
    attempt_id,
    challenge_id,
    action,
    status,
    details,
    request_ip_hash,
    user_agent_hash
  ) VALUES (
    v_attempt.id,
    v_challenge.id,
    'verification_challenge_consumed',
    'ok',
    jsonb_build_object('channel', p_channel),
    p_request_ip_hash,
    p_user_agent_hash
  );

  RETURN QUERY
  SELECT
    'VERIFIED'::text,
    'CONTINUE_VERIFICATION'::text,
    v_attempt.id,
    v_challenge.id,
    v_attempt.matched_person_id,
    v_attempt.matched_component_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_member_identity_activation(
  p_attempt_token text,
  p_auth_user_id uuid,
  p_verified_channel text,
  p_verified_destination_hash text,
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL,
  p_request_source text DEFAULT 'member_activation_api'
)
RETURNS TABLE(
  activation_status text,
  activated_person_id uuid,
  auth_link_created boolean,
  stage5b_component_resolved boolean,
  attendees_linked_count bigint,
  role_instances_created_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_attempt public.identity_claim_attempts%ROWTYPE;
  v_person_id uuid;
  v_existing_auth_link public.person_auth_accounts%ROWTYPE;
  v_any_primary_exists boolean;
  v_component_resolved public.identity_component_resolutions%ROWTYPE;
  v_linked_count bigint := 0;
  v_role_insert_count bigint := 0;
  v_component_resolution_performed boolean := false;
  v_display_first text;
  v_display_last text;
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.identity_claim_attempts
  WHERE public_attempt_token = p_attempt_token
  LIMIT 1;

  IF v_attempt.id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_attempt.public_result_classification <> 'CONTINUE_VERIFICATION'
     OR v_attempt.status <> 'completed'
     OR v_attempt.expires_at < now()
  THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      'activation_finalize',
      'rejected',
      jsonb_build_object('reason', 'attempt_not_eligible'),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.identity_claim_verification_challenges c
    WHERE c.attempt_id = v_attempt.id
      AND c.channel = p_verified_channel
      AND c.destination_hash = p_verified_destination_hash
      AND c.status = 'consumed'
      AND c.consumed_at IS NOT NULL
    ORDER BY c.consumed_at DESC
    LIMIT 1
  ) THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      'activation_finalize',
      'rejected',
      jsonb_build_object('reason', 'verification_not_consumed'),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_attempt.matched_person_id IS NOT NULL THEN
    v_person_id := v_attempt.matched_person_id;
  ELSIF v_attempt.matched_component_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_attempt.matched_component_id));

    SELECT *
    INTO v_component_resolved
    FROM public.identity_component_resolutions icr
    WHERE icr.component_id = v_attempt.matched_component_id
    LIMIT 1
    FOR UPDATE;

    IF v_component_resolved.id IS NOT NULL THEN
      v_person_id := v_component_resolved.person_id;
    ELSE
      SELECT
        min(initcap(coalesce(g.normalized_first_name, 'member'))),
        min(initcap(coalesce(g.normalized_last_name, 'claim')))
      INTO v_display_first, v_display_last
      FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id) g
      WHERE g.normalized_first_name IS NOT NULL
        AND g.normalized_last_name IS NOT NULL;

      INSERT INTO public.people (
        display_first_name,
        display_last_name,
        preferred_name,
        status
      ) VALUES (
        coalesce(v_display_first, 'Member'),
        coalesce(v_display_last, 'Claim'),
        NULL,
        'active'
      )
      RETURNING id INTO v_person_id;

      INSERT INTO public.identity_component_resolutions (
        component_id,
        person_id,
        resolved_by_attempt_id,
        metadata
      ) VALUES (
        v_attempt.matched_component_id,
        v_person_id,
        v_attempt.id,
        jsonb_build_object('request_source', coalesce(nullif(trim(coalesce(p_request_source, '')), ''), 'member_activation_api'))
      );

      v_component_resolution_performed := true;
    END IF;

    WITH component_roles AS (
      SELECT *
      FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id)
    ),
    conflicting_attendees AS (
      SELECT DISTINCT a.id
      FROM component_roles cr
      JOIN public.attendees a ON a.id = cr.attendee_id
      WHERE a.person_id IS NOT NULL
        AND a.person_id <> v_person_id
    )
    SELECT count(*)
    INTO v_linked_count
    FROM conflicting_attendees;

    IF v_linked_count > 0 THEN
      RAISE EXCEPTION 'Stage8B ownership violation: component attendees already linked to another person';
    END IF;

    UPDATE public.attendees a
    SET person_id = v_person_id
    WHERE a.id IN (
      SELECT DISTINCT cr.attendee_id
      FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id) cr
    )
      AND a.person_id IS NULL;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;

    INSERT INTO public.person_role_instances (
      person_id,
      tenant_id,
      event_id,
      attendee_id,
      identity_role,
      household_member_id,
      source_table,
      source_record_id,
      attribution_method,
      evidence_source,
      source_manifest_version,
      source_role_instance_key
    )
    SELECT
      v_person_id,
      NULL,
      cr.event_id,
      cr.attendee_id,
      cr.identity_role,
      cr.household_member_id,
      cr.source_table,
      cr.source_record_id,
      'member_claim_verified',
      'stage8b_member_identity_activation',
      '20260727120200_stage8b_proof_of_possession_activation.sql',
      cr.role_instance_key
    FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id) cr
    WHERE cr.identity_role IN ('PILOT', 'HOUSEHOLD_MEMBER')
    ON CONFLICT (source_role_instance_key) DO NOTHING;

    GET DIAGNOSTICS v_role_insert_count = ROW_COUNT;
  ELSE
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_person_id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing_auth_link
  FROM public.person_auth_accounts paa
  WHERE paa.auth_user_id = p_auth_user_id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_auth_link.id IS NOT NULL AND v_existing_auth_link.person_id <> v_person_id THEN
    RAISE EXCEPTION 'Stage8B ownership violation: auth user already linked to a different canonical person';
  END IF;

  IF v_existing_auth_link.id IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.person_auth_accounts paa
      WHERE paa.person_id = v_person_id
        AND paa.status = 'active'
        AND paa.is_primary = true
    ) INTO v_any_primary_exists;

    INSERT INTO public.person_auth_accounts (
      person_id,
      auth_user_id,
      status,
      is_primary,
      linked_at,
      verified_at
    ) VALUES (
      v_person_id,
      p_auth_user_id,
      'active',
      NOT coalesce(v_any_primary_exists, false),
      now(),
      now()
    );

    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      person_id,
      component_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      v_person_id,
      v_attempt.matched_component_id,
      'auth_link_upsert',
      'ok',
      jsonb_build_object('created', true),
      p_request_ip_hash,
      p_user_agent_hash
    );

    auth_link_created := true;
  ELSE
    UPDATE public.person_auth_accounts
    SET
      status = 'active',
      verified_at = coalesce(verified_at, now()),
      retired_at = NULL,
      updated_at = now()
    WHERE id = v_existing_auth_link.id;

    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      person_id,
      component_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      v_person_id,
      v_attempt.matched_component_id,
      'auth_link_upsert',
      'ok',
      jsonb_build_object('created', false),
      p_request_ip_hash,
      p_user_agent_hash
    );

    auth_link_created := false;
  END IF;

  INSERT INTO public.identity_activation_audit (
    attempt_id,
    auth_user_id,
    person_id,
    component_id,
    action,
    status,
    details,
    request_ip_hash,
    user_agent_hash
  ) VALUES (
    v_attempt.id,
    p_auth_user_id,
    v_person_id,
    v_attempt.matched_component_id,
    'activation_finalize',
    'ok',
    jsonb_build_object(
      'stage5b_component_resolved', v_component_resolution_performed,
      'attendees_linked_count', v_linked_count,
      'role_instances_created_count', v_role_insert_count
    ),
    p_request_ip_hash,
    p_user_agent_hash
  );

  activation_status := 'ACTIVATED';
  activated_person_id := v_person_id;
  stage5b_component_resolved := v_component_resolution_performed;
  attendees_linked_count := v_linked_count;
  role_instances_created_count := v_role_insert_count;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON TABLE public.identity_claim_verification_challenges FROM PUBLIC;
REVOKE ALL ON TABLE public.identity_claim_verification_challenges FROM anon;
REVOKE ALL ON TABLE public.identity_claim_verification_challenges FROM authenticated;

REVOKE ALL ON TABLE public.identity_component_resolutions FROM PUBLIC;
REVOKE ALL ON TABLE public.identity_component_resolutions FROM anon;
REVOKE ALL ON TABLE public.identity_component_resolutions FROM authenticated;

REVOKE ALL ON TABLE public.identity_activation_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.identity_activation_audit FROM anon;
REVOKE ALL ON TABLE public.identity_activation_audit FROM authenticated;

REVOKE ALL ON FUNCTION public.get_unresolved_identity_component_roles(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_unresolved_identity_component_roles(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_unresolved_identity_component_roles(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_unresolved_identity_component_roles(text) TO service_role;

REVOKE ALL ON FUNCTION public.begin_member_identity_claim_verification(text, text, text, text, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_member_identity_claim_verification(text, text, text, text, integer, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.begin_member_identity_claim_verification(text, text, text, text, integer, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.begin_member_identity_claim_verification(text, text, text, text, integer, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.consume_member_identity_claim_verification(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_member_identity_claim_verification(text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.consume_member_identity_claim_verification(text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_member_identity_claim_verification(text, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_member_identity_activation(text, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_member_identity_activation(text, uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_member_identity_activation(text, uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_member_identity_activation(text, uuid, text, text, text, text, text) TO service_role;