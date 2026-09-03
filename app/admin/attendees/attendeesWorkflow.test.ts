import assert from "node:assert/strict";
import { test } from "node:test";

import {
  additionalParticipantsDirty,
  additionalParticipantsRemovedOnSave,
  ATTENDEE_EDIT_SECTIONS,
  attendeeChangedRemotelyWhileDirty,
  attendeeConcurrencyFingerprint,
  type AttendeeEditorState,
  type AttendeeRow,
  attendeeToEditorState,
  computeReviewItems,
  decideCapacityReconciliation,
  deriveHouseholdPeople,
  dirtySectionIds,
  editorStateDiffKeys,
  editorStateIsDirty,
  emptyAttendeeEditorState,
  filterAttendees,
  type HouseholdParticipantDraft,
  makeAdditionalDraft,
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

// ---------------------------------------------------------------------------
// decideCapacityReconciliation: post-save capacity-vs-materialized-roster
// reconciliation decision (Stage 2 attendee-save-path hardening).
// ---------------------------------------------------------------------------

test("decideCapacityReconciliation: existing Pilot + Co-Pilot, stored capacity 1 -> raise to 2", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 1,
      materializedRosterCount: 2,
      adminSelectedCapacity: 1,
    }),
    { action: "raise", newCapacity: 2 },
  );
});

test("decideCapacityReconciliation: existing Pilot + Co-Pilot, stored capacity 2 -> no RPC", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 2,
      materializedRosterCount: 2,
      adminSelectedCapacity: 2,
    }),
    { action: "none", reason: "capacity-covers-roster" },
  );
});

test("decideCapacityReconciliation: roster 3, stored capacity 2 -> raise to 3", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 2,
      materializedRosterCount: 3,
      adminSelectedCapacity: 2,
    }),
    { action: "raise", newCapacity: 3 },
  );
});

test("decideCapacityReconciliation: null stored capacity stays null (never auto-established)", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: null,
      materializedRosterCount: 2,
      adminSelectedCapacity: null,
    }),
    { action: "none", reason: "unknown-capacity" },
  );
  // even a large roster does not establish an unknown capacity
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: null,
      materializedRosterCount: 3,
      adminSelectedCapacity: 3,
    }),
    { action: "none", reason: "unknown-capacity" },
  );
});

test("decideCapacityReconciliation: stored capacity 3 with roster 2 -> stays 3, never lowered", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 3,
      materializedRosterCount: 2,
      adminSelectedCapacity: 3,
    }),
    { action: "none", reason: "capacity-covers-roster" },
  );
});

test("decideCapacityReconciliation: an explicitly higher administrator-selected capacity is preserved (4 with roster 3)", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 2,
      materializedRosterCount: 3,
      adminSelectedCapacity: 4,
    }),
    { action: "raise", newCapacity: 4 },
  );
});

test("decideCapacityReconciliation: raises to the roster count when no higher capacity was selected", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 1,
      materializedRosterCount: 3,
      adminSelectedCapacity: null,
    }),
    { action: "raise", newCapacity: 3 },
  );
  // a lower admin selection never drags the floor below the roster
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 1,
      materializedRosterCount: 3,
      adminSelectedCapacity: 2,
    }),
    { action: "raise", newCapacity: 3 },
  );
});

test("decideCapacityReconciliation: solo Pilot (roster 1) at stored capacity 1 -> no RPC", () => {
  assert.deepEqual(
    decideCapacityReconciliation({
      storedCapacity: 1,
      materializedRosterCount: 1,
      adminSelectedCapacity: 1,
    }),
    { action: "none", reason: "capacity-covers-roster" },
  );
});

// --- "People on this Registration" projection -----------------------------

function editorState(overrides: Partial<AttendeeEditorState> = {}): AttendeeEditorState {
  return { ...emptyAttendeeEditorState(), ...overrides };
}

function draft(
  overrides: Partial<HouseholdParticipantDraft> = {},
): HouseholdParticipantDraft {
  return makeAdditionalDraft(overrides);
}

test("deriveHouseholdPeople: a solo Pilot yields exactly one person card", () => {
  const people = deriveHouseholdPeople(
    editorState({ pilot_first: "Jane", pilot_last: "Doe", email: "jane@example.com" }),
  );
  assert.equal(people.length, 1);
  assert.equal(people[0].role, "pilot");
  assert.equal(people[0].roleLabel, "Pilot");
  assert.equal(people[0].firstName, "Jane");
  assert.equal(people[0].email, "jane@example.com");
  assert.equal(people[0].presentAtLoad, true);
});

test("deriveHouseholdPeople: Pilot phone falls back to primary_phone when cell_phone is blank", () => {
  const withCell = deriveHouseholdPeople(editorState({ cell_phone: "555-1", primary_phone: "555-2" }));
  assert.equal(withCell[0].cellPhone, "555-1");
  const withPrimaryOnly = deriveHouseholdPeople(editorState({ cell_phone: "", primary_phone: "555-2" }));
  assert.equal(withPrimaryOnly[0].cellPhone, "555-2");
});

test("deriveHouseholdPeople: Co-Pilot appears only when its own fields carry data", () => {
  const two = deriveHouseholdPeople(
    editorState({
      pilot_first: "Jane",
      copilot_first: "Sam",
      copilot_last: "Rivera",
      copilot_email: "sam@example.com",
      copilot_cell_phone: "555-9",
    }),
  );
  assert.deepEqual(two.map((p) => p.role), ["pilot", "copilot"]);
  assert.equal(two[1].roleLabel, "Co-Pilot");
  assert.equal(two[1].cellPhone, "555-9");
});

test("deriveHouseholdPeople: every Additional Participant draft with data is its own person, in array order", () => {
  const people = deriveHouseholdPeople(
    editorState({
      pilot_first: "Jane",
      copilot_first: "Sam",
      additionalParticipants: [
        draft({ id: "hm-1", firstName: "Pat", lastName: "Lee" }),
        draft({ firstName: "Jordan", lastName: "Kim", email: "jk@example.com" }),
        draft({ firstName: "", lastName: "", nickname: "", email: "", cellPhone: "" }),
        draft({ id: "hm-9", nickname: "Buzz" }),
      ],
    }),
  );
  assert.deepEqual(people.map((p) => p.role), [
    "pilot",
    "copilot",
    "additional",
    "additional",
    "additional",
  ]);
  assert.deepEqual(
    people.filter((p) => p.role === "additional").map((p) => p.firstName),
    ["Pat", "Jordan", ""],
  );
  // the blank draft yields no card
  assert.equal(people.length, 5);
});

test("deriveHouseholdPeople: an Additional Participant draft with only a nickname still yields a person; its sourceUiKey addresses the exact row", () => {
  const d = draft({ nickname: "Buzz" });
  const people = deriveHouseholdPeople(
    editorState({ additionalParticipants: [d] }),
  );
  assert.deepEqual(people.map((p) => p.role), ["pilot", "additional"]);
  assert.equal(people[1].sourceUiKey, d.uiKey);
});

test("deriveHouseholdPeople: a Co-Pilot with only a nickname does NOT yield a card (three-field test, matches syncHouseholdMembers)", () => {
  const people = deriveHouseholdPeople(editorState({ copilot_nickname: "Ace" }));
  assert.deepEqual(people.map((p) => p.role), ["pilot"]);
});

test("deriveHouseholdPeople: presentAtLoad is true only for a persisted person (Co-Pilot at load; Additional draft with an id)", () => {
  const people = deriveHouseholdPeople(
    editorState({
      copilot_first: "Sam",
      had_copilot_at_load: true,
      additionalParticipants: [
        draft({ id: "hm-1", firstName: "Pat" }),
        draft({ firstName: "New" }),
      ],
    }),
  );
  assert.equal(people.find((p) => p.role === "copilot")?.presentAtLoad, true);
  const additional = people.filter((p) => p.role === "additional");
  assert.equal(additional[0].presentAtLoad, true);
  assert.equal(additional[1].presentAtLoad, false);
});

test("deriveHouseholdPeople: capacity is never consulted -- one named person with a large authorized party size still yields one card", () => {
  const people = deriveHouseholdPeople(
    editorState({ pilot_first: "Jane", registration_capacity: 9 }),
  );
  assert.equal(people.length, 1);
});

test("additionalParticipantsDirty: insert, edit, and delete-by-id are each detected; a no-op reload is not", () => {
  const loaded = [
    draft({ id: "hm-1", firstName: "Pat", lastName: "Lee" }),
    draft({ id: "hm-2", firstName: "Jordan", lastName: "Kim" }),
  ];
  const clean = editorState({
    additionalParticipants: loaded.map((d) => ({ ...d })),
    additionalParticipantsAtLoad: loaded.map((d) => ({ ...d })),
  });
  assert.equal(additionalParticipantsDirty(clean), false);

  // add a new person
  assert.equal(
    additionalParticipantsDirty({
      ...clean,
      additionalParticipants: [
        ...clean.additionalParticipants,
        draft({ firstName: "New", lastName: "Person" }),
      ],
    }),
    true,
  );
  // a blank new draft is not "work to do"
  assert.equal(
    additionalParticipantsDirty({
      ...clean,
      additionalParticipants: [...clean.additionalParticipants, draft()],
    }),
    false,
  );
  // edit an existing person
  assert.equal(
    additionalParticipantsDirty({
      ...clean,
      additionalParticipants: clean.additionalParticipants.map((d) =>
        d.id === "hm-1" ? { ...d, lastName: "Leigh" } : d,
      ),
    }),
    true,
  );
  // remove one existing person
  assert.equal(
    additionalParticipantsDirty({
      ...clean,
      additionalParticipants: clean.additionalParticipants.filter(
        (d) => d.id !== "hm-2",
      ),
    }),
    true,
  );
});

test("additionalParticipantsRemovedOnSave: exactly the loaded rows whose id is gone from the working set", () => {
  const loaded = [
    draft({ id: "hm-1", firstName: "Pat" }),
    draft({ id: "hm-2", firstName: "Jordan" }),
    draft({ id: "hm-3", firstName: "Kai" }),
  ];
  const state = editorState({
    additionalParticipantsAtLoad: loaded,
    additionalParticipants: [
      { ...loaded[0] },
      draft({ firstName: "New" }),
    ],
  });
  assert.deepEqual(
    additionalParticipantsRemovedOnSave(state).map((d) => d.id),
    ["hm-2", "hm-3"],
  );
});

test("editorStateIsDirty / dirtySectionIds fold in Additional Participant changes under the household section", () => {
  const loaded = [draft({ id: "hm-1", firstName: "Pat" })];
  const baseline = editorState({
    additionalParticipants: loaded.map((d) => ({ ...d })),
    additionalParticipantsAtLoad: loaded.map((d) => ({ ...d })),
  });
  assert.equal(editorStateIsDirty(baseline, { ...baseline }), false);

  const withNew: AttendeeEditorState = {
    ...baseline,
    additionalParticipants: [
      ...baseline.additionalParticipants,
      draft({ firstName: "New", lastName: "Person" }),
    ],
  };
  assert.equal(editorStateIsDirty(baseline, withNew), true);
  assert.ok(dirtySectionIds(baseline, withNew).includes("household"));
});

test("ATTENDEE_EDIT_SECTIONS: authorized party size is its own section, distinct from Registration", () => {
  const partySize = ATTENDEE_EDIT_SECTIONS.find((s) => s.id === "party_size");
  const registration = ATTENDEE_EDIT_SECTIONS.find((s) => s.id === "registration");
  assert.ok(partySize, "a party_size section must exist");
  assert.deepEqual(partySize!.fields.sort(), [
    "capacity_increase_note",
    "registration_capacity",
  ]);
  assert.equal(partySize!.label, "Authorized Party Size");
  assert.ok(
    !registration!.fields.includes("registration_capacity"),
    "registration_capacity moved out of the Registration section",
  );
});
