import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  getCurrentAdminEvent,
  setCurrentAdminEvent,
  shouldPersistResolvedAdminEvent,
  subscribeToAdminEvent,
} from "@/lib/adminEventContext";
import {
  createAdminWorkingEventScopeCore,
  resolveAdminWorkingEvent,
  shouldPersistResolvedAdminEvent as shouldPersistViaWorkspace,
  subscribeToAdminEventChange,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/storageKeys";
import { storageEventMatches } from "@/lib/storageMigration";

// Admin Dashboard self-trigger repair -- regression coverage.
//
// Root cause: app/admin/dashboard/page.tsx::loadPage() persisted the
// resolved working Event with setCurrentAdminEvent() on EVERY load.
// setCurrentAdminEvent() emits the same-tab ADMIN_EVENT_UPDATED CustomEvent
// that the dashboard subscribes to (subscribeToAdminWorkspace), so loadPage
// re-triggered itself. Pre-N1 this was a bounded 1:1 loop; N1's correct
// dual-dispatch + dual-listen compatibility fanned it out geometrically
// into a /rest/v1/events request storm.
//
// The repair: persist only when the resolved Event id differs from the
// stored one (shouldPersistResolvedAdminEvent).
//
// Run with:  npm test
// ---------------------------------------------------------------------------

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

const memory = new MemoryStorage();

class FakeWindow extends EventTarget {
  localStorage = memory;
}
const fakeWindow = new FakeWindow();

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = memory;
(globalThis as unknown as { window: FakeWindow }).window = fakeWindow;

const OLD_EVENT = { id: "evt-old", name: "Old Rally", status: "active" };
const NEW_EVENT = { id: "evt-new", name: "New Rally", status: "active" };

// A hard ceiling so a genuinely runaway loop terminates the test instead
// of overflowing the stack (setCurrentAdminEvent dispatches synchronously).
const RUNAWAY_LIMIT = 40;

type SimResult = {
  loadCalls: number;
  persistCalls: number;
  eventsQueries: number;
  runaway: boolean;
};

/**
 * Mirrors the dashboard's loadPage persist logic: resolve the working
 * Event, then persist it back through setCurrentAdminEvent ONLY when the
 * guard says the stored value is stale. `unguarded: true` reproduces the
 * pre-repair behavior for the regression assertion.
 */
function makeDashboardSim(
  accessible: Array<{ id: string; name: string; status: string }>,
  target: { id: string; name: string; status: string },
  opts: { unguarded?: boolean } = {},
) {
  const result: SimResult = {
    loadCalls: 0,
    persistCalls: 0,
    eventsQueries: 0,
    runaway: false,
  };

  function loadPageSim() {
    if (result.loadCalls >= RUNAWAY_LIMIT) {
      result.runaway = true;
      return;
    }
    result.loadCalls += 1;
    result.eventsQueries += 1; // stands in for the /rest/v1/events request

    const stored = getCurrentAdminEvent();
    const { event: resolved } = resolveAdminWorkingEvent(
      accessible,
      stored,
      target,
    );
    if (!resolved) {
      return;
    }

    const shouldPersist = opts.unguarded
      ? true
      : shouldPersistResolvedAdminEvent(stored?.id, resolved.id);

    if (shouldPersist) {
      result.persistCalls += 1;
      setCurrentAdminEvent({ id: resolved.id, name: resolved.name });
    }
  }

  const unsubscribe = subscribeToAdminWorkspace(() => {
    loadPageSim();
  });

  return { result, loadPageSim, unsubscribe };
}

beforeEach(() => {
  memory.clear();
});

// ---------------------------------------------------------------------------
// Pure guard unit coverage.
// ---------------------------------------------------------------------------
test("shouldPersistResolvedAdminEvent: equal ids -> false (no redundant write)", () => {
  assert.equal(shouldPersistResolvedAdminEvent("evt-1", "evt-1"), false);
});

test("shouldPersistResolvedAdminEvent: absent / empty / different stored -> true", () => {
  assert.equal(shouldPersistResolvedAdminEvent(null, "evt-1"), true);
  assert.equal(shouldPersistResolvedAdminEvent(undefined, "evt-1"), true);
  assert.equal(shouldPersistResolvedAdminEvent("", "evt-1"), true);
  assert.equal(shouldPersistResolvedAdminEvent("evt-old", "evt-new"), true);
});

test("shouldPersistResolvedAdminEvent is re-exported from @/lib/adminWorkspaceContext (the page's import surface)", () => {
  assert.equal(shouldPersistViaWorkspace, shouldPersistResolvedAdminEvent);
});

// ---------------------------------------------------------------------------
// 1. Stored Event equals resolved Event -> no persistence, no self-trigger.
// ---------------------------------------------------------------------------
test("1. stored Event == resolved Event: loadPage persists nothing and no self-trigger cycle originates", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: OLD_EVENT.id, name: OLD_EVENT.name }),
  );

  const { result, loadPageSim, unsubscribe } = makeDashboardSim(
    [OLD_EVENT],
    OLD_EVENT,
  );

  loadPageSim(); // the single initial load

  assert.equal(result.persistCalls, 0, "no setCurrentAdminEvent call");
  assert.equal(result.loadCalls, 1, "loadPage ran exactly once -- no re-entry");
  assert.equal(result.eventsQueries, 1, "exactly one events query");
  assert.equal(result.runaway, false);

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 2. Stored Event absent -> persisted exactly once, then converges even with
//    N1 dual (canonical + legacy) callbacks.
// ---------------------------------------------------------------------------
test("2. stored Event absent: resolved Event persisted exactly once; dual callbacks converge; bounded", () => {
  const { result, loadPageSim, unsubscribe } = makeDashboardSim(
    [NEW_EVENT],
    NEW_EVENT,
  );

  loadPageSim(); // initial load: nothing stored -> persists once -> dual dispatch

  assert.equal(result.persistCalls, 1, "persisted exactly once");
  assert.equal(result.runaway, false, "no runaway");
  // initial load + the callbacks from the single dual-dispatch, all of
  // which now see stored == resolved and persist nothing further.
  assert.ok(
    result.loadCalls <= 3,
    `bounded re-entry, got ${result.loadCalls} (initial + <=2 dual callbacks)`,
  );

  const settledLoads = result.loadCalls;
  const settledQueries = result.eventsQueries;

  // Further stray Admin-event notifications (another surface, a stale
  // provider) must not restart the storm now that stored == resolved.
  // subscribeToAdminEventChange coalesces on the persisted Event scope, so
  // a duplicate notification that does not change the scope now costs
  // nothing at all (previously it cost one O(1) load each).
  for (let i = 0; i < 5; i += 1) {
    fakeWindow.dispatchEvent(new CustomEvent("epicentrax-admin-event-updated"));
    fakeWindow.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
  }

  assert.equal(result.persistCalls, 1, "still exactly one persist -- loop dead");
  assert.equal(
    result.loadCalls - settledLoads,
    0,
    "a stray notification with no scope change is coalesced away entirely",
  );
  assert.equal(result.eventsQueries - settledQueries, 0);
  assert.equal(result.runaway, false);

  // canonical value is what got written
  assert.equal(getCurrentAdminEvent()?.id, NEW_EVENT.id);

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 3. Stored Event differs from what resolution yields.
//
//    In loadPage's real flow this reduces to two cases:
//      (a) stored id still accessible -> resolveAdminWorkingEvent restores
//          the SAME id -> guard is false (covered by 1/5).
//      (b) stored id no longer accessible -> invalid-context; resolved is
//          null; the persist branch is never reached and NO substitute is
//          written (ADR-006). The guard must not turn this into a
//          substitute-and-persist that would then self-trigger.
//    The "genuinely different id -> persist once -> converge" contract is
//    additionally proven at the guard's unit level above and by test 2
//    (first establishment).
// ---------------------------------------------------------------------------
test("3. stored Event no longer accessible: invalid context, nothing persisted, no self-trigger", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: "evt-deleted", name: "Deleted" }),
  );

  const { result, loadPageSim, unsubscribe } = makeDashboardSim(
    [OLD_EVENT, NEW_EVENT], // "evt-deleted" is not in the accessible set
    NEW_EVENT,
  );

  loadPageSim();

  assert.equal(result.persistCalls, 0, "no substitute Event is persisted");
  assert.equal(
    getCurrentAdminEvent()?.id,
    "evt-deleted",
    "the stale stored context is left untouched for the explicit-choice UI",
  );
  assert.equal(result.loadCalls, 1, "no re-entry");
  assert.equal(result.runaway, false);

  unsubscribe();
});

test("3b. guard convergence contract: different -> persist once; equal thereafter -> never again", () => {
  // drive the exact sequence loadPage would see on first establishment
  let stored: string | null = null;
  const resolvedId = NEW_EVENT.id;
  let persists = 0;

  for (let i = 0; i < 6; i += 1) {
    if (shouldPersistResolvedAdminEvent(stored, resolvedId)) {
      persists += 1;
      stored = resolvedId; // setCurrentAdminEvent would make this the stored id
    }
  }

  assert.equal(persists, 1, "persisted exactly once, then converged");
});

// ---------------------------------------------------------------------------
// 4. Two independent defenses stop the request storm:
//      (a) shouldPersistResolvedAdminEvent -- no redundant WRITE (unit +
//          3b + test 1/5), and
//      (b) subscribeToAdminEventChange's distinct-until-changed coalescing
//          -- no redundant CALLBACK for a notification that does not change
//          the persisted Event scope.
//    Either one alone bounds the loop; together the storm is impossible.
// ---------------------------------------------------------------------------
test("4a. after convergence, a burst of canonical+legacy events is coalesced to zero extra loads", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: NEW_EVENT.id, name: NEW_EVENT.name }),
  );

  const { result, loadPageSim, unsubscribe } = makeDashboardSim(
    [NEW_EVENT],
    NEW_EVENT,
  );
  loadPageSim();
  assert.equal(result.persistCalls, 0);

  for (let i = 0; i < 15; i += 1) {
    fakeWindow.dispatchEvent(new CustomEvent("epicentrax-admin-event-updated"));
    fakeWindow.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
  }

  assert.equal(result.persistCalls, 0);
  assert.equal(result.runaway, false);
  assert.equal(
    result.loadCalls,
    1,
    "the burst describes no scope change -> coalesced away; only the initial load ran",
  );

  unsubscribe();
});

test("4b. defense in depth: coalescing ALSO neutralizes the unguarded persist-on-every-load loop", () => {
  const { result, loadPageSim, unsubscribe } = makeDashboardSim(
    [NEW_EVENT],
    NEW_EVENT,
    { unguarded: true },
  );

  // Pre-fix this ignited a geometric storm (loadPage persists -> dual
  // dispatch -> loadPage persists -> ...). Now the second persist writes
  // the SAME Event scope, so subscribeToAdminEventChange coalesces the
  // notification and the chain stops after one bounce -- even though the
  // persist guard has been deliberately disabled here.
  loadPageSim();

  assert.equal(result.runaway, false, "no runaway even without the persist guard");
  assert.ok(
    result.loadCalls <= 2,
    `bounded by coalescing, got ${result.loadCalls}`,
  );
  assert.ok(
    result.persistCalls <= 2,
    `bounded by coalescing, got ${result.persistCalls}`,
  );

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 5. Canonical-only Admin Event context still resolves (Stage A: legacy
//    fcoc-admin-event-context absent).
// ---------------------------------------------------------------------------
test("5. canonical-only epicentrax-admin-event-context resolves and needs no redundant persist", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: OLD_EVENT.id, name: OLD_EVENT.name }),
  );
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminEventContext), null);

  const stored = getCurrentAdminEvent();
  assert.equal(stored?.id, OLD_EVENT.id, "canonical context read back");

  const { event: resolved } = resolveAdminWorkingEvent(
    [OLD_EVENT, NEW_EVENT],
    stored,
    NEW_EVENT,
  );
  assert.equal(resolved?.id, OLD_EVENT.id, "stored Event restored unchanged");
  assert.equal(
    shouldPersistResolvedAdminEvent(stored?.id, resolved!.id),
    false,
    "already stored -> no redundant write from a canonical-only context",
  );
});

// ---------------------------------------------------------------------------
// 6. TRUE cross-tab pathway.
//    The real mechanism: another tab's setCurrentAdminEvent writes shared
//    localStorage (adminEventContext + adminEventChanged) and dispatches a
//    same-tab CustomEvent that does NOT cross tabs. The receiving tab learns
//    of it through the BROWSER 'storage' event. subscribeToAdminEvent() (used
//    by lib/AdminWorkspaceProvider.tsx) registers window.addEventListener(
//    "storage", ...) exactly for this; Sidebar.tsx filters the same event by
//    key via storageEventMatches(). This test simulates the browser-delivered
//    'storage' event, NOT a same-window CustomEvent.
// ---------------------------------------------------------------------------
test("6a. subscribeToAdminEvent adopts an Event another tab wrote, via the browser 'storage' event", () => {
  // this tab starts on OLD
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: OLD_EVENT.id, name: OLD_EVENT.name }),
  );

  let workspaceEventId: string | null = getCurrentAdminEvent()?.id ?? null;
  const unsubscribe = subscribeToAdminEvent(() => {
    // mirrors AdminWorkspaceProvider.refresh(): re-read the shared store
    workspaceEventId = getCurrentAdminEvent()?.id ?? null;
  });
  assert.equal(workspaceEventId, OLD_EVENT.id);

  // --- another tab switches to NEW: it writes SHARED storage. Cross-tab,
  //     no CustomEvent is delivered here -- only a 'storage' event is. ---
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: NEW_EVENT.id, name: NEW_EVENT.name }),
  );
  memory.setItem(STORAGE_KEYS.adminEventChanged, String(Date.now()));
  memory.setItem(LEGACY_STORAGE_KEYS.adminEventChanged, String(Date.now()));

  const storageEvent = new Event("storage") as Event & { key?: string };
  storageEvent.key = STORAGE_KEYS.adminEventChanged;
  fakeWindow.dispatchEvent(storageEvent);

  assert.equal(
    workspaceEventId,
    NEW_EVENT.id,
    "the workspace adopted the Event the other tab persisted",
  );

  unsubscribe();
});

test("6b. the cross-tab 'storage' key filter (Sidebar's path) matches both namespace names", () => {
  // Sidebar.tsx's handleStorage gates on storageEventMatches(e.key, ...,
  // STORAGE_KEYS.adminEventChanged, ...). Prove a genuine cross-tab change
  // signal under EITHER namespace name still triggers it.
  assert.equal(
    storageEventMatches(
      STORAGE_KEYS.adminEventChanged,
      STORAGE_KEYS.adminEventContext,
      STORAGE_KEYS.adminEventChanged,
    ),
    true,
  );
  assert.equal(
    storageEventMatches(
      LEGACY_STORAGE_KEYS.adminEventChanged,
      STORAGE_KEYS.adminEventContext,
      STORAGE_KEYS.adminEventChanged,
    ),
    true,
  );

  const sidebarSrc = readFileSync(
    fileURLToPath(new URL("../../../components/layout/Sidebar.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(sidebarSrc, /storageEventMatches\(\s*e\.key,/);
  assert.match(sidebarSrc, /STORAGE_KEYS\.adminEventChanged/);
  assert.match(sidebarSrc, /window\.addEventListener\("storage", handleStorage\)/);
});

test("6c. FIXED: subscribeToAdminWorkspace now reloads on a cross-tab 'storage' change, filtered and coalesced", () => {
  // The former gap: subscribeToAdminWorkspace wired only the same-tab
  // CustomEvent, so an event-scoped page (Dashboard, Agenda, Check-In)
  // never re-ran loadPage() when ANOTHER tab changed the working Event.
  // It now delegates to subscribeToAdminEventChange -- CustomEvent AND a
  // key-filtered, scope-coalesced 'storage' listener.
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: OLD_EVENT.id, name: OLD_EVENT.name }),
  );

  let hits = 0;
  const unsubscribe = subscribeToAdminWorkspace(() => {
    hits += 1;
  });

  // (a) an unrelated key's cross-tab write is ignored.
  const unrelated = new Event("storage") as Event & { key?: string };
  unrelated.key = "fcoc-some-unrelated-key";
  fakeWindow.dispatchEvent(unrelated);
  assert.equal(hits, 0, "unrelated 'storage' key does not trigger a reload");

  // (b) another tab switches the working Event: shared storage is written,
  //     then the browser delivers a 'storage' event (no CustomEvent here).
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: NEW_EVENT.id, name: NEW_EVENT.name }),
  );
  memory.setItem(STORAGE_KEYS.adminEventChanged, String(Date.now()));

  const contextEvent = new Event("storage") as Event & { key?: string };
  contextEvent.key = STORAGE_KEYS.adminEventContext;
  fakeWindow.dispatchEvent(contextEvent);
  const changedEvent = new Event("storage") as Event & { key?: string };
  changedEvent.key = STORAGE_KEYS.adminEventChanged;
  fakeWindow.dispatchEvent(changedEvent);

  assert.equal(
    hits,
    1,
    "the cross-tab switch triggers exactly one reload -- the paired context + " +
      "changed 'storage' events describe one scope change and are coalesced",
  );

  // (c) it still reacts to the same-tab CustomEvent, and still coalesces a
  //     duplicate that carries no scope change.
  fakeWindow.dispatchEvent(new CustomEvent("epicentrax-admin-event-updated"));
  assert.equal(hits, 1, "no scope change since last callback -> coalesced");

  const wsSrc = readFileSync(
    fileURLToPath(new URL("../../../lib/adminWorkspaceContext.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(
    wsSrc,
    /subscribeToAdminWorkspace[\s\S]{0,200}subscribeToAdminEventChange/,
    "subscribeToAdminWorkspace delegates to the one canonical subscriber",
  );

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 7. Cross-tab continuity fix: the shared subscriber's storage handling and
//    coalescing, and the shared stale-result guard.
// ---------------------------------------------------------------------------

test("7a. synthetic cross-tab 'storage' event: distinct working-Event writes each deliver one callback, in order", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: OLD_EVENT.id, name: OLD_EVENT.name }),
  );

  const seen: (string | null)[] = [];
  const unsubscribe = subscribeToAdminEventChange(() => {
    seen.push(getCurrentAdminEvent()?.id ?? null);
  });

  function otherTabSwitchesTo(evt: { id: string; name: string }) {
    memory.setItem(
      STORAGE_KEYS.adminEventContext,
      JSON.stringify({ id: evt.id, name: evt.name }),
    );
    const e = new Event("storage") as Event & { key?: string };
    e.key = STORAGE_KEYS.adminEventContext;
    fakeWindow.dispatchEvent(e);
  }

  otherTabSwitchesTo(NEW_EVENT);
  otherTabSwitchesTo(OLD_EVENT); // switch back is itself a distinct change
  otherTabSwitchesTo(NEW_EVENT);

  assert.deepEqual(
    seen,
    [NEW_EVENT.id, OLD_EVENT.id, NEW_EVENT.id],
    "every distinct step of A -> B -> A -> B is delivered, none dropped or reordered",
  );

  unsubscribe();
});

test("7b. coalescing: the up-to-four 'storage' events one setCurrentAdminEvent emits collapse to one callback", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: OLD_EVENT.id, name: OLD_EVENT.name }),
  );

  let calls = 0;
  const unsubscribe = subscribeToAdminEventChange(() => {
    calls += 1;
  });

  // Another tab's dual-name write: context (canonical + legacy) and the
  // `-changed` signal ping (canonical + legacy) -> four 'storage' events
  // for ONE switch.
  const value = JSON.stringify({ id: NEW_EVENT.id, name: NEW_EVENT.name });
  memory.setItem(STORAGE_KEYS.adminEventContext, value);
  memory.setItem(LEGACY_STORAGE_KEYS.adminEventContext, value);
  memory.setItem(STORAGE_KEYS.adminEventChanged, "1");
  memory.setItem(LEGACY_STORAGE_KEYS.adminEventChanged, "1");

  for (const key of [
    STORAGE_KEYS.adminEventContext,
    LEGACY_STORAGE_KEYS.adminEventContext,
    STORAGE_KEYS.adminEventChanged,
    LEGACY_STORAGE_KEYS.adminEventChanged,
  ]) {
    const e = new Event("storage") as Event & { key?: string };
    e.key = key;
    fakeWindow.dispatchEvent(e);
  }

  assert.equal(calls, 1, "one effective reload for one working-Event change");

  unsubscribe();
});

test("7c. filtering: an unrelated cross-tab 'storage' write never triggers a callback", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: NEW_EVENT.id, name: NEW_EVENT.name }),
  );

  let calls = 0;
  const unsubscribe = subscribeToAdminEventChange(() => {
    calls += 1;
  });

  for (const key of [
    "fcoc-nearby-favorites",
    "epicentrax-member-event-context",
    "some-third-party-key",
  ]) {
    const e = new Event("storage") as Event & { key?: string };
    e.key = key;
    fakeWindow.dispatchEvent(e);
  }

  assert.equal(calls, 0, "only admin-event context / -changed keys are relevant");

  // ...but a whole-store clear (key === null) is treated as relevant.
  memory.removeItem(STORAGE_KEYS.adminEventContext);
  const cleared = new Event("storage") as Event & { key?: string };
  cleared.key = null as unknown as string;
  fakeWindow.dispatchEvent(cleared);
  assert.equal(calls, 1, "a cleared store (null key) is not filtered out");

  unsubscribe();
});

test("7d. stale-result guard: a load that began before the switch cannot commit after it", () => {
  const scope = createAdminWorkingEventScopeCore(OLD_EVENT.id);

  // A load for Event A starts and snapshots the generation.
  const loadAGeneration = scope.generation;
  assert.equal(scope.isCurrent(loadAGeneration), true);

  // The working Event switches to B (same-tab or cross-tab -- the hook
  // calls sync() either way).
  const switchToB = scope.sync(NEW_EVENT.id);
  assert.equal(switchToB.changed, true);
  assert.equal(switchToB.generation, loadAGeneration + 1);

  // Load A's response now comes back -- it must be rejected.
  assert.equal(
    scope.isCurrent(loadAGeneration),
    false,
    "Event A's late response is stale and must not repopulate Event B",
  );

  // Load B (started after the switch) snapshots the new generation and is
  // still current when it resolves.
  const loadBGeneration = scope.generation;
  assert.equal(scope.isCurrent(loadBGeneration), true);

  // A redundant notification that does not change the id is not a switch:
  // no generation bump, so an in-flight load B still commits.
  const noChange = scope.sync(NEW_EVENT.id);
  assert.equal(noChange.changed, false);
  assert.equal(scope.isCurrent(loadBGeneration), true);
});
