import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CheckinBrowseAttendee,
  checkinServerFingerprint,
  filterCheckinBrowseAttendees,
  isCheckinEligible,
  reconcileCheckinEditState,
  selectedAttendeeChangedRemotely,
  selectEligibleCheckinAttendees,
  sortCheckinBrowseAttendees,
} from "@/app/admin/checkin/checkinWorkflow";

function attendee(
  id: string,
  hasArrived: boolean,
  pilotLast: string,
  eligibility: Partial<
    Pick<CheckinBrowseAttendee, "is_active" | "registration_status">
  > = {},
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
    is_active: true,
    registration_status: "registered",
    ...eligibility,
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
    filterCheckinBrowseAttendees(attendees, "arrived@example.com", false).map(
      (row) => row.id,
    ),
    ["arrived"],
  );
});

test("unrelated server changes update while the selected dirty edit is preserved", () => {
  const current = {
    selected: { sharedFields: ["email"] },
    other: { sharedFields: [] },
  };
  const server = {
    selected: { sharedFields: [] },
    other: { sharedFields: ["phone"] },
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
  assert.equal(
    selectedAttendeeChangedRemotely("before", "after", false),
    false,
  );
  assert.equal(selectedAttendeeChangedRemotely("same", "same", true), false);
});

test("server fingerprint covers arrival and governed sharing state, but never placement -- Check-In no longer owns or edits assigned_site", () => {
  const row = attendee("selected", false, "Selected");
  const initial = checkinServerFingerprint(row, ["phone", "email"]);

  assert.equal(initial, checkinServerFingerprint(row, ["email", "phone"]));
  const withSite: CheckinBrowseAttendee = { ...row, assigned_site: "A1" };
  assert.equal(
    initial,
    checkinServerFingerprint(withSite, ["email", "phone"]),
    "a Parking-originated site change must not trip Check-In's own dirty-conflict fingerprint",
  );
  assert.notEqual(
    initial,
    checkinServerFingerprint({ ...row, has_arrived: true }, ["email", "phone"]),
  );
  assert.notEqual(initial, checkinServerFingerprint(row, ["email"]));
});

// --- Registration eligibility (Admin operational-summary rule) -------------

test("the eligibility predicate is exactly the Admin operational-summary rule", () => {
  // Eligible: active record, any non-cancelled status.
  assert.equal(
    isCheckinEligible({ is_active: true, registration_status: "registered" }),
    true,
  );
  assert.equal(
    isCheckinEligible({ is_active: true, registration_status: "active" }),
    true,
  );
  // A non-cancelled status the Member roster's stricter allowlist would reject
  // deliberately retains its existing Admin eligibility.
  assert.equal(
    isCheckinEligible({ is_active: true, registration_status: "waitlisted" }),
    true,
  );
  assert.equal(
    isCheckinEligible({ is_active: true, registration_status: null }),
    true,
  );

  // Cancelled status is excluded even while the record is active.
  assert.equal(
    isCheckinEligible({ is_active: true, registration_status: "cancelled" }),
    false,
  );
  // An inactive record is excluded whatever its status.
  assert.equal(
    isCheckinEligible({ is_active: false, registration_status: "registered" }),
    false,
  );
  // Missing activity is excluded, never assumed active.
  assert.equal(
    isCheckinEligible({ is_active: null, registration_status: "registered" }),
    false,
  );
  assert.equal(
    isCheckinEligible({ is_active: undefined as unknown as null, registration_status: "registered" }),
    false,
  );
});

test("23 loaded registrations with one cancelled reduce to 22 eligible, and the cancelled record is the only one removed", () => {
  const loaded = [
    ...Array.from({ length: 22 }, (_, index) =>
      attendee(`eligible-${index}`, false, `Name${String(index).padStart(2, "0")}`),
    ),
    attendee("cancelled-1", false, "Zulu", { registration_status: "cancelled" }),
  ];
  assert.equal(loaded.length, 23);

  const eligible = selectEligibleCheckinAttendees(loaded);
  assert.equal(eligible.length, 22);
  assert.ok(!eligible.some((row) => row.id === "cancelled-1"));

  // The waiting count operators read comes from the same reduction.
  const waiting = filterCheckinBrowseAttendees(eligible, "", false);
  assert.equal(waiting.length, 22);
  assert.ok(!waiting.some((row) => row.id === "cancelled-1"));
});

test("neither search nor show-already-checked-in can surface a cancelled or inactive registration", () => {
  const cancelled = attendee("cancelled-1", false, "Widmore", {
    registration_status: "cancelled",
  });
  const inactive = attendee("inactive-1", false, "Wendell", { is_active: false });
  const arrivedCancelled = attendee("cancelled-2", true, "Wyatt", {
    registration_status: "cancelled",
  });
  const eligibleWaiting = attendee("eligible-1", false, "Waters");
  const rows = [cancelled, inactive, arrivedCancelled, eligibleWaiting];

  // Default browse.
  assert.deepEqual(
    filterCheckinBrowseAttendees(rows, "", false).map((row) => row.id),
    ["eligible-1"],
  );
  // Show already checked-in must not reveal the arrived-but-cancelled record.
  assert.deepEqual(
    filterCheckinBrowseAttendees(rows, "", true).map((row) => row.id),
    ["eligible-1"],
  );
  // Searching by name, by email, and by a shared prefix finds nothing ineligible.
  for (const query of ["Widmore", "Wendell", "Wyatt", "cancelled-1@example.com", "W"]) {
    const found = filterCheckinBrowseAttendees(rows, query, true);
    assert.ok(
      !found.some((row) => row.id.startsWith("cancelled") || row.id === "inactive-1"),
      `query ${query} surfaced an ineligible registration`,
    );
  }
  // An exact-id search for a cancelled record still yields nothing.
  assert.equal(filterCheckinBrowseAttendees(rows, "Widmore", true).length, 0);
});

test("eligible checked-in records keep their existing reachability, and waiting-first ordering is unchanged", () => {
  const rows = [
    attendee("arrived-eligible", true, "Able"),
    attendee("waiting-eligible", false, "Baker"),
    attendee("arrived-cancelled", true, "Cutter", {
      registration_status: "cancelled",
    }),
  ];

  // Default browse hides arrived records but keeps the eligible waiting one.
  assert.deepEqual(
    filterCheckinBrowseAttendees(rows, "", false).map((row) => row.id),
    ["waiting-eligible"],
  );
  // Show-arrived brings back only the eligible arrived record.
  assert.deepEqual(
    filterCheckinBrowseAttendees(rows, "", true).map((row) => row.id),
    ["waiting-eligible", "arrived-eligible"],
  );
  // Search reaches the eligible arrived record, as before.
  assert.deepEqual(
    filterCheckinBrowseAttendees(rows, "Able", false).map((row) => row.id),
    ["arrived-eligible"],
  );
});

test("eligibility is applied without disturbing the eligible set's order or contents", () => {
  const rows = [
    attendee("b", false, "Bravo"),
    attendee("x", false, "Xray", { is_active: false }),
    attendee("a", false, "Alpha"),
  ];
  assert.deepEqual(
    selectEligibleCheckinAttendees(rows).map((row) => row.id),
    ["b", "a"],
  );
  assert.deepEqual(
    sortCheckinBrowseAttendees(selectEligibleCheckinAttendees(rows)).map((row) => row.id),
    ["a", "b"],
  );
});
