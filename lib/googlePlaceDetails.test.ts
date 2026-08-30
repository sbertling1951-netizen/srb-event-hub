import assert from "node:assert/strict";
import { test } from "node:test";

import type { FetchLike } from "./googleNearby";
import { fetchGooglePlaceDetails } from "./googlePlaceDetails";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("maps a full Google Place Details result into editor fields", async () => {
  let capturedUrl = "";
  const fetchImpl: FetchLike = async (input) => {
    capturedUrl = input;
    return jsonResponse({
      status: "OK",
      result: {
        formatted_phone_number: "(251) 555-0100",
        website: "https://example.com",
        plus_code: { global_code: "86HJ8X2W+2X" },
        editorial_summary: { overview: "A local favorite." },
        formatted_address: "1 Main St, Gulf Shores, AL",
        geometry: { location: { lat: 30.3, lng: -87.7 } },
        types: ["restaurant", "food"],
      },
    });
  };

  const result = await fetchGooglePlaceDetails(fetchImpl, "k", "place-1");
  assert.ok(result.ok);
  assert.deepEqual(result.details, {
    phone: "(251) 555-0100",
    website: "https://example.com",
    plusCode: "86HJ8X2W+2X",
    editorialSummary: "A local favorite.",
    formattedAddress: "1 Main St, Gulf Shores, AL",
    lat: 30.3,
    lng: -87.7,
    types: ["restaurant", "food"],
  });
  assert.equal(new URL(capturedUrl).searchParams.get("place_id"), "place-1");
});

test("missing optional fields become null, not errors", async () => {
  const fetchImpl: FetchLike = async () =>
    jsonResponse({ status: "OK", result: { website: "https://x.test" } });

  const result = await fetchGooglePlaceDetails(fetchImpl, "k", "place-2");
  assert.ok(result.ok);
  assert.deepEqual(result.details, {
    phone: null,
    website: "https://x.test",
    plusCode: null,
    editorialSummary: null,
    formattedAddress: null,
    lat: null,
    lng: null,
    types: [],
  });
});

test("a provider failure is reported, never thrown", async () => {
  const denied: FetchLike = async () =>
    jsonResponse({ status: "REQUEST_DENIED" });
  assert.deepEqual(await fetchGooglePlaceDetails(denied, "k", "p"), {
    ok: false,
    status: "REQUEST_DENIED",
    httpStatus: 200,
  });

  const throws: FetchLike = async () => {
    throw new Error("network down");
  };
  assert.deepEqual(await fetchGooglePlaceDetails(throws, "k", "p"), {
    ok: false,
    status: "FETCH_FAILED",
    httpStatus: 0,
  });
});
