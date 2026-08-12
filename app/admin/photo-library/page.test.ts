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

test("photo library's only event_photos table access is a read", () => {
  const matches = [...PAGE_SOURCE.matchAll(/\.from\(["']event_photos["']\)/g)];
  assert.equal(matches.length, 1, 'expected exactly one .from("event_photos") call');

  const idx = matches[0].index ?? 0;
  const tail = PAGE_SOURCE.slice(idx, idx + 60);
  assert.match(tail, /\.select\(/, "the one remaining event_photos access must be a .select()");
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

test("page uses the canonical Admin shell (migrated by a later, separate shell-migration stage)", () => {
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});
