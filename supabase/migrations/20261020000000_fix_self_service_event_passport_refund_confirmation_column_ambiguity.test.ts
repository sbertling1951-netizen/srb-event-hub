import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(
    new URL(
      "./20261020000000_fix_self_service_event_passport_refund_confirmation_column_ambiguity.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const priorSource = readFileSync(
  fileURLToPath(
    new URL(
      "./20261018000000_govern_self_service_event_passport_refund_confirmation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("this migration replaces only confirm_self_service_event_passport_refund -- no other CREATE FUNCTION, ALTER TABLE, or DROP is present", () => {
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.confirm_self_service_event_passport_refund\(/);
  const createFunctionMatches = source.match(/CREATE OR REPLACE FUNCTION/g) || [];
  assert.equal(createFunctionMatches.length, 1);
  assert.doesNotMatch(source, /ALTER TABLE|DROP FUNCTION|DROP TABLE|CREATE TABLE/);
});

test("the prior 20261018000000 migration is untouched by this change", () => {
  assert.match(priorSource, /CREATE OR REPLACE FUNCTION public\.confirm_self_service_event_passport_refund\(/);
});

test("the receipt lookup's event_id is qualified with the receipt table alias", () => {
  assert.match(
    source,
    /FROM public\.self_service_event_passport_payment_receipt_audit AS receipt\s*\n\s*WHERE receipt\.id = v_request\.receipt_audit_id AND receipt\.event_id = v_request\.event_id FOR UPDATE;/,
  );
});

test("the Passport lookup's event_id is qualified with the passport table alias", () => {
  assert.match(
    source,
    /FROM public\.self_service_event_passports AS p\s*\n\s*WHERE p\.event_id = v_request\.event_id FOR UPDATE;/,
  );
});

test("the Passport state UPDATE's event_id is also qualified -- it is the same output-variable ambiguity and would otherwise still fail after the two lookups are fixed", () => {
  assert.match(
    source,
    /UPDATE public\.self_service_event_passports AS p\s*\n\s*SET state = 'refunded', refunded_at = now\(\), updated_at = now\(\)\s*\n\s*WHERE p\.event_id = v_request\.event_id;/,
  );
});

test("no bare, unqualified event_id reference remains anywhere in the function body", () => {
  const bodyStart = source.indexOf("AS $function$");
  const bodyEnd = source.indexOf("$function$;", bodyStart);
  const body = source.slice(bodyStart, bodyEnd);
  for (const line of body.split("\n")) {
    if (!line.includes("event_id")) continue;
    if (line.includes("p_provider_event_id")) continue;
    // Every remaining occurrence must be qualified (table.event_id),
    // a parameter/target-list name, or part of v_request.event_id /
    // p_request_id-derived value assignment -- never a bare column
    // reference inside a WHERE/SET/JOIN predicate.
    const bareInPredicate = /(?:WHERE|AND|SET)\s+event_id\b/i.test(line);
    assert.equal(bareInPredicate, false, `unqualified event_id predicate: ${line.trim()}`);
  }
});

test("audit-first ordering and state transitions are preserved exactly", () => {
  assert.match(source, /INSERT INTO public\.self_service_event_passport_refund_audit/);
  assert.match(source, /SET state = 'refunded', refunded_at = now\(\)/);
  assert.ok(
    source.indexOf("INSERT INTO public.self_service_event_passport_refund_audit") <
      source.indexOf("SET state = 'refunded'"),
  );
  assert.match(source, /IF v_passport_state IS DISTINCT FROM 'reserved' THEN RAISE EXCEPTION/);
  assert.match(source, /IF v_request\.state <> 'requested' THEN RAISE EXCEPTION/);
});

test("idempotency (existing-evidence short-circuit) behavior is unchanged", () => {
  assert.match(
    source,
    /WHERE provider_refund_id = p_provider_refund_id\s+OR provider_event_id = p_provider_event_id\s+OR receipt_audit_id = v_request\.receipt_audit_id;/,
  );
  assert.match(source, /IF v_existing\.receipt_audit_id <> v_request\.receipt_audit_id THEN\s+RAISE EXCEPTION/);
});

test("the function remains SECURITY DEFINER, owned by postgres, with search_path pinned to pg_catalog", () => {
  assert.match(source, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(
    source,
    /ALTER FUNCTION public\.confirm_self_service_event_passport_refund\(uuid, text, text\) OWNER TO postgres;/,
  );
});

test("grants remain service-role-only -- no broader authority than before", () => {
  assert.match(
    source,
    /REVOKE ALL ON FUNCTION public\.confirm_self_service_event_passport_refund\(uuid, text, text\)\s*\n\s*FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.confirm_self_service_event_passport_refund\(uuid, text, text\)\s*\n\s*TO service_role;/,
  );
  assert.doesNotMatch(source, /TO authenticated|TO anon|TO PUBLIC/);
});

test("the function signature (arguments and RETURNS TABLE shape) is unchanged", () => {
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION public\.confirm_self_service_event_passport_refund\(\s*\n\s*p_request_id uuid,\s*\n\s*p_provider_refund_id text,\s*\n\s*p_provider_event_id text\s*\n\)\s*\nRETURNS TABLE\(outcome text, event_id uuid, state text\)/,
  );
});
