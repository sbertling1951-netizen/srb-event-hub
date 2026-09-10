import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// P0 Event-Photo Read-Surface Repair: structural proof for the shared
// rendition-delivery helper. Run with:
//   npx tsx --test lib/server/eventPhotoRendition.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./eventPhotoRendition.ts", import.meta.url)),
  "utf8",
);

test("this module is server-only and performs no authorization decision of its own", () => {
  assert.match(SOURCE, /^import "server-only";/m);
  assert.equal(/auth\.uid|resolveAuthenticatedRequest|is_own_attendee|is_event_scoped_admin/i.test(SOURCE), false);
});

test("every signed-URL creation includes a transform -- an untransformed fetch is never performed", () => {
  const calls = [...SOURCE.matchAll(/createSignedUrl\(([\s\S]*?)\);/g)];
  assert.ok(calls.length >= 1, "expected at least one createSignedUrl call");
  for (const call of calls) {
    assert.match(call[1], /transform:\s*\{/, "every createSignedUrl call must include a transform option");
  }
});

test("the internal signed URL is fetched by this same process and only its bytes are returned -- the URL itself is never part of the return value", () => {
  assert.match(SOURCE, /fetch\(data\.signedUrl\)/);
  assert.equal(/return\s*\{[^}]*signedUrl/.test(SOURCE), false);
  assert.match(SOURCE, /export type PhotoRendition = \{\s*bytes: ArrayBuffer;\s*contentType: string;\s*\};/);
});

test("the internal signing TTL is short -- this is transport plumbing, not a caller-facing access window", () => {
  assert.match(SOURCE, /INTERNAL_SIGNING_TTL_SECONDS\s*=\s*60\b/);
});
