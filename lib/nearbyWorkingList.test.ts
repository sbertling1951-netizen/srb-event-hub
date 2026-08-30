import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCandidatesToWorkingList,
  addManualWorkingListEntry,
  applyPlaceDetails,
  clearSavedWorkingListEntries,
  EMPTY_WORKING_LIST,
  entriesPendingSave,
  findExistingEventPlaceMatch,
  findWorkingListDuplicates,
  isWorkingListEntrySettled,
  markWorkingListEntriesReuseOutcome,
  markWorkingListEntriesSaved,
  removeWorkingListEntry,
  resolveWorkingListEventTransition,
  updateWorkingListEntry,
  workingListHasGooglePlaceId,
} from "./nearbyWorkingList";

const candidate = (id: string | null, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Place ${id ?? "?"}`,
  address: "1 Main St",
  category: "restaurant",
  lat: 30.3,
  lng: -87.7,
  googleTypes: ["restaurant"],
  producingCategoryCodes: ["restaurant"],
  mappingExact: true,
  ...overrides,
});

test("only explicitly passed candidates enter the Working List", () => {
  const result = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a"),
    candidate("b"),
  ]);
  assert.equal(result.added, 2);
  assert.deepEqual(
    result.state.entries.map((e) => e.googlePlaceId),
    ["a", "b"],
  );
  assert.equal(result.state.entries[0].source, "google");
});

test("the same Google Place ID cannot enter the Working List twice", () => {
  const first = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [candidate("a")]);
  const second = addCandidatesToWorkingList(first.state, [
    candidate("a", { name: "Renamed" }),
    candidate("c"),
  ]);
  assert.equal(second.added, 1);
  assert.equal(second.skippedExistingGoogleIds, 1);
  assert.deepEqual(
    second.state.entries.map((e) => e.googlePlaceId),
    ["a", "c"],
  );
  // original entry untouched by the re-add attempt
  assert.equal(second.state.entries[0].name, "Place a");
});

test("select-all style bulk add is idempotent within one call and across calls", () => {
  const batch = [candidate("a"), candidate("a"), candidate("b")];
  const result = addCandidatesToWorkingList(EMPTY_WORKING_LIST, batch);
  assert.equal(result.added, 2);
  assert.equal(result.skippedExistingGoogleIds, 1);
});

test("candidates with no place_id are not added here and are counted", () => {
  const result = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate(null),
  ]);
  assert.equal(result.added, 0);
  assert.equal(result.skippedNoPlaceId, 1);
});

test("workingListHasGooglePlaceId is an exact match only", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("exact-id"),
  ]);
  assert.equal(workingListHasGooglePlaceId(state, "exact-id"), true);
  assert.equal(workingListHasGooglePlaceId(state, "exact"), false);
  assert.equal(workingListHasGooglePlaceId(state, null), false);
});

test("a manual entry joins the same list and never gets a Google Place ID", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a"),
  ]);
  const { state: withManual, entry } = addManualWorkingListEntry(
    state,
    { name: "Hand Added", address: "9 Elm St", categoryCode: "fuel" },
    "seed-1",
  );
  assert.equal(withManual.entries.length, 2);
  assert.equal(entry.source, "manual");
  assert.equal(entry.googlePlaceId, null);
  assert.equal(entry.key, "manual:seed-1");
});

test("editing an entry never changes its identity", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a"),
  ]);
  const key = state.entries[0].key;
  const edited = updateWorkingListEntry(state, key, {
    name: "Corrected Name",
    categoryId: "cat-123",
    phone: "555",
  });
  assert.equal(edited.entries[0].key, key);
  assert.equal(edited.entries[0].googlePlaceId, "a");
  assert.equal(edited.entries[0].source, "google");
  assert.equal(edited.entries[0].name, "Corrected Name");
  assert.equal(edited.entries[0].categoryId, "cat-123");
});

test("manual entry edit round-trips through updateWorkingListEntry", () => {
  const { state, entry } = addManualWorkingListEntry(
    EMPTY_WORKING_LIST,
    { name: "Draft" },
    "seed-2",
  );
  const edited = updateWorkingListEntry(state, entry.key, {
    name: "Final",
    website: "https://x.test",
  });
  assert.equal(edited.entries[0].name, "Final");
  assert.equal(edited.entries[0].website, "https://x.test");
  assert.equal(edited.entries[0].source, "manual");
});

test("remove drops exactly one entry", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a"),
    candidate("b"),
  ]);
  const removed = removeWorkingListEntry(state, state.entries[0].key);
  assert.deepEqual(
    removed.entries.map((e) => e.googlePlaceId),
    ["b"],
  );
});

test("applyPlaceDetails fills blanks on success and only flips status on failure", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a", { address: "" }),
  ]);
  const key = state.entries[0].key;

  const enriched = applyPlaceDetails(state, key, "fetched", {
    phone: "555-0100",
    website: "https://x.test",
    locationCode: "86HJ8X2W+2X",
    address: "12 Filled Rd",
  });
  assert.equal(enriched.entries[0].detailsStatus, "fetched");
  assert.equal(enriched.entries[0].phone, "555-0100");
  assert.equal(enriched.entries[0].address, "12 Filled Rd");
  assert.equal(enriched.entries[0].locationCode, "86HJ8X2W+2X");

  // A subsequent failure must not wipe the entry
  const failed = applyPlaceDetails(enriched, key, "failed");
  assert.equal(failed.entries[0].detailsStatus, "failed");
  assert.equal(failed.entries[0].phone, "555-0100");
  assert.equal(failed.entries[0].name, "Place a");
});

test("applyPlaceDetails never clobbers an admin edit", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a"),
  ]);
  const key = state.entries[0].key;
  const editedPhone = updateWorkingListEntry(state, key, { phone: "MANUAL" });
  const enriched = applyPlaceDetails(editedPhone, key, "fetched", {
    phone: "FROM-GOOGLE",
  });
  assert.equal(enriched.entries[0].phone, "MANUAL");
});

test("saved entries are excluded from pending save and a retry cannot double-insert", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a"),
    candidate("b"),
  ]);
  const marked = markWorkingListEntriesSaved(state, [
    { key: state.entries[0].key, eventPlaceId: "evp-1" },
  ]);
  const pending = entriesPendingSave(marked);
  assert.deepEqual(
    pending.map((e) => e.googlePlaceId),
    ["b"],
  );
  assert.equal(marked.entries[0].savedEventPlaceId, "evp-1");

  const cleared = clearSavedWorkingListEntries(marked);
  assert.deepEqual(
    cleared.entries.map((e) => e.googlePlaceId),
    ["b"],
  );
});

test("findWorkingListDuplicates is normalized, non-fuzzy, and never merges", () => {
  const { state } = addManualWorkingListEntry(
    EMPTY_WORKING_LIST,
    { name: "The Corner Cafe", address: "1 Main St." },
    "seed-3",
  );

  const strong = findWorkingListDuplicates(state, {
    name: "the corner cafe",
    address: "1 MAIN ST",
  });
  assert.equal(strong.length, 1);
  assert.equal(strong[0].reason, "name+address");

  const weak = findWorkingListDuplicates(state, {
    name: "The Corner Cafe",
    address: "999 Other Rd",
  });
  assert.equal(weak[0].reason, "name");

  const none = findWorkingListDuplicates(state, { name: "Completely Different" });
  assert.equal(none.length, 0);

  // the state is unchanged by the check
  assert.equal(state.entries.length, 1);
});

test("candidates and manual entries start with no reuse outcome", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [candidate("a")]);
  assert.equal(state.entries[0].reuseOutcome, null);
  const { entry } = addManualWorkingListEntry(EMPTY_WORKING_LIST, { name: "M" }, "s");
  assert.equal(entry.reuseOutcome, null);
});

test("a producing category id carried by the candidate is preserved on the entry", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a", { categoryCode: "fuel", categoryId: "cat-fuel-uuid" }),
  ]);
  assert.equal(state.entries[0].categoryCode, "fuel");
  assert.equal(state.entries[0].categoryId, "cat-fuel-uuid");
});

test("markWorkingListEntriesReuseOutcome settles reused/already_associated but not not_reusable", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [
    candidate("a"),
    candidate("b"),
    candidate("c"),
  ]);
  const marked = markWorkingListEntriesReuseOutcome(state, [
    { key: state.entries[0].key, outcome: "reused" },
    { key: state.entries[1].key, outcome: "already_associated" },
    { key: state.entries[2].key, outcome: "not_reusable" },
  ]);

  assert.equal(isWorkingListEntrySettled(marked.entries[0]), true);
  assert.equal(isWorkingListEntrySettled(marked.entries[1]), true);
  assert.equal(isWorkingListEntrySettled(marked.entries[2]), false);

  assert.deepEqual(
    entriesPendingSave(marked).map((e) => e.googlePlaceId),
    ["c"],
  );

  // clear-saved drops the two settled ones, keeps the not_reusable one
  assert.deepEqual(
    clearSavedWorkingListEntries(marked).entries.map((e) => e.googlePlaceId),
    ["c"],
  );
});

test("a reused entry is retry-safe: a second final save never re-sends it", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [candidate("a")]);
  const settled = markWorkingListEntriesReuseOutcome(state, [
    { key: state.entries[0].key, outcome: "reused" },
  ]);
  assert.equal(entriesPendingSave(settled).length, 0);
});

test("updateWorkingListEntry cannot change reuse outcome, saved id, or provider identity", () => {
  const { state } = addCandidatesToWorkingList(EMPTY_WORKING_LIST, [candidate("a")]);
  const key = state.entries[0].key;
  const settled = markWorkingListEntriesSaved(state, [
    { key, eventPlaceId: "evp-real" },
  ]);
  // A forced patch that tries to overwrite identity + settled state: the
  // reducer strips those keys at runtime, not just via the type.
  const forced = {
    name: "ok",
    googlePlaceId: "forged",
    reuseOutcome: "reused",
    savedEventPlaceId: "evp-forged",
  } as unknown as Parameters<typeof updateWorkingListEntry>[2];
  const attempted = updateWorkingListEntry(settled, key, forced);
  assert.equal(attempted.entries[0].name, "ok");
  assert.equal(attempted.entries[0].googlePlaceId, "a");
  assert.equal(attempted.entries[0].reuseOutcome, null);
  assert.equal(attempted.entries[0].savedEventPlaceId, "evp-real");
});

test("findExistingEventPlaceMatch is conservative: skips only on a confident match, never on a one-sided blank address", () => {
  const eventPlaces = [
    { id: "evp-1", name: "Corner Cafe", address: "1 Main St." },
    { id: "evp-2", name: "Fuel Stop", address: null },
    { id: "evp-3", name: "No Address Diner", address: "" },
  ];

  // name + address both present and equal -> skip
  assert.equal(
    findExistingEventPlaceMatch(
      { name: "corner cafe", address: "1 MAIN ST" },
      eventPlaces,
    ),
    "evp-1",
  );
  // name matches, addresses disagree -> NOT a match (insert, don't drop)
  assert.equal(
    findExistingEventPlaceMatch(
      { name: "Corner Cafe", address: "999 Other Rd" },
      eventPlaces,
    ),
    null,
  );
  // name matches, entry has an address, existing does not -> NOT confident
  // (F1): must NOT be dropped
  assert.equal(
    findExistingEventPlaceMatch({ name: "fuel stop", address: "12 Hwy" }, eventPlaces),
    null,
  );
  // name matches, entry has no address, existing does -> also NOT confident
  assert.equal(
    findExistingEventPlaceMatch({ name: "Corner Cafe", address: "" }, eventPlaces),
    null,
  );
  // name matches and NEITHER side has an address -> skip
  assert.equal(
    findExistingEventPlaceMatch({ name: "no address diner", address: "" }, eventPlaces),
    "evp-3",
  );
  assert.equal(
    findExistingEventPlaceMatch({ name: "fuel stop", address: "" }, eventPlaces),
    "evp-2",
  );
  // no name match
  assert.equal(
    findExistingEventPlaceMatch({ name: "Nowhere", address: "1 Main St." }, eventPlaces),
    null,
  );
});

// --- D7: Working List Event-context transition ------------------------

test("a transient/absent Event context is never an Event switch (hold)", () => {
  assert.deepEqual(resolveWorkingListEventTransition("A", null), { action: "hold" });
  assert.deepEqual(resolveWorkingListEventTransition("A", undefined), { action: "hold" });
  assert.deepEqual(resolveWorkingListEventTransition(null, null), { action: "hold" });
  assert.deepEqual(resolveWorkingListEventTransition(null, undefined), { action: "hold" });
});

test("initial establishment (null -> A) stamps the Event, never clears", () => {
  assert.deepEqual(resolveWorkingListEventTransition(null, "A"), {
    action: "stamp",
    eventId: "A",
  });
});

test("the same Event re-confirmed is a hold", () => {
  assert.deepEqual(resolveWorkingListEventTransition("A", "A"), { action: "hold" });
});

test("a confirmed real Event change (A -> B) clears", () => {
  assert.deepEqual(resolveWorkingListEventTransition("A", "B"), {
    action: "clear",
    eventId: "B",
  });
});

test("Event A -> null -> Event A preserves the list across the whole sequence", () => {
  let confirmed: string | null = null;
  const steps: Array<string | null | undefined> = ["A", "A", null, undefined, "A", "A"];
  const actions: string[] = [];
  for (const observed of steps) {
    const t = resolveWorkingListEventTransition(confirmed, observed);
    actions.push(t.action);
    if (t.action !== "hold") {
      confirmed = t.eventId;
    }
  }
  // one stamp on first sight of A, then only holds -- never "clear"
  assert.deepEqual(actions, ["stamp", "hold", "hold", "hold", "hold", "hold"]);
  assert.equal(confirmed, "A");
  assert.equal(actions.includes("clear"), false);
});

test("Event A -> null -> Event B still clears on the real switch", () => {
  let confirmed: string | null = null;
  const steps: Array<string | null | undefined> = ["A", null, "B"];
  const actions: string[] = [];
  for (const observed of steps) {
    const t = resolveWorkingListEventTransition(confirmed, observed);
    actions.push(t.action);
    if (t.action !== "hold") {
      confirmed = t.eventId;
    }
  }
  assert.deepEqual(actions, ["stamp", "hold", "clear"]);
  assert.equal(confirmed, "B");
});

test("no A -> B path avoids a clear, regardless of transient nulls between", () => {
  for (const middle of [[], [null], [undefined], [null, undefined, null]] as Array<
    Array<string | null | undefined>
  >) {
    let confirmed: string | null = "A";
    const seq: Array<string | null | undefined> = [...middle, "B"];
    let sawClear = false;
    for (const observed of seq) {
      const t = resolveWorkingListEventTransition(confirmed, observed);
      if (t.action === "clear") {
        sawClear = true;
      }
      if (t.action !== "hold") {
        confirmed = t.eventId;
      }
    }
    assert.equal(sawClear, true);
    assert.equal(confirmed, "B");
  }
});
