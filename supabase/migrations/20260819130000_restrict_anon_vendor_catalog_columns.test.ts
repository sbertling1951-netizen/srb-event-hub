import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the anon column-level restriction on
// public.vendors / public.event_vendors. Live REST/PostgREST behavior
// (allowed columns succeed; denied columns and select=* fail closed with
// 42501; both consumers' real embedded query shapes succeed against real
// data; a missing required filter/join column fails the whole query;
// Event-row-scoping via RLS is unaffected) is reported separately, not
// re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260819130000_restrict_anon_vendor_catalog_columns.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260819130000_restrict_anon_vendor_catalog_columns.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

test("anon's table-level grant is fully revoked on both tables before being narrowed", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON TABLE public\.vendors FROM anon;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON TABLE public\.event_vendors FROM anon;/,
  );
});

test("REFERENCES and TRIGGER are restored for anon on both tables (DDL-adjacent, not data access)", () => {
  assert.match(
    executableSql,
    /GRANT REFERENCES, TRIGGER ON TABLE public\.vendors TO anon;/,
  );
  assert.match(
    executableSql,
    /GRANT REFERENCES, TRIGGER ON TABLE public\.event_vendors TO anon;/,
  );
});

test("anon vendors column grant is exactly the attendee-safe + filter-required set -- no governance column", () => {
  const grantMatch = executableSql.match(
    /GRANT SELECT \(([^)]+)\) ON public\.vendors TO anon;/,
  );
  assert.ok(grantMatch, "expected a column-scoped GRANT SELECT on vendors");
  const columns = grantMatch[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  assert.deepEqual(
    new Set(columns),
    new Set([
      "id",
      "business_name",
      "email",
      "phone",
      "website",
      "logo_url",
      "business_description",
      "preferred_contact_method",
      "is_active",
    ]),
  );

  for (const excluded of ["contact_name", "created_at", "name", "services", "notes"]) {
    assert.equal(columns.includes(excluded), false, `must not grant ${excluded}`);
  }
});

test("anon event_vendors column grant is exactly the attendee-safe + filter/join-required set -- no governance column", () => {
  const grantMatch = executableSql.match(
    /GRANT SELECT \(([^)]+)\) ON public\.event_vendors TO anon;/,
  );
  assert.ok(grantMatch, "expected a column-scoped GRANT SELECT on event_vendors");
  const columns = grantMatch[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  assert.deepEqual(
    new Set(columns),
    new Set([
      "id",
      "event_id",
      "vendor_id",
      "is_featured",
      "display_order",
      "signup_url",
      "event_note",
      "is_visible_to_members",
      "action_type",
    ]),
  );

  for (const excluded of [
    "created_at",
    "booth_location",
    "show_on_member_dashboard",
    "allow_service_requests",
    "status",
    "notes",
    "application_id",
    "admission_state",
    "admitted_at",
    "admitted_by_auth_user_id",
    "admitted_by_admin_user_id",
    "admission_authority_basis",
    "current_disposition_id",
  ]) {
    assert.equal(columns.includes(excluded), false, `must not grant ${excluded}`);
  }
});

test("no anon INSERT/UPDATE/DELETE/TRUNCATE privilege is introduced on either table", () => {
  for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
    const re = new RegExp(`GRANT[^;]*\\b${priv}\\b[^;]*TO anon;`);
    assert.equal(re.test(executableSql), false, `must not grant ${priv} to anon`);
  }
});

test("authenticated and service_role are never named -- this migration touches anon only", () => {
  assert.equal(/\bauthenticated\b/.test(executableSql), false);
  assert.equal(/\bservice_role\b/.test(executableSql), false);
});

test("no RLS policy is touched: no DROP POLICY, CREATE POLICY, or ALTER TABLE ... ROW LEVEL SECURITY statement", () => {
  assert.equal(/DROP POLICY/.test(executableSql), false);
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no view, function, or schema object is created -- grant-only migration", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/CREATE (OR REPLACE )?VIEW/.test(executableSql), false);
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE public\.\w+ (ADD|DROP|ALTER) COLUMN/.test(executableSql), false);
});

test("no other domain/table is referenced: not vendor_event_status, vendor_contacts, vendor_org_access, or vendor_service_requests", () => {
  for (const forbidden of [
    "vendor_event_status",
    "vendor_contacts",
    "vendor_org_access",
    "vendor_service_requests",
    "resolve_attendee_visible_vendor_notices",
    "event_nearby_places",
    "event_locations",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
