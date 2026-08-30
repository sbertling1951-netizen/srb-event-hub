import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { POST } from "./route";

// The Google fan-out, merge, radius, and geocode behavior is proven
// directly in lib/googleNearby.test.ts and lib/googlePlaceTypeMapping.test.ts
// against an injected fetch. This file proves the route's own
// responsibility: the Event-scoped server authority gate runs, and runs
// BEFORE any Google credential or provider request -- and the request
// contract. (No admin-session mock harness exists in this repo; the
// gate's ordering is asserted from source, its fail-closed behavior
// behaviorally.)

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const originalFetch = globalThis.fetch;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/google/nearby-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("an unauthenticated caller is rejected before any Google work", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("must not be called");
  }) as typeof fetch;

  try {
    const response = await POST(
      request({
        eventId: "evt-1",
        categoryCodes: ["restaurant"],
        radiusMiles: 10,
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the route resolves the admin actor, the nearby permission, then Event authority -- in that order, before reading the API key", () => {
  const resolveIdx = CODE_ONLY.indexOf("resolveAdminActorFromBearer(");
  const permissionIdx = CODE_ONLY.indexOf(
    'adminHasPermission(adminResolved.admin, "can_manage_nearby")',
  );
  const eventAuthorityIdx = CODE_ONLY.indexOf(
    "adminCanManageEvent(adminResolved.admin, eventId)",
  );
  const apiKeyIdx = CODE_ONLY.indexOf("process.env.GOOGLE_MAPS_API_KEY");
  const fanOutIdx = CODE_ONLY.indexOf("runGoogleNearbyFanOut(");

  assert.ok(resolveIdx >= 0 && permissionIdx >= 0 && eventAuthorityIdx >= 0);
  assert.ok(resolveIdx < permissionIdx, "permission check after actor resolution");
  assert.ok(permissionIdx < eventAuthorityIdx, "event authority after permission");
  assert.ok(eventAuthorityIdx < apiKeyIdx, "API key read only after authority passes");
  assert.ok(apiKeyIdx < fanOutIdx, "fan-out only after the key is confirmed");
});

test("the request contract is { eventId, categoryCodes, radiusMiles, freeText }", () => {
  assert.match(CODE_ONLY, /body\.eventId/);
  assert.match(CODE_ONLY, /body\.categoryCodes/);
  assert.match(CODE_ONLY, /body\.radiusMiles/);
  assert.match(CODE_ONLY, /body\.freeText/);
  assert.doesNotMatch(
    CODE_ONLY,
    /body\.(authUserId|adminUserId|isSuperAdmin|permissions)/,
  );
});

test("Event coordinates are preferred; the location text is only geocoded when they are missing", () => {
  assert.match(CODE_ONLY, /\.select\("id,location,lat,lng"\)/);
  assert.match(
    CODE_ONLY,
    /if \(lat === null \|\| lng === null\) \{[\s\S]*?geocodeEventLocationViaGoogle\(/,
  );
});

test("the selectable catalog is place_categories, resolved by the requested codes -- never hard-coded here", () => {
  assert.match(
    CODE_ONLY,
    /\.from\("place_categories"\)[\s\S]*?\.eq\("is_active", true\)[\s\S]*?\.in\("code", categoryCodes\)/,
  );
  assert.match(CODE_ONLY, /buildGoogleNearbyProviderRequests\(/);
});

test("an empty request (no categories, no free text) has a dedicated 400 branch", () => {
  assert.match(
    CODE_ONLY,
    /if \(categoryCodes\.length === 0 && !freeText\) \{[\s\S]*?status: 400/,
  );
});
