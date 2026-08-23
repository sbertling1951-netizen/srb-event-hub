import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL("./20260823030000_fix_agenda_import_correction_summary_count.sql", import.meta.url),
  ),
  "utf8",
);
const originalSql = readFileSync(
  fileURLToPath(
    new URL("./20260823010000_create_agenda_import_row_correction.sql", import.meta.url),
  ),
  "utf8",
);
const fixture = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260823010000_agenda_import_row_correction_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function block(source: string, name: string) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$;`);
  return source.match(re)?.[0] || "";
}

const correctedFn = block(sql, "list_agenda_import_row_correction_summaries");
const originalFn = block(originalSql, "list_agenda_import_row_correction_summaries");
const fixtureFn = block(fixture, "list_agenda_import_row_correction_summaries");

test("this migration is additive-only and touches exactly one function -- no table/trigger/other-function DDL, and prior migrations are not edited", () => {
  assert.equal(sql.match(/CREATE (OR REPLACE )?FUNCTION/g)?.length, 1);
  assert.equal(/CREATE TABLE|CREATE TRIGGER|DROP /.test(sql), false);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("the aggregate is explicitly cast to the declared integer return type, not left as the implicit bigint count(*) produces", () => {
  assert.match(correctedFn, /\(count\(\*\) OVER \(PARTITION BY c\.import_run_row_id\)\)::integer AS correction_count/);
  assert.doesNotMatch(correctedFn, /count\(\*\) OVER \(PARTITION BY c\.import_run_row_id\)\)? AS correction_count(?!.*::integer)/s);
});

test("RETURNS TABLE still declares correction_count integer -- the contract type was not widened to bigint", () => {
  assert.match(correctedFn, /RETURNS TABLE\(\s*\n\s*import_run_row_id uuid,\s*\n\s*correction_count integer,/);
});

test("the public function signature and RETURNS TABLE shape are byte-identical to the original", () => {
  const signature = (s: string) =>
    s.match(/CREATE OR REPLACE FUNCTION public\.list_agenda_import_row_correction_summaries\(p_import_run_id uuid\)\nRETURNS TABLE\([\s\S]*?\)\n/)?.[0];
  assert.ok(signature(correctedFn));
  assert.equal(signature(correctedFn), signature(originalFn));
});

test("every other line of the function body is unchanged -- the fix is exactly the one explicit cast, nothing else", () => {
  const normalize = (fn: string) =>
    fn.replace(
      "(count(*) OVER (PARTITION BY c.import_run_row_id))::integer AS correction_count",
      "count(*) OVER (PARTITION BY c.import_run_row_id) AS correction_count",
    );
  assert.equal(
    normalize(correctedFn),
    originalFn,
    "the corrected function, with only the cast reverted, must equal the original byte-for-byte",
  );
});

test("SECURITY DEFINER, owner, search_path, authority check, ordering, and grants are all unchanged", () => {
  for (const evidence of [
    "SECURITY DEFINER",
    "SET search_path TO 'pg_catalog'",
    "event.imports.manage",
    "not_authorized",
    "ORDER BY c.import_run_row_id, c.revision DESC",
    "DISTINCT ON (c.import_run_row_id)",
  ]) {
    assert.ok(correctedFn.includes(evidence), evidence);
  }
  assert.match(
    sql,
    /ALTER FUNCTION public\.list_agenda_import_row_correction_summaries\(uuid\) OWNER TO postgres;/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.list_agenda_import_row_correction_summaries\(uuid\) FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.list_agenda_import_row_correction_summaries\(uuid\) TO authenticated;/,
  );
});

test("the Stage D fixture's own embedded copy of the function now matches the corrected definition, not the original broken one", () => {
  assert.ok(fixtureFn, "fixture must still define list_agenda_import_row_correction_summaries");
  assert.equal(fixtureFn, correctedFn);
  assert.notEqual(fixtureFn, originalFn);
});

test("no unrelated Stage D function definition changed in this migration file", () => {
  for (const untouchedFn of [
    "correct_agenda_import_run_row",
    "get_agenda_import_row_corrections",
    "commit_agenda_import_run",
    "abandon_import_run_row",
    "abandon_import_run_open_rows",
    "_agenda_import_candidate_is_well_formed",
    "get_finalized_import_run_history_detail",
  ]) {
    assert.equal(
      sql.includes(`CREATE OR REPLACE FUNCTION public.${untouchedFn}`),
      false,
      untouchedFn,
    );
  }
});
