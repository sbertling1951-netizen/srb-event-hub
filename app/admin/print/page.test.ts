import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { printStatusTone } from "@/app/admin/print/page";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

// Print Center registration-selection reconciliation --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, Canonical
// Event Operational Summary Read Contract, Consumer implications for Print:
// "If Print calls a queue 'Active,' it must use the canonical
// active-registration definition."

test("Print's default queue excludes cancelled registrations regardless of the inactive toggle", () => {
  assert.match(
    source,
    /\[\.\.\.attendees, \.\.\.manualAttendees\]\.filter\(\s*\(row\) => row\.registration_status !== "cancelled",\s*\)/,
  );
});

test("Print's default queue matches the canonical Active Registration definition (not cancelled AND is_active)", () => {
  assert.match(
    source,
    /if \(!includeInactive\) {\s*rows = rows\.filter\(\(row\) => row\.is_active\);\s*}/,
  );
});

test("Print no longer mislabels its default queue as attendees", () => {
  assert.ok(!source.includes("All Active Attendees"));
  assert.ok(source.includes('<option value="all">All Active Registrations</option>'));
});

test("Manual print-queue rows stay operational queue records, not canonical registrations", () => {
  // Manual rows are visually flagged and independently deletable -- they
  // are never routed through fetchEventOperationalSummary or any other
  // canonical-aggregate surface.
  assert.ok(source.includes('row.id.startsWith("manual-")'));
  assert.ok(!source.includes("fetchEventOperationalSummary"));
});

test("Print does not duplicate a canonical aggregate registration count", () => {
  // Print's own "N of M filtered" text is a page-local queue count, not a
  // claimed canonical aggregate, so it may keep its own arithmetic; it must
  // not import the canonical summary types/labels used for that purpose.
  assert.ok(!source.includes("CanonicalEventOperationalSummary"));
  assert.ok(!source.includes("toEventOperationalSummaryCards"));
});

// Row-level Site display reconciliation --
// docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md,
// EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md §6.2: Print's queue
// Site value must derive from canonical parking_sites occupancy, never
// attendees.assigned_site.

test("Print no longer declares, selects, or reads attendees.assigned_site", () => {
  assert.ok(
    !source.includes("assigned_site: string | null;"),
    "AttendeeRow must not declare assigned_site",
  );
  assert.ok(
    !/^\s*assigned_site,\s*$/m.test(source),
    "the attendees select list must not include assigned_site",
  );
  assert.ok(
    !source.includes("row.assigned_site"),
    "no row-level read of attendees.assigned_site may remain",
  );
});

test("Print loads canonical parking_sites occupancy alongside attendees", () => {
  assert.ok(source.includes('from("parking_sites")'));
  assert.match(
    source,
    /\.select\("id,event_id,site_number,display_label,assigned_attendee_id"\)/,
  );
  assert.ok(source.includes("setParkingSites(parkingRows)"));
});

test("Print's queue Site display derives from canonical placement, not attendees.assigned_site", () => {
  assert.ok(
    source.includes(
      "Site: {canonicalSiteLabelByAttendeeId.get(row.id) || \"—\"}",
    ),
  );
  assert.match(
    source,
    /const canonicalSiteLabelByAttendeeId = useMemo\(\(\) => \{\s*const labels = new Map<string, string>\(\);\s*for \(const site of parkingSites\) \{\s*if \(site\.assigned_attendee_id\) \{\s*labels\.set\(site\.assigned_attendee_id, siteLabel\(site\)\);/,
  );
});

test("manual print entries never carry assigned_site and are never keyed into canonical placement", () => {
  // createEmptyManualAttendee's id is "manual-<kind>-<uuid>", which can
  // never match a real attendee_id in parking_sites.assigned_attendee_id,
  // so canonicalSiteLabelByAttendeeId.get(row.id) is always undefined for
  // a manual row -- it falls through to the existing "—" display exactly
  // as attendees.assigned_site (always null for manual rows) did before.
  assert.ok(source.includes('id: `manual-${kind}-${uniqueId}`,'));
  assert.ok(!source.includes("assigned_site: null,"));
});

// Task-Authority Guard Design, Print consumer migration. Print Center
// performs zero database writes (verified: no .update/.upsert/.insert/
// .delete/.rpc anywhere in this page) -- it is a pure view + client-side
// print surface, so its route requires event.print.view, not .manage.

test("Print Center route requires event.print.view, not the legacy can_manage_reports permission", () => {
  assert.match(source, /<AdminRouteGuard requiredTask="event\.print\.view">/);
  assert.equal(/requiredPermission/.test(source), false);
  assert.equal(/can_manage_reports/.test(source), false);
});

test("Print Center performs no database write of any kind -- confirms it is a view-only surface, consistent with event.print.view", () => {
  assert.equal(/\.update\(/.test(source), false);
  assert.equal(/\.upsert\(/.test(source), false);
  assert.equal(/\.insert\(/.test(source), false);
  assert.equal(/\.delete\(/.test(source), false);
  assert.equal(/\.rpc\(/.test(source), false);
});

test("the unrelated can_manage_admins check (which admin may browse all Events to print for) is preserved unchanged -- not part of this migration", () => {
  assert.match(
    source,
    /const superAdminCanSelectEvents = hasPermission\(\s*\n\s*admin,\s*\n\s*"can_manage_admins",\s*\n\s*\);/,
  );
});

test("the Print Settings link's visibility uses the shared canonical helper for event.print.manage, replacing the dead can_manage_print_settings key", () => {
  assert.equal(/hasPermission\([^)]*"can_manage_print_settings"/.test(source), false);
  assert.match(
    source,
    /import \{ checkAdminEventTaskAuthority \} from "@\/lib\/adminTaskAuthority";/,
  );
  assert.match(
    source,
    /checkAdminEventTaskAuthority\(\s*"event\.print\.manage",\s*eventId,?\s*\)/,
  );
  assert.match(source, /\{canManagePrintSettings \? \(/);
  assert.equal(/\.rpc\(\s*"has_event_task_authority"/.test(source), false);
  assert.equal((source.match(/checkAdminEventTaskAuthority\(/g) || []).length, 1);
});

test("Print Settings link authority fails closed and resets before the async check resolves", () => {
  assert.match(
    source,
    /const \[canManagePrintSettings, setCanManagePrintSettings\] = useState\(false\);/,
  );
  const fn = source.slice(
    source.indexOf("const runPrintSettingsAuthorityCheck = useCallback"),
  );
  const fnBody = fn.slice(0, fn.indexOf("}, []);"));
  const resetIdx = fnBody.indexOf("setCanManagePrintSettings(false);");
  const checkIdx = fnBody.indexOf("checkAdminEventTaskAuthority(");
  assert.ok(resetIdx > -1 && checkIdx > -1);
  assert.ok(resetIdx < checkIdx, "must reset before issuing the async check");
  assert.match(fnBody, /setCanManagePrintSettings\(result\.status === "allowed"\);/);
  assert.equal(/setCanManagePrintSettings\(true\)/.test(source), false);
});

test("Print Settings link authority discards a stale response from an abandoned Event's check", () => {
  const fn = source.slice(
    source.indexOf("const runPrintSettingsAuthorityCheck = useCallback"),
  );
  assert.match(fn, /const generation = \+\+printSettingsCheckGeneration\.current;/);
  assert.match(
    fn,
    /if \(printSettingsCheckGeneration\.current === generation\) \{\s*\n\s*setCanManagePrintSettings\(result\.status === "allowed"\);/,
  );
});

test("Print Settings link authority re-checks on every Admin working-Event change via the canonical subscription", () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*\n\s*runPrintSettingsAuthorityCheck\(\);\s*\n\s*\n\s*return subscribeToAdminWorkspace\(runPrintSettingsAuthorityCheck\);\s*\n\s*\}, \[runPrintSettingsAuthorityCheck\]\);/,
  );
});

test("printing itself (window.print) remains ungated, unchanged -- Print Center's own view/print action was never a distinct manage-level capability", () => {
  assert.match(source, /function handlePrint\(\) \{\s*\n\s*window\.print\(\);\s*\n\s*\}/);
  assert.match(source, /function printOnlyAttendee\(attendeeId: string\) \{/);
});

// -- Admin Batch 2: Central UI Standard migration ---------------------------

test("the print-area's printed content and print CSS are untouched by the UI migration -- same className, same @media print rules, same sheet/card markup", () => {
  assert.match(source, /className="print-area"/);
  assert.match(source, /className="name-tag-sheets"/);
  assert.match(source, /className="name-tag-sheet"/);
  assert.match(source, /className="coach-plate-card"/);
  assert.match(source, /@media print \{/);
  assert.match(source, /\.print-area, \.print-area \* \{/);
});

test("the controls region uses the canonical Field/Select/Input/Checkbox primitives -- no raw form control remains outside the print-area", () => {
  const printAreaIdx = source.indexOf('className="print-area"');
  const controlsSource = source.slice(0, printAreaIdx);
  assert.equal(/<select\b/.test(controlsSource), false);
  assert.equal(/<textarea\b/.test(controlsSource), false);
  assert.match(
    source,
    /import\s*\{\s*Checkbox,\s*Field,\s*Input,\s*Select\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
});

test("the hand-rolled print-editor overlay is now the canonical Dialog primitive", () => {
  assert.match(source, /import \{ Dialog \} from "@\/components\/ui\/Dialog";/);
  assert.match(source, /<Dialog\s*\n\s*open=\{!!editPreviewRow\}/);
  assert.equal(/printEditorOverlayStyle/.test(source), false);
  assert.equal(/printEditorModalStyle/.test(source), false);
});

test("the print-editor Dialog still performs the exact same override/queue/delete calls -- only the modal shell changed", () => {
  const dialogIdx = source.indexOf("<Dialog");
  const dialogEnd = source.indexOf("</Dialog>", dialogIdx);
  const dialogBlock = source.slice(dialogIdx, dialogEnd);
  for (const needle of [
    "updatePrintOverride(",
    "clearPrintOverride(editPreviewRow.id)",
    "removeManualEntry(editPreviewRow.id)",
    "addToPrintQueue(editPreviewRow.id)",
    "removeFromPrintQueue(editPreviewRow.id)",
    "printOnlyAttendee(editPreviewRow.id)",
  ]) {
    assert.ok(dialogBlock.includes(needle), `Dialog block must retain ${needle}`);
  }
});

test("no raw <button> remains outside the print-area -- every control action uses AppButton", () => {
  const printAreaIdx = source.indexOf('className="print-area"');
  const controlsSource = source.slice(0, printAreaIdx);
  assert.equal(/<button\b/.test(controlsSource), false);
});

test("navigation links use the canonical .app-button class via Link (client-side transition preserved), not a page-local navigationLinkStyle", () => {
  assert.equal(/navigationLinkStyle/.test(source), false);
  assert.match(source, /<Link href="\/admin\/dashboard" className="app-button">/);
  assert.match(source, /<Link href="\/admin\/reports" className="app-button">/);
});

test("the page-local isMobile resize listener is gone -- replaced by the shared useShellInterfaceCapabilities() hook", () => {
  assert.equal(/addEventListener\("resize"/.test(source), false);
  assert.equal(/window\.innerWidth/.test(source), false);
  assert.match(
    source,
    /const \{ isCompact: isMobile \} = useShellInterfaceCapabilities\(\);/,
  );
});

test("loading/empty presentation in the Who Will Print list uses the canonical LoadingState/EmptyState primitives", () => {
  assert.match(source, /<LoadingState message="Loading\.\.\." \/>/);
  assert.match(source, /<EmptyState message="No attendees found for this filter\." \/>/);
});

test("printStatusTone classifies confirmation/loading/failure text correctly", () => {
  assert.equal(printStatusTone("Loaded 12 attendees."), "success");
  assert.equal(printStatusTone("Loading print center..."), "info");
  assert.equal(printStatusTone("Access denied."), "danger");
  assert.equal(printStatusTone("No admin working event selected."), "danger");
  assert.equal(printStatusTone("Failed to load print center."), "danger");
});
