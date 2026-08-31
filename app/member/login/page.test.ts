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

test("event-code submission still uses the governed temporary-access verification route", () => {
  assert.match(SOURCE, /enteredCode/);
  assert.match(SOURCE, /fetch\("\/api\/member\/temporary-access"/);
  assert.match(SOURCE, /eventCode:\s*entered/);
  assert.match(SOURCE, /identifier:\s*normalizedIdentifier/);
});

test("saveMemberSession still stores the user-entered code, never a value read from the events table", () => {
  const sessionCallStart = SOURCE.indexOf("saveMemberSession({");
  const sessionCallEnd = SOURCE.indexOf("});", sessionCallStart);
  const sessionCall = SOURCE.slice(sessionCallStart, sessionCallEnd);
  assert.match(sessionCall, /event_code:\s*entered/);
});

test("temporary login stores only the issued capability for later identity resolution", () => {
  assert.match(SOURCE, /temporary_capability_hash:\s*responseBody\.capabilityHash/);
  assert.match(SOURCE, /attendee_email:\s*null/);
  assert.match(SOURCE, /attendee_phone:\s*null/);
  assert.match(SOURCE, /expires_at:\s*new Date\(Date\.now\(\) \+ 8 \* 60 \* 60 \* 1000\)/);
});

test("temporary login does not write retired standalone participant keys", () => {
  assert.doesNotMatch(SOURCE, /member-participant-(id|name|role)/);
});

test("temporary login does not write retired standalone email or name storage", () => {
  assert.doesNotMatch(SOURCE, /fcoc-member-(email|name)/);
  assert.doesNotMatch(SOURCE, /STORAGE_KEYS\.(memberEmail|memberName)/);
  assert.match(SOURCE, /attendee_email:\s*null/);
  assert.match(SOURCE, /temporary_capability_hash:\s*responseBody\.capabilityHash/);
});

test("M1/M2: temporary login no longer writes the retired standalone entry-id OR attendee-id keys; the canonical MemberSession write is unchanged", () => {
  assert.doesNotMatch(SOURCE, /memberEntryId|fcoc-member-entry-id/);
  assert.doesNotMatch(SOURCE, /memberAttendeeId|fcoc-member-attendee-id/);
  // the canonical MemberSession attendee id + capability hash are still written
  assert.match(SOURCE, /attendee_id:\s*attendee\.id/);
  assert.match(SOURCE, /temporary_capability_hash:\s*responseBody\.capabilityHash/);
  // the account-origin marker is still explicitly cleared for a TEA login
  assert.match(SOURCE, /localStorage\.removeItem\(STORAGE_KEYS\.memberAuthUserId\);/);
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

test("a Temporary Event Access expiry has separate recovery copy and does not replace account expiry messaging", () => {
  assert.match(SOURCE, /teaSessionExpiredNotice/);
  assert.match(SOURCE, /teaSessionExpired.*=== "1"/s);
  assert.match(
    SOURCE,
    /Your Temporary Event Access session expired\. Verify your Event Code\s+and registration information again to continue\./,
  );
  assert.match(SOURCE, /Your account session expired\. Sign in again to continue/);
});

test("an already-activated redirect has a separate green, one-time sign-in notice", () => {
  assert.match(SOURCE, /accountActivatedNotice/);
  assert.match(SOURCE, /url\.searchParams\.get\("accountActivated"\) === "1"/);
  assert.match(SOURCE, /url\.searchParams\.delete\("accountActivated"\)/);
  assert.match(SOURCE, /window\.history\.replaceState/);
  assert.match(SOURCE, /Your account is already activated\. Sign in to continue\./);
  assert.match(SOURCE, /background: "#f0fdf4"/);
});

test("secondary Member Login actions are a compact row inside the sign-in card", () => {
  const signInAction = SOURCE.indexOf('variant="primary"');
  const secondaryActions = SOURCE.indexOf('aria-label="Other sign-in options"');
  const signInStatus = SOURCE.indexOf("{signInStatus ? (");
  assert.ok(signInAction >= 0);
  assert.ok(secondaryActions > signInAction);
  assert.ok(signInStatus > secondaryActions);

  const row = SOURCE.slice(secondaryActions, signInStatus);
  assert.match(row, /gridTemplateColumns: "repeat\(auto-fit, minmax\(150px, 1fr\)\)"/);
  assert.match(row, /Recovery Link/);
  assert.match(row, /Temporary Event Access/);
  assert.match(row, /Choose Login Type/);
  assert.match(row, /onClick=\{\(\) => void sendRecoveryLink\(\)\}/);
  assert.match(row, /onClick=\{\(\) => setShowEventAccess\(\(current\) => !current\)\}/);
  assert.match(row, /href="\/login"/);
});

test("the former large below-card Member Login controls are absent", () => {
  assert.doesNotMatch(SOURCE, /Hide Temporary Event Access/);
  assert.doesNotMatch(SOURCE, />\s*Back to Login\s*</);
  assert.doesNotMatch(SOURCE, /Email me a recovery link/);
});

test("the affirmative trusted-device choice maps to persistent storage while unchecked stays session-limited", () => {
  assert.match(SOURCE, /const \[trustDevice, setTrustDevice\] = useState\(false\);/);
  assert.match(SOURCE, /setSharedDeviceMode\(!trustDevice\);/);
  assert.match(SOURCE, /Trust this device and keep me signed in\./);
  assert.match(SOURCE, /your sign-in\s*will end when you close this browser tab or window/i);
  assert.doesNotMatch(SOURCE, /This is a shared device\./);
});
