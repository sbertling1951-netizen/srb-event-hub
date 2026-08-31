import {
  APP_EVENT_NAMES,
  LEGACY_APP_EVENT_NAMES,
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
} from "@/lib/storageKeys";
import {
  addDualWindowEventListener,
  dualDispatchWindowEvent,
  dualRemoveLocal,
  dualSignalLocal,
  dualWriteLocal,
  readMigratingLocal,
  storageEventMatches,
} from "@/lib/storageMigration";

export const ADMIN_EVENT_KEY = STORAGE_KEYS.adminEventContext;
export const ADMIN_EVENT_CHANGED_KEY = STORAGE_KEYS.adminEventChanged;
export const ADMIN_EVENT_UPDATED = APP_EVENT_NAMES.adminEventUpdated;
const LEGACY_ADMIN_EVENT_KEY = LEGACY_STORAGE_KEYS.adminEventContext;
const LEGACY_ADMIN_EVENT_CHANGED_KEY = LEGACY_STORAGE_KEYS.adminEventChanged;
const LEGACY_ADMIN_EVENT_UPDATED = LEGACY_APP_EVENT_NAMES.adminEventUpdated;

export interface AdminWorkspaceContext {
  id: string;
  name?: string | null;
  eventName?: string | null;
  location?: string | null;
  venue_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  updatedAt?: number;
  version?: 1;
}

export function getCurrentAdminEvent(): AdminWorkspaceContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = readMigratingLocal(ADMIN_EVENT_KEY, LEGACY_ADMIN_EVENT_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Invalid admin event context", err);
    return null;
  }
}

export function setCurrentAdminEvent(event: AdminWorkspaceContext | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!event) {
    dualRemoveLocal(ADMIN_EVENT_KEY, LEGACY_ADMIN_EVENT_KEY);
  } else {
    dualWriteLocal(
      ADMIN_EVENT_KEY,
      LEGACY_ADMIN_EVENT_KEY,
      JSON.stringify({
        ...event,
        updatedAt: Date.now(),
        version: 1,
      }),
    );
  }

  dualSignalLocal(
    ADMIN_EVENT_CHANGED_KEY,
    LEGACY_ADMIN_EVENT_CHANGED_KEY,
    String(Date.now()),
  );

  dualDispatchWindowEvent(ADMIN_EVENT_UPDATED, LEGACY_ADMIN_EVENT_UPDATED);
}

export function clearCurrentAdminEvent(): void {
  setCurrentAdminEvent(null);
}

export type AdminEventCandidate = {
  id: string;
  [key: string]: unknown;
};

export type AdminWorkingEventResolution<T extends AdminEventCandidate> = {
  event: T | null;
  // true only when a persisted Event ID exists but is absent from
  // `accessibleEvents` (deleted or no longer authorized) -- ADR-006 §2.2
  // requires this to surface an explicit Event-choice state, never an
  // automatic substitute.
  invalidStoredContext: boolean;
};

/**
 * Resolves the Admin working Event per the Event Context Invariant
 * (docs/architecture/ADR-006 Event Context Architecture.md §2). A stored
 * Event ID is restored unchanged whenever it is still present in
 * `accessibleEvents`, regardless of that Event's lifecycle status --
 * inactive is not invalid (ADR-006 §2.1). `accessibleEvents` must
 * therefore be the caller's full authorized set, not a lifecycle-status-
 * filtered display/discovery list (ADR-006 §4).
 *
 * When no Event has ever been stored, `initialEstablishmentDefault` is
 * used as-is -- callers own that default policy (e.g. "prefer the first
 * active Event"), documented at the call site (ADR-006 §2.3).
 */
export function resolveAdminWorkingEvent<T extends AdminEventCandidate>(
  accessibleEvents: T[],
  storedEvent: { id?: string | null } | null | undefined,
  initialEstablishmentDefault: T | null,
): AdminWorkingEventResolution<T> {
  if (storedEvent?.id) {
    const restored =
      accessibleEvents.find((e) => e.id === storedEvent.id) || null;

    return restored
      ? { event: restored, invalidStoredContext: false }
      : { event: null, invalidStoredContext: true };
  }

  return { event: initialEstablishmentDefault, invalidStoredContext: false };
}

/**
 * Self-trigger guard for callers that persist a freshly *resolved* working
 * Event at the end of a load (the Admin Dashboard's `loadPage`).
 *
 * `setCurrentAdminEvent()` emits the same-tab `ADMIN_EVENT_UPDATED`
 * CustomEvent that those same pages subscribe to via
 * `subscribeToAdminWorkspace()`. Persisting on *every* load -- even when the
 * resolved Event already equals what is stored -- makes the loader
 * re-trigger itself. The Stage-A namespace compatibility layer
 * (dual-dispatch + dual-listen) fans that latent 1:1 loop out
 * geometrically. The resolved Event only needs to be written back when it
 * genuinely differs from the stored one: nothing was ever stored, or a
 * different Event id resolved. When they match, the store is already
 * correct and no notification (or reload) is warranted.
 */
export function shouldPersistResolvedAdminEvent(
  storedEventId: string | null | undefined,
  resolvedEventId: string,
): boolean {
  return (storedEventId ?? null) !== resolvedEventId;
}

/**
 * A stable string identity for the *scope* the persisted Admin working
 * Event describes -- everything a consumer keys data or actions off, but
 * NOT the `updatedAt` / `version` write metadata.
 *
 * Excluding the metadata is what lets `subscribeToAdminEventChange` coalesce:
 * the dual-name context write, the separate `-changed` signal ping, and the
 * same-tab dual CustomEvent dispatch that a single `setCurrentAdminEvent()`
 * produces all resolve to the SAME signature -> one callback. A genuine
 * switch (different `id`) or an in-place edit of the current Event's
 * displayed fields still changes the signature and still notifies.
 */
function readAdminEventScopeSignature(): string {
  const event = getCurrentAdminEvent();

  if (!event) {
    return "";
  }

  const { updatedAt: _updatedAt, version: _version, ...scope } = event;

  return JSON.stringify(scope, Object.keys(scope).sort());
}

/**
 * Canonical subscription to Admin working-Event changes. `callback` fires
 * once per DISTINCT change, whether it originates:
 *
 *   - same-tab, via the `ADMIN_EVENT_UPDATED` CustomEvent (canonical +
 *     legacy name), or
 *   - cross-tab, via the browser `storage` event -- filtered to the
 *     admin-event context / `-changed` signal keys (canonical + legacy) so
 *     an unrelated `localStorage` write in another tab is ignored.
 *
 * The same change arrives several times (the dual CustomEvent dispatch;
 * the up-to-four `storage` events one `setCurrentAdminEvent()` emits in
 * another tab -- context + signal, each under two names). A synchronous
 * distinct-until-changed filter keyed on `readAdminEventScopeSignature()`
 * collapses those repeats to one `callback()`. It never reorders or defers
 * a change and still delivers every step of a real A -> B -> C sequence.
 * It also means a caller that re-persists the Event it just resolved
 * cannot self-trigger a reload loop through this subscription, regardless
 * of any guard at the call site.
 */
export function subscribeToAdminEventChange(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  let lastSignature = readAdminEventScopeSignature();

  const handler = (event: Event) => {
    if (event.type === "storage") {
      const key = (event as StorageEvent).key;

      // A null key means the whole store was cleared -- treat as relevant.
      if (
        key !== null &&
        !storageEventMatches(key, ADMIN_EVENT_KEY, ADMIN_EVENT_CHANGED_KEY)
      ) {
        return;
      }
    }

    const signature = readAdminEventScopeSignature();

    if (signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    callback();
  };

  const removeCustomEventListeners = addDualWindowEventListener(
    ADMIN_EVENT_UPDATED,
    LEGACY_ADMIN_EVENT_UPDATED,
    handler as EventListener,
  );
  window.addEventListener("storage", handler as EventListener);

  return () => {
    removeCustomEventListeners();
    window.removeEventListener("storage", handler as EventListener);
  };
}

/**
 * Back-compat alias. `subscribeToAdminEventChange` is the canonical name;
 * this keeps existing imports (lib/AdminWorkspaceProvider.tsx, tests)
 * working. Before this change `subscribeToAdminEvent` fired on *every*
 * cross-tab `storage` write; it is now filtered and coalesced like every
 * other admin-event subscriber.
 */
export const subscribeToAdminEvent = subscribeToAdminEventChange;
