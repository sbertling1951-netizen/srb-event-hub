-- ============================================================
-- Magic-link identity activation support.
--
-- Purpose: let identity activation complete with a single Supabase
-- magic-link email instead of a custom numeric code, while reusing the
-- existing, already-audited identity-claim/verification-challenge
-- machinery from 20260727120100_stage8a_create_identity_claim_foundation.sql
-- and 20260727120200_stage8b_proof_of_possession_activation.sql rather
-- than creating a second, competing pending-activation system.
--
-- This migration is narrow and forward-only:
--   1. Adds one nullable-free, defaulted column so magic-link challenges
--      can be distinguished from code challenges (existing rows default
--      to 'code', so no backfill is required).
--   2. Adds begin_member_identity_claim_magic_link(), a thin wrapper
--      around the EXISTING begin_member_identity_claim_verification()
--      -- it does not duplicate that function's eligibility, destination
--      -- matching, or rate-limiting logic. A random, never-transmitted
--      placeholder value is used only to satisfy the pre-existing
--      code_hash NOT NULL constraint; magic-link activation never asks
--      the member to enter a code.
--   3. Adds finalize_member_identity_activation_via_magic_link(), which
--      derives the caller's verified identity strictly from auth.uid()
--      (never from a parameter), consumes the matching pending
--      magic-link challenge exactly once, and then delegates to the
--      EXISTING finalize_member_identity_activation() for all person
--      linking / person_auth_accounts / attendees.person_id logic --
--      that logic is not duplicated or altered here.
--
-- Canonical identity chain preserved:
--   auth.uid() -> person_auth_accounts.auth_user_id -> people.id
--   -> attendees.person_id
-- attendees.auth_user_id is not read or written by anything in this
-- migration.
--
-- NOT applied as part of this change. No identity evidence thresholds,
-- attribution rules, tenant architecture, or role-instance ownership
-- rules are altered.
-- ============================================================

------------------------------------------------------------------
-- 1. Distinguish magic-link challenges from code challenges.
------------------------------------------------------------------

ALTER TABLE public.identity_claim_verification_challenges
  ADD COLUMN IF NOT EXISTS verification_method text NOT NULL DEFAULT 'code'
  CHECK (verification_method IN ('code', 'magic_link'));

------------------------------------------------------------------
-- 2. begin_member_identity_claim_magic_link()
--
-- Thin wrapper: creates a pending challenge via the existing, unmodified
-- begin_member_identity_claim_verification() (same attempt-eligibility
-- check, same destination-hash match against the approved attempt, same
-- 15-minute / 5-attempt rate limit, same audit logging), then tags the
-- freshly created pending row as verification_method = 'magic_link'.
-- The partial unique index
-- identity_claim_verification_pending_unique(attempt_id, channel,
-- destination_hash) WHERE status = 'pending' guarantees at most one
-- pending row can match, so this tagging step cannot touch any other
-- challenge.
------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.begin_member_identity_claim_magic_link(
  p_attempt_token text,
  p_destination_hash text,
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL
)
RETURNS TABLE(
  verification_status text,
  public_result_classification text,
  expires_at timestamptz,
  can_send_link boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_placeholder_code text;
  v_result record;
  v_attempt_id uuid;
BEGIN
  -- Magic-link activation never asks the member to enter a code. This
  -- random value is generated, used once to satisfy the existing
  -- code_hash NOT NULL constraint, and is never transmitted to the
  -- member or usable for code-based consumption (only
  -- finalize_member_identity_activation_via_magic_link, below, can
  -- consume a verification_method = 'magic_link' row, and it never
  -- checks code_hash).
  v_placeholder_code := encode(gen_random_bytes(16), 'hex');

  SELECT *
    INTO v_result
  FROM public.begin_member_identity_claim_verification(
    p_attempt_token,
    'email',
    p_destination_hash,
    v_placeholder_code,
    600,
    p_request_ip_hash,
    p_user_agent_hash,
    'member_activation_magic_link_initiate_api'
  );

  IF v_result.can_send_code THEN
    SELECT a.id INTO v_attempt_id
    FROM public.identity_claim_attempts a
    WHERE a.public_attempt_token = p_attempt_token
    LIMIT 1;

    UPDATE public.identity_claim_verification_challenges c
    SET verification_method = 'magic_link'
    WHERE c.attempt_id = v_attempt_id
      AND c.channel = 'email'
      AND c.destination_hash = p_destination_hash
      AND c.status = 'pending';
  END IF;

  RETURN QUERY SELECT
    v_result.verification_status,
    v_result.public_result_classification,
    v_result.expires_at,
    v_result.can_send_code;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_member_identity_claim_magic_link(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_member_identity_claim_magic_link(text, text, text, text) TO service_role;

------------------------------------------------------------------
-- 3. finalize_member_identity_activation_via_magic_link()
--
-- Called directly by the browser's authenticated Supabase client
-- immediately after the /auth/callback route establishes a session
-- from the magic link. Derives the verified email strictly from
-- auth.uid() / auth.users -- never from a parameter -- so the browser
-- cannot assert whose activation this is; it can only supply the
-- already-public attempt_token used to correlate this session back to
-- the specific pending activation (the same token the browser has
-- held since the identity-evidence step, not identity authority).
--
-- Consumes at most one pending, unexpired, verification_method =
-- 'magic_link' challenge matching (attempt, channel = 'email',
-- destination_hash = md5(verified email)), then delegates all person
-- linking to the existing, unmodified finalize_member_identity_activation().
-- Fails closed (returns REJECTED, no partial state) if no such
-- challenge exists, has expired, or has already been consumed.
------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_member_identity_activation_via_magic_link(
  p_attempt_token text
)
RETURNS TABLE(
  activation_status text,
  activated_person_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_verified_email text;
  v_destination_hash text;
  v_attempt_id uuid;
  v_challenge_id uuid;
  v_result record;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT u.email INTO v_verified_email
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_verified_email IS NULL OR trim(v_verified_email) = '' THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid;
    RETURN;
  END IF;

  v_destination_hash := md5(lower(trim(v_verified_email)));

  SELECT a.id INTO v_attempt_id
  FROM public.identity_claim_attempts a
  WHERE a.public_attempt_token = p_attempt_token
  LIMIT 1;

  IF v_attempt_id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Fail closed: exactly one pending, unexpired, magic-link challenge
  -- for this attempt and this auth.uid()-derived destination may be
  -- consumed. FOR UPDATE prevents a concurrent second callback (e.g.
  -- the link opened twice) from consuming the same challenge twice.
  SELECT c.id INTO v_challenge_id
  FROM public.identity_claim_verification_challenges c
  WHERE c.attempt_id = v_attempt_id
    AND c.channel = 'email'
    AND c.destination_hash = v_destination_hash
    AND c.verification_method = 'magic_link'
    AND c.status = 'pending'
    AND c.expires_at > now()
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE OF c;

  IF v_challenge_id IS NULL THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      action,
      status,
      details
    ) VALUES (
      v_attempt_id,
      v_uid,
      'magic_link_activation_finalize',
      'rejected',
      jsonb_build_object('reason', 'no_pending_magic_link_challenge')
    );

    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.identity_claim_verification_challenges
  SET status = 'consumed',
      consumed_at = now(),
      updated_at = now()
  WHERE id = v_challenge_id;

  INSERT INTO public.identity_activation_audit (
    attempt_id,
    challenge_id,
    auth_user_id,
    action,
    status,
    details
  ) VALUES (
    v_attempt_id,
    v_challenge_id,
    v_uid,
    'magic_link_activation_finalize',
    'ok',
    jsonb_build_object('channel', 'email')
  );

  -- Delegate all person linking to the existing, unmodified finalize
  -- RPC. It independently re-checks that a 'consumed' challenge exists
  -- for this (attempt, channel, destination_hash) -- the row we just
  -- consumed above satisfies that check.
  SELECT *
    INTO v_result
  FROM public.finalize_member_identity_activation(
    p_attempt_token,
    v_uid,
    'email',
    v_destination_hash,
    NULL,
    NULL,
    'member_activation_magic_link_callback'
  );

  RETURN QUERY SELECT v_result.activation_status, v_result.activated_person_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_member_identity_activation_via_magic_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_member_identity_activation_via_magic_link(text) TO authenticated;
