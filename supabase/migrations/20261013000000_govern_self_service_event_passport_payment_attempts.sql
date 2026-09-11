-- Stripe Passport Checkout Integration -- database-authority foundation only
-- (docs/architecture/EPICENTRAX_STRIPE_PASSPORT_CHECKOUT_IMPLEMENTATION_SPECIFICATION.md).
--
-- This migration is the FIRST implementation slice after the live
-- provider-independent Passport entitlement foundation (20261012000000). It
-- adds durable payment-attempt and receipt/audit evidence, four narrowly
-- scoped governed commands, and one Delete safety extension. It contacts no
-- payment provider: no Stripe SDK, API call, secret, webhook route, or
-- Next.js code exists anywhere in this file. It performs no Stripe
-- checkout-session creation and no money movement -- it only prepares the
-- server-side authority those LATER routes will call.
--
-- Adds exactly:
--
--   * public.self_service_event_passport_payment_attempts -- one row per
--     Passport checkout attempt for an Event. Deliberately separate from
--     self_service_event_passports: the Passport table remains the sole
--     COMMERCIAL entitlement truth (payment_pending/reserved/active/expired);
--     this table is ATTEMPT lifecycle evidence
--     (preparing/open/expired/cancelled/confirmed), owned and written only by
--     the governed commands below. It holds only what the specification's
--     durable-facts table requires for an attempt: the internal attempt id,
--     a plain Event reference, the provider (fixed to 'stripe'), an opaque
--     provider Checkout Session id, its lifecycle state, and durable
--     timestamps. The Event reference is a PLAIN uuid, deliberately NOT a
--     foreign key to public.events: the specification requires terminal
--     (expired/cancelled) attempt evidence to durably survive the Event's
--     own later ordinary deletion, so this column must never restrict, and
--     is never touched by, that deletion -- it is audit evidence only, never
--     a discovery or authorization key. RLS enabled, every grant revoked
--     from PUBLIC/anon/authenticated/service_role -- no browser policy, no
--     direct browser table grant, and no direct grant even to service_role
--     (every access goes through a SECURITY DEFINER command). A partial
--     unique index on event_id, scoped to state IN ('preparing','open'),
--     makes the one-open-attempt rule a real database invariant, not merely
--     application logic; UNIQUE (actor_auth_user_id, idempotency_key) makes
--     a retried preparation stable.
--
--   * public.self_service_event_passport_payment_receipt_audit -- one
--     immutable row per confirmed Stripe payment event. Holds only the
--     specification's receipt facts: the provider event id (UNIQUE -- this
--     is the durable webhook-idempotency mechanism), the provider Checkout
--     Session id, plain Event and attempt references, the fixed USD $24.00
--     amount/currency snapshot, and the confirmation timestamp. Append-only:
--     a BEFORE UPDATE OR DELETE trigger unconditionally rejects mutation,
--     exactly mirroring the established self_service_event_deletion_audit
--     immutability pattern. RLS enabled, every grant revoked from every
--     role, no policy, and -- deliberately -- no read RPC anywhere in this
--     migration: it is confirmation evidence, not an Event/payment discovery
--     surface for any caller, including the organizer whose Event it
--     concerns.
--
--   * Four governed commands, each granted to exactly the one role that may
--     ever call it:
--
--     1. prepare_self_service_event_passport_checkout_attempt(p_event_id,
--        p_idempotency_key) -- authenticated, owner-scoped. Reuses the SAME
--        canonical-Person / private-Draft-owner / Passport-preserved
--        eligibility predicate already governing
--        create_self_service_organizer_draft and
--        delete_self_service_organizer_event (identical WHERE-clause shape),
--        so an Event with a reserved/active/expired Passport, or one the
--        caller does not own, is never reachable. A retried call with the
--        same (actor, idempotency key) replays its own prior result -- never
--        a second row. A genuinely new call is rejected with a caller-safe
--        'attempt_already_open' outcome (never a raw constraint error) if
--        the Event already has a preparing or open attempt from ANY caller
--        (an Event has exactly one owner appointment, so this can only ever
--        be the same caller's own earlier attempt). On success it
--        creates-or-confirms the Event's payment_pending Passport row
--        (idempotent via ON CONFLICT on the Passport table's own primary
--        key) and inserts one new 'preparing' attempt row. It never accepts
--        a Person, tenant, amount, currency, or Passport-state argument --
--        there is no parameter for any of them.
--
--     2. bind_self_service_event_passport_checkout_session(p_attempt_id,
--        p_provider_session_id) -- service_role only. Attaches the Stripe
--        Checkout Session id a LATER Next.js route creates to the ALREADY
--        owner-authorized prepared attempt, transitioning preparing -> open.
--        It authorizes nothing on its own -- it exists only because
--        Postgres and Stripe cannot share one atomic transaction, so the
--        session id the Checkout route receives from Stripe must be written
--        back through a governed command, never a browser update.
--
--     3. record_self_service_event_passport_checkout_terminal_state(
--        p_attempt_id, p_provider_session_id, p_terminal_state) --
--        service_role only. Records that a LATER server-side cancellation
--        boundary asked Stripe to expire an open session (or that Stripe
--        itself reported the session expired) and Stripe confirmed the
--        session can no longer be paid. Only after this command durably
--        records 'expired' or 'cancelled' does the Event's preparing/open
--        block on ordinary Delete/Replace (see below) lift.
--
--     4. confirm_self_service_event_passport_payment(p_attempt_id,
--        p_provider_session_id, p_provider_event_id) -- service_role only,
--        the sole path that may ever transition a Passport out of
--        payment_pending. Provider-event idempotency is checked FIRST,
--        against the receipt table's own UNIQUE constraint -- a duplicate
--        Stripe webhook delivery is a harmless no-op before any lock is even
--        taken. Otherwise it locks the Passport row, THEN the attempt row
--        (the SAME lock order delete_self_service_organizer_event now uses,
--        so the two commands can never deadlock against each other), and
--        confirms the caller's attempt id + Checkout Session id match the
--        specific open attempt -- there is no "latest pending Event"
--        fallback lookup anywhere in this command. It writes the immutable
--        receipt row FIRST, then transitions exactly that one Passport to
--        reserved, then marks exactly that one attempt confirmed. It never
--        accepts an amount or currency argument -- the receipt's
--        amount_minor_units/currency columns are fixed by column DEFAULT and
--        CHECK to 2400 / 'usd'; nothing this command receives from its
--        caller can override them.
--
--   * delete_self_service_organizer_event restated with exactly one added
--     block, immediately after the existing reserved/active/expired Passport
--     recheck (Lun's correction, live since 20261012000000) and BEFORE the
--     existing payment_pending cleanup: it locks (FOR UPDATE) any
--     preparing/open attempt row for the Event. If one exists, it raises the
--     fixed, short, code-style 'checkout_cancellation_required' message --
--     the same established machine-readable-exception pattern this
--     repository already uses for save_my_self_service_private_draft_details'
--     'stale_draft_details' -- never a deletion. This MUST be an exception
--     rather than a structured return row: unlike delete's OTHER outcomes,
--     replace_self_service_organizer_event -- deliberately NOT restated by
--     this migration -- captures delete's result without branching on its
--     outcome column, so only a propagating exception safely aborts
--     replace's delegated call with zero mutation.
--
--     Once past that check, this function does NOT touch the attempt table
--     at all: self_service_event_passport_payment_attempts.event_id is a
--     plain, non-foreign-key reference (see its table definition above), so
--     a terminal (expired/cancelled) attempt row is never a dependency of
--     the Event being deleted and is never discovered by the generic
--     dependency scan below (that scan enumerates only real foreign keys
--     referencing public.events, and this column is deliberately not one).
--     Terminal attempt evidence for a since-deleted Event is retained,
--     completely unmodified, exactly as the approved specification requires
--     -- it durably outlives the Event it was for.
--
--     A plain payment_pending Passport with NO attempt row is untouched by
--     this addition and keeps its existing, unmodified ordinary-deletion
--     behavior. Every other line is verbatim from 20261012000000 (its most
--     recent prior restatement).
--
-- replace_self_service_organizer_event is NOT restated and NOT modified. It
-- delegates its entire deletion phase to delete_self_service_organizer_event
-- as an ordinary function call (see 20261011000000) -- this one Delete change
-- protects both the standalone Delete command AND atomic Replace, with zero
-- additional code, exactly as Lun's correction already did for
-- payment_pending cleanup.
--
-- What this migration does NOT do: no Stripe SDK, package, API call,
-- webhook route, Checkout Session creation, secret, environment variable, or
-- Next.js route of any kind; no browser table write or read policy on any
-- new table; no amount, currency, Person, tenant, or Passport-state argument
-- accepted from a browser caller anywhere; no launch, refund, renewal,
-- invitation, or guest-access behavior; no change to
-- self_service_event_passports' own schema, CHECK constraints, or existing
-- grants; no touch to FCOC, ordinary tenants, Platform/Tenant/Event
-- administration, or P0 media boundaries.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Passport checkout-attempt lifecycle evidence -- separate from the
--    Passport entitlement record itself.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_event_passport_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A plain, NON-foreign-key opaque reference by design: the specification
  -- requires durable retention of terminal (expired/cancelled) attempt
  -- evidence even after its Event is later ordinarily deleted, so this
  -- column must never restrict that deletion or be silently cascaded away
  -- by one. It is audit evidence only -- never a discovery or authorization
  -- key -- and every governed command that writes it already independently
  -- verifies real, owned Event eligibility before ever inserting a row; the
  -- column itself carries no referential-integrity guarantee.
  event_id uuid NOT NULL,
  -- The canonical organizer Person who started this attempt. People are
  -- durable; this FK is RESTRICT so the fact keeps a real subject.
  organizer_person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  -- The authenticated account that started this attempt.
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  -- Fixed to 'stripe' for the first release; a real column (not a hardcoded
  -- literal elsewhere) so a later provider change is a migration, not a
  -- silent reinterpretation of existing rows.
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  -- Opaque Stripe Checkout Session id. NULL until bind_* attaches it
  -- (preparing -> open); never the source of authorization truth.
  provider_session_id text,
  state text NOT NULL DEFAULT 'preparing' CHECK (
    state IN ('preparing', 'open', 'expired', 'cancelled', 'confirmed')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_event_passport_payment_attempts_actor_key_unique
    UNIQUE (actor_auth_user_id, idempotency_key),
  -- open/confirmed can only ever be reached by first binding a session, so
  -- both strictly require one. preparing strictly has none yet. expired/
  -- cancelled are reachable from EITHER preparing (Stripe session creation
  -- itself failed -- no session ever existed) or open (a real session was
  -- opened, then expired or was cancelled) -- so a terminal row's session id
  -- may be NULL or set, matching whichever path reached it.
  CONSTRAINT self_service_event_passport_payment_attempts_session_agrees_with_state CHECK (
    (state = 'preparing' AND provider_session_id IS NULL)
    OR (state IN ('open', 'confirmed') AND provider_session_id IS NOT NULL)
    OR (state IN ('expired', 'cancelled'))
  )
);

ALTER TABLE public.self_service_event_passport_payment_attempts OWNER TO postgres;

-- The one-open-attempt rule as a real database invariant: at most one
-- preparing/open row per Event can ever exist, even under concurrent
-- transactions -- not merely something the governed commands promise to
-- check.
CREATE UNIQUE INDEX self_service_event_passport_payment_attempts_one_open_idx
  ON public.self_service_event_passport_payment_attempts (event_id)
  WHERE state IN ('preparing', 'open');

CREATE INDEX self_service_event_passport_payment_attempts_event_idx
  ON public.self_service_event_passport_payment_attempts (event_id);

ALTER TABLE public.self_service_event_passport_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_event_passport_payment_attempts
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Immutable Passport payment receipt/audit -- confirmation evidence only,
--    never an Event/payment discovery surface.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_event_passport_payment_receipt_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  -- Stripe's own webhook event id. UNIQUE is the durable idempotency
  -- mechanism: a replayed webhook delivery finds this row and stops here,
  -- before any lock or write.
  provider_event_id text NOT NULL,
  provider_session_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES public.self_service_event_passport_payment_attempts(id) ON DELETE RESTRICT,
  -- Fixed by DEFAULT and CHECK, never a caller-supplied argument anywhere in
  -- this migration -- USD $24.00 in minor units.
  amount_minor_units integer NOT NULL DEFAULT 2400 CHECK (amount_minor_units = 2400),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_event_passport_payment_receipt_audit_provider_event_unique
    UNIQUE (provider_event_id)
);

ALTER TABLE public.self_service_event_passport_payment_receipt_audit OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.prevent_self_service_event_passport_payment_receipt_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'self_service_event_passport_payment_receipt_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_self_service_event_passport_payment_receipt_audit_mutation()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_self_service_event_passport_payment_receipt_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_self_service_event_passport_payment_receipt_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.self_service_event_passport_payment_receipt_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_event_passport_payment_receipt_audit_mutation();

ALTER TABLE public.self_service_event_passport_payment_receipt_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_event_passport_payment_receipt_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. prepare_self_service_event_passport_checkout_attempt -- authenticated,
--    owner-scoped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_self_service_event_passport_checkout_attempt(
  p_event_id uuid,
  p_idempotency_key uuid
)
-- The first column is the discriminator:
--   'prepared'              -> a new (or idempotently replayed) preparing
--                               attempt for the caller's own eligible Event
--   'attempt_already_open'  -> the Event already has a preparing/open
--                               attempt; only that attempt's own minimal
--                               display facts are returned
-- Hard input / ownership / idempotency-conflict problems still RAISE, with
-- zero mutation.
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
  v_existing public.self_service_event_passport_payment_attempts%ROWTYPE;
  v_blocking public.self_service_event_passport_payment_attempts%ROWTYPE;
  v_appointment_id uuid;
  v_appointment_person_id uuid;
  v_new public.self_service_event_passport_payment_attempts%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Starting a Passport checkout requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Starting a Passport checkout requires a verified account email.';
  END IF;

  IF p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An event and an idempotency key are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_event_passport_payment_prepare:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.actor_auth_user_id = v_actor
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.event_id <> p_event_id THEN
      RAISE EXCEPTION 'Idempotency key was already used to start a checkout for a different event.';
    END IF;
    RETURN QUERY SELECT
      'prepared'::text, v_existing.id, v_existing.event_id, v_existing.state,
      v_existing.provider, v_existing.created_at;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_passport_payment_target:' || p_event_id::text, 0)
  );

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT oa.id, oa.person_id
    INTO v_appointment_id, v_appointment_person_id
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
    AND NOT public.is_self_service_event_passport_preserved(e.id)
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT * INTO v_blocking
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.event_id = p_event_id
    AND a.state IN ('preparing', 'open');

  IF FOUND THEN
    RETURN QUERY SELECT
      'attempt_already_open'::text, v_blocking.id, v_blocking.event_id, v_blocking.state,
      v_blocking.provider, v_blocking.created_at;
    RETURN;
  END IF;

  -- "A checkout that is merely pending still consumes that slot" -- create
  -- the Event's payment_pending Passport row now if it does not already
  -- exist (idempotent on the Passport table's own primary key: a prior
  -- attempt that was later expired/cancelled already left this row behind).
  -- ON CONFLICT ON CONSTRAINT (not a bare column list) deliberately: this
  -- function's own RETURNS TABLE declares an OUT parameter also named
  -- event_id, and PL/pgSQL's ambiguity check rejects a bare
  -- "ON CONFLICT (event_id)" column-list target as ambiguous against that
  -- OUT parameter, even though the intended target is unambiguous.
  INSERT INTO public.self_service_event_passports (event_id, state)
  VALUES (p_event_id, 'payment_pending')
  ON CONFLICT ON CONSTRAINT self_service_event_passports_pkey DO NOTHING;

  INSERT INTO public.self_service_event_passport_payment_attempts (
    event_id, organizer_person_id, actor_auth_user_id, idempotency_key
  ) VALUES (
    p_event_id, v_appointment_person_id, v_actor, p_idempotency_key
  ) RETURNING * INTO v_new;

  RETURN QUERY SELECT
    'prepared'::text, v_new.id, v_new.event_id, v_new.state, v_new.provider, v_new.created_at;
END;
$function$;

ALTER FUNCTION public.prepare_self_service_event_passport_checkout_attempt(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prepare_self_service_event_passport_checkout_attempt(uuid, uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.prepare_self_service_event_passport_checkout_attempt(uuid, uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. bind_self_service_event_passport_checkout_session -- service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bind_self_service_event_passport_checkout_session(
  p_attempt_id uuid,
  p_provider_session_id text
)
RETURNS TABLE(
  outcome text,
  attempt_id uuid,
  event_id uuid,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_session text := nullif(btrim(p_provider_session_id), '');
  v_attempt public.self_service_event_passport_payment_attempts%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR v_session IS NULL THEN
    RAISE EXCEPTION 'A Passport checkout attempt id and a provider Checkout Session id are required.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND OR v_attempt.state <> 'preparing' THEN
    RAISE EXCEPTION 'Passport checkout attempt % is not preparing.', p_attempt_id;
  END IF;

  UPDATE public.self_service_event_passport_payment_attempts
     SET provider_session_id = v_session,
         state = 'open',
         updated_at = now()
   WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;

  RETURN QUERY SELECT 'open'::text, v_attempt.id, v_attempt.event_id, v_attempt.state;
END;
$function$;

ALTER FUNCTION public.bind_self_service_event_passport_checkout_session(uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.bind_self_service_event_passport_checkout_session(uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bind_self_service_event_passport_checkout_session(uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. record_self_service_event_passport_checkout_terminal_state --
--    service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_self_service_event_passport_checkout_terminal_state(
  p_attempt_id uuid,
  p_provider_session_id text,
  p_terminal_state text
)
RETURNS TABLE(
  outcome text,
  attempt_id uuid,
  event_id uuid,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_session text := nullif(btrim(p_provider_session_id), '');
  v_attempt public.self_service_event_passport_payment_attempts%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR p_terminal_state IS NULL THEN
    RAISE EXCEPTION 'A Passport checkout attempt id and a terminal state are required.';
  END IF;

  IF p_terminal_state NOT IN ('expired', 'cancelled') THEN
    RAISE EXCEPTION 'Terminal state must be expired or cancelled.';
  END IF;

  SELECT * INTO v_attempt
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND OR v_attempt.state NOT IN ('preparing', 'open') THEN
    RAISE EXCEPTION 'Passport checkout attempt % is not open or preparing.', p_attempt_id;
  END IF;

  IF v_attempt.state = 'open' AND v_session IS DISTINCT FROM v_attempt.provider_session_id THEN
    RAISE EXCEPTION 'Provider Checkout Session does not match the recorded attempt.';
  END IF;

  IF v_attempt.state = 'preparing' AND v_session IS NOT NULL THEN
    RAISE EXCEPTION 'A preparing attempt has no provider Checkout Session to match.';
  END IF;

  UPDATE public.self_service_event_passport_payment_attempts
     SET state = p_terminal_state,
         updated_at = now()
   WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;

  RETURN QUERY SELECT p_terminal_state, v_attempt.id, v_attempt.event_id, v_attempt.state;
END;
$function$;

ALTER FUNCTION public.record_self_service_event_passport_checkout_terminal_state(uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_self_service_event_passport_checkout_terminal_state(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_self_service_event_passport_checkout_terminal_state(uuid, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. confirm_self_service_event_passport_payment -- service_role only. The
--    sole path that may ever transition a Passport out of payment_pending.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_self_service_event_passport_payment(
  p_attempt_id uuid,
  p_provider_session_id text,
  p_provider_event_id text
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  passport_state text,
  receipt_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_session text := nullif(btrim(p_provider_session_id), '');
  v_provider_event text := nullif(btrim(p_provider_event_id), '');
  v_existing_receipt public.self_service_event_passport_payment_receipt_audit%ROWTYPE;
  v_attempt_event_id uuid;
  v_attempt public.self_service_event_passport_payment_attempts%ROWTYPE;
  v_passport_state text;
  v_receipt public.self_service_event_passport_payment_receipt_audit%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR v_session IS NULL OR v_provider_event IS NULL THEN
    RAISE EXCEPTION
      'A Passport checkout attempt id, provider Checkout Session id, and provider event id are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_passport_payment_confirmation:' || v_provider_event, 0)
  );

  -- Durable provider-event idempotency, checked FIRST: a replayed Stripe
  -- webhook delivery is a harmless no-op before any lock is taken on the
  -- attempt or Passport row.
  SELECT * INTO v_existing_receipt
  FROM public.self_service_event_passport_payment_receipt_audit AS r
  WHERE r.provider_event_id = v_provider_event;

  IF FOUND THEN
    RETURN QUERY SELECT
      'confirmed'::text, v_existing_receipt.event_id, 'reserved'::text, v_existing_receipt.id;
    RETURN;
  END IF;

  SELECT a.event_id INTO v_attempt_event_id
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.id = p_attempt_id;

  IF v_attempt_event_id IS NULL THEN
    RAISE EXCEPTION 'Passport checkout attempt % not found.', p_attempt_id;
  END IF;

  -- Lock order: Passport row first, attempt row second -- the SAME order
  -- delete_self_service_organizer_event uses, so the two commands can never
  -- deadlock against each other.
  SELECT p.state INTO v_passport_state
  FROM public.self_service_event_passports AS p
  WHERE p.event_id = v_attempt_event_id
  FOR UPDATE;

  SELECT * INTO v_attempt
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.id = p_attempt_id
  FOR UPDATE;

  -- No "latest pending Event" fallback anywhere: the caller's attempt id AND
  -- Checkout Session id must match this specific open attempt.
  IF v_attempt.state <> 'open' OR v_attempt.provider_session_id <> v_session THEN
    RAISE EXCEPTION 'Passport checkout attempt % is not the expected open session.', p_attempt_id;
  END IF;

  IF v_passport_state IS DISTINCT FROM 'payment_pending' THEN
    RAISE EXCEPTION 'Event % Passport is not payment_pending.', v_attempt_event_id;
  END IF;

  -- Receipt written FIRST, before the Passport is ever touched.
  INSERT INTO public.self_service_event_passport_payment_receipt_audit (
    provider_event_id, provider_session_id, event_id, attempt_id
  ) VALUES (
    v_provider_event, v_session, v_attempt_event_id, p_attempt_id
  ) RETURNING * INTO v_receipt;

  -- Table alias + qualified WHERE deliberately: this function's own
  -- RETURNS TABLE declares an OUT parameter also named event_id, and an
  -- unqualified "WHERE event_id = ..." is ambiguous against it.
  UPDATE public.self_service_event_passports AS p
     SET state = 'reserved',
         paid_at = now(),
         updated_at = now()
   WHERE p.event_id = v_attempt_event_id;

  UPDATE public.self_service_event_passport_payment_attempts
     SET state = 'confirmed',
         updated_at = now()
   WHERE id = p_attempt_id;

  RETURN QUERY SELECT 'confirmed'::text, v_attempt_event_id, 'reserved'::text, v_receipt.id;
END;
$function$;

ALTER FUNCTION public.confirm_self_service_event_passport_payment(uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.confirm_self_service_event_passport_payment(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_self_service_event_passport_payment(uuid, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. delete_self_service_organizer_event: restated with exactly one added
--    block. Verbatim from 20261012000000 otherwise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_self_service_organizer_event(
  p_event_id uuid,
  p_idempotency_key uuid
)
RETURNS TABLE(
  outcome text,
  deleted_event_id uuid,
  deleted_tenant_id uuid,
  deletion_scope text,
  removed_command_audit_count integer,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_existing public.self_service_event_deletion_audit%ROWTYPE;
  v_appointment_id uuid;
  v_appointment_person_id uuid;
  v_tenant_id uuid;
  v_scope text;
  v_other_events integer;
  v_removed_cmd_audit integer;
  v_dep record;
  v_dep_count bigint;
  v_audit public.self_service_event_deletion_audit%ROWTYPE;
  v_passport_state text;
  v_open_attempt_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires a verified account email.';
  END IF;

  IF p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An event and an idempotency key are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_event_deletion:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_deletion_target:' || p_event_id::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.self_service_event_deletion_audit AS a
  WHERE a.actor_auth_user_id = v_actor
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.deleted_event_id <> p_event_id THEN
      RAISE EXCEPTION 'Idempotency key was already used to delete a different event.';
    END IF;
    RETURN QUERY SELECT
      'deleted'::text, v_existing.deleted_event_id, v_existing.deleted_tenant_id,
      v_existing.deletion_scope, v_existing.removed_command_audit_count,
      v_existing.occurred_at;
    RETURN;
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT oa.id, oa.person_id, oa.tenant_id
    INTO v_appointment_id, v_appointment_person_id, v_tenant_id
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
    AND NOT public.is_self_service_event_passport_preserved(e.id)
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Lun's correction: lock and recheck this Event's Passport state, in this
  -- same governed transaction, before any dependent-data scanning or Event
  -- deletion. FOR UPDATE takes a row lock when a Passport row exists, so a
  -- concurrent transaction cannot transition it to a preserved state
  -- underneath this deletion. reserved/active/expired fail closed here with
  -- the SAME non-enumerating 'Event not found.' even if a race somehow got
  -- them past the earlier ownership/eligibility filter above -- they are
  -- never deleted, cascaded, or otherwise touched.
  SELECT p.state
    INTO v_passport_state
  FROM public.self_service_event_passports AS p
  WHERE p.event_id = p_event_id
  FOR UPDATE;

  IF v_passport_state IN ('reserved', 'active', 'expired') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Stripe Passport Checkout foundation: a preparing or open provider
  -- Checkout Session for this Event must be cancelled or expired through the
  -- governed cancellation path (record_self_service_event_passport_checkout_terminal_state)
  -- before this Event can be ordinarily deleted -- a live or
  -- about-to-complete payment must never be silently discarded. A fixed,
  -- short, code-style RAISE EXCEPTION message ('checkout_cancellation_required',
  -- never a period-terminated human sentence) is the caller-safe structured
  -- signal here -- the SAME established pattern this repository already uses
  -- for a machine-readable, browser-adapter-matched outcome
  -- (save_my_self_service_private_draft_details' 'stale_draft_details').
  -- It must be an exception, not a structured return row: this function's
  -- own RETURNS TABLE shape is delete's, not replace's, and
  -- replace_self_service_organizer_event -- deliberately NOT restated by
  -- this migration -- captures this function's result WITHOUT branching on
  -- its outcome column, exactly like every other delete failure. Only a
  -- propagating exception aborts replace's delegated call with zero
  -- mutation; a normal returned row would let replace's unmodified code
  -- silently continue past it and create a duplicate new draft while
  -- leaving the checkout-in-progress Event untouched. FOR UPDATE takes the
  -- SAME lock order as confirm_self_service_event_passport_payment (Passport
  -- row first, attempt row second), so the two commands can never deadlock
  -- against each other -- whichever transaction commits first is what the
  -- other observes.
  SELECT a.id
    INTO v_open_attempt_id
  FROM public.self_service_event_passport_payment_attempts AS a
  WHERE a.event_id = p_event_id
    AND a.state IN ('preparing', 'open')
  FOR UPDATE;

  IF v_open_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_cancellation_required';
  END IF;

  -- No attempt-table cleanup here, deliberately: self_service_event_passport_payment_attempts.event_id
  -- is a plain, non-foreign-key audit reference (see its table definition),
  -- so a terminal (expired/cancelled) attempt row is never a dependency of
  -- this Event and never blocks its deletion. The specification requires
  -- that terminal attempt evidence durably survive the Event's own eventual
  -- ordinary deletion -- it is retained, completely untouched, below.

  IF v_passport_state = 'payment_pending' THEN
    -- The ONLY permitted Passport cleanup a governed delete may ever
    -- perform: exactly this Event's own payment_pending row, state-scoped so
    -- this WHERE clause could never remove a row that is anything other than
    -- payment_pending. ON DELETE RESTRICT remains in force on the foreign
    -- key -- this explicit, narrowly-scoped DELETE (not a database cascade)
    -- is what makes ordinary deletion of a payment_pending Event possible.
    DELETE FROM public.self_service_event_passports AS p
    WHERE p.event_id = p_event_id
      AND p.state = 'payment_pending';

    -- Fail closed: if any Passport row still exists for this Event after the
    -- state-scoped cleanup above, something is wrong -- abort rather than
    -- proceed to delete an Event with dependent Passport data still present.
    IF EXISTS (
      SELECT 1 FROM public.self_service_event_passports AS p WHERE p.event_id = p_event_id
    ) THEN
      RAISE EXCEPTION
        'Unfinished event % has unexpected dependent data in self_service_event_passports; deletion aborted.',
        p_event_id;
    END IF;
  END IF;

  -- Was this the last event in its private tenant?  If so, the empty private
  -- workspace goes too.
  SELECT count(*)::integer
    INTO v_other_events
  FROM public.events AS se
  WHERE se.tenant_id = v_tenant_id
    AND se.id <> p_event_id;

  v_scope := CASE WHEN v_other_events = 0
    THEN 'event_and_empty_workspace'
    ELSE 'event_only'
  END;

  SELECT count(*)::integer
    INTO v_removed_cmd_audit
  FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  -- Minimal, non-content deletion fact FIRST.
  INSERT INTO public.self_service_event_deletion_audit (
    organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,
    deletion_scope, removed_command_audit_count, idempotency_key
  ) VALUES (
    v_appointment_person_id, v_actor, p_event_id,
    CASE WHEN v_scope = 'event_and_empty_workspace' THEN v_tenant_id ELSE NULL END,
    v_scope, v_removed_cmd_audit, p_idempotency_key
  ) RETURNING * INTO v_audit;

  -- Open the governed DELETE window for this transaction only: the existing
  -- 'on' marker (immutable onboarding-command / tenant-lifecycle audit
  -- exception) plus a companion marker naming the exact Event id (the
  -- organizer-Agenda ledger exception below verifies BOTH).
  PERFORM set_config('app.self_service_governed_deletion', 'on', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', p_event_id::text, true);

  -- P-3B organizer-Agenda cleanup: THIS Event's known private-draft Agenda
  -- children, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Only this Event's organizer-branch P-3B Agenda ledger rows are removed;
  -- any non-organizer ledger row is left for the scan to fail closed on.
  DELETE FROM public.agenda_command_ledger AS acl
  WHERE acl.event_id = p_event_id
    AND acl.resolved_authority_branch = 'organizer'
    AND acl.task_key IS NULL
    AND acl.action IN (
      'organizer_private_agenda_item_created',
      'organizer_private_agenda_item_updated',
      'organizer_private_agenda_item_deleted'
    );

  DELETE FROM public.agenda_items AS ai
  WHERE ai.event_id = p_event_id;

  DELETE FROM public.event_agenda_state AS eas
  WHERE eas.event_id = p_event_id;

  -- P-3C organizer private guest-list cleanup: THIS Event's planned-guest
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no identity, attendee, or invitation rows exist to
  -- remove, and the deletion audit records only the non-content fact of
  -- deletion (no guest names, emails, phones, or notes).
  DELETE FROM public.self_service_private_draft_planned_guests AS plg
  WHERE plg.event_id = p_event_id;

  -- P-3D organizer private vendor-plan cleanup: THIS Event's vendor-plan
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no vendor account, contact, access, invitation,
  -- candidacy, admission, or disposition row exists to remove, and the
  -- deletion audit records only the non-content fact of deletion (no vendor
  -- names, categories, statuses, websites, contact details, or notes).
  DELETE FROM public.self_service_private_draft_vendor_plans AS svp
  WHERE svp.event_id = p_event_id;

  -- P-3E organizer private venue-plan cleanup: THIS Event's venue-plan rows,
  -- removed BEFORE the fail-closed dependency scan and Event delete. Planning
  -- data only -- no Event location, map object, Nearby place, catalog asset,
  -- vendor relationship, or identity row exists to remove, and the deletion
  -- audit records only the non-content fact of deletion (no place names,
  -- addresses, websites, contact names, phone numbers, statuses, or notes).
  DELETE FROM public.self_service_private_draft_venue_plans AS svnp
  WHERE svnp.event_id = p_event_id;

  -- P-3F organizer private registry-plan cleanup: THIS Event's registry-plan
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no published registry, provider account,
  -- integration, payment, purchase, gift, or order row exists to remove, and
  -- the deletion audit records only the non-content fact of deletion (no
  -- provider names, URLs, statuses, or notes).
  DELETE FROM public.self_service_private_draft_registry_plans AS srp
  WHERE srp.event_id = p_event_id;

  -- P-3G organizer private planning-checklist cleanup: THIS Event's checklist
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Deliberately NO count is captured: the deletion audit must not learn how
  -- many private reminders the organizer kept, any more than what they said.
  DELETE FROM public.self_service_private_draft_checklist_items AS sci
  WHERE sci.event_id = p_event_id;

  -- P-3H organizer private budget-plan cleanup: THIS Event's budget-line rows,
  -- removed BEFORE the fail-closed dependency scan and Event delete. Private
  -- planning numbers only -- no payment, invoice, receipt, contract, order,
  -- purchase, or commerce row exists to remove, because none was ever created.
  -- Deliberately NO count and NO total is captured: the deletion audit must
  -- not learn how many budget lines the organizer kept, in what currency, or
  -- what they added up to, any more than what they were called. An aggregate
  -- amount is private financial content, not innocuous metadata.
  DELETE FROM public.self_service_private_draft_budget_lines AS sbl
  WHERE sbl.event_id = p_event_id;

  -- Complete dependency coverage: after the known private-draft children above,
  -- a hidden Draft self-service event must have no rows in ANY other events(id)
  -- child table.  If that is ever untrue, fail closed with zero partial
  -- deletion -- this whole function is one transaction.  The draft marker and
  -- onboarding command audit for THIS event are the expected children and are
  -- excluded.
  FOR v_dep IN
    SELECT (con.conrelid::regclass)::text AS child_table,
           att.attname AS child_col
    FROM pg_constraint AS con
    JOIN pg_attribute AS att
      ON att.attrelid = con.conrelid
     AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.events'::regclass
      AND con.conrelid NOT IN (
        'public.self_service_private_event_drafts'::regclass,
        'public.self_service_onboarding_command_audit'::regclass
      )
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE %I = $1',
      v_dep.child_table, v_dep.child_col
    ) INTO v_dep_count USING p_event_id;
    IF v_dep_count > 0 THEN
      RAISE EXCEPTION
        'Unfinished event % has unexpected dependent data in %; deletion aborted.',
        p_event_id, v_dep.child_table;
    END IF;
  END LOOP;

  -- Children first: onboarding command audit -> draft marker -> event.
  DELETE FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  DELETE FROM public.self_service_private_event_drafts AS d
  WHERE d.event_id = p_event_id;

  DELETE FROM public.events AS e
  WHERE e.id = p_event_id;

  IF v_scope = 'event_and_empty_workspace' THEN
    DELETE FROM public.self_service_tenant_lifecycle_audit AS la
    WHERE la.tenant_id = v_tenant_id;

    DELETE FROM public.self_service_organizer_appointments AS oa
    WHERE oa.id = v_appointment_id;

    DELETE FROM public.tenants AS t
    WHERE t.id = v_tenant_id;
  END IF;

  -- Close the governed DELETE window immediately: it must not outlive this
  -- operation even within a longer-lived transaction.  (An error before here
  -- aborts the whole transaction, rolling both markers back regardless.)
  PERFORM set_config('app.self_service_governed_deletion', 'off', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', '', true);

  RETURN QUERY SELECT
    'deleted'::text, v_audit.deleted_event_id, v_audit.deleted_tenant_id,
    v_audit.deletion_scope, v_audit.removed_command_audit_count, v_audit.occurred_at;
END;
$function$;

COMMIT;
