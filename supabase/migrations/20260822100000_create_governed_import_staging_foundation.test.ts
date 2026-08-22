import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(fileURLToPath(new URL("./20260822100000_create_governed_import_staging_foundation.sql", import.meta.url)), "utf8");
const withoutComments = sql.replace(/^--.*$/gm, "");

test("creates additive shared Imports run and source-row tables without altering legacy event_import_rows", () => {
  assert.match(sql, /CREATE TABLE public\.import_runs/);
  assert.match(sql, /CREATE TABLE public\.import_run_rows/);
  assert.equal(/ALTER TABLE public\.event_import_rows|DROP TABLE public\.event_import_rows/.test(withoutComments), false);
});

test("source-row identity is event-scoped, immutable, and idempotent within its run", () => {
  assert.match(sql, /FOREIGN KEY \(import_run_id, event_id\) REFERENCES public\.import_runs \(id, event_id\)/);
  assert.match(sql, /UNIQUE \(import_run_id, source_row_number\)/);
  assert.match(sql, /UNIQUE \(import_run_id, source_fingerprint\)/);
  assert.match(sql, /UNIQUE \(commit_idempotency_key\)/);
  assert.match(sql, /import row source evidence is immutable/);
  assert.match(sql, /import run source evidence is immutable/);
});

test("the persisted row state machine covers staging, review, and future commit outcomes", () => {
  for (const state of ["parsed", "validation_failed", "needs_review", "approved", "committed", "commit_failed"]) {
    assert.match(sql, new RegExp(`'${state}'`));
  }
  assert.match(sql, /invalid_import_row_state_transition/);
  assert.match(sql, /import_run_has_unvalidated_rows/);
});

test("all Imports mutations require canonical event.imports.manage, lifecycle, and authenticated callers", () => {
  const manages = sql.match(/has_event_task_authority\('event\.imports\.manage'/g) || [];
  assert.equal(manages.length, 4);
  const lifecycle = sql.match(/assert_event_lifecycle_mutable/g) || [];
  assert.equal(lifecycle.length, 4);
  assert.equal(/event\.attendees\.manage|event\.agenda\.manage|event\.vendors\.manage/.test(withoutComments), false);
});

test("reads require imports view while direct tables and anon/service-role function execution are denied", () => {
  assert.match(sql, /has_event_task_authority\('event\.imports\.view', v_run\.event_id\)/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.import_runs FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.import_run_rows FROM PUBLIC, anon, authenticated, service_role/);
  assert.equal((sql.match(/SECURITY DEFINER/g) || []).length, 5);
  assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION/g) || []).length, 5);
});

test("Imports-owned functions do not mutate attendee, Person, participation, parking, arrival, or activity tables", () => {
  for (const table of ["attendees", "attendee_household_members", "attendee_activities", "participant_capacity_adjustments", "people", "person_event_participations"]) {
    assert.equal(new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${table}\\b`).test(withoutComments), false, table);
  }
});

test("migration is forward-only and transactional", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});
