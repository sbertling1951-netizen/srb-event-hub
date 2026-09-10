import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// P0 Event-Photo Read-Surface Repair: structural proof for the
// server-only presentation slot resolver. Run with:
//   npx tsx --test lib/server/presentationAssetResolver.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./presentationAssetResolver.ts", import.meta.url)),
  "utf8",
);

test("isPresentationSlot accepts only the two literal slot values", () => {
  const fnStart = SOURCE.indexOf("export function isPresentationSlot");
  assert.notEqual(fnStart, -1);
  const fnBody = SOURCE.slice(fnStart, SOURCE.indexOf("}", fnStart) + 1);
  assert.match(fnBody, /value === "current"/);
  assert.match(fnBody, /value === "next"/);
});

test("this module is server-only and calls the service_role-only-granted database function by name", () => {
  assert.match(SOURCE, /^import "server-only";/m);
  assert.match(SOURCE, /_resolve_live_presentation_slot_path/);
});

test("the resolver exposes no path on a denied/ineligible lookup -- null, not a partial result", () => {
  const fnStart = SOURCE.indexOf("export async function resolveLivePresentationSlotPath");
  assert.notEqual(fnStart, -1);
  const fnBody = SOURCE.slice(fnStart);
  assert.match(fnBody, /if \(error \|\| !row\?\.storage_path \|\| !row\?\.content_ref_id\) \{\s*return null;/);
});
