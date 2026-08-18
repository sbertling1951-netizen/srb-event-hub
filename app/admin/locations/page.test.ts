import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

// G-03B: Locations route-authority migration. Locations has no view-only
// mode -- the page's one job is Event-scoped location CRUD (create, move,
// edit, delete map pins), all of which already write directly to
// event_locations under RLS policies that require
// event.locations.manage(event_id)
// (20260811230000_cutover_event_locations_and_nearby_task_authority.sql)
// -- so the whole route requires event.locations.manage, matching the
// pattern already established for Print Settings and Announcements. Run
// with:
//   npx tsx --test app/admin/locations/page.test.ts

test("route requires event.locations.manage, not the legacy can_manage_locations permission", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminRouteGuard requiredTask="event\.locations\.manage">/,
  );
  assert.equal(/requiredPermission/.test(PAGE_SOURCE), false);
  assert.equal(/can_manage_locations/.test(PAGE_SOURCE), false);
  assert.equal(/hasPermission/.test(PAGE_SOURCE), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("Event-membership (canAccessEvent) remains as the one page-local check, unrelated to the migrated permission", () => {
  assert.match(PAGE_SOURCE, /canAccessEvent\(admin, adminEvent\.id\)/);
});

test("location CRUD writes event_locations directly under RLS, unchanged by this migration", () => {
  for (const needle of [
    'from("event_locations")',
    ".insert(payload)",
    ".update(payload)",
    ".delete()",
    "map_x",
    "map_y",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `Locations must retain ${needle}`);
  }
});

test("Event context handling is unchanged: reads getCurrentAdminEvent and re-syncs on Admin workspace change", () => {
  assert.match(PAGE_SOURCE, /const adminEvent = getCurrentAdminEvent\(\)/);
  assert.match(PAGE_SOURCE, /subscribeToAdminWorkspace\(/);
  assert.equal(/setCurrentAdminEvent/.test(PAGE_SOURCE), false);
});
