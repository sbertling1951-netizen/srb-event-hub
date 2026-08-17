import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checklistStorageKeyForEvent } from "@/app/admin/checklist/page";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("checklist persistence remains device-local and partitioned by Event", () => {
  assert.equal(checklistStorageKeyForEvent("event-a"), "fcoc-pre-rally-checklist-event-a");
  assert.equal(checklistStorageKeyForEvent("event-b"), "fcoc-pre-rally-checklist-event-b");
  assert.equal(checklistStorageKeyForEvent(null), "fcoc-pre-rally-checklist");
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
