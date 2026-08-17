import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCanonicalParkingSnapshot,
  mayApplyParkingLoad,
  selectionChangedRemotely,
} from "./parkingReconciliation";

const eventId = "event-a";
const masterSites = [
  { id: "site-10", site_number: "10", display_label: "Site 10", map_x: 1, map_y: 2 },
  { id: "site-20", site_number: "20", display_label: "Site 20", map_x: 3, map_y: 4 },
];
const attendees = [
  { id: "attendee-x", assigned_site: null },
  { id: "attendee-y", assigned_site: null },
];

test("attendee projection cannot manufacture canonical occupancy", () => {
  const result = buildCanonicalParkingSnapshot({
    eventId,
    masterSites,
    assignments: [],
    attendees: [{ id: "attendee-x", assigned_site: "Site 10" }],
  });
  assert.deepEqual(result, {
    ok: false,
    error: "Attendee site projection has no matching canonical parking placement.",
  });
});

test("canonical occupant wins and a conflicting attendee projection fails visibly", () => {
  const result = buildCanonicalParkingSnapshot({
    eventId,
    masterSites,
    assignments: [{ id: "parking-10", event_id: eventId, master_site_id: "site-10", assigned_attendee_id: "attendee-x" }],
    attendees: [{ id: "attendee-x", assigned_site: "Site 20" }],
  });
  assert.deepEqual(result, {
    ok: false,
    error: "Attendee site projection disagrees with canonical parking placement.",
  });
});

test("canonical vacant and occupied sites remain canonical, and a displaced attendee is unassigned", () => {
  const result = buildCanonicalParkingSnapshot({
    eventId,
    masterSites,
    assignments: [{ id: "parking-10", event_id: eventId, master_site_id: "site-10", assigned_attendee_id: "attendee-x" }],
    attendees,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sites[0].assigned_attendee_id, "attendee-x");
    assert.equal(result.sites[1].assigned_attendee_id, null);
    assert.equal(result.siteLabelByAttendeeId.get("attendee-x"), "Site 10");
    assert.equal(result.siteLabelByAttendeeId.has("attendee-y"), false);
  }
});

test("unrelated realtime changes preserve selection while selected attendee or site changes become stale", () => {
  const selected = { eventId, attendeeId: "attendee-x", attendeeSite: "Site 10", siteId: "parking-10", siteOccupantId: "attendee-x" };
  assert.equal(selectionChangedRemotely(selected, { ...selected }), false);
  assert.equal(selectionChangedRemotely(selected, { ...selected, attendeeSite: "Site 20" }), true);
  assert.equal(selectionChangedRemotely(selected, { ...selected, siteOccupantId: "attendee-y" }), true);
});

test("older loads and old event responses are rejected", () => {
  assert.equal(mayApplyParkingLoad({ requestGeneration: 1, latestGeneration: 2, requestedEventId: "event-a", currentEventId: "event-a" }), false);
  assert.equal(mayApplyParkingLoad({ requestGeneration: 2, latestGeneration: 2, requestedEventId: "event-a", currentEventId: "event-b" }), false);
  assert.equal(mayApplyParkingLoad({ requestGeneration: 2, latestGeneration: 2, requestedEventId: "event-b", currentEventId: "event-b" }), true);
});
