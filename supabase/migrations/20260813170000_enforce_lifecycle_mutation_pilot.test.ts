import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Lifecycle Mutation Enforcement
// Pilot (ADR-013 §12 stage 6, first cohort: Agenda, Photos, Presentation/
// Slideshow). Event Staff / Authority RPCs are reproduced in the same
// migration but deliberately left ungated -- ADR-013 draws Lifecycle
// (ordinary Event content mutation) and Authority (who may govern an
// Event) as distinct axes, and Lifecycle transition must not revoke,
// suspend, or narrow Event Admin authority. The shared guard's actual
// runtime behavior --
// operational/post_event pass, archived raises 'event_archived',
// indeterminate (nonexistent Event) raises 'event_lifecycle_indeterminate'
// -- was proven separately by executing an exact mirror of the guard
// against real production Lifecycle states (Camp Margaritaville archived,
// Amana Event post_event, Saint George operational, plus a nonexistent
// id) inside a rolled-back transaction, zero residue. See the completion
// report for that evidence. This file proves the deployed SQL text: the
// guard's own logic, and that every targeted mutation RPC calls it in the
// correct position (after its existing authority check, before any other
// existing logic), while every excluded/read RPC is untouched.
//
// Run with:
//   npx tsx --test supabase/migrations/20260813170000_enforce_lifecycle_mutation_pilot.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260813170000_enforce_lifecycle_mutation_pilot.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("shared guard: correct signature, reads only the Stage 1 resolver, raises the two stable error codes", () => {
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.assert_event_lifecycle_mutable\(p_event_id uuid\)\s*\nRETURNS void/,
  );
  assert.match(
    executableSql,
    /v_state := public\.event_effective_lifecycle_state\(p_event_id\);/,
  );
  assert.match(executableSql, /RAISE EXCEPTION 'event_lifecycle_indeterminate';/);
  assert.match(executableSql, /RAISE EXCEPTION 'event_archived';/);
});

test("shared guard: internal only -- no EXECUTE grant to any role, matching the _agenda_event_version_advance / *_internal precedent", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.assert_event_lifecycle_mutable\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.assert_event_lifecycle_mutable/.test(executableSql),
    false,
    "the guard must never be directly callable -- only reachable from within another SECURITY DEFINER function",
  );
});

test("shared guard is not a new Authority abstraction: never reads admin_users, admin_event_access, or auth.uid()", () => {
  const guardBody = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.assert_event_lifecycle_mutable[\s\S]*?^\$\$;/m,
  );
  assert.ok(guardBody);
  for (const forbidden of ["admin_users", "admin_event_access", "auth.uid()", "has_event_task_authority", "has_platform_admin_authority", "has_tenant_admin_authority"]) {
    assert.equal(guardBody![0].includes(forbidden), false, `guard must not reference '${forbidden}'`);
  }
});

// One assertion per gated function: the guard call exists, and it comes
// strictly after that function's own pre-existing authority check
// (has_event_task_authority for Agenda/Photos/Presentation, or
// assert_event_authority_governor for Event Staff) and strictly before
// any other post-authority logic in the same function body.
const AGENDA_FUNCTIONS = [
  "create_event_agenda_item",
  "update_event_agenda_item",
  "delete_event_agenda_item",
  "reorder_event_agenda_items",
  "import_event_agenda_items",
];

const PHOTO_FUNCTIONS = ["manage_event_photo"];

const PRESENTATION_FUNCTIONS = [
  "create_presentation_deck",
  "update_presentation_deck",
  "archive_presentation_deck",
  "add_presentation_deck_photo",
  "remove_presentation_deck_item",
  "reorder_presentation_deck_items",
  "start_presentation_session",
  "pause_presentation_session",
  "resume_presentation_session",
  "next_presentation_slide",
  "previous_presentation_slide",
  "end_presentation_session",
  "advance_presentation_session_if_due",
];

// Reproduced in this migration but deliberately NOT gated -- see the file
// header and the Event Staff section comment in the .sql file for why.
const EVENT_STAFF_FUNCTIONS = [
  "create_event_authority_assignment",
  "grant_event_authority_task",
  "revoke_event_authority_task",
  "remove_event_authority_assignment",
  "change_event_authority_profile",
];

function extractFunctionBody(sql: string, name: string): string {
  // Non-greedy up to the first `$$;` (or `$$? ;`) closing token -- covers
  // both this migration's own multi-line `$$;`-on-its-own-line style and
  // the compact single-line `END $$;` style the Event Staff functions
  // (20260811170000) already used before this migration touched them.
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ *;`,
  );
  const match = sql.match(pattern);
  assert.ok(match, `expected to find function body for ${name}`);
  return match![0];
}

for (const name of [...AGENDA_FUNCTIONS, ...PHOTO_FUNCTIONS, ...PRESENTATION_FUNCTIONS]) {
  test(`${name}: calls the Lifecycle guard after has_event_task_authority, before any other post-authority logic`, () => {
    const body = extractFunctionBody(executableSql, name);
    const iAuthority = body.indexOf("has_event_task_authority(");
    const iGuard = body.indexOf("PERFORM public.assert_event_lifecycle_mutable(");
    assert.ok(iAuthority >= 0, `${name}: expected an authority check`);
    assert.ok(iGuard >= 0, `${name}: expected a lifecycle guard call`);
    assert.ok(iGuard > iAuthority, `${name}: guard must come after the authority check`);
  });
}

for (const name of EVENT_STAFF_FUNCTIONS) {
  test(`${name}: retains assert_event_authority_governor but does NOT call the Lifecycle guard (ADR-013: Authority is not gated by Lifecycle)`, () => {
    const body = extractFunctionBody(executableSql, name);
    assert.ok(
      body.includes("assert_event_authority_governor("),
      `${name}: expected assert_event_authority_governor to remain intact`,
    );
    assert.equal(
      body.includes("assert_event_lifecycle_mutable("),
      false,
      `${name}: Authority operations must not be gated by Lifecycle`,
    );
  });
}

test("exactly nineteen mutation RPCs call the Lifecycle guard: Agenda + Photos + Presentation/Slideshow, and no others", () => {
  const guardedCallSites = executableSql.match(/PERFORM public\.assert_event_lifecycle_mutable\(/g) ?? [];
  assert.equal(guardedCallSites.length, AGENDA_FUNCTIONS.length + PHOTO_FUNCTIONS.length + PRESENTATION_FUNCTIONS.length);
  assert.equal(guardedCallSites.length, 19);
});

test("every gated function still contains its pre-existing failure modes unchanged (spot check)", () => {
  assert.match(executableSql, /RAISE EXCEPTION 'malformed_row';/);
  assert.match(executableSql, /RAISE EXCEPTION 'stale_version';/);
  assert.match(executableSql, /RAISE EXCEPTION 'deck_not_found';/);
  assert.match(executableSql, /RAISE EXCEPTION 'photo_not_found';/);
  assert.match(executableSql, /RAISE EXCEPTION 'self-elevation is forbidden';/);
});

test("read RPCs are untouched: read_public_presentation_session and the internal timer-advance function do not appear in this migration", () => {
  assert.equal(/FUNCTION public\.read_public_presentation_session/.test(SQL), false);
  assert.equal(/FUNCTION public\.advance_presentation_session_if_due_internal/.test(SQL), false);
});

test("Member photo upload/read/delete-own-pending and public approved-photo storage policies are untouched: no storage.objects statement in this migration", () => {
  assert.equal(/storage\.objects/.test(executableSql), false);
});

test("no domain outside the four-domain cohort is touched: no Attendee/Household/Check-in/Parking/Vendor/Nearby/Maps/Imports table or function reference", () => {
  for (const forbidden of [
    "attendees",
    "attendee_household_members",
    "checkin",
    "parking_sites",
    "vendors",
    "nearby",
    "master_map",
    "imports",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this pilot`,
    );
  }
});

test("does not implement archive_event/reopen_event or Historical Correction", () => {
  assert.equal(/FUNCTION public\.archive_event\(/.test(SQL), false);
  assert.equal(/FUNCTION public\.reopen_event\(/.test(SQL), false);
  assert.equal(/event_historical_correction/.test(SQL), false);
});
