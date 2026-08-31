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

test("validation + recovery apply on the EXACT set of MemberRouteGuard-protected route prefixes, not a bare '/member' prefix", () => {
  assert.match(
    CODE,
    /PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES = \[\s*\n\s*"\/member",\s*\n\s*"\/coach-map",\s*\n\s*"\/activities",\s*\n\s*"\/announcements",\s*\n\s*\]/,
  );
  // both effects gate on the route set, not `pathname.startsWith("/member")`
  assert.equal(
    (CODE.match(/if \(!isProtectedMemberWorkspaceRoute\(pathname\)\) \{/g) || []).length,
    2,
  );
  assert.equal(/pathname\.startsWith\("\/member"\)/.test(CODE), false);
  // genuinely public routes (/nearby, /locations, /map) are deliberately
  // NOT in the set -- public browsing must not trigger recovery / an
  // invalid-context redirect
  assert.equal(/"\/nearby"|"\/locations"|"\/map"/.test(
    CODE.slice(
      CODE.indexOf("PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES"),
      CODE.indexOf("] as const"),
    ),
  ), false);
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

// ---------------------------------------------------------------------------
// Member Workspace Continuity -- shared attendee-identity recovery.
// ---------------------------------------------------------------------------

test("attendee identity is read from the canonical MemberSession only -- a legacy fcoc-member-attendee-id is never a fallback answer", () => {
  assert.match(CODE, /const nextAttendeeId = nextSession\?\.attendee_id \?\? null;/);
  // no getCurrentAttendeeId / getStoredMemberAttendeeId fallback into the snapshot
  assert.equal(/getCurrentAttendeeId|getStoredMemberAttendeeId/.test(CODE), false);
});

test("a coherent MemberSession is immediately 'resolved' -- no recovery work on the common path", () => {
  assert.match(CODE, /const coherentIdentity = !!\(nextSession\?\.event_id && nextAttendeeId\);/);
  assert.match(CODE, /if \(coherentIdentity\) \{\s*\n\s*nextIdentityStatus = "resolved";/);
  // the recovery effect early-returns when the pair is already usable
  assert.match(
    CODE,
    /if \(workspace\.attendeeId && workspace\.event\?\.id\) \{\s*\n\s*return;\s*\n\s*\}/,
  );
});

test("a present-but-incomplete (or absent-but-authenticated) MemberSession triggers ONE governed recovery attempt through recoverMemberIdentity", () => {
  assert.match(CODE, /import \{[\s\S]*?recoverMemberIdentity,[\s\S]*?\} from "@\/lib\/memberWorkspace\/recoverMemberIdentity";/);
  assert.match(CODE, /outcome = await recoverMemberIdentity\(controller\.signal\);/);
  // one attempt per (anchor Event id + auth shape); a sign-in or Event
  // change flips the key and allows a fresh attempt -- no loop
  assert.match(
    CODE,
    /const attemptKey = `\$\{anchorEventId\}\|\$\{String\(workspace\.isAccountSession\)\}`;/,
  );
  assert.match(CODE, /if \(recoveryKeyRef\.current === attemptKey\) \{\s*\n\s*return;/);
  // race safety: generation counter + AbortController, same as the
  // established-context validation
  assert.match(CODE, /const attemptSeq = \+\+recoverySeqRef\.current;/);
  assert.match(CODE, /if \(controller\.signal\.aborted \|\| attemptSeq !== recoverySeqRef\.current\)/);
});

test("the recovery anchor is the persisted MemberSession Event, or -- for a live authenticated account only -- the current-Event hint; never a legacy attendee id", () => {
  assert.match(
    CODE,
    /const anchorEventId =\s*\n\s*getMemberSession\(\)\?\.event_id \?\? getCurrentMemberEvent\(\)\?\.id \?\? null;/,
  );
  // no legacy attendee id feeds the anchor (or anything in this effect)
  const recoveryEffect = CODE.slice(CODE.indexOf("const recoverySeqRef"));
  assert.equal(/memberAttendeeId|fcoc-member-attendee-id/.test(recoveryEffect), false);
  // the auth-only rule for the hint is enforced inside recoverMemberIdentity
  // (proven in recoverMemberIdentity.test.ts) -- the provider just supplies
  // the anchor
  assert.match(SOURCE, /recoverMemberIdentity enforces that auth-only/);
});

test("no anchor at all (no session Event, no hint) -> immediate recovery_required, no RPC attempt", () => {
  assert.match(
    CODE,
    /if \(!anchorEventId\) \{[\s\S]{0,220}?identityStatus: "recovery_required"[\s\S]{0,40}?return;/,
  );
});

test("recovery outcome: success re-reads the rewritten session; failure settles on recovery_required (never a null-identity 'resolved')", () => {
  assert.match(
    CODE,
    /if \(outcome\.status === "resolved"\) \{[\s\S]{0,160}?refresh\(\);/,
  );
  assert.match(
    CODE,
    /setWorkspace\(\(prev\) => \(\{ \.\.\.prev, identityStatus: "recovery_required" \}\)\);/,
  );
});

test("the workspace value exposes identityStatus + needsIdentityRecovery for the Guard / dashboard / pages to share one decision", () => {
  assert.match(
    CODE,
    /needsIdentityRecovery: workspace\.identityStatus === "recovery_required",/,
  );
});

test("a settled recovery decision is sticky per Event and reset when the persisted Event changes", () => {
  assert.match(
    CODE,
    /previous\.identityStatus === "recovery_required" &&\s*\n\s*\(previous\.eventId \?\? null\) === \(nextSession\?\.event_id \?\? null\)/,
  );
});
