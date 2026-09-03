import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the "multiple Additional Participants per
// registration" migration. This repository has no live-Postgres test
// harness for migrations -- like every sibling migration test, these
// assert the SQL source encodes the required invariants. Run with:
//   npx tsx --test supabase/migrations/20260921000000_allow_multiple_additional_household_members.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260921000000_allow_multiple_additional_household_members.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const EXEC = SQL.replace(/--.*$/gm, "");

function blockBetween(start: RegExp, end: RegExp, from = SQL): string {
  const m = from.match(start);
  assert.ok(m && m.index !== undefined, `expected ${start}`);
  const rest = from.slice(m.index!);
  const e = rest.match(end);
  assert.ok(e && e.index !== undefined, `expected ${end} after ${start}`);
  return rest.slice(0, e.index! + e[0].length);
}

const MANAGE_RPC = blockBetween(
  /CREATE FUNCTION public\.manage_attendee_household_member/,
  /\$\$;/,
);
const CAPACITY_RPC = blockBetween(
  /CREATE OR REPLACE FUNCTION public\.record_participant_capacity_increase/,
  /\$\$;/,
);

test("runs inside a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /\nCOMMIT;\s*$/);
});

// ── Part 3: the constraint swap ────────────────────────────────────────

test("drops the blanket per-role UNIQUE and replaces it with a partial unique index for pilot/copilot only", () => {
  assert.match(
    EXEC,
    /ALTER TABLE public\.attendee_household_members\s*\n\s*DROP CONSTRAINT IF EXISTS attendee_household_members_attendee_role_unique;/,
  );
  assert.match(
    EXEC,
    /CREATE UNIQUE INDEX IF NOT EXISTS attendee_household_members_singleton_role_uq\s*\n\s*ON public\.attendee_household_members \(attendee_id, person_role\)\s*\n\s*WHERE person_role IN \('pilot', 'copilot'\);/,
  );
});

test("no data backfill, no RLS change, no person_role vocabulary change", () => {
  // No standalone data-migration block, and no bulk row rewrite of the table.
  assert.equal(/\nDO \$\$/.test(EXEC), false);
  // no bulk INSERT ... SELECT backfill into the table (all writes are VALUES)
  assert.equal(/INSERT INTO public\.attendee_household_members\b[^;]*?\bSELECT\b/.test(EXEC), false);
  assert.equal(/UPDATE public\.attendee_household_members AS/.test(EXEC), false);
  // No RLS / grant-to-table change.
  assert.equal(/CREATE POLICY|DROP POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY|GRANT (INSERT|UPDATE|DELETE) ON TABLE/.test(EXEC), false);
  // person_role CHECK vocabulary is not touched.
  assert.equal(/ADD CONSTRAINT[^;]*person_role[^;]*CHECK/.test(EXEC), false);
  assert.equal(/DROP CONSTRAINT[^;]*person_role_check/.test(EXEC), false);
});

// ── Part 1: manage_attendee_household_member ───────────────────────────

test("manage_attendee_household_member is DROPped at the 8-arg signature and re-created with a 9th p_household_member_id param", () => {
  assert.match(
    SQL,
    /DROP FUNCTION IF EXISTS public\.manage_attendee_household_member\(\s*uuid, text, boolean, text, text, text, text, text\s*\);/,
  );
  assert.match(
    MANAGE_RPC,
    /CREATE FUNCTION public\.manage_attendee_household_member\([\s\S]*?p_household_member_id uuid DEFAULT NULL\s*\)/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.manage_attendee_household_member\(uuid, text, boolean, text, text, text, text, text, uuid\) TO authenticated;/,
  );
});

test("manage_attendee_household_member: an explicit row id targets exactly that row and fails closed on a cross-attendee id or a role mismatch", () => {
  assert.match(
    MANAGE_RPC,
    /IF p_household_member_id IS NOT NULL THEN\s*\n\s*SELECT \* INTO v_before\s*\n\s*FROM public\.attendee_household_members\s*\n\s*WHERE id = p_household_member_id AND attendee_id = p_attendee_id\s*\n\s*FOR UPDATE;/,
  );
  assert.match(MANAGE_RPC, /IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION 'household_member_not_found';/);
  assert.match(
    MANAGE_RPC,
    /IF v_before\.person_role IS DISTINCT FROM p_person_role THEN\s*\n\s*RAISE EXCEPTION 'household_member_role_mismatch';/,
  );
  // update / delete of the targeted row are both by that row's id
  assert.match(MANAGE_RPC, /DELETE FROM public\.attendee_household_members WHERE id = v_before\.id;/);
  assert.match(MANAGE_RPC, /UPDATE public\.attendee_household_members SET[\s\S]*?WHERE id = v_before\.id\s*\n\s*RETURNING \* INTO v_after;/);
});

test("manage_attendee_household_member: 'additional' with no id always INSERTs a fresh row (never an upsert); delete of an additional requires the id", () => {
  const additionalBranch = blockBetween(
    /IF p_person_role = 'additional' THEN/,
    /RETURN v_after;\s*\n\s*END IF;/,
    MANAGE_RPC,
  );
  assert.match(additionalBranch, /IF p_delete THEN\s*\n\s*RAISE EXCEPTION 'household_member_id_required';/);
  assert.match(
    additionalBranch,
    /SELECT coalesce\(max\(hm\.sort_order\), -1\) \+ 1 INTO v_next_sort/,
  );
  assert.match(
    additionalBranch,
    /INSERT INTO public\.attendee_household_members \([\s\S]*?person_role, sort_order,[\s\S]*?\)\s*\n\s*VALUES \(\s*\n\s*v_event_id, p_attendee_id, 'additional', v_next_sort,/,
  );
  // no ON CONFLICT anywhere in the additional branch
  assert.equal(/ON CONFLICT/.test(additionalBranch), false);
  assert.match(additionalBranch, /auth\.uid\(\), 'created', NULL,/);
});

test("manage_attendee_household_member: pilot/copilot keep role-based singleton upsert/delete, now arbitrated by the partial index", () => {
  assert.match(
    MANAGE_RPC,
    /ON CONFLICT \(attendee_id, person_role\) WHERE person_role IN \('pilot', 'copilot'\)\s*\n\s*DO UPDATE SET/,
  );
  assert.match(
    MANAGE_RPC,
    /WHERE attendee_id = p_attendee_id AND person_role = p_person_role\s*\n\s*FOR UPDATE;/,
  );
  assert.match(
    MANAGE_RPC,
    /DELETE FROM public\.attendee_household_members\s*\n\s*WHERE attendee_id = p_attendee_id AND person_role = p_person_role;/,
  );
});

test("manage_attendee_household_member preserves event derivation, event.attendees.manage authority, the audit surface, and touches no identity table", () => {
  assert.match(MANAGE_RPC, /SELECT a\.event_id INTO v_event_id FROM public\.attendees AS a WHERE a\.id = p_attendee_id;/);
  assert.match(MANAGE_RPC, /IF NOT public\.has_event_task_authority\('event\.attendees\.manage', v_event_id\) THEN\s*\n\s*RAISE EXCEPTION 'unauthorized';/);
  assert.match(MANAGE_RPC, /INSERT INTO public\.attendee_household_member_command_audit \(/);
  assert.equal(/person_role_instances|person_event_participations|attendees\.person_id|UPDATE public\.attendees/.test(MANAGE_RPC), false);
  assert.match(MANAGE_RPC, /SECURITY DEFINER/);
});

// ── Part 2: record_participant_capacity_increase ──────────────────────

test("record_participant_capacity_increase: signature and atomic raise+add behaviour unchanged", () => {
  // Same 13-arg signature, CREATE OR REPLACE (not a new signature).
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.record_participant_capacity_increase\(/);
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.record_participant_capacity_increase\(\s*uuid, integer, text, text, text, text, text, text, text, text, text, text, text\s*\) TO authenticated;/,
  );
  // capacity raise, audit, and the final roster<=capacity gate all still present
  assert.match(CAPACITY_RPC, /PERFORM set_config\('epicentrax\.capacity_increase_authorized', 'true', true\);/);
  assert.match(CAPACITY_RPC, /UPDATE public\.attendees AS a\s*\n\s*SET participant_capacity = p_new_capacity/);
  assert.match(CAPACITY_RPC, /INSERT INTO public\.participant_capacity_adjustments \(/);
  assert.match(CAPACITY_RPC, /IF v_roster_count > p_new_capacity THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(CAPACITY_RPC, /IF NOT public\.has_event_task_authority\('event\.attendees\.manage', v_event_id\) THEN/);
  // still one participant per call
  assert.match(CAPACITY_RPC, /Only one participant role may be added with a single capacity increase\./);
});

test("record_participant_capacity_increase: the 'additional' branch INSERTs a NEW participant row (no role-based upsert collision); copilot branch keeps its upsert via the partial index", () => {
  // Anchor to the step-8 household-write branch (there is also a step-5
  // validation branch with the same ELSIF text).
  const additionalBranch = blockBetween(
    /ELSIF p_participant_role = 'additional' THEN\s*\n\s*-- A capacity-increase-with-participant/,
    /END IF;\s*\n\s*-- 9\./,
    CAPACITY_RPC,
  );
  assert.equal(/ON CONFLICT/.test(additionalBranch), false);
  assert.match(additionalBranch, /SELECT coalesce\(max\(hm\.sort_order\), -1\) \+ 1 INTO v_additional_next_sort/);
  assert.match(additionalBranch, /INSERT INTO public\.attendee_household_members \([\s\S]*?person_role, sort_order,[\s\S]*?RETURNING \* INTO v_after_household;/);
  assert.match(additionalBranch, /v_auth_user_id, 'created', NULL,/);

  const copilotBranch = blockBetween(
    /IF p_participant_role = 'copilot' THEN\s*\n\s*v_copilot_display_name/,
    /ELSIF p_participant_role = 'additional' THEN\s*\n\s*-- A capacity-increase-with-participant/,
    CAPACITY_RPC,
  );
  assert.match(
    copilotBranch,
    /ON CONFLICT \(attendee_id, person_role\) WHERE person_role IN \('pilot', 'copilot'\)\s*\n\s*DO UPDATE SET/,
  );
});

test("no identity-table schema change anywhere in the migration", () => {
  assert.equal(
    /(CREATE|ALTER|DROP) TABLE public\.(person_role_instances|person_event_participations|people|person_identifiers|person_auth_accounts|identity_[a-z_]+)/.test(EXEC),
    false,
  );
});
