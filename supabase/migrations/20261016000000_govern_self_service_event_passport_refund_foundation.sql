-- Passport Governed Refund Foundation -- schema/domain model only
-- (docs/architecture/EPICENTRAX_PRIVATE_EVENT_PASSPORT_RESERVATION_CONTRACT.md,
-- delivery sequence item 4: "Cancellation, refund, renewal, and expiry:
-- separately designed governed lifecycle work").
--
-- Approved v1 policy (fixed for this task): Platform super-admin will be the
-- only future refund initiator; full USD $24.00 refunds only; reserved
-- (pre-launch) Passports only, never active/launched; a verified refund ends
-- the Passport lifecycle and its Event returns to the ordinary unpaid
-- delete/replace cycle; payment and refund evidence remain permanent even
-- after that Event is later deleted.
--
-- This migration adds ONLY the domain-model foundation. It creates no
-- function/RPC that initiates, records, or confirms a refund; no Stripe SDK
-- call; no webhook event support; no browser control; no receipt reader; no
-- new admin authority predicate. It performs no top-level INSERT, UPDATE, or
-- DELETE -- every statement below is schema (CREATE/ALTER/DROP on
-- tables/constraints/functions/triggers/grants) or one narrowly scoped
-- restatement of an existing governed command.
--
-- Adds exactly:
--
--   1. `refunded` added to self_service_event_passports.state, plus a new
--      refunded_at timestamptz column and its own agrees-with-state CHECK.
--      paid_at is preserved for a refunded row (historical proof of the
--      earlier payment); active_period_started_at/ends_at remain required
--      NULL for refunded, structurally encoding "reserved/pre-launch only"
--      -- a refunded row can never carry a launched Event's active-period
--      facts. `is_self_service_event_passport_preserved` (live since
--      20261012000000, listing exactly 'reserved','active','expired') is
--      NOT restated -- it already, correctly, excludes 'refunded' without
--      any change, so a refunded Event is immediately eligible again for
--      ordinary Delete/Replace under the existing predicate.
--
--   2. `self_service_event_passport_refund_audit` -- a new, separate,
--      append-only table for a future verified Stripe refund. Provider
--      fixed to 'stripe'; amount/currency fixed to the same 2400/'usd' full
--      first-release Passport price, mirroring the payment receipt/audit
--      table exactly -- this release supports only a full refund, never a
--      partial one. Dual idempotency: UNIQUE(provider_refund_id) (the
--      refund object's own durable identity, independent of any delivery)
--      and UNIQUE(provider_event_id) (the webhook delivery's own identity,
--      exactly mirroring the payment receipt/audit table's existing
--      pattern) -- two independent replay risks, two independent guards.
--      UNIQUE(receipt_audit_id) as a third, defense-in-depth invariant: a
--      single one-time $24 payment can be refunded in full at most once.
--      Links to the ORIGINAL payment evidence through receipt_audit_id, a
--      real FK to the immutable receipt/audit row itself (RESTRICT is safe
--      because that row is permanent and never deleted by any governed
--      command) -- never a "latest refund for this Event" lookup. Its own
--      event_id is a plain, NON-foreign-key reference, exactly matching the
--      payment-attempts table's own established precedent, so it can never
--      restrict or be touched by the Event's later ordinary deletion. Same
--      immutability posture as the payment receipt/audit table: a dedicated
--      BEFORE UPDATE OR DELETE trigger unconditionally rejects mutation.
--      RLS enabled; every grant revoked from PUBLIC/anon/authenticated/
--      service_role; no policy; no reader or writer RPC exists anywhere in
--      this migration.
--
--   3. Existing receipt-audit retention correction: the payment receipt/
--      audit table's own event_id column (live since 20261013000000) is a
--      REAL foreign key to public.events with ON DELETE RESTRICT. That was
--      harmless while only reserved/active/expired Passports could ever
--      reach this table, because is_self_service_event_passport_preserved
--      already blocked their Event's ordinary deletion long before this FK
--      could matter. It becomes a real, structural blocker now that a
--      refunded Event must become ordinarily deletable again: the FK would
--      still RESTRICT that deletion even though the Passport itself is no
--      longer preserved. The minimal correction is to drop exactly that one
--      foreign key -- found dynamically by column and target, never by a
--      guessed/hardcoded constraint name, and aborting loudly if the live
--      schema does not match what is expected -- leaving event_id in place
--      as the SAME plain, NOT NULL, non-restricting audit reference the
--      attempts table already established. Its OTHER foreign key
--      (attempt_id, referencing the payment-attempts table) is left
--      completely untouched: attempt rows are never deleted by any governed
--      command, so that FK can never restrict anything and needs no
--      correction. No column is removed, renamed, or made nullable; no data
--      is touched; the generic dependency-scan exclusion list in
--      delete_self_service_organizer_event is NOT widened -- a plain,
--      non-foreign-key event_id is already structurally invisible to that
--      scan (it only enumerates REAL foreign keys referencing public.events)
--      exactly as the attempts table's own event_id already is, so no
--      exclusion-list entry is ever needed for either audit table.
--
--   4. delete_self_service_organizer_event restated with exactly one
--      narrow, symmetric extension to its EXISTING payment_pending Passport
--      cleanup branch (live since 20261012000000, most recently restated in
--      20261013000000): the same explicit, state-scoped DELETE now also
--      covers a refunded row, exactly like payment_pending -- a refunded
--      Passport row is left behind by nothing else in this migration (no
--      writer creates one yet), but this restatement is what makes the
--      "returns to the ordinary unpaid delete/replace cycle" policy
--      structurally true and provable once a refunded row can exist, rather
--      than leaving a real Passport row for the generic dependency scan to
--      correctly, but uselessly, abort on. Every other line is verbatim
--      from 20261013000000. replace_self_service_organizer_event is NOT
--      restated -- it delegates its entire deletion phase to this function
--      unchanged, so it inherits the identical refunded-cleanup behavior
--      with zero additional code, exactly as every prior restatement in
--      this family has documented.
--
-- What this migration does NOT do: no function/RPC that initiates, records,
-- or confirms a refund; no Stripe SDK, package, API call, webhook route, or
-- webhook event-type addition; no browser table write or read policy on any
-- table; no receipt reader, receipt UI, or email; no new admin/authority
-- predicate or admin screen; no secret, environment variable, or
-- configuration change; no widening of the generic dependency-scan
-- exclusion list; no touch to self_service_event_passport_payment_attempts'
-- own states or confirm_self_service_event_passport_payment's behavior; no
-- touch to FCOC, ordinary tenants, Platform/Tenant/Event administration, or
-- P0 media boundaries.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Passport state model: add terminal `refunded`.
-- ---------------------------------------------------------------------------
ALTER TABLE public.self_service_event_passports
  DROP CONSTRAINT self_service_event_passports_state_check;

ALTER TABLE public.self_service_event_passports
  ADD CONSTRAINT self_service_event_passports_state_check CHECK (
    state IN ('payment_pending', 'reserved', 'active', 'expired', 'refunded')
  );

ALTER TABLE public.self_service_event_passports
  DROP CONSTRAINT self_service_event_passports_paid_at_agrees_with_state;

ALTER TABLE public.self_service_event_passports
  ADD CONSTRAINT self_service_event_passports_paid_at_agrees_with_state CHECK (
    (state = 'payment_pending' AND paid_at IS NULL)
    OR (state IN ('reserved', 'active', 'expired', 'refunded') AND paid_at IS NOT NULL)
  );

ALTER TABLE public.self_service_event_passports
  DROP CONSTRAINT self_service_event_passports_active_period_agrees_with_state;

ALTER TABLE public.self_service_event_passports
  ADD CONSTRAINT self_service_event_passports_active_period_agrees_with_state CHECK (
    (state IN ('payment_pending', 'reserved', 'refunded') AND active_period_started_at IS NULL AND active_period_ends_at IS NULL)
    OR (state IN ('active', 'expired') AND active_period_started_at IS NOT NULL AND active_period_ends_at IS NOT NULL)
  );

ALTER TABLE public.self_service_event_passports
  ADD COLUMN refunded_at timestamptz;

ALTER TABLE public.self_service_event_passports
  ADD CONSTRAINT self_service_event_passports_refunded_at_agrees_with_state CHECK (
    (state = 'refunded' AND refunded_at IS NOT NULL)
    OR (state <> 'refunded' AND refunded_at IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. Permanent refund-audit foundation -- append-only, no reader/writer yet.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_event_passport_refund_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  -- Stripe's own refund object id -- the refund's own durable identity,
  -- independent of any webhook delivery.
  provider_refund_id text NOT NULL,
  -- Stripe's own webhook event id for the delivery that reported this
  -- refund -- a second, independent idempotency key guarding a different
  -- replay risk (a redelivered webhook event) than provider_refund_id does.
  provider_event_id text NOT NULL,
  -- A plain, NON-foreign-key opaque reference, deliberately matching
  -- self_service_event_passport_payment_attempts.event_id's own
  -- established precedent: a refunded Event's later ordinary deletion must
  -- never be restricted by, or touch, this column. Audit evidence only --
  -- never a discovery or authorization key, and never the join used to
  -- locate a refund for an Event; receipt_audit_id below is that link.
  event_id uuid NOT NULL,
  -- The EXACT immutable receipt/audit row this refund reverses -- never a
  -- "latest refund for this Event" lookup. RESTRICT is safe: that row is
  -- permanent and is never deleted by any governed command.
  receipt_audit_id uuid NOT NULL
    REFERENCES public.self_service_event_passport_payment_receipt_audit(id) ON DELETE RESTRICT,
  -- Fixed by DEFAULT and CHECK, exactly mirroring the payment receipt/audit
  -- table: this first release refunds only the fixed $24.00 USD full
  -- amount, never a partial or caller-supplied value.
  amount_minor_units integer NOT NULL DEFAULT 2400 CHECK (amount_minor_units = 2400),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  refunded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_event_passport_refund_audit_provider_refund_unique
    UNIQUE (provider_refund_id),
  CONSTRAINT self_service_event_passport_refund_audit_provider_event_unique
    UNIQUE (provider_event_id),
  -- Defense-in-depth: a single one-time $24 payment can be refunded in
  -- full at most once.
  CONSTRAINT self_service_event_passport_refund_audit_receipt_unique
    UNIQUE (receipt_audit_id)
);

ALTER TABLE public.self_service_event_passport_refund_audit OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.prevent_self_service_event_passport_refund_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'self_service_event_passport_refund_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_self_service_event_passport_refund_audit_mutation()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_self_service_event_passport_refund_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_self_service_event_passport_refund_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.self_service_event_passport_refund_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_event_passport_refund_audit_mutation();

ALTER TABLE public.self_service_event_passport_refund_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_event_passport_refund_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Existing receipt-audit retention correction: drop the one real foreign
--    key that would otherwise block a refunded Event's later ordinary
--    deletion. Found dynamically -- never a guessed or hardcoded constraint
--    name -- by a predicate that proves EVERY one of the following before
--    ever matching a row: the source relation is exactly this receipt/audit
--    table; the constraint is a foreign key; the target relation is exactly
--    public.events; the source key is single-column (never a composite
--    match hiding behind one shared attribute name); the target key is
--    single-column; the sole source column is exactly event_id; and the
--    sole target column is exactly id. `INTO STRICT` then aborts the whole
--    migration loudly if zero or more than one row satisfies every one of
--    those predicates simultaneously -- this is what actually guarantees
--    "the exact intended single-column FK," not merely "a same-named
--    attribute somewhere in a matching constraint."
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname
    INTO STRICT v_constraint_name
  FROM pg_constraint AS con
  JOIN pg_attribute AS src_att
    ON src_att.attrelid = con.conrelid
   AND src_att.attnum = con.conkey[1]
  JOIN pg_attribute AS tgt_att
    ON tgt_att.attrelid = con.confrelid
   AND tgt_att.attnum = con.confkey[1]
  WHERE con.conrelid = 'public.self_service_event_passport_payment_receipt_audit'::regclass
    AND con.contype = 'f'
    AND con.confrelid = 'public.events'::regclass
    AND array_length(con.conkey, 1) = 1
    AND array_length(con.confkey, 1) = 1
    AND src_att.attname = 'event_id'
    AND tgt_att.attname = 'id';

  EXECUTE format(
    'ALTER TABLE public.self_service_event_passport_payment_receipt_audit DROP CONSTRAINT %I',
    v_constraint_name
  );
END;
$migration$;

-- ---------------------------------------------------------------------------
-- 4. delete_self_service_organizer_event: restated verbatim from
--    20261013000000 with exactly one added state in its existing
--    payment_pending Passport-cleanup branch.
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
  -- ordinary deletion -- it is retained, completely untouched, below. The
  -- SAME is now true of the payment receipt/audit and refund/audit rows
  -- (see this migration's retention correction and refund-audit table,
  -- respectively): both reference this Event only through a plain,
  -- non-foreign-key column, so neither is ever a dependency of this Event
  -- and neither is discovered by the generic dependency scan below.
  IF v_passport_state IN ('payment_pending', 'refunded') THEN
    -- The ONLY permitted Passport cleanup a governed delete may ever
    -- perform: exactly this Event's own payment_pending OR refunded row,
    -- state-scoped so this WHERE clause could never remove a row that is
    -- anything other than one of those two terminal-for-delete states. ON
    -- DELETE RESTRICT remains in force on the foreign key -- this explicit,
    -- narrowly-scoped DELETE (not a database cascade) is what makes
    -- ordinary deletion of a payment_pending OR refunded Event possible. A
    -- refunded row reaches this branch only once a future, separately
    -- authorized governed refund-confirmation command exists to create one
    -- -- no writer in this migration ever does.
    DELETE FROM public.self_service_event_passports AS p
    WHERE p.event_id = p_event_id
      AND p.state IN ('payment_pending', 'refunded');

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
