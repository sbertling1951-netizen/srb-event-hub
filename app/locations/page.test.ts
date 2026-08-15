import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertion proving app/locations/page.tsx was left
// intentionally unchanged in Stage 2. Its is_active-only predicate
// differs from the canonical public-discovery rule
// (get_public_discoverable_events), and reconciling that difference is
// an unresolved, separate product decision -- not made in this stage.
//
// Run with:
//   npx tsx --test app/locations/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("still reads public.events directly by is_active, not the discovery RPC", () => {
  assert.match(SOURCE, /\.from\("events"\)/);
  assert.match(SOURCE, /\.eq\("is_active", true\)/);
  assert.doesNotMatch(SOURCE, /get_public_discoverable_events/);
  assert.doesNotMatch(SOURCE, /get_event_continuity_context/);
});
