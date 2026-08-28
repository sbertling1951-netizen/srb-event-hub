import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-ignore Node's strip-types test runner requires the source extension.
import { isCurrentNearbyEventRequest, resolveStoredAreaSelection } from "./nearbyAdminState.ts";

const areas = [
  { id: "gulf", name: "Gulf Shores" },
  { id: "other", name: "Other City" },
];

test("an older Event A request cannot overwrite Event B after context changes", () => {
  let currentEventId = "event-a";
  let renderedRows: string[] = [];

  // Event A starts first, then the authoritative Admin context changes.
  currentEventId = "event-b";

  // Event B resolves and paints normally.
  if (isCurrentNearbyEventRequest("event-b", currentEventId)) {
    renderedRows = ["event-b-place"];
  }

  // Event A resolves afterwards, but its response is stale.
  if (isCurrentNearbyEventRequest("event-a", currentEventId)) {
    renderedRows = ["event-a-place"];
  }

  assert.deepEqual(renderedRows, ["event-b-place"]);
});

test("a current Event request still paints its own rows", () => {
  let renderedRows: string[] = [];

  if (isCurrentNearbyEventRequest("event-a", "event-a")) {
    renderedRows = ["event-a-place"];
  }

  assert.deepEqual(renderedRows, ["event-a-place"]);
});

test("Stored Area selection retains a valid current operator selection", () => {
  assert.equal(
    resolveStoredAreaSelection(areas, "other", "gulf", {
      name: "Gulf Shores27",
      location: "Venue, Gulf Shores, AL",
    }),
    "other",
  );
});

test("Stored Area selection restores a valid persisted choice before heuristics", () => {
  assert.equal(
    resolveStoredAreaSelection(areas, "missing", "other", {
      name: "Gulf Shores27",
      location: "Venue, Gulf Shores, AL",
    }),
    "other",
  );
});

test("Stored Area heuristics run only without a valid explicit selection", () => {
  assert.equal(
    resolveStoredAreaSelection(areas, "missing", null, {
      name: "Gulf Shores27",
      location: "Venue, Gulf Shores, AL",
    }),
    "gulf",
  );
});

test("invalid selections fall back safely to the existing first-area behavior", () => {
  assert.equal(resolveStoredAreaSelection(areas, "missing", "gone", null), "gulf");
  assert.equal(resolveStoredAreaSelection([], "missing", "gone", null), "");
});
