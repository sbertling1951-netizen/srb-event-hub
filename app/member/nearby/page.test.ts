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
