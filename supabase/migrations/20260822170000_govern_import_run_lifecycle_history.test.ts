import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(fileURLToPath(new URL("./20260822170000_govern_import_run_lifecycle_history.sql", import.meta.url)), "utf8");
const fixture = readFileSync(fileURLToPath(new URL("../integration-tests/20260822170000_import_run_lifecycle_history_rollback.sql", import.meta.url)), "utf8");
const executable = sql.replace(/^--.*$/gm, "");

function block(name: string) {
  return sql.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}[\\s\\S]*?\\n\\$\\$;`, "m"))?.[0] ?? "";
}

test("adds immutable abandonment and finalizer evidence without rewriting source evidence", () => {
  for (const field of ["finalized_by_auth_user_id", "abandoned_at", "abandoned_by_auth_user_id", "abandonment_reason_code"]) assert.match(sql, new RegExp(field));
  assert.match(sql, /import_run_rows_abandonment_evidence_check/);
  assert.match(sql, /abandoned import row is immutable/);
  assert.match(sql, /row_state NOT IN \('committed', 'validation_failed'\)/);
});

test("source closure is explicit, governed, idempotent, and leaves staging closed", () => {
  const fn = block("close_import_run_staging");
  for (const required of ["event.imports.manage", "assert_event_lifecycle_mutable", "status = 'ready_for_review'", "import_run_not_closable", "FOR UPDATE"]) assert.ok(fn.includes(required), required);
  const foundation = readFileSync(fileURLToPath(new URL("./20260822100000_create_governed_import_staging_foundation.sql", import.meta.url)), "utf8");
  assert.match(foundation, /stage_import_run_row[\s\S]*status = 'staging'/);
});

test("review transitions preserve terminal rows and commit-failed retry ownership", () => {
  const fn = block("set_import_run_row_review_state");
  assert.match(fn, /v_row\.abandoned_at IS NOT NULL OR v_row\.row_state IN \('committed', 'validation_failed', 'commit_failed'\)/);
  assert.match(fn, /v_row\.row_state IN \('parsed', 'needs_review', 'approved'\)/);
  assert.match(fn, /invalid_import_row_state_transition/);
});

test("abandonment is imports-managed, bounded, atomic, and never touches canonical domain tables", () => {
  for (const name of ["abandon_import_run_row", "abandon_import_run_open_rows"]) {
    const fn = block(name);
    for (const required of ["event.imports.manage", "assert_event_lifecycle_mutable", "abandonment_reason_code", "SECURITY DEFINER", "SET search_path TO 'pg_catalog'"]) assert.ok(fn.includes(required), `${name}: ${required}`);
    for (const forbidden of ["public.attendees", "public.vendors", "public.event_vendors", "INSERT INTO public."]) assert.equal(fn.includes(forbidden), false, `${name}: ${forbidden}`);
  }
  assert.match(block("abandon_import_run_open_rows"), /row_state NOT IN \('committed', 'validation_failed'\)/);
});

test("finalization is ready-only, terminal-only, actor-recorded, and outcome remains derived", () => {
  const fn = block("finalize_import_run");
  for (const required of ["event.imports.manage", "status <> 'ready_for_review'", "assert_event_lifecycle_mutable", "finalized_by_auth_user_id = auth.uid()", "import_run_has_open_rows"]) assert.ok(fn.includes(required), required);
  assert.match(fn, /abandoned_at IS NULL[\s\S]*row_state NOT IN \('committed', 'validation_failed'\)/);
  assert.equal(/final_outcome\s+text.*ALTER TABLE public\.import_runs/s.test(sql), false);
  assert.match(block("import_run_final_outcome"), /completed_with_errors/);
  assert.match(block("import_run_final_outcome"), /RETURN 'abandoned'/);
  assert.match(block("import_run_final_outcome"), /RETURN 'mixed'/);
});

test("active discovery, status, and finalized History are scoped and redact source evidence", () => {
  assert.match(block("list_active_import_runs"), /event\.imports\.manage/);
  for (const name of ["get_import_run_status", "list_finalized_import_run_history", "get_finalized_import_run_history_detail"]) {
    const fn = block(name);
    assert.ok(fn.includes("event.imports.view"), name);
    assert.equal(fn.includes("source_payload"), false, `${name} raw source`);
    assert.equal(fn.includes("normalized_candidate"), false, `${name} candidate`);
  }
  assert.equal(block("get_import_run_status").includes("source_metadata"), false);
  assert.match(block("list_finalized_import_run_history"), /p_before_finalized_at/);
});

test("all public RPCs are postgres-owned, safe-path, authenticated-only, and anon-denied", () => {
  const names = ["close_import_run_staging", "set_import_run_row_review_state", "abandon_import_run_row", "abandon_import_run_open_rows", "finalize_import_run", "get_import_run_status", "list_active_import_runs", "list_finalized_import_run_history", "get_finalized_import_run_history_detail"];
  for (const name of names) {
    const fn = block(name);
    assert.ok(fn.includes("SECURITY DEFINER"), name);
    assert.ok(fn.includes("SET search_path TO 'pg_catalog'"), name);
    assert.match(sql, new RegExp(`ALTER FUNCTION public\\.${name}\\([^;]*\\) OWNER TO postgres;`));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*\\) FROM PUBLIC, anon, service_role;`));
  }
});

test("linked fixture installs and exercises every pending lifecycle RPC", () => {
  for (const name of ["close_import_run_staging", "set_import_run_row_review_state", "abandon_import_run_row", "abandon_import_run_open_rows", "finalize_import_run", "get_import_run_status", "list_active_import_runs", "list_finalized_import_run_history", "get_finalized_import_run_history_detail"]) {
    assert.match(fixture, new RegExp(`public\\.${name}`), name);
  }
  assert.match(fixture, /^BEGIN;/m);
  assert.match(fixture, /^ROLLBACK;/m);
});

test("linked fixture installs the migration body byte-identical to the pending migration -- not merely a same-named reimplementation", () => {
  const migBegin = sql.indexOf("BEGIN;") + "BEGIN;".length;
  const migEnd = sql.indexOf("COMMIT;");
  const migBody = sql.slice(migBegin, migEnd).trim();
  const fixStart = fixture.indexOf("ALTER TABLE public.import_runs");
  const fixEnd = fixture.indexOf("-- ============================================================\n-- FIXTURE-ONLY helpers");
  assert.ok(migBody.length > 0, "migration body extracted");
  assert.ok(fixStart > -1 && fixEnd > fixStart, "fixture's embedded-migration block located");
  const fixBody = fixture.slice(fixStart, fixEnd).trim();
  assert.equal(fixBody, migBody);
});

test("migration is additive, transactional, and does not change canonical commit functions", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
  for (const forbidden of ["commit_attendee_import_run_row", "commit_vendor_import_run_row", "record_attendee_import_run_row_commit_failure", "record_vendor_import_run_row_commit_failure"]) assert.equal(executable.includes(forbidden), false, forbidden);
});
