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
  resolveAdminWorkingEvent,
  shouldPersistResolvedAdminEvent as shouldPersistViaWorkspace,
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
  for (let i = 0; i < 5; i += 1) {
    fakeWindow.dispatchEvent(new CustomEvent("epicentrax-admin-event-updated"));
    fakeWindow.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
  }

  assert.equal(result.persistCalls, 1, "still exactly one persist -- loop dead");
  assert.equal(
    result.loadCalls - settledLoads,
    10,
    "each stray event costs exactly one O(1) load that persists nothing",
  );
  assert.equal(result.eventsQueries - settledQueries, 10);
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
// 4. Repeated canonical + legacy Admin Event CustomEvents cannot restart a
//    runaway request loop after convergence -- and the UNGUARDED variant
//    proves the loop is real (regression fence).
// ---------------------------------------------------------------------------
test("4a. after convergence, a burst of canonical+legacy events stays O(1) per event -- no runaway", () => {
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
  assert.equal(result.loadCalls, 1 + 30, "linear in events, never geometric");

  unsubscribe();
});

test("4b. REGRESSION FENCE: the unguarded persist-on-every-load behavior does run away", () => {
  const { result, loadPageSim, unsubscribe } = makeDashboardSim(
    [NEW_EVENT],
    NEW_EVENT,
    { unguarded: true },
  );

  loadPageSim(); // one initial load is enough to ignite the unguarded loop

  assert.equal(
    result.runaway,
    true,
    "without the guard, loadPage re-triggers itself past the runaway ceiling",
  );
  assert.ok(
    result.persistCalls > 5,
    `unguarded persisted ${result.persistCalls} times before the ceiling`,
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

test("6c. DISCOVERED GAP: the dashboard PAGE's own subscribeToAdminWorkspace is CustomEvent-only (no cross-tab reload)", () => {
  // subscribeToAdminWorkspace (lib/adminWorkspaceContext.tsx) wires only
  // addDualWindowEventListener(...) -- CustomEvent names, which never cross
  // tabs -- with no window "storage" listener. So loadPage() does NOT
  // re-run when ANOTHER tab changes the Admin Event. This is pre-existing
  // (introduced when b13005c replaced the page's old
  // addEventListener("storage", ...) filter), unrelated to N1 and to this
  // self-trigger repair. Documented here, not fixed here.
  let hits = 0;
  const unsubscribe = subscribeToAdminWorkspace(() => {
    hits += 1;
  });

  const storageEvent = new Event("storage") as Event & { key?: string };
  storageEvent.key = STORAGE_KEYS.adminEventChanged;
  fakeWindow.dispatchEvent(storageEvent);

  assert.equal(
    hits,
    0,
    "subscribeToAdminWorkspace does not react to a browser 'storage' event",
  );

  // ...but it DOES react to the same-tab CustomEvent (its actual purpose).
  fakeWindow.dispatchEvent(new CustomEvent("epicentrax-admin-event-updated"));
  assert.equal(hits, 1);

  const wsSrc = readFileSync(
    fileURLToPath(new URL("../../../lib/adminWorkspaceContext.tsx", import.meta.url)),
    "utf8",
  );
  const fnIdx = wsSrc.indexOf("export function subscribeToAdminWorkspace");
  const fnBody = wsSrc.slice(fnIdx, fnIdx + 400);
  assert.equal(
    /addEventListener\(\s*["']storage["']/.test(fnBody),
    false,
    "subscribeToAdminWorkspace has no storage listener -- confirms the documented gap",
  );

  unsubscribe();
});
