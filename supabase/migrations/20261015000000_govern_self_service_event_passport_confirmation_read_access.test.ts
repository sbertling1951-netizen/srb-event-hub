import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261015000000_govern_self_service_event_passport_confirmation_read_access.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261015000000_govern_self_service_event_passport_confirmation_read_access.sql",
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

const READER_FN = functionBody("get_my_self_service_event_passport_confirmation");

test("the migration is one transaction defining exactly the one documented reader", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
  assert.equal((SQL.match(/^CREATE OR REPLACE FUNCTION public\./gm) ?? []).length, 1);
});

test("no new table, policy, table grant, or seed row is created anywhere in this migration", () => {
  assert.doesNotMatch(SQL, /CREATE TABLE/);
  assert.doesNotMatch(SQL, /CREATE POLICY/);
  assert.doesNotMatch(SQL, /GRANT.*ON TABLE/);
  assert.doesNotMatch(SQL, /REVOKE.*ON TABLE/);
  assert.doesNotMatch(SQL, /^\s*INSERT INTO/m);
});

test("no existing reader or writer function is restated -- every prior Passport function is completely untouched", () => {
  for (const name of [
    "get_my_self_service_event_passport_checkout_attempt",
    "get_self_service_event_passport_checkout_attempt_for_server",
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

test("the new reader mutates no attempt, Passport, or receipt state", () => {
  for (const table of [
    "self_service_event_passport_payment_attempts",
    "self_service_event_passports",
    "self_service_event_passport_payment_receipt_audit",
  ]) {
    assert.doesNotMatch(SQL, new RegExp(`INSERT INTO public\\.${table}`));
    assert.doesNotMatch(SQL, new RegExp(`UPDATE public\\.${table}`));
    assert.doesNotMatch(SQL, new RegExp(`DELETE FROM public\\.${table}`));
  }
  // it also never SELECTs the tables directly -- confirmation is derived
  // entirely through the existing is_self_service_event_passport_preserved
  // predicate.
  assert.doesNotMatch(
    READER_FN,
    /FROM public\.self_service_event_passports|FROM public\.self_service_event_passport_payment_attempts/,
  );
});

test("the reader resolves identity through the SAME resolve_auth_person_link rules as the existing owner reader, and fails closed to 'Event not found.' for any other link status", () => {
  assert.match(
    READER_FN,
    /SELECT link\.status, link\.person_id\s*\n\s*INTO v_link_status, v_person_id\s*\n\s*FROM public\.resolve_auth_person_link\(v_actor\) AS link;/,
  );
  assert.match(
    READER_FN,
    /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
});

test("the reader proves ownership through the same appointment/draft/tenant join shape used throughout this family", () => {
  assert.match(
    READER_FN,
    /WHERE d\.event_id = p_event_id\s*\n\s*AND oa\.is_active = true\s*\n\s*AND \(\s*\n\s*\(v_link_status = 'resolved' AND oa\.person_id = v_person_id\)\s*\n\s*OR \(v_link_status = 'no_link' AND oa\.auth_user_id = v_actor\)\s*\n\s*\)\s*\n\s*AND t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false\s*\n\s*LIMIT 1;/,
  );
  assert.match(
    READER_FN,
    /IF v_appointment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
});

test("the reader's ownership predicate deliberately does NOT exclude a Passport-preserved Event -- a reserved Event must still read safely", () => {
  const ownershipBlock = READER_FN.slice(
    READER_FN.indexOf("SELECT oa.id"),
    READER_FN.indexOf("IF v_appointment_id IS NULL"),
  );
  assert.doesNotMatch(ownershipBlock, /is_self_service_event_passport_preserved/);
});

test("confirmation itself is computed via the existing is_self_service_event_passport_preserved predicate -- never a new ad hoc state check", () => {
  assert.match(
    READER_FN,
    /IF public\.is_self_service_event_passport_preserved\(p_event_id\) THEN\s*\n\s*RETURN QUERY SELECT 'confirmed'::text;\s*\n\s*RETURN;\s*\n\s*END IF;/,
  );
  assert.match(READER_FN, /RETURN QUERY SELECT 'not_confirmed'::text;/);
});

test("the reader returns only the single documented outcome column -- never a Passport row, timestamp, or identifier", () => {
  assert.match(READER_FN, /RETURNS TABLE\(\s*\n\s*outcome text\s*\n\)/);
  assert.doesNotMatch(READER_FN, /provider_session_id|paid_at|active_period|attempt_id|event_id text/);
  const returns = [...READER_FN.matchAll(/RETURN QUERY SELECT[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(returns.length, 2, "expected exactly two RETURN QUERY projections");
  for (const projection of returns) {
    assert.doesNotMatch(projection, /organizer_person_id|v_appointment_id|paid_at/);
  }
});

test("the reader is authenticated-only -- never anon, never service_role, never PUBLIC", () => {
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.get_my_self_service_event_passport_confirmation\(uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.get_my_self_service_event_passport_confirmation\(uuid\)\s*\n\s*TO authenticated;/,
  );
});

test("the reader is SECURITY DEFINER with a fixed pg_catalog search_path and postgres ownership", () => {
  assert.match(READER_FN, /SECURITY DEFINER/);
  assert.match(READER_FN, /SET search_path TO 'pg_catalog'/);
  assert.match(
    SQL,
    /ALTER FUNCTION public\.get_my_self_service_event_passport_confirmation\(uuid\)\s*\n\s*OWNER TO postgres;/,
  );
});

test("no Stripe SDK call, HTTP call, secret, or webhook route exists anywhere in the EXECUTABLE SQL", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  assert.doesNotMatch(executable, /stripe/i);
  assert.doesNotMatch(executable, /webhook/i);
  assert.doesNotMatch(executable, /require\(|import |fetch\(|https?:\/\//);
  assert.doesNotMatch(executable, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PASSPORT_PRICE_ID/);
});
