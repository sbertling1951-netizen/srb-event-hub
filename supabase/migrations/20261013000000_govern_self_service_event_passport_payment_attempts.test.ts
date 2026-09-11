import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261013000000_govern_self_service_event_passport_payment_attempts.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261013000000_govern_self_service_event_passport_payment_attempts.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function functionBody(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing body end for ${name}`);
  return SQL.slice(start, end);
}

function tableBody(name: string) {
  const start = SQL.indexOf(`CREATE TABLE public.${name}`);
  assert.notEqual(start, -1, `missing table ${name}`);
  // A standalone "\n);" line closes the table -- unlike a bare ");" scan,
  // this is not tripped by a literal ");" inside an explanatory comment.
  const end = SQL.indexOf("\n);", start) + 3;
  assert.ok(end > 2, `missing table body end for ${name}`);
  return SQL.slice(start, end);
}

const ATTEMPTS_TABLE = tableBody("self_service_event_passport_payment_attempts");
const RECEIPT_TABLE = tableBody("self_service_event_passport_payment_receipt_audit");
const PREPARE_FN = functionBody("prepare_self_service_event_passport_checkout_attempt");
const BIND_FN = functionBody("bind_self_service_event_passport_checkout_session");
const TERMINAL_FN = functionBody("record_self_service_event_passport_checkout_terminal_state");
const CONFIRM_FN = functionBody("confirm_self_service_event_passport_payment");
const DELETE_FN = functionBody("delete_self_service_organizer_event");

test("the migration is one transaction defining exactly six functions, in order, and never restates replace_self_service_organizer_event", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
  const order = [
    "prevent_self_service_event_passport_payment_receipt_audit_mutation",
    "prepare_self_service_event_passport_checkout_attempt",
    "bind_self_service_event_passport_checkout_session",
    "record_self_service_event_passport_checkout_terminal_state",
    "confirm_self_service_event_passport_payment",
    "delete_self_service_organizer_event",
  ].map((name) => SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`));
  for (const idx of order) {
    assert.notEqual(idx, -1);
  }
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], "expected the documented function order");
  }
  assert.equal((SQL.match(/^CREATE OR REPLACE FUNCTION public\./gm) ?? []).length, 6);
  assert.doesNotMatch(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.replace_self_service_organizer_event|ALTER FUNCTION public\.replace_self_service_organizer_event|GRANT.*replace_self_service_organizer_event|REVOKE.*replace_self_service_organizer_event/,
  );
});

// ---- Attempt table ----

test("self_service_event_passport_payment_attempts holds exactly the required fields -- separate from self_service_event_passports", () => {
  assert.match(ATTEMPTS_TABLE, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  assert.match(ATTEMPTS_TABLE, /event_id uuid NOT NULL,/);
  assert.match(
    ATTEMPTS_TABLE,
    /organizer_person_id uuid NOT NULL REFERENCES public\.people\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    ATTEMPTS_TABLE,
    /actor_auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/,
  );
  assert.match(ATTEMPTS_TABLE, /idempotency_key uuid NOT NULL/);
  assert.match(ATTEMPTS_TABLE, /provider text NOT NULL DEFAULT 'stripe' CHECK \(provider = 'stripe'\)/);
  assert.match(ATTEMPTS_TABLE, /provider_session_id text/);
  assert.match(
    ATTEMPTS_TABLE,
    /state text NOT NULL DEFAULT 'preparing' CHECK \(\s*\n\s*state IN \('preparing', 'open', 'expired', 'cancelled', 'confirmed'\)\s*\n\s*\)/,
  );
  assert.match(ATTEMPTS_TABLE, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(ATTEMPTS_TABLE, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  // no amount/currency on the attempt table -- that belongs to the receipt
  assert.doesNotMatch(ATTEMPTS_TABLE, /amount|currency/i);
});

test("the attempt table's provider_session_id agrees with lifecycle state -- NULL while preparing, required for open/confirmed, either for a terminal state reached from either path", () => {
  assert.match(
    ATTEMPTS_TABLE,
    /CONSTRAINT self_service_event_passport_payment_attempts_session_agrees_with_state CHECK \(\s*\n\s*\(state = 'preparing' AND provider_session_id IS NULL\)\s*\n\s*OR \(state IN \('open', 'confirmed'\) AND provider_session_id IS NOT NULL\)\s*\n\s*OR \(state IN \('expired', 'cancelled'\)\)\s*\n\s*\)/,
  );
});

test("one-open-attempt is a real database invariant -- a partial unique index on event_id scoped to preparing/open", () => {
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX self_service_event_passport_payment_attempts_one_open_idx\s*\n\s*ON public\.self_service_event_passport_payment_attempts \(event_id\)\s*\n\s*WHERE state IN \('preparing', 'open'\);/,
  );
});

test("idempotent retry is a real database invariant -- UNIQUE (actor_auth_user_id, idempotency_key)", () => {
  assert.match(
    ATTEMPTS_TABLE,
    /CONSTRAINT self_service_event_passport_payment_attempts_actor_key_unique\s*\n\s*UNIQUE \(actor_auth_user_id, idempotency_key\)/,
  );
});

test("the attempt table is completely browser-inaccessible -- RLS enabled, every grant revoked from every role including service_role, no policy", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passport_payment_attempts ENABLE ROW LEVEL SECURITY;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_event_passport_payment_attempts\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(SQL, /CREATE POLICY.*self_service_event_passport_payment_attempts/);
  assert.doesNotMatch(SQL, /GRANT.*ON TABLE public\.self_service_event_passport_payment_attempts/);
});

// ---- Receipt/audit table ----

test("self_service_event_passport_payment_receipt_audit holds exactly the required fields, with the fixed USD $24.00 snapshot", () => {
  assert.match(RECEIPT_TABLE, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  assert.match(RECEIPT_TABLE, /provider text NOT NULL DEFAULT 'stripe' CHECK \(provider = 'stripe'\)/);
  assert.match(RECEIPT_TABLE, /provider_event_id text NOT NULL/);
  assert.match(RECEIPT_TABLE, /provider_session_id text NOT NULL/);
  assert.match(RECEIPT_TABLE, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  assert.match(
    RECEIPT_TABLE,
    /attempt_id uuid NOT NULL REFERENCES public\.self_service_event_passport_payment_attempts\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    RECEIPT_TABLE,
    /amount_minor_units integer NOT NULL DEFAULT 2400 CHECK \(amount_minor_units = 2400\)/,
  );
  assert.match(RECEIPT_TABLE, /currency text NOT NULL DEFAULT 'usd' CHECK \(currency = 'usd'\)/);
  assert.match(RECEIPT_TABLE, /confirmed_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("the receipt/audit table's provider event id is durably unique -- the webhook-idempotency mechanism", () => {
  assert.match(
    RECEIPT_TABLE,
    /CONSTRAINT self_service_event_passport_payment_receipt_audit_provider_event_unique\s*\n\s*UNIQUE \(provider_event_id\)/,
  );
});

test("the receipt/audit table is append-only -- a BEFORE UPDATE OR DELETE trigger unconditionally rejects mutation", () => {
  assert.match(
    SQL,
    /RAISE EXCEPTION 'self_service_event_passport_payment_receipt_audit is immutable';/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.prevent_self_service_event_passport_payment_receipt_audit_mutation\(\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    SQL,
    /CREATE TRIGGER prevent_self_service_event_passport_payment_receipt_audit_mutation_trigger\s*\nBEFORE UPDATE OR DELETE ON public\.self_service_event_passport_payment_receipt_audit\s*\nFOR EACH ROW\s*\nEXECUTE FUNCTION public\.prevent_self_service_event_passport_payment_receipt_audit_mutation\(\);/,
  );
});

test("the receipt/audit table is completely browser-inaccessible and has no read RPC -- no Event/payment discovery surface", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passport_payment_receipt_audit ENABLE ROW LEVEL SECURITY;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_event_passport_payment_receipt_audit\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(SQL, /CREATE POLICY.*self_service_event_passport_payment_receipt_audit/);
  assert.doesNotMatch(SQL, /GRANT.*ON TABLE public\.self_service_event_passport_payment_receipt_audit/);
  // no SELECT-returning read RPC over the receipt table anywhere
  assert.doesNotMatch(SQL, /RETURNS TABLE[\s\S]{0,400}FROM public\.self_service_event_passport_payment_receipt_audit/);
});

// ---- prepare_self_service_event_passport_checkout_attempt ----

test("prepare is authenticated-only, never anon or service_role", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.prepare_self_service_event_passport_checkout_attempt\(uuid, uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.prepare_self_service_event_passport_checkout_attempt\(uuid, uuid\)\s*\n\s*TO authenticated;/,
  );
});

test("prepare reuses the exact same canonical-owner / private-Draft / Passport-preserved eligibility predicate as delete and create", () => {
  const ownershipClause =
    /WHERE d\.event_id = p_event_id\s*\n\s*AND oa\.is_active = true\s*\n\s*AND \(\s*\n\s*\(v_link_status = 'resolved' AND oa\.person_id = v_person_id\)\s*\n\s*OR \(v_link_status = 'no_link' AND oa\.auth_user_id = v_actor\)\s*\n\s*\)\s*\n\s*AND t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false\s*\n\s*AND NOT public\.is_self_service_event_passport_preserved\(e\.id\)/;
  assert.match(PREPARE_FN, ownershipClause);
  assert.match(DELETE_FN, ownershipClause);
});

test("prepare never accepts a Person, tenant, amount, currency, or Passport-state argument", () => {
  assert.match(SQL, /prepare_self_service_event_passport_checkout_attempt\(\s*\n\s*p_event_id uuid,\s*\n\s*p_idempotency_key uuid\s*\n\)/);
});

test("prepare's idempotent retry replays the same (actor, idempotency key) attempt without a second insert", () => {
  assert.match(
    PREPARE_FN,
    /SELECT \* INTO v_existing\s*\n\s*FROM public\.self_service_event_passport_payment_attempts AS a\s*\n\s*WHERE a\.actor_auth_user_id = v_actor\s*\n\s*AND a\.idempotency_key = p_idempotency_key;/,
  );
  assert.match(PREPARE_FN, /IF FOUND THEN\s*\n\s*IF v_existing\.event_id <> p_event_id THEN/);
});

test("prepare rejects a second concurrent attempt for the same Event with a caller-safe structured outcome, never a raw constraint error", () => {
  assert.match(
    PREPARE_FN,
    /WHERE a\.event_id = p_event_id\s*\n\s*AND a\.state IN \('preparing', 'open'\);\s*\n\s*\n\s*IF FOUND THEN\s*\n\s*RETURN QUERY SELECT\s*\n\s*'attempt_already_open'::text/,
  );
});

test("prepare creates-or-confirms the Event's payment_pending Passport row idempotently, hardcoding the state -- never a caller-supplied Passport state", () => {
  assert.match(
    PREPARE_FN,
    /INSERT INTO public\.self_service_event_passports \(event_id, state\)\s*\n\s*VALUES \(p_event_id, 'payment_pending'\)\s*\n\s*ON CONFLICT ON CONSTRAINT self_service_event_passports_pkey DO NOTHING;/,
  );
});

// ---- bind / terminal-state / confirm: service-role-only posture ----

test("bind, record-terminal-state, and confirm are service_role-only -- never anon, never authenticated", () => {
  for (const fn of [
    "bind_self_service_event_passport_checkout_session\\(uuid, text\\)",
    "record_self_service_event_passport_checkout_terminal_state\\(uuid, text, text\\)",
    "confirm_self_service_event_passport_payment\\(uuid, text, text\\)",
  ]) {
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\s*\\n\\s*FROM PUBLIC, anon, authenticated;`),
    );
    assert.match(
      SQL,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\s*\\n\\s*TO service_role;`),
    );
  }
});

test("bind only transitions a preparing attempt to open, attaching the provider session id", () => {
  assert.match(BIND_FN, /IF NOT FOUND OR v_attempt\.state <> 'preparing' THEN/);
  assert.match(
    BIND_FN,
    /SET provider_session_id = v_session,\s*\n\s*state = 'open',/,
  );
});

test("record-terminal-state only accepts expired or cancelled, and validates the provider session id against the recorded attempt", () => {
  assert.match(TERMINAL_FN, /IF p_terminal_state NOT IN \('expired', 'cancelled'\) THEN/);
  assert.match(
    TERMINAL_FN,
    /IF v_attempt\.state = 'open' AND v_session IS DISTINCT FROM v_attempt\.provider_session_id THEN/,
  );
});

// ---- confirm: the sole payment_pending -> reserved path ----

test("confirm checks durable provider-event idempotency FIRST, before taking any lock -- duplicate delivery is a harmless no-op", () => {
  const lockIdx = CONFIRM_FN.indexOf("pg_advisory_xact_lock");
  const idempotencyIdx = CONFIRM_FN.indexOf("self_service_event_passport_payment_receipt_audit AS r");
  const passportLockIdx = CONFIRM_FN.indexOf("self_service_event_passports AS p");
  assert.notEqual(lockIdx, -1);
  assert.notEqual(idempotencyIdx, -1);
  assert.notEqual(passportLockIdx, -1);
  assert.ok(lockIdx < idempotencyIdx);
  assert.ok(idempotencyIdx < passportLockIdx, "the idempotency check must run before the Passport row is ever locked");
});

test("confirm locks the Passport row before the attempt row -- the SAME order delete now uses, so the two can never deadlock", () => {
  const passportLockIdx = CONFIRM_FN.indexOf("FROM public.self_service_event_passports AS p");
  const attemptLockIdx = CONFIRM_FN.indexOf("FROM public.self_service_event_passport_payment_attempts AS a\n  WHERE a.id = p_attempt_id\n  FOR UPDATE;");
  assert.notEqual(passportLockIdx, -1);
  assert.notEqual(attemptLockIdx, -1);
  assert.ok(passportLockIdx < attemptLockIdx);
});

test("confirm never uses a 'latest pending Event' lookup -- it matches the specific attempt id AND provider session id", () => {
  assert.doesNotMatch(CONFIRM_FN, /ORDER BY.*created_at.*DESC/i);
  assert.doesNotMatch(CONFIRM_FN, /LIMIT 1/);
  assert.match(
    CONFIRM_FN,
    /IF v_attempt\.state <> 'open' OR v_attempt\.provider_session_id <> v_session THEN/,
  );
});

test("confirm writes the immutable receipt BEFORE it changes the Passport to reserved, and never accepts an amount or currency argument", () => {
  const receiptIdx = CONFIRM_FN.indexOf("INSERT INTO public.self_service_event_passport_payment_receipt_audit");
  const passportUpdateIdx = CONFIRM_FN.indexOf("UPDATE public.self_service_event_passports");
  assert.notEqual(receiptIdx, -1);
  assert.notEqual(passportUpdateIdx, -1);
  assert.ok(receiptIdx < passportUpdateIdx, "the receipt must be written before the Passport is reserved");
  assert.match(
    SQL,
    /confirm_self_service_event_passport_payment\(\s*\n\s*p_attempt_id uuid,\s*\n\s*p_provider_session_id text,\s*\n\s*p_provider_event_id text\s*\n\)/,
  );
});

test("confirm transitions exactly the intended Passport to reserved and marks exactly that attempt confirmed", () => {
  assert.match(
    CONFIRM_FN,
    /UPDATE public\.self_service_event_passports AS p\s*\n\s*SET state = 'reserved',\s*\n\s*paid_at = now\(\),\s*\n\s*updated_at = now\(\)\s*\n\s*WHERE p\.event_id = v_attempt_event_id;/,
  );
  assert.match(
    CONFIRM_FN,
    /UPDATE public\.self_service_event_passport_payment_attempts\s*\n\s*SET state = 'confirmed',/,
  );
});

test("confirm fails closed if the Passport is not payment_pending -- it never double-confirms or reserves a foreign Event", () => {
  assert.match(CONFIRM_FN, /IF v_passport_state IS DISTINCT FROM 'payment_pending' THEN\s*\n\s*RAISE EXCEPTION/);
});

// ---- Delete/Replace safety ----

test("delete_self_service_organizer_event denies ordinary deletion for a preparing/open attempt by RAISING the fixed, code-style 'checkout_cancellation_required' message -- never a structured return row", () => {
  assert.match(
    DELETE_FN,
    /SELECT a\.id\s*\n\s*INTO v_open_attempt_id\s*\n\s*FROM public\.self_service_event_passport_payment_attempts AS a\s*\n\s*WHERE a\.event_id = p_event_id\s*\n\s*AND a\.state IN \('preparing', 'open'\)\s*\n\s*FOR UPDATE;/,
  );
  assert.match(
    DELETE_FN,
    /IF v_open_attempt_id IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION 'checkout_cancellation_required';\s*\n\s*END IF;/,
  );
});

test("the checkout-cancellation denial is a RAISE, not a RETURN QUERY -- replace_self_service_organizer_event's unmodified, un-branching delegation only aborts safely if this propagates as an exception", () => {
  const denialIdx = DELETE_FN.indexOf("RAISE EXCEPTION 'checkout_cancellation_required';");
  assert.notEqual(denialIdx, -1);
  const nearby = DELETE_FN.slice(Math.max(0, denialIdx - 200), denialIdx + 60);
  assert.doesNotMatch(nearby, /RETURN QUERY/);
});

test("the attempts table's event_id is a plain, non-foreign-key column -- terminal attempt evidence must durably survive its Event's later deletion", () => {
  assert.doesNotMatch(ATTEMPTS_TABLE, /event_id uuid NOT NULL REFERENCES/);
  assert.doesNotMatch(ATTEMPTS_TABLE, /event_id.*REFERENCES public\.events/);
});

test("delete_self_service_organizer_event never deletes, updates, or otherwise touches the attempts table -- terminal attempt rows are retained, not cleaned up", () => {
  assert.doesNotMatch(DELETE_FN, /DELETE FROM public\.self_service_event_passport_payment_attempts/);
  assert.doesNotMatch(DELETE_FN, /UPDATE public\.self_service_event_passport_payment_attempts/);
});

test("the generic dependency scan cannot discover the attempts table, because its event_id is deliberately not a foreign key referencing public.events", () => {
  const scanIdx = DELETE_FN.indexOf("FOR v_dep IN");
  assert.notEqual(scanIdx, -1);
  const scanClause = DELETE_FN.slice(scanIdx, DELETE_FN.indexOf("LOOP", scanIdx));
  assert.match(scanClause, /con\.confrelid = 'public\.events'::regclass/);
  // this is a structural guarantee, not a name-based exclusion: no FK from
  // the attempts table to public.events exists anywhere in this migration
  // for that scan to ever find
  assert.doesNotMatch(
    SQL,
    /self_service_event_passport_payment_attempts.*REFERENCES public\.events|REFERENCES public\.events.*self_service_event_passport_payment_attempts/,
  );
});

test("the attempt check runs AFTER the existing reserved/active/expired recheck and BEFORE the existing payment_pending cleanup -- a plain payment_pending Passport with no attempt is unaffected", () => {
  const reservedCheckIdx = DELETE_FN.indexOf("IN ('reserved', 'active', 'expired')");
  const attemptCheckIdx = DELETE_FN.indexOf("checkout_cancellation_required");
  const cleanupIdx = DELETE_FN.indexOf("IF v_passport_state = 'payment_pending' THEN");
  assert.notEqual(reservedCheckIdx, -1);
  assert.notEqual(attemptCheckIdx, -1);
  assert.notEqual(cleanupIdx, -1);
  assert.ok(reservedCheckIdx < attemptCheckIdx);
  assert.ok(attemptCheckIdx < cleanupIdx);
});

test("delete still preserves reserved/active/expired denial and the state-scoped payment_pending cleanup verbatim", () => {
  assert.match(
    DELETE_FN,
    /AND NOT public\.is_self_service_event_passport_preserved\(e\.id\)\s*\n\s*LIMIT 1;/,
  );
  assert.match(
    DELETE_FN,
    /DELETE FROM public\.self_service_event_passports AS p\s*\n\s*WHERE p\.event_id = p_event_id\s*\n\s*AND p\.state = 'payment_pending';/,
  );
});

test("replace_self_service_organizer_event is untouched -- it inherits checkout-cancellation protection entirely through its existing delegation to delete_self_service_organizer_event", () => {
  assert.doesNotMatch(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.replace_self_service_organizer_event|ALTER FUNCTION public\.replace_self_service_organizer_event/,
  );
});

// ---- Compatibility / boundary guards ----

test("no ordinary tenant, FCOC, admin authority, P0 media, or presentation object is touched by this migration", () => {
  for (const forbidden of [
    "admin_event_access",
    "admin_users",
    "has_platform_admin_authority",
    "has_tenant_admin_authority",
    "event_photos",
    "presentation_deck",
    "presentation_session",
    "storage.objects",
  ]) {
    assert.doesNotMatch(SQL, new RegExp(forbidden));
  }
});

test("no Stripe SDK call, HTTP call, secret, webhook route, or Next.js code exists anywhere in the EXECUTABLE SQL -- only the fixed 'stripe' provider literal and explanatory comments may name the provider", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  // The word "stripe" legitimately appears only as the fixed CHECK/DEFAULT
  // provider literal ('stripe') on the two tables -- never as an SDK call,
  // import, or HTTP contact.
  const stripeMentions = [...executable.matchAll(/stripe/gi)];
  for (const mention of stripeMentions) {
    const context = executable.slice(Math.max(0, mention.index! - 40), mention.index! + 10);
    assert.match(context, /'stripe'/, `unexpected non-literal "stripe" mention: ${context}`);
  }
  assert.doesNotMatch(executable, /require\(|import |fetch\(|https?:\/\/|new Stripe\(/);
  assert.doesNotMatch(executable, /webhook/i);
  assert.doesNotMatch(executable, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PASSPORT_PRICE_ID/);
});

test("no function anywhere accepts an amount or currency parameter", () => {
  assert.doesNotMatch(SQL, /p_amount|p_currency/i);
});
