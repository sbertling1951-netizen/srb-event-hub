import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260825040000_create_governed_attendee_operational_needs.sql", import.meta.url),
  ),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260825040000_attendee_operational_needs_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const ATTENDEE_IMPORT_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260822110000_create_governed_attendee_import_row_commit.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const COMMANDS = [
  {
    name: "set_attendee_name_tag_need",
    input: "p_needs_name_tag",
    field: "needs_name_tag",
    requiredError: "name_tag_need_required",
  },
  {
    name: "set_attendee_coach_plate_need",
    input: "p_needs_coach_plate",
    field: "needs_coach_plate",
    requiredError: "coach_plate_need_required",
  },
] as const;

const EXECUTABLE_SQL = SQL.replace(/^\s*--.*$/gm, "");

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

function functionBody(source: string, name: string) {
  const start = source.indexOf(`FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing ${name} terminator`);
  return source.slice(start, end + "$function$;".length);
}

test("linked rollback fixture installs the exact pending operational-need commands inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("each command accepts only an attendee identity and its one explicit boolean requirement", () => {
  for (const command of COMMANDS) {
    const body = functionBody(EXECUTABLE_SQL, command.name);
    assert.match(
      body,
      new RegExp(
        `FUNCTION public\\.${command.name}\\(\\s*p_attendee_id uuid,\\s*${command.input} boolean\\s*\\)`,
      ),
    );
    assert.doesNotMatch(body, /p_event_id|p_tenant_id|p_actor|p_assigned_site|needs_parking/);
    assert.match(body, new RegExp(`${command.input} IS NULL`));
    assert.match(body, new RegExp(`RAISE EXCEPTION '${command.requiredError}'`));
  }
});

test("the commands derive Event scope from the locked attendee row, require attendees.manage, and enforce lifecycle", () => {
  for (const command of COMMANDS) {
    const body = functionBody(EXECUTABLE_SQL, command.name);
    assert.match(
      body,
      new RegExp(
        `SELECT a\\.event_id, a\\.${command.field}[\\s\\S]*?FROM public\\.attendees AS a[\\s\\S]*?WHERE a\\.id = p_attendee_id[\\s\\S]*?FOR UPDATE`,
      ),
    );
    assert.match(body, /has_event_task_authority\('event\.attendees\.manage', v_event_id\)/);
    assert.match(body, /assert_event_lifecycle_mutable\(v_event_id\)/);
    assert.doesNotMatch(body, /event\.parking\.manage|event\.checkin\.manage/);
  }
});

test("each command updates exactly its own requirement field and has a no-write idempotent branch", () => {
  for (const command of COMMANDS) {
    const body = functionBody(EXECUTABLE_SQL, command.name);
    const updateStart = body.indexOf("UPDATE public.attendees AS a");
    const updateEnd = body.indexOf("RETURNING", updateStart);
    const update = body.slice(updateStart, updateEnd);
    assert.match(update, new RegExp(`SET ${command.field} = ${command.input}`));
    for (const forbidden of [
      "needs_name_tag",
      "needs_coach_plate",
      "needs_parking",
      "has_arrived",
      "assigned_site",
    ]) {
      if (forbidden !== command.field) {
        assert.equal(update.includes(forbidden), false, `${command.name} must not update ${forbidden}`);
      }
    }
    assert.match(body, new RegExp(`v_current_${command.field} IS NOT DISTINCT FROM ${command.input}`));
    assert.match(body, /SELECT 'unchanged'::text, v_event_id, p_attendee_id/);
  }
});

test("manual and governed attendee-import creation retain the existing canonical need defaults", () => {
  const importInsert = ATTENDEE_IMPORT_SQL.match(
    /INSERT INTO public\.attendees\([\s\S]*?\)\s*VALUES\([\s\S]*?\) RETURNING \*/,
  )?.[0];
  assert.ok(importInsert, "missing governed attendee-import INSERT");
  for (const field of ["needs_name_tag", "needs_coach_plate", "needs_parking"]) {
    assert.doesNotMatch(importInsert, new RegExp(field));
  }
  assert.match(FIXTURE, /manual and governed-import default creation both persist all operational needs as true/);
});

test("both commands are security-definer with a fixed path and authenticated-only execution", () => {
  for (const command of COMMANDS) {
    const body = functionBody(EXECUTABLE_SQL, command.name);
    assert.match(body, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
    assert.match(
      EXECUTABLE_SQL,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${command.name}\\(uuid, boolean\\)\\s*\\n\\s*FROM PUBLIC, anon, authenticated, service_role;`,
      ),
    );
    assert.match(
      EXECUTABLE_SQL,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${command.name}\\(uuid, boolean\\)\\s*\\n\\s*TO authenticated;`),
    );
  }
});

test("fixture proves defaults, bidirectional independent corrections, no Parking-style conflict, authority, lifecycle, grants, and cleanup", () => {
  for (const evidence of [
    "manual and governed-import default creation both persist all operational needs as true",
    "Name Tag true to false changes only Name Tag and does not create a Parking-style conflict",
    "Name Tag false to true changes only Name Tag",
    "Coach Plate true to false changes only Coach Plate",
    "Coach Plate false to true changes only Coach Plate",
    "same requested Name Tag need is idempotent",
    "same requested Coach Plate need is idempotent",
    "caller without event.attendees.manage is denied with zero mutation",
    "authority is derived from the attendee Event and cannot cross Events",
    "archived Event lifecycle denial leaves needs untouched",
    "anonymous caller is denied",
    "both operational-need RPC grants are authenticated-only",
    "Attendee operational-needs fixture rollback left residue",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
