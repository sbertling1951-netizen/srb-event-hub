import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260619010000_reconcile_pre_history_rls_policies.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL("../integration-tests/20260619010000_pre_history_rls_policies_rollback.sql", import.meta.url),
  ),
  "utf8",
);
const MIGRATIONS_DIR = fileURLToPath(new URL(".", import.meta.url));
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

// The 67 (table, name) pairs that authoritative production carries and no
// tracked migration creates -- derived once from `pg_dump --schema-only`
// of the linked production database.
const EXPECTED: Array<[string, string]> = [
  ["activities", "Allow authenticated delete activities"], ["activities", "Allow authenticated insert activities"],
  ["activities", "Allow authenticated select activities"], ["activities", "Allow authenticated update activities"],
  ["activities", "Public insert activities"], ["activities", "Public read activities"],
  ["activity_registrations", "Public insert activity registrations"], ["activity_registrations", "Public read activity registrations"],
  ["admin_event_access", "Admins can view assigned events"],
  ["admin_permission_audit", "Super admins manage permission audit"],
  ["admin_privilege_group_permissions", "Admins can manage privilege permissions"],
  ["admin_users", "Admins can read their row"], ["admin_users", "Admins can view themselves"],
  ["agenda_categories", "Anyone can view agenda categories"], ["agenda_categories", "public read agenda_categories"],
  ["agenda_items", "Members can view published agenda items"],
  ["announcements", "Admins can delete announcements"], ["announcements", "Admins can insert announcements"],
  ["announcements", "Admins can update announcements"], ["announcements", "Admins can view announcements"],
  ["announcements", "Members can view published announcements"],
  ["area_groups", "Anyone can read area_groups"],
  ["attendees", "Members can view own attendee row"],
  ["engagement_activity", "Authorized admins can view engagement activity"],
  ["event_locations", "Anyone can read event_locations"],
  ["event_map_settings", "Admins can insert event map settings"], ["event_map_settings", "Admins can update event map settings"],
  ["event_map_settings", "Admins can view event map settings"], ["event_map_settings", "public read event_map_settings"],
  ["event_nearby_places", "Anyone can read event_nearby_places"],
  ["event_vendors", "Members can view visible event vendors"],
  ["master_map_locations", "Anyone can read master_map_locations"],
  ["master_map_sites", "Admins can delete master map sites"], ["master_map_sites", "Admins can insert master map sites"],
  ["master_map_sites", "Admins can update master map sites"], ["master_map_sites", "Admins can view master map sites"],
  ["master_map_sites", "public read master_map_sites"],
  ["master_maps", "Admins can insert master maps"], ["master_maps", "Admins can update master maps"],
  ["master_maps", "Admins can view master maps"], ["master_maps", "public read master_maps"],
  ["nearby_area_templates", "Super admins manage nearby templates"],
  ["nearby_areas", "Admins can insert nearby areas"], ["nearby_areas", "Admins can update nearby areas"],
  ["nearby_areas", "public read nearby_areas"],
  ["nearby_categories", "Anyone can read nearby_categories"],
  ["nearby_event", "Admins can manage nearby event"], ["nearby_event", "Anyone can view nearby event"],
  ["nearby_event", "public read nearby_event"],
  ["nearby_master_places", "Anyone can read nearby_master_places"],
  ["nearby_places", "Allow public delete nearby_places"], ["nearby_places", "Allow public insert"],
  ["nearby_places", "Allow public read nearby_places"], ["nearby_places", "Allow public update nearby_places"],
  ["nearby_template_places", "Super admins manage nearby template places"],
  ["parking_sites", "Admins can delete parking sites"], ["parking_sites", "Admins can insert parking sites"],
  ["parking_sites", "Admins can update parking sites"], ["parking_sites", "Admins can view parking sites"],
  ["parking_sites", "Public read parking"], ["parking_sites", "public read parking_sites"],
  ["participant_activity_log", "Authorized admins can view participant activity"],
  ["shared_area_locations", "Anyone can read shared_area_locations"],
  ["test_connection", "Allow anon read on test_connection"],
  ["validation_rules", "public read validation_rules"],
  ["vendor_services", "Admins can manage vendor services"],
  ["vendors", "Members can view active vendors"],
];

// tables that production keeps RLS-enabled with ZERO policies -- must NOT
// gain any policy from this file.
const GROUP_2_DENY_ALL = [
  "admin_event_permissions", "admin_permission_presets", "evaluation_templates",
  "evaluation_questions", "evaluation_choices", "event_photo_metadata", "photo_display_log",
];

function parityBlock(s: string) {
  const a = s.indexOf("-- PARITY START:");
  const b = s.indexOf("-- PARITY END", a);
  return s.slice(a, b + "-- PARITY END".length).trim();
}

test("recreates exactly the 67 authoritative production-only policies -- each as DROP IF EXISTS then CREATE", () => {
  const created = [...CODE.matchAll(/CREATE POLICY "([^"]+)" ON "public"\."([^"]+)"/g)].map((m) => [m[2], m[1]] as [string, string]);
  assert.equal(created.length, 67, `expected 67 CREATE POLICY, found ${created.length}`);
  const createdSet = new Set(created.map((p) => p.join("|")));
  const expectedSet = new Set(EXPECTED.map((p) => p.join("|")));
  assert.deepEqual([...createdSet].sort(), [...expectedSet].sort(), "policy set must equal the authoritative 67");
  for (const [tbl, name] of EXPECTED) {
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      CODE,
      new RegExp(`DROP POLICY IF EXISTS "${esc(name)}" ON public\\.${esc(tbl)};\\nCREATE POLICY "${esc(name)}" ON "public"\\."${esc(tbl)}"`),
      `"${name}" ON ${tbl} must be DROP-IF-EXISTS then verbatim CREATE`,
    );
  }
  assert.doesNotMatch(CODE, /DROP POLICY (?!IF EXISTS)"/);
});

test("policies are verbatim legacy definitions -- NO modernization to the canonical authority primitives", () => {
  assert.doesNotMatch(CODE, /has_platform_admin_authority|has_event_task_authority|has_tenant_admin_authority|resolve_task_authority/);
  // the legacy predicates are preserved verbatim from the pg_dump output
  // (pg_dump wraps simple predicates in an extra pair of parens -- kept as-is)
  assert.match(CODE, /CREATE POLICY "Members can view published agenda items" ON "public"\."agenda_items" FOR SELECT TO "authenticated", "anon" USING \(\("is_published" = true\)\);/);
  assert.match(CODE, /CREATE POLICY "Members can view published announcements" ON "public"\."announcements" FOR SELECT TO "authenticated", "anon" USING \(\("is_published" = true\)\);/);
  assert.match(CODE, /CREATE POLICY "Members can view own attendee row" ON "public"\."attendees" FOR SELECT TO "authenticated" USING \(\("lower"\("email"\) = "lower"\(\("auth"\."jwt"\(\) ->> 'email'::"text"\)\)\)\);/);
  assert.match(CODE, /CREATE POLICY "Members can view active vendors" ON "public"\."vendors" FOR SELECT TO "authenticated", "anon" USING \(\("is_active" = true\)\);/);
  assert.match(CODE, /CREATE POLICY "public read master_maps" ON "public"\."master_maps" FOR SELECT TO "authenticated", "anon" USING \(true\);/);
  assert.match(CODE, /CREATE POLICY "Members can view visible event vendors" ON "public"\."event_vendors" FOR SELECT TO "authenticated", "anon" USING \(\("is_visible_to_members" = true\)\);/);
});

test("does NOT touch the Group-2 deny-all tables", () => {
  for (const t of GROUP_2_DENY_ALL) {
    assert.doesNotMatch(CODE, new RegExp(`ON "public"\\."${t}"`), `must not add a policy on deny-all table ${t}`);
    assert.doesNotMatch(CODE, new RegExp(`ON public\\.${t};`), `must not DROP on deny-all table ${t}`);
  }
});

test("reconstructs unique_attendee_site_per_event with the exact production expression + partial predicate", () => {
  assert.match(
    CODE,
    /CREATE UNIQUE INDEX IF NOT EXISTS "unique_attendee_site_per_event"\s*\n\s*ON "public"\."attendees" USING "btree"\s*\n\s*\("event_id", "upper"\(TRIM\(BOTH FROM "assigned_site"\)\)\)\s*\n\s*WHERE \(\("assigned_site" IS NOT NULL\) AND \(TRIM\(BOTH FROM "assigned_site"\) <> ''::"text"\)\);/,
  );
});

test("changes NO grant, function, table structure, or FORCE state; adds only policies + the one unique index", () => {
  assert.doesNotMatch(CODE, /\bGRANT\b|\bREVOKE\b/);
  assert.doesNotMatch(CODE, /CREATE (OR REPLACE )?FUNCTION|DROP FUNCTION|ALTER FUNCTION/);
  assert.doesNotMatch(CODE, /CREATE TABLE|DROP TABLE|ADD COLUMN|DROP COLUMN|ADD CONSTRAINT|DROP CONSTRAINT/);
  assert.doesNotMatch(CODE, /FORCE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|ENABLE ROW LEVEL SECURITY/);
  // the only non-policy statement is the unique index
  assert.equal((CODE.match(/CREATE UNIQUE INDEX/g) || []).length, 1);
  assert.doesNotMatch(CODE, /CREATE INDEX /);
});

test("serial 20260619010000 sorts after 20260619000000 and before 20260703_", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const idx = files.indexOf("20260619010000_reconcile_pre_history_rls_policies.sql");
  assert.ok(idx >= 0);
  assert.equal(files[idx - 1], "20260619000000_reconcile_pre_history_rls_enable_state.sql");
  assert.equal(files[idx + 1], "20260703_update_verify_member_event_login_for_phone_auth.sql");
});

test("header forbids production execution and points at the ledger-only reconciliation", () => {
  assert.match(SQL, /DO NOT EXECUTE THIS HISTORICAL RECONCILIATION MIGRATION AGAINST THE/);
  assert.match(SQL, /ESTABLISHED PRODUCTION DATABASE/);
  assert.match(SQL, /migration repair --linked --status applied 20260619010000/);
  assert.match(SQL, /Do NOT do that now/);
});

test("linked rollback fixture carries the byte-identical parity block inside one outer ROLLBACK", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("linked proof fixture asserts policy-by-policy presence and the site-uniqueness invariant", () => {
  for (const evidence of [
    "all 67 reconstructed policies exist with the expected command and roles",
    "the member-facing read policies (agenda_items, announcements, attendees, vendors, master maps) are present",
    "Group-2 deny-all tables gained no policy",
    "unique_attendee_site_per_event enforces one attendee per normalized site per Event",
    "case/whitespace-equivalent site in the same Event is rejected",
    "the same site in a different Event is permitted",
    "pre-history rls policies reconciliation rollback left residue",
  ]) {
    assert.ok(FIXTURE.includes(evidence), `fixture must prove: ${evidence}`);
  }
});
