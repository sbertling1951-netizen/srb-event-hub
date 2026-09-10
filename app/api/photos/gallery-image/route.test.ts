import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// P0 Event-Photo Read-Surface Repair (traffic correction): structural proof
// for the gallery-image delivery route's controlled "grid"/"full" variants.
// Run with:
//   npx tsx --test app/api/photos/gallery-image/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("the route authenticates the caller through their own real session, never a service-role/admin client, before making any authorization decision", () => {
  assert.match(SOURCE, /resolveAuthenticatedRequest/);
  assert.match(SOURCE, /createAuthenticatedUserClient/);
  assert.equal(/getSupabaseAdminClient/.test(SOURCE), false);
  assert.equal(/service_role/i.test(SOURCE), false);
});

test("an unauthenticated caller is denied before any database read", () => {
  const authCheckIdx = SOURCE.indexOf('authResolution.state === "unauthenticated"');
  assert.notEqual(authCheckIdx, -1);
  const dbReadIdx = SOURCE.indexOf('.from("event_photos")');
  assert.notEqual(dbReadIdx, -1);
  assert.ok(authCheckIdx < dbReadIdx, "the unauthenticated check must precede the database read");
});

test("the only inputs accepted are photoId and variant -- never a storage path, event id, attendee id, width, height, or resize mode", () => {
  assert.match(SOURCE, /searchParams\.get\(\s*["']photoId["']\s*\)/);
  assert.match(SOURCE, /searchParams\.get\(\s*["']variant["']\s*\)/);
  assert.equal(
    /searchParams\.get\(\s*["'](storagePath|storage_path|eventId|attendeeId|width|height|resize)["']/.test(
      SOURCE,
    ),
    false,
  );
  // Exactly two searchParams.get(...) call sites exist in the whole route.
  const getCalls = [...SOURCE.matchAll(/searchParams\.get\(/g)];
  assert.equal(getCalls.length, 2);
});

test("the route restricts itself to approved photos and denies non-enumeratingly", () => {
  assert.match(SOURCE, /\.eq\(\s*["']photo_status["'],\s*["']approved["']\s*\)/);
  // Not-found, not-approved, and not-authorized must be indistinguishable.
  const deniedFnStart = SOURCE.indexOf("function deniedResponse");
  assert.notEqual(deniedFnStart, -1);
  const deniedFnBody = SOURCE.slice(
    deniedFnStart,
    SOURCE.indexOf("\n}", deniedFnStart) + 2,
  );
  assert.match(deniedFnBody, /status: 404/);
});

test("exactly two variants exist, mapped to the exact required caps -- grid 240px, full 1600px", () => {
  const mapStart = SOURCE.indexOf("const GALLERY_VARIANT_MAX_DIMENSION");
  assert.notEqual(mapStart, -1);
  const mapBody = SOURCE.slice(mapStart, SOURCE.indexOf("as const", mapStart));
  assert.match(mapBody, /grid:\s*240\b/);
  assert.match(mapBody, /full:\s*1600\b/);
  // No third variant, and no other numeric dimension literal anywhere in
  // the route (defense against a stray/duplicated cap).
  const dimensionKeys = [...mapBody.matchAll(/^\s*(\w+):\s*\d+/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(dimensionKeys.sort(), ["full", "grid"]);
  assert.equal(/\b240\b/g.test(SOURCE.replace(mapBody, "")), false);
  assert.equal(/\b1600\b/g.test(SOURCE.replace(mapBody, "")), false);
});

test("variant is validated by an explicit type guard against exactly the two literal values -- not a free-form string", () => {
  const guardStart = SOURCE.indexOf("function isGalleryVariant");
  assert.notEqual(guardStart, -1);
  const guardBody = SOURCE.slice(guardStart, SOURCE.indexOf("\n}", guardStart) + 2);
  assert.match(guardBody, /value === "grid"/);
  assert.match(guardBody, /value === "full"/);
  // No wildcard/regex-based acceptance of an arbitrary variant string.
  assert.equal(/GALLERY_VARIANT_MAX_DIMENSION\[.*variant.*\]/.test(guardBody), false);
});

test("a missing or unrecognized variant is rejected outright (400), never silently defaulted to a size", () => {
  const validationLineIdx = SOURCE.indexOf("isUuid(photoId) || !isGalleryVariant(variant)");
  assert.notEqual(validationLineIdx, -1);
  const nearby = SOURCE.slice(validationLineIdx, validationLineIdx + 160);
  assert.match(nearby, /status: 400/);
  // No default/fallback variant assignment anywhere (e.g. `variant || "full"`
  // or `variant ?? "grid"`) that could silently resolve an absent/unknown
  // value to either dimension.
  assert.equal(/variant\s*\|\|\s*["']\w+["']/.test(SOURCE), false);
  assert.equal(/variant\s*\?\?\s*["']\w+["']/.test(SOURCE), false);
});

test("the route delegates to the shared rendition helper using only the server-owned dimension map, keyed by the validated variant -- never a raw/caller-derived number", () => {
  assert.match(SOURCE, /fetchPhotoRendition\(\s*\n?\s*photo\.storage_path,\s*\n?\s*GALLERY_VARIANT_MAX_DIMENSION\[variant\],?\s*\n?\s*\)/);
  assert.equal(/signedUrl/i.test(SOURCE), false);
  assert.equal(/createSignedUrl/.test(SOURCE), false);
  // No parseInt/Number(...) coercion of any request parameter into a
  // dimension -- the only numbers driving fetchPhotoRendition come from the
  // fixed map above.
  assert.equal(/parseInt\(|Number\(\s*(url\.)?searchParams/.test(SOURCE), false);
});

test("the response is the image bytes directly, with a short private cache lifetime", () => {
  assert.match(SOURCE, /new Response\(rendition\.bytes/);
  assert.match(SOURCE, /Cache-Control["']?:\s*["']private, max-age=60["']/);
});
