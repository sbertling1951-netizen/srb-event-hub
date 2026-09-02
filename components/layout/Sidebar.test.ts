import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)), "utf8");

test("the legacy Sidebar mirrors canonical Tenant Administration discovery for Super Admin only", () => {
  assert.match(
    SOURCE,
    /adminAccess\?\.isSuperAdmin && \{\s*label: "Tenant Administration",\s*href: "\/admin\/tenants",\s*\}/,
  );
  assert.match(SOURCE, /"\/admin\/tenants": "🏢"/);
  assert.equal(/href: "\/admin\/tenant-admins"/.test(SOURCE), false);
});

test("M1: the dead check-in arrival state and its storage listener are removed", () => {
  // the unused _isCheckedIn state variable + its setter are gone
  assert.doesNotMatch(SOURCE, /_isCheckedIn/);
  assert.doesNotMatch(SOURCE, /setIsCheckedIn/);
  // the arrival key is no longer read or listened for by the Sidebar
  assert.doesNotMatch(SOURCE, /getStoredMemberHasArrived/);
  assert.doesNotMatch(SOURCE, /STORAGE_KEYS\.memberHasArrived/);
});

test("M1: the orphan member-event-updated CustomEvent dispatch is removed; the admin one remains", () => {
  assert.doesNotMatch(SOURCE, /APP_EVENT_NAMES\.memberEventUpdated/);
  assert.doesNotMatch(SOURCE, /member-event-updated/);
});

test("N3: the Sidebar emits the admin-event-updated CustomEvent under the CANONICAL name only", () => {
  // The redundant legacy same-document `fcoc-admin-event-updated` emit is
  // retired -- the Sidebar dispatches the canonical name once.
  assert.match(
    SOURCE,
    /dispatchCanonicalWindowEvent\(APP_EVENT_NAMES\.adminEventUpdated\)/,
  );
  // no legacy same-document emit remains
  assert.doesNotMatch(SOURCE, /dualDispatchWindowEvent/);
  assert.doesNotMatch(SOURCE, /LEGACY_APP_EVENT_NAMES/);
  assert.doesNotMatch(SOURCE, /fcoc-admin-event-updated/);
});

test("N3: the legacy admin-event listener acceptance is UNCHANGED (still dual-listens during the bake)", () => {
  const ctx = readFileSync(
    fileURLToPath(new URL("../../lib/adminEventContext.ts", import.meta.url)),
    "utf8",
  );
  // subscribeToAdminEventChange keeps dual-listening (canonical + legacy)
  assert.match(
    ctx,
    /addDualWindowEventListener\(\s*ADMIN_EVENT_UPDATED,\s*LEGACY_ADMIN_EVENT_UPDATED,/,
  );
  assert.match(ctx, /LEGACY_APP_EVENT_NAMES\.adminEventUpdated/);
});

test("M1: root arrival-routing behavior is untouched -- the arrival key stays live for the '/' redirect", () => {
  const rootRedirect = readFileSync(
    fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(rootRedirect, /getStoredMemberHasArrived\(\)/);
  assert.match(rootRedirect, /hasArrived === "true"/);
});
