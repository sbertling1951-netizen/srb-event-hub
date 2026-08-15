-- ============================================================================
-- Fix: begin_member_identity_claim_magic_link() -- 42883 function
-- gen_random_bytes(integer) does not exist
--
-- PROVEN ROOT CAUSE
-- -----------------
-- Discovered via live catalog inspection during Legacy Login Transfer
-- Stage 1 (2026-08-15). begin_member_identity_claim_magic_link()
-- (20260730120000_add_magic_link_activation_support.sql) is SECURITY
-- DEFINER with `SET search_path TO 'public'` and calls
-- gen_random_bytes(16) to generate a never-transmitted placeholder value
-- for the pre-existing code_hash NOT NULL constraint (magic-link
-- activation never asks the member to enter a code).
--
-- On this project's linked database, the pgcrypto extension -- and
-- therefore gen_random_bytes() -- is installed in the `extensions`
-- schema, not `public`:
--
--   SELECT e.extname, n.nspname FROM pg_extension e
--   JOIN pg_namespace n ON n.oid = e.extnamespace
--   WHERE e.extname = 'pgcrypto';
--   -- extensions
--
-- A fixed, narrow `search_path = 'public'` therefore cannot resolve
-- gen_random_bytes() at all, regardless of caller or session state. A
-- direct live invocation reproduced the exact failure:
--
--   ERROR: 42883: function gen_random_bytes(integer) does not exist
--
-- This makes the entire member magic-link identity-activation flow
-- fail at the database boundary every time it runs -- not an
-- intermittent or environment-specific condition.
--
-- No other pgcrypto-dependent call exists in this function (encode() is
-- a core pg_catalog builtin, not pgcrypto) or in the functions it calls
-- (begin_member_identity_claim_verification,
-- finalize_member_identity_activation_via_magic_link,
-- finalize_member_identity_activation -- none call gen_random_bytes(),
-- digest(), crypt(), or hmac()), so this is the single, complete root
-- cause and the only function requiring repair.
--
-- REPAIR
-- ------
-- CREATE OR REPLACE FUNCTION with the existing body, signature, return
-- type, SECURITY DEFINER status, authorization semantics, token/code
-- placeholder-generation semantics, identity-resolution delegation, row
-- mutations, error behavior, and grants/revokes all preserved exactly.
-- The only change is search_path: 'public' -> 'public', 'extensions' --
-- the identical, already-live-proven pattern this project adopted for
-- public.redeem_legacy_login_transfer() in Stage 1
-- (20260815000000_create_legacy_login_transfers.sql), for the identical
-- reason (pgcrypto lives in extensions on this project). No broader
-- search_path is added: 'extensions' is pgcrypto's actual, single
-- installed schema here, ordinary anon/authenticated roles cannot
-- create objects in it (see the live grant/ownership proof reported
-- alongside this migration), and putting it after 'public' (not before)
-- means an identically-named object in 'public' would still resolve
-- first, matching the ordering already established as this project's
-- accepted pgcrypto pattern.
-- ============================================================================

BEGIN;

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
SET search_path TO 'public', 'extensions'
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
  -- checks code_hash). gen_random_bytes() resolves from the
  -- 'extensions' schema on this project -- see the header note above.
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

COMMIT;
