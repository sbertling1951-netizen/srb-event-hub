import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checklistStorageKeyForEvent,
  previousChecklistStorageKeyForEvent,
} from "@/app/admin/checklist/page";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("checklist persistence remains device-local and partitioned by Event", () => {
  assert.equal(checklistStorageKeyForEvent("event-a"), "epicentrax-pre-rally-checklist-event-a");
  assert.equal(checklistStorageKeyForEvent("event-b"), "epicentrax-pre-rally-checklist-event-b");
  assert.equal(checklistStorageKeyForEvent(null), "epicentrax-pre-rally-checklist");
});

test("a prior checklist value is read only as a narrow migrate-on-read source", () => {
  assert.equal(
    previousChecklistStorageKeyForEvent("event-a"),
    "fcoc-pre-rally-checklist-event-a",
  );
  assert.match(PAGE_SOURCE, /readAndMigrateTier5LocalStorage\(/);
});

test("an Admin Event A to Event B switch rebinds the checklist through canonical workspace context", () => {
  assert.match(PAGE_SOURCE, /getCurrentAdminEvent\(\)\?\.id/);
  assert.match(PAGE_SOURCE, /subscribeToAdminWorkspace\(syncStorageKey\)/);
  assert.match(
    PAGE_SOURCE,
    /setStorageKey\(checklistStorageKeyForEvent\(getCurrentAdminEvent\(\)\?\.id\)\);/,
  );
  assert.match(PAGE_SOURCE, /setLoadedStorageKey\(storageKey\);/);
  assert.match(PAGE_SOURCE, /if \(loadedStorageKey !== storageKey\)/);
  assert.doesNotMatch(PAGE_SOURCE, /localStorage\.getItem\("fcoc-admin-event-context"\)/);
});

// Central UI Standard, Stage 3 -- checklist migration. These assert the
// page actually consumes the canonical primitives (not a page-local
// look-alike) and that hand-applied legacy patterns are gone.
test("the page renders through the canonical PageSection, AppButton, Field Checkbox, and ConfirmDialog primitives", () => {
  assert.match(PAGE_SOURCE, /from "@\/components\/ui\/PageSection"/);
  assert.match(PAGE_SOURCE, /from "@\/components\/ui\/AppButton"/);
  assert.match(PAGE_SOURCE, /from "@\/components\/ui\/Field"/);
  assert.match(PAGE_SOURCE, /from "@\/components\/ui\/ConfirmDialog"/);
});

test("Reset Checklist is destructive-confirmed through the canonical Dialog, not window.confirm", () => {
  assert.doesNotMatch(PAGE_SOURCE, /window\.confirm/);
  assert.match(PAGE_SOURCE, /<ConfirmDialog/);
  assert.match(PAGE_SOURCE, /danger/);
});

test("the reset trigger uses the danger action variant, not a bare unstyled button", () => {
  assert.match(PAGE_SOURCE, /<AppButton variant="danger" onClick=\{\(\) => setResetDialogOpen\(true\)\}>/);
  assert.doesNotMatch(PAGE_SOURCE, /<button onClick=\{resetChecklist\}>/);
});

test("checklist items use the canonical Checkbox (native input, label-associated) instead of a hand-rolled checkbox+label", () => {
  assert.match(PAGE_SOURCE, /<Checkbox\b/);
  assert.doesNotMatch(PAGE_SOURCE, /<input\s+type="checkbox"/);
});

// -- Title/return-navigation alignment: visible wording only. The
// underlying localStorage key/schema/migration behavior (asserted above)
// is keyed on "pre-rally-checklist" literals and is deliberately
// untouched -- only the shell's displayed page title changes.

test("the visible page title and shell pageTitle are exactly \"Pre-Event Checklist\", matching the canonical nav label", () => {
  assert.match(PAGE_SOURCE, /<AdminShellAdapter\s*\n\s*pageTitle="Pre-Event Checklist"/);
  assert.doesNotMatch(PAGE_SOURCE, /pageTitle="Pre-Rally Checklist"/);
  assert.equal((PAGE_SOURCE.match(/<AdminShellAdapter/g) || []).length, 1);
});

test("the shell backTarget points to Event Admin (/admin/events)", () => {
  assert.match(
    PAGE_SOURCE,
    /backTarget=\{\{ href: "\/admin\/events", label: "Event Admin" \}\}/,
  );
});

test("the original route guard is preserved exactly -- no task authority, no adminNav change, no second guard", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredPermission="can_view_admin_dashboard">/);
  assert.equal((PAGE_SOURCE.match(/<AdminRouteGuard/g) || []).length, 1);
  assert.doesNotMatch(PAGE_SOURCE, /requiredTask/);
  assert.doesNotMatch(PAGE_SOURCE, /adminNav/);
});

test("localStorage keys/schema and the migrate-on-read source remain the literal pre-rally-checklist strings, unaffected by the visible title change", () => {
  assert.equal(checklistStorageKeyForEvent("event-a"), "epicentrax-pre-rally-checklist-event-a");
  assert.equal(previousChecklistStorageKeyForEvent("event-a"), "fcoc-pre-rally-checklist-event-a");
});

test("no workspace section, AdminReturnLink, or new loading/empty state primitive was introduced", () => {
  assert.doesNotMatch(PAGE_SOURCE, /getAdminNavItemChildren/);
  assert.doesNotMatch(PAGE_SOURCE, /AdminReturnLink/);
  assert.doesNotMatch(PAGE_SOURCE, /LoadingState|EmptyState/);
});
