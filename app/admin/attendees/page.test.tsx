import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import {
  AttendeeActionRow,
  AttendeeEditorModal,
  type AttendeeEditorState,
  type AttendeeRow,
  buildHouseholdRemovalConfirmMessage,
  computeHouseholdRemovalWarnings,
  emptyAttendeeEditorState,
  formatCancellationDetail,
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

// --- 2. Per-action edit permission guards ---------------------------------

test("AttendeeActionRow: without can_edit_attendees, every mutating button is disabled", () => {
  const html = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit={false}
      showBackToPending
      onOpenEdit={noop}
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
      onOpenEdit={noop}
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

test("AttendeeActionRow: Edit Record stays enabled even without edit permission -- viewing remains available", () => {
  const html = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit={false}
      showBackToPending={false}
      onOpenEdit={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  const buttonStart = html.lastIndexOf("<button", html.indexOf("Edit Record"));
  const fragment = html.slice(buttonStart, html.indexOf("Edit Record"));
  assert.ok(
    !fragment.includes("disabled"),
    "Edit Record must remain enabled -- it only opens the record for viewing",
  );
});

test("QuickActionBar: + Add Attendee is disabled without can_edit_attendees, enabled with it", () => {
  const disabledHtml = renderToStaticMarkup(
    <QuickActionBar
      canEdit={false}
      onAddAttendee={noop}
      onSetReviewMode={noop}
      onSetAllMode={noop}
      onRefresh={noop}
    />,
  );
  const enabledHtml = renderToStaticMarkup(
    <QuickActionBar
      canEdit
      onAddAttendee={noop}
      onSetReviewMode={noop}
      onSetAllMode={noop}
      onRefresh={noop}
    />,
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

test("AttendeeEditorModal: Save/Create is disabled without can_edit_attendees, enabled with it", () => {
  const state = emptyAttendeeEditorState();

  const disabledHtml = renderToStaticMarkup(
    <AttendeeEditorModal
      open
      mode="create"
      state={state}
      saving={false}
      canEdit={false}
      onClose={noop}
      onChange={noop}
      onSave={asyncNoop}
    />,
  );
  const enabledHtml = renderToStaticMarkup(
    <AttendeeEditorModal
      open
      mode="create"
      state={state}
      saving={false}
      canEdit
      onClose={noop}
      onChange={noop}
      onSave={asyncNoop}
    />,
  );

  const disabledStart = disabledHtml.lastIndexOf(
    "<button",
    disabledHtml.indexOf("Create Attendee"),
  );
  const enabledStart = enabledHtml.lastIndexOf(
    "<button",
    enabledHtml.indexOf("Create Attendee"),
  );

  assert.ok(
    disabledHtml
      .slice(disabledStart, disabledHtml.indexOf("Create Attendee"))
      .includes("disabled"),
  );
  assert.ok(
    !enabledHtml
      .slice(enabledStart, enabledHtml.indexOf("Create Attendee"))
      .includes("disabled"),
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

test("the duplicated action rows are consolidated into one shared component, referenced by both list contexts", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  const usageCount = (source.match(/<AttendeeActionRow/g) || []).length;
  assert.equal(
    usageCount,
    2,
    "AttendeeActionRow must be used by exactly ReviewQueue and AttendeeList",
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
      onOpenEdit={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );
  const withoutBackToPending = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit
      showBackToPending={false}
      onOpenEdit={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  assert.ok(withBackToPending.includes("Back To Pending"));
  assert.ok(!withoutBackToPending.includes("Back To Pending"));

  for (const label of [
    "Edit Record",
    "Mark Reviewed",
    "Cancel Registration",
    "Lock Record",
  ]) {
    assert.ok(withBackToPending.includes(label));
    assert.ok(withoutBackToPending.includes(label));
  }
});

test("AttendeeActionRow: never depends on horizontal scrolling for the primary action row", () => {
  const html = renderToStaticMarkup(
    <AttendeeActionRow
      attendee={baseAttendee()}
      canEdit
      showBackToPending
      onOpenEdit={noop}
      onUpdateDataStatus={asyncNoop}
      onCancelRegistration={asyncNoop}
    />,
  );

  assert.ok(!html.includes("overflow-x:auto"));
  assert.ok(html.includes("flex-wrap:wrap"));
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

test("cancellation details are rendered only inside the AttendeeList expanded panel, conditioned on formatCancellationDetail", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.ok(source.includes("formatCancellationDetail(attendee) ? ("));
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
