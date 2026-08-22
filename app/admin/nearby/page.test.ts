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

// -----------------------------------------------------------------------
// Nearby Category Authority Stage A: category_id maintained on every
// write/copy path, no rename capability, no member-facing change.
// -----------------------------------------------------------------------

function functionBody(name: string): string {
  const start = PAGE_SOURCE.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `expected to find async function ${name}(`);
  const nextFn = PAGE_SOURCE.indexOf("\n  async function ", start + 1);
  return PAGE_SOURCE.slice(start, nextFn > 0 ? nextFn : PAGE_SOURCE.length);
}

test("the category-code normalizer matches the SQL migration's own normalization exactly (lowercase, non-alnum runs to underscore, trimmed)", () => {
  assert.match(
    PAGE_SOURCE,
    /function normalizeCategoryCode\(text: string\): string \{\s*\n\s*return text\s*\n\s*\.trim\(\)\s*\n\s*\.toLowerCase\(\)\s*\n\s*\.replace\(\/\[\^a-z0-9\]\+\/g, "_"\)\s*\n\s*\.replace\(\/\^_\+\|_\+\$\/g, ""\);/,
  );
});

test("place_categories is fetched read-only -- no insert/update/delete/upsert against it anywhere on this page", () => {
  const categoriesFetchIdx = PAGE_SOURCE.indexOf('.from("place_categories")');
  assert.notEqual(categoriesFetchIdx, -1);
  assert.equal(/\.from\("place_categories"\)\s*\n\s*\.(insert|update|upsert|delete)\(/.test(PAGE_SOURCE), false);
});

test("no rename RPC, no InlineEdit adoption, and no automatic category creation anywhere on this page", () => {
  assert.equal(/rename_place_category/.test(PAGE_SOURCE), false);
  assert.equal(/InlineEdit/.test(PAGE_SOURCE), false);
  assert.equal(/INSERT INTO public\.place_categories|from\("place_categories"\)\s*\n\s*\.insert/.test(PAGE_SOURCE), false);
});

test("saveStoredPlace re-resolves category_id fresh from the current free-text category on every save -- editing the text can never leave category_id stale", () => {
  const body = functionBody("saveStoredPlace");
  assert.match(body, /category: storedForm\.category\.trim\(\) \|\| null,/);
  assert.match(body, /category_id: resolveCategoryId\(storedForm\.category\.trim\(\) \|\| null\),/);
  assert.match(PAGE_SOURCE, /\.from\("nearby_master"\)\s*\n\s*\.update\(payload\)/);
  assert.match(PAGE_SOURCE, /supabase\.from\("nearby_master"\)\.insert\(payload\)/);
});

test("saveEventPlace re-resolves category_id fresh from the current free-text category on every save", () => {
  const body = functionBody("saveEventPlace");
  assert.match(body, /category: eventForm\.category\.trim\(\) \|\| null,/);
  assert.match(body, /category_id: resolveCategoryId\(eventForm\.category\.trim\(\) \|\| null\),/);
});

test("replaceEventListFromStored copies category_id directly from the source stored place -- never re-derives it from copied display text", () => {
  const body = functionBody("replaceEventListFromStored");
  assert.match(body, /"id,name,address,phone,category,category_id,description,link,location_code,lat,lng"/);
  assert.match(body, /category_id: place\.category_id \?\? null,/);
  assert.equal(/resolveCategoryId/.test(body), false);
});

test("mergeStoredAreaIntoEvent copies category_id directly from the source stored place -- never re-derives it from copied display text", () => {
  const body = functionBody("mergeStoredAreaIntoEvent");
  assert.match(body, /"id,name,address,phone,category,category_id,description,link,location_code,lat,lng"/);
  assert.match(body, /category_id: place\.category_id \?\? null,/);
  assert.equal(/resolveCategoryId/.test(body), false);
});

test("resolveCategoryId returns null for blank/unmatched free text rather than inventing a category -- category_id is never coerced to a fallback identity", () => {
  const start = PAGE_SOURCE.indexOf("const resolveCategoryId = useCallback(");
  assert.notEqual(start, -1);
  const body = PAGE_SOURCE.slice(start, PAGE_SOURCE.indexOf("[categoryIdByCode],", start));
  assert.match(body, /if \(!categoryText\) \{\s*\n\s*return null;/);
  assert.match(body, /if \(!code\) \{\s*\n\s*return null;/);
  assert.match(body, /return categoryIdByCode\.get\(code\) \?\? null;/);
});

test("Stage A's new helpers/state are local to this page -- neither app/member/nearby/page.tsx nor app/admin/nearby-settings/page.tsx picked up any of this stage's logic", () => {
  const memberSource = readFileSync(
    fileURLToPath(new URL("../../member/nearby/page.tsx", import.meta.url)),
    "utf8",
  );
  const settingsSource = readFileSync(
    fileURLToPath(new URL("../nearby-settings/page.tsx", import.meta.url)),
    "utf8",
  );

  for (const needle of ["normalizeCategoryCode", "resolveCategoryId", "categoryIdByCode"]) {
    assert.equal(memberSource.includes(needle), false, `member page should not reference ${needle}`);
    assert.equal(settingsSource.includes(needle), false, `nearby-settings page should not reference ${needle}`);
  }
});
