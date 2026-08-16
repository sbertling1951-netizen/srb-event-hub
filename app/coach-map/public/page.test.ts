import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Coach Map's Member-workspace-bound,
// participation-authorized continuity read. Route naming does not make this
// an anonymous public-continuity consumer.
//
// Run with:
//   npx tsx --test app/coach-map/public/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Event read uses Member continuity by known id, not a direct/public events read", () => {
  assert.match(
    SOURCE,
    /supabase\s*\n?\s*\.rpc\("get_my_member_event_continuity_context",\s*\{\s*p_event_id:\s*memberEvent\.id\s*\}\)/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no visibility/lifecycle predicate is applied client-side to the continuity result", () => {
  const rpcCallStart = SOURCE.indexOf('.rpc("get_my_member_event_continuity_context"');
  const rpcCallEnd = SOURCE.indexOf(";", rpcCallStart);
  const rpcCall = SOURCE.slice(rpcCallStart, rpcCallEnd);
  assert.doesNotMatch(rpcCall, /visible_to_members/);
  assert.doesNotMatch(rpcCall, /is_active/);
  assert.doesNotMatch(rpcCall, /\.eq\(/);
  assert.doesNotMatch(SOURCE, /get_event_continuity_context/);
});

test("map fields/scaling behavior are preserved: map_image_url/master_map_id resolution and coach_map_open_scale still flow from the loaded row", () => {
  assert.match(SOURCE, /loadedEvent\.master_map_id/);
  assert.match(SOURCE, /loadedEvent\.map_image_url/);
  assert.match(SOURCE, /loadedEvent\.coach_map_open_scale/);
});

test("the known-id fallback shape (no row found) is unchanged", () => {
  assert.match(SOURCE, /const loadedEvent = \(eventRow as MemberEventRow \| null\) \|\| \{/);
});
