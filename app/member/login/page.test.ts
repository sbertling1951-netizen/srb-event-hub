import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Stage 2's migration of member login's
// event picker to the governed Public Event Discovery RPC. Consistent
// with this repository's own established test convention for page
// components (see app/login/page.test.ts) -- no RTL/jsdom harness exists
// in this repository to render the component and assert on DOM output,
// so behavior is proven from source instead.
//
// Run with:
//   npx tsx --test app/member/login/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("event picker uses the public discovery RPC, not a direct events table read", () => {
  assert.match(SOURCE, /supabase\s*\.rpc\("get_public_discoverable_events"\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no client-side re-filtering of the RPC's already-enforced visibility predicate", () => {
  assert.doesNotMatch(SOURCE, /isMemberVisibleEvent/);
  assert.doesNotMatch(SOURCE, /eventStatus/);
});

test("EventRow no longer carries visibility/lifecycle fields the RPC doesn't return", () => {
  const typeBlock = SOURCE.slice(SOURCE.indexOf("type EventRow"), SOURCE.indexOf("type AttendeeRow"));
  assert.doesNotMatch(typeBlock, /visible_to_members/);
  assert.doesNotMatch(typeBlock, /\bstatus\b/);
  assert.doesNotMatch(typeBlock, /is_active/);
  assert.doesNotMatch(typeBlock, /event_code/);
});

test("event-code submission/verification is unchanged: user-entered code still resolved via verify_member_event_login", () => {
  assert.match(SOURCE, /enteredCode/);
  assert.match(SOURCE, /supabase\.rpc\("verify_member_event_login",\s*\{/);
  assert.match(SOURCE, /p_event_code:\s*entered/);
});

test("saveMemberSession still stores the user-entered code, never a value read from the events table", () => {
  const sessionCallStart = SOURCE.indexOf("saveMemberSession({");
  const sessionCallEnd = SOURCE.indexOf("});", sessionCallStart);
  const sessionCall = SOURCE.slice(sessionCallStart, sessionCallEnd);
  assert.match(sessionCall, /event_code:\s*entered/);
});

test("displayed selection fields (name, dates) are preserved", () => {
  assert.match(SOURCE, /event\.name \|\| "Untitled event"/);
  assert.match(SOURCE, /formatDateRange\(event\.start_date, event\.end_date\)/);
});

test("a lapsed-account redirect (?sessionExpired=1) shows an explanatory notice, read from the URL without useSearchParams", () => {
  assert.match(SOURCE, /sessionExpiredNotice/);
  assert.match(
    SOURCE,
    /url\.searchParams\.get\("sessionExpired"\) === "1"/,
  );
  assert.equal(/useSearchParams\(/.test(SOURCE), false);
  assert.match(
    SOURCE,
    /Your account session expired\. Sign in again to continue/,
  );
});

test("an already-activated redirect has a separate green, one-time sign-in notice", () => {
  assert.match(SOURCE, /accountActivatedNotice/);
  assert.match(SOURCE, /url\.searchParams\.get\("accountActivated"\) === "1"/);
  assert.match(SOURCE, /url\.searchParams\.delete\("accountActivated"\)/);
  assert.match(SOURCE, /window\.history\.replaceState/);
  assert.match(SOURCE, /Your account is already activated\. Sign in to continue\./);
  assert.match(SOURCE, /background: "#f0fdf4"/);
});
