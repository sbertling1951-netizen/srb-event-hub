import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildVendorRequestsSlice } from "@/lib/experienceContext/providers/vendorRequestsProvider";

// Focused tests for the fourth bounded Provider / Intelligence Collector
// conformance pass (vendorRequestsProvider). See
// docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md and
// docs/architecture/EPICENTRAX_MEMBER_VENDOR_REQUEST boundary migrations
// (supabase/migrations/20260807120000_create_governed_member_vendor_
// request_read.sql).
//
// These exercise buildVendorRequestsSlice directly -- the pure, I/O-free
// portion of the Provider -- rather than the exported `collect()` wrapper,
// which requires a live Supabase/fetch call. Run with:
//   npx tsx --test lib/experienceContext/providers/vendorRequestsProvider.test.ts

const NOW = new Date("2026-08-07T12:00:00.000");

test("successful governed collection: openCount excludes closed statuses, evidenceQuality governed", () => {
  const slice = buildVendorRequestsSlice(
    [
      { request_status: "new" },
      { request_status: "completed" },
      { request_status: "cancelled" },
      { request_status: "in_progress" },
    ],
    NOW,
  );

  assert.equal(slice.openCount, 2);
  assert.equal(slice.evidenceQuality, "governed");
  assert.equal(slice.observedAt, NOW.toISOString());
});

test("governed-confirmed zero: an empty authoritative result is 0, not unavailable", () => {
  const slice = buildVendorRequestsSlice([], NOW);

  assert.equal(slice.openCount, 0);
  assert.equal(slice.evidenceQuality, "governed");
  assert.equal(slice.observedAt, NOW.toISOString());
});

test("null request_status defaults to open (matches the pre-existing filter semantics)", () => {
  const slice = buildVendorRequestsSlice([{ request_status: null }], NOW);

  assert.equal(slice.openCount, 1);
  assert.equal(slice.evidenceQuality, "governed");
});

test("deterministic Evidence Quality: same input always produces the same classification", () => {
  const rows = [{ request_status: "new" }];

  const first = buildVendorRequestsSlice(rows, NOW);
  const second = buildVendorRequestsSlice(rows, NOW);

  assert.deepEqual(first, second);
  assert.equal(first.evidenceQuality, "governed");
});

test("freshness: observedAt is sourced from the supplied collection time, not the wall clock", () => {
  const earlier = new Date("2026-08-07T09:00:00.000");
  const later = new Date("2026-08-07T15:00:00.000");

  const sliceAtEarlier = buildVendorRequestsSlice([], earlier);
  const sliceAtLater = buildVendorRequestsSlice([], later);

  assert.equal(sliceAtEarlier.observedAt, earlier.toISOString());
  assert.equal(sliceAtLater.observedAt, later.toISOString());
  assert.notEqual(sliceAtEarlier.observedAt, sliceAtLater.observedAt);
});

test("no invented deduplication: distinct request rows are all counted, none dropped or merged", () => {
  // public.vendor_service_requests enforces `id uuid PRIMARY KEY`, so the
  // authoritative array this Provider receives can never contain two rows
  // representing the same request fact. This Provider must not, and does
  // not, apply any grouping/merging of its own.
  const slice = buildVendorRequestsSlice(
    [
      { request_status: "new" },
      { request_status: "new" },
      { request_status: "new" },
    ],
    NOW,
  );

  assert.equal(slice.openCount, 3);
});

test("no write/mutation behavior: the provider source issues no insert, update, delete, upsert, or rpc call", () => {
  const sourcePath = fileURLToPath(
    new URL("./vendorRequestsProvider.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]) {
    assert.ok(
      !source.includes(forbidden),
      `vendorRequestsProvider.ts must not call ${forbidden} -- Providers are read-only`,
    );
  }
});
