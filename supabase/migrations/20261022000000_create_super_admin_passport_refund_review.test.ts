import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./20261022000000_create_super_admin_passport_refund_review.sql", import.meta.url)),
  "utf8",
);
const code = source.replace(/--.*$/gm, "");
const start = code.indexOf("CREATE OR REPLACE FUNCTION public.list_self_service_event_passport_refund_review");
const end = code.indexOf("$function$;", start);
const fn = code.slice(start, end);

test("the review reader is the only new function and is authenticated Super-Admin-only", () => {
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.match(fn, /p_filter text/);
  assert.match(fn, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(fn, /auth\.uid\(\) IS NULL OR NOT public\.has_platform_admin_authority\(auth\.uid\(\)\)/);
  assert.ok(fn.indexOf("has_platform_admin_authority") < fn.indexOf("p_filter IS NULL"));
  assert.match(source, /ALTER FUNCTION public\.list_self_service_event_passport_refund_review\(text\)\s*\n\s*OWNER TO postgres;/);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.list_self_service_event_passport_refund_review\(text\)\s*\n\s*FROM PUBLIC, anon, service_role;/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.list_self_service_event_passport_refund_review\(text\)\s*\n\s*TO authenticated;/);
});

test("only the three exact filter choices are accepted", () => {
  assert.match(fn, /p_filter NOT IN \('all', 'pending', 'refunded'\)/);
  assert.match(fn, /RAISE EXCEPTION 'A valid refund review filter is required\.'/);
});

test("the returned review row is minimal and excludes provider, receipt, payment, money, and initiating-admin facts", () => {
  assert.match(fn, /RETURNS TABLE\(\s*\n\s*request_id uuid,\s*\n\s*event_id uuid,\s*\n\s*event_name text,\s*\n\s*requested_at timestamptz,\s*\n\s*completed_at timestamptz,\s*\n\s*request_state text,\s*\n\s*review_status text\s*\n\)/);
  const returnSignature = fn.slice(fn.indexOf("RETURNS TABLE"), fn.indexOf("LANGUAGE plpgsql"));
  assert.doesNotMatch(returnSignature, /provider|receipt|payment|amount|currency|initiated/i);
});

test("pending is exactly requested, refunded requires confirmed plus immutable audit evidence, and every other case remains needs_review", () => {
  assert.match(fn, /WHEN r\.state = 'requested' THEN 'pending'::text/);
  assert.match(fn, /WHEN r\.state = 'confirmed' AND EXISTS \([\s\S]*?self_service_event_passport_refund_audit[\s\S]*?audit\.receipt_audit_id = r\.receipt_audit_id[\s\S]*?\) THEN 'refunded'::text/);
  assert.match(fn, /ELSE 'needs_review'::text/);
});

test("the requested and refunded filters use the derived status, while all retains anomalies, in deterministic newest-first order", () => {
  assert.match(fn, /WHERE p_filter = 'all' OR classified\.review_status = p_filter/);
  assert.match(fn, /ORDER BY classified\.requested_at DESC, classified\.request_id DESC/);
});

test("the browser reader adds no table grants, RLS, policies, or writes", () => {
  assert.doesNotMatch(code, /CREATE TABLE|CREATE POLICY|ENABLE ROW LEVEL SECURITY|GRANT[\s\S]{0,80}ON TABLE/);
  assert.doesNotMatch(fn, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|prepare_self_service_event_passport_refund_request|confirm_self_service_event_passport_refund/);
});
