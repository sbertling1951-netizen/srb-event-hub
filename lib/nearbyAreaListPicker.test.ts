import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AreaListCandidate,
  areaListCandidateTypeOptions,
  candidateAreaKey,
  candidateCategoryKey,
  filterAreaListCandidates,
  groupAreaListCandidates,
  pruneSelectionToFiltered,
  selectableAreaListCandidateIds,
  UNASSIGNED_AREA_KEY,
  UNASSIGNED_AREA_LABEL,
  UNCATEGORIZED_KEY,
  UNCATEGORIZED_LABEL,
} from "@/lib/nearbyAreaListPicker";

function candidate(over: Partial<AreaListCandidate>): AreaListCandidate {
  return {
    nearby_master_id: over.nearby_master_id ?? crypto.randomUUID(),
    name: over.name ?? "Place",
    category_id: over.category_id ?? null,
    category_label: over.category_label ?? null,
    scope: over.scope ?? "shared_public",
    tenant_id: over.tenant_id ?? null,
    area_id: over.area_id ?? null,
    area_name: over.area_name ?? null,
  };
}

const AMANA = "a0000000-0000-4000-8000-000000000001";
const GULF = "a0000000-0000-4000-8000-000000000002";
const GROCERY = "c0000000-0000-4000-8000-000000000001";
const FUEL = "c0000000-0000-4000-8000-000000000002";

const SAMPLE: AreaListCandidate[] = [
  candidate({ nearby_master_id: "p1", name: "ALDI", area_id: AMANA, area_name: "Amana", category_id: GROCERY, category_label: "Grocery" }),
  candidate({ nearby_master_id: "p2", name: "Amana General Store", area_id: AMANA, area_name: "Amana", category_id: GROCERY, category_label: "Grocery" }),
  candidate({ nearby_master_id: "p3", name: "Gulf Fuel", area_id: GULF, area_name: "Gulf Shores", category_id: FUEL, category_label: "Fuel" }),
  candidate({ nearby_master_id: "p4", name: "Roadside Diner", area_id: GULF, area_name: "Gulf Shores", category_id: null, category_label: null }),
  candidate({ nearby_master_id: "p5", name: "Nowhere Cafe", area_id: null, area_name: null, category_id: GROCERY, category_label: "Grocery" }),
];

test("area / category keys collapse NULLs to stable synthetic keys", () => {
  assert.equal(candidateAreaKey(SAMPLE[0]), AMANA);
  assert.equal(candidateAreaKey(SAMPLE[4]), UNASSIGNED_AREA_KEY);
  assert.equal(candidateCategoryKey(SAMPLE[0]), GROCERY);
  assert.equal(candidateCategoryKey(SAMPLE[3]), UNCATEGORIZED_KEY);
});

test("groups render as Area -> type -> place with Unassigned and Uncategorized last", () => {
  const groups = groupAreaListCandidates(SAMPLE);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Amana", "Gulf Shores", UNASSIGNED_AREA_LABEL],
  );

  const gulf = groups.find((g) => g.label === "Gulf Shores")!;
  assert.deepEqual(gulf.typeGroups.map((t) => t.label), ["Fuel", UNCATEGORIZED_LABEL]);

  const amana = groups[0];
  assert.deepEqual(
    amana.typeGroups[0].places.map((p) => p.name),
    ["ALDI", "Amana General Store"],
  );

  const unassigned = groups[groups.length - 1];
  assert.equal(unassigned.isUnassigned, true);
  assert.deepEqual(unassigned.places.map((p) => p.name), ["Nowhere Cafe"]);
});

test("Unassigned area sorts last even against alphabetically later names", () => {
  const groups = groupAreaListCandidates([
    candidate({ nearby_master_id: "z", name: "Z place", area_id: null }),
    candidate({ nearby_master_id: "a", name: "A place", area_id: AMANA, area_name: "Zzz Area" }),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["Zzz Area", UNASSIGNED_AREA_LABEL]);
});

test("name filter is case-insensitive substring and does not cross fields", () => {
  const filtered = filterAreaListCandidates(SAMPLE, {
    nameQuery: "  aMaNa  ",
    categoryKeys: new Set(),
    activeMemberIds: new Set(),
  });
  assert.deepEqual(filtered.map((p) => p.nearby_master_id), ["p2"]);
});

test("marker-type filter matches category_id and the Uncategorized sentinel", () => {
  const grocery = filterAreaListCandidates(SAMPLE, {
    nameQuery: "",
    categoryKeys: new Set([GROCERY]),
    activeMemberIds: new Set(),
  });
  assert.deepEqual(grocery.map((p) => p.nearby_master_id).sort(), ["p1", "p2", "p5"]);

  const uncategorized = filterAreaListCandidates(SAMPLE, {
    nameQuery: "",
    categoryKeys: new Set([UNCATEGORIZED_KEY]),
    activeMemberIds: new Set(),
  });
  assert.deepEqual(uncategorized.map((p) => p.nearby_master_id), ["p4"]);

  const both = filterAreaListCandidates(SAMPLE, {
    nameQuery: "",
    categoryKeys: new Set([FUEL, UNCATEGORIZED_KEY]),
    activeMemberIds: new Set(),
  });
  assert.deepEqual(both.map((p) => p.nearby_master_id).sort(), ["p3", "p4"]);
});

test("active members are always excluded, regardless of other filters", () => {
  const filtered = filterAreaListCandidates(SAMPLE, {
    nameQuery: "",
    categoryKeys: new Set(),
    activeMemberIds: new Set(["p1", "p3"]),
  });
  assert.deepEqual(filtered.map((p) => p.nearby_master_id), ["p2", "p4", "p5"]);
});

test("empty category filter shows everything (no accidental narrowing)", () => {
  const filtered = filterAreaListCandidates(SAMPLE, {
    nameQuery: "",
    categoryKeys: new Set(),
    activeMemberIds: new Set(),
  });
  assert.equal(filtered.length, SAMPLE.length);
});

test("type options are the present vocabulary, sorted, Uncategorized last", () => {
  assert.deepEqual(areaListCandidateTypeOptions(SAMPLE), [
    { key: FUEL, label: "Fuel" },
    { key: GROCERY, label: "Grocery" },
    { key: UNCATEGORIZED_KEY, label: UNCATEGORIZED_LABEL },
  ]);
});

test("Select all targets exactly the current filtered result set", () => {
  const filtered = filterAreaListCandidates(SAMPLE, {
    nameQuery: "",
    categoryKeys: new Set([GROCERY]),
    activeMemberIds: new Set(["p1"]),
  });
  assert.deepEqual(selectableAreaListCandidateIds(filtered).sort(), ["p2", "p5"]);
});

test("selection is pruned to the filtered set so a hidden row can never be batch-added", () => {
  const filtered = filterAreaListCandidates(SAMPLE, {
    nameQuery: "gulf",
    categoryKeys: new Set(),
    activeMemberIds: new Set(),
  });
  const pruned = pruneSelectionToFiltered(new Set(["p1", "p3", "p5"]), filtered);
  assert.deepEqual([...pruned], ["p3"]);
});
