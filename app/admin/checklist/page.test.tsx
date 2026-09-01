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
