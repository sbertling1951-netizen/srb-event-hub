import assert from "node:assert/strict";
import { test } from "node:test";

import { POST } from "./route";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/google/nearby-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function restoreEnvironment() {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.GOOGLE_MAPS_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
  }
}

test("returns mapped Places results after geocoding the complete Event location", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-server-key";
  const urls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("/geocode/json")) {
      return Response.json({
        status: "OK",
        results: [{ geometry: { location: { lat: 30.25, lng: -87.7 } } }],
      });
    }
    return Response.json({
      status: "OK",
      results: [{
        place_id: "place-1",
        name: "Example Restaurant",
        vicinity: "123 Example Road",
        rating: 4.5,
        types: ["restaurant"],
        geometry: { location: { lat: 30.31, lng: -87.75 } },
      }],
    });
  };

  try {
    const response = await POST(request({
      query: "restaurants",
      location: "Gulf Shores RV Resort, 18717 Barefoot Wy, Gulf Shores, AL 36542",
      radiusMiles: 20,
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      places: [{
        id: "place-1",
        name: "Example Restaurant",
        address: "123 Example Road",
        rating: 4.5,
        category: "restaurant",
        lat: 30.31,
        lng: -87.75,
      }],
      debug: {
        query: "restaurants",
        location: "Gulf Shores RV Resort, 18717 Barefoot Wy, Gulf Shores, AL 36542",
        radiusMiles: 20,
        lat: 30.25,
        lng: -87.7,
      },
    });
    assert.equal(urls.length, 2);
    assert.equal(
      urls[0].searchParams.get("address"),
      "Gulf Shores RV Resort, 18717 Barefoot Wy, Gulf Shores, AL 36542",
    );
    assert.equal(urls[1].searchParams.get("location"), "30.25,-87.7");
    assert.equal(urls[1].searchParams.get("radius"), "32180");
  } finally {
    restoreEnvironment();
  }
});

test("normalizes missing or non-numeric Google result coordinates to null", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-server-key";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    return url.pathname.endsWith("/geocode/json")
      ? Response.json({
          status: "OK",
          results: [{ geometry: { location: { lat: 30.25, lng: -87.7 } } }],
        })
      : Response.json({
          status: "OK",
          results: [
            { place_id: "missing", name: "Missing geometry" },
            {
              place_id: "invalid",
              name: "Invalid geometry",
              geometry: { location: { lat: "30.3", lng: -87.8 } },
            },
          ],
        });
  };

  try {
    const response = await POST(request({ query: "restaurants", location: "Gulf Shores, AL" }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).places, [
      {
        id: "missing",
        name: "Missing geometry",
        address: "",
        category: null,
        lat: null,
        lng: null,
      },
      {
        id: "invalid",
        name: "Invalid geometry",
        address: "",
        category: null,
        lat: null,
        lng: -87.8,
      },
    ]);
  } finally {
    restoreEnvironment();
  }
});

test("returns an ordinary empty result set for Google Nearby ZERO_RESULTS", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-server-key";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    return url.pathname.endsWith("/geocode/json")
      ? Response.json({
          status: "OK",
          results: [{ geometry: { location: { lat: 30.25, lng: -87.7 } } }],
        })
      : Response.json({ status: "ZERO_RESULTS", results: [] });
  };

  try {
    const response = await POST(request({ query: "restaurants", location: "Gulf Shores, AL" }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).places, []);
  } finally {
    restoreEnvironment();
  }
});

test("returns a sanitized upstream API failure instead of an empty result set", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-server-key";
  globalThis.fetch = async () => Response.json({
    status: "REQUEST_DENIED",
    error_message: "API keys with referer restrictions cannot be used with this API.",
  });

  try {
    const response = await POST(request({ query: "restaurants", location: "Gulf Shores, AL" }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "Google geocoding request was denied. Check the server Google Maps API configuration.",
      code: "google_geocoding_request_denied",
    });
  } finally {
    restoreEnvironment();
  }
});

test("returns a sanitized Google Places failure after successful geocoding", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "test-server-key";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    return url.pathname.endsWith("/geocode/json")
      ? Response.json({
          status: "OK",
          results: [{ geometry: { location: { lat: 30.25, lng: -87.7 } } }],
        })
      : Response.json({ status: "OVER_QUERY_LIMIT" }, { status: 429 });
  };

  try {
    const response = await POST(request({ query: "restaurants", location: "Gulf Shores, AL" }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "Google nearby search request failed (OVER_QUERY_LIMIT).",
      code: "google_nearby_search_over_query_limit",
    });
  } finally {
    restoreEnvironment();
  }
});

test("reports a missing server credential without attempting an upstream request", async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("must not be called");
  };

  try {
    const response = await POST(request({ query: "restaurants", location: "Gulf Shores, AL" }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Google nearby search is unavailable because its server credential is not configured.",
      code: "missing_google_maps_api_key",
    });
    assert.equal(called, false);
  } finally {
    restoreEnvironment();
  }
});
