import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { eventAdminStatusTone } from "@/app/admin/events/page";

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

// -- Unsaved Event editor protection ---------------------------------------

test("Event Details uses a field-level persisted baseline, including coordinates, instead of object identity", () => {
  assert.match(PAGE_SOURCE, /const \[formBaseline, setFormBaseline\] = useState<EventFormState>\(emptyForm\)/);
  assert.match(PAGE_SOURCE, /function eventFormsEqual\(left: EventFormState, right: EventFormState\)/);
  for (const field of ["name", "location", "start_date", "end_date", "event_code", "status", "lat", "lng"]) {
    assert.match(PAGE_SOURCE, new RegExp(`left\\.${field} === right\\.${field}`));
  }
  assert.match(PAGE_SOURCE, /const formDirty = !eventFormsEqual\(form, formBaseline\)/);
});

test("Event Assignments keep their own persisted baseline and contribute to editor dirtiness", () => {
  assert.match(PAGE_SOURCE, /const \[assignmentBaseline, setAssignmentBaseline\] = useState<EventAssignments>/);
  assert.match(PAGE_SOURCE, /const assignmentDirty = selectedMasterMapId !== assignmentBaseline\.masterMapId \|\| selectedNearbyListId !== assignmentBaseline\.nearbyListId/);
  assert.match(PAGE_SOURCE, /const editorDirty = formDirty \|\| assignmentDirty/);
});

test("a same-Event refresh adopts fresh state only when clean and otherwise preserves the local draft", () => {
  const effect = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("const forceSynchronization = allowEditorSynchronizationRef.current"), PAGE_SOURCE.indexOf("function setWorkspaceEvent"));
  assert.match(effect, /if \(forceSynchronization \|\| !formDirtyRef\.current\) \{/);
  assert.match(effect, /else if \(!eventFormsEqual\(nextForm, formBaselineRef\.current\)\) \{/);
  assert.match(effect, /Your draft was preserved; saving may overwrite newer persisted values\./);
  assert.match(effect, /loadAssignmentsForEvent\(selectedEvent\.id, forceSynchronization\)/);
});

test("assignment refreshes preserve a dirty local assignment draft and surface a conflict only for changed saved assignments", () => {
  const assignments = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("const loadAssignmentsForEvent"), PAGE_SOURCE.indexOf("const loadPage"));
  assert.match(assignments, /if \(forceSynchronization \|\| !assignmentDirtyRef\.current\) \{/);
  assert.match(assignments, /else if \(!assignmentsEqual\(nextAssignments, assignmentBaselineRef\.current\)\) \{/);
  assert.match(assignments, /assignmentLoadGenerationRef/);
});

test("Auto Fill coordinates remains a local form update and therefore participates in dirty draft protection", () => {
  const autoFill = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("Auto Fill Coordinates") - 1800, PAGE_SOURCE.indexOf("Auto Fill Coordinates") + 100);
  assert.match(autoFill, /setForm\(\(prev\) => \(\{[\s\S]*?lat: String\(lat\),[\s\S]*?lng: String\(lng\)/);
});

test("dirty Event switches and filter changes use the shared ConfirmDialog before discarding local drafts", () => {
  assert.match(PAGE_SOURCE, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog"/);
  assert.match(PAGE_SOURCE, /title: "Discard unsaved Event changes\?"/);
  assert.match(PAGE_SOURCE, /Changing the filter will discard unsaved Event Details and assignment edits\./);
  assert.match(PAGE_SOURCE, /Switching Events will discard unsaved Event Details and assignment edits\./);
  assert.match(PAGE_SOURCE, /<ConfirmDialog open=\{!!confirmDialogState\}/);
  assert.match(PAGE_SOURCE, /function selectEventForEditing\(event: EventRow \| null/);
  assert.match(PAGE_SOURCE, /function applyEventStatusFilter\(nextFilter: EventStatusFilter\)/);
});

test("a workspace retarget never silently replaces a dirty Event editor", () => {
  const loadPage = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("const loadPage = useCallback"), PAGE_SOURCE.indexOf("useEffect(() => {\n    if (!admin)", PAGE_SOURCE.indexOf("const loadPage = useCallback")));
  assert.match(loadPage, /preferredEventId !== selectedEventIdRef\.current/);
  assert.match(loadPage, /formDirtyRef\.current \|\| assignmentDirtyRef\.current/);
  assert.match(loadPage, /The working Event changed, but your unsaved edits were preserved/);
  assert.match(loadPage, /Discard those edits and switch Events\?/);
});

test("successful Event and assignment saves establish fresh baselines before their workspace reloads", () => {
  const saveEvent = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("async function saveEvent"), PAGE_SOURCE.indexOf("async function saveAssignments"));
  const saveAssignments = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("async function saveAssignments"), PAGE_SOURCE.indexOf("return (", PAGE_SOURCE.indexOf("async function saveAssignments")));
  assert.match(saveEvent, /const confirmedForm = eventFormFromEvent\(updatedEvent\)/);
  assert.match(saveEvent, /setFormBaseline\(confirmedForm\)/);
  assert.match(saveAssignments, /setAssignmentBaseline\(\{ masterMapId: selectedMasterMapId, nearbyListId: selectedNearbyListId \}\)/);
});

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

test("this page's own list/edit-form selection stays scoped to the filtered loadedEvents list, and is left unselected -- never substituted -- when canonical context is not part of it", () => {
  const selectionIdx = PAGE_SOURCE.indexOf("visibleContextEvent");
  assert.notEqual(selectionIdx, -1);
  const selectionBlock = PAGE_SOURCE.slice(selectionIdx, selectionIdx + 500);

  assert.match(selectionBlock, /loadedEvents\.find\(\(e\) => e\.id === contextEvent\.id\)/);
  assert.match(
    selectionBlock,
    /const preferredEventId = visibleContextEvent\?\.id \|\| "";/,
  );
  // The retired fallback silently substituted an unrelated visible row
  // (loadedEvents[0]) whenever canonical context was excluded by the
  // current filter -- the root cause of the Amana/Saint George field
  // defect (CMD: Admin Events Canonical Context + Filter Persistence
  // Repair). It must not survive anywhere in this block.
  assert.equal(/loadedEvents\[0\]\?\.id/.test(selectionBlock), false);
});

test("shell wrapper and AdminRouteGuard remain in place", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

test("Edit resolves coordinates only through the shared /api/geocode path -- no second Nominatim implementation", () => {
  // The one governed geocoding path is lib/geocodeLocation -> /api/geocode.
  assert.doesNotMatch(PAGE_SOURCE, /nominatim\.openstreetmap\.org/);
  assert.doesNotMatch(PAGE_SOURCE, /"https:\/\/nominatim/);
  const saveStart = PAGE_SOURCE.indexOf("async function saveEvent()");
  const saveBody = PAGE_SOURCE.slice(saveStart, PAGE_SOURCE.indexOf("async function saveAssignments()", saveStart));
  assert.match(saveBody, /resolveEventCoordinates\(form, \(\{ address \}\) =>\s*\n?\s*geocodeLocation\(\{ address \}\)/);
});

test("Editing Location updates only Location -- it never clears lat/lng", () => {
  // The Location <Input> onChange sets `location` and nothing else.
  const start = PAGE_SOURCE.indexOf('<Field label="Location">');
  const block = PAGE_SOURCE.slice(start, PAGE_SOURCE.indexOf("</Field>", start));
  assert.match(block, /setForm\(\(prev\) => \(\{ \.\.\.prev, location: e\.target\.value \}\)\)/);
  assert.doesNotMatch(block, /lat: ""/);
  assert.doesNotMatch(block, /lng: ""/);
});

test("An unresolved geocode never blocks the Event save and never nulls a stored pair", () => {
  const saveStart = PAGE_SOURCE.indexOf("async function saveEvent()");
  const saveBody = PAGE_SOURCE.slice(saveStart, PAGE_SOURCE.indexOf("async function saveAssignments()", saveStart));
  // No throw on an unresolved geocode.
  assert.doesNotMatch(saveBody, /throw new Error\(coordinates\.message\)/);
  assert.doesNotMatch(saveBody, /coordinates\.kind === "unresolved"/);
  // The plan decides what is persisted; "preserve" omits lat/lng entirely.
  assert.match(saveBody, /planCoordinatePersistence\(/);
  assert.match(saveBody, /coordinatePlan\.kind === "write"/);
  assert.match(saveBody, /coordinatePlan\.kind === "clear"/);
  // A non-blocking notice, not an error, on the preserve path.
  assert.match(saveBody, /coordinatePlan\.notice\s*\n?\s*\?\s*coordinatePlan\.notice/);
});

test("Edit does not re-geocode an unchanged location with blank coordinate fields", () => {
  const saveStart = PAGE_SOURCE.indexOf("async function saveEvent()");
  const saveBody = PAGE_SOURCE.slice(saveStart, PAGE_SOURCE.indexOf("async function saveAssignments()", saveStart));
  assert.match(saveBody, /eventSaveShouldResolveCoordinates\(\{\s*\n?\s*mode: "edit"/);
  assert.match(saveBody, /form\.location\.trim\(\) !== \(selectedEvent\?\.location \?\? ""\)\.trim\(\)/);
  assert.match(saveBody, /form\.lat\.trim\(\) !== "" \|\| form\.lng\.trim\(\) !== ""/);
});

test("Auto Fill Coordinates routes through the shared geocodeLocation() and never clears an existing pair on failure", () => {
  const start = PAGE_SOURCE.indexOf("Auto Fill Coordinates");
  // walk back to the enclosing onClick handler
  const handlerStart = PAGE_SOURCE.lastIndexOf("onClick={async () => {", start);
  const handler = PAGE_SOURCE.slice(handlerStart, start);
  assert.match(handler, /await geocodeLocation\(\{\s*\n?\s*address: form\.location/);
  assert.doesNotMatch(handler, /fetch\(/);
  // On a null result it returns without touching form.lat / form.lng.
  assert.match(handler, /if \(lat === null \|\| lng === null\) \{[\s\S]*?return;/);
  const nullBranch = handler.slice(handler.indexOf("lat === null"), handler.indexOf("setForm"));
  assert.doesNotMatch(nullBranch, /setForm/);
});

// Single-Owner Integrity pass (docs/architecture/ADR-006 Event Context
// Architecture.md §2.3): a repository-wide re-audit of every remaining
// setWorkspaceEvent/setCurrentAdminEvent call site found three more
// interactive (not mount-time) violations in this same page: saving an
// edited event gated the shared-context write on the saved event's own
// lifecycle status (clearing context to null for an inactive save), the
// status-filter dropdown cleared context on every filter change, and
// the former in-page "New Event" button cleared context merely to open a
// blank form. T5 now routes creation to its Tenant-authorized page.
// None of these are "lifecycle status changing context" edge cases --
// they are the same defect class as the mount-time bug, triggered by a
// different kind of event handler.

test("saving an existing event writes the shared working Event unconditionally -- never gated on isActiveEventStatus", () => {
  const saveFnIdx = PAGE_SOURCE.indexOf("async function saveEvent()");
  const saveFnEndIdx = PAGE_SOURCE.indexOf(
    "async function saveAssignments()",
    saveFnIdx,
  );
  assert.notEqual(saveFnIdx, -1);
  assert.notEqual(saveFnEndIdx, -1);
  const saveFnBody = PAGE_SOURCE.slice(saveFnIdx, saveFnEndIdx);

  assert.equal(
    /if \(isActiveEventStatus\(updatedEvent\.status\)\)/.test(
      saveFnBody,
    ),
    false,
    "found the retired lifecycle-status gate around a saveEvent setWorkspaceEvent call",
  );
  assert.match(saveFnBody, /setWorkspaceEvent\(updatedEvent\)/);
});

test("changing the Event Filter (status-filter picker) no longer clears the shared working Event", () => {
  const filterIdx = PAGE_SOURCE.indexOf("Event Filter");
  assert.notEqual(filterIdx, -1);
  const onChangeIdx = PAGE_SOURCE.indexOf("onChange={(e) => {", filterIdx);
  assert.notEqual(onChangeIdx, -1);
  const onChangeEndIdx = PAGE_SOURCE.indexOf("}}", onChangeIdx);
  const handlerBody = PAGE_SOURCE.slice(onChangeIdx, onChangeEndIdx);

  assert.match(handlerBody, /applyEventStatusFilter\(nextFilter\)/);
  assert.equal(
    /setWorkspaceEvent\(null\)/.test(handlerBody),
    false,
    "the presentation-filter control must never clear the shared working Event",
  );
});

test("Add Event is a route link and does not mutate shared working-Event context", () => {
  assert.match(
    PAGE_SOURCE,
    /<AppLinkButton href="\/admin\/events\/new" variant="primary">\s*Add Event\s*<\/AppLinkButton>/,
  );
});

test("the explicit Select Event picker remains a genuine explicit-selection write", () => {
  assert.match(PAGE_SOURCE, /const evt = events\.find\(\(row\) => row\.id === newId\) \|\| null;\s*\n\s*selectEventForEditing\(evt\);/);
  assert.match(PAGE_SOURCE, /function selectEventForEditing[\s\S]*?setWorkspaceEvent\(event\);/);
  assert.doesNotMatch(PAGE_SOURCE, /Clone Event|clonedEvent/);
});

// ADR-013 §10 / prerequisite Authority repair: the Events query used to
// apply `.eq("is_active", true)` for non-super-admins before
// canAccessEvent() ever ran, so an Event Admin with a real, unrevoked
// admin_event_access grant to an inactive Event got zero rows back for
// it -- on the one page built to manage Events. The complete Event set
// an actor is authorized to access must never be narrowed by lifecycle
// status; lifecycle/status filtering may remain only as a downstream UI
// display filter.

test("1. an Event Admin retains visibility into an inactive Event they hold authority over -- the events query no longer excludes inactive rows for non-super-admins", () => {
  const loadPageIdx = PAGE_SOURCE.indexOf("const loadPage = useCallback(");
  const promiseAllIdx = PAGE_SOURCE.indexOf("Promise.all([", loadPageIdx);
  assert.notEqual(loadPageIdx, -1);
  assert.notEqual(promiseAllIdx, -1);
  const queryBuildBlock = PAGE_SOURCE.slice(loadPageIdx, promiseAllIdx);

  assert.equal(
    /\.eq\(\s*["']is_active["']\s*,\s*true\s*\)/.test(queryBuildBlock),
    false,
    "found the retired is_active=true filter on the authority-listing events query",
  );
  assert.equal(
    /if \(!admin\.isSuperAdmin\)/.test(queryBuildBlock),
    false,
    "found a retired non-super-admin special case narrowing the events query itself",
  );
  assert.match(queryBuildBlock, /const eventsQuery = supabase/);
});

test("2. Event Admins without authority over a given Event still cannot see it -- accessibleEvents is derived from canAccessEvent against the complete, unfiltered fetch", () => {
  const accessibleIdx = PAGE_SOURCE.indexOf("const accessibleEvents =");
  assert.notEqual(accessibleIdx, -1);
  const accessibleBlock = PAGE_SOURCE.slice(accessibleIdx, accessibleIdx + 200);

  assert.match(
    accessibleBlock,
    /\(\(eventsResult\.data \|\| \[\]\) as EventRow\[\]\)\.filter\(\s*\n?\s*\(event\) => !!event\.id && canAccessEvent\(admin, event\.id\)/,
  );
});

test("3. Super Admin / Tenant Admin inheritance is unchanged -- canAccessEvent (not a page-local admin.isSuperAdmin branch) remains the sole authority gate on the fetched Event set", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{[^}]*canAccessEvent[^}]*\}\s*from\s*["']@\/lib\/getCurrentAdminAccess["']/s,
  );
  // The retired defect special-cased non-super-admins directly in this
  // page (test 1). With that gone, every admin -- super, tenant-inherited,
  // or event-scoped -- takes the identical unfiltered-fetch-then-
  // canAccessEvent path, so inheritance behavior lives entirely in
  // canAccessEvent/has_event_admin_authority (covered by their own
  // tests), not duplicated or special-cased here.
  const loadPageIdx = PAGE_SOURCE.indexOf("const loadPage = useCallback(");
  const accessibleIdx = PAGE_SOURCE.indexOf("const accessibleEvents =", loadPageIdx);
  const betweenBlock = PAGE_SOURCE.slice(loadPageIdx, accessibleIdx);
  assert.equal(
    /admin\.isSuperAdmin/.test(betweenBlock),
    false,
    "no super-admin special case should exist between fetching and authority-filtering the Event set",
  );
});

test("4. lifecycle/status UI filtering (eventStatusFilter) is applied only after, and never narrows, accessibleEvents", () => {
  const accessibleIdx = PAGE_SOURCE.indexOf("const accessibleEvents =");
  const loadedIdx = PAGE_SOURCE.indexOf("const loadedEvents = accessibleEvents.filter(");
  assert.notEqual(accessibleIdx, -1);
  assert.notEqual(loadedIdx, -1);
  assert.ok(
    accessibleIdx < loadedIdx,
    "accessibleEvents (the full authority set) must be computed before loadedEvents (the display-filtered subset)",
  );

  const loadedBlock = PAGE_SOURCE.slice(loadedIdx, loadedIdx + 400);
  assert.match(loadedBlock, /eventStatusFilter === "all"/);
  assert.match(loadedBlock, /isActiveEventStatus\(event\.status\)/);
  // loadedEvents filters the already-authorized accessibleEvents array; it
  // never re-queries or re-derives authority.
  assert.match(loadedBlock, /accessibleEvents\.filter\(/);
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

type LoadResult = {
  filter: "active" | "inactive";
  selectedEventId: string;
  detailsEventId: string;
  assignmentEventId: string;
};

// This deterministic harness models the page-local generation protocol used
// by loadPage: a request may commit success, error, and finally/loading state
// only while its captured generation remains current.
function createLatestLoadHarness() {
  let generation = 0;
  const state: {
    filter: "active" | "inactive";
    selectedEventId: string;
    detailsEventId: string;
    assignmentEventId: string;
    loading: boolean;
    error: string | null;
  } = {
    filter: "active",
    selectedEventId: "amana",
    detailsEventId: "amana",
    assignmentEventId: "amana",
    loading: false,
    error: null,
  };

  async function load(result: Promise<LoadResult>) {
    const requestGeneration = ++generation;
    state.loading = true;
    state.error = null;

    try {
      const next = await result;
      if (requestGeneration !== generation) {
        return;
      }

      state.filter = next.filter;
      state.selectedEventId = next.selectedEventId;
      state.detailsEventId = next.detailsEventId;
      state.assignmentEventId = next.assignmentEventId;
    } catch (error: unknown) {
      if (requestGeneration === generation) {
        state.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (requestGeneration === generation) {
        state.loading = false;
      }
    }
  }

  return { state, load };
}

test("loadPage has a page-local generation guard covering post-await success, error, and finally commits", () => {
  assert.match(PAGE_SOURCE, /useRef\(0\)/);
  assert.match(PAGE_SOURCE, /const generation = \+\+loadGenerationRef\.current;/);
  assert.match(
    PAGE_SOURCE,
    /if \(generation !== loadGenerationRef\.current\) \{\s*return;\s*\}/,
  );
  assert.match(
    PAGE_SOURCE,
    /catch \(err: any\) \{\s*if \(generation === loadGenerationRef\.current\) \{/,
  );
  assert.match(
    PAGE_SOURCE,
    /finally \{\s*if \(generation === loadGenerationRef\.current\) \{\s*setLoading\(false\);/,
  );
});

test("exact Amana inactive race: stale Active response cannot replace the newer Inactive result with Saint George", async () => {
  const active = deferred<LoadResult>();
  const inactive = deferred<LoadResult>();
  const { state, load } = createLatestLoadHarness();

  // setWorkspaceEvent(updatedAmana) synchronously starts the old closure.
  const staleActiveLoad = load(active.promise);
  // React then commits the Inactive filter and starts the newer closure.
  const currentInactiveLoad = load(inactive.promise);

  inactive.resolve({
    filter: "inactive",
    selectedEventId: "amana",
    detailsEventId: "amana",
    assignmentEventId: "amana",
  });
  await currentInactiveLoad;

  active.resolve({
    filter: "active",
    selectedEventId: "saint-george",
    detailsEventId: "saint-george",
    assignmentEventId: "saint-george",
  });
  await staleActiveLoad;

  assert.deepEqual(state, {
    filter: "inactive",
    selectedEventId: "amana",
    detailsEventId: "amana",
    assignmentEventId: "amana",
    loading: false,
    error: null,
  });
});

test("a single current load commits normally", async () => {
  const { state, load } = createLatestLoadHarness();

  await load(
    Promise.resolve({
      filter: "inactive",
      selectedEventId: "amana",
      detailsEventId: "amana",
      assignmentEventId: "amana",
    }),
  );

  assert.equal(state.selectedEventId, "amana");
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
});

test("the newer request commits normally when it finishes last", async () => {
  const older = deferred<LoadResult>();
  const newer = deferred<LoadResult>();
  const { state, load } = createLatestLoadHarness();
  const oldLoad = load(older.promise);
  const newLoad = load(newer.promise);

  older.resolve({
    filter: "active",
    selectedEventId: "saint-george",
    detailsEventId: "saint-george",
    assignmentEventId: "saint-george",
  });
  await oldLoad;
  newer.resolve({
    filter: "inactive",
    selectedEventId: "amana",
    detailsEventId: "amana",
    assignmentEventId: "amana",
  });
  await newLoad;

  assert.equal(state.selectedEventId, "amana");
  assert.equal(state.filter, "inactive");
});

test("a stale error and stale finally cannot overwrite the current successful load", async () => {
  const older = deferred<LoadResult>();
  const newer = deferred<LoadResult>();
  const { state, load } = createLatestLoadHarness();
  const oldLoad = load(older.promise);
  const newLoad = load(newer.promise);

  newer.resolve({
    filter: "inactive",
    selectedEventId: "amana",
    detailsEventId: "amana",
    assignmentEventId: "amana",
  });
  await newLoad;
  older.reject(new Error("stale Active request failed"));
  await oldLoad;

  assert.equal(state.selectedEventId, "amana");
  assert.equal(state.error, null);
  assert.equal(state.loading, false);
});

test("an older finally cannot clear loading while the newer request remains pending, but the current error still surfaces", async () => {
  const older = deferred<LoadResult>();
  const newer = deferred<LoadResult>();
  const { state, load } = createLatestLoadHarness();
  const oldLoad = load(older.promise);
  const newLoad = load(newer.promise);

  older.resolve({
    filter: "active",
    selectedEventId: "saint-george",
    detailsEventId: "saint-george",
    assignmentEventId: "saint-george",
  });
  await oldLoad;
  assert.equal(state.loading, true);

  newer.reject(new Error("current Inactive request failed"));
  await newLoad;
  assert.equal(state.error, "current Inactive request failed");
  assert.equal(state.loading, false);
});

// CMD: Admin Events Canonical Context + Filter Persistence Repair.
// Field defect: canonical context was Amana (archived). Returning to
// /admin/events reset the Event Filter to Active, whose first result
// (Saint George) got silently written into this page's own
// selectedEventId as though it were "selected" -- while canonical
// context never moved. Navigating to Vendor Management still correctly
// showed Amana, proving the page's own picker had misrepresented Saint
// George as canonical when it was not. A later explicit Branson
// selection worked normally.
//
// Root cause: `preferredEventId` used to fall back to
// `loadedEvents[0]?.id` whenever canonical context was not part of the
// current filter. That fallback pre-filled the controlled <select> with
// an unrelated visible row. Because a controlled <select>'s onChange
// only fires when its value actually changes, a later EXPLICIT pick of
// that SAME already-shown value silently never fired at all -- which is
// also what explains the separate field observation "Archived -> select
// Amana -> Photos still showed Saint George" (Amana was `loadedEvents[0]`
// under Archived, so re-picking it no-op'd) versus "All -> select Amana
// -> Photos retained Amana" (the auto-filled value under All differed
// from Amana, so the picker's value genuinely changed and onChange
// fired). Same defect, two symptoms.
//
// The repair has two independent parts: (1) never substitute an
// unrelated visible row for canonical context -- leave the picker
// genuinely unselected instead, with a status message and a persistent
// "Working event" line naming actual canonical context; (2) persist the
// admin's last explicitly chosen Event Filter (browser-local display
// preference, a distinct key from the canonical Admin event-context
// key) so returning to this page restores it instead of silently
// resetting to Active.

test("Event Filter initializes from browser-local persisted storage, not a hardcoded default", () => {
  assert.match(
    PAGE_SOURCE,
    /useState<EventStatusFilter>\(readPersistedEventStatusFilter\)/,
  );
  assert.match(PAGE_SOURCE, /function readPersistedEventStatusFilter\(\)/);
  assert.match(
    PAGE_SOURCE,
    /window\.localStorage\.getItem\(EVENT_STATUS_FILTER_STORAGE_KEY\)/,
  );
});

test("the filter persistence key is a distinct, page-local display preference -- not a second event-context authority", () => {
  assert.match(
    PAGE_SOURCE,
    /const EVENT_STATUS_FILTER_STORAGE_KEY = "fcoc-admin-events-filter";/,
  );
  // Never reads or writes the canonical Admin event-context storage key
  // directly -- canonical context is only ever touched through
  // setWorkspaceEvent/setCurrentAdminEvent (adminEventContext.ts), never
  // by name here.
  assert.equal(
    /localStorage\.(get|set)Item\(\s*ADMIN_EVENT_KEY/.test(PAGE_SOURCE),
    false,
  );
});

test("the Event Filter picker's onChange persists the explicit choice, and never itself calls setWorkspaceEvent", () => {
  const filterIdx = PAGE_SOURCE.indexOf("Event Filter");
  const onChangeIdx = PAGE_SOURCE.indexOf("onChange={(e) => {", filterIdx);
  const onChangeEndIdx = PAGE_SOURCE.indexOf("}}", onChangeIdx);
  assert.notEqual(onChangeIdx, -1);
  const handlerBody = PAGE_SOURCE.slice(onChangeIdx, onChangeEndIdx);

  assert.match(handlerBody, /applyEventStatusFilter\(nextFilter\)/);
  assert.equal(
    /setWorkspaceEvent\(/.test(handlerBody),
    false,
    "the filter control must never mutate canonical event context, not even to re-affirm it",
  );
});

test("loadPage never persists a filter -- only an explicit picker choice does", () => {
  const loadPageIdx = PAGE_SOURCE.indexOf("const loadPage = useCallback(");
  const loadPageEndIdx = PAGE_SOURCE.indexOf(
    "}, [admin, eventStatusFilter]);",
    loadPageIdx,
  );
  assert.notEqual(loadPageIdx, -1);
  assert.notEqual(loadPageEndIdx, -1);
  const loadPageBody = PAGE_SOURCE.slice(loadPageIdx, loadPageEndIdx);

  assert.equal(
    /persistEventStatusFilter/.test(loadPageBody),
    false,
    "a load/reload must never write the persisted filter preference itself",
  );
});

test("saveEvent's incidental filter adjustment to keep an updated Event visible is not persisted as the admin's chosen filter", () => {
  const saveFnIdx = PAGE_SOURCE.indexOf("async function saveEvent()");
  const saveFnEndIdx = PAGE_SOURCE.indexOf(
    "async function saveAssignments()",
    saveFnIdx,
  );
  assert.notEqual(saveFnIdx, -1);
  const saveFnBody = PAGE_SOURCE.slice(saveFnIdx, saveFnEndIdx);

  const setFilterCalls = (saveFnBody.match(/setEventStatusFilter\(/g) || [])
    .length;
  assert.equal(setFilterCalls, 1);
  assert.equal(
    /persistEventStatusFilter/.test(saveFnBody),
    false,
    "saving an event must not overwrite the admin's remembered filter preference",
  );
});

test("a persisted filter unavailable to a non-super-admin's picker is clamped in-memory to Active, without overwriting the persisted preference", () => {
  const clampIdx = PAGE_SOURCE.indexOf(
    '!admin.isSuperAdmin && eventStatusFilter !== "active"',
  );
  assert.notEqual(clampIdx, -1);
  const clampBlock = PAGE_SOURCE.slice(clampIdx, clampIdx + 200);

  assert.match(clampBlock, /setEventStatusFilter\("active"\)/);
  assert.equal(
    /persistEventStatusFilter/.test(clampBlock),
    false,
    "the clamp is a session-local display fix, not a rewrite of another admin's saved preference on a shared device",
  );
});

test("a persistent 'Working event' line reads canonical context directly, independent of this page's own filtered selection", () => {
  assert.match(
    PAGE_SOURCE,
    /const canonicalWorkingEvent = getCurrentAdminEvent\(\);/,
  );
  assert.match(PAGE_SOURCE, /Working event:/);
  assert.match(
    PAGE_SOURCE,
    /canonicalWorkingEvent\?\.name \|\|\s*\n\s*canonicalWorkingEvent\?\.eventName \|\|\s*\n\s*"No working event selected"/,
  );
});

test("when canonical context is not part of the current filter, the status names the actual working Event instead of silently reporting 'ready'", () => {
  assert.match(
    PAGE_SOURCE,
    /`Working event "\$\{contextEvent\.name \|\| "Untitled event"\}" is not shown under this filter\. Select a listed event below to change it, or adjust the filter to find it\.`/,
  );
  const branchIdx = PAGE_SOURCE.indexOf("} else if (contextEvent) {");
  assert.notEqual(branchIdx, -1);
});

test("the explicit Select Event picker still writes canonical context exactly once per change, unaffected by the filter-selection fix", () => {
  assert.match(
    PAGE_SOURCE,
    /const evt = events\.find\(\(row\) => row\.id === newId\) \|\| null;\s*\n\s*selectEventForEditing\(evt\);/,
  );
  // Both the clean path and the explicit discard-confirmation path delegate
  // to the same helper, which owns the one canonical context write.
  const selectIdx = PAGE_SOURCE.indexOf('value={selectedEventId}');
  const onChangeIdx = PAGE_SOURCE.indexOf("onChange={(e) => {", selectIdx);
  const onChangeEndIdx = PAGE_SOURCE.indexOf("}}", onChangeIdx);
  const handlerBody = PAGE_SOURCE.slice(onChangeIdx, onChangeEndIdx);
  const selectEventCalls = (handlerBody.match(/selectEventForEditing\(/g) || [])
    .length;
  assert.equal(selectEventCalls, 2);
  const switchHelper = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("function selectEventForEditing"),
    PAGE_SOURCE.indexOf("function applyEventStatusFilter"),
  );
  assert.equal((switchHelper.match(/setWorkspaceEvent\(/g) || []).length, 1);
});

// -- G-03G: Events route-authority migration -------------------------------
//
// Existing-Event management on this page is Event-scoped:
// has_event_admin_authority(auth.uid(), id)
// already gates public.events UPDATE server-side
// (20260813140000_reconcile_events_rls_grant_drift.sql), a broader
// population than event.definition.manage, so this route guard narrows
// page reachability relative to the RLS boundary, never widens it.
// public.events INSERT remains closed at both the RLS-policy and table-grant
// level. T5 exposes the separate Tenant-scoped
// /admin/events/new route and create_event_for_tenant RPC; this Event-task
// route does not acquire Tenant provisioning authority.

test("route requires event.definition.manage, not the legacy can_manage_events permission", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminRouteGuard requiredTask="event\.definition\.manage">/,
  );
  assert.equal(/requiredPermission/.test(PAGE_SOURCE), false);
  assert.equal(
    /can_manage_events/.test(PAGE_SOURCE.replace(/\/\/.*$/gm, "")),
    false,
  );
  assert.equal(/hasPermission/.test(PAGE_SOURCE), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/\.rpc\(\s*["']has_event_task_authority["']/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("new-Event creation leaves this Event-task page through the governed Tenant route", () => {
  assert.match(PAGE_SOURCE, /href="\/admin\/events\/new"/);
  assert.doesNotMatch(PAGE_SOURCE, /blockNewEventCreation|NEW_EVENT_CREATION_UNAVAILABLE/);
});

test("existing-Event update remains and raw Event creation is absent", () => {
  assert.match(PAGE_SOURCE, /\.from\("events"\)\s*\n\s*\.update\(payload\)/);
  assert.doesNotMatch(PAGE_SOURCE, /\.from\("events"\)\s*\n\s*\.insert\(/);
});

test("Event-membership (canAccessEvent) remains as a page-local per-row check, unrelated to the migrated route permission", () => {
  assert.match(PAGE_SOURCE, /canAccessEvent\(admin, form\.id\)/);
});

// -- Admin Batch 1: Central UI Standard migration ---------------------------

test("no raw form controls remain -- every input/select routes through the canonical Field/Input/Select primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Field,\s*Input,\s*Select\s*\}\s*from\s*["']@\/components\/ui\/Field["']/,
  );
  const sourceWithoutLineComments = PAGE_SOURCE.replace(/\/\/.*$/gm, "");
  assert.equal(/<input\b/.test(sourceWithoutLineComments), false, "no raw <input> should remain");
  assert.equal(/<select\b/.test(sourceWithoutLineComments), false, "no raw <select> should remain");
  for (const label of [
    "Event Filter",
    "Select Event",
    "Event Name",
    "Location",
    "Latitude",
    "Longitude",
    "Start Date",
    "End Date",
    "Event Code",
    "Status",
    "Selected Master Map",
    "Selected Stored Nearby List",
  ]) {
    assert.ok(PAGE_SOURCE.includes(`label="${label}"`), `expected a Field for "${label}"`);
  }
});

test("no raw <button> remains -- every action uses AppButton, and same-app navigation uses AppLinkButton", () => {
  assert.equal(/<button\b/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*AppButton,\s*AppLinkButton\s*\}\s*from\s*["']@\/components\/ui\/AppButton["']/,
  );
  assert.match(PAGE_SOURCE, /<AppLinkButton href="\/admin\/master-maps">Master Maps<\/AppLinkButton>/);
  assert.match(PAGE_SOURCE, /<AppLinkButton href="\/admin\/nearby">Nearby<\/AppLinkButton>/);
  assert.match(PAGE_SOURCE, /<AppLinkButton href="\/admin\/dashboard">Dashboard<\/AppLinkButton>/);
});

test("the page-local 'Return to Dashboard' button is gone -- the canonical shell backTarget now owns that affordance", () => {
  assert.equal(/Return to Dashboard/.test(PAGE_SOURCE), false);
  assert.equal(/function openDashboard\(\)/.test(PAGE_SOURCE), false);
  assert.match(
    PAGE_SOURCE,
    /backTarget=\{\{ href: "\/admin\/dashboard", label: "Dashboard" \}\}/,
  );
});

test("the duplicate in-body 'Event Admin' <h1> is gone -- the canonical shell header (pageTitle) is the page's only h1", () => {
  assert.equal(/<h1[^>]*>Event Admin<\/h1>/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /<AdminShellAdapter\s*\n\s*pageTitle="Event Admin"/);
});

test("Select Event, Event Details, and Event Assignments render through the canonical PageSection primitive", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*PageSection\s*\}\s*from\s*["']@\/components\/ui\/PageSection["']/,
  );
  assert.match(PAGE_SOURCE, /<PageSection variant="card" title="Select Event">/);
  assert.match(PAGE_SOURCE, /<PageSection variant="card" title="Event Details">/);
  assert.match(PAGE_SOURCE, /<PageSection variant="card" title="Event Assignments">/);
});

test("Event Health status and Coordinates Loaded render through the shared StatusBadge, not a hand-rolled colored pill", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*StatusBadge\s*\}\s*from\s*["']@\/components\/ui\/StatusBadge["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /<StatusBadge tone=\{isActiveEventStatus\(selectedEvent\.status\) \? "success" : "warning"\}>/,
  );
  assert.match(PAGE_SOURCE, /<StatusBadge tone="success">📍 Coordinates Loaded<\/StatusBadge>/);
});

test("Event Health cards are semantic actions that navigate to their owning controls without mutating Event data", () => {
  const navigationStart = PAGE_SOURCE.indexOf("function navigateToHealthControl");
  const navigationEnd = PAGE_SOURCE.indexOf("// Read fresh on every render", navigationStart);
  const navigationBody = PAGE_SOURCE.slice(navigationStart, navigationEnd);

  assert.match(
    navigationBody,
    /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/,
  );
  assert.match(
    navigationBody,
    /requestAnimationFrame\(\(\) => control\.focus\(\{ preventScroll: true \}\)\)/,
  );
  assert.doesNotMatch(navigationBody, /set[A-Z]|supabase|saveEvent|saveAssignments/);

  for (const [label, targetRef] of [
    ["Coordinates", "autoFillCoordinatesRef"],
    ["Master Map", "masterMapSelectRef"],
    ["Nearby List", "nearbyListSelectRef"],
    ["Visibility", "eventStatusSelectRef"],
  ]) {
    const cardStart = PAGE_SOURCE.indexOf(`>${label}</div>`);
    const card = PAGE_SOURCE.slice(Math.max(0, cardStart - 500), cardStart + 500);
    assert.match(card, new RegExp(`<AppButton[\\s\\S]*?navigateToHealthControl\\(${targetRef}\\.current\\)`));
  }
});

test("each Event Health destination is a canonical focusable control, so loaded and missing states share the same action", () => {
  assert.match(PAGE_SOURCE, /ref=\{autoFillCoordinatesRef\}/);
  assert.match(PAGE_SOURCE, /ref=\{masterMapSelectRef\}/);
  assert.match(PAGE_SOURCE, /ref=\{nearbyListSelectRef\}/);
  assert.match(PAGE_SOURCE, /ref=\{eventStatusSelectRef\}/);
  assert.equal((PAGE_SOURCE.match(/aria-label="Manage /g) || []).length, 4);
});

test("semantic Event Health buttons retain the former card grid alignment instead of generic button centering", () => {
  const healthCardStyleStart = PAGE_SOURCE.indexOf("const healthCardStyle");
  const healthCardStyle = PAGE_SOURCE.slice(
    healthCardStyleStart,
    PAGE_SOURCE.indexOf("const healthTitleStyle", healthCardStyleStart),
  );

  for (const expected of [
    'display: "grid"',
    'textAlign: "left"',
    'justifyContent: "normal"',
    'justifyItems: "stretch"',
    'alignContent: "normal"',
    'minHeight: "auto"',
    'fontSize: "inherit"',
    'fontWeight: "inherit"',
    'lineHeight: "normal"',
  ]) {
    assert.ok(healthCardStyle.includes(expected), `expected card reset: ${expected}`);
  }
});

test("loading and error presentation uses the canonical LoadingState/Alert primitives", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*LoadingState\s*\}\s*from\s*["']@\/components\/ui\/LoadingState["']/,
  );
  assert.match(
    PAGE_SOURCE,
    /<LoadingState message="Loading events, maps, and nearby lists\.\.\." \/>/,
  );
  assert.match(PAGE_SOURCE, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
});

test("the governed Add Event action renders inside the canonical FormActions wrapper", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*FormActions\s*\}\s*from\s*["']@\/components\/ui\/FormActions["']/,
  );
  const formActionsCount = (PAGE_SOURCE.match(/<FormActions>/g) || []).length;
  assert.ok(formActionsCount >= 2, `expected at least 2 FormActions usages, found ${formActionsCount}`);
  assert.match(PAGE_SOURCE, /<FormActions>\s*<AppLinkButton href="\/admin\/events\/new"/);
});

test("eventAdminStatusTone classifies confirmation/loading/failure text correctly", () => {
  assert.equal(eventAdminStatusTone("Updated event \"Saint George\" to Active."), "success");
  assert.equal(eventAdminStatusTone("Saved event assignments."), "success");
  assert.equal(eventAdminStatusTone("Coordinates loaded."), "success");
  assert.equal(eventAdminStatusTone("Event admin ready."), "success");

  assert.equal(eventAdminStatusTone("Loading events, maps, and nearby lists..."), "info");

  assert.equal(
    eventAdminStatusTone("Your previously selected event is no longer available. Choose one above."),
    "warning",
  );
  assert.equal(
    eventAdminStatusTone(
      "Working event \"Amana\" is not shown under this filter. Select a listed event below to change it, or adjust the filter to find it.",
    ),
    "warning",
  );

  assert.equal(eventAdminStatusTone("Access denied."), "danger");
  assert.equal(eventAdminStatusTone("Failed to save event."), "danger");
  assert.equal(eventAdminStatusTone("Enter an event name."), "danger");

  // A non-blocking coordinate notice reads as a warning, not a failure.
  assert.equal(
    eventAdminStatusTone(
      "Coordinates could not be resolved automatically for this location. The rest of the Event was saved; enter a latitude and longitude pair manually.",
    ),
    "warning",
  );
});
