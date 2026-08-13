import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the legacy Event timezone backfill
// migration (LEM Event Timezone Foundation and Stage 1 Unblock).
//
// The backfill's actual runtime behavior -- exactly 5 rows updated, zero
// remaining NULL timezones, zero invalid IANA values, Camp Margaritaville
// left unchanged, and a second run being a safe no-op -- was proven
// separately by executing the exact same UPDATE+validation logic against a
// session-scoped temp copy of the real production events rows (rolled
// back, zero residue). See the completion report for that evidence. This
// file proves the deployed SQL text matches what was tested.
//
// Run with:
//   npx tsx --test supabase/migrations/20260813160000_backfill_legacy_event_timezones.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260813160000_backfill_legacy_event_timezones.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const EXPECTED_UPDATES: Array<{ id: string; timezone: string }> = [
  { id: "53136dfb-b039-40b1-9adf-dcb4d648ea87", timezone: "America/Chicago" }, // Amana Event & Annual Business Meeting
  { id: "382a358b-7d2d-4390-a920-8013a70c560b", timezone: "America/Denver" },  // Saint George
  { id: "853f6934-8672-4219-ad59-520482098577", timezone: "America/Chicago" }, // Branson
  { id: "9106b34a-b82b-4e7f-9d64-6325fc6ca705", timezone: "America/Chicago" }, // Gulf Shores27
  { id: "e0f01c83-cd82-43f4-a0a4-e4d3cb673459", timezone: "America/Chicago" }, // Amana27
];

const CAMP_MARGARITAVILLE_ID = "6bca5b21-2760-4f2e-80e3-e616fcbb35ab";

test("updates exactly the five expected Event UUIDs with the verified timezone, each guarded by AND timezone IS NULL", () => {
  for (const { id, timezone } of EXPECTED_UPDATES) {
    const pattern = new RegExp(
      `UPDATE public\\.events SET timezone = '${timezone}'\\s*\\n\\s*WHERE id = '${id}' AND timezone IS NULL;`,
    );
    assert.match(executableSql, pattern, `expected a guarded UPDATE for ${id} -> ${timezone}`);
  }
});

test("targets rows by stable Event UUID only -- never by name", () => {
  assert.equal(/WHERE name\s*=/i.test(executableSql), false, "must not identify rows by name");
  const whereClauses = [...executableSql.matchAll(/WHERE id = '([0-9a-f-]{36})' AND timezone IS NULL/g)];
  assert.equal(whereClauses.length, EXPECTED_UPDATES.length);
});

test("does not touch Camp Margaritaville's row and does not update any column other than timezone", () => {
  assert.equal(
    executableSql.includes(`id = '${CAMP_MARGARITAVILLE_ID}' AND timezone IS NULL`),
    false,
    "Camp Margaritaville must not appear in any guarded UPDATE -- it already has a valid timezone",
  );
  const setClauses = [...executableSql.matchAll(/SET (\w+) =/g)].map((m) => m[1]);
  assert.ok(setClauses.length > 0);
  for (const column of setClauses) {
    assert.equal(column, "timezone", `expected only the timezone column to be written, found SET ${column}`);
  }
});

test("every write is guarded against overwriting an already-populated value", () => {
  const updateStatements = [...executableSql.matchAll(/UPDATE public\.events[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(updateStatements.length, EXPECTED_UPDATES.length);
  for (const stmt of updateStatements) {
    assert.match(stmt, /AND timezone IS NULL;/, `expected an IS NULL guard in: ${stmt}`);
  }
});

test("self-validates: raises if the update count, remaining NULLs, IANA validity, or Camp Margaritaville's value don't match expectations", () => {
  assert.match(executableSql, /IF v_updated_count <> 5 THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(executableSql, /SELECT count\(\*\) INTO v_missing_count FROM public\.events WHERE timezone IS NULL;/);
  assert.match(executableSql, /IF v_missing_count <> 0 THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(executableSql, /FROM pg_timezone_names tz WHERE tz\.name = e\.timezone/);
  assert.match(executableSql, /IF v_invalid_count <> 0 THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(
    executableSql,
    new RegExp(`FROM public\\.events WHERE id = '${CAMP_MARGARITAVILLE_ID}'`),
  );
  assert.match(executableSql, /IF v_camp_margaritaville_timezone IS DISTINCT FROM 'America\/Chicago' THEN\s*\n\s*RAISE EXCEPTION/);
});

test("introduces no generic Tenant/Platform timezone fallback", () => {
  assert.equal(/tenants\.timezone|platform.*timezone|default.*timezone/i.test(executableSql), false);
});

test("does not alter any table other than public.events", () => {
  const tableRefs = [...executableSql.matchAll(/(?:UPDATE|FROM)\s+public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tableRefs.length > 0);
  for (const table of tableRefs) {
    assert.equal(table, "events", `expected only public.events to be touched, found public.${table}`);
  }
});
