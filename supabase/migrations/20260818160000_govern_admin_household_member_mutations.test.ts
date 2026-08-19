import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Admin household-member mutation governance +
// audit trail workstream. This repository has no live-Postgres test
// harness for any migration (no Docker/local Supabase in this
// environment) -- every sibling migration test proves invariants by
// reading the migration's own SQL source and asserting the required
// properties are structurally present, exactly as
// 20260818140000_cutover_attendees_household_members_task_authority.test.ts
// and its own siblings already do. Run with:
//   npx tsx --test supabase/migrations/20260818160000_govern_admin_household_member_mutations.test.ts

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "./20260818160000_govern_admin_household_member_mutations.sql",
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

const AUDIT_TABLE = blockBetween(
  /CREATE TABLE public\.attendee_household_member_command_audit/,
  /\);/,
);

const MANAGE_RPC = blockBetween(
  /CREATE FUNCTION public\.manage_attendee_household_member/,
  /\$\$;/,
);

const CAPACITY_RPC = blockBetween(
  /CREATE OR REPLACE FUNCTION public\.record_participant_capacity_increase/,
  /\$\$;/,
);

// ---- 1. Audit table shape: no FKs, deny-all, immutable. ----

test("audit table carries no FK on household_member_id, attendee_id, or event_id -- bare uuid NOT NULL so a delete-audit row outlives the row it documents", () => {
  assert.equal(/REFERENCES/.test(AUDIT_TABLE), false);
  assert.match(AUDIT_TABLE, /household_member_id uuid NOT NULL/);
  assert.match(AUDIT_TABLE, /attendee_id uuid NOT NULL/);
  assert.match(AUDIT_TABLE, /event_id uuid NOT NULL/);
});

test("audit table has no authorization_basis column -- matches event_photo_command_audit/agenda_category_command_audit, not the member-side actor_person_id tables", () => {
  assert.equal(/authorization_basis/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/actor_person_id/.test(SOURCE_NO_COMMENTS), false);
});

test("audit table action CHECK is exactly created/updated/deleted", () => {
  assert.match(AUDIT_TABLE, /action text NOT NULL CHECK \(action IN \('created', 'updated', 'deleted'\)\)/);
});

test("audit table is deny-all: RLS enabled and REVOKE ALL from PUBLIC, anon, authenticated, and service_role", () => {
  assert.match(SOURCE, /ALTER TABLE public\.attendee_household_member_command_audit ENABLE ROW LEVEL SECURITY;/);
  assert.match(SOURCE, /REVOKE ALL ON TABLE public\.attendee_household_member_command_audit FROM PUBLIC;/);
  assert.match(SOURCE, /REVOKE ALL ON TABLE public\.attendee_household_member_command_audit FROM anon;/);
  assert.match(SOURCE, /REVOKE ALL ON TABLE public\.attendee_household_member_command_audit FROM authenticated;/);
  assert.match(SOURCE, /REVOKE ALL ON TABLE public\.attendee_household_member_command_audit FROM service_role;/);
});

test("audit table is protected by a BEFORE UPDATE OR DELETE immutability trigger that raises", () => {
  assert.match(
    SOURCE,
    /CREATE TRIGGER prevent_attendee_household_member_command_audit_mutation_trigger\s+BEFORE UPDATE OR DELETE ON public\.attendee_household_member_command_audit/,
  );
  assert.match(SOURCE_NO_COMMENTS, /RAISE EXCEPTION 'attendee_household_member_command_audit is immutable';/);
});

// ---- 2. manage_attendee_household_member: derives Event server-side, never accepts it from the client. ----

test("manage_attendee_household_member never accepts p_event_id as a parameter", () => {
  const signature = MANAGE_RPC.slice(0, MANAGE_RPC.indexOf(")") + 1);
  assert.equal(/p_event_id/.test(signature), false);
});

test("manage_attendee_household_member derives v_event_id from public.attendees, not from client input", () => {
  assert.match(
    MANAGE_RPC,
    /SELECT a\.event_id INTO v_event_id FROM public\.attendees AS a WHERE a\.id = p_attendee_id;/,
  );
});

test("manage_attendee_household_member requires event.attendees.manage on the derived Event", () => {
  assert.match(
    MANAGE_RPC,
    /has_event_task_authority\('event\.attendees\.manage', v_event_id\)/,
  );
});

test("manage_attendee_household_member is SECURITY DEFINER and revoked from anon/service_role, granted only to authenticated", () => {
  assert.match(MANAGE_RPC, /SECURITY DEFINER/);
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.manage_attendee_household_member\([^)]*\) FROM anon;/,
  );
  assert.match(
    SOURCE,
    /REVOKE ALL ON FUNCTION public\.manage_attendee_household_member\([^)]*\) FROM service_role;/,
  );
  assert.match(
    SOURCE,
    /GRANT EXECUTE ON FUNCTION public\.manage_attendee_household_member\([^)]*\) TO authenticated;/,
  );
});

test("manage_attendee_household_member writes exactly one audit row on every branch: create, update, and delete", () => {
  const auditInserts = MANAGE_RPC.match(
    /INSERT INTO public\.attendee_household_member_command_audit/g,
  ) || [];
  assert.equal(auditInserts.length, 2, "one insert in the delete branch, one shared by create/update");
  assert.match(MANAGE_RPC, /'deleted',/);
  assert.match(MANAGE_RPC, /CASE WHEN v_before\.id IS NULL THEN 'created' ELSE 'updated' END/);
});

test("manage_attendee_household_member resolves created-vs-updated from a server-side row lock, never a client-supplied action", () => {
  assert.equal(/p_action/.test(MANAGE_RPC), false);
  assert.match(MANAGE_RPC, /FOR UPDATE;/);
});

// ---- 3. record_participant_capacity_increase: audited, authorization basis untouched. ----

test("record_participant_capacity_increase's authorization check is still is_event_scoped_admin -- not silently reconciled to event.attendees.manage in this workstream", () => {
  assert.match(CAPACITY_RPC, /is_event_scoped_admin\(v_auth_user_id, v_event_id\)/);
  assert.equal(/has_event_task_authority/.test(CAPACITY_RPC), false);
});

test("record_participant_capacity_increase gains exactly two new audit inserts, one per household role branch", () => {
  const auditInserts = CAPACITY_RPC.match(
    /INSERT INTO public\.attendee_household_member_command_audit/g,
  ) || [];
  assert.equal(auditInserts.length, 2);
});

test("record_participant_capacity_increase keeps its own participant_capacity_adjustments audit insert unchanged", () => {
  assert.match(CAPACITY_RPC, /INSERT INTO public\.participant_capacity_adjustments \(/);
});

test("record_participant_capacity_increase signature is unchanged from the live 20260805160000 definition", () => {
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

// ---- 4. Direct-write closure: exact policies dropped, SELECT untouched, done after the RPC exists. ----

test("exactly the three admin mutation policies on attendee_household_members are dropped, and no other policy is touched", () => {
  const drops = SOURCE_NO_COMMENTS.match(/DROP POLICY IF EXISTS "[^"]+"/g) || [];
  assert.deepEqual(
    drops.sort(),
    [
      'DROP POLICY IF EXISTS "admin insert household members"',
      'DROP POLICY IF EXISTS "admin update household members"',
      'DROP POLICY IF EXISTS "admin delete household members"',
    ].sort(),
  );
  assert.equal(/Admins can view household members/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE POLICY/.test(SOURCE_NO_COMMENTS), false);
});

test("authenticated and service_role lose INSERT/UPDATE/DELETE on attendee_household_members, but SELECT is never revoked", () => {
  assert.match(
    SOURCE,
    /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.attendee_household_members FROM authenticated;/,
  );
  assert.match(
    SOURCE,
    /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.attendee_household_members FROM service_role;/,
  );
  assert.equal(/REVOKE[^;]*SELECT[^;]*attendee_household_members/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/attendee_household_members[^;]*REVOKE[^;]*SELECT/.test(SOURCE_NO_COMMENTS), false);
});

test("the closure REVOKE statements appear after both governed RPCs are created and grantable", () => {
  const manageRpcIdx = SOURCE.indexOf("CREATE FUNCTION public.manage_attendee_household_member");
  const capacityRpcIdx = SOURCE.indexOf(
    "CREATE OR REPLACE FUNCTION public.record_participant_capacity_increase",
  );
  const closureIdx = SOURCE.indexOf(
    "REVOKE INSERT, UPDATE, DELETE ON TABLE public.attendee_household_members FROM authenticated;",
  );
  assert.ok(manageRpcIdx > -1 && capacityRpcIdx > -1 && closureIdx > -1);
  assert.ok(closureIdx > manageRpcIdx, "closure must come after manage_attendee_household_member exists");
  assert.ok(closureIdx > capacityRpcIdx, "closure must come after record_participant_capacity_increase is redefined");
});

// ---- Whole-file invariants. ----

test("no member/self-service RPC other than record_participant_capacity_increase is touched", () => {
  assert.equal(
    /submit_member_checkin|save_participant_identity|update_participant_email|finalize_member_identity_activation|increment_attendee_login/.test(
      SOURCE_NO_COMMENTS,
    ),
    false,
  );
});

test("household_member_identity_audit is never referenced -- confirms it is not reused", () => {
  assert.equal(/household_member_identity_audit/.test(SOURCE_NO_COMMENTS), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SOURCE, /^BEGIN;/m);
  assert.match(SOURCE, /^COMMIT;/m);
});
