import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTENDEE_EDIT_SECTIONS,
  attendeeChangedRemotelyWhileDirty,
  attendeeConcurrencyFingerprint,
  type AttendeeRow,
  attendeeToEditorState,
  computeReviewItems,
  dirtySectionIds,
  editorStateDiffKeys,
  editorStateIsDirty,
  emptyAttendeeEditorState,
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

test("emptyAttendeeEditorState matches the canonical universal onboarding defaults for manual creation", () => {
  assert.equal(emptyAttendeeEditorState().needs_name_tag, true);
  assert.equal(emptyAttendeeEditorState().needs_coach_plate, true);
  assert.equal(emptyAttendeeEditorState().needs_parking, true);
});

test("attendeeToEditorState preserves existing explicit operational-need values", () => {
  const falseState = attendeeToEditorState(attendee({
    needs_name_tag: false,
    needs_coach_plate: false,
    needs_parking: false,
  }));
  const trueState = attendeeToEditorState(attendee({
    needs_name_tag: true,
    needs_coach_plate: true,
    needs_parking: true,
  }));

  assert.equal(falseState.needs_name_tag, false);
  assert.equal(falseState.needs_coach_plate, false);
  assert.equal(falseState.needs_parking, false);
  assert.equal(trueState.needs_name_tag, true);
  assert.equal(trueState.needs_coach_plate, true);
  assert.equal(trueState.needs_parking, true);
});

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

// --- Test Expectation E: dirty-state detection ------------------------------

test("editorStateIsDirty: false for an unchanged form, true after any content field changes", () => {
  const baseline = emptyAttendeeEditorState();
  assert.equal(editorStateIsDirty(baseline, { ...baseline }), false);
  assert.equal(
    editorStateIsDirty(baseline, { ...baseline, pilot_first: "Jane" }),
    true,
  );
});

test("editorStateIsDirty: bookkeeping-only fields never count as a change", () => {
  const baseline = emptyAttendeeEditorState();
  const current = {
    ...baseline,
    had_copilot_at_load: true,
    copilot_name_at_load: "Sam Rivera",
    registration_capacity_original: 3,
    registration_capacity_was_unset: true,
  };

  assert.equal(editorStateIsDirty(baseline, current), false);
  assert.deepEqual(editorStateDiffKeys(baseline, current), []);
});

test("editorStateDiffKeys: reports exactly the fields that changed", () => {
  const baseline = emptyAttendeeEditorState();
  const current = { ...baseline, pilot_first: "Jane", city: "Reno" };

  assert.deepEqual(
    [...editorStateDiffKeys(baseline, current)].sort(),
    ["city", "pilot_first"],
  );
});

test("dirtySectionIds: maps changed fields to the one section each belongs to", () => {
  const baseline = emptyAttendeeEditorState();
  const current = {
    ...baseline,
    pilot_first: "Jane", // identity
    city: "Reno", // location
  };

  assert.deepEqual(dirtySectionIds(baseline, current).sort(), [
    "identity",
    "location",
  ]);
});

test("dirtySectionIds: empty when nothing changed", () => {
  const baseline = emptyAttendeeEditorState();
  assert.deepEqual(dirtySectionIds(baseline, { ...baseline }), []);
});

test("ATTENDEE_EDIT_SECTIONS: every section has a non-empty field list and no field is claimed twice", () => {
  const seen = new Set<string>();
  for (const section of ATTENDEE_EDIT_SECTIONS) {
    assert.ok(section.fields.length > 0, `${section.id} must own at least one field`);
    for (const field of section.fields) {
      assert.ok(!seen.has(field), `${String(field)} claimed by more than one section`);
      seen.add(field);
    }
  }
});

// --- Test Expectation H: same-record conflict -------------------------------

test("attendeeConcurrencyFingerprint: stable for identical governed content, changes when a governed field changes", () => {
  const row = attendee({ id: "x" });
  const fp1 = attendeeConcurrencyFingerprint(row);
  const fp2 = attendeeConcurrencyFingerprint({ ...row });
  assert.equal(fp1, fp2);

  const changed = attendeeConcurrencyFingerprint({
    ...row,
    membership_number: "F99999",
  });
  assert.notEqual(fp1, changed);
});

test("attendeeConcurrencyFingerprint: Stage A boundary -- has_arrived and assigned_site are not Attendees-governed fields and never affect the fingerprint", () => {
  const row = attendee({ id: "x" });
  const fp1 = attendeeConcurrencyFingerprint(row);

  const arrivalChanged = attendeeConcurrencyFingerprint({
    ...row,
    has_arrived: true,
  } as any);
  const siteChanged = attendeeConcurrencyFingerprint({
    ...row,
    assigned_site: "B14",
  } as any);

  assert.equal(fp1, arrivalChanged);
  assert.equal(fp1, siteChanged);
});

test("attendeeChangedRemotelyWhileDirty: only true when dirty AND the fingerprint actually differs", () => {
  assert.equal(
    attendeeChangedRemotelyWhileDirty("before", "after", true),
    true,
  );
  assert.equal(
    attendeeChangedRemotelyWhileDirty("before", "after", false),
    false,
    "not dirty -- no conflict, safe to reconcile silently",
  );
  assert.equal(
    attendeeChangedRemotelyWhileDirty("same", "same", true),
    false,
    "dirty but nothing actually changed server-side -- no conflict",
  );
  assert.equal(
    attendeeChangedRemotelyWhileDirty(null, "after", true),
    false,
    "no baseline captured yet -- cannot judge a conflict",
  );
});
