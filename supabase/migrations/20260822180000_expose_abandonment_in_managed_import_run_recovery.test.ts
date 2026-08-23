import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const sql = readFileSync(fileURLToPath(new URL("./20260822180000_expose_abandonment_in_managed_import_run_recovery.sql", import.meta.url)), "utf8");
const priorSql = readFileSync(fileURLToPath(new URL("./20260822130000_create_managed_import_run_recovery.sql", import.meta.url)), "utf8");

test("recovery now exposes the row abandonment overlay -- abandoned_at, abandoned_by_auth_user_id, abandonment_reason_code", () => {
  for (const field of ["abandoned_at", "abandoned_by_auth_user_id", "abandonment_reason_code"]) {
    assert.match(sql, new RegExp(`'${field}',r\\.${field}`), field);
  }
});

test("every field the prior Stage 1.1 recovery returned is still returned -- strictly additive, nothing dropped", () => {
  const priorRowFields = ["id", "source_row_number", "normalized_candidate", "validation_state", "validation_details", "review_state", "row_state", "commit_state", "canonical_target_id", "commit_result", "commit_error", "created_at", "updated_at", "committed_at"];
  for (const field of priorRowFields) assert.match(sql, new RegExp(`'${field}',r\\.${field}`), field);
  assert.match(sql, /'run',jsonb_build_object\('id',v_run\.id,'event_id',v_run\.event_id,'import_type',v_run\.import_type,'source_filename',v_run\.source_filename,'status',v_run\.status,'created_at',v_run\.created_at,'finalized_at',v_run\.finalized_at\)/);
});

test("signature, authority, and least-privilege posture are unchanged from Stage 1.1", () => {
  assert.match(sql, /get_managed_import_run_recovery\(p_import_run_id uuid\)/);
  assert.match(sql, /RETURNS jsonb/);
  assert.match(sql, /has_event_task_authority\('event\.imports\.manage',v_run\.event_id\)/);
  assert.equal(/event\.imports\.view/.test(sql), false);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO 'pg_catalog'/);
  assert.match(sql, /OWNER TO postgres/);
  assert.match(sql, /REVOKE ALL ON FUNCTION.*PUBLIC,anon,service_role/);
  assert.match(sql, /GRANT EXECUTE.*TO authenticated/);
});

test("still returns no raw source payload, creator identity, or internal error text", () => {
  for (const forbidden of ["source_payload", "created_by_auth_user_id", "auth.uid() AS", "stack", "sqlerr"]) {
    assert.equal(sql.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("no other RPC, schema, table, or Attendee/Vendor canonical function is touched -- one function, replaced in place", () => {
  const executable = sql.replace(/^--.*$/gm, "");
  const createMatches = executable.match(/CREATE (OR REPLACE )?FUNCTION/g) || [];
  assert.equal(createMatches.length, 1);
  for (const forbidden of ["ALTER TABLE", "CREATE TABLE", "DROP TABLE", "commit_attendee_import_run_row", "commit_vendor_import_run_row", "close_import_run_staging", "finalize_import_run", "abandon_import_run"]) {
    assert.equal(executable.includes(forbidden), false, forbidden);
  }
});

test("migration is a single transaction", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("the prior Stage 1.1 migration file is untouched (historical migrations are never edited)", () => {
  assert.equal(/abandoned_at/.test(priorSql), false);
  assert.match(priorSql, /'id',r\.id,'source_row_number',r\.source_row_number/);
});
