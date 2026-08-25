import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./nearby/page.tsx", import.meta.url)),
  "utf8",
);

test("Google Nearby search sends the complete Event location to the server instead of splitting a venue address into city/state fragments", () => {
  const start = SOURCE.indexOf("async function searchGoogleNearby()");
  const end = SOURCE.indexOf("\n  async function bulkGeocodeStoredPlaces()", start);
  assert.ok(start >= 0 && end > start, "expected searchGoogleNearby function");
  const search = SOURCE.slice(start, end);

  assert.match(search, /const location = adminEvent\.location\.trim\(\);/);
  assert.match(search, /location,\n\s*radiusMiles:/);
  assert.doesNotMatch(search, /locationParts|city|state/);
});
