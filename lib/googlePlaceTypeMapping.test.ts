import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGoogleNearbyProviderRequests,
  resolveGooglePlaceTypeMapping,
} from "./googlePlaceTypeMapping";

test("seeded categories with a clean Google type map exactly", () => {
  assert.deepEqual(resolveGooglePlaceTypeMapping({ code: "restaurant" }), {
    googleType: "restaurant",
    keyword: null,
    exact: true,
  });
  assert.deepEqual(resolveGooglePlaceTypeMapping({ code: "fuel" }), {
    googleType: "gas_station",
    keyword: null,
    exact: true,
  });
  assert.deepEqual(resolveGooglePlaceTypeMapping({ code: "grocery" }), {
    googleType: "supermarket",
    keyword: "grocery",
    exact: true,
  });
});

test("categories with no clean Google type fall back to keyword and are not marked exact", () => {
  const rvRepair = resolveGooglePlaceTypeMapping({ code: "rv_repair" });
  assert.equal(rvRepair.googleType, null);
  assert.equal(rvRepair.exact, false);
  assert.match(rvRepair.keyword ?? "", /RV/i);

  const propane = resolveGooglePlaceTypeMapping({ code: "propane" });
  assert.equal(propane.googleType, null);
  assert.equal(propane.exact, false);

  // shopping has an approximate type, still not exact
  const shopping = resolveGooglePlaceTypeMapping({ code: "shopping" });
  assert.equal(shopping.googleType, "shopping_mall");
  assert.equal(shopping.exact, false);
});

test("an unknown category code falls back to a keyword built from its label", () => {
  assert.deepEqual(
    resolveGooglePlaceTypeMapping({ code: "dog_park", label: "Dog Park" }),
    { googleType: null, keyword: "Dog Park", exact: false },
  );
  // no label -> de-underscored code
  assert.deepEqual(
    resolveGooglePlaceTypeMapping({ code: "urgent_care" }),
    { googleType: null, keyword: "urgent care", exact: false },
  );
});

test("buildGoogleNearbyProviderRequests de-duplicates codes and appends one free-text request", () => {
  const requests = buildGoogleNearbyProviderRequests(
    [
      { code: "restaurant", label: "Restaurant" },
      { code: "restaurant", label: "Restaurant" },
      { code: "fuel", label: "Fuel" },
      { code: "", label: "" },
    ],
    "  taco truck  ",
  );

  assert.deepEqual(
    requests.map((r) => r.categoryCode),
    ["restaurant", "fuel", ""],
  );
  const free = requests.at(-1);
  assert.equal(free?.keyword, "taco truck");
  assert.equal(free?.googleType, null);
  assert.equal(free?.exact, false);
});

test("buildGoogleNearbyProviderRequests drops categories with neither a type nor a keyword and omits an empty free-text", () => {
  const requests = buildGoogleNearbyProviderRequests(
    [{ code: "restaurant", label: "Restaurant" }],
    "   ",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].categoryCode, "restaurant");
});
