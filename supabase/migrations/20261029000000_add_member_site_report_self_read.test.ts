import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL("./20261029000000_add_member_site_report_self_read.sql", import.meta.url), "utf8");

test("self report lookup derives the attendee through the existing verified member boundary", () => {
  assert.match(sql, /v_attendee_id := public\.resolve_temporary_or_authenticated_attendee\(\s*p_event_id, p_event_code, p_registration_identifier\s*\)/);
  assert.match(sql, /IF v_attendee_id IS NULL THEN\s*RETURN;/);
  assert.doesNotMatch(sql, /p_attendee_id/);
  assert.match(sql, /WHERE r\.event_id = p_event_id AND r\.attendee_id = v_attendee_id/);
});

test("self report lookup returns only the latest evidence and cannot mutate placement or reports", () => {
  assert.match(sql, /RETURNS TABLE\(raw_reported_value text, reported_at timestamptz\)/);
  assert.match(sql, /ORDER BY r\.reported_at DESC, r\.id DESC\s*LIMIT 1/);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE public|DELETE FROM|record_site_placement|assigned_site|parking_sites)\b/i);
  assert.match(sql, /SECURITY DEFINER\s*SET search_path TO pg_catalog/);
  assert.match(sql, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO anon, authenticated/);
});
