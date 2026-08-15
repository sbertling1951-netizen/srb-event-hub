import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Stage 2's migration of member
// activation's event picker to the governed Public Event Discovery RPC.
//
// Run with:
//   npx tsx --test app/member/activate/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("activation-eligible event list uses the public discovery RPC, not a direct events table read", () => {
  assert.match(SOURCE, /supabase\s*\.rpc\(\s*\n?\s*"get_public_discoverable_events",?\s*\n?\s*\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no client-side re-filtering of the RPC's already-enforced visibility predicate", () => {
  assert.doesNotMatch(SOURCE, /isMemberVisibleEvent/);
  assert.doesNotMatch(SOURCE, /eventStatus/);
});

test("EventRow no longer carries visibility/lifecycle fields the RPC doesn't return", () => {
  const typeBlock = SOURCE.slice(SOURCE.indexOf("type EventRow"), SOURCE.indexOf("const inputStyle"));
  assert.doesNotMatch(typeBlock, /visible_to_members/);
  assert.doesNotMatch(typeBlock, /\bstatus\b/);
  assert.doesNotMatch(typeBlock, /is_active/);
  assert.doesNotMatch(typeBlock, /event_code/);
});

test("no public event_code is requested or displayed anywhere on this page", () => {
  assert.doesNotMatch(SOURCE, /event_code/);
});

test("display-ordering behavior (most recent first) is preserved via an explicit .order() on the RPC result", () => {
  assert.match(SOURCE, /\.rpc\(\s*\n?\s*"get_public_discoverable_events",?\s*\n?\s*\)\s*\n?\s*\.order\("start_date",\s*\{\s*ascending:\s*false/);
});

test("identity-claim evaluation flow (event selection, evidence submission) is unchanged", () => {
  assert.match(SOURCE, /selectedEventIds/);
  assert.match(SOURCE, /\/api\/member\/identity-claim\/evaluate/);
});
