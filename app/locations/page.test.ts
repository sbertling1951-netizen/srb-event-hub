import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertion proving app/locations/page.tsx now reads its
// active Event through the governed get_current_active_event() bootstrap
// RPC (ADR-006 §3.2) instead of a direct public.events table read. The
// RPC preserves the same is_active-only predicate this page's direct read
// used previously; reconciling that predicate with the canonical
// public-discovery rule (get_public_discoverable_events) remains an
// unresolved, separate product decision -- not made here.
//
// Run with:
//   npx tsx --test app/locations/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("reads the active event via get_current_active_event(), not a direct table read", () => {
  assert.match(SOURCE, /\.rpc\("get_current_active_event"\)/);
  assert.match(SOURCE, /\.limit\(1\)/);
  assert.match(SOURCE, /\.maybeSingle\(\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
  assert.doesNotMatch(SOURCE, /get_public_discoverable_events/);
  assert.doesNotMatch(SOURCE, /get_event_continuity_context/);
});
