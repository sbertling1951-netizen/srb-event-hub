import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertion proving MemberShellAdapter.tsx's
// compact-name read now uses the governed Known-Context Event Continuity
// RPC (get_event_continuity_context, ADR-006 §4) for its already-resolved
// Event id, instead of a direct public.events table read -- the same
// migration already applied to Nearby's and coach-map's own reads of the
// same RPC.
//
// Run with:
//   npx tsx --test components/shell/adapters/MemberShellAdapter.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./MemberShellAdapter.tsx", import.meta.url)),
  "utf8",
);

test("compact-name effect uses get_event_continuity_context keyed on event.id, not a direct table read", () => {
  assert.match(
    SOURCE,
    /\.rpc\("get_event_continuity_context",\s*\{\s*p_event_id:\s*event\.id\s*\}\)/,
  );
  assert.match(SOURCE, /\.maybeSingle\(\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("compact name is still read from the RPC row's short_name field, unchanged", () => {
  assert.match(SOURCE, /row\?\.short_name \?\? null/);
});

test("no member-discovery filtering (visible_to_members/status) is introduced", () => {
  assert.doesNotMatch(SOURCE, /visible_to_members/);
  assert.doesNotMatch(SOURCE, /get_public_discoverable_events/);
});
