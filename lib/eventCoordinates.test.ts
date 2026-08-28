import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore Node's strip-types test runner requires the source extension.
import { eventSaveShouldResolveCoordinates, planCoordinatePersistence, resolveEventCoordinates } from "./eventCoordinates.ts";

test("geocodes a location when no manual pair is supplied", async () => {
  assert.deepEqual(await resolveEventCoordinates({ location: "New location", lat: "", lng: "" }, async () => ({ lat: 1, lng: 2 })), { kind: "geocoded", lat: 1, lng: 2 });
});
test("manual coordinates take precedence (bypass the geocoder)", async () => {
  let geocoderCalled = false;
  const result = await resolveEventCoordinates(
    { location: "New location", lat: "3", lng: "4" },
    async () => {
      geocoderCalled = true;
      return { lat: 1, lng: 2 };
    },
  );
  assert.deepEqual(result, { kind: "manual", lat: 3, lng: 4 });
  assert.equal(geocoderCalled, false);
});
test("unresolved location is reported as a resolution kind, not a thrown error", async () => {
  const result = await resolveEventCoordinates({ location: "Unknown", lat: "", lng: "" }, async () => ({ lat: null, lng: null }));
  assert.equal(result.kind, "unresolved");
});
test("missing location explicitly permits no coordinates", async () => {
  assert.deepEqual(await resolveEventCoordinates({ location: "", lat: "", lng: "" }, async () => ({ lat: 1, lng: 2 })), { kind: "no_location" });
});
test("a partial manual pair still fails visibly", async () => {
  await assert.rejects(
    () => resolveEventCoordinates({ location: "X", lat: "30", lng: "" }, async () => ({ lat: 1, lng: 2 })),
    /Latitude and longitude must be entered together/,
  );
  await assert.rejects(
    () => resolveEventCoordinates({ location: "X", lat: "", lng: "-87" }, async () => ({ lat: 1, lng: 2 })),
    /Latitude and longitude must be entered together/,
  );
});
test("an out-of-range manual pair still fails visibly", async () => {
  await assert.rejects(
    () => resolveEventCoordinates({ location: "X", lat: "200", lng: "-87" }, async () => ({ lat: 1, lng: 2 })),
    /Latitude must be between -90 and 90/,
  );
  await assert.rejects(
    () => resolveEventCoordinates({ location: "X", lat: "30", lng: "-999" }, async () => ({ lat: 1, lng: 2 })),
    /Longitude must be between -180 and 180/,
  );
});
test("a non-numeric manual value still fails visibly", async () => {
  await assert.rejects(
    () => resolveEventCoordinates({ location: "X", lat: "abc", lng: "-87" }, async () => ({ lat: 1, lng: 2 })),
    /Latitude must be a number/,
  );
});

// -- eventSaveShouldResolveCoordinates ---------------------------------------

test("a brand-new Event always resolves coordinates", () => {
  assert.equal(
    eventSaveShouldResolveCoordinates({ mode: "create", hasManualCoordinateInput: false, locationChanged: false }),
    true,
  );
});
test("an edit that touched neither coordinates nor location does NOT re-geocode", () => {
  assert.equal(
    eventSaveShouldResolveCoordinates({ mode: "edit", hasManualCoordinateInput: false, locationChanged: false }),
    false,
  );
});
test("an edit that entered a manual pair resolves (to validate it)", () => {
  assert.equal(
    eventSaveShouldResolveCoordinates({ mode: "edit", hasManualCoordinateInput: true, locationChanged: false }),
    true,
  );
});
test("an edit that changed the location text resolves (to geocode it)", () => {
  assert.equal(
    eventSaveShouldResolveCoordinates({ mode: "edit", hasManualCoordinateInput: false, locationChanged: true }),
    true,
  );
});

// -- planCoordinatePersistence ---------------------------------------------

test("a manual pair is written", () => {
  assert.deepEqual(
    planCoordinatePersistence({ kind: "manual", lat: 30.309, lng: -87.7072 }, "edit"),
    { kind: "write", lat: 30.309, lng: -87.7072, notice: null },
  );
});
test("a geocoded pair is written", () => {
  assert.deepEqual(
    planCoordinatePersistence({ kind: "geocoded", lat: 1, lng: 2 }, "create"),
    { kind: "write", lat: 1, lng: 2, notice: null },
  );
});
test("an unresolved geocode on EDIT preserves the stored pair and warns non-blockingly", () => {
  const plan = planCoordinatePersistence({ kind: "unresolved", message: "x" }, "edit");
  assert.equal(plan.kind, "preserve");
  assert.match(plan.notice ?? "", /could not be resolved/i);
  assert.match(plan.notice ?? "", /manually/i);
});
test("an unresolved geocode on CREATE still creates the Event (NULL coordinates) with a notice", () => {
  const plan = planCoordinatePersistence({ kind: "unresolved", message: "x" }, "create");
  assert.equal(plan.kind, "preserve");
  assert.match(plan.notice ?? "", /created/i);
});
test("no location on EDIT preserves the stored pair (never nulls a valid pair)", () => {
  assert.deepEqual(
    planCoordinatePersistence({ kind: "no_location" }, "edit"),
    { kind: "preserve", notice: null },
  );
});
test("no location on CREATE writes NULL coordinates (nothing to preserve)", () => {
  assert.deepEqual(
    planCoordinatePersistence({ kind: "no_location" }, "create"),
    { kind: "clear", notice: null },
  );
});
