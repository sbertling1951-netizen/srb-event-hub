import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Stage 2's migration of the Member
// Events list to the governed Public Event Discovery RPC and removal of
// its public event_code display (Stage 1 audit finding: event_code is
// not part of the discovery contract -- login/activation never needed
// to receive it).
//
// Run with:
//   npx tsx --test app/member/events/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, "");

test("event list uses the public discovery RPC, not a direct events table read", () => {
  assert.match(SOURCE, /supabase\.rpc\(\s*\n?\s*"get_public_discoverable_events",?\s*\n?\s*\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no client-side re-filtering of the RPC's already-enforced visibility predicate", () => {
  assert.doesNotMatch(SOURCE, /\.eq\("visible_to_members"/);
});

test("event_code is never requested, typed, or displayed on this page", () => {
  // The only functional (non-comment) reference is the explicit
  // `event_code: null` passed to setCurrentMemberEvent, documenting that
  // discovery never supplies it -- not a request for or display of it.
  const codeLines = SOURCE.split("\n").filter(
    (line) => line.includes("event_code") && !line.trim().startsWith("//"),
  );
  assert.equal(codeLines.length, 1);
  assert.match(SOURCE, /setCurrentMemberEvent\(\{\s*\.\.\.event,\s*event_code:\s*null\s*\}\)/);
});

test("Event code display block has been removed", () => {
  assert.doesNotMatch(SOURCE, /Event code:/);
});

test("participant_capacity and registration_open are not re-added -- Stage 1 proved neither had a display/logic consumer", () => {
  assert.doesNotMatch(SOURCE, /participant_capacity/);
  assert.doesNotMatch(SOURCE, /registration_open/);
});

test("EventRow matches exactly the fields this page actually renders", () => {
  const typeBlock = SOURCE.slice(SOURCE.indexOf("type EventRow"), SOURCE.indexOf("function formatDateRange"));
  for (const field of ["id", "name", "venue_name", "location", "start_date", "end_date", "lat", "lng"]) {
    assert.match(typeBlock, new RegExp(`\\b${field}\\b`));
  }
});

test("other displayed fields (name, venue, location, dates, select action) are preserved", () => {
  assert.match(SOURCE, /event\.name \|\| "Untitled event"/);
  assert.match(SOURCE, /event\.venue_name/);
  assert.match(SOURCE, /event\.location/);
  assert.match(SOURCE, /formatDateRange\(event\.start_date, event\.end_date\)/);
  assert.match(SOURCE, /Select Event/);
});

// ---------------------------------------------------------------------------
// Member Workspace Continuity -- /member/events is PUBLIC EVENT DISCOVERY,
// not the authenticated "My Events" switcher.
// ---------------------------------------------------------------------------

test("selecting an Event never establishes or mutates the canonical MemberSession", () => {
  assert.doesNotMatch(CODE, /saveMemberSession/);
  assert.doesNotMatch(CODE, /"fcoc-member-session"/);
  assert.doesNotMatch(CODE, /finishMemberLogin|enterResolvedRegistration/);
});

test("the public/compat Event pointer write is skipped when a real MemberSession already exists (no mixed member state)", () => {
  assert.match(SOURCE, /import \{ getMemberSession \} from "@\/lib\/memberSession";/);
  assert.match(
    SOURCE,
    /if \(!getMemberSession\(\)\) \{\s*\n\s*setCurrentMemberEvent\(\{ \.\.\.event, event_code: null \}\);\s*\n\s*\}/,
  );
  assert.match(SOURCE, /PUBLIC EVENT DISCOVERY/);
});
