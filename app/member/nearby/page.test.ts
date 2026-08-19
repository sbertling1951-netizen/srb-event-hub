import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Member Nearby's participation-bound
// known-Event-ID continuity read.
//
// Run with:
//   npx tsx --test app/member/nearby/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Event read uses Member continuity by known id, not a direct/public events read", () => {
  assert.match(
    SOURCE,
    /supabase\s*\n?\s*\.rpc\("get_my_member_event_continuity_context",\s*\{\s*p_event_id:\s*eventId\s*\}\)/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no visible_to_members/is_active/status predicate is forced onto this read", () => {
  const rpcCallStart = SOURCE.indexOf('.rpc("get_my_member_event_continuity_context"');
  const rpcCallEnd = SOURCE.indexOf(";", rpcCallStart);
  const rpcCall = SOURCE.slice(rpcCallStart, rpcCallEnd);
  assert.doesNotMatch(rpcCall, /visible_to_members/);
  assert.doesNotMatch(rpcCall, /is_active/);
  assert.doesNotMatch(rpcCall, /\.eq\(/);
  assert.doesNotMatch(SOURCE, /get_event_continuity_context/);
});

test("existing Event-context behavior (workspaceEvent fallback, EventRow cast) is preserved", () => {
  assert.match(SOURCE, /const eventInfo: EventRow = eventRow/);
  assert.match(SOURCE, /workspaceEvent\.id/);
});

test("get_my_member_event_continuity_context is only called for a real authenticated Supabase session, not unconditionally", () => {
  // Temporary Event Access never creates a Supabase session and stays
  // anon, which does not hold EXECUTE on this authenticated-only RPC --
  // calling it unconditionally throws for that caller before Nearby data
  // ever loads. Gating on an actual session (not just local
  // workspaceEvent/attendee presence, which Temporary Event Access also
  // sets) is what distinguishes the two paths.
  assert.match(SOURCE, /supabase\.auth\.getSession\(\)/);

  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const rpcCallIndex = SOURCE.indexOf(
    '.rpc("get_my_member_event_continuity_context"',
  );
  assert.ok(sessionCheckIndex >= 0 && rpcCallIndex > sessionCheckIndex);

  const ifGuardStart = SOURCE.lastIndexOf("if (", rpcCallIndex);
  const guardCondition = SOURCE.slice(
    ifGuardStart,
    SOURCE.indexOf(")", ifGuardStart) + 1,
  );
  assert.match(guardCondition, /sessionData\?\.session/);
});

test("resolve_effective_nearby_places call is not itself gated behind the authenticated-session check", () => {
  // The Nearby data RPC is the accepted anon-reachable Temporary Event
  // Access path (event-scoped, is_hidden-filtered) -- only the
  // Participation-continuity RPC above requires a real session.
  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const nearbyRpcIndex = SOURCE.indexOf(
    '.rpc("resolve_effective_nearby_places"',
  );
  assert.ok(nearbyRpcIndex > sessionCheckIndex);

  const between = SOURCE.slice(sessionCheckIndex, nearbyRpcIndex);
  // Exactly one open brace net of the continuity-RPC `if` block should
  // have closed by the time resolve_effective_nearby_places is reached --
  // i.e. that call sits back at the outer try-block level, not still
  // nested inside `if (sessionData?.session) { ... }`.
  const opens = (between.match(/\{/g) || []).length;
  const closes = (between.match(/\}/g) || []).length;
  assert.equal(opens, closes);
});
