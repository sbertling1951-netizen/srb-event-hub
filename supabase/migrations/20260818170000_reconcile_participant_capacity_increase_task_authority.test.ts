import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the record_participant_capacity_increase authority
// reconciliation. This repository has no live-Postgres test harness for any
// migration (no Docker/local Supabase in this environment) -- every sibling
// migration test proves invariants by reading the migration's own SQL
// source and asserting the required properties are structurally present,
// exactly as 20260818140000/20260818150000/20260818160000 and their own
// siblings already do. Run with:
//   npx tsx --test supabase/migrations/20260818170000_reconcile_participant_capacity_increase_task_authority.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818170000_reconcile_participant_capacity_increase_task_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

function blockBetween(startPattern: RegExp, endPattern: RegExp): string {
  const startMatch = SOURCE.match(startPattern);
  assert.ok(startMatch && startMatch.index !== undefined, `expected to find ${startPattern}`);
  const start = startMatch.index!;
  const rest = SOURCE.slice(start);
  const endMatch = rest.match(endPattern);
  assert.ok(endMatch && endMatch.index !== undefined, `expected to find ${endPattern} after ${startPattern}`);
  return rest.slice(0, endMatch.index! + endMatch[0].length);
}

const CAPACITY_RPC = blockBetween(
  /CREATE OR REPLACE FUNCTION public\.record_participant_capacity_increase/,
  /\$\$;/,
);

const CAPACITY_RPC_NO_COMMENTS = CAPACITY_RPC.replace(/--.*$/gm, "");

// ---- 1. The authorization predicate itself is reconciled. ----

test("record_participant_capacity_increase now requires event.attendees.manage, not is_event_scoped_admin", () => {
  assert.match(
    CAPACITY_RPC,
    /has_event_task_authority\('event\.attendees\.manage', v_event_id\)/,
  );
  // is_event_scoped_admin may still appear in an explanatory comment (what
  // this migration reconciled it away from); it must not appear in any
  // executable statement.
  assert.equal(/is_event_scoped_admin/.test(CAPACITY_RPC_NO_COMMENTS), false);
});

test("the authorization check still fails closed before any admin_users lookup or mutation", () => {
  const authIdx = CAPACITY_RPC.indexOf(
    "has_event_task_authority('event.attendees.manage', v_event_id)",
  );
  const adminLookupIdx = CAPACITY_RPC.indexOf("SELECT au.id INTO v_admin_id");
  const updateIdx = CAPACITY_RPC.indexOf("UPDATE public.attendees AS a");
  assert.ok(authIdx > -1 && adminLookupIdx > -1 && updateIdx > -1);
  assert.ok(authIdx < adminLookupIdx);
  assert.ok(authIdx < updateIdx);
});

// ---- 2. Nothing else about the function changed: signature, row locking,
// mode validation, both audit surfaces, and the roster-vs-capacity check.

test("signature is byte-for-byte unchanged from the live 20260818160000 definition", () => {
  const signature = CAPACITY_RPC.slice(0, CAPACITY_RPC.indexOf(")\nRETURNS") + 1);
  for (const param of [
    "p_attendee_id uuid",
    "p_new_capacity integer",
    "p_note text DEFAULT NULL",
    "p_participant_role text DEFAULT NULL",
    "p_copilot_first text DEFAULT NULL",
    "p_copilot_last text DEFAULT NULL",
    "p_copilot_nickname text DEFAULT NULL",
    "p_copilot_email text DEFAULT NULL",
    "p_additional_first_name text DEFAULT NULL",
    "p_additional_last_name text DEFAULT NULL",
    "p_additional_nickname text DEFAULT NULL",
    "p_additional_email text DEFAULT NULL",
    "p_additional_cell_phone text DEFAULT NULL",
  ]) {
    assert.ok(signature.includes(param), `expected signature to still include ${param}`);
  }
});

test("row locking (FOR UPDATE) on the attendee row is preserved", () => {
  assert.match(CAPACITY_RPC, /WHERE a\.id = p_attendee_id\s+FOR UPDATE;/);
});

test("the increase-only and single-role mode validations are preserved verbatim", () => {
  assert.match(
    CAPACITY_RPC,
    /IF p_new_capacity IS NULL OR p_new_capacity <= coalesce\(v_previous_capacity, 0\) THEN/,
  );
  assert.match(CAPACITY_RPC, /Only one participant role may be added with a single capacity increase\./);
});

test("both audit surfaces are preserved: participant_capacity_adjustments and attendee_household_member_command_audit", () => {
  assert.match(CAPACITY_RPC, /INSERT INTO public\.participant_capacity_adjustments \(/);
  const auditInserts = CAPACITY_RPC.match(
    /INSERT INTO public\.attendee_household_member_command_audit/g,
  ) || [];
  assert.equal(auditInserts.length, 2, "one per household role branch, unchanged from 20260818160000");
});

test("the final roster-vs-capacity rollback check is preserved", () => {
  assert.match(
    CAPACITY_RPC,
    /IF v_roster_count > p_new_capacity THEN/,
  );
});

// ---- 3. Grant/ownership posture is preserved exactly. ----

test("function remains SECURITY DEFINER, owned by postgres, and granted only to authenticated", () => {
  assert.match(CAPACITY_RPC, /SECURITY DEFINER/);
  assert.match(
    SOURCE,
    /ALTER FUNCTION public\.record_participant_capacity_increase\(\s*uuid, integer, text, text, text, text, text, text, text, text, text, text, text\s*\) OWNER TO postgres;/,
  );
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.record_participant_capacity_increase\(\s*uuid, integer, text, text, text, text, text, text, text, text, text, text, text\s*\) FROM anon;/,
  );
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.record_participant_capacity_increase\(\s*uuid, integer, text, text, text, text, text, text, text, text, text, text, text\s*\) FROM service_role;/,
  );
  assert.match(
    SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.record_participant_capacity_increase\(\s*uuid, integer, text, text, text, text, text, text, text, text, text, text, text\s*\) TO authenticated;/,
  );
});

// ---- 4. Whole-file invariants: narrow scope, no other object touched. ----

test("no table, policy, trigger, or other function is created, dropped, or altered by this migration", () => {
  assert.equal(/CREATE TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE POLICY|DROP POLICY/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE TRIGGER|DROP TRIGGER/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/manage_attendee_household_member/.test(SOURCE_NO_COMMENTS), false);
  const createOrReplace = SOURCE_NO_COMMENTS.match(/CREATE OR REPLACE FUNCTION/g) || [];
  assert.equal(createOrReplace.length, 1);
});

test("no REVOKE/GRANT touches any table -- only the one function's EXECUTE grants", () => {
  assert.equal(/REVOKE[^;]*ON TABLE/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/GRANT[^;]*ON TABLE/.test(SOURCE_NO_COMMENTS), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
