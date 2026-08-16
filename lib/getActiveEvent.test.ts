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

test("known-id branch (memberEvent.id present) uses participation-bound Member continuity", () => {
  const knownIdBranch = SOURCE.slice(
    SOURCE.indexOf("if (memberEvent?.id)"),
    SOURCE.indexOf("// Active-event fallback branch"),
  );
  assert.match(
    knownIdBranch,
    /supabase\s*\n?\s*\.rpc\("get_my_member_event_continuity_context",\s*\{\s*p_event_id:\s*memberEvent\.id\s*\}\)/,
  );
  assert.doesNotMatch(knownIdBranch, /\.from\("events"\)/);
  assert.doesNotMatch(knownIdBranch, /get_event_continuity_context/);
});

test("missing Member context returns no Event rather than a global fallback", () => {
  assert.match(SOURCE, /return null;/);
  assert.doesNotMatch(SOURCE, /get_current_active_event/);
  assert.doesNotMatch(SOURCE, /get_public_discoverable_events/);
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
