-- P-3H: an owner-only PRIVATE budget plan for a self-service organizer's own
-- unfinished private draft.
--
-- This is A PRIVATE NOTEBOOK WITH NUMBERS IN IT, exactly as
-- docs/architecture/EPICENTRAX_PRIVATE_BUDGET_PLAN_CONTRACT.md requires. It is
-- NOT payment, billing, invoicing, accounting, vendor contracting, commerce,
-- or event readiness.
--
-- ===========================================================================
-- THE STATEMENTS THIS MIGRATION MUST KEEP TRUE
-- ===========================================================================
-- 1. EVERY NUMBER IS ORGANIZER-ENTERED. The only INSERT into the budget table
--    is the organizer's own add command. Nothing imports, infers, benchmarks,
--    looks up, suggests, pre-fills, or derives an amount from a vendor, venue,
--    registry, checklist, catalog asset, other Event, or any external source.
--
-- 2. NOTHING IS AGGREGATED. No function below computes a total, subtotal, sum,
--    average, count, balance, "remaining", or any other cross-line arithmetic,
--    in one currency or across two. The list RPC returns rows and nothing
--    derived.
--
-- 3. RECORDING A COST IS NOT PAYING IT. An "actual amount" is a number the
--    organizer wrote down, never a transaction, receipt, invoice, or proof
--    that money moved. This platform processes no payment here and has no way
--    to know whether, how, or to whom anything was paid.
--
-- 4. AN EMPTY OR A FULL BUDGET SAYS NOTHING ABOUT WHETHER THE EVENT IS READY.
--    Nothing here reaches events.status, events.is_active,
--    events.visible_to_members, or any launch / readiness / Passport rule.
--
-- ===========================================================================
-- CURRENCY (contract §D, approved 2026-09-08)
-- ===========================================================================
-- Each line carries exactly ONE currency: 'USD' (the default) or 'BTC'. The
-- estimated and actual amounts on one line therefore ALWAYS share that line's
-- currency -- structurally, because there is one currency column per row and
-- no per-amount currency exists.
--
--   * USD amounts allow at most 2 fractional decimal places;
--     BTC amounts allow at most 8 (one satoshi = 0.00000001 BTC).
--   * Excess precision is REJECTED, never silently rounded. The test is
--     `round(v, allowed) = v`: a value that survives rounding unchanged is
--     accepted; one that would be altered is refused. So 12.50 USD and
--     0.015 BTC pass, while 12.567 USD and 0.000000005 BTC are refused.
--   * Amounts are stored as EXACT `numeric` -- never float / double
--     precision -- and are written at the currency's canonical scale via
--     round(). Because excess precision was already refused, that round() can
--     only ever pad trailing zeros (12.5 -> 12.50); it can never change a
--     value the organizer entered.
--   * Amounts cross the wire OUT as exact decimal TEXT, so no IEEE-754 double
--     in any browser ever holds an organizer's money value.
--
-- BTC here is A PRIVATE UNIT OF ACCOUNT AND NOTHING ELSE: no wallet, address,
-- public or private key, seed phrase, on-chain activity, transfer, exchange,
-- or crypto integration exists in this migration or is authorized by it.
--
-- What this migration does NOT do:
--   * it performs NO exchange-rate lookup, currency conversion, or
--     cross-currency arithmetic, and stores no rate -- a USD line and a BTC
--     line are never combined, compared, or expressed in a common unit;
--   * it introduces NO payment, checkout, Passport, invoice, receipt,
--     contract, tax, reimbursement, contribution, fundraising, bank, card, or
--     payment-credential surface, and no commerce state of any kind;
--   * it never reads, writes, joins to, or reconciles against
--     self_service_private_draft_vendor_plans, _venue_plans, _registry_plans,
--     or _checklist_items -- two lists may describe the same real-world spend
--     and stay entirely uncoordinated, by design;
--   * it never touches the shared planning catalog, agenda_items,
--     event_agenda_state, vendors, event_vendors, people, person_identifiers,
--     attendees, or any identity, invitation, or notification surface;
--   * it adds NO command ledger and puts NO line name, category, currency,
--     amount, note, TOTAL, or LINE COUNT into any deletion audit, URL, log, or
--     user-visible error. An aggregate amount is private financial content,
--     not innocuous metadata.
--
-- Authorization is the exact self-service organizer-owner rule already used by
-- _organizer_private_draft_agenda_authorize (P-3B), _guest_authorize (P-3C),
-- _vendor_plan_authorize (P-3D), _venue_plan_authorize (P-3E),
-- _registry_plan_authorize (P-3F), and _checklist_authorize (P-3G).
--
-- The records are event-owned. §7 extends the governed
-- delete_self_service_organizer_event path to remove them AFTER the existing
-- guest / vendor / venue / registry / checklist cleanups and BEFORE the
-- universal fail-closed child-FK dependency scan, in the same change that
-- introduces the table.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The narrowly-scoped private-draft budget-line table.
--    A DEDICATED table, per the contract's prohibition on one generic
--    polymorphic planning table.
--    Event-owned (ON DELETE RESTRICT, exactly like its P-3B..P-3G siblings).
--    RLS on + all browser grants revoked: reachable ONLY through the
--    tightly-governed organizer RPCs below (postgres-owned, SECURITY
--    DEFINER), never directly by anon / authenticated / service_role.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_private_draft_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  -- Free text the organizer typed. Never parsed for intent, keywords,
  -- entities, or prices; never matched to a vendor, venue, registry, catalog
  -- asset, or suggestion list.
  line_name text NOT NULL
    CHECK (btrim(line_name) <> '' AND length(line_name) <= 200),
  -- Optional FREE TEXT. Deliberately NOT drawn from the Shared Planning
  -- Catalog's category list and not validated against any vendor, venue, or
  -- registry category: a Budget Plan has no catalog connection at all.
  category text
    CHECK (category IS NULL OR (btrim(category) <> '' AND length(category) <= 120)),
  -- EXACTLY ONE currency per line, so the two amounts below always share it.
  -- Two allowed values and no others: no free-text currency, no
  -- organizer-defined list, no locale or tenant inference.
  currency text NOT NULL DEFAULT 'USD'
    CHECK (currency IN ('USD', 'BTC')),
  -- EXACT numeric -- deliberately NOT float / double precision / money.
  -- Unconstrained scale at the type level; the CHECK below is what binds
  -- precision to the line's own currency.
  estimated_amount numeric,
  actual_amount numeric,
  organizer_note text
    CHECK (organizer_note IS NULL OR (btrim(organizer_note) <> '' AND length(organizer_note) <= 2000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Non-negative, currency-appropriate precision, and a storage-hygiene
  -- ceiling. The ceiling is a guard against absurd numeric values only -- it
  -- is NOT a budget limit, a spending cap, an affordability judgment, or any
  -- statement about what an organizer may plan to spend.
  CONSTRAINT self_service_private_draft_budget_lines_amounts_valid CHECK (
    (
      estimated_amount IS NULL
      OR (
        estimated_amount >= 0
        AND estimated_amount < 1000000000000
        AND scale(estimated_amount) <= CASE currency WHEN 'BTC' THEN 8 ELSE 2 END
      )
    )
    AND (
      actual_amount IS NULL
      OR (
        actual_amount >= 0
        AND actual_amount < 1000000000000
        AND scale(actual_amount) <= CASE currency WHEN 'BTC' THEN 8 ELSE 2 END
      )
    )
  )
);

ALTER TABLE public.self_service_private_draft_budget_lines OWNER TO postgres;

COMMENT ON TABLE public.self_service_private_draft_budget_lines IS
  'P-3H private budget plan for one self-service organizer Draft. Organizer-entered prospective and actual costs only -- never payment, billing, invoicing, accounting, vendor contracting, commerce, or event readiness. Never aggregated or converted.';
COMMENT ON COLUMN public.self_service_private_draft_budget_lines.currency IS
  'USD (default) or BTC, for THIS line only. Both amounts on the line share it. BTC is a private unit of account -- never a wallet, key, transfer, or crypto payment. No exchange rate, conversion, or cross-currency total exists.';
COMMENT ON COLUMN public.self_service_private_draft_budget_lines.estimated_amount IS
  'Exact numeric the organizer entered for what they expect this to cost. Max 2 decimal places for USD, 8 for BTC; excess precision is rejected, never rounded away. Never aggregated, benchmarked, converted, or surfaced outside the owning Draft.';
COMMENT ON COLUMN public.self_service_private_draft_budget_lines.actual_amount IS
  'Exact numeric the organizer entered for what this turned out to cost, by their own reckoning. NOT a payment record, receipt, or proof that money moved -- this platform processes no payment here.';

-- Stable creation order. No ordering/rank column exists in this phase.
CREATE INDEX self_service_private_draft_budget_lines_event_idx
  ON public.self_service_private_draft_budget_lines (event_id, created_at, id);

ALTER TABLE public.self_service_private_draft_budget_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_private_draft_budget_lines
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Internal helper: authorize the caller as the canonical owner of ONE
--    eligible private-draft Event's budget plan. Raises 'Draft not found.' for
--    every miss, non-enumerating. Never calls has_event_task_authority,
--    has_tenant_admin_authority, or any vendor / catalog / payment authority.
--    Byte-for-byte the same owner rule as
--    _organizer_private_draft_checklist_authorize (20261005000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_draft_budget_plan_authorize(p_event_id uuid)
RETURNS TABLE(organizer_appointment_id uuid, organizer_person_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_appt uuid;
  v_appt_person uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Editing a budget plan requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Editing a budget plan requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT oa.id, oa.person_id
    INTO v_appt, v_appt_person
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

  IF v_appt IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  RETURN QUERY SELECT v_appt, v_appt_person;
END;
$function$;

ALTER FUNCTION public._organizer_private_draft_budget_plan_authorize(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_draft_budget_plan_authorize(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The one place the two allowed currencies' precisions are defined for
-- executable code. (The table CHECK inlines the same CASE deliberately: a
-- CHECK constraint that depends on a user function is fragile across
-- dump/restore, so the constraint carries its own copy and the static test
-- pins the two to each other.)
--
-- This is a PRECISION lookup, not a rate, a conversion factor, or a
-- comparison between the two currencies. Nothing anywhere converts one into
-- the other.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_budget_currency_scale(p_currency text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_currency = 'USD' THEN
    RETURN 2;
  ELSIF p_currency = 'BTC' THEN
    RETURN 8;
  END IF;
  RAISE EXCEPTION 'A budget line must be in US dollars (USD) or Bitcoin (BTC).';
END;
$function$;

ALTER FUNCTION public._organizer_private_budget_currency_scale(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_budget_currency_scale(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared input validation for one budget line. line_name is REQUIRED;
-- category, both amounts, and the note are optional. LENGTH-ONLY checks on the
-- text -- the name and category are never parsed, matched, priced, or
-- categorized against anything.
--
-- The amount rules, and ONLY these: non-negative, below the storage-hygiene
-- ceiling, and within the line currency's own precision. EXCESS PRECISION IS
-- REFUSED RATHER THAN ROUNDED -- `round(v, allowed) = v` accepts a value only
-- when rounding would leave it untouched.
--
-- No message below echoes an amount, a name, a category, or a note: an error
-- states the RULE, never the organizer's own content.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_budget_line_validate(
  p_line_name text,
  p_category text,
  p_currency text,
  p_estimated_amount numeric,
  p_actual_amount numeric,
  p_organizer_note text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_scale integer;
BEGIN
  IF p_line_name IS NULL OR btrim(p_line_name) = '' OR length(btrim(p_line_name)) > 200 THEN
    RAISE EXCEPTION 'A budget line needs a name of 200 characters or fewer.';
  END IF;
  IF p_category IS NOT NULL AND length(p_category) > 120 THEN
    RAISE EXCEPTION 'A budget category must be 120 characters or fewer.';
  END IF;
  IF p_organizer_note IS NOT NULL AND length(p_organizer_note) > 2000 THEN
    RAISE EXCEPTION 'A budget note must be 2000 characters or fewer.';
  END IF;

  -- Raises for anything that is not one of the two approved currencies.
  v_scale := public._organizer_private_budget_currency_scale(p_currency);

  IF p_estimated_amount IS NOT NULL THEN
    IF p_estimated_amount < 0 THEN
      RAISE EXCEPTION 'A budget amount cannot be negative.';
    END IF;
    IF p_estimated_amount >= 1000000000000 THEN
      RAISE EXCEPTION 'A budget amount is larger than this field can hold.';
    END IF;
    IF round(p_estimated_amount, v_scale) <> p_estimated_amount THEN
      IF p_currency = 'BTC' THEN
        RAISE EXCEPTION 'A Bitcoin amount can have at most 8 decimal places.';
      ELSE
        RAISE EXCEPTION 'A US dollar amount can have at most 2 decimal places.';
      END IF;
    END IF;
  END IF;

  IF p_actual_amount IS NOT NULL THEN
    IF p_actual_amount < 0 THEN
      RAISE EXCEPTION 'A budget amount cannot be negative.';
    END IF;
    IF p_actual_amount >= 1000000000000 THEN
      RAISE EXCEPTION 'A budget amount is larger than this field can hold.';
    END IF;
    IF round(p_actual_amount, v_scale) <> p_actual_amount THEN
      IF p_currency = 'BTC' THEN
        RAISE EXCEPTION 'A Bitcoin amount can have at most 8 decimal places.';
      ELSE
        RAISE EXCEPTION 'A US dollar amount can have at most 2 decimal places.';
      END IF;
    END IF;
  END IF;
END;
$function$;

ALTER FUNCTION public._organizer_private_budget_line_validate(text, text, text, numeric, numeric, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_budget_line_validate(text, text, text, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Read: the caller's own private-draft budget lines, in stable creation
--    order. Returns THE ROWS AND NOTHING DERIVED -- no total, subtotal, sum,
--    average, count, balance, or "remaining", in either currency or across
--    the two.
--
--    Each amount leaves as EXACT DECIMAL TEXT at its own currency's scale, so
--    no IEEE-754 double in any browser ever holds an organizer's money value,
--    and each amount is inseparable from the currency on its own row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_private_draft_budget_lines(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  line_name text,
  category text,
  currency text,
  estimated_amount text,
  actual_amount text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_budget_plan_authorize(p_event_id);

  RETURN QUERY
  SELECT bl.id, bl.line_name, bl.category, bl.currency,
         bl.estimated_amount::text, bl.actual_amount::text,
         bl.organizer_note, bl.created_at, bl.updated_at
  FROM public.self_service_private_draft_budget_lines AS bl
  WHERE bl.event_id = p_event_id
  ORDER BY bl.created_at, bl.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Add one budget line. This is the ONLY INSERT into the budget table
--    anywhere in this migration: every number exists because the organizer
--    typed it.
--
--    Currency defaults to USD when the caller sends nothing. The only
--    transformation applied to the code itself is upper-casing the letters the
--    organizer's client sent ('usd' -> 'USD'); that is text casing, and is not
--    a conversion, a rate, or any change to an amount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_my_private_draft_budget_line(
  p_event_id uuid,
  p_line_name text,
  p_category text DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_estimated_amount numeric DEFAULT NULL,
  p_actual_amount numeric DEFAULT NULL,
  p_organizer_note text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  line_name text,
  category text,
  currency text,
  estimated_amount text,
  actual_amount text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_name text := btrim(p_line_name);
  v_category text := nullif(btrim(p_category), '');
  v_currency text := upper(btrim(coalesce(nullif(btrim(p_currency), ''), 'USD')));
  v_note text := nullif(btrim(p_organizer_note), '');
  v_scale integer;
  v_estimated numeric;
  v_actual numeric;
  v_row public.self_service_private_draft_budget_lines%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_budget_plan_authorize(p_event_id);
  PERFORM public._organizer_private_budget_line_validate(
    v_name, v_category, v_currency, p_estimated_amount, p_actual_amount, v_note
  );

  -- Validation above already REFUSED any value that rounding would alter, so
  -- this can only pad trailing zeros to the currency's canonical scale
  -- (12.5 -> 12.50). It never changes a number the organizer entered.
  v_scale := public._organizer_private_budget_currency_scale(v_currency);
  v_estimated := CASE WHEN p_estimated_amount IS NULL THEN NULL ELSE round(p_estimated_amount, v_scale) END;
  v_actual := CASE WHEN p_actual_amount IS NULL THEN NULL ELSE round(p_actual_amount, v_scale) END;

  INSERT INTO public.self_service_private_draft_budget_lines(
    event_id, line_name, category, currency, estimated_amount, actual_amount, organizer_note
  ) VALUES (
    p_event_id, v_name, v_category, v_currency, v_estimated, v_actual, v_note
  ) RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.line_name, v_row.category, v_row.currency,
    v_row.estimated_amount::text, v_row.actual_amount::text,
    v_row.organizer_note, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Edit one budget line, including switching its currency. Switching
--    currency re-validates BOTH amounts against the new currency's precision
--    and rewrites both at its scale -- the two amounts on a line can never
--    drift into different currencies. Nothing is converted: a 12.50 USD line
--    switched to BTC is 12.50 BTC, the organizer's own re-statement, never a
--    rate-derived figure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_private_draft_budget_line(
  p_event_id uuid,
  p_budget_line_id uuid,
  p_line_name text,
  p_category text DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_estimated_amount numeric DEFAULT NULL,
  p_actual_amount numeric DEFAULT NULL,
  p_organizer_note text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  line_name text,
  category text,
  currency text,
  estimated_amount text,
  actual_amount text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_name text := btrim(p_line_name);
  v_category text := nullif(btrim(p_category), '');
  v_currency text := upper(btrim(coalesce(nullif(btrim(p_currency), ''), 'USD')));
  v_note text := nullif(btrim(p_organizer_note), '');
  v_scale integer;
  v_estimated numeric;
  v_actual numeric;
  v_row public.self_service_private_draft_budget_lines%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_budget_plan_authorize(p_event_id);
  PERFORM public._organizer_private_budget_line_validate(
    v_name, v_category, v_currency, p_estimated_amount, p_actual_amount, v_note
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_budget_lines AS bl
    WHERE bl.id = p_budget_line_id AND bl.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Budget line not found.';
  END IF;

  v_scale := public._organizer_private_budget_currency_scale(v_currency);
  v_estimated := CASE WHEN p_estimated_amount IS NULL THEN NULL ELSE round(p_estimated_amount, v_scale) END;
  v_actual := CASE WHEN p_actual_amount IS NULL THEN NULL ELSE round(p_actual_amount, v_scale) END;

  -- Only this table's own columns are written. Nothing here touches events.*,
  -- the draft marker, any sibling planning table, or any readiness / launch /
  -- payment surface, whatever the amounts are set to.
  UPDATE public.self_service_private_draft_budget_lines AS bl
  SET line_name = v_name,
      category = v_category,
      currency = v_currency,
      estimated_amount = v_estimated,
      actual_amount = v_actual,
      organizer_note = v_note,
      updated_at = now()
  WHERE bl.id = p_budget_line_id AND bl.event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.line_name, v_row.category, v_row.currency,
    v_row.estimated_amount::text, v_row.actual_amount::text,
    v_row.organizer_note, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Remove one budget line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_private_draft_budget_line(
  p_event_id uuid,
  p_budget_line_id uuid
)
RETURNS TABLE(deleted_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_budget_plan_authorize(p_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_budget_lines AS bl
    WHERE bl.id = p_budget_line_id AND bl.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Budget line not found.';
  END IF;

  DELETE FROM public.self_service_private_draft_budget_lines AS bl
  WHERE bl.id = p_budget_line_id AND bl.event_id = p_event_id;

  RETURN QUERY SELECT p_budget_line_id;
END;
$function$;

ALTER FUNCTION public.list_my_private_draft_budget_lines(uuid) OWNER TO postgres;
ALTER FUNCTION public.add_my_private_draft_budget_line(uuid, text, text, text, numeric, numeric, text) OWNER TO postgres;
ALTER FUNCTION public.update_my_private_draft_budget_line(uuid, uuid, text, text, text, numeric, numeric, text) OWNER TO postgres;
ALTER FUNCTION public.delete_my_private_draft_budget_line(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_my_private_draft_budget_lines(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.add_my_private_draft_budget_line(uuid, text, text, text, numeric, numeric, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_my_private_draft_budget_line(uuid, uuid, text, text, text, numeric, numeric, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_my_private_draft_budget_line(uuid, uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_my_private_draft_budget_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_my_private_draft_budget_line(uuid, text, text, text, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_private_draft_budget_line(uuid, uuid, text, text, text, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_private_draft_budget_line(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. P-2D compatibility, in the SAME migration that introduces the table.
--
--    delete_self_service_organizer_event is restated VERBATIM from
--    20261005000000 (the authoritative definition) with ONLY one added block:
--    for an ALREADY-authorized eligible private Draft, THIS Event's budget
--    rows are removed transactionally right after the P-3G checklist cleanup
--    and BEFORE the existing fail-closed dependency scan. The budget table has
--    no immutability trigger, so no ledger exception or governed-deletion
--    marker is involved. Crucially the cleanup captures NO COUNT AND NO TOTAL
--    -- the deletion audit stays exactly as minimal as it already was. Every
--    other line -- the auth gate, the governed-deletion markers, the P-3B
--    Agenda cleanup, the P-3C guest cleanup, the P-3D vendor cleanup, the P-3E
--    venue cleanup, the P-3F registry cleanup, the P-3G checklist cleanup, the
--    fail-closed dependency scan, the empty-workspace teardown, the minimal
--    non-content deletion audit -- is unchanged. CREATE OR REPLACE preserves
--    the existing postgres ownership and authenticated-only EXECUTE ACL.
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
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
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
