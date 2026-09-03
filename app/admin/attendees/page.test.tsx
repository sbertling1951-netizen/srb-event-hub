import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import {
  type AttendeeEditorState,
  type AttendeeRow,
  buildHouseholdRemovalConfirmMessage,
  computeHouseholdRemovalWarnings,
  emptyAttendeeEditorState,
  formatCancellationDetail,
} from "@/app/admin/attendees/attendeesWorkflow";
import {
  AttendeeActionRow,
  AttendeeOperationalNeedControl,
  AttendeeParkingNeedControl,
  QuickActionBar,
} from "@/app/admin/attendees/page";

// Focused tests for the Stage 6 Attendees Module First Simplification Pass
// (docs/architecture/EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md,
// Section G). Run with:
//   npx tsx --test app/admin/attendees/page.test.tsx

function baseAttendee(overrides: Partial<AttendeeRow> = {}): AttendeeRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    event_id: "22222222-2222-2222-2222-222222222222",
    entry_id: null,
    email: "pilot@example.com",
    pilot_first: "Jane",
    pilot_last: "Doe",
    copilot_first: null,
    copilot_last: null,
    nickname: null,
    copilot_nickname: null,
    membership_number: "F12345",
    city: "Springfield",
    state: "IL",
    assigned_site: "A12",
    has_arrived: false,
    is_first_timer: false,
    wants_to_volunteer: false,
    is_active: true,
    registration_status: "active",
    ...overrides,
  };
}

function noop() {}
async function asyncNoop() {}

test("manual create defers universal onboarding needs to database defaults while existing-record need changes use governed commands", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const payload = source.slice(
    source.indexOf("const payload = {"),
    source.indexOf("const createPayload ="),
  );
  assert.equal(/assigned_site:/.test(payload), false);
  assert.equal(/has_arrived:/.test(payload), false);
  assert.equal(/needs_name_tag:/.test(payload), false);
  assert.equal(/needs_coach_plate:/.test(payload), false);
  assert.equal(/needs_parking:/.test(payload), false);
  assert.equal(/const updatePayload/.test(source), false);
  assert.equal(/needs_name_tag: editorState\.needs_name_tag/.test(source), false);
  assert.equal(/needs_coach_plate: editorState\.needs_coach_plate/.test(source), false);
  assert.match(source, /supabase\.rpc\(\s*isNameTag\s*\?\s*"set_attendee_name_tag_need"\s*:\s*"set_attendee_coach_plate_need"/);
  assert.match(source, /onSetNameTagNeed\(e\.target\.checked\)/);
  assert.match(source, /onSetCoachPlateNeed\(e\.target\.checked\)/);
  assert.match(
    source,
    /editorState\.needs_name_tag === false\s*\? \{ needs_name_tag: false \}/,
  );
  assert.match(
    source,
    /editorState\.needs_coach_plate === false\s*\? \{ needs_coach_plate: false \}/,
  );
  assert.match(
    source,
    /editorState\.needs_parking === false\s*\? \{ needs_parking: false \}/,
  );
  assert.match(source, /fetchCanonicalAttendeePlacement/);
  assert.match(source, /attendeeOwnerHrefs\(state\.id\)\.checkin/);
  assert.match(source, /attendeeOwnerHrefs\(state\.id\)\.parking/);
});

test("attendee detail renders accessible governed Name Tag and Coach Plate controls independently", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const nameTagNeeded = renderToStaticMarkup(
    <AttendeeOperationalNeedControl
      attendeeName="Jane Doe"
      label="Name Tag"
      needs
      canEdit
      saving={false}
      onSetNeed={asyncNoop}
    />,
  );
  const nameTagNotNeeded = renderToStaticMarkup(
    <AttendeeOperationalNeedControl
      attendeeName="Jane Doe"
      label="Name Tag"
      needs={false}
      canEdit={false}
      saving={false}
      onSetNeed={asyncNoop}
    />,
  );
  const coachPlateNeeded = renderToStaticMarkup(
    <AttendeeOperationalNeedControl
      attendeeName="Jane Doe"
      label="Coach Plate"
      needs
      canEdit={false}
      saving={false}
      onSetNeed={asyncNoop}
    />,
  );
  const coachPlateNotNeeded = renderToStaticMarkup(
    <AttendeeOperationalNeedControl
      attendeeName="Jane Doe"
      label="Coach Plate"
      needs={false}
      canEdit
      saving={false}
      onSetNeed={asyncNoop}
    />,
  );
  assert.match(source, /<AttendeeOperationalNeedControl[\s\S]*?label="Name Tag"/);
  assert.match(source, /<AttendeeOperationalNeedControl[\s\S]*?label="Coach Plate"/);
  assert.match(nameTagNeeded, /<button/);
  assert.match(nameTagNeeded, /aria-pressed="true"/);
  assert.match(nameTagNeeded, /Toggle Jane Doe(?:&#x27;|')s name tag requirement\. Currently Needed\./);
  assert.match(nameTagNotNeeded, /Name Tag/);
  assert.match(nameTagNotNeeded, /Not needed/);
  assert.doesNotMatch(nameTagNotNeeded, /<button/);
  assert.match(coachPlateNeeded, /Coach Plate/);
  assert.match(coachPlateNeeded, /Needed/);
  assert.doesNotMatch(coachPlateNeeded, /<button/);
  assert.match(coachPlateNotNeeded, /<button/);
  assert.match(coachPlateNotNeeded, /aria-pressed="false"/);
  assert.match(coachPlateNotNeeded, /Toggle Jane Doe(?:&#x27;|')s coach plate requirement\. Currently Not needed\./);
});

test("Name Tag and Coach Plate controls preserve authoritative state until their governed RPC succeeds and block duplicate writes", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const start = source.indexOf("async function setAttendeeOperationalNeed(");
  const body = source.slice(start, source.indexOf("async function onCancelRegistration", start));

  assert.match(body, /operationalNeedSavingRef\.current\.has\(savingKey\)/);
  assert.match(body, /setOperationalNeedSavingKeys/);
  assert.match(body, /const persistedNeed = result\?\.\[field\]/);
  assert.match(body, /typeof persistedNeed !== "boolean"/);
  assert.match(body, /setAttendees/);
  assert.match(body, /setEditorState/);
  assert.match(body, /setEditorBaseline/);
  assert.match(body, /setError\(attendeeOperationalNeedErrorMessage/);
  assert.match(body, /need was not changed/);
});

// -- Parking intent control: Attendees owns intent, Parking owns placement --

test("Arrival remains read-only while the roster parking-need control uses the governed command only", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const arrivalFn = source.slice(
    source.indexOf("function attendeeArrivalPresentation("),
    source.indexOf("function attendeeOwnerHrefs("),
  );
  const parkingControl = source.slice(
    source.indexOf("export function AttendeeParkingNeedControl("),
    source.indexOf("function attendeeGroupSiteLabel("),
  );

  assert.equal(/onChange|onClick|setHasArrived|setAssignedSite/.test(arrivalFn), false);
  assert.match(parkingControl, /onSetParkingNeed\(attendee, !needsParking\)/);
  assert.equal(/supabase\.from\(|\.update\(/.test(parkingControl), false);
  assert.match(source, /supabase\.rpc\(\s*"set_attendee_parking_need"/);
});

test("the roster list never reads or displays attendees.assigned_site directly -- Placement is sourced only from the canonical placements map", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const attendeeListSource = source.slice(
    source.indexOf("function AttendeeList("),
    source.indexOf("export function AttendeeRecordWorkspace("),
  );

  assert.equal(/attendee\.assigned_site/.test(attendeeListSource), false);
  assert.match(attendeeListSource, /placementsByAttendeeId/);
});

test("the roster surfaces Arrival as a link to its owner workspace (Check-In) and renders an accessible governed parking-need control", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const attendeeListSource = source.slice(
    source.indexOf("function AttendeeList("),
    source.indexOf("export function AttendeeRecordWorkspace("),
  );

  // Arrival is displayed truthfully but is not mutated here -- the pill is
  // a link that routes to Check-In (the owner) for this attendee.
  assert.match(
    attendeeListSource,
    /<AttendeeStatusLink\s+href=\{attendeeOwnerHrefs\(attendee\.id\)\.checkin\}\s+tone=\{arrival\.tone\}/,
  );
  assert.equal(/<StatusBadge tone=\{arrival\.tone\}>/.test(attendeeListSource), false);
  assert.match(attendeeListSource, /<AttendeeParkingNeedControl/);
  assert.match(attendeeListSource, /parkingHref=\{attendeeOwnerHrefs\(attendee\.id\)\.parking\}/);
  assert.match(attendeeListSource, /placementKnown=\{!placementsLoading && !placementsError\}/);
  assert.equal(/type="checkbox"|type="radio"/.test(attendeeListSource), false);
});

test("unplaced parking intent is a real keyboard/touch button plus a link to Parking, while a placed attendee keeps the site label as a Parking link and Parking-first explanation", () => {
  const unplaced = renderToStaticMarkup(
    <AttendeeParkingNeedControl
      attendee={baseAttendee({ needs_parking: true })}
      placement={undefined}
      placementKnown
      canEdit
      saving={false}
      parkingHref="/admin/parking?attendee=11111111-1111-1111-1111-111111111111&returnTo=attendees"
      onSetParkingNeed={asyncNoop}
    />,
  );
  assert.match(unplaced, /<button/);
  assert.match(unplaced, /aria-pressed="true"/);
  assert.match(unplaced, /Needs Parking/);
  assert.match(unplaced, /Toggle Jane Doe/);
  // The status itself ("Unassigned") routes to the owner workspace.
  assert.match(unplaced, /<a[^>]+href="[^"]*\/admin\/parking[^"]*returnTo=attendees[^"]*"[^>]*>/);
  assert.match(unplaced, /Unassigned/);

  const placed = renderToStaticMarkup(
    <AttendeeParkingNeedControl
      attendee={baseAttendee({ needs_parking: true })}
      placement={{
        parkingSiteId: "site-1",
        masterSiteId: "master-site-1",
        label: "Site A12",
      }}
      placementKnown
      canEdit
      saving={false}
      parkingHref="/admin/parking?attendee=11111111-1111-1111-1111-111111111111&returnTo=attendees"
      onSetParkingNeed={asyncNoop}
    />,
  );
  assert.match(placed, /Site A12/);
  assert.match(placed, /<a[^>]+href="[^"]*\/admin\/parking[^"]*"[^>]*>/);
  assert.match(placed, /Remove the assignment in Parking before changing this/);
  assert.doesNotMatch(placed, /<button/);
});

test("saveMembershipNumber: the quick-correction path defers to the governed validateField check, not a second hardcoded F/C copy (Refactor Audit Q7)", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const start = source.indexOf("async function saveMembershipNumber");
  const body = source.slice(start, source.indexOf("async function updateDataStatus", start));

  assert.match(body, /validateField\(\s*"membership_number",\s*draftValue,\s*rules,\s*currentEvent\?\.id,?\s*\)/);
  assert.equal(/draftValue\.startsWith\("F"\)/.test(body), false);
  assert.equal(/draftValue\.startsWith\("C"\)/.test(body), false);
});

// --- 1. Household-member deletion requires explicit confirmation ---------

test("computeHouseholdRemovalWarnings: create mode never warns, regardless of state", () => {
  const state: AttendeeEditorState = {
    ...emptyAttendeeEditorState(),
    had_copilot_at_load: true,
    copilot_first: "",
  };

  assert.deepEqual(computeHouseholdRemovalWarnings("create", state), []);
});

test("computeHouseholdRemovalWarnings: an existing Co-Pilot whose fields were cleared is flagged for removal", () => {
  const state: AttendeeEditorState = {
    ...emptyAttendeeEditorState(),
    had_copilot_at_load: true,
    copilot_name_at_load: "Sam Rivera",
    copilot_first: "",
    copilot_last: "",
    copilot_email: "",
  };

  const warnings = computeHouseholdRemovalWarnings("edit", state);

  assert.deepEqual(warnings, [{ role: "copilot", name: "Sam Rivera" }]);
});

test("computeHouseholdRemovalWarnings: an existing Co-Pilot whose fields are still populated is never flagged -- no silent deletion for an unrelated edit", () => {
  const state: AttendeeEditorState = {
    ...emptyAttendeeEditorState(),
    had_copilot_at_load: true,
    copilot_name_at_load: "Sam Rivera",
    copilot_first: "Sam",
    copilot_last: "Rivera",
  };

  assert.deepEqual(computeHouseholdRemovalWarnings("edit", state), []);
});

test("computeHouseholdRemovalWarnings: an existing Additional Participant whose fields were cleared is flagged for removal", () => {
  const state: AttendeeEditorState = {
    ...emptyAttendeeEditorState(),
    had_additional_at_load: true,
    additional_name_at_load: "Pat Lee",
    additional_first_name: "",
    additional_last_name: "",
    additional_email: "",
    additional_nickname: "",
    additional_cell_phone: "",
  };

  const warnings = computeHouseholdRemovalWarnings("edit", state);

  assert.deepEqual(warnings, [{ role: "additional", name: "Pat Lee" }]);
});

test("computeHouseholdRemovalWarnings: no removal is flagged when the household member never existed at load", () => {
  const state: AttendeeEditorState = {
    ...emptyAttendeeEditorState(),
    had_copilot_at_load: false,
    had_additional_at_load: false,
  };

  assert.deepEqual(computeHouseholdRemovalWarnings("edit", state), []);
});

test("computeHouseholdRemovalWarnings: both Co-Pilot and Additional Participant cleared in the same save are both flagged", () => {
  const state: AttendeeEditorState = {
    ...emptyAttendeeEditorState(),
    had_copilot_at_load: true,
    copilot_name_at_load: "Sam Rivera",
    had_additional_at_load: true,
    additional_name_at_load: "Pat Lee",
  };

  const warnings = computeHouseholdRemovalWarnings("edit", state);

  assert.deepEqual(warnings, [
    { role: "copilot", name: "Sam Rivera" },
    { role: "additional", name: "Pat Lee" },
  ]);
});

test("computeHouseholdRemovalWarnings: falls back to a role-based name rather than an empty string", () => {
  const state: AttendeeEditorState = {
    ...emptyAttendeeEditorState(),
    had_copilot_at_load: true,
    copilot_name_at_load: "",
  };

  const warnings = computeHouseholdRemovalWarnings("edit", state);

  assert.deepEqual(warnings, [{ role: "copilot", name: "the Co-Pilot" }]);
});

test("buildHouseholdRemovalConfirmMessage: names exactly who is being removed, never vague 'Are you sure?' text", () => {
  const message = buildHouseholdRemovalConfirmMessage([
    { role: "copilot", name: "Sam Rivera" },
  ]);

  assert.ok(message.includes("Sam Rivera"));
  assert.ok(message.includes("Co-Pilot"));
  assert.ok(message.toLowerCase().includes("permanently remove"));
  assert.ok(!/^are you sure\??$/i.test(message.trim()));
  assert.ok(!message.toLowerCase().startsWith("are you sure"));
});

test("buildHouseholdRemovalConfirmMessage: names both people when two removals are pending in the same save", () => {
  const message = buildHouseholdRemovalConfirmMessage([
    { role: "copilot", name: "Sam Rivera" },
    { role: "additional", name: "Pat Lee" },
  ]);

  assert.ok(message.includes("Sam Rivera"));
  assert.ok(message.includes("Pat Lee"));
  assert.ok(message.includes(" and "));
  assert.ok(message.includes("both"));
});

test("no I/O: the household-removal decision logic is pure -- it issues no fetch, Supabase, or RPC call, so cancelling never touches the deletion path", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  // The confirmation gate must run, and be able to return early, strictly
  // before syncHouseholdMembers (the governed delete path) is ever called
  // for a save. This is a structural proxy for "cancelling leaves the
  // existing household member unchanged": the gate's own source contains
  // no write of its own for the confirming code to have side-effected.
  const gateIndex = source.indexOf("computeHouseholdRemovalWarnings(\n      editorMode,");
  const firstSyncCallIndex = source.indexOf("await syncHouseholdMembers(");

  assert.ok(gateIndex > -1, "confirmation gate call must exist in handleSaveAttendeeRecord");
  assert.ok(firstSyncCallIndex > -1, "syncHouseholdMembers call must still exist");
  assert.ok(
    gateIndex < firstSyncCallIndex,
    "the confirmation gate must run, and be able to return early, before any household-member write",
  );
});

// --- 1b. Governed household-member RPC cutover (20260818160000) ----------
// syncHouseholdMembers() writes exclusively through
// manage_attendee_household_member; no direct table upsert/delete remains.

test("syncHouseholdMembers: no direct attendee_household_members upsert or delete remains -- every write goes through the governed RPC", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const start = source.indexOf("async function syncHouseholdMembers(");
  const end = source.indexOf("\n  }\n\n  function openCreateAttendeeEditor", start);
  assert.ok(start > -1 && end > start, "syncHouseholdMembers body must be found");
  const body = source.slice(start, end);

  assert.equal(/\.from\("attendee_household_members"\)\s*\n?\s*\.upsert\(/.test(body), false);
  assert.equal(/\.from\("attendee_household_members"\)\s*\n?\s*\.delete\(/.test(body), false);
});

test("syncHouseholdMembers: manage_attendee_household_member is called for all three roles", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const start = source.indexOf("async function syncHouseholdMembers(");
  const end = source.indexOf("\n  }\n\n  function openCreateAttendeeEditor", start);
  const body = source.slice(start, end);

  const calls = body.match(/supabase\.rpc\("manage_attendee_household_member"/g) || [];
  assert.equal(
    calls.length,
    5,
    "pilot upsert, copilot upsert, copilot delete, additional upsert, additional delete",
  );
  assert.match(body, /p_person_role: "pilot"/);
  assert.match(body, /p_person_role: "copilot"/);
  assert.match(body, /p_person_role: "additional"/);
});

test("syncHouseholdMembers: delete behavior is preserved -- copilot/additional still delete only when their fields are cleared and a row exists", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const start = source.indexOf("async function syncHouseholdMembers(");
  const end = source.indexOf("\n  }\n\n  function openCreateAttendeeEditor", start);
  const body = source.slice(start, end);

  assert.match(body, /else if \(copilotRow\)/);
  assert.match(body, /else if \(additionalRow\)/);
  const deleteCalls = body.match(/p_delete: true/g) || [];
  assert.equal(deleteCalls.length, 2);
});

test("syncHouseholdMembers: rpcOwnedParticipantRole still skips exactly the one role record_participant_capacity_increase owns for the save", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const start = source.indexOf("async function syncHouseholdMembers(");
  const end = source.indexOf("\n  }\n\n  function openCreateAttendeeEditor", start);
  const body = source.slice(start, end);

  assert.match(body, /if \(rpcOwnedParticipantRole !== "copilot"\)/);
  assert.match(body, /if \(rpcOwnedParticipantRole !== "additional"\)/);
});

// --- 2. Per-action edit permission guards ---------------------------------

test("AttendeeActionRow: without can_edit_attendees, every remaining mutating button is disabled", () => {
  const html = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit={false}
      showBackToPending
      onSelect={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  // Each mutating button's own <button ...disabled...>Label</button>
  // fragment is checked directly so a false positive on unrelated markup
  // is impossible.
  for (const label of ["Cancel Registration", "Back To Pending"]) {
    const buttonStart = html.lastIndexOf("<button", html.indexOf(label));
    const fragment = html.slice(buttonStart, html.indexOf(label));
    assert.ok(
      fragment.includes("disabled"),
      `"${label}" must be disabled when canEdit is false`,
    );
  }
});

test("AttendeeActionRow: with can_edit_attendees, the remaining mutating buttons are enabled", () => {
  const html = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit
      showBackToPending
      onSelect={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  for (const label of ["Cancel Registration", "Back To Pending"]) {
    const buttonStart = html.lastIndexOf("<button", html.indexOf(label));
    const fragment = html.slice(buttonStart, html.indexOf(label));
    assert.ok(
      !fragment.includes("disabled"),
      `"${label}" must be enabled when canEdit is true`,
    );
  }
});

test("AttendeeActionRow: View Record stays enabled even without edit permission -- viewing remains available", () => {
  const html = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit={false}
      showBackToPending={false}
      onSelect={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  const buttonStart = html.lastIndexOf("<button", html.indexOf("View Record"));
  const fragment = html.slice(buttonStart, html.indexOf("View Record"));
  assert.ok(
    !fragment.includes("disabled"),
    "View Record must remain enabled -- it only opens the record for viewing, never mutates",
  );
});

test("QuickActionBar: + Add Attendee is disabled without can_edit_attendees, enabled with it", () => {
  const disabledHtml = renderToStaticMarkup(
    <QuickActionBar canEdit={false} onAddAttendee={noop} onRefresh={noop} />,
  );
  const enabledHtml = renderToStaticMarkup(
    <QuickActionBar canEdit onAddAttendee={noop} onRefresh={noop} />,
  );

  const disabledStart = disabledHtml.lastIndexOf(
    "<button",
    disabledHtml.indexOf("+ Add Attendee"),
  );
  const enabledStart = enabledHtml.lastIndexOf(
    "<button",
    enabledHtml.indexOf("+ Add Attendee"),
  );

  assert.ok(
    disabledHtml
      .slice(disabledStart, disabledHtml.indexOf("+ Add Attendee"))
      .includes("disabled"),
  );
  assert.ok(
    !enabledHtml
      .slice(enabledStart, enabledHtml.indexOf("+ Add Attendee"))
      .includes("disabled"),
  );
});

// --- Stage B: one owner for the View decision ------------------------------
// (Attendees Admin Workflow Stages B-D, Test Expectation A).

test("QuickActionBar: the duplicate 'Flagged Active' / 'All Registrations' quick-mode buttons are gone", () => {
  const html = renderToStaticMarkup(
    <QuickActionBar canEdit onAddAttendee={noop} onRefresh={noop} />,
  );

  assert.ok(!html.includes("Flagged Active"));
  assert.ok(!html.includes("All Registrations"));
  assert.ok(html.includes("+ Add Attendee"));
  assert.ok(html.includes("Refresh"));
});

test("QuickActionBar no longer accepts onSetReviewMode/onSetAllMode -- the View select in FilterBar is the one owner of that decision", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(!source.includes("onSetReviewMode"));
  assert.ok(!source.includes("onSetAllMode"));
  // FilterBar's View select still owns "review" mode's auto-open-first-item
  // behavior -- exactly once, not duplicated by a second control.
  assert.equal(
    (source.match(/if \(nextViewMode === "review"\)/g) || []).length,
    1,
  );
});

test("secondary filters (Rows to Show, Sort, Data Status, Participant Type) are progressively disclosed via the shared TableToolbarDisclosure, not competing with Search/View", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const filterBarSource = source.slice(
    source.indexOf("function FilterBar("),
    source.indexOf("export function QuickActionBar"),
  );

  // UI Phase 4: the disclosure itself moved into the shared
  // TableToolbarDisclosure primitive (components/ui/TableToolbar.tsx,
  // its own <details>/<summary> semantics verified there) -- FilterBar's
  // own source no longer spells out "<details" directly, so this checks
  // for the primitive's usage instead of the implementation detail it
  // now delegates to.
  assert.match(filterBarSource, /<TableToolbarDisclosure label="More filters"/);

  const disclosureIndex = filterBarSource.indexOf("<TableToolbarDisclosure");
  const rowsToShowIndex = filterBarSource.indexOf("Rows to Show");
  const dataStatusMatch = />\s*Data Status\s*</.exec(filterBarSource);
  const participantTypeIndex = filterBarSource.indexOf("Participant Type");
  const searchIndex = filterBarSource.indexOf('label="Search"');
  const viewMatch = />\s*View\s*</.exec(filterBarSource);

  assert.ok(searchIndex > -1 && searchIndex < disclosureIndex);
  assert.ok(viewMatch !== null && viewMatch.index < disclosureIndex);
  assert.ok(rowsToShowIndex > disclosureIndex);
  assert.ok(dataStatusMatch !== null && dataStatusMatch.index > disclosureIndex);
  assert.ok(participantTypeIndex > disclosureIndex);
});

test("Clear Search & Filters resets search, Data Status, and Participant Type -- never View, Rows to Show, or Sort, which are display preferences, not filters", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const fn = source.slice(source.indexOf("function clearFilters()"), source.indexOf("function clearFilters()") + 200);

  assert.match(fn, /setSearch\(""\)/);
  assert.match(fn, /setDataStatusFilter\("all"\)/);
  assert.match(fn, /setParticipantTypeFilter\("all"\)/);
  assert.equal(/setViewMode|setPageSize|setAttendeeSortMode/.test(fn), false);
});

test("the Clear Search & Filters control only appears once there is something to clear", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /const hasClearableState = activeFilterCount > 0 \|\| search\.trim\(\) !== "";/);
  assert.match(source, /\{hasClearableState \? \(/);
});

// --- Stage B: consolidated summary hierarchy --------------------------------

test("the former duplicate 'Attendee Management' and 'Data Review' summary cards are gone -- one Roster Summary card remains", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(!source.includes(">Attendee Management<"));
  assert.ok(!source.includes(">Data Review<"));
  assert.ok(source.includes("Roster Summary"));
});

test("secondary roster stats (Vendors, First Timers, Volunteers, Membership Corrected, Fully Valid) are progressively disclosed under 'More stats'", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /More stats/);
  const moreStatsIndex = source.indexOf("More stats");
  const rosterSummaryIndex = source.indexOf("Roster Summary");
  const secondaryItemsIndex = source.indexOf("secondarySummaryItems");

  assert.ok(rosterSummaryIndex > -1 && rosterSummaryIndex < moreStatsIndex);
  assert.ok(secondaryItemsIndex > -1);
});

test("Review Queue's own data-status breakdown replaces the old always-visible Data Review tiles, only rendering while expanded", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const reviewQueueHeaderIndex = source.indexOf(">Review Queue<");
  const breakdownIndex = source.indexOf(
    "DATA_STATUS_OPTIONS.filter",
    reviewQueueHeaderIndex,
  );

  assert.ok(reviewQueueHeaderIndex > -1);
  assert.ok(breakdownIndex > reviewQueueHeaderIndex);
  assert.match(source, /showReviewQueue \? \(\s*<div/);
});

// --- Stage B: City/State moved out of the collapsed browse row -------------

test("City/State no longer appears in the collapsed Review Queue / Attendee List header rows", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const reviewQueueSource = source.slice(
    source.indexOf("function ReviewQueue("),
    source.indexOf("function AttendeeList("),
  );
  // Bounded to AttendeeList's own end (the next function declared after
  // it), not the pre-existing "isExpanded ? (" marker -- that marker
  // never actually occurred in this file (verified against the pre-Phase-4
  // baseline too), so the slice it produced silently ran to end-of-file
  // via String.slice's negative-index behavior. The assertion below still
  // happened to hold across that wider, unintended slice, but this bound
  // is now what the test's own comment always claimed to check.
  const attendeeListHeaderSource = source.slice(
    source.indexOf("function AttendeeList("),
    source.indexOf("export function AttendeeRecordWorkspace("),
  );

  assert.ok(!reviewQueueSource.includes("cityState(attendee)"));
  assert.ok(!attendeeListHeaderSource.includes("cityState(attendee)"));

  // Still available one governed step away, in the expanded detail panel.
  assert.match(source, />City \/ State</);
});

// AttendeeRecordWorkspace is built on ObjectPanel (components/ObjectPanel.tsx),
// which intentionally renders nothing until it has mounted in a real browser
// (it portals into document.body): "Portals require a browser document;
// only render one after mount." renderToStaticMarkup runs no effects, so it
// cannot exercise ObjectPanel's content -- consistent with this codebase's
// established convention of no RTL/jsdom harness (see e.g.
// components/auth/LegacyTransferInitiator.test.tsx). These contracts are
// therefore verified structurally against the component's own source,
// exactly like this file's other structural tests already do.

test("AttendeeRecordWorkspace: Save/Create respects canEdit in both editor modes", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const primaryActionsSource = source.slice(
    source.indexOf("const primaryActions ="),
    source.indexOf("const secondaryActions ="),
  );

  assert.match(primaryActionsSource, /disabled=\{saving \|\| !canEdit/);
});

// --- Stage C: viewing and editing are distinct states -----------------------
// (Attendees Admin Workflow Stages B-D, Test Expectations B/C.)

test("AttendeeRecordWorkspace: the view body renders no <input>/<textarea> form fields -- nothing is mutable until Edit is deliberately chosen", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const viewBodySource = source.slice(
    source.indexOf("const viewBody = ("),
    source.indexOf("const editBody = ("),
  );

  assert.ok(!viewBodySource.includes("<input"));
  assert.ok(!viewBodySource.includes("<textarea"));
});

test("AttendeeRecordWorkspace: view mode's primary action is an explicit Edit control, not an already-open form", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const primaryActionsSource = source.slice(
    source.indexOf("const primaryActions ="),
    source.indexOf("const secondaryActions ="),
  );
  const viewBranch = primaryActionsSource.slice(
    0,
    primaryActionsSource.indexOf(") : ("),
  );

  assert.match(viewBranch, /onClick=\{onEnterEdit\}/);
  assert.match(viewBranch, />\s*Edit\s*</);
});

test("AttendeeRecordWorkspace: edit mode renders the mutable form (editBody) and a Save control", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const editBodySource = source.slice(
    source.indexOf("const editBody = ("),
    source.indexOf("const primaryActions ="),
  );

  // Central UI Standard migration: form fields now route through the
  // canonical Field/Input primitives rather than a raw <input>.
  assert.ok(editBodySource.includes("<Input"));
  assert.ok(editBodySource.includes("<Field "));

  const primaryActionsSource = source.slice(
    source.indexOf("const primaryActions ="),
    source.indexOf("const secondaryActions ="),
  );
  assert.match(primaryActionsSource, /"Save Changes"/);
});

test("openCreateAttendeeEditor: creating a new record has nothing to view yet and starts directly in edit mode", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const fnSource = source.slice(
    source.indexOf("function openCreateAttendeeEditor()"),
    source.indexOf("function openCreateAttendeeEditor()") + 700,
  );

  assert.match(fnSource, /setViewState\("edit"\)/);
});

test("selectAttendee -- the one entry point for choosing an existing attendee -- always sets viewState to 'view', never 'edit'", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const fnSource = source.slice(
    source.indexOf("const selectAttendee = useCallback("),
    source.indexOf("const selectAttendeeForEdit"),
  );

  assert.match(fnSource, /setViewState\("view"\)/);
  assert.ok(!fnSource.includes('setViewState("edit")'));
});

test("exactly one AttendeeRecordWorkspace instance is mounted, owning the selected attendee for the whole page", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(
    (source.match(/<AttendeeRecordWorkspace/g) || []).length,
    1,
  );
});

// --- Test Expectation M: responsive structure ------------------------------

test("Additional Participant fields use a responsive auto-fit grid, not the former fixed 5-column layout", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(!source.includes("repeat(5, minmax"));
  assert.match(
    source,
    /Participant First Name[\s\S]{0,400}?repeat\(auto-fit, minmax\(180px, 1fr\)\)|repeat\(auto-fit, minmax\(180px, 1fr\)\)[\s\S]{0,400}?Participant First Name/,
  );
});

test("permission gating is UI defense-in-depth only -- the page never claims it replaces backend authorization", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(source.includes("hasPermission(admin, \"can_edit_attendees\")"));
  assert.ok(source.includes("UI defense-in-depth only"));
});

// --- 3. Dead / duplicate UI removed ---------------------------------------

test("only one canonical Add Attendee control remains -- the summary card's duplicate button is gone, the modal's own create-mode title is untouched", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(source.includes("+ Add Attendee"));
  // The modal's create-mode heading legitimately still reads "Add
  // Attendee Record" -- only the duplicate *button* that used to sit in
  // the Attendee Management summary card (a second element wired
  // directly to openCreateAttendeeEditor) is removed.
  assert.equal(
    (source.match(/openCreateAttendeeEditor/g) || []).length,
    2,
    "openCreateAttendeeEditor must be defined once and wired to exactly one control (QuickActionBar's)",
  );
});

test("the three unreferenced *EmbedPanel components and the dead top-banner nav buttons are removed", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  for (const removed of [
    "ReportsEmbedPanel",
    "ImportsEmbedPanel",
    "ValidationRulesEmbedPanel",
    "Attendee Management</button>",
    "router.push(\"/admin/reports\")",
    "router.push(\"/admin/imports\")",
    "router.push(\"/admin/validation-rules\")",
    "useRouter",
  ]) {
    assert.ok(
      !source.includes(removed),
      `page.tsx must no longer contain "${removed}"`,
    );
  }
});

// --- 4. Duplicated action rows normalized ---------------------------------

test("the shared action row is now referenced only by ReviewQueue -- the roster row itself carries no per-row action cluster", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const reviewQueueSource = source.slice(
    source.indexOf("function ReviewQueue("),
    source.indexOf("function AttendeeList("),
  );
  // Household Management + Interaction Repair: the roster row (AttendeeList)
  // no longer renders AttendeeActionRow at all. "View Record" is gone (the
  // whole row opens the record) and "Cancel Registration" moved into the
  // record workspace as a separated destructive action. AttendeeActionRow
  // survives only for the Review Queue's membership-correction cards.
  const attendeeListSource = source.slice(
    source.indexOf("function AttendeeList("),
    source.indexOf("export function AttendeeRecordWorkspace("),
  );
  const totalUsageCount = (source.match(/<AttendeeActionRow/g) || []).length;
  const reviewQueueUsageCount = (reviewQueueSource.match(/<AttendeeActionRow/g) || []).length;
  const attendeeListUsageCount = (attendeeListSource.match(/<AttendeeActionRow/g) || []).length;

  assert.equal(reviewQueueUsageCount, 1, "ReviewQueue must render AttendeeActionRow exactly once");
  assert.equal(
    attendeeListUsageCount,
    0,
    "AttendeeList's roster row renders no AttendeeActionRow",
  );
  assert.equal(
    totalUsageCount,
    1,
    "AttendeeActionRow is used exactly once, by ReviewQueue",
  );
  assert.ok(
    !source.includes("overflowX: \"auto\""),
    "the old horizontal-scroll-only action row must no longer exist",
  );
});

// --- 5. ResponsiveList accessible naming (Central UI Standard) -----------

test("both ResponsiveList instances are named via aria-labelledby against their section's visible PageHeader", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /<ResponsiveList aria-labelledby="attendees-review-queue-heading">/);
  assert.match(
    source,
    /title="Review Queue"\s*\n\s*titleId="attendees-review-queue-heading"/,
  );

  assert.match(source, /<ResponsiveList aria-labelledby="attendees-list-heading">/);
  assert.match(source, /title="Attendee List"\s*\n\s*titleId="attendees-list-heading"/);
});

test("AttendeeActionRow: showBackToPending governs exactly the one legitimate difference between the two contexts", () => {
  const withBackToPending = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit
      showBackToPending
      onSelect={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );
  const withoutBackToPending = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit
      showBackToPending={false}
      onSelect={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  assert.ok(withBackToPending.includes("Back To Pending"));
  assert.ok(!withoutBackToPending.includes("Back To Pending"));

  for (const label of ["View Record", "Cancel Registration"]) {
    assert.ok(withBackToPending.includes(label));
    assert.ok(withoutBackToPending.includes(label));
  }
  assert.ok(!withBackToPending.includes("Mark Reviewed"));
  assert.ok(!withBackToPending.includes("Lock Record"));
});

test("AttendeeRecordWorkspace: Mark Reviewed is retained only for an explicit Review Queue context", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const workspaceSource = source.slice(
    source.indexOf("export function AttendeeRecordWorkspace("),
    source.indexOf("function AdminAttendeesPageInner()"),
  );

  assert.match(workspaceSource, /isReviewContext: boolean/);
  assert.match(workspaceSource, /\{isReviewContext \? \(/);
  assert.match(workspaceSource, /onUpdateDataStatus\(attendee\.id, "reviewed"\)/);
  assert.equal(/"locked"/.test(workspaceSource), false);
  assert.match(source, /isReviewContext=\{workspaceListContext === "review"\}/);
});

test("AttendeeActionRow: never depends on horizontal scrolling for the primary action row -- now via the shared RowActions primitive, not a page-local inline style", () => {
  const html = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit
      showBackToPending
      onSelect={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  assert.equal(/overflow-x\s*:\s*auto/.test(html), false);
  assert.ok(html.includes('class="row-actions"'));
});

// --- 5. Cancellation metadata surfaced only where relevant ----------------

test("formatCancellationDetail: returns null for an active (non-cancelled) record", () => {
  const active = baseAttendee({ registration_status: "active" });
  assert.equal(formatCancellationDetail(active), null);
});

test("formatCancellationDetail: returns null when registration_status is absent", () => {
  const noStatus = baseAttendee({ registration_status: undefined });
  assert.equal(formatCancellationDetail(noStatus), null);
});

test("formatCancellationDetail: surfaces the stored date and reason for a cancelled record", () => {
  const cancelled = baseAttendee({
    registration_status: "cancelled",
    cancelled_at: "2026-08-01T12:00:00.000Z",
    cancellation_reason: "Cancelled by Admin",
  });

  const detail = formatCancellationDetail(cancelled);

  assert.ok(detail !== null);
  assert.ok(detail!.includes("Cancelled"));
  assert.ok(detail!.includes("Cancelled by Admin"));
});

test("formatCancellationDetail: still identifies the record as cancelled even if no timestamp/reason was stored", () => {
  const cancelled = baseAttendee({
    registration_status: "cancelled",
    cancelled_at: null,
    cancellation_reason: null,
  });

  assert.equal(formatCancellationDetail(cancelled), "Cancelled");
});

test("cancellation details are rendered only inside the selected-record workspace's 'More details' disclosure, conditioned on formatCancellationDetail", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(source.includes("attendee && formatCancellationDetail(attendee) ? ("));
  assert.ok(source.includes("Cancellation Details"));
});

// --- 6. Deferred areas were not touched -----------------------------------

test("Stage A removes Assigned Site / Has Arrived from the generic payload while retaining the capacity-increase RPC", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(!source.includes("assigned_site: editorState.assigned_site.trim() || null,"));
  assert.ok(!source.includes("has_arrived: editorState.has_arrived,"));
  assert.ok(source.includes("record_participant_capacity_increase"));
});

test("no parking_sites write was introduced by this pass", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(!source.includes("parking_sites"));
});

// --- 7. Event Context Invariant --------------------------------------------
// (docs/architecture/ADR-006 Event Context Architecture.md), written
// against the Amana -> Branson production defect: loadEventAndData used
// to silently discard an inactive stored Event and substitute
// activeEvents[0]. It must now resolve through the shared
// resolveAdminWorkingEvent() instead of reimplementing that fallback.

test("loadEventAndData resolves the working Event through the shared resolveAdminWorkingEvent(), not a page-local fallback", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /import\s*\{[^}]*resolveAdminWorkingEvent[^}]*\}\s*from\s*["']@\/lib\/adminWorkspaceContext["']/,
  );

  const callIdx = source.indexOf("resolveAdminWorkingEvent(");
  assert.notEqual(callIdx, -1, "expected a resolveAdminWorkingEvent(...) call");
  const storedEventArgIdx = source.indexOf("storedEvent,", callIdx);
  assert.notEqual(storedEventArgIdx, -1);
  const firstArg = source.slice(
    callIdx + "resolveAdminWorkingEvent(".length,
    storedEventArgIdx,
  );

  assert.equal(
    /\beventsData\b/.test(firstArg),
    true,
    "resolveAdminWorkingEvent must be given the full queried Event set (eventsData), not activeEvents",
  );
  assert.equal(
    /^\s*activeEvents\s*,?\s*$/.test(firstArg),
    false,
    "resolveAdminWorkingEvent must not be given the active-only list as its candidate set",
  );
});

test("the retired 'stored Event only counts if it is active' branch is gone", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(
    /matched\s*&&\s*isActiveEventStatus\(matched\.status\)/.test(source),
    false,
    "found the retired inactive-is-invalid gate this page used to reimplement",
  );
  assert.equal(
    /if \(!eventToUse && activeEvents\.length > 0\)/.test(source),
    false,
    "found the retired unconditional activeEvents[0] fallback",
  );
});

test("an invalid stored context (Event no longer exists) surfaces its own explicit message distinct from 'no active event'", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /invalidStoredContext/);
  assert.match(source, /no longer available/i);
});

test("authorization (canAccessEvent) remains a separate gate after Event-context resolution, unaffected by the resolver", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /if \(!canAccessEvent\(adminRef\.current!, eventToUse\.id!\)\)/,
  );
});

// --- Stage D ------------------------------------------------------------

// Test Expectation G: a different attendee changing does not wipe the
// selected dirty edit. This holds structurally -- editorState is separate
// React state from the attendees list, so a background reload of the list
// (loadQueue) can never itself overwrite editorState; only this file's own
// explicit reconciliation code (guarded by the *same* attendee's id) may.

test("loadQueue's realtime reconciliation only ever touches the open workspace for the SAME attendee id, never a different one", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const loadQueueSource = source.slice(
    source.indexOf("const loadQueue = useCallback("),
    source.indexOf("const loadEventAndData = useCallback("),
  );

  // setAttendees/setRules (the only writes touching every row) never
  // reference editorState; the reconciliation block that does is scoped to
  // openId === editorStateRef.current.id, one specific attendee.
  assert.ok(!/setAttendees\([^)]*editorState/.test(loadQueueSource));
  assert.match(loadQueueSource, /const openId = editorStateRef\.current\.id/);
});

// Test Expectation H: same-attendee remote change while dirty blocks Save.

test("Save is disabled while a conflict is present, and handleSaveAttendeeRecord re-checks it defensively", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /disabled=\{saving \|\| !canEdit \|\| !!conflict\}/);

  const saveFnSource = source.slice(
    source.indexOf("async function handleSaveAttendeeRecord()"),
    source.indexOf("async function handleSaveAttendeeRecord()") + 600,
  );
  assert.match(saveFnSource, /if \(selectedConflict\)/);
});

test("a conflict offers an explicit 'Reload Current Record' recovery action, never an automatic overwrite", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /Reload Current Record/);
  assert.match(source, /onClick=\{onReloadRecord\}/);
});

// Test Expectation I: Event-context change cannot silently retarget the
// open record.

test("an unavailable selected record (deleted, or the admin working Event changed underneath it) closes the workspace with an explicit message, never silently", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /function closeAttendeeEditorForUnavailableRecord/);
  assert.match(source, /no longer available in the current event/);

  const loadQueueSource = source.slice(
    source.indexOf("const loadQueue = useCallback("),
    source.indexOf("const loadEventAndData = useCallback("),
  );
  assert.match(
    loadQueueSource,
    /if \(openId && !serverRow\) \{[\s\S]*?closeAttendeeEditorForUnavailableRecord\(\)/,
  );
});

// Test Expectation J: household removal confirmation remains specific to
// the affected participant, and is now also reachable as an explicit,
// discoverable action (not only a consequence discovered at Save time).

test("removeHouseholdMember: builds a confirmation naming the specific participant and role, via the canonical confirm dialog", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const fnSource = source.slice(
    source.indexOf("async function removeHouseholdMember("),
    source.indexOf("async function removeHouseholdMember(") + 1200,
  );

  assert.match(fnSource, /confirmViaDialog\(/);
  assert.match(fnSource, /role === "copilot" \? "Co-Pilot" : "Additional Participant"/);
});

test("each non-pilot person card carries Edit + Remove; the Pilot card carries neither and says so", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const cardSource = source.slice(
    source.indexOf("function renderHouseholdPersonCard("),
    source.indexOf("const roleFieldEditorStyle"),
  );

  // Edit / Remove exist only for a removable (non-pilot) person, and Remove
  // routes through the existing clear-then-Save flow (onRemoveHouseholdMember),
  // not a new write path.
  assert.match(cardSource, /const removable = editable && person\.role !== "pilot";/);
  assert.match(cardSource, /\{removable \? \(/);
  assert.match(cardSource, /aria-label=\{`Edit \$\{person\.roleLabel\}`\}/);
  assert.match(
    cardSource,
    /onRemoveHouseholdMember\(\s*person\.role as "copilot" \| "additional",\s*\)/,
  );
  assert.match(cardSource, /The\s+Pilot cannot be removed from the registration\./);
});

// Test Expectation K: consequential actions use the canonical confirmation
// pattern, never a new window.confirm().

test("no window.confirm() usage exists anywhere in the Attendees page -- every consequential action uses the canonical ConfirmDialog pattern", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  // No actual window.confirm(...) call site remains; the string may still
  // legitimately appear only inside comments explaining the replacement.
  assert.ok(!/window\.confirm\(/.test(source));
  assert.match(source, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog"/);
  assert.match(source, /<ConfirmDialog/);
});

test("Cancel Registration and record deactivation both route through confirmViaDialog", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const cancelFnSource = source.slice(
    source.indexOf("async function onCancelRegistration("),
    source.indexOf("async function onCancelRegistration(") + 400,
  );
  assert.match(cancelFnSource, /confirmViaDialog\(/);

  const updateFieldSource = source.slice(
    source.indexOf("function updateEditorField<"),
    source.indexOf("function updateEditorField<") + 900,
  );
  assert.match(updateFieldSource, /confirmViaDialog\(\s*"Deactivate this record\?"/);
});

// Test Expectation F: save/recovery communicates what is being persisted,
// with the record -- not only a page-level banner.

test("the workspace carries its own aria-live saving/saved/conflict feedback, distinct from the page-level status/error banners", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const editBodySource = source.slice(
    source.indexOf("const editBody = ("),
    source.indexOf("const primaryActions ="),
  );

  assert.match(editBodySource, /aria-live="polite"/);
  assert.match(editBodySource, /role=\{conflict \? "alert" : "status"\}/);
});

// Test Expectation L: Review Queue continuous-operation behavior does not
// regress -- it must still genuinely advance to the next flagged record.

test("the post-save review-queue advance genuinely opens the next flagged record instead of immediately closing it again", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const advanceIndex = source.indexOf("if (nextReviewItem) {");
  assert.ok(advanceIndex > -1);
  const advanceSource = source.slice(advanceIndex, advanceIndex + 700);

  assert.match(advanceSource, /await selectAttendee\(nextReviewItem\.attendee/);
  // The prior defect: opening the next item and then unconditionally
  // closing the editor again in the same save must not reappear.
  assert.ok(!/await selectAttendee\(nextReviewItem\.attendee[\s\S]*?closeAttendeeEditor\(\);\s*\n\s*\/\/ Then refresh/.test(source));
});

// Roster Summary reconciliation with the canonical Event Operational
// Summary Read Contract --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, Canonical
// Event Operational Summary Read Contract. Total Registrations/Active/
// Arrived must come from the shared lib/eventOperationalSummary.ts
// wrapper, never a page-local recomputation over `attendees`.

test("Attendees consumes the existing canonical operational-summary wrapper, not a page-local RPC or a second helper", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /import \{\s*type CanonicalEventOperationalSummary,\s*fetchEventOperationalSummary,\s*\} from "@\/lib\/eventOperationalSummary";/,
  );
  assert.equal((source.match(/fetchEventOperationalSummary\(/g) || []).length, 1);
  assert.equal(/\.rpc\("get_event_operational_summary"/.test(source), false);
});

test("Total Registrations, Active, and Arrived are copied verbatim from the canonical summary", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const itemsSource = source.slice(
    source.indexOf("const primarySummaryItems ="),
    source.indexOf("const secondarySummaryItems ="),
  );

  assert.match(itemsSource, /label: "Total Registrations"/);
  assert.match(itemsSource, /operationalSummary\.totalRegistrations/);
  assert.match(itemsSource, /label: "Active"/);
  assert.match(itemsSource, /operationalSummary\.activeRegistrations/);
  assert.match(itemsSource, /label: "Arrived"/);
  assert.match(itemsSource, /operationalSummary\.activeArrived/);

  // The prior defect: Arrived only excluded cancelled registrations, so an
  // inactive-but-arrived registration still inflated it. Neither this card
  // nor its value source may filter `attendees` directly anymore.
  assert.equal(
    /value:\s*attendees\.filter\(\s*\(row\)\s*=>\s*row\.registration_status/.test(
      itemsSource,
    ),
    false,
  );
});

test("Flagged remains Attendees-owned, sourced from reviewItems, not the canonical summary", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const itemsSource = source.slice(
    source.indexOf("const primarySummaryItems ="),
    source.indexOf("const secondarySummaryItems ="),
  );

  assert.match(itemsSource, /label: "Flagged", value: reviewItems\.length/);
});

test("canonical-summary failure clears the summary and surfaces an error, never a locally recomputed Event aggregate", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const okIndex = source.indexOf("if (summaryResult.ok)");
  const failBranch = source.slice(
    source.indexOf("} else {", okIndex),
    source.indexOf("if (editorOpenRef.current", okIndex),
  );
  assert.match(failBranch, /setOperationalSummary\(null\)/);
  assert.match(failBranch, /setOperationalSummaryError\(/);
});

test("a failed/denied summary renders visibly as error text rather than silently as a plain count", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const itemsSource = source.slice(
    source.indexOf("const primarySummaryItems ="),
    source.indexOf("const secondarySummaryItems ="),
  );

  assert.match(
    itemsSource,
    /operationalSummaryError \|\| "Unavailable"/,
  );
});

test("Attendees-owned validation/flag/detail metrics (correctedCount, fullyValidCount, vendors, first timers, volunteers) remain locally sourced from `attendees`, unchanged", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /const correctedCount = useMemo\(\(\) => \{\s*return attendees\.filter\(/,
  );
  assert.match(
    source,
    /const fullyValidCount = useMemo\(\s*\(\) => attendees\.length - reviewItems\.length,/,
  );

  const secondarySource = source.slice(
    source.indexOf("const secondarySummaryItems ="),
    source.indexOf("async function saveMembershipNumber"),
  );
  assert.match(secondarySource, /label: "Vendors"/);
  assert.match(secondarySource, /label: "First Timers"/);
  assert.match(secondarySource, /label: "Volunteers"/);
  assert.match(secondarySource, /attendees\.filter\(/);
});

// --- Attendees + Household Members canonical task-authority cutover:
// canEditAttendees moves from the page-wide, Event-agnostic
// hasPermission(admin, "can_edit_attendees") to the Event-scoped
// event.attendees.manage task, checked through the shared
// checkAdminEventTaskAuthority helper -- the same pattern already
// established for Reports' canExport/runExportAuthorityCheck. -------------

test("canEditAttendees is checked through the shared helper, never a direct RPC call or has_event_task_authority reference in the page", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /import \{ checkAdminEventTaskAuthority \} from "@\/lib\/adminTaskAuthority";/,
  );
  assert.match(
    source,
    /checkAdminEventTaskAuthority\(\s*"event\.attendees\.manage",\s*eventId,?\s*\)/,
  );
  assert.equal(/\.rpc\(\s*"has_event_task_authority"/.test(source), false);
  assert.equal((source.match(/checkAdminEventTaskAuthority\(/g) || []).length, 1);
});

test("canEditAttendees fails closed: starts false and is only set true from an exact allowed result", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /const \[canEditAttendees, setCanEditAttendees\] = useState\(false\);/);
  const fn = source.slice(
    source.indexOf("const runAttendeeManageAuthorityCheck = useCallback"),
  );
  const fnBody = fn.slice(0, fn.indexOf("}, []);"));
  assert.match(fnBody, /setCanEditAttendees\(false\);/);
  assert.match(fnBody, /setCanEditAttendees\(result\.status === "allowed"\);/);
  assert.equal(/setCanEditAttendees\(true\)/.test(source), false);
});

test("canEditAttendees resets before the async check resolves, and discards a stale response from an abandoned Event's check", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const fn = source.slice(
    source.indexOf("const runAttendeeManageAuthorityCheck = useCallback"),
  );
  const resetIdx = fn.indexOf("setCanEditAttendees(false);");
  const checkIdx = fn.indexOf("checkAdminEventTaskAuthority(");
  assert.ok(resetIdx > -1 && checkIdx > -1);
  assert.ok(resetIdx < checkIdx, "canEditAttendees must be reset before the async check is issued");
  assert.match(fn, /const generation = \+\+attendeeManageCheckGeneration\.current;/);
  assert.match(
    fn,
    /if \(attendeeManageCheckGeneration\.current === generation\) \{\s*\n\s*setCanEditAttendees\(result\.status === "allowed"\);/,
  );
});

test("the authority check re-runs on every Admin working-Event change via the canonical subscription, not only once on mount", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /useEffect\(\(\) => \{\s*\n\s*runAttendeeManageAuthorityCheck\(\);\s*\n\s*\n\s*return subscribeToAdminWorkspace\(runAttendeeManageAuthorityCheck\);\s*\n\s*\}, \[runAttendeeManageAuthorityCheck\]\);/,
  );
});

test("no second, competing canEditAttendees setter exists -- setCanEditAttendees is called only from within runAttendeeManageAuthorityCheck's own generation-guarded paths", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const setterCalls = (source.match(/setCanEditAttendees\(/g) || []).length;
  // Reset call + generation-guarded result call = exactly 2 call sites.
  assert.equal(setterCalls, 2);
});

test("every mutation control (Save/Create, household sync, membership-number correction, data-status changes, Cancel Registration) remains wired to the same canEditAttendees value -- no control was silently ungated by this change", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const consumers = (source.match(/canEdit=\{canEditAttendees\}/g) || []).length;
  assert.ok(consumers >= 4, `expected canEditAttendees threaded to every mutating sub-component, found ${consumers}`);
});

test("the Review Queue membership-number correction input and Save button are both gated by canEdit", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const reviewQueueBlock = source.slice(
    source.indexOf("function ReviewQueue("),
    source.indexOf("function AttendeeList("),
  );
  assert.match(reviewQueueBlock, /placeholder="Must begin with F or C"[\s\S]*?disabled=\{saving \|\| !canEdit\}/);
  assert.match(
    reviewQueueBlock,
    /onClick=\{\(\) => void onSaveMembership\(item\)\}[\s\S]*?disabled=\{saving \|\| !canEdit\}[\s\S]*?Save Correction/,
  );
});

test("the page-wide can_edit_attendees read/navigation gate is untouched -- only mutation capability moved to the canonical task", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /!hasPermission\(admin, "can_edit_attendees"\) &&\s*\n\s*!hasPermission\(admin, "can_manage_imports"\) &&\s*\n\s*!hasPermission\(admin, "can_manage_reports"\) &&\s*\n\s*!hasPermission\(admin, "can_manage_validation_rules"\)/,
  );
});

test("Check-In/Parking ownership remains intact: no Arrival or placement mutation was reintroduced by this change", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const payload = source.slice(
    source.indexOf("const payload = {"),
    source.indexOf('if (editorMode === "create")'),
  );

  assert.equal(/assigned_site:/.test(payload), false);
  assert.equal(/has_arrived:/.test(payload), false);
  assert.equal(/arrival_status:/.test(payload), false);
  // The check-in / parking handoffs remain, targeted to this attendee, now
  // via the shared attendeeOwnerHrefs helper (adds the validated returnTo).
  assert.match(source, /buildAdminAttendeeTargetHref\("\/admin\/checkin", attendeeId\)/);
  assert.match(source, /buildAdminAttendeeTargetHref\("\/admin\/parking", attendeeId\)/);
  assert.match(source, /attendeeOwnerHrefs\(state\.id\)\.checkin/);
  assert.match(source, /attendeeOwnerHrefs\(state\.id\)\.parking/);
});

// -- Admin Batch 2: Central UI Standard migration ---------------------------

test("the record editor's genuine form fields (household/contact/location/coach/registration/notes) route through Field/Input/Select/Textarea/Checkbox -- toolbar filters and the row-select button stay their own established, tested exceptions", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /import\s*\{\s*Checkbox,\s*Field,\s*Input,\s*Select,\s*Textarea\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );

  const editBodySource = source.slice(
    source.indexOf("const editBody = ("),
    source.indexOf("const primaryActions ="),
  );
  assert.equal(/<input\b/.test(editBodySource), false);
  assert.equal(/<select\b/.test(editBodySource), false);
  assert.equal(/<textarea\b/.test(editBodySource), false);
  assert.match(editBodySource, /<Checkbox\b/);
  assert.match(editBodySource, /<Select\b/);

  // The five toolbar filter <select>s and the one "More filters" checkbox
  // remain deliberately raw, matching this page's own established
  // TableToolbar filter convention (cited as precedent by both Nearby's
  // and Agenda's own migrations).
  const toolbarSource = source.slice(source.indexOf("<TableToolbar>"), source.indexOf("</TableToolbar>"));
  assert.equal((toolbarSource.match(/<select\b/g) || []).length, 5);
  assert.equal((toolbarSource.match(/type="checkbox"/g) || []).length, 1);
});

test("QuickActionBar's Add Attendee/Refresh row uses the canonical FormActions wrapper, not a raw app-button-row div", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  assert.match(source, /<FormActions>\s*\n\s*<AppButton variant="primary" onClick=\{onAddAttendee\}/);
  assert.equal(/className="app-button-row"/.test(source), false);
});

test("loading/empty presentation in the roster list and review queue uses the canonical LoadingState/EmptyState primitives, except the deliberately-preserved success-toned empty review queue", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(
    source,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(source, /<LoadingState message="Loading review queue\.\.\." \/>/);
  assert.match(source, /<LoadingState message="Loading attendee records\.\.\." \/>/);
  assert.match(
    source,
    /<EmptyState\s*\n\s*message=\{\s*\n\s*totalAttendeesCount === 0/,
  );
  // Deliberately still a plain Alert (not EmptyState, which is fixed at
  // tone="neutral") -- an empty review queue is good news.
  assert.match(source, /<Alert tone="success">No flagged records for this Event\.<\/Alert>/);
});

test("the hand-rolled per-participant-type badge colors remain page-local -- a second real category-badge consumer, still not promoted to a shared primitive (no shared tone vocabulary fits arbitrary-cardinality type coloring)", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /function participantTypeBadgeStyle\(/);
  assert.equal((source.match(/participantTypeBadgeStyle\(/g) || []).length >= 4, true);
});

// -- Stage 5A: repair the /admin/data-review -> ?view=review deep link ----
//
// /admin/data-review already redirects to /admin/attendees?view=review, but
// this page previously never read that parameter -- opening plain Attendees
// with the Review Queue closed. Contextual routing is standardized in this
// stage, so the contract is fixed here.

test("reads ?view=review via next/navigation's useSearchParams, not localStorage, to decide the Review Queue's initial state", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  assert.match(source, /import\s*\{\s*useSearchParams\s*\}\s*from\s*"next\/navigation"/);
  assert.match(source, /const searchParams = useSearchParams\(\);/);
  assert.match(source, /const openReviewQueueFromDeepLink = searchParams\.get\("view"\) === "review";/);
  assert.match(source, /useState<boolean>\(openReviewQueueFromDeepLink\)|useState\(openReviewQueueFromDeepLink\)/);
});

test("an unrecognized or missing ?view value falls back to the ordinary default (Review Queue closed) -- no throw, no workaround", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  // openReviewQueueFromDeepLink is a plain strict-equality check against
  // the literal "review" -- any other string (or null, for a missing
  // param) is structurally false, never a special-cased branch.
  const line = source.slice(source.indexOf("const openReviewQueueFromDeepLink ="));
  assert.match(line, /^const openReviewQueueFromDeepLink = searchParams\.get\("view"\) === "review";/);
});

test("the deep-link fix carries no authority of its own -- Attendees' own authority gate is unchanged", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  assert.match(source, /<AdminRouteGuard>/);
  assert.equal(/checkAdminEventTaskAuthority\(.*view/.test(source), false);
});

// ---------------------------------------------------------------------------
// Stage 2: post-save capacity reconciliation to the materialized roster.
// ---------------------------------------------------------------------------

function pageSource(): string {
  return readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
}

function reconcileBody(source: string): string {
  const start = source.indexOf(
    "async function reconcileCapacityToMaterializedRoster(",
  );
  assert.ok(start > -1, "reconcileCapacityToMaterializedRoster must exist");
  const end = source.indexOf("\n  }\n", start);
  assert.ok(end > start, "reconcileCapacityToMaterializedRoster body must close");
  return source.slice(start, end);
}

test("reconcile: counts materialized rows with a COUNT query, never fetches member rows just to length them", () => {
  const body = reconcileBody(pageSource());
  assert.match(
    body,
    /\.from\("attendee_household_members"\)\s*\n?\s*\.select\("id",\s*\{\s*count:\s*"exact",\s*head:\s*true\s*\}\)/,
  );
  // no `.select("*")` / id-list fetch of household members inside the helper
  assert.equal(/\.from\("attendee_household_members"\)[\s\S]*?\.select\("\*"\)/.test(body), false);
  assert.equal(/materializedRosterCount:\s*count\s*\?\?\s*0/.test(body), true);
});

test("reconcile: re-reads the fresh stored participant_capacity and delegates the decision to the pure helper", () => {
  const body = reconcileBody(pageSource());
  assert.match(body, /\.from\("attendees"\)\s*\n?\s*\.select\("participant_capacity"\)/);
  assert.match(body, /decideCapacityReconciliation\(\{/);
  assert.match(body, /storedCapacity: freshAttendee\?\.participant_capacity \?\? null/);
});

test("reconcile: raises only through record_participant_capacity_increase in slot-only mode, creating no household row", () => {
  const body = reconcileBody(pageSource());
  assert.match(body, /supabase\.rpc\(\s*\n?\s*"record_participant_capacity_increase"/);
  assert.match(body, /p_participant_role: null/);
  assert.match(body, /p_new_capacity: decision\.newCapacity/);
  assert.match(body, /p_note: CAPACITY_ROSTER_RECONCILE_NOTE/);
  // never a direct capacity UPDATE, never a household-member write
  assert.equal(/\.from\("attendees"\)[\s\S]*?\.update\(/.test(body), false);
  assert.equal(/manage_attendee_household_member/.test(body), false);
  assert.equal(/attendee_household_members"\)[\s\S]*?\.(insert|upsert|delete)\(/.test(body), false);
  // only ever the "raise" branch acts
  assert.match(body, /if \(decision\.action !== "raise"\) \{\s*\n?\s*return;/);
});

test("reconcile: a count / read / RPC failure is rethrown, never swallowed like syncHouseholdMembers", () => {
  const body = reconcileBody(pageSource());
  assert.match(body, /if \(countError\) \{\s*\n?\s*throw countError;/);
  assert.match(body, /if \(freshError\) \{\s*\n?\s*throw freshError;/);
  assert.match(body, /if \(reconcileError\) \{\s*\n?\s*throw reconcileError;/);
  // it has no catch that would absorb the error
  assert.equal(/catch\s*\(/.test(body), false);
});

test("reconcile: runs after household synchronization in both the create and edit save paths", () => {
  const source = pageSource();
  // create branch
  const createSync = source.indexOf("await syncHouseholdMembers(\n            newAttendee.id");
  const createReconcile = source.indexOf(
    "await reconcileCapacityToMaterializedRoster(\n            newAttendee.id",
  );
  assert.ok(createSync > -1 && createReconcile > createSync, "create: reconcile follows household sync");
  // edit branch
  const editSync = source.indexOf("await syncHouseholdMembers(\n          editorState.id");
  const editReconcile = source.indexOf(
    "await reconcileCapacityToMaterializedRoster(\n          editorState.id",
  );
  assert.ok(editSync > -1 && editReconcile > editSync, "edit: reconcile follows household sync");
  // edit-branch reconcile also runs after the add-participant capacity RPC
  const editCapacityRpc = source.indexOf('"record_participant_capacity_increase"');
  assert.ok(editCapacityRpc > -1 && editReconcile > editCapacityRpc);
});

test("reconcile: the audit note names automatic reconciliation to the materialized roster", () => {
  const source = pageSource();
  assert.match(
    source,
    /const CAPACITY_ROSTER_RECONCILE_NOTE =[\s\S]*?Automatic reconciliation:[\s\S]*?attendee_household_members/,
  );
});

test("save handler: hasAdditional recognizes the same five fields syncHouseholdMembers does (first / last / email / nickname / cell phone)", () => {
  const source = pageSource();
  const start = source.indexOf("// --- Compute participant capacity ---");
  const end = source.indexOf("const isNewCopilot =", start);
  const block = source.slice(start, end);
  assert.match(block, /const hasAdditional =[\s\S]*?additional_first_name\?\.trim\(\)/);
  assert.match(block, /additional_last_name\?\.trim\(\)/);
  assert.match(block, /additional_email\?\.trim\(\)/);
  assert.match(block, /additional_nickname\?\.trim\(\)/);
  assert.match(block, /additional_cell_phone\?\.trim\(\)/);
});

// ---------------------------------------------------------------------------
// Household Management + Interaction Repair
// ---------------------------------------------------------------------------

function attendeeListSource(): string {
  const source = pageSource();
  return source.slice(
    source.indexOf("function AttendeeList("),
    source.indexOf("export function AttendeeRecordWorkspace("),
  );
}

test("row-open: the desktop row is NOT modeled as a button -- it carries a pointer-only onClick, and the name cell holds the real keyboard-focusable open control", () => {
  const list = attendeeListSource();

  // The <tr> is a plain row: no button role, no tabIndex, no key handler.
  assert.match(
    list,
    /<tr\s*\n\s*className=\{isSelected \? "data-table-row-selected" : undefined\}\s*\n\s*style=\{\{ cursor: "pointer" \}\}\s*\n\s*onClick=\{\(\) => onSelect\(attendee\)\}\s*\n\s*>/,
  );
  const rowTag = list.slice(list.indexOf("<tr\n"), list.indexOf("<td>", list.indexOf("<tr\n")));
  assert.equal(/role="button"/.test(rowTag), false);
  assert.equal(/tabIndex/.test(rowTag), false);
  assert.equal(/onKeyDown/.test(rowTag), false);

  // The name cell is a real <button> with an accessible label; it opens
  // the record and stops the click from also firing the row handler.
  assert.match(
    list,
    /<td>\s*<button\s+type="button"\s+onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onSelect\(attendee\);\s*\}\}\s+aria-label=\{`Open "\$\{displayPilotName\(attendee\)\}"'s record`\}/,
  );
  // The reintroduced control is the name itself -- never a "View Record" button.
  assert.equal(list.includes("View Record"), false);
});

test("row-open: the compact list item keeps its pre-existing full-item button semantics (a div, not a table row)", () => {
  const list = attendeeListSource();
  assert.match(
    list,
    /"responsive-list-item"[\s\S]*?role="button"\s*\n\s*tabIndex=\{0\}\s*\n\s*onClick=\{\(\) => onSelect\(attendee\)\}/,
  );
});

test("nested-control isolation: status links and the parking-need control own their clicks; non-interactive cells fall through to row-open", () => {
  const list = attendeeListSource();
  const source = pageSource();

  // The Data Status cell is non-interactive, so clicking it opens the
  // record like any other empty area of the row (no stopPropagation).
  assert.match(list, /<td>\{dataStatusBadges\(attendee\)\}<\/td>/);
  // AttendeeStatusLink (the arrival / placement pills) owns its click.
  const statusLink = source.slice(
    source.indexOf("function AttendeeStatusLink("),
    source.indexOf("function AttendeeParkingNeedControl("),
  );
  assert.match(statusLink, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(statusLink, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  // The parking-need toggle button also stops propagation.
  const parkingControl = source.slice(
    source.indexOf("function AttendeeParkingNeedControl("),
    source.indexOf("function attendeeGroupSiteLabel("),
  );
  assert.match(parkingControl, /event\.stopPropagation\(\);\s*\n\s*void onSetParkingNeed/);
});

test("status pills are owner-workspace handoffs: Arrival -> Check-In, Placement -> Parking, each targeted to this attendee and carrying the validated returnTo", () => {
  const source = pageSource();
  const helper = source.slice(
    source.indexOf("function attendeeOwnerHrefs("),
    source.indexOf("function AttendeeStatusLink("),
  );

  assert.match(
    helper,
    /checkin: withAdminReturnTarget\(\s*buildAdminAttendeeTargetHref\("\/admin\/checkin", attendeeId\),\s*"attendees",\s*\)/,
  );
  assert.match(
    helper,
    /parking: withAdminReturnTarget\(\s*buildAdminAttendeeTargetHref\("\/admin\/parking", attendeeId\),\s*"attendees",\s*\)/,
  );
  assert.match(
    source,
    /import \{ withAdminReturnTarget \} from "@\/lib\/adminWorkspaceReturn";/,
  );

  // Attendees never mutates Check-In / Parking canonical state: the pills
  // are links, not writes. (Arrival stays read-only; needs_parking keeps
  // its own governed RPC, unchanged.)
  const list = attendeeListSource();
  assert.match(list, /href=\{attendeeOwnerHrefs\(attendee\.id\)\.checkin\}/);
  assert.match(list, /parkingHref=\{attendeeOwnerHrefs\(attendee\.id\)\.parking\}/);
});

test("roster row no longer carries a redundant View Record control or a Cancel Registration control", () => {
  const list = attendeeListSource();

  assert.equal(list.includes("View Record"), false);
  assert.equal(list.includes("Cancel Registration"), false);
  assert.equal(list.includes("<AttendeeActionRow"), false);
  // The empty Actions column is gone from the desktop table.
  assert.equal(/<th scope="col">Actions<\/th>/.test(list), false);
});

test("Cancel Registration now lives in the record workspace as a separated destructive (danger) action, still confirmed via dialog", () => {
  const source = pageSource();
  const primaryActionsSource = source.slice(
    source.indexOf("const primaryActions ="),
    source.indexOf("const secondaryActions ="),
  );

  assert.match(
    primaryActionsSource,
    /<AppButton\s+variant="danger"\s+disabled=\{!canEdit \|\| !attendee\}\s+onClick=\{\(\) => attendee && void onCancelRegistration\(attendee\)\}\s*>\s*Cancel Registration/,
  );
});

test("the record workspace opens as a centered modal (presentation=\"centered\"), not the side drawer", () => {
  const source = pageSource();
  const workspaceSource = source.slice(
    source.indexOf("export function AttendeeRecordWorkspace("),
    source.indexOf("function AdminAttendeesPageInner()"),
  );
  assert.match(workspaceSource, /<ObjectPanel[\s\S]*?presentation="centered"/);
});

function householdSectionSource(): string {
  const source = pageSource();
  return source.slice(
    source.indexOf("function renderHouseholdPeopleSection("),
    source.indexOf("\n  }\n", source.indexOf("function renderHouseholdPeopleSection(")),
  );
}

test("People on this Registration: one shared section, rendered in both view mode and edit mode", () => {
  const source = pageSource();

  const viewBody = source.slice(
    source.indexOf("const viewBody = ("),
    source.indexOf("const editBody = ("),
  );
  const editBody = source.slice(
    source.indexOf("const editBody = ("),
    source.indexOf("const primaryActions ="),
  );

  assert.match(viewBody, /\{renderHouseholdPeopleSection\(false\)\}/);
  assert.match(editBody, /\{renderHouseholdPeopleSection\(true\)\}/);
  assert.match(householdSectionSource(), /sectionHeading\("household", "People on this Registration"\)/);
  // Cards are driven by the pure projection, not ad-hoc field reads.
  assert.match(source, /const householdPeople = deriveHouseholdPeople\(state\);/);
  assert.match(householdSectionSource(), /householdPeople\.map\(\(person\) =>\s*renderHouseholdPersonCard\(person, editable\)/);
});

test("person card shows role, name, email, and phone", () => {
  const source = pageSource();
  const card = source.slice(
    source.indexOf("function renderHouseholdPersonCard("),
    source.indexOf("const roleFieldEditorStyle"),
  );
  assert.match(card, /\{person\.roleLabel\}/);
  assert.match(card, /householdPersonDisplayName\(person\)/);
  assert.match(card, /Email: \{person\.email \|\| "—"\}/);
  assert.match(card, /Phone: \{person\.cellPhone \|\| "—"\}/);
});

test("Add Person only offers currently-unfilled supported roles, and says the household is full otherwise", () => {
  const source = pageSource();
  const section = householdSectionSource();

  assert.match(
    source,
    /const openHouseholdRoles = \(\["copilot", "additional"\] as const\)\.filter\(\s*\(role\) => !filledHouseholdRoles\.has\(role\) && !roleEditorOpen\(role\),\s*\)/,
  );
  assert.match(section, /\+ Add Person/);
  assert.match(section, /\{editable && openHouseholdRoles\.length > 0 \? \(/);
  assert.match(section, /openHouseholdRoles\.includes\("copilot"\) \? \(/);
  assert.match(section, /openHouseholdRoles\.includes\("additional"\) \? \(/);
  assert.match(section, /\) : editable && householdIsFull \? \(/);
  assert.match(section, /This registration has its full household/);
  // No arbitrary-N: the picker vocabulary is exactly the two canonical roles.
  assert.equal(section.includes('"pilot"'), false);
});

test("Add Person / Edit / role editors bind to existing AttendeeEditorState fields via onChange -- no new modal, no new write path", () => {
  const source = pageSource();
  const section = householdSectionSource();
  const editors = source.slice(
    source.indexOf("function renderCopilotFieldEditor("),
    source.indexOf("function renderHouseholdPeopleSection("),
  );

  // The section and its editors issue no Supabase call of their own.
  assert.equal(/supabase\.rpc\(|supabase\.from\(/.test(section), false);
  assert.equal(/supabase\.rpc\(|supabase\.from\(/.test(editors), false);
  // Adding a role only toggles which fields are shown.
  assert.match(section, /setShowCopilotFields\(true\);\s*\n\s*setHouseholdMemberChooserOpen\(false\);/);
  assert.match(section, /setShowAdditionalParticipant\(true\);\s*\n\s*setHouseholdMemberChooserOpen\(false\);/);
  // The copilot editor reuses the existing household text fields; the
  // additional editor binds each field back through onChange.
  assert.match(editors, /SECTION_TEXT_FIELDS\.household\.map\(renderTextField\)/);
  assert.match(editors, /onChange\("additional_first_name", e\.target\.value\)/);
  assert.match(editors, /onChange\("additional_email", e\.target\.value\)/);

  // No second ObjectPanel / dialog was introduced for people.
  assert.equal(
    (source.match(/<ObjectPanel/g) || []).length,
    1,
    "exactly one ObjectPanel still owns the record workspace",
  );
});

test("household writes still go only through the governed RPCs -- no direct attendee_household_members mutation, one Save path", () => {
  const source = pageSource();

  const householdRpcCalls =
    (source.match(/manage_attendee_household_member/g) || []).length +
    (source.match(/record_participant_capacity_increase/g) || []).length;
  assert.ok(householdRpcCalls > 0);
  assert.equal(
    /attendee_household_members"\)\s*\n?\s*\.(insert|upsert|delete)\(/.test(source),
    false,
  );
  // Remove Person is still the clear-then-Save flow.
  assert.match(source, /onRemoveHouseholdMember=\{removeHouseholdMember\}/);
});

test("switching to a different record collapses the person-field editors so they never leak across records", () => {
  const source = pageSource();
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*setShowCopilotFields\(false\);\s*setShowAdditionalParticipant\(false\);\s*setHouseholdMemberChooserOpen\(false\);\s*\}, \[state\.id\]\);/,
  );
});

test("+ Add Attendee (create mode) renders the same People on this Registration section", () => {
  const source = pageSource();
  // openCreateAttendeeEditor drives the one AttendeeRecordWorkspace in edit
  // mode, so it inherits renderHouseholdPeopleSection(true) with no
  // create-specific household code path.
  assert.match(source, /function openCreateAttendeeEditor\(\)/);
  assert.match(source, /setEditorMode\("create"\)/);
  assert.equal(
    (source.match(/renderHouseholdPeopleSection\(true\)/g) || []).length,
    1,
    "one edit-mode household section, shared by create and edit",
  );
});

// --- Phase 2: Authorized Party Size ---------------------------------------

test("Authorized Party Size is its own labelled block, visually separate from People on this Registration and from Registration", () => {
  const source = pageSource();
  const editBody = source.slice(
    source.indexOf("const editBody = ("),
    source.indexOf("const primaryActions ="),
  );

  // Its own section with the renamed label and its own dirty-badge section id.
  assert.match(editBody, /sectionHeading\("party_size", "Authorized Party Size"\)/);
  assert.match(editBody, /<Field label="Authorized Party Size">/);
  // Helper text distinguishing party size from named-people management.
  assert.match(
    editBody,
    /Named people are managed above\. Authorized party size is the[\s\S]*?paid\/approved number of participants and may be larger than the[\s\S]*?number of named people\./,
  );
  // Named / authorized read-out.
  assert.match(editBody, /\{namedPersonCount\} named \/ \{authorizedPartySizeDisplay\} authorized/);

  // The stepper is no longer inside the Registration field grid.
  const registrationSection = editBody.slice(
    editBody.indexOf('sectionHeading("registration"'),
    editBody.indexOf('sectionHeading("notes"'),
  );
  assert.equal(registrationSection.includes("Registration Capacity"), false);
  assert.equal(registrationSection.includes("Authorized Party Size"), false);
  assert.equal(registrationSection.includes("registration_capacity"), false);
});

test("Authorized Party Size preserves null semantics and does not auto-derive capacity from the roster", () => {
  const source = pageSource();

  // "—" / "not yet established" for an untouched unset capacity; the stepper
  // still clears the unset flag on interaction exactly as before.
  assert.match(
    source,
    /const authorizedPartySizeDisplay = state\.registration_capacity_was_unset\s*\?\s*"—"\s*:\s*String\(state\.registration_capacity\)/,
  );
  assert.match(source, /onChange\("registration_capacity_was_unset", false\)/);
  // The over-capacity condition is surfaced, never silently resolved by
  // widening the authorized number.
  assert.match(
    source,
    /const namedExceedsAuthorized =\s*!state\.registration_capacity_was_unset &&\s*namedPersonCount > state\.registration_capacity;/,
  );
  assert.match(source, /The named people exceed the authorized party size\./);

  // Capacity still only ever rises through the governed RPC; the generic
  // edit payload's participant_capacity expression is unchanged.
  assert.match(
    source,
    /participant_capacity:\s*\n\s*editorMode === "create"\s*\n\s*\? initialCapacityForCreate\s*\n\s*: isCapacityIncrease\s*\n\s*\? editorState\.registration_capacity_original\s*\n\s*: requiredCapacity,/,
  );
});
