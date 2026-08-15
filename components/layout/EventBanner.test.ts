import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions proving EventBanner.tsx now reads its
// active Event through the governed get_current_active_event() bootstrap
// RPC (ADR-006 §3.2) instead of a direct public.events table read, while
// preserving its is_active semantics, start_date DESC NULLS LAST
// selection, and limit(1)/maybeSingle() behavior. is_master_map=false is
// deliberately NOT reproduced -- live evidence (2026-08-14) showed it
// currently distinguishes zero rows against the one live
// is_master_map=true row, which is already excluded by is_active=false.
//
// Run with:
//   npx tsx --test components/layout/EventBanner.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./EventBanner.tsx", import.meta.url)),
  "utf8",
);

test("reads the active event via get_current_active_event(), not a direct table read", () => {
  assert.match(SOURCE, /\.rpc\("get_current_active_event"\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("start_date DESC NULLS LAST ordering is preserved as a caller-side modifier", () => {
  assert.match(
    SOURCE,
    /\.order\("start_date",\s*\{\s*ascending:\s*false,\s*nullsFirst:\s*false\s*\}\)/,
  );
});

test("limit(1).maybeSingle() is preserved", () => {
  assert.match(SOURCE, /\.limit\(1\)/);
  assert.match(SOURCE, /\.maybeSingle\(\)/);
});

test("is_master_map is no longer filtered", () => {
  // The explanatory comment naming is_master_map (to record why it's
  // deliberately absent) is expected and fine; only the removed
  // .eq("is_master_map", ...) predicate itself must be gone.
  assert.doesNotMatch(SOURCE, /\.eq\("is_master_map"/);
});

test("polling/focus/visibility/storage refresh wiring is unchanged", () => {
  assert.match(SOURCE, /window\.setInterval\(/);
  assert.match(SOURCE, /addEventListener\("focus"/);
  assert.match(SOURCE, /addEventListener\("visibilitychange"/);
  assert.match(SOURCE, /addEventListener\("storage"/);
});

test("rendered fields are unchanged: name, location, formatted date range", () => {
  assert.match(SOURCE, /event\.name/);
  assert.match(SOURCE, /event\.location/);
  assert.match(SOURCE, /formatDateRange\(event\.start_date, event\.end_date\)/);
});
