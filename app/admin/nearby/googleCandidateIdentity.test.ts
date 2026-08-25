import assert from "node:assert/strict";
import { test } from "node:test";

import {
  googlePlaceIdsFromCandidates,
  pendingGooglePlaceCandidates,
} from "./googleCandidateIdentity";

test("only exact governed Google Place-ID matches leave the pending list", () => {
  const candidates = [
    { id: "google-exact", name: "Same Name", address: "1 Main Street" },
    { id: "google-different", name: "Same Name", address: "1 Main Street" },
    { id: null, name: "Legacy place", address: "1 Main Street" },
  ];

  assert.deepEqual(
    pendingGooglePlaceCandidates(candidates, new Set(["google-exact"])),
    [candidates[1], candidates[2]],
  );
});

test("candidates without an exact Google Place ID are never guessed to be duplicates", () => {
  const candidates = [
    { id: null },
    { id: "  google-place-id  " },
    { id: "google-place-id" },
  ];

  assert.deepEqual(googlePlaceIdsFromCandidates(candidates), ["google-place-id"]);
  assert.deepEqual(
    pendingGooglePlaceCandidates(candidates, new Set(["google-place-id"])),
    [candidates[0]],
  );
});
