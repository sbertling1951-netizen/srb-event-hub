import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildAnnouncementsSlice } from "@/lib/experienceContext/providers/announcementsProvider";

// Focused tests for the second bounded Provider / Intelligence Collector
// conformance pass (announcementsProvider). See
// docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md.
//
// These exercise buildAnnouncementsSlice directly -- the pure, I/O-free
// portion of the Provider -- rather than the exported `collect()`
// wrapper, which requires a live Supabase client. Run with:
//   npx tsx --test lib/experienceContext/providers/announcementsProvider.test.ts

const NOW = new Date("2026-08-07T12:00:00.000");

test("successful collection: reports the supplied count with evidenceQuality governed", () => {
  const slice = buildAnnouncementsSlice(3, NOW);

  assert.equal(slice.activeCount, 3);
  assert.equal(slice.evidenceQuality, "governed");
});

test("zero announcements is a governed-confirmed result, not unavailable", () => {
  const slice = buildAnnouncementsSlice(0, NOW);

  assert.equal(slice.activeCount, 0);
  assert.equal(slice.evidenceQuality, "governed");
});

test("deterministic Evidence Quality: same input always produces the same classification", () => {
  const first = buildAnnouncementsSlice(5, NOW);
  const second = buildAnnouncementsSlice(5, NOW);

  assert.deepEqual(first, second);
  assert.equal(first.evidenceQuality, "governed");
  assert.equal(second.evidenceQuality, "governed");
});

test("freshness: observedAt is sourced from the supplied collection time, not the wall clock", () => {
  const earlier = new Date("2026-08-07T09:00:00.000");
  const later = new Date("2026-08-07T15:00:00.000");

  const sliceAtEarlier = buildAnnouncementsSlice(2, earlier);
  const sliceAtLater = buildAnnouncementsSlice(2, later);

  assert.equal(sliceAtEarlier.observedAt, earlier.toISOString());
  assert.equal(sliceAtLater.observedAt, later.toISOString());
  assert.notEqual(sliceAtEarlier.observedAt, sliceAtLater.observedAt);
});

test("no write/mutation behavior: the provider source issues no insert, update, delete, upsert, or rpc call", () => {
  const sourcePath = fileURLToPath(
    new URL("./announcementsProvider.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]) {
    assert.ok(
      !source.includes(forbidden),
      `announcementsProvider.ts must not call ${forbidden} -- Providers are read-only`,
    );
  }
});
