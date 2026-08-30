import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Nearby Google discovery request contract, as it has stood since
// db3c009 ("Nearby curated-list builder"): the browser identifies the
// Event by id and the governed /api/google/nearby-search route resolves
// the Event's coordinates / location text server-side. The client never
// builds, trims, or forwards the Event location string for Google
// discovery, and never splits a venue address into city/state fragments.
//
// (This file previously asserted the pre-db3c009 shape -- a client-side
// `const location = adminEvent.location.trim();` forwarded in the request
// body. That contract no longer exists; the assertions below track the
// current one.)

const PAGE = readFileSync(
  fileURLToPath(new URL("./nearby/page.tsx", import.meta.url)),
  "utf8",
);
const ROUTE = readFileSync(
  fileURLToPath(new URL("../api/google/nearby-search/route.ts", import.meta.url)),
  "utf8",
);

function searchGoogleNearbyBody() {
  const start = PAGE.indexOf("async function searchGoogleNearby()");
  const end = PAGE.indexOf("\n  function toggleSearchCategory(", start);
  assert.ok(start >= 0 && end > start, "expected searchGoogleNearby function");
  return PAGE.slice(start, end);
}

test("the browser sends eventId to the governed Nearby search route and never constructs the Event location itself", () => {
  const search = searchGoogleNearbyBody();

  // The request body identifies the Event; it does not describe it.
  assert.match(
    search,
    /body: JSON\.stringify\(\{\s*\n\s*eventId: adminEvent\.id,\s*\n\s*categoryCodes,\s*\n\s*radiusMiles: Number\(googleRadius\) \|\| 10,\s*\n\s*freeText: freeText \|\| undefined,/,
  );

  // The client no longer trims / splits / forwards the Event location text
  // for Google discovery -- that is resolved server-side from eventId.
  assert.doesNotMatch(search, /adminEvent\.location/);
  assert.doesNotMatch(search, /const location =/);
  assert.doesNotMatch(search, /locationParts/);
  // no `location` key in the request body
  assert.doesNotMatch(
    search,
    /body: JSON\.stringify\(\{[\s\S]*?\blocation\b[\s\S]*?\}\),/,
  );
});

test("selected marker/category codes are sent and stay the driver of the Google fan-out", () => {
  const search = searchGoogleNearbyBody();

  assert.match(search, /const categoryCodes = \[\.\.\.selectedSearchCategoryCodes\];/);
  assert.match(search, /const freeText = googleQuery\.trim\(\);/);
  // categoryCodes is what goes on the wire -- one Google request per code
  // is the server's job (see nearby-search/route.test.ts).
  assert.match(search, /eventId: adminEvent\.id,\s*\n\s*categoryCodes,/);
  // a search with neither a selected type nor free text is refused before
  // any request is made
  assert.match(
    search,
    /if \(categoryCodes\.length === 0 && !freeText\) \{\s*\n\s*showError\(/,
  );
  // radius uses the same Number(googleRadius) || 10 default as the rest of
  // the page
  assert.match(search, /radiusMiles: Number\(googleRadius\) \|\| 10/);
});

test("the server route resolves the Event / location context from eventId, not from a client-supplied address", () => {
  // eventId is required by the route
  assert.match(
    ROUTE,
    /const eventId = typeof body\.eventId === "string" \? body\.eventId\.trim\(\) : "";/,
  );
  assert.match(ROUTE, /An eventId is required for a Nearby search\./);

  // the Event row -- stored coordinates AND location text -- is read
  // server-side, keyed by that id
  assert.match(ROUTE, /\.from\("events"\)[\s\S]*?\.eq\("id", eventId\)/);
  assert.match(ROUTE, /\.select\("id,location,lat,lng"\)/);

  // stored coordinates are preferred; the location TEXT is only geocoded
  // when they are genuinely missing
  assert.match(ROUTE, /typeof event\.lat === "number" \? event\.lat : null/);
  assert.match(ROUTE, /geocodeEventLocationViaGoogle\(/);

  // the route never splits an address into city / state fragments
  assert.doesNotMatch(ROUTE, /locationParts|splitAddress/);
});
