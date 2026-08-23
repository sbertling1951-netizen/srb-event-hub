import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "./20260823000000_create_governed_agenda_import_batch_commit.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const fixture = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260823000000_agenda_import_batch_commit_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const commitBlock = (source: string) =>
  source.match(
    /CREATE OR REPLACE FUNCTION public\.commit_agenda_import_run[\s\S]*?GRANT EXECUTE ON FUNCTION public\.commit_agenda_import_run\(uuid\) TO authenticated;/,
  )?.[0];
const failureBlock = (source: string) =>
  source.match(
    /CREATE OR REPLACE FUNCTION public\.record_agenda_import_run_commit_failure[\s\S]*?GRANT EXECUTE ON FUNCTION public\.record_agenda_import_run_commit_failure\(uuid, text\) TO authenticated;/,
  )?.[0];
const commit = commitBlock(sql) || "";
const failure = failureBlock(sql) || "";

test("Agenda batch commit is Event-scoped, dual-authorized, lifecycle-governed, and run-type fenced", () => {
  for (const evidence of [
    "event.imports.manage",
    "event.agenda.manage",
    "assert_event_lifecycle_mutable",
    "import_run_not_agenda",
    "import_run_not_committable",
    "FOR UPDATE",
    "SECURITY DEFINER",
    "SET search_path TO 'pg_catalog'",
  ]) {
    assert.ok(commit.includes(evidence), evidence);
  }
});

test("Agenda batch commit proves complete staging and accepts only approved/retry-owned non-abandoned candidates", () => {
  for (const evidence of [
    "expected_agenda_version",
    "row_count",
    "agenda_import_run_staging_incomplete",
    "agenda_import_run_has_unresolved_rows",
    "agenda_import_partial_commit_state",
    "r.abandoned_at IS NULL",
    "r.row_state IN ('approved', 'commit_failed')",
    "staged_agenda_candidate_malformed",
    "duplicate_agenda_external_id_in_commit_batch",
  ]) {
    assert.ok(commit.includes(evidence), evidence);
  }
});

test("Agenda canonical mutation composes the existing version-fenced batch writer and atomically persists every row result", () => {
  assert.match(
    commit,
    /FROM public\.import_event_agenda_items\(\s*v_run\.event_id,\s*v_expected_version,\s*v_rows/,
  );
  assert.match(commit, /UPDATE public\.import_run_rows AS r/);
  assert.match(commit, /canonical_target_id = targets\.agenda_item_id/);
  assert.match(commit, /commit_state = 'committed'/);
  assert.match(commit, /agenda_import_commit_result_mismatch/);
  for (const forbidden of [
    "INSERT INTO public.agenda_items",
    "UPDATE public.agenda_items",
    "DELETE FROM public.agenda_items",
    "_agenda_event_version_advance",
    "_agenda_ledger_log",
  ]) {
    assert.equal(commit.includes(forbidden), false, forbidden);
  }
});

test("Agenda failure recording is Imports-owned, bounded, batch-wide, and stores no raw exception text", () => {
  for (const evidence of [
    "agenda_commit_failed",
    "agenda_commit_denied",
    "agenda_commit_conflict",
    "agenda_commit_unavailable",
    "agenda_commit_stale_version",
    "event.imports.manage",
    "commit_failure_already_recorded",
    "row_state = 'commit_failed'",
    "commit_state = 'failed'",
  ]) {
    assert.ok(failure.includes(evidence), evidence);
  }
  for (const forbidden of [
    "SQLERRM",
    "public.agenda_items",
    "public.event_agenda_state",
    "public.agenda_command_ledger",
  ]) {
    assert.equal(failure.includes(forbidden), false, forbidden);
  }
});

test("authenticated loses the direct legacy Agenda import RPC and receives only the staged batch surfaces", () => {
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.import_event_agenda_items\(uuid, integer, jsonb\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.commit_agenda_import_run\(uuid\) FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.record_agenda_import_run_commit_failure\(uuid, text\) FROM PUBLIC, anon, service_role;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.import_event_agenda_items/.test(sql),
    false,
  );
});

test("linked rollback fixture exercises the exact pending Stage B definitions", () => {
  assert.ok(commitBlock(sql));
  assert.ok(failureBlock(sql));
  assert.equal(commitBlock(fixture), commitBlock(sql));
  assert.equal(failureBlock(fixture), failureBlock(sql));
  assert.match(fixture, /^BEGIN;/m);
  assert.match(fixture, /^ROLLBACK;/m);
});
