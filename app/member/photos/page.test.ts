import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Regression coverage for the Attendee historical-photo invariant
// (docs/architecture/ADR-013 Event Lifecycle and Historical Preservation
// Architecture.md §3.4/§4, accepted): an attendee's ability to view and
// download authorized Event photos is independent of Event lifecycle
// state. Inactive, Post-Event, Archived, and historically frozen states
// do not by themselves terminate photo retrieval, and the 1-hour signed
// URL is transport/security behavior only, never an entitlement
// expiration. This file protects the current, already-correct behavior
// against future regression -- no schema or lifecycle work exists yet
// for this to test against, so these are structural source-text
// assertions, matching this repo's established test convention. Run
// with:
//   npx tsx --test app/member/photos/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("photo retrieval never reads events.status or events.is_active anywhere in this page", () => {
  assert.equal(/is_active/.test(PAGE_SOURCE), false);
  assert.equal(/isActiveEventStatus/.test(PAGE_SOURCE), false);
  // A bare "<x>.status" read/compare would also be suspicious here, but
  // this page legitimately uses "photo_status" (the photo's own
  // moderation state) extensively -- assert no OTHER identifier's
  // ".status" is read, in particular never "event.status".
  for (const match of PAGE_SOURCE.matchAll(/([a-zA-Z_]+)\.status\b/g)) {
    assert.notEqual(
      match[1],
      "event",
      "found event.status read in the member photo page -- lifecycle status must never gate photo retrieval",
    );
  }
});

test("no lifecycle, archive, or entitlement/subscription concept has been introduced into photo retrieval", () => {
  for (const forbidden of [
    "lifecycle_state",
    "archived",
    "post_event",
    "entitlement",
    "subscription",
    "storage_tier",
    "retention_period",
  ]) {
    assert.equal(
      new RegExp(forbidden, "i").test(PAGE_SOURCE),
      false,
      `found "${forbidden}" in the member photo page -- no Lifecycle or Entitlement gating exists yet and none should be added without an explicit, independent Entitlement check per ADR-013`,
    );
  }
});

test("the signed URL TTL is a fixed, re-fetchable 1-hour window, not a stored/tracked expiration", () => {
  const matches = [...PAGE_SOURCE.matchAll(/createSignedUrl\(([^)]*)\)/g)];
  assert.ok(matches.length >= 2, "expected at least 2 createSignedUrl call sites (thumbnail + full/download)");
  for (const match of matches) {
    assert.match(match[1], /60 \* 60/, "expected the 1-hour TTL literal at every signed-URL call site");
  }
  // Regenerable on demand: no persisted "url issued at"/"url expires at"
  // bookkeeping exists that would turn this into a one-time-use grant.
  assert.equal(/expires_at|issued_at|url_expiry/i.test(PAGE_SOURCE), false);
});

test("photo authorization is scoped by event_id and photo/attendee ownership only, never by a lifecycle predicate", () => {
  const loadIdx = PAGE_SOURCE.indexOf("async function loadApprovedPhotos(eventId: string)");
  assert.notEqual(loadIdx, -1);
  const loadBody = PAGE_SOURCE.slice(loadIdx, loadIdx + 600);

  assert.match(loadBody, /\.eq\("event_id", eventId\)/);
  assert.equal(/is_active|lifecycle|archived/i.test(loadBody), false);
});

test("Member Workspace Continuity: this identity-dependent page is under MemberRouteGuard; the page body renders only a resolved workspace", () => {
  assert.match(PAGE_SOURCE, /import MemberRouteGuard from "@\/components\/auth\/MemberRouteGuard";/);
  assert.match(PAGE_SOURCE, /function MemberPhotosPageInner\(\) \{/);
  assert.match(
    PAGE_SOURCE,
    /export default function MemberPhotosPage\(\) \{[\s\S]{0,360}?<MemberRouteGuard>\s*\n\s*<MemberPhotosPageInner \/>\s*\n\s*<\/MemberRouteGuard>/,
  );
});
