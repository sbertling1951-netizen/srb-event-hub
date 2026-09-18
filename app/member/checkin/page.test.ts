import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("member sharing writes through the governed set_member_attendee_sharing_preferences RPC, not a direct table write", () => {
  assert.match(
    source,
    /supabase\.rpc\(\s*\n\s*"set_member_attendee_sharing_preferences"/,
  );
  assert.equal(/\.from\("attendee_sharing_preferences"\)/.test(source), false);
});

test("capability-backed temporary sessions save without rendering the legacy credential ceremony", () => {
  assert.match(source, /hasCapability = !!session\?\.temporary_capability_hash/);
  assert.match(source, /temporaryAccess && !hasCapability/);
  assert.match(source, /capabilityHash: hasCapability/);
  assert.match(source, /memberIdentityRpcArgs\(session\)/);
  assert.match(source, /Verify temporary event access/);
});

test("the sharing RPC call happens only after the governed /api/member/checkin call has already succeeded", () => {
  const fetchIdx = source.indexOf('fetch("/api/member/checkin"');
  const okGuard = source.indexOf("if (!response.ok)");
  const sharingCall = source.indexOf('"set_member_attendee_sharing_preferences"');
  assert.ok(fetchIdx >= 0 && okGuard > fetchIdx && sharingCall > okGuard);
});

test("a sharing-preference failure is reported distinctly from a check-in failure and does not navigate away", () => {
  const block = source.match(
    /const sharingResult = sharingData\?\.\[0\];[\s\S]*?\n {6}\}/,
  )?.[0];
  assert.ok(block, "expected the sharing-result handling block");
  assert.match(block!, /Your check-in was saved, but your sharing choice could not be saved/);
  assert.equal(/router\.replace/.test(block!), false, "must not navigate away on a sharing failure");
});

test("ordinary capability Check-In failures preserve the session and stay on the page", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(saveStart, source.indexOf("\n  const participantCapacity"));
  assert.match(saveBody, /responseBody\?\.error === "temporary_access_invalid"/);
  assert.match(
    saveBody,
    /Your check-in could not be saved\. Review the form and try again\./,
  );
  assert.equal(
    /if \(hasCapability\) \{\s*clearMemberLocalState/.test(saveBody),
    false,
    "ordinary capability failures must not clear local state",
  );
  assert.equal(
    /router\.replace\("\/member\/login\?sessionExpired=1"\)/.test(saveBody),
    false,
    "ordinary capability failures must not use account expiry navigation",
  );
});

test("only an explicitly invalid capability clears TEA state and routes to TEA verification", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(saveStart, source.indexOf("\n  const participantCapacity"));
  const invalidBranch = saveBody.match(
    /if \(\s*hasCapability[\s\S]*?responseBody\?\.error === "temporary_access_invalid"[\s\S]*?return;\n        \}/,
  )?.[0];
  assert.ok(invalidBranch, "expected the explicit capability-invalid branch");
  assert.match(invalidBranch!, /clearMemberLocalState\(\);/);
  assert.match(invalidBranch!, /router\.replace\("\/member\/login\?teaSessionExpired=1"\)/);
});

test("the boolean share checkbox maps to the full approved optional-field set or none -- never a partial/invented combination", () => {
  const constBlock = source.match(
    /const MEMBER_SHARE_ALL_FIELD_KEYS = \[[\s\S]*?\];/,
  )?.[0];
  assert.ok(constBlock, "expected MEMBER_SHARE_ALL_FIELD_KEYS");
  const keys = [...constBlock!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ["campsite_location", "coach_make_model", "email", "phone"].sort());
  assert.match(
    source,
    /p_shared_field_keys: shareWithAttendees\s*\n\s*\? MEMBER_SHARE_ALL_FIELD_KEYS\s*\n\s*: \[\],/,
  );
});

test("the site field uses reporting terminology -- the primary prompt is the question, not assignment language", () => {
  assert.match(source, /What site are you parked in\?/);
  assert.equal(/Site Number/.test(source), false);
  assert.equal(/Enter your assigned site/.test(source), false);
});

test("supporting text tells the member blank is fine and that this is not an assignment", () => {
  const labelBlock = source.match(
    /What site are you parked in\?[\s\S]*?<\/Field>/,
  )?.[0];
  assert.ok(labelBlock, "expected the site-report Field block");
  assert.match(labelBlock!, /blank/i);
  assert.match(labelBlock!, /does\s+not assign or reserve a site/i);
});

test("Confirmed site is a visually and textually distinct line from the report input, sourced from canonical Parking state", () => {
  assert.match(source, /Confirmed site:/);
  assert.match(
    source,
    /supabase\.rpc\(\s*\n?\s*"get_my_confirmed_site_placement"/,
  );
  const confirmedBlock = source.match(/Confirmed site:[\s\S]*?<\/div>/)?.[0];
  assert.ok(confirmedBlock, "expected the Confirmed site display block");
  assert.equal(/attendee\.assigned_site/.test(confirmedBlock!), false);
  assert.match(confirmedBlock!, /confirmedSite\./);
});

test("the report input never displays a stored value -- it always starts blank and is cleared after a successful submit, so it can never be mistaken for a confirmed or previously-reported site", () => {
  assert.match(source, /const \[siteReport, setSiteReport\] = useState\(""\)/);
  assert.equal(/setSiteReport\(attendeeRow/.test(source), false);
  assert.equal(/setSiteReport\(.*assigned_site/.test(source), false);
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(saveStart, source.indexOf("\n  const participantCapacity"));
  assert.match(saveBody, /setSiteReport\(""\)/);
});

test("a successful check-in response is never used to populate assigned_site into local attendee state -- that field is not confirmed placement", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(saveStart, source.indexOf("\n  const participantCapacity"));
  const setAttendeeBlock = saveBody.match(/setAttendee\(\(prev\) =>[\s\S]*?\);/)?.[0];
  assert.ok(setAttendeeBlock, "expected the post-checkin setAttendee call");
  assert.equal(/assigned_site/.test(setAttendeeBlock!), false);
});

test("the report is still submitted through the existing governed /api/member/checkin boundary -- no new client-side write path", () => {
  assert.match(source, /assignedSite: siteReport/);
  assert.match(source, /fetch\("\/api\/member\/checkin"/);
});

test("Member My Check-In has no member-facing arrival checkbox; its stable request contract carries only the loaded Arrival state", () => {
  assert.equal(/I have arrived/.test(source), false);
  assert.equal(/setHasArrived/.test(source), false);
  assert.match(source, /hasArrived: !!attendee\.has_arrived/);
  assert.match(
    source,
    /String\(updatedAttendee\.has_arrived\)/,
  );
});

// ---------------------------------------------------------------------------
// Lapsed-account session messaging (defense-in-depth behind MemberRouteGuard).
// The old copy blamed the login code for a failure that is really an absent
// auth session; it must be gone.
// ---------------------------------------------------------------------------

test('the misleading "Member login needs to store attendee identity" diagnosis is gone', () => {
  assert.equal(
    /Member login needs to store attendee identity/.test(source),
    false,
  );
  assert.equal(/No member identity found for self check-in/.test(source), false);
});

test("an account-origin lookup that fails only because there is no Supabase session is surfaced as an expired session, using the existing auth-user marker", () => {
  const branch = source.match(
    /if \(!attendeeRow\) \{[\s\S]*?\n {6}\}/,
  )?.[0];
  assert.ok(branch, "expected the empty-attendee branch");
  assert.match(branch!, /STORAGE_KEYS\.memberAuthUserId/);
  assert.match(branch!, /supabase\.auth\.getSession\(\)/);
  assert.match(branch!, /accountOrigin && !sessionData\.session/);
  assert.match(branch!, /setNeedsReauth\(true\)/);
  assert.match(branch!, /Your account session has expired/);
});

test("the empty-attendee view offers a sign-in action for the expired-session case and does not invent a second attendee-resolution path", () => {
  assert.match(source, /const \[needsReauth, setNeedsReauth\] = useState\(false\)/);
  assert.match(source, /needsReauth \?/);
  assert.match(source, /href="\/member\/login\?sessionExpired=1"/);
  // still exactly one identity read: get_my_attendee_record. No new RPC, no
  // direct table read.
  assert.match(source, /supabase\.rpc\("get_my_attendee_record"/);
  assert.equal(/\.from\("attendees"\)/.test(source), false);
});

// ---------------------------------------------------------------------------
// Member Workspace Continuity -- My Check-In consumes the shared workspace
// identity state; the "no attendee record" terminal dead-end is removed.
// ---------------------------------------------------------------------------

test("the !attendeeId precondition that blocked a self-healing RPC call is gone -- the page consumes identityStatus, not its own identity gate", () => {
  assert.match(source, /identityStatus \} =\s*\n?\s*useMemberWorkspace\(\);/);
  // the load effect no longer bails purely because attendeeId is absent;
  // it only skips while resolving, or once resolved-but-not-yet-propagated
  const effect = source.slice(
    source.indexOf("useEffect(() => {\n    if (!isReady || identityStatus"),
    source.indexOf("}, [attendeeId, event?.id, identityStatus, isReady, loadPage]);"),
  );
  assert.match(effect, /identityStatus === "resolving"/);
  assert.match(effect, /identityStatus === "resolved" &&\s*\n\s*\(!event\?\.id \|\| !attendeeId\)/);
});

test("recovery_required renders explicit sign-in + Temporary Event Access actions, never a terminal 'No attendee record is available'", () => {
  assert.equal(
    /No attendee record is available for self check-in/.test(source),
    false,
  );
  assert.match(source, /if \(identityStatus === "recovery_required"\) \{[\s\S]{0,320}?setNeedsRecovery\(true\)/);
  assert.match(source, /const \[needsRecovery, setNeedsRecovery\] = useState\(false\)/);
  // the recovery view -- both actions reachable
  const needsRecoveryIdx = source.indexOf("needsRecovery ? (");
  const recoveryView = source.slice(
    needsRecoveryIdx,
    source.indexOf("Loading check-in...", needsRecoveryIdx),
  );
  assert.ok(recoveryView.length > 0, "expected the needsRecovery render branch");
  assert.match(recoveryView, /href="\/member\/login\?sessionExpired=1"/);
  assert.match(recoveryView, /href="\/member\/login"/);
  assert.match(recoveryView, /Use temporary event access/);
});

test("M2: on a successful attendee resolution the canonical MemberSession is kept coherent via ensureMemberSessionAttendee -- the retired attendee-id compat key is no longer written", () => {
  assert.match(source, /ensureMemberSessionAttendee\(attendeeRow\.id\)/);
  assert.doesNotMatch(source, /memberAttendeeId|fcoc-member-attendee-id/);
  // check-in telemetry uses the shared workspace attendee id, not a legacy key
  assert.match(source, /useMemberWorkspace\(\)/);
  assert.match(source, /if \(!event\?\.id \|\| !attendeeId\) \{[\s\S]{0,140}?activityType: "checkin_view"/);
});

test("the residual empty-result branch also offers recovery, not a dead end", () => {
  const branch = source.match(/if \(!attendeeRow\) \{[\s\S]*?\n {6}\}/)?.[0];
  assert.ok(branch);
  assert.match(branch!, /setNeedsRecovery\(true\)/);
  // capability / lapsed-account redirects preserved
  assert.match(branch!, /capabilityOrigin && !sessionData\.session/);
  assert.match(branch!, /router\.replace\("\/member\/login\?sessionExpired=1"\)/);
});

test("arrival / parking separation is untouched by the continuity repair", () => {
  // arrival from has_arrived only; confirmed site read-only from Parking
  assert.match(source, /get_my_confirmed_site_placement/);
  assert.match(source, /String\(!!attendeeRow\.has_arrived\)/);
  // no parking inference / occupancy mutation added
  assert.equal(/parking_sites/.test(source), false);
  // the member-reported site is still submitted as evidence only
  assert.match(source, /assignedSite: siteReport/);
});

test("loadPage resets the reauth flag on every run so it never sticks after recovery", () => {
  const loadPageStart = source.indexOf("const loadPage = useCallback(async () => {");
  const head = source.slice(loadPageStart, loadPageStart + 250);
  assert.match(head, /setNeedsReauth\(false\)/);
});

// ---------------------------------------------------------------------------
// Presentation Slice 1: status/error boxes and the Save button now use the
// shared Alert/AppButton primitives, with no change to any data/authority
// logic beneath them.
// ---------------------------------------------------------------------------

test("the page is guarded by MemberRouteGuard and uses the canonical Member shell with no back target", () => {
  assert.match(source, /<MemberRouteGuard>/);
  assert.match(source, /<MemberShellAdapter pageTitle="My Check-In">/);
  assert.equal((source.match(/backTarget=/g) || []).length, 0);
});

test("the status/error boxes use the shared Alert primitive, and the failure surface is singular (no duplicate status+error)", () => {
  assert.match(source, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(source, /\{status && !error \? <Alert tone="info">\{status\}<\/Alert> : null\}/);
  assert.match(source, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
});

test("Save uses the shared AppButton with the exact click handler, label swap, and loading-driven disabled behavior", () => {
  assert.match(source, /import \{ AppButton, AppLinkButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(
    source,
    /<AppButton variant="primary" loading=\{saving\} onClick=\{\(\) => void saveCheckin\(\)\}>\s*\n\s*\{saving \? "Saving\.\.\." : "Save"\}\s*\n\s*<\/AppButton>/,
  );
  assert.doesNotMatch(source, /<button\b/);
});

test("Slice 3 leaves coach/household display, the Confirmed-site line, and the temporary-credentials divider/heading/copy untouched", () => {
  assert.match(source, /Coach \/ Household/);
  assert.match(source, /Co-Pilot/);
  assert.match(source, /Confirmed site:/);
  assert.match(source, /color: "#334155"/);
  assert.match(
    source,
    /borderTop: "1px solid #e2e8f0",\s*\n\s*paddingTop: 14,/,
  );
  assert.match(source, /<strong>Verify temporary event access<\/strong>/);
  assert.match(source, /color: "#475569", fontSize: 14/);
});

test("the recovery/loading container uses PageSection with the exact muted-text token and preserved grid/gap layout", () => {
  assert.match(source, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(
    source,
    /<PageSection\s*\n\s*variant="card"\s*\n\s*style=\{\{ color: "var\(--color-text-muted\)", display: "grid", gap: 12 \}\}\s*\n\s*>/,
  );
  assert.match(source, /needsReauth \?/);
  assert.match(source, /needsRecovery \?/);
});

test("both 'Sign in again' actions use AppLinkButton with the exact href, and the temporary-access link keeps its blue text with only its border tokenized", () => {
  assert.equal(
    (source.match(/<AppLinkButton href="\/member\/login\?sessionExpired=1" variant="primary">/g) || []).length,
    2,
  );
  assert.match(source, /Sign in again\s*\n\s*<\/AppLinkButton>/);
  assert.match(source, /<Link\s*\n\s*href="\/member\/login"/);
  assert.match(source, /border: "1px solid var\(--color-border-strong\)"/);
  assert.match(source, /color: "#0b5cff"/);
  assert.match(source, /Use temporary event access/);
  assert.doesNotMatch(source, /background: "#0b5cff"/);
});

test("Slice 2 leaves every RPC, fetch, and data/authority contract unchanged", () => {
  assert.match(source, /supabase\.rpc\("get_my_attendee_record"/);
  assert.match(source, /supabase\.rpc\(\s*\n?\s*"get_my_confirmed_site_placement"/);
  assert.match(source, /"get_my_household_members"/);
  assert.match(source, /fetch\("\/api\/member\/checkin"/);
  assert.match(source, /"set_member_attendee_sharing_preferences"/);
  assert.match(source, /hasArrived: !!attendee\.has_arrived/);
});

// ---------------------------------------------------------------------------
// Presentation Slice 3: the main Check-In panel (attendee branch) now uses
// the shared PageSection/AppLinkButton/Field/Input/Checkbox primitives, with
// no change to loadPage, saveCheckin, or any RPC/fetch/data/authority
// contract beneath them.
// ---------------------------------------------------------------------------

test("the main panel outer container uses PageSection with the preserved grid/gap layout", () => {
  assert.match(
    source,
    /<PageSection variant="card" style=\{\{ display: "grid", gap: 14 \}\}>/,
  );
});

test("Add Participant uses AppLinkButton with the exact href, label, emoji, and availableSlots gate", () => {
  assert.match(
    source,
    /<AppLinkButton href="\/member\/participants" variant="secondary">\s*\n\s*➕👤 Add Participant\s*\n\s*<\/AppLinkButton>/,
  );
  assert.match(source, /\{availableSlots > 0 \? \(/);
  assert.doesNotMatch(source, /border: "1px solid #cbd5e1",\s*\n\s*background: "#fff",\s*\n\s*textDecoration: "none",\s*\n\s*fontWeight: 600,\s*\n\s*color: "inherit",/);
});

test("the site-report control uses Field + Input, preserving the exact value, uppercase onChange transform, placeholder, and help copy", () => {
  assert.match(source, /import \{ Checkbox, Field, Input \} from "@\/components\/ui\/Field";/);
  assert.match(
    source,
    /<Field\s*\n\s*label="What site are you parked in\?"\s*\n\s*help="Leave this blank if you don't know your site yet or haven't parked\. This tells us where you are -- it does not assign or reserve a site\."\s*\n\s*>/,
  );
  assert.match(source, /value=\{siteReport\}/);
  assert.match(source, /onChange=\{\(e\) => setSiteReport\(e\.target\.value\.toUpperCase\(\)\)\}/);
  assert.match(source, /placeholder="e\.g\. A12"/);
});

test("the sharing control uses the shared Checkbox, preserving the exact label, checked state, and onChange behavior", () => {
  assert.match(
    source,
    /<Checkbox\s*\n\s*label="Share my site \/ household details with other attendees"\s*\n\s*checked=\{shareWithAttendees\}\s*\n\s*onChange=\{\(e\) => setShareWithAttendees\(e\.target\.checked\)\}\s*\n\s*\/>/,
  );
});

test("the two temporary-credentials inputs use Field + Input, preserving the exact gate, values, setters, placeholders, and autoComplete", () => {
  assert.match(source, /\{requiresTemporaryCredentials \? \(/);
  assert.match(source, /<Field label="Event code">/);
  assert.match(source, /value=\{temporaryEventCode\}/);
  assert.match(source, /onChange=\{\(event\) => setTemporaryEventCode\(event\.target\.value\)\}/);
  assert.match(source, /<Field label="Registration email or mobile number">/);
  assert.match(source, /value=\{temporaryRegistrationIdentifier\}/);
  assert.match(
    source,
    /onChange=\{\(event\) =>\s*\n\s*setTemporaryRegistrationIdentifier\(event\.target\.value\)\s*\n\s*\}/,
  );
  assert.equal((source.match(/autoComplete="off"/g) || []).length, 2);
  assert.doesNotMatch(source, /<input\b/);
});

test("Slice 3 leaves loadPage, saveCheckin, and every RPC/fetch/data/authority contract unchanged", () => {
  assert.match(source, /supabase\.rpc\("get_my_attendee_record"/);
  assert.match(source, /supabase\.rpc\(\s*\n?\s*"get_my_confirmed_site_placement"/);
  assert.match(source, /"get_my_household_members"/);
  assert.match(source, /fetch\("\/api\/member\/checkin"/);
  assert.match(source, /"set_member_attendee_sharing_preferences"/);
  assert.match(source, /hasArrived: !!attendee\.has_arrived/);
  assert.match(source, /assignedSite: siteReport/);
  assert.equal((source.match(/backTarget=/g) || []).length, 0);
});
