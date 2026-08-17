import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("Check-In submits placement and arrival state through one atomic governed RPC", () => {
  assert.match(source, /supabase\.rpc\(\s*"complete_admin_checkin"/);
  for (const field of ["p_expected_event_id", "p_has_arrived", "p_share_with_attendees", "p_placement_action", "p_site_id", "p_placement_idempotency_key"]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.equal(/\.from\("attendees"\)\s*\.update/.test(source), false);
  assert.equal(/supabase\.rpc\(\s*"record_site_placement"/.test(source), false);
});

test("a failed or rejected atomic result cannot reach the success feedback", () => {
  const reject = source.indexOf('checkinResult.outcome === "rejected"');
  const feedback = source.indexOf("const feedback");
  assert.ok(reject >= 0 && feedback > reject);
});

test("attendee sharing writes through the governed set_attendee_sharing_preferences RPC, never a direct table write", () => {
  assert.match(
    source,
    /supabase\.rpc\(\s*"set_attendee_sharing_preferences"/,
  );
  for (const field of ["p_attendee_id", "p_expected_event_id", "p_shared_field_keys"]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.equal(/\.from\("attendee_sharing_preferences"\)/.test(source), false);
});

test("the sharing RPC call happens only after complete_admin_checkin has succeeded", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(saveStart, source.indexOf("\n  return (", saveStart));
  const checkinCall = saveBody.indexOf('supabase.rpc(\n        "complete_admin_checkin"');
  const checkinRejectGuard = saveBody.indexOf('checkinResult.outcome === "rejected"');
  const sharingCall = saveBody.indexOf("await saveSharingPreferences(");
  assert.ok(checkinCall >= 0 && checkinRejectGuard > checkinCall && sharingCall > checkinRejectGuard);
});

test("a rejected sharing-preference result cannot reach the success feedback either", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(saveStart, source.indexOf("\n  return (", saveStart));
  const reject = saveBody.indexOf("if (sharingFailure)");
  const feedback = saveBody.indexOf("const feedback");
  assert.ok(reject >= 0 && feedback > reject);
});

test("the legacy share_with_attendees column is never read from an attendee row or written directly -- only p_share_with_attendees, complete_admin_checkin's own required parameter, remains", () => {
  assert.equal(/attendee\.share_with_attendees/.test(source), false);
  assert.equal(/\.share_with_attendees,/.test(source), false);
  assert.match(source, /p_share_with_attendees: current\.sharedFields\.length > 0/);
});

test("p_share_with_attendees for complete_admin_checkin is derived from sharedFields, not a separate checkbox state", () => {
  assert.match(source, /p_share_with_attendees: current\.sharedFields\.length > 0/);
});

test("exactly the four approved optional sharing fields are offered, and no excluded field is ever wired as a shareable key", () => {
  const approved = ["email", "phone", "campsite_location", "coach_make_model"];
  for (const key of approved) {
    assert.match(source, new RegExp(`key: "${key}"`));
  }
  const fieldBlock = source.match(
    /const SHARING_OPTIONAL_FIELDS = \[[\s\S]*?\] as const;/,
  )?.[0];
  assert.ok(fieldBlock, "expected the SHARING_OPTIONAL_FIELDS declaration");
  const keys = [...fieldBlock!.matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), approved.sort());

  for (const forbidden of [
    "coach_length",
    "coach_year",
    "vin",
    "license_plate",
    "first_time",
    "volunteer",
    "handicap",
    "household",
  ]) {
    assert.equal(
      source.toLowerCase().includes(`key: "${forbidden}"`),
      false,
      `'${forbidden}' must never be offered as a shareable field key`,
    );
  }
});

test("Name is never submitted as a client-chosen key -- it is not among the checkbox field keys", () => {
  const fieldBlock = source.match(
    /const SHARING_OPTIONAL_FIELDS = \[[\s\S]*?\] as const;/,
  )?.[0];
  assert.equal(/key: "name"/.test(fieldBlock!), false);
});

test("a sharing-preference failure always states check-in already saved, regardless of which rejection code fired, and reconciles the UI before surfacing it", () => {
  const block = source.match(
    /if \(sharingFailure\) \{[\s\S]*?\n {6}\}\n/,
  )?.[0];
  assert.ok(block, "expected the sharingFailure branch");
  // The message text is a fixed template, not built from mapSitePlacementError's
  // return value alone -- so a dictionary-mapped code (e.g. authorization_denied)
  // can never replace the "check-in was saved" framing the way it would if the
  // whole string came from mapSitePlacementError's fallback parameter.
  assert.match(block!, /check-in \(arrival\/site\) was saved, but sharing preferences were not saved/);
  const loadIdx = block!.indexOf("await loadPage()");
  const showErrorIdx = block!.indexOf("showError(");
  assert.ok(loadIdx >= 0 && showErrorIdx > loadIdx, "state must reconcile via loadPage() before the warning is shown");
  assert.match(block!, /\breturn;/);
});

test("Select all resolves to the explicit set of registered optional keys, never a hidden all-fields flag", () => {
  const fnBody = source.match(
    /function selectAllSharedFields[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(fnBody, "expected a selectAllSharedFields function");
  assert.match(fnBody!, /SHARING_OPTIONAL_FIELDS\.map\(\(field\) => field\.key\)/);
});

test("the browse surface delegates waiting-first filtering to the tested workflow helper", () => {
  assert.match(source, /filterCheckinBrowseAttendees\(/);
  assert.match(source, /showArrived/);
  assert.match(source, /Show already checked-in attendees/);
});

test("only the selected attendee owns the expanded action workspace", () => {
  assert.match(source, /const \[selectedAttendeeId, setSelectedAttendeeId\]/);
  assert.match(source, /\(selectedAttendee \? \[selectedAttendee\] : \[\]\)\.map/);
  assert.match(source, /Selected attendee/);
  assert.match(source, /Back to results/);
});

test("compact browse results remain keyboard-native buttons with identity confirmation", () => {
  assert.match(source, /aria-label="Check-In attendee results"/);
  assert.match(source, /<button[\s\S]*?type="button"[\s\S]*?onClick=\{\(\) => selectAttendee\(attendee\.id\)\}/);
  assert.match(source, /attendee\.email \|\| "No email"/);
  assert.match(source, /attendee\.has_arrived \? "Checked in" : "Waiting"/);
});

test("the dominant workflow has one explicit Check In action and no Arrived checkbox", () => {
  assert.match(source, /saveCheckin\(attendee, true\)/);
  assert.match(source, /"Checking In\.\.\." : "Check In"/);
  assert.equal(/checked=\{current\.hasArrived\}/.test(source), false);
  assert.equal(/>\s*Save\s*</.test(source), false);
});

test("Undo Check-In is a named correction behind the canonical confirmation dialog", () => {
  assert.match(source, /title="Undo Check-In"/);
  assert.match(source, /confirmLabel="Undo Check-In"/);
  assert.match(source, /saveCheckin\(attendee, false\)/);
  assert.match(source, /current site assignment will remain in place/);
});

test("handicap need and site conflict are presented beside placement", () => {
  assert.match(source, /Handicap parking needed/);
  assert.match(source, /Site conflict: assigned to/);
  assert.match(source, /This site was not found on the Event parking map/);
});

test("decision-critical identity is primary while coach and reference facts are disclosed once", () => {
  assert.match(source, /Pilot:/);
  assert.match(source, /Co-Pilot:/);
  assert.match(source, /<details[\s\S]*?Additional details[\s\S]*?Email:[\s\S]*?Coach:[\s\S]*?First Time:[\s\S]*?Volunteer:[\s\S]*?<\/details>/);
  assert.match(source, /member\.person_role === "additional"/);
  assert.equal(/Coach \/ Household Members/.test(source), false);
});

test("map access is progressively disclosed rather than a co-equal action", () => {
  assert.match(source, /<details[\s\S]*?Need to verify placement\?[\s\S]*?Show site on map[\s\S]*?<\/details>/);
});

test("occupied-site override uses the canonical confirmation dialog", () => {
  assert.match(source, /title="Resolve Site Conflict"/);
  assert.match(source, /confirmLabel="Move and Check In"/);
  assert.match(source, /saveCheckin\(attendee, true, true\)/);
  assert.equal(/window\.confirm/.test(source), false);
});

test("sharing remains a subordinate field-level panel with a sharing-only retry", () => {
  assert.match(source, /<details[\s\S]*?Attendee Sharing[\s\S]*?<\/details>/);
  assert.match(source, /Retry Sharing Update/);
  assert.match(source, /async function retrySharingPreferences/);
  assert.equal(/complete_admin_checkin/.test(source.match(/async function retrySharingPreferences[\s\S]*?\n  \}/)?.[0] || ""), false);
});

test("realtime refreshes preserve the selected draft instead of blindly rebuilding it", () => {
  const realtimeCalls = source.match(/loadPage\(\{ preserveSelectedEdit: true, silent: true \}\)/g) || [];
  assert.equal(realtimeCalls.length, 2, "attendee and parking realtime channels must both reconcile safely");
  assert.match(source, /reconcileCheckinEditState\(/);
  assert.match(source, /editStateRef\.current/);
});

test("slower realtime loads cannot overwrite a newer server snapshot", () => {
  assert.match(source, /const generation = \+\+loadGenerationRef\.current/);
  assert.match(source, /if \(generation !== loadGenerationRef\.current\) \{\s*return;/);
});

test("a remote change to the selected dirty attendee surfaces and blocks submission", () => {
  assert.match(source, /selectedAttendeeChangedRemotely\(/);
  assert.match(source, /This attendee changed at another Check-In station/);
  assert.match(source, /Record changed elsewhere/);
  assert.match(source, /Reload Current Record/);
  assert.match(source, /disabled=\{savingId === attendee\.id \|\| !!selectedConflict/);
});

test("placement retry reuses one idempotency key for the same action meaning", () => {
  assert.match(source, /placementAttemptKeysRef/);
  assert.match(source, /placementAttemptKeysRef\.current\[placementAttemptSignature\] \|\|/);
  assert.match(source, /p_placement_idempotency_key: placementIdempotencyKey/);
  assert.match(source, /delete placementAttemptKeysRef\.current\[placementAttemptSignature\]/);
});

test("successful Check-In is explicit, recent, and returns focus to attendee search", () => {
  assert.match(source, /Checked in successfully/);
  assert.match(source, /setRecentCompletion\(/);
  assert.match(source, /setSearch\(""\)/);
  assert.match(source, /searchInputRef\.current\?\.focus\(\)/);
  assert.match(source, /recentCompletion\.attendeeName/);
});

test("Check-In success plus sharing failure remains truthful and retryable", () => {
  assert.match(source, /Check-In saved\. Sharing still needs attention/);
  assert.match(source, /check-in \(arrival\/site\) was saved, but sharing preferences were not saved/);
  assert.match(source, /Retry Sharing Update/);
});

test("failures are categorized and only connectivity failures receive Check-In retry", () => {
  for (const category of ["authority", "conflict", "placement", "connectivity"]) {
    assert.match(source, new RegExp(`category: "${category}"`));
  }
  assert.match(source, /retryable = failure\.category === "connectivity"/);
  assert.match(source, /Retry Check-In/);
});

test("compact viewport keeps the primary action full-width and touch-sized", () => {
  assert.match(source, /useShellInterfaceCapabilities\(\)/);
  assert.match(source, /minHeight: 52/);
  assert.match(source, /width: isCompact \? "100%" : "auto"/);
});

test("authority and Event context continue through existing guards and canonical readers", () => {
  assert.match(source, /requiredPermission="can_mark_arrived"/);
  assert.match(source, /getCurrentAdminEvent\(\)/);
  assert.match(source, /canAccessEvent\(admin, adminEvent\.id\)/);
  assert.equal(/setCurrentAdminEvent|clearCurrentAdminEvent/.test(source), false);
});
