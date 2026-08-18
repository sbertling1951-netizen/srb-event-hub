import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Photo/Media Authority Foundation Stage 2 Photo
// Library governance cutover. Run with:
//   npx tsx --test app/admin/photo-library/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);


test("photo library page contains no direct event_photos mutation", () => {
  const prohibited: RegExp[] = [
    /\.from\(["']event_photos["']\)\s*\.\s*update/,
    /\.from\(["']event_photos["']\)\s*\.\s*insert/,
    /\.from\(["']event_photos["']\)\s*\.\s*delete/,
    /\.from\(["']event_photos["']\)\s*\.\s*upsert/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(PAGE_SOURCE), false, `found prohibited direct-mutation pattern: ${pattern}`);
  }
});

test("photo library consumes the shared scoped photo cache instead of direct table access", () => {
  assert.match(PAGE_SOURCE, /loadAdminPhotoSnapshot/);
  assert.equal(/\.from\(["']event_photos["']\)/.test(PAGE_SOURCE), false);
});

test("photo library calls the same governed manage_event_photo RPC as Admin Photos", () => {
  assert.match(PAGE_SOURCE, /["']manage_event_photo["']/);
});

test("Featured checkbox maps deterministically to featured_level (unchecked=0, checked=1), not a separate is_featured write", () => {
  assert.match(PAGE_SOURCE, /featured_level:\s*checked\s*\?\s*1\s*:\s*0/);
  assert.equal(/is_featured:\s*checked/.test(PAGE_SOURCE), false, "must not independently write is_featured from the checkbox");
});

test("page is gated by AdminRouteGuard", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
});

// Task-Authority Guard Design, Photos consumer migration. Photo Library
// is Event-scoped, not a shared/global asset library: fetchPhotos scopes
// every read to getCurrentAdminEvent(), re-fetches on Event switch via
// subscribeToAdminWorkspace, and handleSave's only mutation is the same
// governed manage_event_photo RPC Admin Photos uses -- already
// server-side gated by event.photos.manage. Same authority shape as
// Admin Photos; the route previously carried no permission at all
// (bare AdminRouteGuard).

test("route requires event.photos.manage -- previously ungated beyond authentication", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredTask="event\.photos\.manage">/);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("photo library remains Event-scoped: every read and the one mutation are keyed to getCurrentAdminEvent()", () => {
  assert.match(PAGE_SOURCE, /const currentEvent = getCurrentAdminEvent\(\);/);
  assert.match(PAGE_SOURCE, /subscribeToAdminWorkspace\(/);
});

test("page uses the canonical Admin shell (migrated by a later, separate shell-migration stage)", () => {
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

test("library thumbnails are transformed, lazy, and review URLs are requested on demand", () => {
  assert.match(PAGE_SOURCE, /"library-thumbnail-360x240"/);
  assert.match(PAGE_SOURCE, /loading="lazy"/);
  assert.match(PAGE_SOURCE, /"review-800"/);
  assert.equal(/createSignedUrl\(/.test(PAGE_SOURCE), false);
});

test("library rejects stale async loads and clears prior-user cache on auth change", () => {
  assert.match(PAGE_SOURCE, /loadGenerationRef/);
  assert.match(PAGE_SOURCE, /onAuthStateChange/);
  assert.match(PAGE_SOURCE, /clearAdminPhotoCacheForUser/);
});

test("photo cards expose button semantics and activate with Enter or Space", () => {
  assert.match(PAGE_SOURCE, /role="button"/);
  assert.match(PAGE_SOURCE, /tabIndex=\{0\}/);
  assert.match(PAGE_SOURCE, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(PAGE_SOURCE, /event\.preventDefault\(\);\s*openModal\(photo\);/);
});

test("photo save failures use the page error channel instead of a browser alert", () => {
  assert.match(PAGE_SOURCE, /setError\(`Failed to save changes:/);
  assert.equal(/\balert\(/.test(PAGE_SOURCE), false);
});
