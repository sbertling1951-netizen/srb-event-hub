import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261014000000_govern_self_service_event_passport_checkout_access.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261014000000_govern_self_service_event_passport_checkout_access.sql",
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

const OWNER_READER_FN = functionBody("get_my_self_service_event_passport_checkout_attempt");
const SERVER_READER_FN = functionBody("get_self_service_event_passport_checkout_attempt_for_server");

test("the migration is one transaction defining exactly the two documented readers, in order", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
  const order = [
    "get_my_self_service_event_passport_checkout_attempt",
    "get_self_service_event_passport_checkout_attempt_for_server",
  ].map((name) => SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`));
  for (const idx of order) {
    assert.notEqual(idx, -1);
  }
  assert.ok(order[0] < order[1], "expected the documented function order");
  assert.equal((SQL.match(/^CREATE OR REPLACE FUNCTION public\./gm) ?? []).length, 2);
});

test("no new table, policy, table grant, or seed row is created anywhere in this migration", () => {
  assert.doesNotMatch(SQL, /CREATE TABLE/);
  assert.doesNotMatch(SQL, /CREATE POLICY/);
  assert.doesNotMatch(SQL, /GRANT.*ON TABLE/);
  assert.doesNotMatch(SQL, /REVOKE.*ON TABLE/);
  assert.doesNotMatch(SQL, /^\s*INSERT INTO/m);
});

test("no existing writer function is restated -- prepare/bind/terminal-state/confirm/delete/replace are all untouched", () => {
  for (const name of [
    "prepare_self_service_event_passport_checkout_attempt",
    "bind_self_service_event_passport_checkout_session",
    "record_self_service_event_passport_checkout_terminal_state",
    "confirm_self_service_event_passport_payment",
    "delete_self_service_organizer_event",
    "replace_self_service_organizer_event",
  ]) {
    assert.doesNotMatch(
      SQL,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}|ALTER FUNCTION public\\.${name}`),
    );
  }
});

test("neither reader mutates attempt, Passport, or receipt state", () => {
  for (const table of [
    "self_service_event_passport_payment_attempts",
    "self_service_event_passports",
    "self_service_event_passport_payment_receipt_audit",
  ]) {
    assert.doesNotMatch(SQL, new RegExp(`INSERT INTO public\\.${table}`));
    assert.doesNotMatch(SQL, new RegExp(`UPDATE public\\.${table}`));
    assert.doesNotMatch(SQL, new RegExp(`DELETE FROM public\\.${table}`));
  }
});

// ---- Owner reader ----

test("the owner reader resolves identity through the SAME resolve_auth_person_link rules as prepare, and fails closed to 'Event not found.' for any other link status", () => {
  assert.match(
    OWNER_READER_FN,
    /SELECT link\.status, link\.person_id\s*\n\s*INTO v_link_status, v_person_id\s*\n\s*FROM public\.resolve_auth_person_link\(v_actor\) AS link;/,
  );
  assert.match(
    OWNER_READER_FN,
    /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
});

test("the owner reader proves ownership through the same appointment/draft/tenant join shape used throughout this family", () => {
  assert.match(
    OWNER_READER_FN,
    /WHERE d\.event_id = p_event_id\s*\n\s*AND oa\.is_active = true\s*\n\s*AND \(\s*\n\s*\(v_link_status = 'resolved' AND oa\.person_id = v_person_id\)\s*\n\s*OR \(v_link_status = 'no_link' AND oa\.auth_user_id = v_actor\)\s*\n\s*\)\s*\n\s*AND t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false\s*\n\s*LIMIT 1;/,
  );
  assert.match(
    OWNER_READER_FN,
    /IF v_appointment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
});

test("the owner reader's ownership predicate deliberately does NOT exclude a Passport-preserved Event -- a reserved Event must still read safely", () => {
  assert.doesNotMatch(OWNER_READER_FN, /is_self_service_event_passport_preserved/);
});

test("the owner reader returns only the minimal documented columns -- never provider_session_id, receipt data, tenant/appointment ids, or Passport timestamps", () => {
  assert.match(
    OWNER_READER_FN,
    /RETURNS TABLE\(\s*\n\s*outcome text,\s*\n\s*attempt_id uuid,\s*\n\s*event_id uuid,\s*\n\s*state text,\s*\n\s*provider text,\s*\n\s*created_at timestamptz\s*\n\)/,
  );
  assert.doesNotMatch(OWNER_READER_FN, /provider_session_id/);
  // the ownership JOIN legitimately references oa.tenant_id internally; only
  // the RETURN QUERY projections matter for "what is returned to the caller"
  const returns = [...OWNER_READER_FN.matchAll(/RETURN QUERY SELECT[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(returns.length, 2, "expected exactly two RETURN QUERY projections");
  for (const projection of returns) {
    assert.doesNotMatch(projection, /organizer_person_id|paid_at|active_period|v_appointment_id/);
  }
});

test("the owner reader returns the caller-safe 'no_open_attempt' outcome (never a raised exception) when the caller's own eligible Event has no preparing/open attempt", () => {
  assert.match(
    OWNER_READER_FN,
    /IF NOT FOUND THEN\s*\n\s*RETURN QUERY SELECT\s*\n\s*'no_open_attempt'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;\s*\n\s*RETURN;\s*\n\s*END IF;/,
  );
});

test("the owner reader is authenticated-only -- never anon, never service_role, never PUBLIC", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.get_my_self_service_event_passport_checkout_attempt\(uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.get_my_self_service_event_passport_checkout_attempt\(uuid\)\s*\n\s*TO authenticated;/,
  );
});

// ---- Server-only reader ----

test("the server reader returns only attempt_id, event_id, state, provider, provider_session_id -- a plain read with no extra validation logic of its own", () => {
  assert.match(
    SERVER_READER_FN,
    /RETURNS TABLE\(\s*\n\s*attempt_id uuid,\s*\n\s*event_id uuid,\s*\n\s*state text,\s*\n\s*provider text,\s*\n\s*provider_session_id text\s*\n\)/,
  );
  assert.match(
    SERVER_READER_FN,
    /SELECT a\.id, a\.event_id, a\.state, a\.provider, a\.provider_session_id\s*\n\s*FROM public\.self_service_event_passport_payment_attempts AS a\s*\n\s*WHERE a\.id = p_attempt_id;/,
  );
  assert.doesNotMatch(SERVER_READER_FN, /IF|CASE|RAISE/);
});

test("the server reader is service_role-only -- never anon, never authenticated, never PUBLIC", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.get_self_service_event_passport_checkout_attempt_for_server\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.get_self_service_event_passport_checkout_attempt_for_server\(uuid\)\s*\n\s*TO service_role;/,
  );
});

// ---- Shared posture ----

test("both readers are SECURITY DEFINER with a fixed pg_catalog search_path and postgres ownership", () => {
  for (const fn of [OWNER_READER_FN, SERVER_READER_FN]) {
    assert.match(fn, /SECURITY DEFINER/);
    assert.match(fn, /SET search_path TO 'pg_catalog'/);
  }
  assert.match(
    SQL,
    /ALTER FUNCTION public\.get_my_self_service_event_passport_checkout_attempt\(uuid\)\s*\n\s*OWNER TO postgres;/,
  );
  assert.match(
    SQL,
    /ALTER FUNCTION public\.get_self_service_event_passport_checkout_attempt_for_server\(uuid\)\s*\n\s*OWNER TO postgres;/,
  );
});

test("no Stripe SDK call, HTTP call, secret, or webhook route exists anywhere in the EXECUTABLE SQL", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  assert.doesNotMatch(executable, /stripe/i);
  assert.doesNotMatch(executable, /webhook/i);
  assert.doesNotMatch(executable, /require\(|import |fetch\(|https?:\/\//);
  assert.doesNotMatch(executable, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PASSPORT_PRICE_ID/);
});
