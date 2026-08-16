import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260815100000_create_person_event_participation_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("creates one canonical Person x Event participation row", () => {
  assert.match(executableSql, /CREATE TABLE public\.person_event_participations/);
  assert.match(executableSql, /person_id uuid NOT NULL REFERENCES public\.people\(id\) ON DELETE CASCADE/);
  assert.match(executableSql, /event_id uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE CASCADE/);
  assert.match(executableSql, /UNIQUE \(person_id, event_id\)/);
  assert.equal(/tenant_id uuid/.test(executableSql), false);
});

test("participation state is independent of Event and attendee lifecycle", () => {
  assert.match(executableSql, /participation_state IN \('eligible', 'revoked'\)/);
  assert.equal(/attendees\.is_active/.test(executableSql), false);
  assert.equal(/registration_status/.test(executableSql), false);
  assert.equal(/event_effective_lifecycle_state/.test(executableSql), false);
  assert.equal(/e\.is_active/.test(executableSql), false);
});

test("preserves append-only multi-role evidence without source-row foreign keys", () => {
  assert.match(executableSql, /CREATE TABLE public\.person_event_participation_evidence/);
  assert.match(executableSql, /source_role_kind text CHECK/);
  assert.match(executableSql, /lifecycle_action IN \('established', 'evidence_added', 'revoked', 'restored'\)/);
  assert.match(executableSql, /CREATE UNIQUE INDEX person_event_participation_evidence_source_unique/);
  assert.match(executableSql, /BEFORE UPDATE OR DELETE ON public\.person_event_participation_evidence/);
  assert.equal(/source_record_id uuid REFERENCES/.test(executableSql), false);
});

test("supports future COPILOT and GUEST evidence without changing person_role_instances", () => {
  const participationSql = executableSql.slice(
    executableSql.indexOf("CREATE TABLE public.person_event_participations"),
  );
  assert.equal(/ALTER TABLE public\.person_role_instances/.test(participationSql), false);
  assert.equal(/identity_role IN/.test(participationSql), false);
  assert.match(participationSql, /p_source_role_kind text/);
});

test("internal establishment requires governed source evidence and current safe producer derives it from a role instance", () => {
  const writer = executableSql.match(/CREATE OR REPLACE FUNCTION public\.establish_person_event_participation_from_governed_evidence[\s\S]*?\n\$\$;/);
  assert.ok(writer);
  assert.match(writer[0], /participation evidence requires governed Person, Event, source, and role evidence/);
  assert.match(writer[0], /participation Event does not exist/);
  assert.match(writer[0], /revoked participation cannot be re-established/);
  assert.match(executableSql, /CREATE OR REPLACE FUNCTION public\.establish_person_event_participation_from_role_instance/);
  assert.match(executableSql, /FROM public\.person_role_instances pri/);
  assert.match(executableSql, /'person_role_instance'/);
});

test("safe deterministic backfill uses only existing governed role instances", () => {
  const backfill = executableSql.match(/DO \$\$[\s\S]*?PERFORM public\.establish_person_event_participation_from_role_instance[\s\S]*?END;\n\$\$;/);
  assert.ok(backfill);
  assert.match(backfill[0], /SELECT pri\.id\s+FROM public\.person_role_instances pri/);
  assert.equal(/FROM public\.attendees/.test(backfill[0]), false);
  assert.equal(/FROM public\.attendee_household_members/.test(backfill[0]), false);
});

test("revocation is explicit, auditable, and cannot be accidental reactivation", () => {
  const revoker = executableSql.match(/CREATE OR REPLACE FUNCTION public\.revoke_person_event_participation[\s\S]*?\n\$\$;/);
  assert.ok(revoker);
  assert.match(revoker[0], /participation revocation requires a target and reason/);
  assert.match(revoker[0], /participation_state = 'revoked'/);
  assert.match(revoker[0], /'revoked', 'governed_revocation'/);
  assert.match(revoker[0], /missing or already revoked/);
});

test("eligible-event helper derives Person from auth.uid and returns only eligible existing Events", () => {
  const helper = executableSql.match(/CREATE OR REPLACE FUNCTION public\.list_my_eligible_person_event_ids\(\)[\s\S]*?\n\$\$;/);
  assert.ok(helper);
  assert.match(helper[0], /public\.resolve_auth_person_link\(auth\.uid\(\)\)/);
  assert.match(helper[0], /JOIN public\.events e ON e\.id = pep\.event_id/);
  assert.match(helper[0], /pep\.participation_state = 'eligible'/);
  assert.equal(/p_person_id/.test(helper[0]), false);
  assert.equal(/e\.(visible_to_members|is_active|lifecycle_state|status)/.test(helper[0]), false);
});

test("tables and writers are closed while the actor-derived helper is authenticated-only", () => {
  for (const table of ["person_event_participations", "person_event_participation_evidence"]) {
    assert.match(executableSql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(executableSql, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated, service_role;`));
  }
  for (const fn of [
    "establish_person_event_participation_from_governed_evidence\\(uuid, uuid, text, text, uuid, text, uuid, text, jsonb\\)",
    "establish_person_event_participation_from_role_instance\\(uuid, uuid\\)",
    "revoke_person_event_participation\\(uuid, uuid, text\\)",
  ]) {
    assert.match(executableSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn} FROM PUBLIC, anon, authenticated, service_role;`));
  }
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.list_my_eligible_person_event_ids\(\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.list_my_eligible_person_event_ids\(\) TO authenticated;/);
});
