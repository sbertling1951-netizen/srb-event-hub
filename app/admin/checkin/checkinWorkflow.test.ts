import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CheckinBrowseAttendee,
  checkinServerFingerprint,
  filterCheckinBrowseAttendees,
  reconcileCheckinEditState,
  selectedAttendeeChangedRemotely,
  sortCheckinBrowseAttendees,
} from "@/app/admin/checkin/checkinWorkflow";

function attendee(
  id: string,
  hasArrived: boolean,
  pilotLast: string,
): CheckinBrowseAttendee {
  return {
    id,
    pilot_first: "Pilot",
    pilot_last: pilotLast,
    copilot_first: null,
    copilot_last: null,
    email: `${id}@example.com`,
    assigned_site: null,
    has_arrived: hasArrived,
    arrival_status: hasArrived ? "arrived" : "not_arrived",
    coach_make: null,
    coach_model: null,
  };
}

test("default browse prioritizes and shows only not-yet-arrived attendees", () => {
  const attendees = [
    attendee("arrived", true, "Able"),
    attendee("waiting-b", false, "Baker"),
    attendee("waiting-a", false, "Able"),
  ];

  assert.deepEqual(
    filterCheckinBrowseAttendees(attendees, "", false).map((row) => row.id),
    ["waiting-a", "waiting-b"],
  );
  assert.deepEqual(
    sortCheckinBrowseAttendees(attendees).map((row) => row.id),
    ["waiting-a", "waiting-b", "arrived"],
  );
});

test("arrived attendees remain reachable by filter and search", () => {
  const attendees = [
    attendee("arrived", true, "Done"),
    attendee("waiting", false, "Waiting"),
  ];

  assert.deepEqual(
    filterCheckinBrowseAttendees(attendees, "", true).map((row) => row.id),
    ["waiting", "arrived"],
  );
  assert.deepEqual(
    filterCheckinBrowseAttendees(attendees, "arrived@example.com", false).map((row) => row.id),
    ["arrived"],
  );
});

test("unrelated server changes update while the selected dirty edit is preserved", () => {
  const current = {
    selected: { siteNumber: "LOCAL", sharedFields: ["email"] },
    other: { siteNumber: "OLD", sharedFields: [] },
  };
  const server = {
    selected: { siteNumber: "SERVER", sharedFields: [] },
    other: { siteNumber: "NEW", sharedFields: ["phone"] },
  };

  assert.deepEqual(
    reconcileCheckinEditState(server, current, "selected", true),
    {
      selected: current.selected,
      other: server.other,
    },
  );
});

test("remote change to the actively edited attendee is an explicit conflict", () => {
  assert.equal(selectedAttendeeChangedRemotely("before", "after", true), true);
  assert.equal(selectedAttendeeChangedRemotely("before", "after", false), false);
  assert.equal(selectedAttendeeChangedRemotely("same", "same", true), false);
});

test("server fingerprint covers arrival, placement, and governed sharing state", () => {
  const row = attendee("selected", false, "Selected");
  const initial = checkinServerFingerprint(row, ["phone", "email"]);

  assert.equal(initial, checkinServerFingerprint(row, ["email", "phone"]));
  assert.notEqual(
    initial,
    checkinServerFingerprint({ ...row, assigned_site: "A1" }, ["email", "phone"]),
  );
  assert.notEqual(
    initial,
    checkinServerFingerprint({ ...row, has_arrived: true }, ["email", "phone"]),
  );
  assert.notEqual(initial, checkinServerFingerprint(row, ["email"]));
});