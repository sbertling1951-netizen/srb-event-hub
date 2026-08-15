import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Public Event Read Surface Split,
// Stage 1 ACL hardening. This migration is purely a REVOKE -- no
// function body, predicate, or column projection is touched. Live ACL
// state after apply is verified separately and reported, not re-asserted
// here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814170000_harden_public_event_read_surface_acls.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814170000_harden_public_event_read_surface_acls.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("exactly two REVOKE EXECUTE statements, both targeting service_role only", () => {
  const revokes = executableSql.match(/REVOKE[^;]*;/g) || [];
  assert.equal(revokes.length, 2);
  for (const stmt of revokes) {
    assert.match(stmt, /REVOKE EXECUTE ON FUNCTION public\.\w+\([^)]*\) FROM service_role;/);
  }
});

test("revokes target exactly get_public_discoverable_events() and get_event_continuity_context(uuid)", () => {
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.get_public_discoverable_events\(\) FROM service_role;/,
  );
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.get_event_continuity_context\(uuid\) FROM service_role;/,
  );
});

test("no GRANT statement exists -- this migration only removes a privilege", () => {
  assert.equal(/\bGRANT\b/.test(executableSql), false);
});

test("anon and authenticated are never named -- their EXECUTE grant from 20260814160000 is untouched", () => {
  assert.equal(/\banon\b/.test(executableSql), false);
  assert.equal(/\bauthenticated\b/.test(executableSql), false);
});

test("no function is created, replaced, or dropped -- ACL-only change", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/DROP FUNCTION/.test(executableSql), false);
  assert.equal(/SECURITY DEFINER/.test(executableSql), false);
  assert.equal(/search_path/.test(executableSql), false);
});

test("no RLS policy, table grant, or other table is touched", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ON TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
});

test("no other domain is touched", () => {
  for (const forbidden of [
    "vendors",
    "parking_sites",
    "event_map_settings",
    "event_evaluations",
    "announcements",
    "attendees",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope`,
    );
  }
});
