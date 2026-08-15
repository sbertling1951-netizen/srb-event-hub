import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for getActiveEvent's two branches: the
// known-id branch uses the governed Known-Context Event Continuity RPC;
// the active-event fallback branch now uses the governed
// get_current_active_event() bootstrap RPC (ADR-006 §3.2), which
// preserves the same is_active-only predicate this branch's direct table
// read used previously -- reconciling that predicate with the canonical
// public-discovery rule remains an unresolved, separate product decision,
// not made here.
//
// Run with:
//   npx tsx --test lib/getActiveEvent.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./getActiveEvent.ts", import.meta.url)),
  "utf8",
);

test("known-id branch (memberEvent.id present) uses the continuity RPC", () => {
  const knownIdBranch = SOURCE.slice(
    SOURCE.indexOf("if (memberEvent?.id)"),
    SOURCE.indexOf("// Active-event fallback branch"),
  );
  assert.match(
    knownIdBranch,
    /supabase\s*\n?\s*\.rpc\("get_event_continuity_context",\s*\{\s*p_event_id:\s*memberEvent\.id\s*\}\)/,
  );
  assert.doesNotMatch(knownIdBranch, /\.from\("events"\)/);
});

test("active-event fallback branch uses get_current_active_event(), not a direct table read", () => {
  // Slice from the closing brace of the known-id branch, not the
  // preceding explanatory comment (which itself names
  // "get_public_discoverable_events"/"visible_to_members" only to
  // describe why they're deliberately absent from the code below).
  const activeBranch = SOURCE.slice(SOURCE.indexOf('const { data, error } = await supabase\n    .rpc("get_current_active_event")'));
  assert.match(activeBranch, /\.rpc\("get_current_active_event"\)/);
  assert.match(activeBranch, /\.limit\(1\)/);
  assert.match(activeBranch, /\.maybeSingle\(\)/);
  assert.doesNotMatch(activeBranch, /\.from\("events"\)/);
  assert.doesNotMatch(activeBranch, /get_public_discoverable_events/);
  assert.doesNotMatch(activeBranch, /visible_to_members/);
});

test("the two branches remain mutually exclusive on memberEvent?.id, matching the pre-Stage-2 control flow", () => {
  assert.match(SOURCE, /if \(memberEvent\?\.id\) \{/);
});

test("ActiveEvent return shape is unchanged", () => {
  const typeBlock = SOURCE.slice(SOURCE.indexOf("export type ActiveEvent"), SOURCE.indexOf("export async function"));
  for (const field of ["id", "name", "location", "start_date", "end_date", "map_image_url", "master_map_id"]) {
    assert.match(typeBlock, new RegExp(`\\b${field}\\b`));
  }
});
