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

test("confirmation-requiring Nearby actions route through the shared ConfirmDialog", () => {
  assert.equal(/window\.confirm/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /function requestConfirmation\(/);
  assert.match(PAGE_SOURCE, /<ConfirmDialog\s/);

  const confirmCallCount = (PAGE_SOURCE.match(/await requestConfirmation\(\{/g) || []).length;
  assert.ok(confirmCallCount >= 4, "expected confirmation coverage for Nearby actions");
});

test("current delete and Event-removal actions use the danger variant", () => {
  for (const label of [
    "Delete Area",
    "Delete Stored Place",
    "Delete Place",
    "Remove from this Event",
  ]) {
    // lastIndexOf, not indexOf -- each of these labels also appears as
    // its ConfirmDialog's `title` earlier in the file.
    const idx = PAGE_SOURCE.lastIndexOf(label);
    assert.notEqual(idx, -1, `expected to find button label "${label}"`);
    const nearby = PAGE_SOURCE.slice(Math.max(0, idx - 400), idx);
    assert.match(nearby, /variant="danger"/);
  }

  for (const label of ["Save Area Changes", "Update Stored Place", "Save Listing"]) {
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

test("stored and Event listing saves retain the existing coordinate-resolution behavior", () => {
  assert.match(PAGE_SOURCE, /import \{ geocodeLocation \} from "@\/lib\/geocodeLocation";/);
  const saveStoredIdx = PAGE_SOURCE.indexOf("async function saveStoredPlace()");
  const saveEventIdx = PAGE_SOURCE.indexOf("async function saveNearbyEventListing()");
  assert.notEqual(saveStoredIdx, -1);
  assert.notEqual(saveEventIdx, -1);
  const storedSave = functionBody("saveStoredPlace");
  assert.match(storedSave, /location_code\.trim\(\)/);
  assert.match(storedSave, /address\.trim\(\)/);
  assert.match(storedSave, /geocodeLocation\(/);
  assert.match(PAGE_SOURCE, /async function resolveNearbyCoordinates\([\s\S]*?locationCode\.trim\(\)[\s\S]*?address\.trim\(\)[\s\S]*?geocodeLocation\(/);
  const eventSave = functionBody("saveNearbyEventListing");
  assert.match(eventSave, /resolveNearbyCoordinates\(/);
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

test("Event Nearby reads only commit while their request Event is still the authoritative Admin Event", () => {
  const start = PAGE_SOURCE.indexOf("const loadEventPlaces = useCallback");
  const end = PAGE_SOURCE.indexOf("\n  useEffect(() => {", start);
  assert.ok(start >= 0 && end > start, "expected loadEventPlaces function");
  const body = PAGE_SOURCE.slice(start, end);

  assert.match(body, /isCurrentNearbyEventRequest\(eventId, getCurrentAdminEvent\(\)\?\.id\)/);
  assert.match(body, /if \(!isCurrentRequest\(\)\) \{\n        return;/);
  assert.match(body, /if \(isCurrentRequest\(\)\) \{\n        setLoadingEventPlaces\(false\);/);
});

test("Stored Area selection states that it is independent from the Admin Working Event", () => {
  assert.match(PAGE_SOURCE, /Stored Areas are reusable collections\. Selecting one does not change the Admin Working Event or its assigned Nearby list\./);
  assert.match(PAGE_SOURCE, /resolveStoredAreaSelection\(/);
});

test("Google Nearby results render and preload coordinates only when both values are numeric", () => {
  assert.match(PAGE_SOURCE, /type GoogleNearbyResult = \{[\s\S]*?lat: number \| null;[\s\S]*?lng: number \| null;/);
  assert.match(
    PAGE_SOURCE,
    /function hasGoogleResultCoordinates\([\s\S]*?return typeof place\.lat === "number" && typeof place\.lng === "number";/,
  );
  assert.equal(PAGE_SOURCE.includes("Number(place.lat).toFixed(5)"), true);
  const coordinatesDisplay = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("Number(place.lat).toFixed(5)"),
    PAGE_SOURCE.indexOf("Number(place.lat).toFixed(5)") + 250,
  );
  assert.match(coordinatesDisplay, /hasGoogleResultCoordinates\(place\)/);
  assert.equal(/place\.lat !== null && place\.lng !== null/.test(PAGE_SOURCE), false);
});

test("the draft-restore-focus mechanism (data-stored-field/rememberStoredFieldFocus) survives the Field migration unchanged", () => {
  assert.match(PAGE_SOURCE, /function rememberStoredFieldFocus\(/);
  // "custom-category" is gone (Nearby Category Authority Stage B, Part 1
  // -- the free-text custom-category escape hatch this field name
  // belonged to was removed), not merely renamed.
  assert.equal(PAGE_SOURCE.includes('"custom-category"'), false);
  const fieldNames = [
    "name",
    "category",
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
// Nearby Category Authority Stage A (superseded parts removed): the
// free-text normalized-code resolution Stage A added is gone, correctly
// -- Stage B, Part 1 replaced it with direct catalog selection (below),
// which needs no text normalization at all.
// -----------------------------------------------------------------------

test("Stage A's free-text resolution helpers (normalizeCategoryCode/resolveCategoryId/categoryIdByCode) are gone -- Stage B's direct category_id selection made them unnecessary", () => {
  for (const needle of ["normalizeCategoryCode", "resolveCategoryId", "categoryIdByCode"]) {
    assert.equal(PAGE_SOURCE.includes(needle), false, `expected ${needle} to have been removed`);
  }
});

// -----------------------------------------------------------------------
// Nearby Category Authority Stage B, Part 1: canonical catalog selection
// for both Stored and Event Places -- category_id is the real selection
// value, the free-text/custom-category escape hatch is gone.
// -----------------------------------------------------------------------

function functionBody(name: string): string {
  const start = PAGE_SOURCE.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `expected to find async function ${name}(`);
  const nextFn = PAGE_SOURCE.indexOf("\n  async function ", start + 1);
  return PAGE_SOURCE.slice(start, nextFn > 0 ? nextFn : PAGE_SOURCE.length);
}

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

test("the free-text/custom-category escape hatch is completely gone -- no __custom__ sentinel, no 'Add new category' UI, no hardcoded 9-item option list", () => {
  assert.equal(/__custom__/.test(PAGE_SOURCE), false);
  assert.equal(/Add new category/.test(PAGE_SOURCE), false);
  for (const legacyOption of ["Restaurant", "RV Service", "Attraction"]) {
    assert.equal(
      new RegExp(`<option value="${legacyOption}">${legacyOption}</option>`).test(PAGE_SOURCE),
      false,
      `expected the hardcoded <option value="${legacyOption}"> to be gone`,
    );
  }
});

test("all current category selectors are catalog-driven", () => {
  for (const valueExpression of [
    "storedForm.category_id",
    "nearbyEventForm.category_id",
    "nearbyCanonicalForm.category_id",
  ]) {
    const start = PAGE_SOURCE.indexOf(`value={${valueExpression}}`);
    const select = PAGE_SOURCE.slice(start, PAGE_SOURCE.indexOf("</Select>", start));
    assert.ok(start >= 0, `expected ${valueExpression} selector`);
    assert.match(select, /<option key=\{placeCategory\.id\} value=\{placeCategory\.id\}>/);
    assert.match(select, /\{placeCategory\.label\}/);
  }
});

test("saveStoredPlace preserves category identity through its governed Stored Area RPC", () => {
  const body = functionBody("saveStoredPlace");
  assert.match(body, /p_category_id: storedForm\.category_id \|\| null,/);
  assert.match(body, /p_category: storedForm\.category\.trim\(\) \|\| null,/);
  assert.match(body, /supabase\.rpc\("upsert_stored_area_place", rpcArgs\)/);
});

test("saveNearbyEventListing persists category_id directly from the selected value", () => {
  const body = functionBody("saveNearbyEventListing");
  assert.match(body, /category_id: nearbyEventForm\.category_id \|\| null,/);
  assert.match(body, /category: nearbyEventForm\.category\.trim\(\) \|\| null,/);
});

test("selecting a category keeps category_id and the compatibility label in lockstep", () => {
  for (const valueExpression of [
    "storedForm.category_id",
    "nearbyEventForm.category_id",
    "nearbyCanonicalForm.category_id",
  ]) {
    const start = PAGE_SOURCE.indexOf(`value={${valueExpression}}`);
    const select = PAGE_SOURCE.slice(start, PAGE_SOURCE.indexOf("</Select>", start));
    assert.match(select, /category_id: nextCategoryId,/);
    assert.match(select, /category: nextCategoryId \? categoryLabelById\.get\(nextCategoryId\) \|\| "" : "",/);
  }
});

test("replaceEventListFromStored copies category_id directly from the source stored place -- never re-derives it from copied display text", () => {
  const body = functionBody("replaceEventListFromStored");
  assert.match(body, /"id,name,address,phone,category,category_id,description,link,location_code,lat,lng"/);
  assert.match(body, /category_id: place\.category_id \?\? null,/);
});

test("mergeStoredAreaIntoEvent copies category_id directly from the source stored place -- never re-derives it from copied display text", () => {
  const body = functionBody("mergeStoredAreaIntoEvent");
  assert.match(body, /"id,name,address,phone,category,category_id,description,link,location_code,lat,lng"/);
  assert.match(body, /category_id: place\.category_id \?\? null,/);
});

test("loadStoredPlaces and loadEventPlaces both select category_id", () => {
  const storedStart = PAGE_SOURCE.indexOf("const loadStoredPlaces = useCallback");
  const eventStart = PAGE_SOURCE.indexOf("const loadEventPlaces = useCallback");
  const storedLoad = PAGE_SOURCE.slice(storedStart, eventStart);
  const eventLoad = PAGE_SOURCE.slice(eventStart, PAGE_SOURCE.indexOf("\n  useEffect(() => {", eventStart));
  assert.match(storedLoad, /category,category_id,description/);
  assert.match(storedLoad, /\.eq\("area_id", nearbyAreaId\)/);
  assert.match(eventLoad, /category,category_id,notes/);
});

test("Stage B's category state/helpers are local to this page -- neither app/member/nearby/page.tsx nor app/admin/nearby-settings/page.tsx picked up any of this stage's logic", () => {
  const memberSource = readFileSync(
    fileURLToPath(new URL("../../member/nearby/page.tsx", import.meta.url)),
    "utf8",
  );
  const settingsSource = readFileSync(
    fileURLToPath(new URL("../nearby-settings/page.tsx", import.meta.url)),
    "utf8",
  );

  for (const needle of ["categoryLabelById", "placeCategories"]) {
    assert.equal(memberSource.includes(needle), false, `member page should not reference ${needle}`);
    assert.equal(settingsSource.includes(needle), false, `nearby-settings page should not reference ${needle}`);
  }
});

// -- Admin Batch 2: Central UI Standard completion touch-up -----------------

test("every form action row uses the canonical FormActions wrapper, not a raw app-button-row div", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  assert.equal(/className="app-button-row"/.test(PAGE_SOURCE), false);
  const formActionsCount = (PAGE_SOURCE.match(/<FormActions>/g) || []).length;
  assert.ok(formActionsCount >= 6, `expected at least 6 FormActions usages, found ${formActionsCount}`);
});

test("the external 'Open Google Result in Maps' link uses AppLinkButton, not a raw <a className=\"app-button\">", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*AppButton,\s*AppLinkButton\s*\}\s*from\s*["']@\/components\/ui\/AppButton["']/,
  );
  const linkButtonIdx = PAGE_SOURCE.indexOf("<AppLinkButton");
  assert.notEqual(linkButtonIdx, -1);
  const linkButtonBlock = PAGE_SOURCE.slice(linkButtonIdx, linkButtonIdx + 600);
  assert.match(linkButtonBlock, /target="_blank"/);
  assert.match(linkButtonBlock, /Open Google Result in Maps/);
  assert.equal(/className="app-button"/.test(PAGE_SOURCE), false);
});

test("loading and empty presentations for stored/event places use the canonical LoadingState/EmptyState primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading stored areas\.\.\." \/>/);
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading stored places\.\.\." \/>/);
  assert.match(PAGE_SOURCE, /<EmptyState message="No stored places found\." \/>/);
  assert.match(PAGE_SOURCE, /<EmptyState message="No admin working event selected\." \/>/);
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading current event nearby places\.\.\." \/>/);
  assert.match(
    PAGE_SOURCE,
    /<EmptyState message="No nearby places are currently assigned to this event\." \/>/,
  );
  // Guidance/informational text (not a loading or empty-collection state)
  // correctly stays a plain Alert.
  assert.match(
    PAGE_SOURCE,
    /<Alert tone="neutral">Select a stored area to manage its reusable places\.<\/Alert>/,
  );
});
