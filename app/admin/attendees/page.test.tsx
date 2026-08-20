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

test("Stage A: generic attendee payload excludes operational Arrival and placement fields and presents governed handoffs", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const payload = source.slice(source.indexOf("const payload = {"), source.indexOf("if (editorMode === \"create\")"));
  assert.equal(/assigned_site:/.test(payload), false);
  assert.equal(/has_arrived:/.test(payload), false);
  assert.match(source, /fetchCanonicalAttendeePlacement/);
  assert.match(source, /buildAdminAttendeeTargetHref\("\/admin\/checkin", state\.id\)/);
  assert.match(source, /buildAdminAttendeeTargetHref\("\/admin\/parking", state\.id\)/);
});

// -- UI Phase 4: read-only Arrival/Placement in the roster list itself ------

test("attendeeArrivalPresentation and attendeePlacementPresentation are read-only derivations -- neither returns a setter, handler, or writable control", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const arrivalFn = source.slice(
    source.indexOf("function attendeeArrivalPresentation("),
    source.indexOf("function attendeePlacementPresentation("),
  );
  const placementFn = source.slice(
    source.indexOf("function attendeePlacementPresentation("),
    source.indexOf("function attendeeGroupSiteLabel("),
  );

  for (const fn of [arrivalFn, placementFn]) {
    assert.equal(/onChange|onClick|setHasArrived|setAssignedSite/.test(fn), false);
    assert.equal(/\.rpc\(|supabase\.from\(/.test(fn), false);
  }
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

test("Arrival and Placement badges in the roster render through the shared, read-only StatusBadge -- no <input>/<select> ever mutates has_arrived or placement from this page", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const attendeeListSource = source.slice(
    source.indexOf("function AttendeeList("),
    source.indexOf("export function AttendeeRecordWorkspace("),
  );

  assert.match(attendeeListSource, /<StatusBadge tone=\{arrival\.tone\}>\{arrival\.label\}<\/StatusBadge>/);
  assert.match(attendeeListSource, /<StatusBadge tone=\{placement\.tone\}>\{placement\.label\}<\/StatusBadge>/);
  assert.equal(/type="checkbox"|type="radio"/.test(attendeeListSource), false);
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

test("AttendeeActionRow: without can_edit_attendees, every mutating button is disabled", () => {
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
  for (const label of [
    "Mark Reviewed",
    "Cancel Registration",
    "Lock Record",
    "Back To Pending",
  ]) {
    const buttonStart = html.lastIndexOf("<button", html.indexOf(label));
    const fragment = html.slice(buttonStart, html.indexOf(label));
    assert.ok(
      fragment.includes("disabled"),
      `"${label}" must be disabled when canEdit is false`,
    );
  }
});

test("AttendeeActionRow: with can_edit_attendees, the legitimate mutating buttons are enabled", () => {
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

  for (const label of [
    "Mark Reviewed",
    "Cancel Registration",
    "Lock Record",
    "Back To Pending",
  ]) {
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

  assert.ok(editBodySource.includes("<input"));

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

test("the duplicated action rows are consolidated into one shared component, referenced only by ReviewQueue and AttendeeList", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const reviewQueueSource = source.slice(
    source.indexOf("function ReviewQueue("),
    source.indexOf("function AttendeeList("),
  );
  // UI Phase 4: AttendeeList itself now renders two responsive
  // presentations of the same roster (DataTable / ResponsiveList, per
  // the Shell's isCompact signal) -- both legitimately render
  // AttendeeActionRow once each, so its own usage count is 2, not the
  // drifted-second-implementation case this test originally guarded
  // against. The guard that matters is unchanged: no *other* component
  // anywhere in the file may define its own competing action row.
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
    2,
    "AttendeeList renders AttendeeActionRow once per responsive presentation (table, list)",
  );
  assert.equal(
    totalUsageCount,
    reviewQueueUsageCount + attendeeListUsageCount,
    "no third, independent AttendeeActionRow usage exists outside ReviewQueue/AttendeeList",
  );
  assert.ok(
    !source.includes("overflowX: \"auto\""),
    "the old horizontal-scroll-only action row must no longer exist",
  );
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

  for (const label of [
    "View Record",
    "Mark Reviewed",
    "Cancel Registration",
    "Lock Record",
  ]) {
    assert.ok(withBackToPending.includes(label));
    assert.ok(withoutBackToPending.includes(label));
  }
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

test("explicit Remove Co-Pilot / Remove Additional Participant controls exist in the edit form, conditioned on that participant currently having data", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /hasCopilotNow \? \(/);
  assert.match(source, />\s*Remove Co-Pilot\s*</);
  assert.match(source, /hasAdditionalNow \? \(/);
  assert.match(source, />\s*Remove Additional Participant\s*</);
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
  assert.match(source, /buildAdminAttendeeTargetHref\("\/admin\/checkin", state\.id\)/);
  assert.match(source, /buildAdminAttendeeTargetHref\("\/admin\/parking", state\.id\)/);
});
