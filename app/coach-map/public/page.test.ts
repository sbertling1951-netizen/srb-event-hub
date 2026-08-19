import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Coach Map's Event-resolution branch.
// Authenticated Members resolve Event context through canonical
// Person/Participation continuity (get_my_member_event_continuity_context).
// Temporary Event Access sets the same local memberEvent context but never
// creates a Supabase session and holds no Participation link -- that RPC
// is not anon-executable, so the RPC choice is gated on an actual session
// check rather than on memberEvent presence alone. Same defect and fix
// pattern as the Nearby (d36ad11), Locations (5fc355e), and /map (dc72034)
// reconciliations; live grant/RPC-body evidence is reported separately,
// not re-asserted here.
//
// Run with:
//   npx tsx --test app/coach-map/public/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Event continuity RPC choice is gated on a real Supabase session, not on memberEvent presence alone", () => {
  assert.match(SOURCE, /supabase\.auth\.getSession\(\)/);

  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const continuityRpcVarIndex = SOURCE.indexOf("continuityRpc");
  assert.ok(sessionCheckIndex >= 0 && continuityRpcVarIndex > sessionCheckIndex);

  const between = SOURCE.slice(sessionCheckIndex, continuityRpcVarIndex + 200);
  assert.match(between, /sessionData\?\.session/);
  assert.match(between, /"get_my_member_event_continuity_context"/);
  assert.match(between, /"get_event_continuity_context"/);
});

test("the RPC call itself uses the chosen continuityRpc variable, not a hardcoded RPC name", () => {
  assert.match(
    SOURCE,
    /supabase\s*\n?\s*\.rpc\(continuityRpc,\s*\{\s*p_event_id:\s*memberEvent\.id\s*\}\)/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no visibility/lifecycle predicate is applied client-side to the continuity result", () => {
  const rpcCallStart = SOURCE.indexOf(".rpc(continuityRpc,");
  const rpcCallEnd = SOURCE.indexOf(";", rpcCallStart);
  const rpcCall = SOURCE.slice(rpcCallStart, rpcCallEnd);
  assert.doesNotMatch(rpcCall, /visible_to_members/);
  assert.doesNotMatch(rpcCall, /is_active/);
  assert.doesNotMatch(rpcCall, /\.eq\(/);
});

test("map fields/scaling behavior are preserved: map_image_url/master_map_id resolution and coach_map_open_scale still flow from the loaded row", () => {
  assert.match(SOURCE, /loadedEvent\.master_map_id/);
  assert.match(SOURCE, /loadedEvent\.map_image_url/);
  assert.match(SOURCE, /loadedEvent\.coach_map_open_scale/);
});

test("the known-id fallback shape (no row found) is unchanged", () => {
  assert.match(SOURCE, /const loadedEvent = \(eventRow as MemberEventRow \| null\) \|\| \{/);
});

test("downstream map RPCs (site geometry, participant roster) are untouched", () => {
  assert.match(SOURCE, /\.rpc\("get_event_public_map_sites",/);
  assert.match(SOURCE, /\.rpc\("get_event_participant_map_roster",/);
});
