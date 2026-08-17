import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Granular Attendee Sharing
// foundation migration. No live/linked database was used to validate this
// migration -- see the workstream's final report for why, and for the
// manual review this substitutes for. These tests prove what the SQL text
// itself commits to: registry shape, deny-by-default grants/RLS, which
// fields each governed RPC can possibly return, and that no legacy
// consent is silently broadened.
//
// Run with:
//   npx tsx --test supabase/migrations/20260816140000_create_attendee_sharing_governed_foundation.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260816140000_create_attendee_sharing_governed_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("field registry seeds exactly the five locked v1 keys, Name mandatory, four optional", () => {
  assert.match(
    executableSql,
    /INSERT INTO public\.attendee_sharing_fields[\s\S]*?VALUES[\s\S]*?\('name', 'Name', true, 0\)/,
  );
  for (const key of ["email", "phone", "campsite_location", "coach_make_model"]) {
    const re = new RegExp(`\\('${key}', '[^']+', false,`);
    assert.match(executableSql, re, `expected ${key} to be seeded as optional (is_mandatory_identity = false)`);
  }
  const seedBlock = executableSql.match(
    /INSERT INTO public\.attendee_sharing_fields[\s\S]*?VALUES([\s\S]*?);/,
  )?.[1];
  assert.ok(seedBlock, "expected a field registry seed VALUES block");
  const rows = seedBlock!.match(/\([^)]*\)/g) || [];
  assert.equal(rows.length, 5, "expected exactly five registered field keys in v1");
});

test("no excluded field ever appears as a registry key: length, year, VIN, plate, household, or operational flags", () => {
  for (const forbidden of [
    "coach_length",
    "coach_year",
    "vin",
    "license_plate",
    "household",
    "first_time",
    "volunteer",
    "handicap",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(`'${forbidden}'`),
      false,
      `'${forbidden}' must never be a registered attendee_sharing_fields key`,
    );
  }
});

test("preference and history tables are owned by postgres, RLS-enabled, and carry no direct grant to any client role", () => {
  for (const tbl of [
    "attendee_sharing_fields",
    "attendee_sharing_preferences",
    "attendee_sharing_preference_history",
  ]) {
    assert.match(
      executableSql,
      new RegExp(`ALTER TABLE public\\.${tbl} ENABLE ROW LEVEL SECURITY;`),
      `${tbl} must enable RLS`,
    );
    assert.match(
      executableSql,
      new RegExp(`REVOKE ALL ON TABLE public\\.${tbl} FROM PUBLIC, anon, authenticated, service_role;`),
      `${tbl} must revoke all direct client/service-role grants`,
    );
  }
});

test("no CREATE POLICY exists for any new table -- deny-by-default, RPC-only access", () => {
  assert.equal(/CREATE POLICY/.test(executableSql), false);
});

test("preference table enforces one row per attendee per field and references the governed registry", () => {
  assert.match(
    executableSql,
    /attendee_id uuid NOT NULL REFERENCES public\.attendees\(id\)/,
  );
  assert.match(
    executableSql,
    /field_key text NOT NULL REFERENCES public\.attendee_sharing_fields\(field_key\)/,
  );
  assert.match(
    executableSql,
    /CONSTRAINT attendee_sharing_preferences_attendee_field_unique UNIQUE \(attendee_id, field_key\)/,
  );
});

test("history table is append-only: an immutable-mutation trigger blocks UPDATE and DELETE", () => {
  assert.match(
    executableSql,
    /CREATE TRIGGER prevent_attendee_sharing_history_mutation_trigger\s*\n\s*BEFORE UPDATE OR DELETE ON public\.attendee_sharing_preference_history/,
  );
});

test("the internal apply helper is unreachable by any client or service-role caller", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\._apply_attendee_sharing_preferences\(uuid, text\[\], text, uuid, uuid\)\s*\nFROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\._apply_attendee_sharing_preferences/.test(executableSql),
    false,
    "the internal helper must never be directly GRANTed to any role",
  );
});

test("unknown/unregistered share keys fail the whole call closed before any write", () => {
  const helperBody = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\._apply_attendee_sharing_preferences[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(helperBody, "expected to find the internal helper body");
  assert.match(helperBody!, /RAISE EXCEPTION 'unknown_share_field';/);
  // The validation raise must appear before the field-upsert loop begins.
  const validateIdx = helperBody!.indexOf("unknown_share_field");
  const loopIdx = helperBody!.indexOf("FOR v_field IN");
  assert.ok(validateIdx >= 0 && loopIdx > validateIdx, "key validation must precede any upsert");
});

test("mandatory identity (name) can never be requested directly as a client-supplied key -- it is always derived", () => {
  const helperBody = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\._apply_attendee_sharing_preferences[\s\S]*?\$\$;/,
  )?.[0];
  assert.match(helperBody!, /AND NOT f\.is_mandatory_identity/);
  assert.match(helperBody!, /WHEN v_field\.is_mandatory_identity THEN v_participates/);
});

test("set_attendee_sharing_preferences re-derives Event authority server-side and is never anon-callable", () => {
  const fnBody = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.set_attendee_sharing_preferences[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(fnBody, "expected set_attendee_sharing_preferences body");
  assert.match(fnBody!, /has_event_task_authority\('event\.checkin\.manage', v_event_id\)/);
  assert.match(fnBody!, /has_event_task_authority\('event\.parking\.manage', v_event_id\)/);
  assert.match(fnBody!, /RAISE EXCEPTION 'event_scope_mismatch';/);
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.set_attendee_sharing_preferences\(uuid, uuid, text\[\]\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.set_attendee_sharing_preferences\(uuid, uuid, text\[\]\)\s*\nTO authenticated;/,
  );
});

test("get_admin_attendee_sharing_preferences re-derives Event authority and is never anon-callable", () => {
  const fnBody = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.get_admin_attendee_sharing_preferences[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(fnBody, "expected get_admin_attendee_sharing_preferences body");
  assert.match(fnBody!, /has_event_task_authority\('event\.checkin\.manage', p_event_id\)/);
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_admin_attendee_sharing_preferences\(uuid\)\s*\nTO authenticated;/,
  );
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.get_admin_attendee_sharing_preferences\(uuid\)\s*\nTO anon/.test(executableSql),
    false,
  );
});

test("legacy backfill maps Yes to Name+Email only, and No to nothing -- no other key inherits legacy consent", () => {
  const backfillBlock = executableSql.match(
    /WITH backfill AS \([\s\S]*?\)\nINSERT INTO public\.attendee_sharing_preference_history[\s\S]*?FROM inserted;/,
  )?.[0];
  assert.ok(backfillBlock, "expected the legacy backfill CTE block");
  assert.match(
    backfillBlock!,
    /WHEN f\.field_key IN \('name', 'email'\) THEN coalesce\(a\.share_with_attendees, false\)/,
  );
  assert.match(backfillBlock!, /ELSE false\s*END AS shared/);
  assert.match(backfillBlock!, /ON CONFLICT \(attendee_id, field_key\) DO NOTHING/);
});

test("get_event_attendee_locator drops every non-approved field and never selects the legacy blanket flag", () => {
  const fnBody = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.get_event_attendee_locator[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(fnBody, "expected get_event_attendee_locator body");
  for (const forbidden of [
    "is_first_timer",
    "wants_to_volunteer",
    "handicap_parking",
    "coach_length",
    "entry_id",
    "share_with_attendees",
    "has_arrived",
    "copilot_first",
    "copilot_last",
  ]) {
    assert.equal(
      fnBody!.includes(forbidden),
      false,
      `get_event_attendee_locator must not reference '${forbidden}'`,
    );
  }
  assert.match(fnBody!, /AND name_pref\.shared = true/, "target must participate (Name shared) to be returned");
  assert.match(
    fnBody!,
    /LEFT JOIN public\.parking_sites AS site\s*\n\s*ON site\.event_id = a\.event_id AND site\.assigned_attendee_id = a\.id/,
    "campsite must resolve through governed parking_sites occupancy",
  );
  assert.equal(
    /a\.assigned_site/.test(fnBody!),
    false,
    "campsite must never be sourced from the unmigrated free-text assigned_site column",
  );
});

test("get_event_locator_household_members keeps its body untouched (repair forward) and loses execute grants", () => {
  assert.equal(
    /CREATE OR REPLACE FUNCTION public\.get_event_locator_household_members/.test(executableSql),
    false,
    "the household-members function body must not be edited by this migration",
  );
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.get_event_locator_household_members\(uuid, text, text\)\s*\nFROM anon, authenticated;/,
  );
});

test("get_event_public_roster stays non-reciprocal, drops Co-pilot and non-approved fields, keeps Arrival independent", () => {
  const fnBody = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.get_event_public_roster[\s\S]*?\$\$;/,
  )?.[0];
  assert.ok(fnBody, "expected get_event_public_roster body");
  assert.equal(
    /resolve_temporary_or_authenticated_attendee/.test(fnBody!),
    false,
    "the public roster must remain a one-way broadcast -- no caller identity resolution",
  );
  for (const forbidden of ["copilot_first", "copilot_last", "coach_length", "assigned_site", "share_with_attendees"]) {
    assert.equal(fnBody!.includes(forbidden), false, `get_event_public_roster must not reference '${forbidden}'`);
  }
  assert.match(fnBody!, /a\.has_arrived,\s*\n\s*a\.arrival_status/, "Arrival stays untouched and independent");
  assert.match(fnBody!, /AND name_pref\.shared = true/);
});

test("both governed read RPCs are dropped before recreation, since their return shape changed", () => {
  assert.match(executableSql, /DROP FUNCTION IF EXISTS public\.get_event_attendee_locator\(uuid, text, text\);/);
  assert.match(executableSql, /DROP FUNCTION IF EXISTS public\.get_event_public_roster\(uuid\);/);
});
