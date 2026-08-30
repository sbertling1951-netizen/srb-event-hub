import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allSearchCategoriesSelected,
  allSearchCategoryCodes,
  describeActiveSearch,
} from "@/lib/nearbySearchSetup";

const OPTIONS = [{ code: "restaurant" }, { code: "grocery" }, { code: "fuel" }];

test("allSearchCategoriesSelected is true only when every option is selected", () => {
  assert.equal(allSearchCategoriesSelected(OPTIONS, new Set(["restaurant", "grocery", "fuel"])), true);
  assert.equal(allSearchCategoriesSelected(OPTIONS, new Set(["restaurant", "grocery"])), false);
  assert.equal(allSearchCategoriesSelected(OPTIONS, new Set()), false);
  // an empty catalog is not "all selected"
  assert.equal(allSearchCategoriesSelected([], new Set()), false);
});

test("allSearchCategoryCodes returns every available code", () => {
  assert.deepEqual(allSearchCategoryCodes(OPTIONS), ["restaurant", "grocery", "fuel"]);
});

test("describeActiveSearch: types only", () => {
  assert.equal(
    describeActiveSearch({ selectedTypeCount: 6, radiusMiles: 10, freeText: "" }),
    "Searching 6 marker types within 10 miles",
  );
  assert.equal(
    describeActiveSearch({ selectedTypeCount: 1, radiusMiles: 1, freeText: "  " }),
    "Searching 1 marker type within 1 mile",
  );
});

test("describeActiveSearch: types plus free text", () => {
  assert.equal(
    describeActiveSearch({ selectedTypeCount: 2, radiusMiles: 8, freeText: " urgent care " }),
    "Searching 2 marker types plus “urgent care” within 8 miles",
  );
});

test("describeActiveSearch: free text only", () => {
  assert.equal(
    describeActiveSearch({ selectedTypeCount: 0, radiusMiles: 10, freeText: "kayak rental" }),
    "Searching for “kayak rental” within 10 miles",
  );
});

test("describeActiveSearch: nothing selected", () => {
  assert.equal(
    describeActiveSearch({ selectedTypeCount: 0, radiusMiles: 10, freeText: "" }),
    "No place types selected — choose at least one, or enter a search term",
  );
});

test("describeActiveSearch: invalid radius falls back to 10", () => {
  assert.equal(
    describeActiveSearch({ selectedTypeCount: 1, radiusMiles: 0, freeText: "" }),
    "Searching 1 marker type within 10 miles",
  );
  assert.equal(
    describeActiveSearch({ selectedTypeCount: 1, radiusMiles: Number.NaN, freeText: "" }),
    "Searching 1 marker type within 10 miles",
  );
});
