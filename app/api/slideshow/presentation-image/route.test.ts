import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// P0 Event-Photo Read-Surface Repair: structural proof for the anonymous
// slideshow image delivery route. Run with:
//   npx tsx --test app/api/slideshow/presentation-image/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("the only inputs accepted are a session id and a fixed slot label -- never a storage path, photo id, or Event id", () => {
  assert.match(SOURCE, /searchParams\.get\(\s*["']session["']\s*\)/);
  assert.match(SOURCE, /searchParams\.get\(\s*["']slot["']\s*\)/);
  assert.equal(
    /searchParams\.get\(\s*["'](storagePath|storage_path|photoId|eventId)["']/.test(SOURCE),
    false,
  );
  assert.match(SOURCE, /isPresentationSlot\(slot\)/);
});

test("every request re-resolves the live session/slot itself -- no caching of the resolved path across requests", () => {
  assert.match(SOURCE, /resolveLivePresentationSlotPath/);
  // The resolver is called once per GET invocation with the raw request
  // parameters, not read from a module-level/closure cache.
  const getFnBody = SOURCE.slice(SOURCE.indexOf("export async function GET"));
  assert.match(getFnBody, /resolveLivePresentationSlotPath\(sessionId, slot\)/);
});

test("the response is always a size-capped rendition, never the original, and never a reusable storage signed URL", () => {
  assert.match(SOURCE, /fetchPhotoRendition/);
  assert.match(SOURCE, /PRESENTATION_RENDITION_MAX_DIMENSION\s*=\s*2048/);
  assert.equal(/signedUrl/i.test(SOURCE), false);
  assert.equal(/createSignedUrl/.test(SOURCE), false);
  assert.match(SOURCE, /new Response\(rendition\.bytes/);
});

test("the response is never cached, so a captured URL cannot outlive the live slide it was fetched for", () => {
  assert.match(SOURCE, /Cache-Control["']?:\s*["']no-store["']/);
});

test("this route requires no caller authentication -- it is the one deliberately anonymous surface, gated entirely by live session/slot re-validation", () => {
  assert.equal(/resolveAuthenticatedRequest/.test(SOURCE), false);
  assert.equal(/createAuthenticatedUserClient/.test(SOURCE), false);
});
