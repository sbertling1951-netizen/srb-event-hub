import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Regression coverage for the membership-number-format consolidation
// (docs/architecture/EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md,
// Section B row 4 / Q7): Imports previously hardcoded the "must start
// with F or C" rule in three independent places instead of reading the
// one governed `validation_rules`-driven check (attendeesWorkflow's
// `validateField`) that the Attendees Review Queue already uses. None
// of `mapRow`, `parsedReviewIssues`, or `savedAttendeeIssues` are
// exported (module-private closures/functions), so -- mirroring the
// existing pattern in app/admin/attendees/page.test.tsx -- this reads
// the source directly rather than rendering the full page.
//
// Run with: npx tsx --test app/admin/imports/page.test.ts

function readSource() {
  return readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
}

test("imports page: no hardcoded membership-number F/C prefix check remains anywhere in the file", () => {
  const source = readSource();
  assert.equal(/startsWith\("F"\)/.test(source), false);
  assert.equal(/startsWith\('F'\)/.test(source), false);
});

test("imports page: validateField is imported from the one governed Attendees rule engine", () => {
  const source = readSource();
  assert.match(
    source,
    /import\s*\{[^}]*validateField[^}]*\}\s*from\s*"@\/app\/admin\/attendees\/attendeesWorkflow"/s,
  );
});

test("mapRow: the per-row parse warning routes membership-number format through validateField", () => {
  const source = readSource();
  const start = source.indexOf("function mapRow(");
  const body = source.slice(start, source.indexOf("\nexport default function AdminAttendeeImportsPage", start));
  assert.match(
    body,
    /validateField\(\s*"membership_number",\s*membership_number,\s*rules,\s*eventId,?\s*\)/,
  );
});

test("parsedReviewIssues: the newly-parsed-row review computation routes membership-number format through validateField", () => {
  const source = readSource();
  const start = source.indexOf("const parsedReviewIssues = useMemo");
  const body = source.slice(start, source.indexOf("const visiblePreviewRows", start));
  assert.match(
    body,
    /validateField\(\s*"membership_number",\s*row\.membership_number,\s*rules,\s*selectedImportEventId \|\| null,?\s*\)/,
  );
});

test("savedAttendeeIssues: the already-saved-attendee review computation routes membership-number format through validateField", () => {
  const source = readSource();
  const start = source.indexOf("const savedAttendeeIssues = useMemo");
  const body = source.slice(start, source.indexOf("async function loadSavedAttendees", start));
  assert.match(
    body,
    /validateField\(\s*"membership_number",\s*memberNumber,\s*rules,\s*selectedImportEventId \|\| null,?\s*\)/,
  );
});

test("mapRow, parsedReviewIssues, and savedAttendeeIssues all pull from the same rules state, not three independent fetches", () => {
  const source = readSource();
  assert.match(source, /const \[rules, setRules\] = useState<ValidationRule\[\]>\(\[\]\);/);
  const matches = source.match(/from\("validation_rules"\)/g) || [];
  assert.equal(matches.length, 1);
});

// -- G-03C: Imports route-authority migration -----------------------------
//
// Attendee Imports is fully Event-scoped -- import parsing/preview is
// client-local, and every write (attendees, event_import_rows,
// attendee_activities) targets the selected admin working Event.
// event_import_rows' own INSERT/UPDATE/DELETE RLS policies have required
// event.imports.manage(event_id) since
// 20260811250000_cutover_imports_task_authority.sql, so the whole route
// requires event.imports.manage, matching the pattern already established
// for Locations and Announcements.

test("route requires event.imports.manage, not the legacy can_manage_imports permission", () => {
  const source = readSource();
  assert.match(
    source,
    /<AdminRouteGuard requiredTask="event\.imports\.manage">/,
  );
  assert.equal(/requiredPermission/.test(source), false);
  assert.equal(/can_manage_imports/.test(source), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  const source = readSource();
  assert.equal(/has_event_task_authority\(/.test(source), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(source), false);
});

test("Event-membership (canAccessEvent) remains as a page-local check, unrelated to the migrated permission", () => {
  const source = readSource();
  assert.match(source, /canAccessEvent\(admin, event\.id\)/);
  assert.match(source, /canAccessEvent\(admin, stored\.id\)/);
});

test("the embedded Vendor Library section's distinct can_manage_vendors authority is untouched -- it is a separate capability, not a duplicate of the migrated Imports permission", () => {
  const source = readSource();
  const matches = [...source.matchAll(/hasPermission\(admin, "can_manage_vendors"\)/g)];
  assert.equal(matches.length, 2, "expected both existing can_manage_vendors UI-alignment checks to remain exactly as-is");
});

test("Event context handling is unchanged: reads getCurrentAdminEvent and re-syncs on Admin workspace change", () => {
  const source = readSource();
  assert.match(source, /const stored = getCurrentAdminEvent\(\);/);
  assert.match(source, /subscribeToAdminWorkspace\(/);
  assert.equal(/setCurrentAdminEvent/.test(source), false);
});
