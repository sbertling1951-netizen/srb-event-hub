import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261012000000_create_self_service_event_passport_entitlement_foundation.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261012000000_create_self_service_event_passport_entitlement_foundation.sql",
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

const PRESERVED_FN = functionBody("is_self_service_event_passport_preserved");
const CAPACITY_FN = functionBody("get_my_self_service_organizer_capacity");
const DRAFT_FN = functionBody("create_self_service_organizer_draft");
const EVENT_FN = functionBody("create_self_service_organizer_event");
const DELETE_FN = functionBody("delete_self_service_organizer_event");

test("the migration is one transaction defining exactly the five expected functions, in order", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
  const order = [
    "is_self_service_event_passport_preserved",
    "get_my_self_service_organizer_capacity",
    "create_self_service_organizer_draft",
    "create_self_service_organizer_event",
    "delete_self_service_organizer_event",
  ].map((name) => SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`));
  for (const idx of order) {
    assert.notEqual(idx, -1);
  }
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], "expected the documented function order");
  }
  assert.equal(
    (SQL.match(/^CREATE OR REPLACE FUNCTION public\./gm) ?? []).length,
    5,
  );
  // replace_self_service_organizer_event is deliberately NOT restated --
  // it inherits the delete eligibility fix by delegation.
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.replace_self_service_organizer_event/);
});

// ---- The independent entitlement table ----

test("self_service_event_passports is an independent record -- never derived from events.status/is_active/visible_to_members/lifecycle_state", () => {
  assert.match(SQL, /CREATE TABLE public\.self_service_event_passports/);
  const tableIdx = SQL.indexOf("CREATE TABLE public.self_service_event_passports");
  const tableEnd = SQL.indexOf(");", tableIdx) + 2;
  const tableBody = SQL.slice(tableIdx, tableEnd);
  assert.doesNotMatch(tableBody, /events\.status|events\.is_active|events\.visible_to_members|lifecycle_state/);
  assert.match(tableBody, /event_id uuid PRIMARY KEY REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
});

test("the entitlement table holds ONLY the fields the accepted contract requires -- no Stripe id, secret, receipt content, checkout URL, tax data, refund, launch, or renewal field", () => {
  const tableIdx = SQL.indexOf("CREATE TABLE public.self_service_event_passports");
  const tableEnd = SQL.indexOf(");", tableIdx) + 2;
  const tableBody = SQL.slice(tableIdx, tableEnd);
  assert.match(tableBody, /event_id uuid PRIMARY KEY/);
  assert.match(tableBody, /state text NOT NULL CHECK \(state IN \('payment_pending', 'reserved', 'active', 'expired'\)\)/);
  assert.match(tableBody, /paid_at timestamptz/);
  assert.match(tableBody, /active_period_started_at timestamptz/);
  assert.match(tableBody, /active_period_ends_at timestamptz/);
  assert.match(tableBody, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(tableBody, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  for (const forbidden of [
    "stripe",
    "customer_id",
    "session_id",
    "payment_intent",
    "secret",
    "receipt",
    "checkout_url",
    "tax",
    "refund",
    "launched_by",
    "renewal",
    "renew",
    "amount",
    "currency",
    "card",
  ]) {
    assert.doesNotMatch(tableBody.toLowerCase(), new RegExp(forbidden));
  }
});

test("exactly the four required states are modeled -- no launch/renewal-specific state invented", () => {
  assert.match(
    SQL,
    /state IN \('payment_pending', 'reserved', 'active', 'expired'\)/,
  );
  assert.equal(
    (SQL.match(/'payment_pending'|'reserved'(?!_)|'active'(?!_)|'expired'/g) ?? []).length >= 4,
    true,
  );
});

test("the active-period and paid-at timestamps are constrained to agree with state -- the 12-month clock cannot start before launch, and payment-confirmation cannot be set for a pending checkout", () => {
  assert.match(
    SQL,
    /CONSTRAINT self_service_event_passports_paid_at_agrees_with_state CHECK \(\s*\n\s*\(state = 'payment_pending' AND paid_at IS NULL\)\s*\n\s*OR \(state IN \('reserved', 'active', 'expired'\) AND paid_at IS NOT NULL\)\s*\n\s*\)/,
  );
  assert.match(
    SQL,
    /CONSTRAINT self_service_event_passports_active_period_agrees_with_state CHECK \(\s*\n\s*\(state IN \('payment_pending', 'reserved'\) AND active_period_started_at IS NULL AND active_period_ends_at IS NULL\)\s*\n\s*OR \(state IN \('active', 'expired'\) AND active_period_started_at IS NOT NULL AND active_period_ends_at IS NOT NULL\)\s*\n\s*\)/,
  );
});

test("the entitlement table is completely browser-inaccessible -- RLS enabled, every grant revoked from every role, no policy", () => {
  assert.match(SQL, /ALTER TABLE public\.self_service_event_passports ENABLE ROW LEVEL SECURITY;/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_event_passports\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(SQL, /CREATE POLICY.*self_service_event_passports/);
  assert.doesNotMatch(SQL, /GRANT.*ON TABLE public\.self_service_event_passports/);
});

test("no governed RPC in this slice creates or transitions a Passport row -- creation/transition still belongs to the Stripe-checkout-and-webhook slice; Lun's correction adds exactly one narrowly state-scoped payment_pending cleanup DELETE, never an INSERT or UPDATE", () => {
  assert.doesNotMatch(SQL, /INSERT INTO public\.self_service_event_passports/);
  assert.doesNotMatch(SQL, /UPDATE public\.self_service_event_passports/);
  const deletes = [...SQL.matchAll(/DELETE FROM public\.self_service_event_passports\b[^;]*;/g)];
  assert.equal(deletes.length, 1, "expected exactly one DELETE against self_service_event_passports in the whole migration");
  assert.match(deletes[0][0], /AND p\.state = 'payment_pending';/);
});

// ---- The internal preservation predicate ----

test("is_self_service_event_passport_preserved is SECURITY DEFINER, STABLE, and grants EXECUTE to no role -- purely internal, nested-call-only", () => {
  assert.match(PRESERVED_FN, /SECURITY DEFINER/);
  assert.match(PRESERVED_FN, /STABLE/);
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.is_self_service_event_passport_preserved\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(SQL, /GRANT EXECUTE ON FUNCTION public\.is_self_service_event_passport_preserved/);
});

test("preserved means exactly reserved/active/expired -- payment_pending and no-row both resolve to NOT preserved", () => {
  assert.match(PRESERVED_FN, /p\.state IN \('reserved', 'active', 'expired'\)/);
  assert.doesNotMatch(PRESERVED_FN, /'payment_pending'/);
});

// ---- Capacity: three call sites updated consistently ----

test("get_my_self_service_organizer_capacity excludes Passport-preserved Events from its count", () => {
  assert.match(
    CAPACITY_FN,
    /AND e\.visible_to_members = false\s*\n\s*AND NOT public\.is_self_service_event_passport_preserved\(e\.id\);/,
  );
});

test("create_self_service_organizer_draft excludes Passport-preserved Events from BOTH the capacity count and the blocking-Event row-fetch", () => {
  const occurrences = [...DRAFT_FN.matchAll(/AND NOT public\.is_self_service_event_passport_preserved\(cap_e\.id\)/g)];
  assert.equal(occurrences.length, 2, "expected the exclusion in both the count query and the row-fetch query");
});

test("create_self_service_organizer_event excludes Passport-preserved Events from BOTH the capacity count and the blocking-Event row-fetch", () => {
  const occurrences = [...EVENT_FN.matchAll(/AND NOT public\.is_self_service_event_passport_preserved\(cap_e\.id\)/g)];
  assert.equal(occurrences.length, 2, "expected the exclusion in both the count query and the row-fetch query");
});

test("the active_event_exists outcome still never projects organizer_person_id or the forbidden internal fields (Lun's correction is preserved unchanged)", () => {
  for (const fn of [DRAFT_FN, EVENT_FN]) {
    const idx = fn.indexOf("'active_event_exists'::text");
    assert.notEqual(idx, -1);
    assert.match(fn.slice(idx, idx + 200), /NULL::uuid, NULL::uuid, NULL::uuid, cap_e\.id/);
  }
});

// ---- Delete/Replace eligibility ----

test("delete_self_service_organizer_event's ownership/eligibility query excludes Passport-preserved Events -- exactly one added predicate, same LIMIT 1 shape", () => {
  assert.match(
    DELETE_FN,
    /AND e\.visible_to_members = false\s*\n\s*AND NOT public\.is_self_service_event_passport_preserved\(e\.id\)\s*\n\s*LIMIT 1;/,
  );
});

test("a Passport-preserved Event is rejected with the SAME non-enumerating 'Event not found.' as a foreign/non-Draft Event -- no new message, no refund/cancellation side effect", () => {
  assert.match(DELETE_FN, /IF v_appointment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/);
  // Lun's correction: the freshly-locked recheck raises the SAME message.
  assert.match(
    DELETE_FN,
    /IF v_passport_state IN \('reserved', 'active', 'expired'\) THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
  // Strip the legitimate Passport-lock-and-cleanup block (the shared
  // predicate call, the lock/recheck, and the state-scoped cleanup with its
  // own internal fail-closed invariant message) before checking for any
  // OTHER "passport" mention -- one that would indicate a DISTINCT,
  // disclosing error message or side effect anywhere outside this
  // narrowly-scoped, separately-verified block.
  const lunBlockStart = DELETE_FN.indexOf("-- Lun's correction: lock and recheck");
  const lunBlockEnd = DELETE_FN.indexOf("-- Was this the last event in its private tenant?");
  assert.notEqual(lunBlockStart, -1, "expected the Lun's-correction block to be present");
  assert.notEqual(lunBlockEnd, -1, "expected the pre-existing tenant-scope comment to still follow it");
  assert.ok(lunBlockStart < lunBlockEnd);
  const withoutPredicateCallOrLunBlock = (
    DELETE_FN.slice(0, lunBlockStart) + DELETE_FN.slice(lunBlockEnd)
  )
    .replace(/public\.is_self_service_event_passport_preserved\(e\.id\)/g, "")
    // the declared variable name itself (used only inside the stripped
    // block) legitimately contains "passport" -- not a distinct message
    .replace(/v_passport_state/g, "");
  assert.doesNotMatch(withoutPredicateCallOrLunBlock, /passport/i);
  // no refund/cancellation vocabulary anywhere in this function
  assert.doesNotMatch(DELETE_FN, /refund|cancel/i);
});

test("Lun's correction: this Event's Passport row is locked and freshly re-read before any dependent-data scanning or Event deletion", () => {
  const lockIdx = DELETE_FN.indexOf("FOR UPDATE;");
  const scanIdx = DELETE_FN.indexOf("FOR v_dep IN");
  const eventDeleteIdx = DELETE_FN.indexOf("DELETE FROM public.events AS e");
  assert.notEqual(lockIdx, -1, "expected a FOR UPDATE lock on the Passport row");
  assert.notEqual(scanIdx, -1);
  assert.notEqual(eventDeleteIdx, -1);
  assert.ok(lockIdx < scanIdx, "the Passport lock/recheck must run before the dependency scan");
  assert.ok(scanIdx < eventDeleteIdx, "the dependency scan must still run before the Event delete");
  assert.match(
    DELETE_FN,
    /SELECT p\.state\s*\n\s*INTO v_passport_state\s*\n\s*FROM public\.self_service_event_passports AS p\s*\n\s*WHERE p\.event_id = p_event_id\s*\n\s*FOR UPDATE;/,
  );
});

test("Lun's correction: payment_pending cleanup is exactly state-scoped and runs before the dependency scan/Event deletion, with a fail-closed recheck after", () => {
  const cleanupIdx = DELETE_FN.indexOf("DELETE FROM public.self_service_event_passports AS p");
  const scanIdx = DELETE_FN.indexOf("FOR v_dep IN");
  const eventDeleteIdx = DELETE_FN.indexOf("DELETE FROM public.events AS e");
  assert.notEqual(cleanupIdx, -1);
  assert.ok(cleanupIdx < scanIdx, "the payment_pending cleanup must run before the dependency scan");
  assert.ok(cleanupIdx < eventDeleteIdx, "the payment_pending cleanup must run before the Event delete");

  // Guarded by state = 'payment_pending' on BOTH the enclosing IF and the
  // DELETE's own WHERE clause -- reserved/active/expired can never reach it
  // (they already raised above) and the DELETE itself could not touch a
  // differently-stated row even if it somehow did.
  assert.match(
    DELETE_FN,
    /IF v_passport_state = 'payment_pending' THEN[\s\S]*?DELETE FROM public\.self_service_event_passports AS p\s*\n\s*WHERE p\.event_id = p_event_id\s*\n\s*AND p\.state = 'payment_pending';/,
  );

  // Fail-closed recheck immediately after: any remaining row for this Event
  // aborts the whole deletion.
  assert.match(
    DELETE_FN,
    /DELETE FROM public\.self_service_event_passports AS p\s*\n\s*WHERE p\.event_id = p_event_id\s*\n\s*AND p\.state = 'payment_pending';[\s\S]{0,400}IF EXISTS \(\s*\n\s*SELECT 1 FROM public\.self_service_event_passports AS p WHERE p\.event_id = p_event_id\s*\n\s*\) THEN\s*\n\s*RAISE EXCEPTION/,
  );
});

test("Lun's correction: no cascade -- the Passport foreign key keeps ON DELETE RESTRICT, and the generic dependency scan's exclusion list is NOT widened to cover self_service_event_passports", () => {
  assert.match(SQL, /event_id uuid PRIMARY KEY REFERENCES public\.events\(id\) ON DELETE RESTRICT/);
  const scanIdx = DELETE_FN.indexOf("FOR v_dep IN");
  const exclusionEnd = DELETE_FN.indexOf(")", DELETE_FN.indexOf("con.conrelid NOT IN"));
  const exclusionClause = DELETE_FN.slice(DELETE_FN.indexOf("con.conrelid NOT IN", scanIdx), exclusionEnd + 1);
  assert.match(exclusionClause, /'public\.self_service_private_event_drafts'::regclass/);
  assert.match(exclusionClause, /'public\.self_service_onboarding_command_audit'::regclass/);
  assert.doesNotMatch(exclusionClause, /self_service_event_passports/);
});

test("replace_self_service_organizer_event is untouched -- it inherits the Passport protection (including Lun's correction) entirely through its existing delegation to delete_self_service_organizer_event", () => {
  // no CREATE/ALTER/GRANT/REVOKE targets it -- the only legitimate
  // appearances are this migration's own explanatory prose naming it
  assert.doesNotMatch(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.replace_self_service_organizer_event|ALTER FUNCTION public\.replace_self_service_organizer_event|GRANT.*replace_self_service_organizer_event|REVOKE.*replace_self_service_organizer_event/,
  );
  // still exactly the five restated/created functions -- replace is not a sixth
  assert.equal(
    (SQL.match(/^CREATE OR REPLACE FUNCTION public\./gm) ?? []).length,
    5,
  );
});

// ---- Compatibility guards ----

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

test("no Stripe or payment-provider call is made anywhere in the EXECUTABLE SQL -- only this migration's own explanatory comments may name the future provider/slice", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  assert.doesNotMatch(executable, /stripe/i);
  assert.doesNotMatch(executable, /webhook/i);
  assert.doesNotMatch(executable, /checkout/i);
});
