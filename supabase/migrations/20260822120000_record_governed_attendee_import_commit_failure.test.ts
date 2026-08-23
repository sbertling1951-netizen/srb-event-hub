import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(fileURLToPath(new URL("./20260822120000_record_governed_attendee_import_commit_failure.sql", import.meta.url)), "utf8");

test("records only a bounded, Imports-owned approved-to-failed outcome", () => {
  assert.match(sql, /record_attendee_import_run_row_commit_failure\(\s*p_import_run_row_id uuid,\s*p_failure_code text/s);
  assert.match(sql, /v_row\.row_state <> 'approved'/);
  assert.match(sql, /row_state = 'commit_failed'/);
  assert.match(sql, /commit_state = 'failed'/);
  for (const code of ["canonical_commit_failed", "canonical_commit_denied", "canonical_commit_conflict", "canonical_commit_unavailable"]) assert.match(sql, new RegExp(`WHEN '${code}'`));
  assert.equal(/p_failure_message|p_details|SQLERRM|stack/i.test(sql), false);
});

test("requires only scoped Imports authority and a committable run", () => {
  assert.match(sql, /has_event_task_authority\('event\.imports\.manage', v_row\.event_id\)/);
  assert.equal(/event\.attendees\.manage/.test(sql), false);
  assert.match(sql, /v_run\.status NOT IN \('staging', 'ready_for_review'\)/);
  assert.match(sql, /assert_event_lifecycle_mutable/);
});

test("has safe idempotency and least privilege", () => {
  assert.match(sql, /v_row\.row_state = 'commit_failed'/);
  assert.match(sql, /v_row\.commit_error ->> 'code' = p_failure_code/);
  assert.match(sql, /commit_failure_already_recorded/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO 'pg_catalog'/);
  assert.match(sql, /OWNER TO postgres/);
  assert.match(sql, /REVOKE ALL ON FUNCTION.*PUBLIC, anon, service_role/);
  assert.match(sql, /GRANT EXECUTE.*TO authenticated/);
});

test("does not introduce canonical-domain writes", () => {
  for (const forbidden of ["public.attendees", "attendee_household_members", "attendee_activities", "participant_capacity_adjustments", "public.people", "person_event_participations", "parking", "arrival"]) assert.equal(sql.includes(forbidden), false, forbidden);
});
