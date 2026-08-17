import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AttendeeRow,
  computeReviewItems,
  filterAttendees,
  matchesViewMode,
  sortAttendees,
  type ValidationRule,
} from "@/app/admin/attendees/attendeesWorkflow";

function attendee(overrides: Partial<AttendeeRow> = {}): AttendeeRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    event_id: "22222222-2222-2222-2222-222222222222",
    entry_id: null,
    email: "pilot@example.com",
    pilot_first: "Jane",
    pilot_last: "Doe",
    copilot_first: null,
    copilot_last: null,
    nickname: null,
    copilot_nickname: null,
    membership_number: "F12345",
    city: "Springfield",
    state: "IL",
    assigned_site: "A12",
    has_arrived: false,
    is_first_timer: false,
    wants_to_volunteer: false,
    is_active: true,
    registration_status: "active",
    ...overrides,
  };
}

const requiredMembershipRule: ValidationRule = {
  id: "rule-1",
  field_name: "membership_number",
  rule_type: "starts_with",
  rule_value: "F",
  message: "Membership number must start with F.",
  severity: "error",
  is_active: true,
  priority: 1,
  applies_to_event_id: null,
};

// --- computeReviewItems is the single owner of "what is flagged" -----------

test("computeReviewItems: flags a record that violates an active rule, exactly once per attendee", () => {
  const bad = attendee({ id: "bad", membership_number: "X999" });
  const good = attendee({ id: "good", membership_number: "F123" });

  const items = computeReviewItems([bad, good], [requiredMembershipRule], null);

  assert.equal(items.length, 1);
  assert.equal(items[0].attendee.id, "bad");
  assert.equal(items[0].issues.length, 1);
});

test("computeReviewItems: an inactive rule never flags anything", () => {
  const bad = attendee({ id: "bad", membership_number: "X999" });
  const items = computeReviewItems(
    [bad],
    [{ ...requiredMembershipRule, is_active: false }],
    null,
  );

  assert.deepEqual(items, []);
});

// --- matchesViewMode: single owner of the View decision ---------------------

test("matchesViewMode: 'active' excludes cancelled, includes everything else regardless of flag state", () => {
  assert.equal(
    matchesViewMode({ id: "a", registration_status: "active" }, "active", true),
    true,
  );
  assert.equal(
    matchesViewMode(
      { id: "a", registration_status: "cancelled" },
      "active",
      false,
    ),
    false,
  );
});

test("matchesViewMode: 'review' requires both not-cancelled and flagged", () => {
  assert.equal(
    matchesViewMode({ id: "a", registration_status: "active" }, "review", true),
    true,
  );
  assert.equal(
    matchesViewMode(
      { id: "a", registration_status: "active" },
      "review",
      false,
    ),
    false,
  );
  assert.equal(
    matchesViewMode(
      { id: "a", registration_status: "cancelled" },
      "review",
      true,
    ),
    false,
  );
});

test("matchesViewMode: 'cancelled' and 'all' behave as their names imply", () => {
  assert.equal(
    matchesViewMode(
      { id: "a", registration_status: "cancelled" },
      "cancelled",
      false,
    ),
    true,
  );
  assert.equal(
    matchesViewMode({ id: "a", registration_status: "active" }, "all", false),
    true,
  );
  assert.equal(
    matchesViewMode(
      { id: "a", registration_status: "cancelled" },
      "all",
      false,
    ),
    true,
  );
});

// --- filterAttendees / sortAttendees ----------------------------------------

test("filterAttendees: search, status, participant type, and view all narrow together", () => {
  const rows = [
    attendee({ id: "a", pilot_last: "Adams", participant_type: "vendor" }),
    attendee({
      id: "b",
      pilot_last: "Baker",
      participant_type: "attendee",
      registration_status: "cancelled",
    }),
  ];

  const result = filterAttendees(rows, [], {
    search: "",
    dataStatusFilter: "all",
    participantTypeFilter: "vendor",
    viewMode: "all",
  });

  assert.deepEqual(result.map((r) => r.id), ["a"]);
});

test("sortAttendees: 'site' groups by assigned site, pushing unassigned to the bottom", () => {
  const rows = [
    attendee({ id: "unassigned", assigned_site: null, pilot_last: "Zed" }),
    attendee({ id: "b12", assigned_site: "B12" }),
    attendee({ id: "a1", assigned_site: "A1" }),
  ];

  assert.deepEqual(
    sortAttendees(rows, "site").map((r) => r.id),
    ["a1", "b12", "unassigned"],
  );
});
