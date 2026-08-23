import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "./20260823020000_fix_get_agenda_import_row_corrections_ambiguous_id.sql",
      import.meta.url,
    ),
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

const correctedFn = block(sql, "get_agenda_import_row_corrections");
const originalFn = block(originalSql, "get_agenda_import_row_corrections");
const fixtureFn = block(fixture, "get_agenda_import_row_corrections");

test("this migration is additive-only and touches exactly one function -- no table/trigger/other-function DDL, and 20260823010000 is not edited", () => {
  assert.equal(sql.match(/CREATE (OR REPLACE )?FUNCTION/g)?.length, 1);
  assert.equal(/CREATE TABLE|CREATE TRIGGER|DROP /.test(sql), false);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("the ambiguous bare `id` predicates are gone -- both source tables are aliased and qualified", () => {
  assert.doesNotMatch(correctedFn, /WHERE id = p_import_run_row_id/);
  assert.doesNotMatch(correctedFn, /WHERE id = v_row\.import_run_id/);
  assert.match(correctedFn, /FROM public\.import_run_rows AS r WHERE r\.id = p_import_run_row_id/);
  assert.match(correctedFn, /FROM public\.import_runs AS rn WHERE rn\.id = v_row\.import_run_id/);
});

test("the public function signature and RETURNS TABLE shape are byte-identical to the original, including the unrenamed `id` output column", () => {
  const signature = (s: string) =>
    s.match(/CREATE OR REPLACE FUNCTION public\.get_agenda_import_row_corrections\(p_import_run_row_id uuid\)\nRETURNS TABLE\([\s\S]*?\)\n/)?.[0];
  assert.ok(signature(correctedFn));
  assert.equal(signature(correctedFn), signature(originalFn));
  assert.match(correctedFn, /^\s*id uuid,/m);
});

test("every other line of the function body is unchanged -- the fix is exactly the two WHERE-clause qualifications, nothing else", () => {
  const normalize = (fn: string) =>
    fn
      .replace("FROM public.import_run_rows AS r WHERE r.id = p_import_run_row_id", "FROM public.import_run_rows WHERE id = p_import_run_row_id")
      .replace("FROM public.import_runs AS rn WHERE rn.id = v_row.import_run_id", "FROM public.import_runs WHERE id = v_row.import_run_id");
  assert.equal(normalize(correctedFn), originalFn, "the corrected function, with only the two WHERE clauses reverted, must equal the original byte-for-byte");
});

test("SECURITY DEFINER, owner, search_path, authority check, and grants are all unchanged", () => {
  for (const evidence of [
    "SECURITY DEFINER",
    "SET search_path TO 'pg_catalog'",
    "event.imports.manage",
    "not_authorized",
  ]) {
    assert.ok(correctedFn.includes(evidence), evidence);
  }
  assert.match(sql, /ALTER FUNCTION public\.get_agenda_import_row_corrections\(uuid\) OWNER TO postgres;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_agenda_import_row_corrections\(uuid\) FROM PUBLIC, anon, service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_agenda_import_row_corrections\(uuid\) TO authenticated;/);
});

test("the Stage D fixture's own embedded copy of the function now matches the corrected definition, not the original broken one", () => {
  assert.ok(fixtureFn, "fixture must still define get_agenda_import_row_corrections");
  assert.equal(fixtureFn, correctedFn);
  assert.notEqual(fixtureFn, originalFn);
});
