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

// P0 Event-Photo Read-Surface Repair (traffic correction): the gallery-image
// route now requires a controlled "grid"/"full" variant label, and this page
// must be the one place that decides which variant applies to which UI
// surface -- never a raw width/height passed through from the browser.
test("the grid batch requests the 'grid' variant, and the on-demand full-view loader requests the 'full' variant -- never a raw dimension", () => {
  assert.match(PAGE_SOURCE, /createGalleryRenditionBatch\(photos, "grid"\)/);
  assert.match(
    PAGE_SOURCE,
    /fetchGalleryRenditionUrl\(\s*\n?\s*photo\.id,\s*\n?\s*"full",/,
  );
  // No width/height/resize ever appears in a gallery-image query string.
  assert.equal(
    /\/api\/photos\/gallery-image\?[^`"']*\b(width|height|resize)\b/.test(
      PAGE_SOURCE,
    ),
    false,
  );
});

test("the 'full' rendition is fetched lazily, only for the photo currently open in the viewer, not for the whole gallery up front", () => {
  const loadIdx = PAGE_SOURCE.indexOf("async function loadApprovedPhotos(eventId: string)");
  assert.notEqual(loadIdx, -1);
  const loadBody = PAGE_SOURCE.slice(loadIdx, PAGE_SOURCE.indexOf("\n  }\n", loadIdx));
  // Excludes this file's own explanatory comments (which legitimately name
  // "full" in prose) -- only an actual call-argument use would be a bug.
  assert.equal(
    /,\s*"full"\s*\)/.test(loadBody),
    false,
    "loadApprovedPhotos must never pass the full variant as a call argument",
  );

  assert.match(PAGE_SOURCE, /function ensureGalleryViewUrl\(photo: ApprovedPhoto\)/);
  assert.match(
    PAGE_SOURCE,
    /useEffect\(\(\) => \{\s*\n\s*if \(selectedPhoto && !selectedPhoto\.viewUrl\)/,
  );
});

test("Member Workspace Continuity: this identity-dependent page is under MemberRouteGuard; the page body renders only a resolved workspace", () => {
  assert.match(PAGE_SOURCE, /import MemberRouteGuard from "@\/components\/auth\/MemberRouteGuard";/);
  assert.match(PAGE_SOURCE, /function MemberPhotosPageInner\(\) \{/);
  assert.match(
    PAGE_SOURCE,
    /export default function MemberPhotosPage\(\) \{[\s\S]{0,360}?<MemberRouteGuard>\s*\n\s*<MemberPhotosPageInner \/>\s*\n\s*<\/MemberRouteGuard>/,
  );
});

// ---------------------------------------------------------------------------
// Presentation Slice 1: status/error, Refresh, and the two empty states now
// use the shared Alert/AppButton/EmptyState primitives, with no change to
// any upload/storage/RPC/lifecycle contract beneath them.
// ---------------------------------------------------------------------------

test("the page uses no back target, matching every other primary Member-nav page", () => {
  assert.equal((PAGE_SOURCE.match(/backTarget=/g) || []).length, 0);
});

test("status/error use the shared Alert primitive, and the failure surface is singular (no duplicate status+error)", () => {
  assert.match(PAGE_SOURCE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(PAGE_SOURCE, /\{status && !error \? <Alert tone="info">\{status\}<\/Alert> : null\}/);
  assert.match(PAGE_SOURCE, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
});

test("Refresh uses the shared AppButton with the exact click handler, label swap, and loading-driven disabled behavior", () => {
  assert.match(PAGE_SOURCE, /import \{ AppButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(
    PAGE_SOURCE,
    /<AppButton\s*\n\s*variant="secondary"\s*\n\s*loading=\{refreshing\}\s*\n\s*onClick=\{\(\) => void refreshUploads\(\)\}\s*\n\s*>\s*\n\s*\{refreshing \? "⟳ Refreshing\.\.\." : "↻ Refresh"\}\s*\n\s*<\/AppButton>/,
  );
});

test("both empty states use the shared EmptyState primitive, preserving their exact gates and copy", () => {
  assert.match(PAGE_SOURCE, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(
    PAGE_SOURCE,
    /\{uploads\.length === 0 \? \(\s*\n\s*<EmptyState message="No photos uploaded yet\." \/>/,
  );
  assert.match(
    PAGE_SOURCE,
    /\{approvedPhotos\.length === 0 \? \(\s*\n\s*<EmptyState message="No approved event photos are available yet\." \/>/,
  );
});

test("Slice 1 leaves the upload composer, progress widget, My Uploads cards/actions, gallery grid, and viewer modal untouched", () => {
  assert.match(PAGE_SOURCE, /Batch Upload Caption \(optional\)/);
  assert.match(PAGE_SOURCE, /Please keep this page open until all uploads complete\./);
  assert.match(PAGE_SOURCE, /window\.confirm\("Delete this photo\?"\)/);
  assert.match(PAGE_SOURCE, /aria-label="View event photo"/);
  assert.match(PAGE_SOURCE, /aria-label="Event photo viewer"/);
  assert.match(PAGE_SOURCE, /Download Photo/);
  assert.match(PAGE_SOURCE, /Share Photo/);
});

test("Slice 1 leaves every load/upload/delete/download/share/rendition function and its storage/RPC/query calls unchanged", () => {
  assert.match(PAGE_SOURCE, /async function loadUploads\(attendeeId: string\) \{/);
  assert.match(PAGE_SOURCE, /async function loadApprovedPhotos\(eventId: string\) \{/);
  assert.match(PAGE_SOURCE, /async function uploadPhoto\(file: File\) \{/);
  assert.match(PAGE_SOURCE, /async function deletePhoto\(photo: UploadedPhoto\) \{/);
  assert.match(PAGE_SOURCE, /async function downloadPhoto\(photo: ApprovedPhoto\) \{/);
  assert.match(PAGE_SOURCE, /async function sharePhoto\(photo: ApprovedPhoto\) \{/);
  assert.match(PAGE_SOURCE, /supabase\.storage\s*\n\s*\.from\("event-photos"\)/);
  assert.match(PAGE_SOURCE, /activityType: "photos_view"/);
});
