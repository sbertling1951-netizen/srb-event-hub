import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./20261019000000_govern_self_service_event_passport_refund_visibility.sql", import.meta.url)),
  "utf8",
);
const codeOnly = source.replace(/--.*$/gm, "");

test("the reader is SECURITY DEFINER with a fixed pg_catalog search_path, owned by postgres, and granted only to authenticated", () => {
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.get_my_self_service_event_passport_refund_eligibility/);
  assert.match(source, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(source, /ALTER FUNCTION public\.get_my_self_service_event_passport_refund_eligibility\(uuid\)\s*\n\s*OWNER TO postgres;/);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.get_my_self_service_event_passport_refund_eligibility\(uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.get_my_self_service_event_passport_refund_eligibility\(uuid\)\s*\n\s*TO authenticated;/);
});

test("the function returns exactly one boolean column, never a Passport state, receipt, provider id, or any other data", () => {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.get_my_self_service_event_passport_refund_eligibility");
  const end = source.indexOf("$function$;", start);
  const body = source.slice(start, end);
  assert.match(body, /RETURNS TABLE\(\s*\n\s*eligible boolean\s*\n\)/);
  assert.doesNotMatch(body, /receipt|provider_session_id|paid_at|refunded_at|amount|currency/i);
});

test("eligibility requires Platform Administrator authority through the established has_platform_admin_authority primitive -- ownership never substitutes", () => {
  assert.match(source, /has_platform_admin_authority\(v_actor\)/);
});

test("a non-super-admin caller -- including the Event's own organizer-owner -- fails closed to false, never an exception that would distinguish the two", () => {
  const idx = source.indexOf("has_platform_admin_authority(v_actor)");
  const block = source.slice(idx, idx + 200);
  assert.match(block, /RETURN QUERY SELECT false;\s*\n\s*RETURN;/);
});

test("eligibility is true only for the exact 'reserved' Passport state -- active, expired, refunded, payment_pending, and a missing Passport row all resolve to false via a strict, NULL-safe comparison", () => {
  assert.match(source, /coalesce\(v_passport_state = 'reserved', false\)/);
  const start = codeOnly.indexOf("CREATE OR REPLACE FUNCTION public.get_my_self_service_event_passport_refund_eligibility");
  const end = codeOnly.indexOf("$function$;", start);
  const body = codeOnly.slice(start, end);
  assert.doesNotMatch(body, /'active'|'expired'|'payment_pending'|'refunded'/);
});

test("ownership is resolved through the identical identity/appointment/draft/tenant predicate as the existing confirmation reader -- the same non-enumerating 'Event not found.' for any foreign or ineligible Event", () => {
  assert.match(source, /resolve_auth_person_link\(v_actor\)/);
  assert.match(source, /self_service_private_event_drafts/);
  assert.match(source, /t\.is_self_service_private_draft = true/);
  assert.match(source, /e\.status = 'Draft'/);
  assert.match(source, /IF v_appointment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/);
});

test("this reader never prepares, executes, or writes anything -- no INSERT, UPDATE, DELETE, or call into the refund preparation/execution/confirmation commands", () => {
  const start = codeOnly.indexOf("CREATE OR REPLACE FUNCTION public.get_my_self_service_event_passport_refund_eligibility");
  const end = codeOnly.indexOf("$function$;", start);
  const body = codeOnly.slice(start, end);
  assert.doesNotMatch(body, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  assert.doesNotMatch(body, /prepare_self_service_event_passport_refund_request|assert_self_service_event_passport_refund_request_authority|confirm_self_service_event_passport_refund/);
});

test("no table, table grant, RLS policy, or seed row is created -- this migration adds exactly one function", () => {
  assert.doesNotMatch(source, /CREATE TABLE|CREATE POLICY|ENABLE ROW LEVEL SECURITY/);
  const functionCount = (source.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
  assert.equal(functionCount, 1);
});
