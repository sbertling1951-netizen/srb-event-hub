import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildAssignmentsSlice } from "@/lib/experienceContext/providers/assignmentsProvider";

// Focused tests for the third bounded Provider / Intelligence Collector
// conformance pass (assignmentsProvider). See
// docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md and
// docs/architecture/EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_
// ARCHITECTURE.md.
//
// These exercise buildAssignmentsSlice directly -- the pure, I/O-free
// portion of the Provider -- rather than the exported `collect()`
// wrapper, which requires a live Supabase/fetch call. Run with:
//   npx tsx --test lib/experienceContext/providers/assignmentsProvider.test.ts

const NOW = new Date("2026-08-07T12:00:00.000");

test("successful governed collection: activeCount matches the authoritative result exactly, evidenceQuality governed", () => {
  const slice = buildAssignmentsSlice(
    {
      status: "resolved",
      assignments: [
        { id: "a", responsibilityLabel: "Parking", attributedAt: "2026-08-01T00:00:00.000Z" },
        { id: "b", responsibilityLabel: "Check-in", attributedAt: "2026-08-02T00:00:00.000Z" },
      ],
    },
    NOW,
  );

  assert.equal(slice.activeCount, 2);
  assert.equal(slice.evidenceQuality, "governed");
  assert.equal(slice.observedAt, NOW.toISOString());
});

test("preservation of authoritative results: a governed-confirmed zero is 0, not unavailable", () => {
  const slice = buildAssignmentsSlice({ status: "resolved", assignments: [] }, NOW);

  assert.equal(slice.activeCount, 0);
  assert.equal(slice.evidenceQuality, "governed");
});

test("identity_unavailable: a governed but incomplete observation is 'partial', never 'unavailable' or a fabricated zero", () => {
  const slice = buildAssignmentsSlice({ status: "identity_unavailable" }, NOW);

  assert.equal(slice.activeCount, null);
  // "unavailable" means "not collected at all this pass"
  // (EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md). This read DID
  // happen and DID reach the governed boundary -- it just could not
  // resolve the sub-fact (identity) required to produce a count. That is
  // the architecture's own definition of "partial", not "unavailable".
  assert.equal(slice.evidenceQuality, "partial");
  // Something WAS observed at this moment -- unlike the base default
  // (see defaults.test.ts, which is reserved for a genuine Provider
  // failure where nothing was collected), identity_unavailable is a
  // governed 200 response, so observedAt records the real observation
  // time.
  assert.equal(slice.observedAt, NOW.toISOString());
});

test("deterministic Evidence Quality: same input always produces the same classification", () => {
  const payload = {
    status: "resolved" as const,
    assignments: [{ id: "a", responsibilityLabel: "Parking", attributedAt: "2026-08-01T00:00:00.000Z" }],
  };

  const first = buildAssignmentsSlice(payload, NOW);
  const second = buildAssignmentsSlice(payload, NOW);

  assert.deepEqual(first, second);
  assert.equal(first.evidenceQuality, "governed");
});

test("freshness: observedAt is sourced from the supplied collection time, not the wall clock", () => {
  const earlier = new Date("2026-08-07T09:00:00.000");
  const later = new Date("2026-08-07T15:00:00.000");
  const payload = { status: "resolved" as const, assignments: [] };

  const sliceAtEarlier = buildAssignmentsSlice(payload, earlier);
  const sliceAtLater = buildAssignmentsSlice(payload, later);

  assert.equal(sliceAtEarlier.observedAt, earlier.toISOString());
  assert.equal(sliceAtLater.observedAt, later.toISOString());
  assert.notEqual(sliceAtEarlier.observedAt, sliceAtLater.observedAt);
});

test("no invented deduplication: distinct assignment ids are all counted, none dropped or merged", () => {
  // public.assignments enforces UNIQUE (person_id, responsibility_id,
  // event_id) WHERE status = 'active' at the database layer, so the
  // authoritative array this Provider receives can never contain two
  // rows representing the same fact. This Provider must not, and does
  // not, apply any grouping/merging of its own -- the count is a direct
  // pass-through of the array length.
  const slice = buildAssignmentsSlice(
    {
      status: "resolved",
      assignments: [
        { id: "a", responsibilityLabel: "Parking", attributedAt: "2026-08-01T00:00:00.000Z" },
        { id: "b", responsibilityLabel: "Parking", attributedAt: "2026-08-01T00:00:00.000Z" },
        { id: "c", responsibilityLabel: "Check-in", attributedAt: "2026-08-02T00:00:00.000Z" },
      ],
    },
    NOW,
  );

  assert.equal(slice.activeCount, 3);
});

test("no write/mutation behavior: the provider source issues no insert, update, delete, upsert, or rpc call", () => {
  const sourcePath = fileURLToPath(
    new URL("./assignmentsProvider.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]) {
    assert.ok(
      !source.includes(forbidden),
      `assignmentsProvider.ts must not call ${forbidden} -- Providers are read-only`,
    );
  }
});
