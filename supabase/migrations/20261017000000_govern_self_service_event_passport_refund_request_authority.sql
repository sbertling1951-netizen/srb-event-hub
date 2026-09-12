-- Passport Super-Admin Refund Authority Foundation -- database only
-- (docs/architecture/EPICENTRAX_PRIVATE_EVENT_PASSPORT_RESERVATION_CONTRACT.md,
-- delivery sequence item 4; refund domain foundation live since
-- 20261016000000).
--
-- Approved v1 policy (fixed for this task): only a platform super-admin may
-- initiate a future Passport refund; only a reserved, pre-launch Passport is
-- eligible; full USD $24.00 only, never partial; the future Stripe/webhook
-- confirmation, refund/audit insertion, Passport transition to 'refunded',
-- UI, and receipt display are explicitly out of scope here.
--
-- This migration adds ONLY the request/authority foundation a later,
-- separately authorized server route will consume. It performs no top-level
-- INSERT/UPDATE/DELETE; it makes no Stripe SDK call; it changes no Passport
-- state, deletes no Event, writes no refund/audit row, and restates no
-- existing function from this family.
--
-- Adds exactly:
--
--   1. public.self_service_event_passport_refund_requests -- one row per
--      admin-initiated refund request, holding only: an immutable opaque
--      request id; a plain, NON-foreign-key Event reference (the SAME
--      evidence-retention shape the attempts/receipt-audit/refund-audit
--      tables already use, so this row is never a dependency of the Event
--      and survives its later ordinary deletion completely untouched); a
--      real FK to the ONE original payment receipt/audit row this request
--      targets (RESTRICT is safe -- that row is permanent); the initiating
--      Platform Administrator's own auth account (FK to auth.users,
--      RESTRICT -- an admin account is durable, never silently orphaned);
--      a caller idempotency key; the minimum pre-provider lifecycle state
--      this slice can ever create ('requested' -- a single legal value by
--      design: a LATER, separately authorized provider-confirmation slice
--      is what will restate this CHECK to add its own terminal states,
--      exactly the established DROP/ADD-CHECK restatement convention
--      already used for self_service_event_passports.state); and plain
--      timestamps. No free-text reason/note column, no customer or Stripe
--      session data of any kind.
--
--      UNIQUE(initiated_by_auth_user_id, idempotency_key) makes a retried
--      call idempotently stable, exactly mirroring
--      self_service_event_passport_payment_attempts' own actor-key pattern.
--      A partial UNIQUE INDEX on receipt_audit_id WHERE state='requested'
--      makes "at most one still-actionable request per original receipt" a
--      real database invariant, not merely application logic -- the SAME
--      one-open pattern already used for the one-open-attempt rule.
--
--      RLS enabled; every grant revoked from PUBLIC/anon/authenticated/
--      service_role -- no policy, no direct table grant to ANY role,
--      including service_role; every access goes through one of the two
--      governed functions below. No immutability trigger: unlike the
--      receipt/audit and refund/audit tables (permanent evidence, written
--      once, never touched again), this table is a working pre-provider
--      lifecycle record a LATER, separately authorized, precisely justified
--      provider-confirmation command will legitimately need to advance --
--      exactly the same reason self_service_event_passport_payment_attempts
--      itself carries no immutability trigger. Nothing in THIS migration
--      can ever update or delete a row here; that governance boundary is
--      enforced entirely by the total absence of any UPDATE/DELETE-capable
--      command, not by a trigger this migration would only have to remove
--      again later.
--
--   2. prepare_self_service_event_passport_refund_request(p_event_id,
--      p_idempotency_key) -- authenticated, Platform-Administrator-only
--      (public.has_platform_admin_authority -- the repository's established
--      global authority predicate, called unmodified, never re-implemented
--      inline). Performs the narrow, Event-specific private-draft carve-out
--      ONLY inside this one command body: proves the supplied Event id is
--      itself a private self-service draft Event (the SAME structural shape
--      -- status/is_active/visible_to_members/tenant flags -- every
--      organizer-owned command in this family already requires),
--      deliberately WITHOUT any ownership/person-link predicate, since the
--      caller here is never the organizer. This predicate is never exposed
--      as a reusable policy, view, or general-purpose reader -- it grants
--      no broader private-tenant or private-Event visibility of any kind,
--      and a super-admin gains nothing from calling it except a safe,
--      minimal outcome for the ONE opaque Event id supplied. Rechecks, all
--      server-side and independent of the caller's claims: the Event is an
--      eligible private draft; its Passport is state='reserved' (never
--      payment_pending/active/expired/refunded/missing); and EXACTLY one
--      payment receipt/audit row exists for it (never a "latest receipt"
--      pick -- amount/currency/provider need no runtime re-check, already
--      guaranteed by that table's own fixed CHECK constraints). Every
--      ineligibility -- foreign Event, ordinary Event, wrong Passport
--      state, zero or ambiguous receipt evidence -- fails closed to the
--      SAME non-enumerating 'Event not found.' this family always uses;
--      this command never discloses which specific check rejected a
--      supplied id, to an authorized Platform Administrator any more than
--      to anyone else. Creates, or idempotently replays, one refund-request
--      row; a still-actionable request already existing for the SAME
--      receipt (created by this call or a genuinely concurrent one) is
--      reported through the caller-safe 'refund_already_requested' outcome,
--      never a duplicate row and never a raw constraint-violation error.
--      Never touches self_service_event_passports, never deletes an Event,
--      never writes a receipt/audit or refund/audit row, and never contacts
--      Stripe. REVOKE ALL then GRANT EXECUTE to authenticated only --
--      exactly the established pattern (every Platform-Administrator-only
--      command in this repository is still granted broadly to authenticated
--      and gated entirely by its own internal authority check, never by the
--      grant itself).
--
--   3. get_self_service_event_passport_refund_request_for_server(
--      p_request_id) -- service_role only. A single-row read of exactly the
--      four columns the future server Stripe refund route needs to act on a
--      specific, already-prepared request: request_id, event_id,
--      receipt_audit_id, state. Never the initiating admin's identity,
--      never a timestamp, never any receipt/session/provider field --
--      those remain that later, separately authorized slice's own concern.
--      REVOKE ALL then GRANT EXECUTE to service_role only -- never PUBLIC,
--      anon, or authenticated.
--
-- Both functions: SECURITY DEFINER, SET search_path TO 'pg_catalog', owner
-- postgres, no EXECUTE grant to PUBLIC ever appears.
--
-- What this migration does NOT do: no Stripe SDK, package, API call,
-- webhook route or event-type addition, receipt reader, receipt UI, email,
-- or admin screen; no browser table write or read policy on any table; no
-- change to self_service_event_passports' state model, its preserved
-- predicate, delete_self_service_organizer_event, or
-- replace_self_service_organizer_event; no change to
-- confirm_self_service_event_passport_payment or any other existing
-- Passport writer/reader; no widening of has_platform_admin_authority or
-- any other global authority predicate; no admin_users/admin_event_access/
-- admin_tenant_access row created; no weakening of private-draft isolation
-- for any Event this command is never called against.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Refund-request table -- a working pre-provider lifecycle record, not
--    permanent evidence (see the file header for why no immutability
--    trigger exists here).
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_event_passport_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A plain, NON-foreign-key opaque reference, deliberately matching every
  -- other Passport evidence table's own established precedent: this row
  -- must survive the Event's own later ordinary deletion (once refunded)
  -- completely untouched, and must never restrict, or be discovered by the
  -- generic dependency scan on, that deletion.
  event_id uuid NOT NULL,
  -- The ONE original payment receipt this request targets -- a real FK.
  -- RESTRICT is safe: that row is permanent and is never deleted by any
  -- governed command.
  receipt_audit_id uuid NOT NULL
    REFERENCES public.self_service_event_passport_payment_receipt_audit(id) ON DELETE RESTRICT,
  -- The initiating Platform Administrator's own auth account. RESTRICT: an
  -- admin account is durable and must never be silently orphaned by this
  -- reference.
  initiated_by_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  -- The minimum pre-provider lifecycle this slice can ever create -- a
  -- single legal value by design. A later, separately authorized
  -- provider-confirmation slice restates this CHECK (DROP/ADD, the same
  -- established convention already used for
  -- self_service_event_passports.state) to add its own terminal states.
  state text NOT NULL DEFAULT 'requested' CHECK (state = 'requested'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_event_passport_refund_requests_actor_key_unique
    UNIQUE (initiated_by_auth_user_id, idempotency_key)
);

ALTER TABLE public.self_service_event_passport_refund_requests OWNER TO postgres;

-- At most one still-actionable request per original receipt -- a real
-- database invariant, not merely application logic, exactly the same
-- one-open pattern already used for the one-open-attempt rule.
CREATE UNIQUE INDEX self_service_event_passport_refund_requests_one_actionable_idx
  ON public.self_service_event_passport_refund_requests (receipt_audit_id)
  WHERE state = 'requested';

ALTER TABLE public.self_service_event_passport_refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_event_passport_refund_requests
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. prepare_self_service_event_passport_refund_request -- authenticated,
--    Platform-Administrator-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_self_service_event_passport_refund_request(
  p_event_id uuid,
  p_idempotency_key uuid
)
-- The first column is the discriminator:
--   'requested'                 -> a new (or, for the SAME caller and
--                                  idempotency key, idempotently replayed)
--                                  refund request now exists
--   'refund_already_requested'  -> a DIFFERENT still-actionable request
--                                  already exists for this exact receipt;
--                                  only that existing request's own minimal
--                                  facts are returned -- never a duplicate
-- Hard input / authority / eligibility problems still RAISE, always with
-- the SAME non-enumerating 'Event not found.' for any ineligible target.
RETURNS TABLE(
  outcome text,
  request_id uuid,
  event_id uuid,
  state text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.self_service_event_passport_refund_requests%ROWTYPE;
  v_verified_event_id uuid;
  v_passport_state text;
  v_receipt_id uuid;
  v_new public.self_service_event_passport_refund_requests%ROWTYPE;
  v_race public.self_service_event_passport_refund_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Requesting a Passport refund requires an authenticated Platform Administrator account.';
  END IF;

  IF NOT public.has_platform_admin_authority(v_actor) THEN
    RAISE EXCEPTION 'Requesting a Passport refund requires Platform Administrator authority.';
  END IF;

  IF p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An event and an idempotency key are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_event_passport_refund_request:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.self_service_event_passport_refund_requests AS r
  WHERE r.initiated_by_auth_user_id = v_actor
    AND r.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.event_id <> p_event_id THEN
      RAISE EXCEPTION 'Idempotency key was already used to request a refund for a different event.';
    END IF;
    RETURN QUERY SELECT
      'requested'::text, v_existing.id, v_existing.event_id, v_existing.state, v_existing.created_at;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_passport_refund_request_target:' || p_event_id::text, 0)
  );

  -- The narrow, Event-specific private-draft carve-out this command exists
  -- for -- see the file header. Deliberately no ownership/person-link
  -- predicate: the caller is a Platform Administrator, never the
  -- organizer.
  SELECT e.id
    INTO v_verified_event_id
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.id = p_event_id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;

  IF v_verified_event_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Only a reserved, pre-launch Passport is eligible -- payment_pending,
  -- active, expired, refunded, and "no Passport row at all" all fail
  -- closed to the SAME outcome.
  SELECT p.state
    INTO v_passport_state
  FROM public.self_service_event_passports AS p
  WHERE p.event_id = p_event_id
  FOR UPDATE;

  IF v_passport_state IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Exactly one original payment receipt -- never a "latest receipt for
  -- this Event" pick. amount_minor_units=2400/currency='usd'/provider=
  -- 'stripe' need no runtime re-check: the receipt/audit table's own CHECK
  -- constraints already guarantee every row satisfies them structurally.
  BEGIN
    SELECT r.id INTO STRICT v_receipt_id
    FROM public.self_service_event_passport_payment_receipt_audit AS r
    WHERE r.event_id = p_event_id;
  EXCEPTION
    WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
      RAISE EXCEPTION 'Event not found.';
  END;

  -- At most one still-actionable request per original receipt -- checked
  -- here for a caller-safe outcome, and independently enforced structurally
  -- by the table's own partial unique index (see the EXCEPTION block below
  -- for the genuinely concurrent case).
  SELECT * INTO v_existing
  FROM public.self_service_event_passport_refund_requests AS r
  WHERE r.receipt_audit_id = v_receipt_id
    AND r.state = 'requested';

  IF FOUND THEN
    RETURN QUERY SELECT
      'refund_already_requested'::text, v_existing.id, v_existing.event_id, v_existing.state, v_existing.created_at;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.self_service_event_passport_refund_requests (
      event_id, receipt_audit_id, initiated_by_auth_user_id, idempotency_key
    ) VALUES (
      v_verified_event_id, v_receipt_id, v_actor, p_idempotency_key
    ) RETURNING * INTO v_new;
  EXCEPTION WHEN unique_violation THEN
    -- A genuinely concurrent caller won the race for the same receipt
    -- between this command's own pre-check and this INSERT -- re-read the
    -- now-current row and return the SAME safe outcome the pre-check would
    -- have returned, rather than surface a raw constraint violation.
    SELECT * INTO v_race
    FROM public.self_service_event_passport_refund_requests AS r
    WHERE r.receipt_audit_id = v_receipt_id
      AND r.state = 'requested';
    RETURN QUERY SELECT
      'refund_already_requested'::text, v_race.id, v_race.event_id, v_race.state, v_race.created_at;
    RETURN;
  END;

  RETURN QUERY SELECT
    'requested'::text, v_new.id, v_new.event_id, v_new.state, v_new.created_at;
END;
$function$;

ALTER FUNCTION public.prepare_self_service_event_passport_refund_request(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prepare_self_service_event_passport_refund_request(uuid, uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.prepare_self_service_event_passport_refund_request(uuid, uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_self_service_event_passport_refund_request_for_server --
--    service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_self_service_event_passport_refund_request_for_server(
  p_request_id uuid
)
RETURNS TABLE(
  request_id uuid,
  event_id uuid,
  receipt_audit_id uuid,
  state text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT r.id, r.event_id, r.receipt_audit_id, r.state
  FROM public.self_service_event_passport_refund_requests AS r
  WHERE r.id = p_request_id;
$function$;

ALTER FUNCTION public.get_self_service_event_passport_refund_request_for_server(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_self_service_event_passport_refund_request_for_server(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_self_service_event_passport_refund_request_for_server(uuid)
  TO service_role;

COMMIT;
