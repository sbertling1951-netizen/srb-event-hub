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

// -- Admin Batch 1: Central UI Standard migration ---------------------------

test("the page-local resize listener is gone -- responsive layout is driven by the canonical shell capability hook", () => {
  assert.equal(/addEventListener\("resize"/.test(PAGE_SOURCE), false);
  assert.equal(/window\.innerWidth/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*useShellInterfaceCapabilities\s*\}\s*from\s*["']@\/components\/shell\/useShellViewport["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /const \{ isCompact: isNarrow \} = useShellInterfaceCapabilities\(\);/,
  );
});

test("the editor form uses the canonical Field/Input/Textarea primitives -- no raw form controls remain", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Field,\s*Input,\s*Textarea\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
  assert.equal(/<input\b/.test(PAGE_SOURCE), false, "no raw <input> should remain");
  assert.equal(/<textarea\b/.test(PAGE_SOURCE), false, "no raw <textarea> should remain");
  for (const label of ["Search Locations", "Location Name", "Category", "Description", "Priority", "X", "Y"]) {
    assert.ok(PAGE_SOURCE.includes(`<Field label="${label}"`), `expected a Field for "${label}"`);
  }
});

test("Save/Delete render through FormActions and AppButton, with Delete alone using the danger variant", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  const formActionsIdx = PAGE_SOURCE.indexOf("<FormActions>");
  assert.notEqual(formActionsIdx, -1);
  const formActionsBody = PAGE_SOURCE.slice(
    formActionsIdx,
    PAGE_SOURCE.indexOf("</FormActions>", formActionsIdx),
  );
  assert.equal(/<button\b/.test(formActionsBody), false, "no raw <button> should remain inside FormActions");
  assert.match(formActionsBody, /variant="danger"\s*\n\s*onClick=\{requestDeleteLocation\}/);
});

test("destructive delete now routes through the canonical ConfirmDialog, not window.confirm", () => {
  assert.equal(/window\.confirm/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog";/);
  assert.match(PAGE_SOURCE, /<ConfirmDialog\s*\n\s*open=\{confirmDeleteOpen\}/);
  assert.match(PAGE_SOURCE, /title="Delete Location"/);
  assert.match(PAGE_SOURCE, /danger\s*\n\s*busy=\{deleting\}/);
  assert.match(PAGE_SOURCE, /onConfirm=\{\(\) => void deleteLocation\(\)\}/);

  const fnIdx = PAGE_SOURCE.indexOf("function requestDeleteLocation()");
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("\n  }", fnIdx));
  assert.match(fnBody, /setConfirmDeleteOpen\(true\)/);
});

test("deleteLocation itself still performs the exact same event_locations delete -- only the confirmation surface changed", () => {
  const fnIdx = PAGE_SOURCE.indexOf("async function deleteLocation()");
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("\n  }", fnIdx));
  assert.match(fnBody, /\.from\("event_locations"\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\("id", formId\)/);
});

test("loading/empty/status presentation uses the canonical LoadingState/EmptyState/Alert primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading\.\.\." \/>/);
  assert.match(PAGE_SOURCE, /<EmptyState message=\{status \|\| "No admin working event selected/);
  assert.match(PAGE_SOURCE, /<EmptyState message="No locations found\." \/>/);
});

test("event name/location is not re-rendered in the page body -- it is already owned by the canonical Admin shell header", () => {
  assert.equal(/event\.name\}\s*<\/PageHeader/.test(PAGE_SOURCE), false);
  assert.equal(/<PageHeader/.test(PAGE_SOURCE), false);
});

test("the editor and map panels render through the canonical PageSection primitive", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*PageSection\s*\}\s*from\s*["']@\/components\/ui\/PageSection["']/,
  );
  assert.match(PAGE_SOURCE, /<PageSection variant="card" title="Location Editor">/);
});

test("the Map Marker Standard (MarkerDot/MarkerLabelChip) is preserved untouched -- this migration does not touch marker rendering", () => {
  assert.match(
    PAGE_SOURCE,
    /import \{ MapCanvas, type MapCanvasHandle, MarkerDot, MarkerLabelChip \} from "@\/components\/map\/canvas";/,
  );
  assert.match(PAGE_SOURCE, /<MarkerDot\s*\n\s*size=\{60\}/);
  assert.match(PAGE_SOURCE, /<MarkerLabelChip text=\{loc\.name\} \/>/);
});
