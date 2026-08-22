import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { masterMapStatusTone } from "@/app/admin/master-maps/page";

// Focused tests for the Admin Batch 1 Central UI Standard migration of
// Master Maps. Run with:
//   npx tsx --test app/admin/master-maps/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("shell wrapper, AdminRouteGuard, and the existing can_manage_master_maps permission are unchanged", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard requiredPermission="can_manage_master_maps"/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

test("map CRUD/lifecycle writes are unchanged: draft creation, archive, restore, delete, and image replace all retain their exact table/RPC calls", () => {
  for (const needle of [
    'from("master_maps")',
    'from("master_map_sites")',
    'from("event_map_settings")',
    'from("events")',
    "status: \"draft\"",
    "status: \"archived\"",
    "status: \"published\"",
    ".storage",
    "coach_map_open_scale",
    "parking_map_open_scale",
    "locations_map_open_scale",
  ]) {
    assert.ok(PAGE_SOURCE.includes(needle), `Master Maps must retain ${needle}`);
  }
});

test("the page-local resize listener is gone -- responsive layout is driven by the canonical shell capability hook", () => {
  assert.equal(/addEventListener\("resize"/.test(PAGE_SOURCE), false);
  assert.equal(/window\.innerWidth/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*useShellInterfaceCapabilities\s*\}\s*from\s*["']@\/components\/shell\/useShellViewport["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /const \{ isCompact: isMobile \} = useShellInterfaceCapabilities\(\);/,
  );
});

test("Archive and Delete confirmations now route through the canonical ConfirmDialog, not window.confirm", () => {
  assert.equal(/window\.confirm/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog";/);

  assert.match(PAGE_SOURCE, /title="Archive Map"/);
  assert.match(PAGE_SOURCE, /title="Delete Archived Map"/);

  const deleteDialogIdx = PAGE_SOURCE.indexOf('title="Delete Archived Map"');
  const deleteDialogBody = PAGE_SOURCE.slice(deleteDialogIdx, deleteDialogIdx + 300);
  assert.match(deleteDialogBody, /danger/);
});

test("handleArchiveMap and handleDeleteArchivedMap still perform the exact same mutations -- only the confirmation surface changed", () => {
  const archiveIdx = PAGE_SOURCE.indexOf("async function handleArchiveMap(map: MasterMapRow) {");
  const archiveBody = PAGE_SOURCE.slice(archiveIdx, PAGE_SOURCE.indexOf("\n  }", archiveIdx));
  assert.match(archiveBody, /status: "archived"/);
  assert.match(archiveBody, /is_read_only: true/);

  const deleteIdx = PAGE_SOURCE.indexOf("async function handleDeleteArchivedMap(map: MasterMapRow) {");
  const deleteBody = PAGE_SOURCE.slice(deleteIdx, PAGE_SOURCE.indexOf("\n  }", deleteIdx));
  assert.match(deleteBody, /\.from\("master_map_sites"\)\s*\n\s*\.delete\(\)/);
  assert.match(deleteBody, /\.from\("master_maps"\)\s*\n\s*\.delete\(\)/);
});

test("one shared renderRowActions function drives both the DataTable and ResponsiveList presentations, correctly branching on showArchived in both", () => {
  const fnIdx = PAGE_SOURCE.indexOf("function renderRowActions(map: MasterMapRow) {");
  assert.notEqual(fnIdx, -1);
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("\n  }\n\n  return (", PAGE_SOURCE.indexOf("return (\n      <div style={{ display: \"grid\", gap: \"var(--space-2)\"")));
  assert.match(fnBody, /showArchived \?/);
  assert.match(fnBody, /setPendingArchiveMap\(map\)/);
  assert.match(fnBody, /setPendingDeleteMap\(map\)/);

  // Called from both the desktop table cell and the narrow-viewport list item.
  const callSites = (PAGE_SOURCE.match(/\{renderRowActions\(map\)\}/g) || []).length;
  assert.ok(callSites >= 2, `expected renderRowActions to be called from both presentations, found ${callSites}`);
});

test("the desktop table uses the shared DataTable primitive with real column headers, not a hand-rolled CSS grid table", () => {
  assert.match(PAGE_SOURCE, /<DataTable caption=\{showArchived \? "Archived master maps" : "Active master maps"\}>/);
  for (const column of ["Preview", "Name", "Park", "Location", "Status", "Sites", "Actions"]) {
    assert.ok(
      PAGE_SOURCE.includes(`<th scope="col">${column}</th>`),
      `expected a <th scope="col"> for "${column}"`,
    );
  }
});

test("the narrow-viewport presentation uses the shared ResponsiveList primitive, not a second bespoke card layout", () => {
  assert.match(
    PAGE_SOURCE,
    /<ResponsiveList aria-label=\{showArchived \? "Archived master maps" : "Active master maps"\}>/,
  );
});

test("map status renders through the shared StatusBadge, not a hand-rolled colored pill", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*StatusBadge,\s*type StatusBadgeTone\s*\}\s*from\s*["']@\/components\/ui\/StatusBadge["']/,
  );
  assert.equal(/background:\s*\n?\s*map\.status/.test(PAGE_SOURCE), false, "no hand-rolled per-status background should remain");
  assert.match(PAGE_SOURCE, /<StatusBadge tone=\{MAP_STATUS_TONE\[map\.status\]\}>/);
});

test("MAP_STATUS_TONE maps every lifecycle status to a distinct, semantic tone", () => {
  assert.match(PAGE_SOURCE, /published: "success"/);
  assert.match(PAGE_SOURCE, /draft: "warning"/);
  assert.match(PAGE_SOURCE, /archived: "neutral"/);
});

test("masterMapStatusTone classifies confirmation/loading/partial-failure text correctly", () => {
  assert.equal(masterMapStatusTone("Archived map: Saint George"), "success");
  assert.equal(masterMapStatusTone("Restored Saint George as the current map."), "success");
  assert.equal(masterMapStatusTone("Replaced map image for Saint George."), "success");
  assert.equal(masterMapStatusTone("Deleted archived map: Saint George"), "success");
  assert.equal(masterMapStatusTone("Map opening scale settings saved."), "success");

  assert.equal(masterMapStatusTone("Opening Saint George..."), "info");
  assert.equal(masterMapStatusTone("Viewing 12 active map(s)."), "neutral");

  assert.equal(masterMapStatusTone("Could not archive map: network error"), "danger");
  assert.equal(
    masterMapStatusTone("Draft created, but could not load source markers: timeout"),
    "danger",
  );
  assert.equal(masterMapStatusTone("One or more map opening scales are invalid."), "danger");
});

test("the Map Opening Scale Settings form uses the canonical Field/Input/FormActions primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Field,\s*Input\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  for (const label of ["Coach Map", "Parking Admin Map", "Locations Map", "Replace Image"]) {
    assert.ok(PAGE_SOURCE.includes(`label="${label}"`), `expected a Field for "${label}"`);
  }
  assert.match(PAGE_SOURCE, /<FormActions>/);
});

test("Create New Master Map uses a real Next Link styled as a button (client-side transition preserved), not a <button> nested inside an <a>", () => {
  assert.equal(/<Link href="\/admin\/master-maps\/new">\s*\n\s*<button/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /<Link href="\/admin\/master-maps\/new" className="app-button">/);
});

test("loading and empty presentations use the canonical LoadingState/EmptyState primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(PAGE_SOURCE, /<LoadingState message="Loading master maps\.\.\." \/>/);
  assert.match(
    PAGE_SOURCE,
    /<EmptyState message=\{showArchived \? "No archived maps found\." : "No active maps found\."\} \/>/,
  );
});

test("no raw <button> remains for the page's own primary actions -- Save, Create, View Archived all use AppButton", () => {
  assert.equal(/<button\s*$/m.test(PAGE_SOURCE), false);
  assert.equal(/<button\s*\n/.test(PAGE_SOURCE), false);
  assert.equal(/<button type="button"/.test(PAGE_SOURCE), false);
});
