-- Legacy Login Transfer -- Stage 1: governed database primitives.
--
-- Approved by the Legacy Login Transfer architecture, implementation
-- specification, and security reconciliation passes (2026-08-15,
-- read-only). This migration creates only the durable database
-- foundation for silently transferring an already-validated
-- app.eventsyncapp.com Supabase session (Admin, Member account, or
-- Vendor) into an epicentrax.com session. No application route, UI,
-- feature flag, PWA behavior, domain configuration, or Legacy Event
-- Access work is part of this stage -- those are separately scoped,
-- separately governed later stages.
--
-- Token storage model (reconciled 2026-08-15):
--   - transfer_token_hash stores sha256(raw opaque transfer token), hex-
--     encoded via pgcrypto's digest(). The raw token itself is never
--     stored, never generated in Postgres, and never accepted as a
--     creation-function parameter -- the application layer generates it
--     and hashes it before calling create_legacy_login_transfer(), so
--     Stage 1 introduces no reason for raw transfer credential material
--     to enter this database at creation time. redeem_legacy_login_transfer()
--     is the one place a raw token is ever received, because verifying a
--     bearer credential against its stored digest is that function's
--     entire purpose.
--   - supabase_hashed_token stores the verbatim `hashed_token` returned by
--     a later stage's auth.admin.generateLink() call. This is already a
--     one-way-derived value on Supabase's own side (hence its name) and
--     Supabase's own verifyOtp() redemption requires the exact value
--     back -- hashing it a second time here would make it unusable. It is
--     protected solely by this table's RLS/grant boundary below, the same
--     protection level our own token's plaintext would have had, and it
--     is never exposed to any client in this design.
--
-- Trust boundary: auth_user_id, person_id, and role_class on
-- create_legacy_login_transfer() are trusted, server-derived inputs from
-- a caller that has already independently validated the legacy session
-- through existing, unmodified per-role mechanisms (Supabase session
-- check for Admin/Member, resolveVendorAccessFromCookies-equivalent for
-- Vendor). They are not, and cannot be, browser/user inputs: the
-- function's EXECUTE grant excludes anon and authenticated entirely, so
-- no client request can reach this function at all, let alone supply
-- these parameters. See the function comment below for the durable
-- record of this boundary.
--
-- Lifetime: expires_at defaults to exactly now() + interval '90 seconds'
-- at the schema level, so the 90-second transfer-lifetime policy is a
-- durable invariant, not something every caller must remember to set.
--
-- No legacy_login_transfer_audit table is created in this stage. The
-- primary table's own created_at/status/consumed_at columns already
-- durably record the full lifecycle of every transfer that is actually
-- created; durable recording of rejected/never-created attempts is
-- diagnostic, not governance-of-record, and is covered by ordinary
-- application-level operational logs in the later stage that wires the
-- routes -- not a speculative database object here.
--
-- Indexes are limited to what Stage 1's own access patterns justify:
-- the unique transfer_token_hash index is what redemption's lookup
-- uses; status and auth_user_id support support/audit lookups. No
-- cleanup job exists in this stage (correctness never depends on one --
-- redemption's own expires_at > now() predicate is what keeps an expired
-- row inert), so no index is added speculatively for a cleanup query
-- pattern that does not yet exist.

BEGIN;

CREATE TABLE public.legacy_login_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  transfer_token_hash text NOT NULL,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  role_class text NOT NULL CHECK (role_class IN ('admin', 'member', 'vendor')),

  supabase_hashed_token text NOT NULL,

  destination_path text NOT NULL DEFAULT '/'
    CHECK (destination_path LIKE '/%'),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'expired')),

  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 seconds'),
  consumed_at timestamptz,

  request_ip_hash text,
  user_agent_hash text,

  CONSTRAINT legacy_login_transfers_consumed_consistency CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status <> 'consumed' AND consumed_at IS NULL)
  ),
  CONSTRAINT legacy_login_transfers_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX legacy_login_transfers_token_hash_unique_idx
  ON public.legacy_login_transfers (transfer_token_hash);

CREATE INDEX legacy_login_transfers_status_idx
  ON public.legacy_login_transfers (status);

CREATE INDEX legacy_login_transfers_auth_user_id_idx
  ON public.legacy_login_transfers (auth_user_id);

COMMENT ON TABLE public.legacy_login_transfers IS
  'Single-use, 90-second server-generated credential for silently transferring an already-validated app.eventsyncapp.com Supabase session (Admin/Member/Vendor) into an epicentrax.com session. Never readable/writable by anon or authenticated roles; service_role only, via create_legacy_login_transfer()/redeem_legacy_login_transfer().';
COMMENT ON COLUMN public.legacy_login_transfers.transfer_token_hash IS
  'sha256 hex digest of the raw opaque token given to the browser in a later stage. The raw token is never stored and is never generated in Postgres.';
COMMENT ON COLUMN public.legacy_login_transfers.supabase_hashed_token IS
  'Verbatim hashed_token from a later stage''s auth.admin.generateLink() call, required by verifyOtp() at redemption. Already one-way-derived on Supabase''s own side; never exposed to any client by this design.';
COMMENT ON COLUMN public.legacy_login_transfers.auth_user_id IS
  'Trusted, server-derived at creation from the caller''s already-validated legacy session. Never a browser-supplied value.';
COMMENT ON COLUMN public.legacy_login_transfers.person_id IS
  'Opportunistic Person link, resolved server-side via the existing Person Resolution chain at creation time. NULL is expected and valid -- an Admin or Vendor session with no resolvable Person must still transfer.';
COMMENT ON COLUMN public.legacy_login_transfers.role_class IS
  'Which of the three transferable session classes created this transfer. Trusted and server-derived: a caller-supplied route is dedicated to exactly one role_class value, never taken from request input.';

ALTER TABLE public.legacy_login_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all_anonymous_legacy_login_transfers
  ON public.legacy_login_transfers
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY deny_all_authenticated_legacy_login_transfers
  ON public.legacy_login_transfers
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.legacy_login_transfers FROM PUBLIC;
REVOKE ALL ON TABLE public.legacy_login_transfers FROM anon;
REVOKE ALL ON TABLE public.legacy_login_transfers FROM authenticated;
-- No explicit service_role grant is added: service_role inherently
-- bypasses RLS in this database and already holds default schema
-- privileges, exactly as public.identity_claim_attempts already relies
-- on (20260727120100_stage8a_create_identity_claim_foundation.sql).

-- ============================================================
-- create_legacy_login_transfer()
--
-- service_role only. Inserts exactly one pending transfer row and
-- returns only what a later stage's creation route needs to redirect
-- the browser: the row id and its expiry. It never returns the token
-- hash it was given (the caller already has the raw token that hash
-- came from) and never returns anything else from the row.
--
-- Trust boundary, stated durably here (see also the migration header
-- above): p_auth_user_id, p_person_id, and p_role_class are trusted,
-- server-derived inputs supplied by a route that has already
-- independently validated the legacy session -- never accepted from or
-- influenceable by a browser request. No anon or authenticated grant
-- exists; this function cannot be reached by client code at all. A
-- stronger, precedented alternative (deriving auth_user_id from auth.uid()
-- via a token-bound caller, as resolve_current_auth_person_link() and
-- finalize_member_identity_activation_via_magic_link() already do) was
-- considered and deliberately deferred to the stage that actually wires
-- the creation route, since Stage 1 wires no route and deciding that
-- calling convention now would be premature scope.
--
-- p_transfer_token_hash is received pre-hashed from the application
-- layer -- this function never generates or hashes the raw transfer
-- token itself, so Stage 1 introduces no reason for raw transfer
-- credential material to enter Postgres at creation time.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_legacy_login_transfer(
  p_auth_user_id uuid,
  p_person_id uuid,
  p_role_class text,
  p_supabase_hashed_token text,
  p_transfer_token_hash text,
  p_destination_path text DEFAULT '/',
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL
)
RETURNS TABLE(id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  INSERT INTO public.legacy_login_transfers (
    auth_user_id,
    person_id,
    role_class,
    supabase_hashed_token,
    transfer_token_hash,
    destination_path,
    request_ip_hash,
    user_agent_hash
  ) VALUES (
    p_auth_user_id,
    p_person_id,
    p_role_class,
    p_supabase_hashed_token,
    p_transfer_token_hash,
    p_destination_path,
    p_request_ip_hash,
    p_user_agent_hash
  )
  RETURNING legacy_login_transfers.id, legacy_login_transfers.expires_at
    INTO v_row;

  RETURN QUERY SELECT v_row.id, v_row.expires_at;
END;
$$;

COMMENT ON FUNCTION public.create_legacy_login_transfer IS
  'service_role only. p_auth_user_id/p_person_id/p_role_class are trusted, server-derived inputs from a caller that has already independently validated the legacy session -- never accepted from or influenceable by a browser request. No anon or authenticated grant exists; this function cannot be reached by client code at all. p_transfer_token_hash must already be sha256-hashed by the application layer -- this function never sees or generates a raw transfer token.';

REVOKE ALL ON FUNCTION public.create_legacy_login_transfer(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_legacy_login_transfer(uuid, uuid, text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_legacy_login_transfer(uuid, uuid, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_legacy_login_transfer(uuid, uuid, text, text, text, text, text, text) TO service_role;

-- ============================================================
-- redeem_legacy_login_transfer()
--
-- service_role only. Receives the raw presented token (this is the one
-- place in this feature a raw transfer token is ever handled by
-- Postgres, because verifying a bearer credential against its stored
-- digest is this function's entire purpose), hashes it with the same
-- sha256/digest() scheme used at creation, and atomically transitions
-- at most one matching pending, unexpired row to consumed via a single
-- UPDATE ... RETURNING -- Postgres's own row-level locking on that one
-- statement is what guarantees exactly one concurrent caller can win;
-- no additional locking is needed for this single-column-transition
-- shape. Its search_path includes 'extensions' (in addition to 'public')
-- because this project's pgcrypto extension -- and therefore digest() --
-- is installed in the extensions schema, not public; create_legacy_login_transfer
-- never calls a pgcrypto function and deliberately keeps the narrower
-- 'public'-only search_path. Unknown, malformed, expired, and already-consumed tokens all
-- produce the identical generic 'rejected' outcome -- the condition is
-- never disclosed. Expired-but-still-pending rows are not opportunistically
-- flipped to status='expired' here; they simply fail the
-- expires_at > now() predicate and are already inert. A future cleanup
-- pass, not correctness, is what would eventually mark them.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_legacy_login_transfer(
  p_presented_token text
)
RETURNS TABLE(
  outcome text,
  auth_user_id uuid,
  person_id uuid,
  role_class text,
  supabase_hashed_token text,
  destination_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_hash text;
  v_row record;
BEGIN
  IF p_presented_token IS NULL OR length(p_presented_token) = 0 THEN
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_hash := encode(digest(p_presented_token, 'sha256'), 'hex');

  UPDATE public.legacy_login_transfers
  SET status = 'consumed',
      consumed_at = now()
  WHERE transfer_token_hash = v_hash
    AND status = 'pending'
    AND expires_at > now()
  RETURNING
    legacy_login_transfers.auth_user_id,
    legacy_login_transfers.person_id,
    legacy_login_transfers.role_class,
    legacy_login_transfers.supabase_hashed_token,
    legacy_login_transfers.destination_path
    INTO v_row;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'ok'::text,
    v_row.auth_user_id,
    v_row.person_id,
    v_row.role_class,
    v_row.supabase_hashed_token,
    v_row.destination_path;
END;
$$;

COMMENT ON FUNCTION public.redeem_legacy_login_transfer IS
  'service_role only. Never called directly by a browser. Hashes the presented raw token and atomically consumes at most one matching pending, unexpired row. Unknown/malformed/expired/already-consumed tokens all return the identical generic rejected outcome -- the condition is never disclosed.';

REVOKE ALL ON FUNCTION public.redeem_legacy_login_transfer(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_legacy_login_transfer(text) FROM anon;
REVOKE ALL ON FUNCTION public.redeem_legacy_login_transfer(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_legacy_login_transfer(text) TO service_role;

COMMIT;
