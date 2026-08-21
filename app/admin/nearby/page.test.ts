import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Admin Nearby Central UI Standard migration. This
// page has no map/marker rendering (confirmed: no MapCanvas/
// NearbyPlacesMap import) so the Map Marker Standard does not apply.
// Run with:
//   npx tsx --test app/admin/nearby/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("route requires event.nearby.manage, not the legacy can_manage_nearby permission -- catches the client gate up to match the already-cutover RLS (20260811230000)", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredTask="event\.nearby\.manage">/);
  assert.equal(/requiredPermission/.test(PAGE_SOURCE), false);
  assert.equal(/can_manage_nearby/.test(PAGE_SOURCE), false);
});

test("shell wrapper remains in place, with a back target to Map Admin replacing the hand-rolled navigation button row", () => {
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
  assert.match(
    PAGE_SOURCE,
    /backTarget=\{\{ href: "\/admin\/map-admin", label: "Map Admin" \}\}/,
  );
  assert.equal(/window\.location\.href/.test(PAGE_SOURCE), false);
  assert.equal(/Return to Dashboard/.test(PAGE_SOURCE), false);
});

test("the page-local isNarrow resize-listener breakpoint state is gone -- replaced by the shared useShellInterfaceCapabilities() hook", () => {
  assert.equal(/isNarrow/.test(PAGE_SOURCE), false);
  assert.equal(/addEventListener\(\s*["']resize["']/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /import\s*\{[^}]*useShellInterfaceCapabilities[^}]*\}\s*from\s*["']@\/components\/shell\/useShellViewport["']/,
  );
  assert.match(PAGE_SOURCE, /const \{ isCompact \} = useShellInterfaceCapabilities\(\);/);
});

test("the legacy <Page> wrapper is gone -- the inner component returns a plain grid div, matching every other migrated Admin page", () => {
  assert.equal(/<Page[\s>]/.test(PAGE_SOURCE), false);
  assert.equal(/from "@\/components\/ui\/Page"/.test(PAGE_SOURCE), false);
});

test("every canonical Central UI primitive is imported", () => {
  for (const importPath of [
    '"@/components/ui/Alert"',
    '"@/components/ui/AppButton"',
    '"@/components/ui/ConfirmDialog"',
    '"@/components/ui/Field"',
    '"@/components/ui/PageHeader"',
    '"@/components/ui/PageSection"',
    '"@/components/ui/StatusBadge"',
    '"@/components/ui/TableToolbar"',
  ]) {
    assert.ok(PAGE_SOURCE.includes(importPath), `expected an import from ${importPath}`);
  }
});

test("no raw form controls remain in the Add/Edit forms -- every input/select/textarea/checkbox there goes through Field/Input/Select/Textarea/Checkbox", () => {
  assert.equal(/<input\b(?!\s*type="checkbox")/.test(PAGE_SOURCE), false);
  assert.equal(/<textarea\b/.test(PAGE_SOURCE), false);
  // The toolbar's own category filter is the one legitimate exception --
  // a raw <select> with a <label className="table-toolbar-label">,
  // matching Attendees' own established TableToolbar filter convention
  // (Field is for form fields with required/help/error semantics, not
  // lightweight list filters). Assert it's exactly that one, not a
  // leftover form-control select.
  const rawSelects = PAGE_SOURCE.match(/<select\b/g) || [];
  assert.equal(rawSelects.length, 1, "expected exactly one raw <select> (the toolbar category filter)");
  assert.match(PAGE_SOURCE, /id="stored-place-category-filter"/);
  // The two toolbar filter checkboxes (inside TableToolbarDisclosure) and
  // the "Hidden from members" Checkbox component are the only remaining
  // checkbox-shaped controls -- filter checkboxes intentionally stay raw,
  // matching Attendees' own established TableToolbar filter convention
  // (plain <input type="checkbox"> inside a <label>, not the full Field
  // wrapper meant for form fields with required/help/error semantics).
  const rawCheckboxes = (PAGE_SOURCE.match(/type="checkbox"/g) || []).length;
  assert.equal(rawCheckboxes, 2, "expected exactly the two toolbar filter checkboxes to remain raw");
  assert.match(PAGE_SOURCE, /<Checkbox\s+label="Hidden from members"/);
});

test("no window.confirm remains -- all four destructive/impactful actions route through one shared ConfirmDialog + requestConfirmation()", () => {
  assert.equal(/window\.confirm/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /function requestConfirmation\(/);
  assert.match(PAGE_SOURCE, /<ConfirmDialog\s/);

  const confirmCallCount = (PAGE_SOURCE.match(/await requestConfirmation\(\{/g) || []).length;
  assert.equal(confirmCallCount, 4, "expected exactly 4 requestConfirmation() call sites");
});

test("delete-initiating buttons use the danger variant; Save/Create actions use primary", () => {
  for (const label of [
    "Delete Area",
    "Delete Stored Place",
    "Delete Event Place",
  ]) {
    // lastIndexOf, not indexOf -- each of these labels also appears as
    // its ConfirmDialog's `title` earlier in the file.
    const idx = PAGE_SOURCE.lastIndexOf(label);
    assert.notEqual(idx, -1, `expected to find button label "${label}"`);
    const nearby = PAGE_SOURCE.slice(Math.max(0, idx - 400), idx);
    assert.match(nearby, /variant="danger"/);
  }

  for (const label of ["Save Area Changes", "Update Stored Place", "Update Event Place"]) {
    assert.ok(PAGE_SOURCE.includes(label), `expected to find button label "${label}"`);
  }
});

test("the coordinate-status badge (Needs Geocode / Plus Code / GPS Ready) and the Duplicate flag render through the shared StatusBadge, not hand-rolled pill styling", () => {
  assert.match(PAGE_SOURCE, /\): \{ label: string; tone: StatusBadgeTone \} \{/);
  assert.match(PAGE_SOURCE, /<StatusBadge tone=\{coordinateStatus\.tone\}>\{coordinateStatus\.label\}<\/StatusBadge>/);
  assert.match(PAGE_SOURCE, /<StatusBadge tone="danger">Duplicate<\/StatusBadge>/);
  // No hand-rolled pill-shaped inline style survives for these badges.
  assert.equal(/borderRadius: 999/.test(PAGE_SOURCE), false);
});

test("the Stored Places search/category/coordinate filters use the shared TableToolbar, with secondary filters behind a disclosure", () => {
  assert.match(PAGE_SOURCE, /<TableToolbar>/);
  assert.match(PAGE_SOURCE, /<TableToolbarPrimaryRow>/);
  assert.match(
    PAGE_SOURCE,
    /<SearchField\s+label="Search"\s+value=\{storedSearch\}\s+onChange=\{setStoredSearch\}/,
  );
  assert.match(
    PAGE_SOURCE,
    /<TableToolbarDisclosure label="More filters" activeCount=\{storedPlacesActiveFilterCount\}>/,
  );
});

test("the drag-reorder Event Places list is completely untouched -- dnd-kit/useSortable/handleDragEnd/saveEventPlaceOrder remain exactly as before, per the Central UI blueprint's direct-manipulation carve-out", () => {
  for (const needle of [
    "DndContext",
    "SortableContext",
    "useSortable",
    "verticalListSortingStrategy",
    "closestCenter",
    "arrayMove",
    "function handleDragEnd(",
    "async function saveEventPlaceOrder(",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `expected drag-reorder mechanism "${needle}" to remain untouched`);
  }
});

test("all three data tables/entities and their governed writes are unchanged -- same table names, same RPC-free direct writes, same payload field names", () => {
  for (const needle of [
    'from("nearby_area_templates")',
    'from("nearby_master")',
    'from("event_nearby_places")',
    "sort_order",
    "is_hidden",
    "distance_miles",
    "location_code",
    "google_radius_miles",
    "google_custom_search",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `expected ${needle} to be retained`);
  }
});

test("geocodeLocation resolution behavior (plus code -> address -> manual coordinates fallback order) is unchanged", () => {
  assert.match(PAGE_SOURCE, /import \{ geocodeLocation \} from "@\/lib\/geocodeLocation";/);
  const saveStoredIdx = PAGE_SOURCE.indexOf("async function saveStoredPlace()");
  const saveEventIdx = PAGE_SOURCE.indexOf("async function saveEventPlace()");
  assert.notEqual(saveStoredIdx, -1);
  assert.notEqual(saveEventIdx, -1);
  for (const fnStart of [saveStoredIdx, saveEventIdx]) {
    const body = PAGE_SOURCE.slice(fnStart, fnStart + 1600);
    assert.match(body, /location_code\.trim\(\)/);
    assert.match(body, /address\.trim\(\)/);
    assert.match(body, /geocodeLocation\(/);
  }
});

test("event-context/authority behavior (canAccessEvent, getCurrentAdminEvent, subscribeToAdminWorkspace) is unchanged", () => {
  for (const needle of [
    "canAccessEvent(admin",
    "getCurrentAdminEvent()",
    "subscribeToAdminWorkspace(",
    "You do not have access to this event.",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `expected ${needle} to be retained`);
  }
});

test("the draft-restore-focus mechanism (data-stored-field/rememberStoredFieldFocus) survives the Field migration unchanged", () => {
  assert.match(PAGE_SOURCE, /function rememberStoredFieldFocus\(/);
  const fieldNames = [
    "name",
    "category",
    "custom-category",
    "address",
    "phone",
    "website",
    "notes",
    "lat",
    "lng",
    "location_code",
  ];
  for (const fieldName of fieldNames) {
    assert.ok(
      PAGE_SOURCE.includes(`data-stored-field="${fieldName}"`),
      `expected data-stored-field="${fieldName}" to be retained`,
    );
  }
});
