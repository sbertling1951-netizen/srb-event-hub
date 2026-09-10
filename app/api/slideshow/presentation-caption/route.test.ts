import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// P0 Event-Photo Read-Surface Repair: structural proof for the anonymous
// slideshow caption delivery route. Run with:
//   npx tsx --test app/api/slideshow/presentation-caption/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("the only inputs accepted are a session id and a fixed slot label", () => {
  assert.match(SOURCE, /searchParams\.get\(\s*["']session["']\s*\)/);
  assert.match(SOURCE, /searchParams\.get\(\s*["']slot["']\s*\)/);
  assert.match(SOURCE, /isPresentationSlot\(slot\)/);
});

test("no raw storage path is ever read or returned by this route", () => {
  assert.equal(/storage_path/.test(SOURCE), false);
  assert.equal(/storagePath/.test(SOURCE), false);
});

test("this route needs no elevated credential -- the RPC it calls is itself anon-EXECUTE-granted and self-authorizing", () => {
  assert.equal(/getSupabaseAdminClient/.test(SOURCE), false);
  assert.equal(/service_role/i.test(SOURCE), false);
  assert.match(SOURCE, /read_live_presentation_slot_caption/);
});

test("this route performs no direct read of public.event_photos", () => {
  assert.equal(/\.from\(\s*["']event_photos["']\s*\)/.test(SOURCE), false);
});
