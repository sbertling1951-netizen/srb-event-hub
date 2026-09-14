import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(
    new URL(
      "./20261021000000_add_self_service_event_passport_refunded_confirmation_status.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const priorSource = readFileSync(
  fileURLToPath(
    new URL(
      "./20261015000000_govern_self_service_event_passport_confirmation_read_access.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("this migration replaces only get_my_self_service_event_passport_confirmation -- no other CREATE FUNCTION, ALTER TABLE, or DROP is present", () => {
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.get_my_self_service_event_passport_confirmation\(/);
  const createFunctionMatches = source.match(/CREATE OR REPLACE FUNCTION/g) || [];
  assert.equal(createFunctionMatches.length, 1);
  assert.doesNotMatch(source, /ALTER TABLE|DROP FUNCTION|DROP TABLE|CREATE TABLE|GRANT .* ON TABLE|REVOKE .* ON TABLE/);
});

test("the prior 20261015000000 migration is untouched, and it is the exact function this migration replaces", () => {
  assert.match(priorSource, /CREATE OR REPLACE FUNCTION public\.get_my_self_service_event_passport_confirmation\(/);
  assert.doesNotMatch(priorSource, /'refunded'/);
});

test("every existing authenticated/verified-email/identity-link/private-Draft/tenant/Event check is preserved verbatim", () => {
  assert.match(source, /RAISE EXCEPTION 'Reading a Passport confirmation status requires an authenticated verified account\.';/);
  assert.match(source, /RAISE EXCEPTION 'Reading a Passport confirmation status requires a verified account email\.';/);
  assert.match(source, /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/);
  assert.match(source, /AND t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/);
  assert.match(source, /IF v_appointment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/);
});

test("the confirmed branch is checked FIRST and is completely unchanged", () => {
  assert.match(
    source,
    /IF public\.is_self_service_event_passport_preserved\(p_event_id\) THEN\s*\n\s*RETURN QUERY SELECT 'confirmed'::text;\s*\n\s*RETURN;\s*\n\s*END IF;/,
  );
  const confirmedIdx = source.indexOf("is_self_service_event_passport_preserved(p_event_id)");
  const refundedIdx = source.indexOf("p.state = 'refunded'");
  assert.ok(confirmedIdx !== -1 && refundedIdx !== -1 && confirmedIdx < refundedIdx);
});

test("the new refunded branch is checked strictly between confirmed and the not_confirmed fallback -- exactly one new RETURN QUERY", () => {
  const refundedIdx = source.indexOf("p.state = 'refunded'");
  const notConfirmedIdx = source.indexOf("RETURN QUERY SELECT 'not_confirmed'::text;");
  assert.ok(refundedIdx !== -1 && notConfirmedIdx !== -1 && refundedIdx < notConfirmedIdx);
  const refundedReturns = source.match(/RETURN QUERY SELECT 'refunded'::text;/g) || [];
  assert.equal(refundedReturns.length, 1);
});

test("the refunded check reads only Passport state -- never a refund request, refund-audit row, receipt, or provider identifier", () => {
  const startIdx = source.indexOf("IF EXISTS (\n    SELECT 1 FROM public.self_service_event_passports");
  assert.notEqual(startIdx, -1);
  const block = source.slice(startIdx, source.indexOf("END IF;", startIdx));
  assert.match(block, /FROM public\.self_service_event_passports AS p/);
  assert.doesNotMatch(block, /refund_request|refund_audit|receipt|provider_/i);
});

test("the discriminator returns exactly one text column -- no Passport row, refund request, receipt, Stripe id, or amount field is ever exposed", () => {
  assert.match(source, /RETURNS TABLE\(\s*\n\s*outcome text\s*\n\)/);
  assert.doesNotMatch(source, /amount_minor_units|provider_refund_id|provider_session_id|receipt_audit_id/);
});

test("grants are unchanged -- authenticated only, service_role/anon/PUBLIC still denied, owned by postgres", () => {
  assert.match(
    source,
    /ALTER FUNCTION public\.get_my_self_service_event_passport_confirmation\(uuid\)\s*\n\s*OWNER TO postgres;/,
  );
  assert.match(
    source,
    /REVOKE ALL ON FUNCTION public\.get_my_self_service_event_passport_confirmation\(uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.get_my_self_service_event_passport_confirmation\(uuid\)\s*\n\s*TO authenticated;/,
  );
  assert.doesNotMatch(source, /TO service_role|TO anon|TO PUBLIC/);
});

test("no direct browser table grant is added -- no GRANT on self_service_event_passports or any refund/receipt table", () => {
  assert.doesNotMatch(source, /GRANT[\s\S]*?ON (TABLE )?public\.self_service_event_passport/i);
});

test("the function signature (argument and RETURNS TABLE shape) is unchanged from 20261015000000", () => {
  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION public\.get_my_self_service_event_passport_confirmation\(\s*\n\s*p_event_id uuid\s*\n\)/,
  );
});
