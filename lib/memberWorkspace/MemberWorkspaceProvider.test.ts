import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Member Event Context Stage 2's
// established-context validation state machine: race safety, no silent
// fallback, and Temporary Event Access isolation.
//
// Run with:
//   npx tsx --test lib/memberWorkspace/MemberWorkspaceProvider.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./MemberWorkspaceProvider.tsx", import.meta.url)),
  "utf8",
);
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, "");

test("Temporary Event Access (no Account session) never triggers governed validation", () => {
  assert.match(
    CODE,
    /if \(workspace\.isAccountSession !== true\) \{\s*\n\s*return;\s*\n\s*\}/,
  );
});

test("validation is scoped to Member routes only", () => {
  assert.match(CODE, /if \(!pathname\.startsWith\("\/member"\)\) \{\s*\n\s*return;\s*\n\s*\}/);
});

test("dedup window prevents re-validating the same Event within the interval", () => {
  assert.match(CODE, /const MIN_REVALIDATE_INTERVAL_MS = 30_000;/);
  assert.match(CODE, /withinDedupWindow/);
});

test("race safety: a generation counter and AbortController guard every validation", () => {
  assert.match(CODE, /const validationSeqRef = useRef\(0\);/);
  assert.match(CODE, /const seq = \+\+validationSeqRef\.current;/);
  assert.match(CODE, /abortRef\.current\?\.abort\(\);/);
  assert.match(CODE, /if \(seq !== validationSeqRef\.current\) \{\s*\n\s*return;/);
});

test("late responses re-derive the current session at apply time instead of trusting the closure-captured Event id", () => {
  assert.match(
    CODE,
    /const currentSession = getMemberSession\(\);\s*\n\s*\n\s*if \(!currentSession \|\| currentSession\.event_id !== eventId\) \{\s*\n\s*return;/,
  );
  // The "valid" branch re-checks a second time immediately before writing
  // state, closing the window between the first check and the setState.
  const validIdx = CODE.indexOf('if (result.state === "valid")');
  const setterSlice = CODE.slice(validIdx, validIdx + 600);
  assert.match(setterSlice, /if \(getMemberSession\(\)\?\.event_id !== eventId\) \{\s*\n\s*return prev;/);
});

test("no silent fallback: an invalid outcome clears local state and routes to account/login, never to a substitute Event id", () => {
  assert.match(CODE, /clearMemberLocalState\(\);/);
  assert.match(CODE, /"\/member\/account\?contextInvalid=1"/);
  assert.match(CODE, /"\/member\/login"/);
  // No call that could hand back a different, unrequested Event.
  assert.equal(/getActiveEvent|get_public_discoverable_events|resolve_member_account/.test(CODE), false);
});

test("a transient validation failure preserves cached state instead of being treated as revocation", () => {
  assert.match(
    CODE,
    /if \(result\.state === "error"\) \{[\s\S]{0,400}?setWorkspace\(\(prev\) => \(\{ \.\.\.prev, contextStatus: "error" \}\)\);/,
  );
});

test("canonical server-returned Event data becomes the live workspace representation on valid", () => {
  assert.match(CODE, /id: validated\.id,/);
  assert.match(CODE, /name: validated\.name,/);
});

test("localStorage read remains the immediate bootstrap source, not the final authority", () => {
  assert.match(CODE, /function readSnapshot\(/);
  assert.match(CODE, /contextStatus: "checking"/);
});
