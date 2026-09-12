import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261017000000_govern_self_service_event_passport_refund_request_authority.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261017000000_govern_self_service_event_passport_refund_request_authority.sql",
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

const TABLE_START = SQL.indexOf(
  "CREATE TABLE public.self_service_event_passport_refund_requests",
);
const TABLE_END = SQL.indexOf(");", TABLE_START) + 2;
const TABLE_DDL = SQL.slice(TABLE_START, TABLE_END);

const PREPARE_FN = functionBody("prepare_self_service_event_passport_refund_request");
const SERVER_READER_FN = functionBody("get_self_service_event_passport_refund_request_for_server");

// ---------------------------------------------------------------------------
// Migration shape
// ---------------------------------------------------------------------------

test("the migration is one transaction defining exactly one table and two functions, in order", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
  assert.equal((SQL.match(/^CREATE TABLE /gm) ?? []).length, 1);
  assert.match(
    SQL,
    /^CREATE TABLE public\.self_service_event_passport_refund_requests/m,
  );
  const order = [
    "prepare_self_service_event_passport_refund_request",
    "get_self_service_event_passport_refund_request_for_server",
  ].map((name) => SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`));
  for (const idx of order) {
    assert.notEqual(idx, -1);
  }
  assert.ok(order[0] < order[1], "expected the documented function order");
  assert.equal((SQL.match(/^CREATE OR REPLACE FUNCTION public\./gm) ?? []).length, 2);
});

test("no CREATE POLICY anywhere", () => {
  assert.doesNotMatch(SQL, /CREATE POLICY/);
});

test("zero top-level INSERT/UPDATE/DELETE -- every mutation-shaped statement lives inside a function body", () => {
  const withoutFunctionBodies = SQL.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert.doesNotMatch(withoutFunctionBodies, /^\s*INSERT INTO/m);
  assert.doesNotMatch(withoutFunctionBodies, /^\s*UPDATE\s/m);
  assert.doesNotMatch(withoutFunctionBodies, /^\s*DELETE FROM/m);
});

test("no existing function from this family is restated -- every prior writer/reader is byte-untouched", () => {
  for (const name of [
    "prepare_self_service_event_passport_checkout_attempt",
    "bind_self_service_event_passport_checkout_session",
    "record_self_service_event_passport_checkout_terminal_state",
    "confirm_self_service_event_passport_payment",
    "get_my_self_service_event_passport_checkout_attempt",
    "get_self_service_event_passport_checkout_attempt_for_server",
    "get_my_self_service_event_passport_confirmation",
    "is_self_service_event_passport_preserved",
    "delete_self_service_organizer_event",
    "replace_self_service_organizer_event",
    "has_platform_admin_authority",
  ]) {
    assert.doesNotMatch(
      SQL,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}|ALTER FUNCTION public\\.${name}`),
    );
  }
});

test("no Stripe SDK call, HTTP call, secret, or webhook route exists anywhere in the EXECUTABLE SQL -- this table has no provider literal at all", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  assert.doesNotMatch(executable, /stripe/i);
  assert.doesNotMatch(executable, /webhook/i);
  assert.doesNotMatch(executable, /require\(|import |fetch\(|https?:\/\//);
  assert.doesNotMatch(executable, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PASSPORT_PRICE_ID/);
});

test("no application data outside this new table/function pair is written -- neither the Passport table, an Event, receipt/audit, nor refund/audit table is ever mutated", () => {
  assert.doesNotMatch(SQL, /UPDATE public\.self_service_event_passports/);
  assert.doesNotMatch(SQL, /DELETE FROM public\.events\b/);
  assert.doesNotMatch(SQL, /INSERT INTO public\.self_service_event_passport_payment_receipt_audit/);
  assert.doesNotMatch(SQL, /INSERT INTO public\.self_service_event_passport_refund_audit\b/);
});

// ---------------------------------------------------------------------------
// 1. Refund-request table
// ---------------------------------------------------------------------------

test("event_id is a plain, NON-foreign-key reference -- survives the Event's later ordinary deletion untouched", () => {
  const eventIdLine = TABLE_DDL.slice(
    TABLE_DDL.indexOf("event_id uuid NOT NULL,"),
    TABLE_DDL.indexOf("event_id uuid NOT NULL,") + 40,
  );
  assert.match(eventIdLine, /^event_id uuid NOT NULL,$/m);
  assert.doesNotMatch(eventIdLine, /REFERENCES/);
});

test("receipt_audit_id is a real FK to the permanent receipt/audit row, RESTRICT", () => {
  assert.match(
    TABLE_DDL,
    /receipt_audit_id uuid NOT NULL\s*\n\s*REFERENCES public\.self_service_event_passport_payment_receipt_audit\(id\) ON DELETE RESTRICT,/,
  );
});

test("initiated_by_auth_user_id is a real FK to the initiating admin's own durable auth account, RESTRICT", () => {
  assert.match(
    TABLE_DDL,
    /initiated_by_auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT,/,
  );
});

test("state is a single-value CHECK for this slice -- 'requested' only, no other terminal value invented here", () => {
  assert.match(
    TABLE_DDL,
    /state text NOT NULL DEFAULT 'requested' CHECK \(state = 'requested'\),/,
  );
});

test("no free-text reason/note column, and no customer/Stripe session field, exists on this table", () => {
  assert.doesNotMatch(TABLE_DDL, /reason|note|comment/i);
  assert.doesNotMatch(TABLE_DDL, /provider_session_id|provider_event_id|customer/i);
});

test("caller idempotency is a real UNIQUE constraint on (initiated_by_auth_user_id, idempotency_key)", () => {
  assert.match(
    TABLE_DDL,
    /CONSTRAINT self_service_event_passport_refund_requests_actor_key_unique\s*\n\s*UNIQUE \(initiated_by_auth_user_id, idempotency_key\)/,
  );
});

test("at most one still-actionable request per original receipt is a real partial UNIQUE INDEX, not merely application logic", () => {
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX self_service_event_passport_refund_requests_one_actionable_idx\s*\n\s*ON public\.self_service_event_passport_refund_requests \(receipt_audit_id\)\s*\n\s*WHERE state = 'requested';/,
  );
});

test("RLS is enabled with every grant revoked from PUBLIC/anon/authenticated/service_role -- no policy, no direct table grant to any role", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passport_refund_requests ENABLE ROW LEVEL SECURITY;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_event_passport_refund_requests\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(SQL, /GRANT[\s\S]{0,40}ON TABLE public\.self_service_event_passport_refund_requests/);
});

test("no immutability trigger exists on this table -- unlike the receipt/audit and refund/audit tables, this is a working pre-provider lifecycle record", () => {
  assert.doesNotMatch(SQL, /CREATE TRIGGER[\s\S]{0,200}self_service_event_passport_refund_requests/);
  assert.doesNotMatch(SQL, /self_service_event_passport_refund_requests_immut/);
});

// ---------------------------------------------------------------------------
// 2. prepare_self_service_event_passport_refund_request
// ---------------------------------------------------------------------------

test("the prepare command checks Platform Administrator authority through the established global predicate, never a re-implemented inline check", () => {
  assert.match(PREPARE_FN, /IF NOT public\.has_platform_admin_authority\(v_actor\) THEN\s*\n\s*RAISE EXCEPTION/);
  assert.doesNotMatch(PREPARE_FN, /admin_users AS au/);
  assert.doesNotMatch(PREPARE_FN, /privilege_group = 'super_admin'/);
});

test("the private-draft carve-out predicate matches the family's established structural shape, with NO ownership/person-link predicate", () => {
  assert.match(
    PREPARE_FN,
    /FROM public\.events AS e\s*\n\s*JOIN public\.tenants AS t ON t\.id = e\.tenant_id\s*\n\s*WHERE e\.id = p_event_id\s*\n\s*AND t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false;/,
  );
  assert.doesNotMatch(PREPARE_FN, /resolve_auth_person_link/);
  assert.doesNotMatch(PREPARE_FN, /organizer_appointment/i);
  assert.doesNotMatch(PREPARE_FN, /self_service_private_event_drafts/);
});

test("only a reserved, pre-launch Passport is eligible -- checked with IS DISTINCT FROM so a missing Passport row (NULL) also fails closed", () => {
  assert.match(
    PREPARE_FN,
    /SELECT p\.state\s*\n\s*INTO v_passport_state\s*\n\s*FROM public\.self_service_event_passports AS p\s*\n\s*WHERE p\.event_id = p_event_id\s*\n\s*FOR UPDATE;/,
  );
  assert.match(
    PREPARE_FN,
    /IF v_passport_state IS DISTINCT FROM 'reserved' THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
});

test("exactly one receipt/audit row is required -- STRICT rejects both zero and multiple matches, mapped to the same non-enumerating outcome", () => {
  assert.match(
    PREPARE_FN,
    /SELECT r\.id INTO STRICT v_receipt_id\s*\n\s*FROM public\.self_service_event_passport_payment_receipt_audit AS r\s*\n\s*WHERE r\.event_id = p_event_id;/,
  );
  assert.match(
    PREPARE_FN,
    /EXCEPTION\s*\n\s*WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
});

test("every ineligibility path raises the SAME non-enumerating 'Event not found.' -- no distinct message discloses which check failed", () => {
  const eventNotFoundCount = [...PREPARE_FN.matchAll(/RAISE EXCEPTION 'Event not found\.';/g)].length;
  assert.equal(eventNotFoundCount, 3, "expected exactly three non-enumerating denial points: private-draft carve-out, Passport state, receipt count");
});

test("idempotency replay returns 'requested' for the SAME caller+key, and raises on a conflicting event id for the SAME key", () => {
  assert.match(
    PREPARE_FN,
    /IF v_existing\.event_id <> p_event_id THEN\s*\n\s*RAISE EXCEPTION 'Idempotency key was already used to request a refund for a different event\.';/,
  );
  assert.match(
    PREPARE_FN,
    /RETURN QUERY SELECT\s*\n\s*'requested'::text, v_existing\.id, v_existing\.event_id, v_existing\.state, v_existing\.created_at;\s*\n\s*RETURN;/,
  );
});

test("a still-actionable request for the same receipt is reported as 'refund_already_requested', both on the pre-check and on a genuine unique_violation race", () => {
  const outcomeMatches = [...PREPARE_FN.matchAll(/'refund_already_requested'::text/g)];
  assert.equal(outcomeMatches.length, 2, "expected the pre-check branch and the race/exception branch");
  assert.match(PREPARE_FN, /EXCEPTION WHEN unique_violation THEN/);
});

test("the prepare command never mutates the Passport table, never deletes an Event, never writes a receipt/audit or refund/audit row, and never contacts Stripe", () => {
  assert.doesNotMatch(PREPARE_FN, /UPDATE public\.self_service_event_passports/);
  assert.doesNotMatch(PREPARE_FN, /DELETE FROM public\.events/);
  assert.doesNotMatch(PREPARE_FN, /INSERT INTO public\.self_service_event_passport_payment_receipt_audit/);
  assert.doesNotMatch(PREPARE_FN, /INSERT INTO public\.self_service_event_passport_refund_audit\b/);
  // "stripe" appears only in explanatory comments (e.g. "provider='stripe'
  // need no runtime re-check") -- never a call, import, or executable
  // reference.
  assert.doesNotMatch(PREPARE_FN.replace(/--.*$/gm, ""), /stripe/i);
});

test("the prepare command returns only the minimal documented columns -- never a receipt field, Stripe id, or other Event's data", () => {
  assert.match(
    PREPARE_FN,
    /RETURNS TABLE\(\s*\n\s*outcome text,\s*\n\s*request_id uuid,\s*\n\s*event_id uuid,\s*\n\s*state text,\s*\n\s*created_at timestamptz\s*\n\)/,
  );
  const returns = [...PREPARE_FN.matchAll(/RETURN QUERY SELECT[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(returns.length, 4, "expected exactly four RETURN QUERY projections: replay, already-requested pre-check, race, and the final success path");
  for (const projection of returns) {
    assert.doesNotMatch(projection, /receipt_audit_id|initiated_by_auth_user_id|idempotency_key/);
  }
});

test("the prepare command is SECURITY DEFINER with a fixed pg_catalog search_path, owner postgres, granted only to authenticated", () => {
  assert.match(PREPARE_FN, /SECURITY DEFINER/);
  assert.match(PREPARE_FN, /SET search_path TO 'pg_catalog'/);
  assert.match(
    SQL,
    /ALTER FUNCTION public\.prepare_self_service_event_passport_refund_request\(uuid, uuid\)\s*\n\s*OWNER TO postgres;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.prepare_self_service_event_passport_refund_request\(uuid, uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.prepare_self_service_event_passport_refund_request\(uuid, uuid\)\s*\n\s*TO authenticated;/,
  );
});

// ---------------------------------------------------------------------------
// 3. get_self_service_event_passport_refund_request_for_server
// ---------------------------------------------------------------------------

test("the server reader returns only request_id, event_id, receipt_audit_id, state -- a plain read with no extra validation logic of its own", () => {
  assert.match(
    SERVER_READER_FN,
    /RETURNS TABLE\(\s*\n\s*request_id uuid,\s*\n\s*event_id uuid,\s*\n\s*receipt_audit_id uuid,\s*\n\s*state text\s*\n\)/,
  );
  assert.match(
    SERVER_READER_FN,
    /SELECT r\.id, r\.event_id, r\.receipt_audit_id, r\.state\s*\n\s*FROM public\.self_service_event_passport_refund_requests AS r\s*\n\s*WHERE r\.id = p_request_id;/,
  );
  assert.doesNotMatch(SERVER_READER_FN, /IF|CASE|RAISE/);
});

test("the server reader never returns the initiating admin's identity, a timestamp, or any receipt/session/provider field", () => {
  assert.doesNotMatch(SERVER_READER_FN, /initiated_by_auth_user_id|idempotency_key|created_at|updated_at/);
});

test("the server reader is service_role-only -- never anon, never authenticated, never PUBLIC", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.get_self_service_event_passport_refund_request_for_server\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.get_self_service_event_passport_refund_request_for_server\(uuid\)\s*\n\s*TO service_role;/,
  );
});

test("both functions are SECURITY DEFINER with a fixed pg_catalog search_path and postgres ownership", () => {
  for (const fn of [PREPARE_FN, SERVER_READER_FN]) {
    assert.match(fn, /SECURITY DEFINER/);
    assert.match(fn, /SET search_path TO 'pg_catalog'/);
  }
  assert.match(
    SQL,
    /ALTER FUNCTION public\.get_self_service_event_passport_refund_request_for_server\(uuid\)\s*\n\s*OWNER TO postgres;/,
  );
});
