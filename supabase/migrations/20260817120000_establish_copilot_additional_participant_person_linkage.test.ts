import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260817120000_establish_copilot_additional_participant_person_linkage.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

function section(name: string, nextName?: string) {
  const start = executableSql.indexOf(name);
  assert.notEqual(start, -1, `expected to find ${name}`);
  const end = nextName ? executableSql.indexOf(nextName, start) : executableSql.length;
  assert.ok(end > start, `expected to find ${nextName} after ${name}`);
  return executableSql.slice(start, end);
}

test("person_role_instances gains COPILOT without loosening PILOT/HOUSEHOLD_MEMBER shapes", () => {
  const constraints = section(
    "ALTER TABLE public.person_role_instances",
    "CREATE OR REPLACE FUNCTION public.get_unresolved_identity_component_roles",
  );
  assert.match(constraints, /identity_role IN \('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER'\)/);
  assert.match(
    constraints,
    /identity_role IN \('PILOT', 'COPILOT'\)\s*\n\s*AND household_member_id IS NULL\s*\n\s*AND source_table = 'public\.attendees'\s*\n\s*AND source_record_id = attendee_id/,
  );
  assert.match(
    constraints,
    /identity_role = 'HOUSEHOLD_MEMBER'\s*\n\s*AND household_member_id IS NOT NULL\s*\n\s*AND source_table = 'public\.attendee_household_members'/,
  );
});

test("source uniqueness is scoped by identity_role so PILOT and COPILOT no longer collide on the same attendees row", () => {
  const constraints = section(
    "ALTER TABLE public.person_role_instances",
    "CREATE OR REPLACE FUNCTION public.get_unresolved_identity_component_roles",
  );
  assert.match(
    constraints,
    /ADD CONSTRAINT person_role_instances_source_unique\s*\n\s*UNIQUE \(source_table, source_record_id, identity_role\)/,
  );
});

test("attendees.person_id is never made a universal Person slot", () => {
  assert.equal(/ADD COLUMN.*person_id/i.test(executableSql), false);
  assert.equal(/attendee_household_members\s+ADD COLUMN/i.test(executableSql), false);
});

test("unresolved-role discovery is gated per role instance, not per attendee", () => {
  // The old per-attendee gate must be gone from both copies of the
  // discovery query (the shared function and evaluate_member_identity_claim's
  // inline duplicate).
  assert.equal(/FROM public\.attendees a\s*\n\s*WHERE a\.person_id IS NULL/.test(executableSql), false);

  const occurrences = executableSql.match(
    /NOT EXISTS \(\s*SELECT 1\s*\n\s*FROM public\.person_role_instances pri\s*\n\s*WHERE pri\.source_role_instance_key = uri\.role_instance_key\s*\n\s*\)/g,
  );
  assert.ok(occurrences, "expected the per-role NOT EXISTS gate");
  assert.equal(occurrences.length, 2, "expected the gate in both the shared function and evaluate_member_identity_claim's inline copy");
});

test("get_unresolved_identity_component_roles still emits COPILOT sourced from attendees.copilot_* fields", () => {
  const fn = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.get_unresolved_identity_component_roles[\s\S]*?\n\$\$;/,
  );
  assert.ok(fn);
  assert.match(fn[0], /'attendee_copilot:' \|\| a\.id::text/);
  assert.match(fn[0], /'COPILOT'::text,/);
});

test("finalize_member_identity_activation inserts COPILOT role instances", () => {
  const fn = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.finalize_member_identity_activation\([\s\S]*?\n\$\$;/,
  );
  assert.ok(fn);
  assert.match(fn[0], /WHERE cr\.identity_role IN \('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER'\)/);
});

test("the attendees.person_id write and its ownership guard are scoped to PILOT only", () => {
  const fn = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.finalize_member_identity_activation\([\s\S]*?\n\$\$;/,
  );
  assert.ok(fn);
  assert.match(
    fn[0],
    /conflicting_attendees AS \(\s*\n[\s\S]*?WHERE cr\.identity_role = 'PILOT'\s*\n\s*AND a\.person_id IS NOT NULL/,
  );
  assert.match(
    fn[0],
    /UPDATE public\.attendees a\s*\n\s*SET person_id = v_person_id\s*\n\s*WHERE a\.id IN \(\s*\n\s*SELECT DISTINCT cr\.attendee_id\s*\n[\s\S]*?WHERE cr\.identity_role = 'PILOT'\s*\n\s*\)/,
  );
});

test("finalize_member_identity_activation establishes participation for every role instance in the resolved component", () => {
  const fn = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.finalize_member_identity_activation\([\s\S]*?\n\$\$;/,
  );
  assert.ok(fn);
  assert.match(fn[0], /v_component_role_keys text\[\];/);
  assert.match(
    fn[0],
    /PERFORM public\.establish_person_event_participation_from_role_instance\(pri\.id, p_auth_user_id\)\s*\n\s*FROM public\.person_role_instances pri\s*\n\s*WHERE pri\.source_role_instance_key = ANY\(v_component_role_keys\)/,
  );
});

test("resolve_member_account resolves event membership from canonical participation, role-independently", () => {
  const fn = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.resolve_member_account\(\)[\s\S]*?\n\$function\$;/,
  );
  assert.ok(fn);
  assert.equal(/a\.person_id/.test(fn[0]), false);
  assert.match(fn[0], /FROM public\.person_event_participations pep\s*\n\s*JOIN public\.person_role_instances pri/);
  assert.match(fn[0], /pep\.participation_state = 'eligible'/);
  assert.match(fn[0], /SELECT DISTINCT/);
  // Signature and output shape are unchanged, so existing callers are unaffected.
  assert.match(
    fn[0],
    /RETURNS TABLE\(attendee_id uuid, entry_id text, event_id uuid, email text, pilot_first text, pilot_last text, copilot_first text, copilot_last text, has_arrived boolean, event_name text, venue_name text, location text, start_date date, end_date date, lat numeric, lng numeric\)/,
  );
});

test("closes the participation backfill gap for role instances created since the original one-time backfill", () => {
  const backfill = executableSql.match(
    /DO \$\$\s*\nDECLARE\s*\n\s*v_role_id uuid;[\s\S]*?PERFORM public\.establish_person_event_participation_from_role_instance\(v_role_id, NULL\);[\s\S]*?END;\n\$\$;/,
  );
  assert.ok(backfill);
  assert.match(backfill[0], /LEFT JOIN public\.person_event_participations pep/);
  assert.match(backfill[0], /WHERE pep\.id IS NULL/);
});

test("does not touch RLS, grants, or any already-applied migration", () => {
  assert.equal(/DISABLE ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/GRANT .* TO anon/.test(executableSql), false);
  assert.equal(/REVOKE/.test(executableSql), false);
});
