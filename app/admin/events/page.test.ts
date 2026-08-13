import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Event Context Invariant
// (docs/architecture/ADR-006 Event Context Architecture.md), written
// against the Amana -> Branson production defect. This page's loadPage
// used to resolve the shared Admin working Event against `loadedEvents`
// -- a list already filtered by this page's own `eventStatusFilter`
// picker (defaulting to "active") -- so an inactive stored Event was
// excluded from consideration outright and unconditionally replaced by
// `loadedEvents[0]`. Lifecycle-status filtering is this page's own
// presentation/discovery concern (ADR-006 §4) and must never gate
// context validity. Run with:
//   npx tsx --test app/admin/events/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("the shared Event context is resolved against accessibleEvents (the full authorized set), never loadedEvents (the status-filtered list)", () => {
  const callIdx = PAGE_SOURCE.indexOf("resolveAdminWorkingEvent(");
  assert.notEqual(callIdx, -1, "expected a resolveAdminWorkingEvent(...) call");

  const adminEventArgIdx = PAGE_SOURCE.indexOf("adminEvent,", callIdx);
  assert.notEqual(adminEventArgIdx, -1);

  const firstArg = PAGE_SOURCE.slice(
    callIdx + "resolveAdminWorkingEvent(".length,
    adminEventArgIdx,
  );

  assert.equal(
    /^\s*accessibleEvents\s*,?\s*$/.test(firstArg),
    true,
    `expected resolveAdminWorkingEvent's first argument to be accessibleEvents, got: ${firstArg.trim()}`,
  );
  assert.equal(
    /loadedEvents/.test(firstArg),
    false,
    "resolveAdminWorkingEvent must not be given the eventStatusFilter-filtered loadedEvents list",
  );
});

test("the retired 'stored Event must be present in the filtered list' fallback (unconditional loadedEvents[0]) is gone", () => {
  assert.equal(
    /const preferredEventId =\s*\n?\s*storedAccessibleEvent\?\.id \|\| loadedEvents\[0\]\?\.id \|\| ""/.test(
      PAGE_SOURCE,
    ),
    false,
    "found the retired pattern that discarded a status-filtered-out stored Event",
  );
});

test("the shared working-Event write only happens on initial establishment or when the stored context is invalid, never on a plain restore", () => {
  const callIdx = PAGE_SOURCE.indexOf("resolveAdminWorkingEvent(");
  const afterCall = PAGE_SOURCE.slice(callIdx, callIdx + 700);

  assert.match(afterCall, /if \(!adminEvent\?\.id && contextEvent\) \{/);
  assert.match(afterCall, /setWorkspaceEvent\(contextEvent\)/);
  assert.match(afterCall, /\} else if \(invalidStoredContext\) \{/);
  assert.match(afterCall, /setWorkspaceEvent\(null\)/);
});

test("this page's own list/edit-form selection stays scoped to the filtered loadedEvents list, distinct from the shared context resolution above it", () => {
  const selectionIdx = PAGE_SOURCE.indexOf("visibleContextEvent");
  assert.notEqual(selectionIdx, -1);
  const selectionBlock = PAGE_SOURCE.slice(selectionIdx, selectionIdx + 300);

  assert.match(selectionBlock, /loadedEvents\.find\(\(e\) => e\.id === contextEvent\.id\)/);
  assert.match(selectionBlock, /loadedEvents\[0\]\?\.id/);
});

test("shell wrapper and AdminRouteGuard remain in place", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

// Single-Owner Integrity pass (docs/architecture/ADR-006 Event Context
// Architecture.md §2.3): a repository-wide re-audit of every remaining
// setWorkspaceEvent/setCurrentAdminEvent call site found three more
// interactive (not mount-time) violations in this same page: saving an
// edited event gated the shared-context write on the saved event's own
// lifecycle status (clearing context to null for an inactive save), the
// status-filter dropdown cleared context on every filter change, and
// the "New Event" button cleared context merely to open a blank form.
// None of these are "lifecycle status changing context" edge cases --
// they are the same defect class as the mount-time bug, triggered by a
// different kind of event handler.

test("saving an event (update or create) writes the shared working Event unconditionally -- never gated on isActiveEventStatus", () => {
  const saveFnIdx = PAGE_SOURCE.indexOf("async function saveEvent()");
  const saveFnEndIdx = PAGE_SOURCE.indexOf(
    "async function saveAssignments()",
    saveFnIdx,
  );
  assert.notEqual(saveFnIdx, -1);
  assert.notEqual(saveFnEndIdx, -1);
  const saveFnBody = PAGE_SOURCE.slice(saveFnIdx, saveFnEndIdx);

  assert.equal(
    /if \(isActiveEventStatus\((updatedEvent|createdEvent)\.status\)\)/.test(
      saveFnBody,
    ),
    false,
    "found the retired lifecycle-status gate around a saveEvent setWorkspaceEvent call",
  );
  assert.match(saveFnBody, /setWorkspaceEvent\(updatedEvent\)/);
  assert.match(saveFnBody, /setWorkspaceEvent\(createdEvent\)/);
});

test("changing the Event Filter (status-filter picker) no longer clears the shared working Event", () => {
  const filterIdx = PAGE_SOURCE.indexOf("Event Filter");
  assert.notEqual(filterIdx, -1);
  const onChangeIdx = PAGE_SOURCE.indexOf("onChange={(e) => {", filterIdx);
  assert.notEqual(onChangeIdx, -1);
  const onChangeEndIdx = PAGE_SOURCE.indexOf("}}", onChangeIdx);
  const handlerBody = PAGE_SOURCE.slice(onChangeIdx, onChangeEndIdx);

  assert.match(handlerBody, /setEventStatusFilter\(nextFilter\)/);
  assert.equal(
    /setWorkspaceEvent\(null\)/.test(handlerBody),
    false,
    "the presentation-filter control must never clear the shared working Event",
  );
});

test("the 'New Event' button no longer clears the shared working Event -- it only resets this page's own form state", () => {
  const buttonIdx = PAGE_SOURCE.indexOf(">\n          New Event\n");
  assert.notEqual(buttonIdx, -1);
  const onClickIdx = PAGE_SOURCE.lastIndexOf("onClick={() => {", buttonIdx);
  assert.notEqual(onClickIdx, -1);
  const onClickEndIdx = PAGE_SOURCE.indexOf("}}", onClickIdx);
  const handlerBody = PAGE_SOURCE.slice(onClickIdx, onClickEndIdx);

  assert.match(handlerBody, /setForm\(emptyForm\)/);
  assert.equal(
    /setWorkspaceEvent\(null\)/.test(handlerBody),
    false,
    "opening a blank creation form must never clear the shared working Event",
  );
});

test("the explicit Select Event picker and Clone action remain genuine explicit-selection writes, unaffected by the fixes above", () => {
  assert.match(PAGE_SOURCE, /const evt = events\.find\(\(row\) => row\.id === newId\) \|\| null;\s*\n\s*setWorkspaceEvent\(evt\);/);
  assert.match(PAGE_SOURCE, /setWorkspaceEvent\(clonedEvent\);/);
});
