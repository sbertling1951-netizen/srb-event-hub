import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Maps / Parking Grant Hardening
// migration. This is a grant-only migration -- no RLS policy, no RPC
// body, no Lifecycle guard, no Authority task key -- so its entire
// effect is provable from its SQL text. Current live grant state
// (pre-apply, unaffected by this unapplied migration) and the
// zero-caller finding for copy_master_map_to_event were independently
// verified by direct catalog query and repository-wide grep as part of
// this change's validation and are reported separately, not re-asserted
// here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814020000_harden_map_parking_table_grants.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814020000_harden_map_parking_table_grants.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("no GRANT statement exists -- this migration only removes privileges", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("parking_sites: anon loses DELETE and TRUNCATE only; authenticated loses TRUNCATE only", () => {
  assert.match(
    executableSql,
    /REVOKE DELETE, TRUNCATE\s*\nON TABLE public\.parking_sites\s*\nFROM anon;/,
  );
  assert.match(
    executableSql,
    /REVOKE TRUNCATE\s*\nON TABLE public\.parking_sites\s*\nFROM authenticated;/,
  );
  const parkingSitesRevokes = executableSql.match(/REVOKE[^;]*ON TABLE public\.parking_sites[^;]*;/g) || [];
  assert.equal(parkingSitesRevokes.length, 2, "expected exactly two REVOKE statements for parking_sites");
  for (const stmt of parkingSitesRevokes) {
    assert.equal(/\bINSERT\b/.test(stmt), false, "authenticated's required INSERT must not be touched");
    assert.equal(/\bUPDATE\b/.test(stmt), false, "authenticated's required UPDATE must not be touched");
    assert.equal(/\bSELECT\b/.test(stmt), false, "SELECT must not be touched");
    if (/FROM authenticated;/.test(stmt)) {
      assert.equal(/\bDELETE\b/.test(stmt), false, "authenticated's required DELETE (master-map publish flow) must not be touched");
    }
  }
});

test("event_map_settings: anon loses all mutation privileges; authenticated loses DELETE and TRUNCATE only", () => {
  assert.match(
    executableSql,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.event_map_settings\s*\nFROM anon;/,
  );
  assert.match(
    executableSql,
    /REVOKE DELETE, TRUNCATE\s*\nON TABLE public\.event_map_settings\s*\nFROM authenticated;/,
  );
  const mapSettingsRevokes = executableSql.match(/REVOKE[^;]*ON TABLE public\.event_map_settings[^;]*;/g) || [];
  assert.equal(mapSettingsRevokes.length, 2, "expected exactly two REVOKE statements for event_map_settings");
  for (const stmt of mapSettingsRevokes) {
    if (/FROM authenticated;/.test(stmt)) {
      assert.equal(/\bINSERT\b/.test(stmt), false, "authenticated's required INSERT (Event map-selection upsert) must not be touched");
      assert.equal(/\bUPDATE\b/.test(stmt), false, "authenticated's required UPDATE (map reassignment / upsert) must not be touched");
    }
    assert.equal(/\bSELECT\b/.test(stmt), false, "SELECT must not be touched");
  }
});

test("copy_master_map_to_event: EXECUTE revoked from PUBLIC and anon only -- authenticated and service_role are left untouched", () => {
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.copy_master_map_to_event\(uuid, uuid\)\s*\nFROM PUBLIC, anon;/,
  );
  const functionRevokes = executableSql.match(/REVOKE[^;]*ON FUNCTION[^;]*;/g) || [];
  assert.equal(functionRevokes.length, 1, "expected exactly one function REVOKE");
  assert.equal(/\bauthenticated\b/.test(functionRevokes[0]), false);
  assert.equal(/\bservice_role\b/.test(functionRevokes[0]), false);
});

test("no other function is created, replaced, dropped, or otherwise touched", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/DROP FUNCTION/.test(executableSql), false);
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no Lifecycle guard or Authority task key is introduced", () => {
  assert.equal(/assert_event_lifecycle_mutable/.test(executableSql), false);
  assert.equal(/has_event_task_authority/.test(executableSql), false);
  assert.equal(/admin_task_registry/.test(executableSql), false);
});

test("governed repair/correction machinery is completely untouched", () => {
  for (const forbidden of [
    "parking_repair",
    "master_site_identity_correction",
    "parking_inventory_quiescence",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});

test("no other domain is touched: no Agenda/Photo/Presentation/Announcements/Evaluation table reference", () => {
  for (const forbidden of [
    "agenda_items",
    "event_photos",
    "presentation_decks",
    "announcements",
    "event_evaluations",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});

test("exactly five REVOKE statements total", () => {
  const revokeStatements = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokeStatements.length, 5);
});
