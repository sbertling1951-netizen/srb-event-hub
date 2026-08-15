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
