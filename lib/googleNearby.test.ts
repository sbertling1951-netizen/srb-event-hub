import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGoogleNearbyProviderRequests,
  type FetchLike,
  geocodeEventLocationViaGoogle,
  normalizeRadiusMiles,
  radiusMilesToMeters,
  runGoogleNearbyFanOut,
} from "./googleNearby";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("normalizeRadiusMiles defaults, floors, and caps", () => {
  assert.equal(normalizeRadiusMiles(undefined), 10);
  assert.equal(normalizeRadiusMiles(0), 10);
  assert.equal(normalizeRadiusMiles(-4), 10);
  assert.equal(normalizeRadiusMiles("not a number"), 10);
  assert.equal(normalizeRadiusMiles(0.1), 0.25);
  assert.equal(normalizeRadiusMiles(500), 31);
  assert.equal(normalizeRadiusMiles(12.5), 12.5);
  assert.equal(normalizeRadiusMiles("20"), 20);
});

test("radiusMilesToMeters converts using the normalized value", () => {
  assert.equal(radiusMilesToMeters(20), 20 * 1609);
  assert.equal(radiusMilesToMeters(9999), 31 * 1609);
});

test("geocodeEventLocationViaGoogle returns coordinates on OK and a status on failure", async () => {
  const ok: FetchLike = async () =>
    jsonResponse({
      status: "OK",
      results: [{ geometry: { location: { lat: 30.25, lng: -87.7 } } }],
    });
  assert.deepEqual(await geocodeEventLocationViaGoogle(ok, "k", "Gulf Shores"), {
    ok: true,
    lat: 30.25,
    lng: -87.7,
  });

  const denied: FetchLike = async () =>
    jsonResponse({ status: "REQUEST_DENIED" });
  assert.deepEqual(
    await geocodeEventLocationViaGoogle(denied, "k", "Gulf Shores"),
    { ok: false, status: "REQUEST_DENIED", httpStatus: 200 },
  );

  const noCoords: FetchLike = async () =>
    jsonResponse({ status: "OK", results: [{}] });
  assert.deepEqual(
    await geocodeEventLocationViaGoogle(noCoords, "k", "Gulf Shores"),
    { ok: false, status: "MISSING_COORDINATES", httpStatus: 422 },
  );
});

test("fan-out issues one request per provider request and merges exact place_id duplicates", async () => {
  const requests = buildGoogleNearbyProviderRequests(
    [
      { code: "restaurant", label: "Restaurant" },
      { code: "fuel", label: "Fuel" },
    ],
    null,
  );

  const seenUrls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    seenUrls.push(input);
    const url = new URL(input);
    if (url.searchParams.get("type") === "restaurant") {
      return jsonResponse({
        status: "OK",
        results: [
          {
            place_id: "shared",
            name: "Corner Cafe",
            vicinity: "1 Main St",
            rating: 4.4,
            types: ["restaurant", "food"],
            geometry: { location: { lat: 30.3, lng: -87.7 } },
          },
        ],
      });
    }
    return jsonResponse({
      status: "OK",
      results: [
        {
          place_id: "shared",
          name: "Corner Cafe",
          vicinity: "1 Main St",
          types: ["gas_station"],
          geometry: { location: { lat: 30.3, lng: -87.7 } },
        },
        {
          place_id: "fuel-only",
          name: "Gas N Go",
          types: ["gas_station"],
          geometry: { location: { lat: 30.31, lng: -87.71 } },
        },
      ],
    });
  };

  const result = await runGoogleNearbyFanOut({
    fetchImpl,
    apiKey: "k",
    lat: 30.3,
    lng: -87.7,
    radiusMiles: 10,
    requests,
  });

  assert.equal(seenUrls.length, 2);
  assert.equal(result.hadAnySuccess, true);
  assert.equal(result.candidates.length, 2);

  const shared = result.candidates.find((c) => c.id === "shared");
  assert.ok(shared);
  // producing-category provenance merged without duplication
  assert.deepEqual([...shared.producingCategoryCodes].sort(), [
    "fuel",
    "restaurant",
  ]);
  assert.deepEqual([...shared.googleTypes].sort(), [
    "food",
    "gas_station",
    "restaurant",
  ]);
  // first non-null data retained
  assert.equal(shared.rating, 4.4);
  assert.equal(shared.category, "restaurant");
});

test("fan-out never merges or fabricates ids for results Google returns without a place_id", async () => {
  const requests = buildGoogleNearbyProviderRequests(
    [{ code: "propane", label: "Propane" }],
    null,
  );
  const fetchImpl: FetchLike = async () =>
    jsonResponse({
      status: "OK",
      results: [
        { name: "No ID One", types: [] },
        { name: "No ID Two", types: [] },
      ],
    });

  const result = await runGoogleNearbyFanOut({
    fetchImpl,
    apiKey: "k",
    lat: 1,
    lng: 2,
    radiusMiles: 5,
    requests,
  });

  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((c) => c.id),
    [null, null],
  );
});

test("fan-out reports per-request failures but stays successful when at least one request works", async () => {
  const requests = buildGoogleNearbyProviderRequests(
    [
      { code: "restaurant", label: "Restaurant" },
      { code: "fuel", label: "Fuel" },
    ],
    null,
  );
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input);
    if (url.searchParams.get("type") === "restaurant") {
      return jsonResponse({ status: "OVER_QUERY_LIMIT" }, 429);
    }
    return jsonResponse({ status: "ZERO_RESULTS", results: [] });
  };

  const result = await runGoogleNearbyFanOut({
    fetchImpl,
    apiKey: "k",
    lat: 1,
    lng: 2,
    radiusMiles: 5,
    requests,
  });

  assert.equal(result.hadAnySuccess, true);
  assert.equal(result.candidates.length, 0);
  const failed = result.perRequest.find((r) => r.categoryCode === "restaurant");
  assert.equal(failed?.status, "OVER_QUERY_LIMIT");
});

test("fan-out is not successful when every request fails", async () => {
  const requests = buildGoogleNearbyProviderRequests(
    [{ code: "restaurant", label: "Restaurant" }],
    null,
  );
  const fetchImpl: FetchLike = async () =>
    jsonResponse({ status: "REQUEST_DENIED" });

  const result = await runGoogleNearbyFanOut({
    fetchImpl,
    apiKey: "k",
    lat: 1,
    lng: 2,
    radiusMiles: 5,
    requests,
  });

  assert.equal(result.hadAnySuccess, false);
  assert.equal(result.perRequest[0].status, "REQUEST_DENIED");
});

test("fan-out sends the free-text request as a keyword with no type", async () => {
  const requests = buildGoogleNearbyProviderRequests([], "kayak rental");
  let capturedUrl = "";
  const fetchImpl: FetchLike = async (input) => {
    capturedUrl = input;
    return jsonResponse({ status: "ZERO_RESULTS", results: [] });
  };

  await runGoogleNearbyFanOut({
    fetchImpl,
    apiKey: "k",
    lat: 1,
    lng: 2,
    radiusMiles: 5,
    requests,
  });

  const url = new URL(capturedUrl);
  assert.equal(url.searchParams.get("keyword"), "kayak rental");
  assert.equal(url.searchParams.get("type"), null);
});
