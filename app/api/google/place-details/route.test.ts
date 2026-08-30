import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { POST } from "./route";

// Field-mapping and provider-failure behavior is proven in
// lib/googlePlaceDetails.test.ts. This file proves the route's authority
// gate and its non-fatal failure contract.

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const originalFetch = globalThis.fetch;

function request(body: unknown) {
  return new Request("http://localhost/api/google/place-details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      request({ eventId: "evt-1", googlePlaceId: "place-1" }),
    );
    assert.equal(response.status, 401);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the same Event-scoped authority gate is used, in the same order, before the API key", () => {
  const resolveIdx = CODE_ONLY.indexOf("resolveAdminActorFromBearer(");
  const permissionIdx = CODE_ONLY.indexOf(
    'adminHasPermission(adminResolved.admin, "can_manage_nearby")',
  );
  const eventAuthorityIdx = CODE_ONLY.indexOf(
    "adminCanManageEvent(adminResolved.admin, eventId)",
  );
  const apiKeyIdx = CODE_ONLY.indexOf("process.env.GOOGLE_MAPS_API_KEY");
  const fetchDetailsIdx = CODE_ONLY.indexOf("fetchGooglePlaceDetails(");

  assert.ok(resolveIdx >= 0 && permissionIdx >= 0 && eventAuthorityIdx >= 0);
  assert.ok(resolveIdx < permissionIdx);
  assert.ok(permissionIdx < eventAuthorityIdx);
  assert.ok(eventAuthorityIdx < apiKeyIdx);
  assert.ok(apiKeyIdx < fetchDetailsIdx);
});

test("eventId and googlePlaceId are both required", () => {
  assert.match(CODE_ONLY, /if \(!eventId\) \{[\s\S]*?status: 400/);
  assert.match(CODE_ONLY, /if \(!googlePlaceId\) \{[\s\S]*?status: 400/);
});

test("a provider failure is returned as HTTP 200 with ok:false so the Working List entry survives", () => {
  assert.match(
    CODE_ONLY,
    /if \(!result\.ok\) \{\s*return NextResponse\.json\(\{\s*ok: false/,
  );
  assert.doesNotMatch(
    CODE_ONLY,
    /if \(!result\.ok\)[\s\S]*?status: 50\d/,
  );
});
