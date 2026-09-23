import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AgendaLocationOption,
  collectAgendaLocations,
  findMatchingLocation,
  findSimilarLocations,
  groupItemsByLocation,
  locationComparisonKey,
  locationEditDistance,
  locationOptionsSignature,
  locationsAreSimilar,
  normalizeLocationDisplay,
  resolveLocationChoiceForSave,
  UNSPECIFIED_LOCATION_LABEL,
} from "./agendaLocations";

// Run with: npx tsx --test lib/agendaLocations.test.ts

test("comparison key trims, collapses internal whitespace, and case-folds", () => {
  assert.equal(locationComparisonKey("  Main   Building "), "main building");
  assert.equal(locationComparisonKey("MAIN BUILDING"), "main building");
  assert.equal(locationComparisonKey("main\tbuilding"), "main building");
  assert.equal(locationComparisonKey(null), "");
  assert.equal(locationComparisonKey("   "), "");
});

test("display normalization keeps case but trims and collapses whitespace", () => {
  assert.equal(normalizeLocationDisplay("  Main   Building "), "Main Building");
  assert.equal(normalizeLocationDisplay(null), "");
  assert.equal(normalizeLocationDisplay("   "), "");
});

test("collectAgendaLocations reuses the first spelling for capitalization/spacing variants and drops blanks", () => {
  const options = collectAgendaLocations([
    "Main Building",
    "main building", // same key as first -> collapses, keeps first spelling
    "  MAIN   BUILDING ", // same key -> collapses
    "Auditorium",
    "",
    "   ",
    null,
    undefined,
  ]);
  assert.deepEqual(options, [
    { key: "auditorium", label: "Auditorium" },
    { key: "main building", label: "Main Building" },
  ]);
});

test("findMatchingLocation reuses an existing spelling for any case/space variant", () => {
  const options = collectAgendaLocations(["Main Building", "Auditorium"]);
  assert.deepEqual(findMatchingLocation("  main   building ", options), {
    key: "main building",
    label: "Main Building",
  });
  // A genuinely new name has no match -> the operator adds it.
  assert.equal(findMatchingLocation("Pavilion", options), null);
  assert.equal(findMatchingLocation("", options), null);
});

test("edit distance handles empty, equal, substitution, and transposition", () => {
  assert.equal(locationEditDistance("abc", "abc"), 0);
  assert.equal(locationEditDistance("", "abc"), 3);
  assert.equal(locationEditDistance("abc", ""), 3);
  assert.equal(locationEditDistance("moron", "morton"), 1); // one insertion
  assert.equal(locationEditDistance("buidling", "building"), 2); // transposition
});

test("similarity flags likely typos but never genuinely distinct or substring names", () => {
  // Typos of the same intended name.
  assert.equal(locationsAreSimilar("Main Buidling", "Main Building"), true);
  assert.equal(locationsAreSimilar("Pioner Room", "Pioneer Room"), true);
  // A truncated/extended character inside a shared token is still a typo.
  assert.equal(locationsAreSimilar("Main Hal", "Main Hall"), true);
  assert.equal(locationsAreSimilar("Auditrium", "Auditorium"), true);
  // Genuinely different names.
  assert.equal(locationsAreSimilar("Auditorium", "Main Building"), false);
  // Same location under a case/space variant is NOT "similar" (it is identical).
  assert.equal(locationsAreSimilar("main building", "Main Building"), false);
  // Adding a separate word makes a distinct room, never a typo to merge.
  assert.equal(locationsAreSimilar("Room", "Room A"), false);
  assert.equal(locationsAreSimilar("Pioneer", "Pioneer Room"), false);
  // Too short to judge.
  assert.equal(locationsAreSimilar("A", "B"), false);
  assert.equal(locationsAreSimilar("", "Main Building"), false);
});

test("findSimilarLocations offers nearest existing names for a typo but excludes exact matches", () => {
  const options: AgendaLocationOption[] = collectAgendaLocations([
    "Main Building",
    "Auditorium",
    "Pioneer Room",
  ]);
  const suggestions = findSimilarLocations("Main Buidling", options);
  assert.deepEqual(
    suggestions.map((option) => option.label),
    ["Main Building"],
  );
  // An exact case/space variant is a match, not a typo suggestion.
  assert.deepEqual(findSimilarLocations("MAIN BUILDING", options), []);
  // A wholly distinct new name produces no typo noise.
  assert.deepEqual(findSimilarLocations("Cafeteria", options), []);
});

test("groupItemsByLocation puts every item under its actual location exactly once", () => {
  const items = [
    { id: "1", location: "Main Building" },
    { id: "2", location: "main building" }, // same column as #1
    { id: "3", location: "Auditorium" },
    { id: "4", location: null }, // unspecified
    { id: "5", location: "  " }, // unspecified
    { id: "6", location: "Main Building" },
  ];
  const groups = groupItemsByLocation(items, (item) => item.location);

  // One group per distinct key, in first-appearance order.
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Main Building", "Auditorium", UNSPECIFIED_LOCATION_LABEL],
  );

  // Every item appears exactly once, total preserved.
  const totalGrouped = groups.reduce((sum, group) => sum + group.items.length, 0);
  assert.equal(totalGrouped, items.length);
  const allIds = groups.flatMap((group) => group.items.map((item) => item.id)).sort();
  assert.deepEqual(allIds, ["1", "2", "3", "4", "5", "6"]);

  // Capitalization variant merged onto the first-seen spelling.
  const mainGroup = groups.find((group) => group.key === "main building");
  assert.deepEqual(mainGroup?.items.map((item) => item.id), ["1", "2", "6"]);

  // Blank locations collect under the unspecified label.
  const unspecified = groups.find((group) => group.isUnspecified);
  assert.equal(unspecified?.label, UNSPECIFIED_LOCATION_LABEL);
  assert.deepEqual(unspecified?.items.map((item) => item.id), ["4", "5"]);
});

test("groupItemsByLocation preserves the incoming (date/time-sorted) order within and across groups", () => {
  const items = [
    { id: "a", location: "Auditorium" },
    { id: "b", location: "Main Building" },
    { id: "c", location: "Auditorium" },
  ];
  const groups = groupItemsByLocation(items, (item) => item.location);
  // Auditorium seen first -> leads; its items keep incoming order.
  assert.deepEqual(groups.map((group) => group.key), ["auditorium", "main building"]);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["a", "c"]);
});

test("locationOptionsSignature is stable, order-independent, and changes when the option set changes", () => {
  const a = collectAgendaLocations(["Main Building", "Auditorium"]);
  const b = collectAgendaLocations(["auditorium", "MAIN BUILDING"]); // same keys, other order/spelling
  assert.equal(locationOptionsSignature(a), locationOptionsSignature(b));
  const c = collectAgendaLocations(["Main Building", "Auditorium", "Chapel"]);
  assert.notEqual(locationOptionsSignature(a), locationOptionsSignature(c));
});

test("resolveLocationChoiceForSave: blank is allowed and preserved", () => {
  const r = resolveLocationChoiceForSave("   ", [], {});
  assert.deepEqual(r, { status: "ok", value: "" });
});

test("resolveLocationChoiceForSave: a case/space variant resolves to the existing spelling without a blur", () => {
  const options = collectAgendaLocations(["Main Building"]);
  const r = resolveLocationChoiceForSave("  main   BUILDING ", options, {});
  assert.deepEqual(r, { status: "ok", value: "Main Building" });
});

test("resolveLocationChoiceForSave: an unchanged existing value is allowed even if it is a distinct/typo name", () => {
  // Editing an item whose stored location is 'Auditrium' and not changing it.
  const r = resolveLocationChoiceForSave("Auditrium", [], { originalValue: "Auditrium" });
  assert.deepEqual(r, { status: "ok", value: "Auditrium" });
});

test("resolveLocationChoiceForSave: a genuinely new name is blocked unless explicitly acknowledged", () => {
  const options = collectAgendaLocations(["Main Building"]);
  const blocked = resolveLocationChoiceForSave("Ballroom", options, {});
  assert.equal(blocked.status, "needs_choice");
  const acked = resolveLocationChoiceForSave("Ballroom", options, {
    acknowledgedNewKey: locationComparisonKey("Ballroom"),
  });
  assert.deepEqual(acked, { status: "ok", value: "Ballroom" });
});

test("resolveLocationChoiceForSave: a likely typo is blocked and offers reuse suggestions, never a silent merge", () => {
  const options = collectAgendaLocations(["Main Building", "Auditorium"]);
  const r = resolveLocationChoiceForSave("Main Buidling", options, {});
  assert.equal(r.status, "needs_choice");
  if (r.status === "needs_choice") {
    assert.deepEqual(r.suggestions.map((o) => o.label), ["Main Building"]);
  }
  // A stale acknowledgment for a DIFFERENT key does not unlock this typo.
  const stillBlocked = resolveLocationChoiceForSave("Main Buidling", options, {
    acknowledgedNewKey: locationComparisonKey("Somewhere Else"),
  });
  assert.equal(stillBlocked.status, "needs_choice");
});
