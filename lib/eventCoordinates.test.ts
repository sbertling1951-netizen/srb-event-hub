import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore Node's strip-types test runner requires the source extension.
import { resolveEventCoordinates } from "./eventCoordinates.ts";

test("geocodes a location when no manual pair is supplied", async () => {
  assert.deepEqual(await resolveEventCoordinates({ location: "New location", lat: "", lng: "" }, async () => ({ lat: 1, lng: 2 })), { kind: "geocoded", lat: 1, lng: 2 });
});
test("manual coordinates take precedence", async () => {
  assert.deepEqual(await resolveEventCoordinates({ location: "New location", lat: "3", lng: "4" }, async () => ({ lat: 1, lng: 2 })), { kind: "manual", lat: 3, lng: 4 });
});
test("unresolved location blocks a misleading save", async () => {
  const result = await resolveEventCoordinates({ location: "Unknown", lat: "", lng: "" }, async () => ({ lat: null, lng: null }));
  assert.equal(result.kind, "unresolved");
});
test("missing location explicitly permits no coordinates", async () => {
  assert.deepEqual(await resolveEventCoordinates({ location: "", lat: "", lng: "" }, async () => ({ lat: 1, lng: 2 })), { kind: "no_location" });
});
