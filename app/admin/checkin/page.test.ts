import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Check-In submits Arrival state only, through one governed RPC, with no placement parameter of any kind", () => {
  assert.match(source, /supabase\.rpc\(\s*"complete_admin_checkin"/);
  for (const field of [
    "p_attendee_id",
    "p_expected_event_id",
    "p_has_arrived",
    "p_share_with_attendees",
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  for (const removedField of [
    "p_placement_action",
    "p_site_id",
    "p_placement_idempotency_key",
    "p_override_occupied_site",
  ]) {
    assert.equal(
      source.includes(`${removedField}:`),
      false,
      `${removedField} must never be sent by Check-In -- Stage A is Arrival-only`,
    );
  }
  assert.equal(/\.from\("attendees"\)\s*\.update/.test(source), false);
  assert.equal(/supabase\.rpc\(\s*"record_site_placement"/.test(source), false);
  assert.equal(
    /supabase\.rpc\(\s*"materialize_event_parking_site"/.test(source),
    false,
  );
});

test("a failed or rejected atomic result cannot reach the success feedback", () => {
  const reject = source.indexOf('checkinResult.outcome === "rejected"');
  const feedback = source.indexOf("const feedback");
  assert.ok(reject >= 0 && feedback > reject);
});

test("attendee sharing writes through the governed set_attendee_sharing_preferences RPC, never a direct table write", () => {
  assert.match(source, /supabase\.rpc\(\s*"set_attendee_sharing_preferences"/);
  for (const field of [
    "p_attendee_id",
    "p_expected_event_id",
    "p_shared_field_keys",
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.equal(/\.from\("attendee_sharing_preferences"\)/.test(source), false);
});

test("the sharing RPC call happens only after complete_admin_checkin has succeeded", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(
    saveStart,
    source.indexOf("\n  return (", saveStart),
  );
  const checkinCall = saveBody.indexOf(
    'supabase.rpc(\n        "complete_admin_checkin"',
  );
  const checkinRejectGuard = saveBody.indexOf(
    'checkinResult.outcome === "rejected"',
  );
  const sharingCall = saveBody.indexOf("await saveSharingPreferences(");
  assert.ok(
    checkinCall >= 0 &&
      checkinRejectGuard > checkinCall &&
      sharingCall > checkinRejectGuard,
  );
});

test("a rejected sharing-preference result cannot reach the success feedback either", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(
    saveStart,
    source.indexOf("\n  return (", saveStart),
  );
  const reject = saveBody.indexOf("if (sharingFailure)");
  const feedback = saveBody.indexOf("const feedback");
  assert.ok(reject >= 0 && feedback > reject);
});

test("the legacy share_with_attendees column is never read from an attendee row or written directly -- only p_share_with_attendees, complete_admin_checkin's own required parameter, remains", () => {
  assert.equal(/attendee\.share_with_attendees/.test(source), false);
  assert.equal(/\.share_with_attendees,/.test(source), false);
  assert.match(
    source,
    /p_share_with_attendees: current\.sharedFields\.length > 0/,
  );
});

test("p_share_with_attendees for complete_admin_checkin is derived from sharedFields, not a separate checkbox state", () => {
  assert.match(
    source,
    /p_share_with_attendees: current\.sharedFields\.length > 0/,
  );
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
  const block = source.match(/if \(sharingFailure\) \{[\s\S]*?\n {6}\}\n/)?.[0];
  assert.ok(block, "expected the sharingFailure branch");
  // The message text is a fixed template, not built from mapCheckinError's
  // return value alone -- so a dictionary-mapped code (e.g. authorization_denied)
  // can never replace the "check-in was saved" framing the way it would if the
  // whole string came from mapCheckinError's fallback parameter.
  assert.match(
    block!,
    /check-in \(arrival\) was saved, but sharing preferences were not saved/,
  );
  const loadIdx = block!.indexOf("await loadPage()");
  const showErrorIdx = block!.indexOf("showError(");
  assert.ok(
    loadIdx >= 0 && showErrorIdx > loadIdx,
    "state must reconcile via loadPage() before the warning is shown",
  );
  assert.match(block!, /\breturn;/);
});

test("Select all resolves to the explicit set of registered optional keys, never a hidden all-fields flag", () => {
  const fnBody = source.match(
    /function selectAllSharedFields[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(fnBody, "expected a selectAllSharedFields function");
  assert.match(
    fnBody!,
    /SHARING_OPTIONAL_FIELDS\.map\(\(field\) => field\.key\)/,
  );
});

test("the browse surface delegates waiting-first filtering to the tested workflow helper", () => {
  assert.match(source, /filterCheckinBrowseAttendees\(/);
  assert.match(source, /showArrived/);
  assert.match(source, /Show already checked-in attendees/);
});

test("only the selected attendee owns the expanded action workspace", () => {
  assert.match(source, /const \[selectedAttendeeId, setSelectedAttendeeId\]/);
  assert.match(
    source,
    /\(selectedAttendee \? \[selectedAttendee\] : \[\]\)\.map/,
  );
  assert.match(source, /Selected attendee/);
  assert.match(source, /Back to results/);
});

test("compact browse results remain keyboard-native buttons with identity confirmation", () => {
  assert.match(source, /aria-label="Check-In attendee results"/);
  assert.match(
    source,
    /<button[\s\S]*?type="button"[\s\S]*?onClick=\{\(\) => selectAttendee\(attendee\.id\)\}/,
  );
  assert.match(source, /attendee\.email \|\| "No email"/);
  assert.match(source, /attendee\.has_arrived \? "Checked in" : "Waiting"/);
});

test("the dominant workflow has one explicit Check In action and no Arrived checkbox", () => {
  assert.match(source, /saveCheckin\(attendee, true\)/);
  assert.match(source, /"Checking In\.\.\." : "Check In"/);
  assert.equal(/checked=\{current\.hasArrived\}/.test(source), false);
  assert.equal(/>\s*Save\s*</.test(source), false);
});

test("Undo Check-In is a named correction behind the canonical confirmation dialog, and no longer claims to preserve a site assignment it no longer touches", () => {
  assert.match(source, /title="Undo Check-In"/);
  assert.match(source, /confirmLabel="Undo Check-In"/);
  assert.match(source, /saveCheckin\(attendee, false\)/);
  assert.match(source, /Any current parking placement is unaffected/);
});

test("handicap need and current placement status are shown as read-only information beside Arrival", () => {
  assert.match(source, /Handicap parking needed/);
  assert.match(source, /Not yet placed/);
});

test("decision-critical identity is primary while coach and reference facts are disclosed once", () => {
  assert.match(source, /Pilot:/);
  assert.match(source, /Co-Pilot:/);
  assert.match(
    source,
    /<details[\s\S]*?Additional details[\s\S]*?Email:[\s\S]*?Coach:[\s\S]*?First Time:[\s\S]*?Volunteer:[\s\S]*?<\/details>/,
  );
  assert.match(source, /member\.person_role === "additional"/);
  assert.equal(/Coach \/ Household Members/.test(source), false);
});

test("Check-In offers only a Place in Parking handoff for an attendee who has arrived but is not yet placed -- never a site editor, occupancy check, or override control", () => {
  assert.match(source, /attendee\.has_arrived && !attendee\.assigned_site/);
  assert.match(source, /Place in Parking/);
  assert.match(
    source,
    /buildAdminAttendeeTargetHref\(\s*"\/admin\/parking",\s*attendee\.id,?\s*\)/,
  );
  for (const removed of [
    "normalizeSite",
    "siteMatchKey",
    "handleSiteNumberTyping",
    "placementAttemptKeysRef",
    "setPlacementConfirmation",
    "override_occupied_site",
    "occupiedSiteConfirmed",
  ]) {
    assert.equal(
      source.includes(removed),
      false,
      `${removed} must not remain in Arrival-only Check-In`,
    );
  }
});

test("the handoff carries only the attendee id -- buildAdminAttendeeTargetHref never receives an Event argument", () => {
  const call = source.match(
    /buildAdminAttendeeTargetHref\(\s*"\/admin\/parking",\s*attendee\.id,?\s*\)/,
  )?.[0];
  assert.ok(call, "expected the Place in Parking handoff call");
  assert.equal(/event\.id/.test(call!), false);
});

test("no occupied-site override confirmation dialog remains -- Check-In no longer displaces a placement", () => {
  assert.equal(/title="Resolve Site Conflict"/.test(source), false);
  assert.equal(/confirmLabel="Move and Check In"/.test(source), false);
  assert.equal(/placementConfirmation/.test(source), false);
});

test("sharing remains a subordinate field-level panel with a sharing-only retry", () => {
  assert.match(source, /<details[\s\S]*?Attendee Sharing[\s\S]*?<\/details>/);
  assert.match(source, /Retry Sharing Update/);
  assert.match(source, /async function retrySharingPreferences/);
  assert.equal(
    /complete_admin_checkin/.test(
      source.match(
        /async function retrySharingPreferences[\s\S]*?\n  \}/,
      )?.[0] || "",
    ),
    false,
  );
});

test("realtime reconciliation now watches only attendees -- the parking_sites channel is retired since Check-In no longer reads canonical occupancy directly", () => {
  const realtimeCalls =
    source.match(
      /loadPage\(\{ preserveSelectedEdit: true, silent: true \}\)/g,
    ) || [];
  assert.equal(
    realtimeCalls.length,
    1,
    "only the attendees realtime channel should reconcile safely",
  );
  assert.equal(/table: "parking_sites"/.test(source), false);
  assert.match(source, /table: "attendees"/);
  assert.match(source, /reconcileCheckinEditState\(/);
  assert.match(source, /editStateRef\.current/);
});

test("slower realtime loads cannot overwrite a newer server snapshot", () => {
  assert.match(source, /const generation = \+\+loadGenerationRef\.current/);
  assert.match(
    source,
    /if \(generation !== loadGenerationRef\.current\) \{\s*return;/,
  );
});

test("a remote change to the selected dirty attendee surfaces and blocks submission", () => {
  assert.match(source, /selectedAttendeeChangedRemotely\(/);
  assert.match(source, /This attendee changed at another Check-In station/);
  assert.match(source, /Record changed elsewhere/);
  assert.match(source, /Reload Current Record/);
  assert.match(
    source,
    /disabled=\{savingId === attendee\.id \|\| !!selectedConflict/,
  );
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
  assert.match(
    source,
    /check-in \(arrival\) was saved, but sharing preferences were not saved/,
  );
  assert.match(source, /Retry Sharing Update/);
  assert.match(source, /setSelectedConflict\(null\)/);
});

test("failures are categorized -- authority, lifecycle, conflict, connectivity -- and only connectivity failures receive Check-In retry", () => {
  for (const category of ["authority", "lifecycle", "conflict", "connectivity"]) {
    assert.match(source, new RegExp(`category: "${category}"`));
  }
  assert.equal(/category: "placement"/.test(source), false);
  assert.match(source, /retryable = failure\.category === "connectivity"/);
  assert.match(source, /Retry Check-In/);
});

test("a frozen/archived Event's Arrival denial is mapped to a distinct, readable message and classified as lifecycle, not authority", () => {
  assert.match(source, /event_archived:/);
  assert.match(source, /event_lifecycle_indeterminate:/);
  assert.match(source, /archived\|lifecycle/);
});

test("compact viewport keeps the primary action full-width and touch-sized", () => {
  assert.match(source, /useShellInterfaceCapabilities\(\)/);
  assert.match(source, /minHeight: 52/);
  assert.match(source, /width: isCompact \? "100%" : "auto"/);
});

test("authority and Event context continue through existing guards and canonical readers", () => {
  assert.match(source, /requiredTask="event\.checkin\.manage"/);
  assert.match(source, /getCurrentAdminEvent\(\)/);
  assert.match(source, /canAccessEvent\(admin, adminEvent\.id\)/);
  assert.equal(
    /setCurrentAdminEvent|clearCurrentAdminEvent/.test(source),
    false,
  );
});

// Task-Authority Guard Design, Check-In consumer migration -- Check-In no
// longer uses the legacy can_mark_arrived permission for route access or
// any in-page re-check; event.checkin.manage (server-enforced already by
// complete_admin_checkin) is the sole client-side authority gate.

test("Check-In no longer references the legacy can_mark_arrived permission anywhere", () => {
  assert.equal(/can_mark_arrived/.test(source), false);
  assert.equal(/requiredPermission/.test(source), false);
});

test("the duplicate in-page page-access re-check is gone -- AdminRouteGuard is the only authority gate, and no direct has_event_task_authority call replaces it", () => {
  assert.equal(/hasPermission\(/.test(source), false);
  assert.equal(/import \{[^}]*hasPermission/.test(source), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(source), false);
  assert.equal(/\.rpc\(\s*"has_event_task_authority"/.test(source), false);
});

test("Parking authority remains separate: no placement task or permission is introduced alongside the Arrival task", () => {
  assert.equal(/event\.parking\.manage/.test(source), false);
  assert.equal(/can_assign_parking|can_manage_parking/.test(source), false);
});
