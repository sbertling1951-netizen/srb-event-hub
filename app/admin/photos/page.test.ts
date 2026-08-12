import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Photo/Media Authority Foundation Stage 2 Admin
// Photos governed RPC cutover. Run with:
//   npx tsx --test app/admin/photos/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("admin photos page contains no direct event_photos mutation", () => {
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

test("admin photos page calls the governed manage_event_photo RPC for both approve/reject and undo", () => {
  const matches = [...PAGE_SOURCE.matchAll(/manage_event_photo/g)];
  assert.ok(matches.length >= 2, "expected manage_event_photo referenced by both updatePhotoStatus and undoLastAction");
});

test("undo preserves featured_level and member_caption rather than dropping them", () => {
  assert.match(PAGE_SOURCE, /previousFeaturedLevel/);
  assert.match(PAGE_SOURCE, /previousMemberCaption/);
  assert.match(PAGE_SOURCE, /p_featured_level:\s*undoData\.previousFeaturedLevel/);
});

test("shell wrapper and AdminRouteGuard remain in place", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});
