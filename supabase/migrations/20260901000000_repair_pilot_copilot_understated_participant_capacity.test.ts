import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260901000000_repair_pilot_copilot_understated_participant_capacity.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

// Everything outside SQL comments -- the statements that actually run.
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

const EXPECTED_IDS = [
  "098dfa2a-4606-4a55-aada-a1a2a09f57fc",
  "1d1caab7-871d-4778-9422-18ad4a8d0f73",
  "2c6b7688-c2fd-4824-92a3-b02ea9e3ff05",
  "2f2a83de-4ea1-4b82-8afe-932deb2d08ec",
  "6142b323-75df-4798-af3c-15863c8481ea",
  "658eb33c-864c-49de-84ee-54f85b8ec266",
  "90cdce02-8b78-4960-90cf-68c8b53b86e4",
  "c7d257fa-b9e1-4326-8522-5781d71775ea",
  "d1344088-24a1-4305-892e-790d349b9bf1",
  "defa3cdd-c7dd-4166-a449-610957d6543e",
  "ee51a0ab-c68a-4162-ac15-4825ecebe529",
];

test("wraps the whole migration in one transaction", () => {
  assert.match(executableSql, /^\s*BEGIN;/);
  assert.match(executableSql, /COMMIT;\s*$/);
});

test("names exactly the reviewed 11 attendee rows, and no others", () => {
  const uuids = (executableSql.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'::uuid/g) ?? [])
    .map((s) => s.slice(1, 37));
  // The only bare-quoted uuids in the executable body are the c_expected_ids array.
  const arrayMatch = executableSql.match(/c_expected_ids constant uuid\[\] := ARRAY\[([\s\S]*?)\]::uuid\[\]/);
  assert.ok(arrayMatch, "expected a c_expected_ids ARRAY literal");
  const idsInArray = (arrayMatch[1].match(/'([0-9a-f-]{36})'/g) ?? []).map((s) => s.slice(1, -1));
  assert.deepEqual([...idsInArray].sort(), [...EXPECTED_IDS].sort());
  assert.equal(idsInArray.length, 11);
  // No stray uuid outside the array.
  for (const u of uuids) {
    assert.ok(EXPECTED_IDS.includes(u), `unexpected uuid in migration: ${u}`);
  }
});

test("eligibility requires all five reviewed conditions", () => {
  // is_active
  assert.match(executableSql, /a\.is_active = true/);
  // capacity exactly 1 (raise-only)
  assert.match(executableSql, /a\.participant_capacity = 1/);
  // nonblank copilot_first
  assert.match(executableSql, /nullif\(btrim\(coalesce\(a\.copilot_first, ''\)\), ''\) IS NOT NULL/);
  // a materialized copilot household row
  assert.match(executableSql, /person_role = 'copilot'/);
  // total roster count >= 2
  assert.match(executableSql, /FROM public\.attendee_household_members AS hm2[\s\S]*?\)\s*>= 2/);
});

test("does not depend on source_type or raw_import anywhere in the executable body", () => {
  assert.doesNotMatch(executableSql, /source_type/);
  assert.doesNotMatch(executableSql, /raw_import/);
});

test("preserves the governed trigger contract: sets and clears the transaction-local flag", () => {
  assert.match(
    executableSql,
    /set_config\('epicentrax\.capacity_increase_authorized', 'true', true\)/,
  );
  assert.match(
    executableSql,
    /set_config\('epicentrax\.capacity_increase_authorized', 'false', true\)/,
  );
  // Flag is transaction-local (third arg true) everywhere it is touched.
  const calls = executableSql.match(/set_config\('epicentrax\.capacity_increase_authorized',[^)]*\)/g) ?? [];
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.match(c, /,\s*true\)\s*$/);
  }
});

test("writes one participant_capacity_adjustments audit row per repaired attendee", () => {
  assert.match(executableSql, /INSERT INTO public\.participant_capacity_adjustments \(/);
  assert.match(executableSql, /previous_capacity/);
  assert.match(executableSql, /new_capacity/);
  // audit rows are driven off the rows actually raised (CTE `raised`)
  assert.match(executableSql, /WITH raised AS \(\s*UPDATE public\.attendees/);
  assert.match(executableSql, /FROM raised/);
  assert.match(executableSql, /Expected to raise 11 rows \(with 11 audit rows\), got/);
});

test("audit row is an actor-less historical_repair with a stated reason", () => {
  assert.match(executableSql, /'historical_repair'/);
  // The audit INSERT column list, then a SELECT that supplies NULL, NULL for
  // the two actor columns and the historical_repair discriminator.
  const insert = executableSql.match(
    /INSERT INTO public\.participant_capacity_adjustments \([\s\S]*?FROM raised/,
  );
  assert.ok(insert, "expected the audit INSERT ... SELECT ... FROM raised");
  assert.match(insert[0], /actor_admin_user_id/);
  assert.match(insert[0], /actor_auth_user_id/);
  assert.match(insert[0], /NULL,\s*NULL,\s*c_repair_note,\s*'historical_repair'/);
  assert.match(executableSql, /c_repair_note constant text :=/);
  assert.match(executableSql, /Pilot \+ Co-Pilot capacity correction/i);
});

test("administrator audit rows still require both actor IDs; historical_repair rows require NULL actors + a non-null note", () => {
  assert.match(executableSql, /ADD COLUMN IF NOT EXISTS adjustment_source text NOT NULL DEFAULT 'administrator'/);
  assert.match(executableSql, /ALTER COLUMN actor_admin_user_id DROP NOT NULL/);
  assert.match(executableSql, /ALTER COLUMN actor_auth_user_id DROP NOT NULL/);
  const check = executableSql.match(
    /participant_capacity_adjustments_actor_presence_check CHECK \(([\s\S]*?)\n  \);/,
  );
  assert.ok(check, "expected the actor-presence CHECK");
  const body = check[1].replace(/\s+/g, " ");
  // administrator path: both actor IDs mandatory (exactly as strict as the old NOT NULLs)
  assert.match(
    body,
    /adjustment_source = 'administrator' AND actor_admin_user_id IS NOT NULL AND actor_auth_user_id IS NOT NULL/,
  );
  // historical_repair path: both actor IDs NULL AND a repair reason present
  assert.match(
    body,
    /adjustment_source = 'historical_repair' AND actor_admin_user_id IS NULL AND actor_auth_user_id IS NULL AND note IS NOT NULL/,
  );
  // the two source values are the only ones allowed
  assert.match(executableSql, /adjustment_source IN \('administrator', 'historical_repair'\)/);
});

test("Part 1 is idempotent (guarded DDL) so the migration is rerun-safe", () => {
  assert.match(executableSql, /ADD COLUMN IF NOT EXISTS adjustment_source/);
  assert.match(executableSql, /DROP CONSTRAINT IF EXISTS participant_capacity_adjustments_adjustment_source_check/);
  assert.match(executableSql, /DROP CONSTRAINT IF EXISTS participant_capacity_adjustments_actor_presence_check/);
});

test("first run: raises exactly the 11 reviewed rows 1 -> 2 with 11 audit rows", () => {
  // strict first-run scope gate
  assert.match(executableSql, /is not the reviewed 11-row scope/);
  assert.match(executableSql, /Expected exactly 11 eligible rows, found/);
  // exactly 11 raised + 11 audit rows (1:1, ROW_COUNT of the WITH ... INSERT)
  assert.match(executableSql, /GET DIAGNOSTICS v_audit_rows_written = ROW_COUNT/);
  assert.match(executableSql, /Expected to raise 11 rows \(with 11 audit rows\), got/);
  // no collateral change; the no-copilot cohort is untouched
  assert.match(executableSql, /Collateral change: participant_capacity of an attendee outside the reviewed scope changed/);
  assert.match(executableSql, /A capacity = 1 row without a Co-Pilot household member changed/);
  // in-run idempotency proof
  assert.match(executableSql, /Not idempotent: % rows would still be eligible on a rerun/);
  assert.match(executableSql, /Not idempotent: a second UPDATE changed % rows/);
});

test("rerun no-ops when nothing qualifies and no reviewed row is below capacity 2", () => {
  // the empty-eligibility branch RETURNs with a NOTICE, not an error,
  // when v_reviewed_below_two is empty
  assert.match(executableSql, /IF array_length\(v_eligible_ids, 1\) IS NULL THEN/);
  assert.match(executableSql, /IF array_length\(v_reviewed_below_two, 1\) IS NOT NULL THEN/);
  assert.match(executableSql, /No-op: no reviewed registration still qualifies/);
  const noopBranch = executableSql.match(
    /IF array_length\(v_eligible_ids, 1\) IS NULL THEN([\s\S]*?)\n  END IF;/,
  );
  assert.ok(noopBranch, "expected the empty-eligibility branch");
  assert.match(noopBranch[1], /RAISE NOTICE[\s\S]*?RETURN;/);
});

test("a legitimate later increase (2 -> 3+) does NOT make a rerun fail", () => {
  // "already repaired" is defined as >= 2, never "exactly 2".
  assert.doesNotMatch(executableSql, /participant_capacity IS DISTINCT FROM 2/);
  assert.doesNotMatch(executableSql, /reviewed row is not at participant_capacity = 2/);
  // The only place the literal 2 is assigned is the guarded 1 -> 2 UPDATE;
  // every *test* of a reviewed row's capacity uses ">= 2" or "< 2".
  const capacityEquals2 = executableSql.match(/participant_capacity\s*=\s*2\b/g) ?? [];
  const assignEquals2 = executableSql.match(/SET participant_capacity = 2\b/g) ?? [];
  assert.equal(
    capacityEquals2.length,
    assignEquals2.length,
    "participant_capacity = 2 must only ever appear as the SET assignment, never as a comparison",
  );
  assert.match(executableSql, /a\.participant_capacity >= 2/);
  assert.match(executableSql, /participant_capacity IS NULL OR participant_capacity < 2/);
  assert.match(executableSql, /v_reviewed_at_or_above <> 11/);
});

test("fail-closed: a reviewed row unexpectedly below capacity 2", () => {
  // present-and-below-2 but not repair-eligible -> hard error
  assert.match(
    executableSql,
    /Fail-closed: reviewed row\(s\) % are present with participant_capacity below 2/,
  );
  // present-and-below-2 AND re-eligible -> caught by the strict scope gate
  assert.match(executableSql, /Fail-closed: the set of rows currently eligible for this 1 -> 2 repair/);
  // post-repair guard also rejects any reviewed row left below 2
  assert.match(executableSql, /Post-repair: at least one reviewed row is still below participant_capacity 2/);
});

test("never lowers or overwrites a capacity that is already > 1", () => {
  // every attendee UPDATE sets the literal 2 and is guarded by = 1
  const guarded = executableSql.match(
    /UPDATE public\.attendees AS a\s+SET participant_capacity = 2\s+WHERE[\s\S]*?a\.participant_capacity = 1/g,
  ) ?? [];
  assert.ok(guarded.length >= 2, "expected the repair UPDATE and the idempotency-probe UPDATE, both = 1 guarded");
  const anyAttendeeUpdate = executableSql.match(/UPDATE public\.attendees AS a\s+SET participant_capacity = \d+/g) ?? [];
  assert.equal(anyAttendeeUpdate.length, guarded.length, "every attendees capacity UPDATE must be the = 1 guarded 1 -> 2 form");
  assert.doesNotMatch(executableSql, /SET participant_capacity = (?!2\b)\d+/);
});

test("touches no function, policy, grant, or attendee_household_members row", () => {
  assert.doesNotMatch(executableSql, /CREATE (OR REPLACE )?FUNCTION/i);
  assert.doesNotMatch(executableSql, /CREATE POLICY|DROP POLICY|ALTER POLICY/i);
  assert.doesNotMatch(executableSql, /\bGRANT\b|\bREVOKE\b/);
  assert.doesNotMatch(executableSql, /INSERT INTO public\.attendee_household_members/i);
  assert.doesNotMatch(executableSql, /UPDATE public\.attendee_household_members/i);
  assert.doesNotMatch(executableSql, /DELETE FROM public\.attendee_household_members/i);
});
