-- Stripe Passport Checkout Integration -- narrowly scoped READ access for the
-- server Checkout/webhook routes
-- (docs/architecture/EPICENTRAX_STRIPE_PASSPORT_CHECKOUT_IMPLEMENTATION_SPECIFICATION.md).
--
-- This migration adds exactly two SECURITY DEFINER readers over the existing
-- self_service_event_passport_payment_attempts table (live since
-- 20261013000000). It creates no table, no table policy, no table grant, no
-- seed row, and performs no mutation of attempt/Passport/receipt state. It
-- does not restate prepare_self_service_event_passport_checkout_attempt,
-- bind_self_service_event_passport_checkout_session,
-- record_self_service_event_passport_checkout_terminal_state,
-- confirm_self_service_event_passport_payment,
-- delete_self_service_organizer_event, or replace_self_service_organizer_event
-- -- every existing writer, Delete/Replace behavior, RLS, and grant from
-- 20261012000000/20261013000000 is completely unchanged.
--
-- Adds exactly:
--
--   * get_my_self_service_event_passport_checkout_attempt(p_event_id uuid) --
--     authenticated, owner-scoped. Resolves the caller through the SAME
--     canonical-Person / no-link identity rules as
--     prepare_self_service_event_passport_checkout_attempt
--     (resolve_auth_person_link; resolved -> person_id match, no_link ->
--     auth_user_id match; any other link status fails closed with the
--     non-enumerating 'Event not found.'), then proves ownership of the
--     caller's own private Draft Event through the SAME
--     appointment/draft/tenant join shape used throughout this family.
--     Deliberately NOT the passport-preserved-excluding eligibility
--     predicate prepare/delete use: a private Draft Event stays
--     status='Draft'/is_active=false/visible_to_members=false even after its
--     Passport reserves (the contract: "the Event remains private, Draft,
--     inactive, and pre-launch"), so the SAME organizer must still be able
--     to read this reader safely after confirmation -- the caller-safe
--     'no_open_attempt' outcome, never a raised exception, is what a reserved
--     Event correctly returns here. Returns only the minimal view the
--     specification allows: outcome, attempt_id, event_id, state, provider,
--     created_at -- never provider_session_id, receipt data, tenant/
--     appointment identifiers, Passport timestamps, or any other Person's
--     data. REVOKE ALL then GRANT EXECUTE to authenticated only.
--
--   * get_self_service_event_passport_checkout_attempt_for_server(p_attempt_id uuid)
--     -- service_role only. A single-row read of exactly the columns the
--     server Checkout/webhook routes need to act on a specific attempt id:
--     attempt_id, event_id, state, provider, provider_session_id. It adds no
--     new validation of its own beyond the plain read -- the table's own
--     self_service_event_passport_payment_attempts_session_agrees_with_state
--     CHECK constraint (live since 20261013000000) already guarantees
--     provider_session_id is set whenever state is 'open' or 'confirmed', so
--     this reader's result already carries that guarantee structurally.
--     REVOKE ALL then GRANT EXECUTE to service_role only -- never PUBLIC,
--     anon, or authenticated.
--
-- Both functions: SECURITY DEFINER, SET search_path TO 'pg_catalog', owner
-- postgres, no EXECUTE grant to PUBLIC ever appears.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. get_my_self_service_event_passport_checkout_attempt -- authenticated,
--    owner-scoped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_self_service_event_passport_checkout_attempt(
  p_event_id uuid
)
-- The first column is the discriminator:
--   'open_attempt'     -> a preparing/open attempt exists for the caller's
--                         own eligible Event; attempt_id/event_id/state/
--                         provider/created_at are all set
--   'no_open_attempt'  -> the caller owns an eligible Event, but no
--                         preparing/open attempt currently exists for it
--                         (never a leak of a terminal/confirmed attempt's
--                         own facts -- only whether one is OPEN right now)
-- A foreign, non-owned, or ineligible Event id -- or an uncertain identity
-- link -- RAISEs the SAME non-enumerating 'Event not found.' every other
-- command in this family already uses.
RETURNS TABLE(
  outcome text,
  attempt_id uuid,
  event_id uuid,
  state text,
  provider text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_appointment_id uuid;
  v_attempt public.self_service_event_passport_payment_attempts%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Reading a Passport checkout attempt requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Reading a Passport checkout attempt requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'An event is required.';
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT oa.id
    INTO v_appointment_id
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  WHERE d.event_id = p_event_id
    AND oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_actor)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.event_id = p_event_id
    AND a.state IN ('preparing', 'open');

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'no_open_attempt'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'open_attempt'::text, v_attempt.id, v_attempt.event_id, v_attempt.state,
    v_attempt.provider, v_attempt.created_at;
END;
$function$;

ALTER FUNCTION public.get_my_self_service_event_passport_checkout_attempt(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_self_service_event_passport_checkout_attempt(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_self_service_event_passport_checkout_attempt(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_self_service_event_passport_checkout_attempt_for_server --
--    service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_self_service_event_passport_checkout_attempt_for_server(
  p_attempt_id uuid
)
RETURNS TABLE(
  attempt_id uuid,
  event_id uuid,
  state text,
  provider text,
  provider_session_id text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT a.id, a.event_id, a.state, a.provider, a.provider_session_id
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.id = p_attempt_id;
$function$;

ALTER FUNCTION public.get_self_service_event_passport_checkout_attempt_for_server(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_self_service_event_passport_checkout_attempt_for_server(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_self_service_event_passport_checkout_attempt_for_server(uuid)
  TO service_role;

COMMIT;
