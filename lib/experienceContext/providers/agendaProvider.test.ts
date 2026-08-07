import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type AgendaRow,
  computeAgendaSlice,
} from "@/lib/experienceContext/providers/agendaProvider";

// Focused tests for the first bounded Provider / Intelligence Collector
// refactor (agendaProvider). See
// docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md.
//
// These exercise computeAgendaSlice directly -- the pure, I/O-free
// portion of the Provider -- rather than the exported `collect()`
// wrapper, which requires a live Supabase client. Run with:
//   npx tsx --test lib/experienceContext/providers/agendaProvider.test.ts

// No trailing "Z": agendaProvider's toDateTime() parses agenda_date +
// start_time/end_time as local time (unchanged, pre-existing behavior),
// so NOW must be constructed the same way to compare correctly
// regardless of which timezone the test happens to run in.
const NOW = new Date("2026-08-07T12:00:00.000");

function row(overrides: Partial<AgendaRow> & { id: string }): AgendaRow {
  return {
    title: "Session",
    agenda_date: "2026-08-07",
    start_time: null,
    end_time: null,
    ...overrides,
  };
}

test("successful collection: identifies current and next items, evidenceQuality is governed", () => {
  const rows: AgendaRow[] = [
    row({
      id: "a",
      title: "Morning Ride",
      start_time: "10:00:00",
      end_time: "11:00:00",
    }), // past relative to NOW (12:00)
    row({
      id: "b",
      title: "Lunch Talk",
      start_time: "11:30:00",
      end_time: "12:30:00",
    }), // now
    row({
      id: "c",
      title: "Afternoon Workshop",
      start_time: "14:00:00",
      end_time: "15:00:00",
    }), // upcoming
    row({
      id: "d",
      title: "Evening Social",
      start_time: "18:00:00",
      end_time: "19:00:00",
    }), // upcoming, later
  ];

  const slice = computeAgendaSlice(rows, NOW);

  assert.equal(slice.currentItem?.id, "b");
  assert.equal(slice.nextItem?.id, "c");
  assert.equal(slice.evidenceQuality, "governed");
});

test("successful collection: zero rows is a governed-confirmed empty agenda, not unavailable", () => {
  const slice = computeAgendaSlice([], NOW);

  assert.equal(slice.currentItem, null);
  assert.equal(slice.nextItem, null);
  assert.equal(slice.evidenceQuality, "governed");
});

test("deterministic Evidence Quality and freshness: same input always produces the same output", () => {
  const rows: AgendaRow[] = [
    row({ id: "a", start_time: "14:00:00", end_time: "15:00:00" }),
  ];

  const first = computeAgendaSlice(rows, NOW);
  const second = computeAgendaSlice(rows, NOW);

  assert.deepEqual(first, second);
  assert.equal(first.evidenceQuality, "governed");
  assert.equal(second.evidenceQuality, "governed");
});

test("freshness: observedAt is sourced from the supplied collection time, not the wall clock", () => {
  const rows: AgendaRow[] = [
    row({ id: "a", start_time: "14:00:00", end_time: "15:00:00" }),
  ];

  const earlier = new Date("2026-08-07T09:00:00.000");
  const later = new Date("2026-08-07T15:00:00.000");

  const sliceAtEarlier = computeAgendaSlice(rows, earlier);
  const sliceAtLater = computeAgendaSlice(rows, later);

  assert.equal(sliceAtEarlier.observedAt, earlier.toISOString());
  assert.equal(sliceAtLater.observedAt, later.toISOString());
  assert.notEqual(sliceAtEarlier.observedAt, sliceAtLater.observedAt);
});

test("no governed basis to deduplicate: rows with identical content but different ids are both preserved, never merged", () => {
  // Deliberately not sorted by id -- "zzz-array-first" is lexicographically
  // last but appears first in the array. If this Provider still applied a
  // lowest-id-wins merge (the removed, unevidenced heuristic), the result
  // would be "aaa-array-second" regardless of array order. Preserving
  // array order here demonstrates no merge occurred at all: both rows
  // remain distinct candidates, and the classification/sort pipeline
  // (stable sort) picks whichever the source actually returned first.
  const rows: AgendaRow[] = [
    row({
      id: "zzz-array-first",
      title: "Repeated-Looking Session",
      start_time: "14:00:00",
      end_time: "15:00:00",
    }),
    row({
      id: "aaa-array-second",
      title: "Repeated-Looking Session",
      start_time: "14:00:00",
      end_time: "15:00:00",
    }),
  ];

  const slice = computeAgendaSlice(rows, NOW);

  assert.equal(slice.nextItem?.id, "zzz-array-first");
});

test("two independent agenda items are never treated as conflicting merely because title and scheduled start time match", () => {
  const rows: AgendaRow[] = [
    row({
      id: "a",
      title: "Parallel Track",
      start_time: "14:00:00",
      end_time: "15:00:00",
    }),
    row({
      id: "b",
      title: "Parallel Track",
      start_time: "14:00:00",
      end_time: "16:00:00", // genuinely different -- not a "conflict"
    }),
  ];

  // Must not throw. Neither row is preferred over the other by content;
  // whichever the source returns first is used, exactly as any other
  // pair of distinct rows would be.
  assert.doesNotThrow(() => computeAgendaSlice(rows, NOW));
});

test("no mutation: computeAgendaSlice never modifies its input", () => {
  const rows: AgendaRow[] = [
    row({ id: "a", start_time: "14:00:00", end_time: "15:00:00" }),
    row({ id: "b", start_time: "16:00:00", end_time: "17:00:00" }),
  ];
  const frozen = Object.freeze(rows.map((r) => Object.freeze({ ...r })));

  // Object.freeze causes a TypeError on write in strict mode; simply not
  // throwing here demonstrates the function attempted no write to the
  // rows or their elements.
  assert.doesNotThrow(() => computeAgendaSlice(frozen, NOW));
});

test("no write/mutation behavior: the provider source issues no insert, update, delete, upsert, or rpc call", () => {
  const sourcePath = fileURLToPath(
    new URL("./agendaProvider.ts", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]) {
    assert.ok(
      !source.includes(forbidden),
      `agendaProvider.ts must not call ${forbidden} -- Providers are read-only`,
    );
  }
});
