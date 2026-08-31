import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  clearCurrentAdminEvent,
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
  shouldPersistResolvedAdminEvent,
  subscribeToAdminEventChange,
} from "@/lib/adminEventContext";

export {
  clearCurrentAdminEvent,
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
  shouldPersistResolvedAdminEvent,
  subscribeToAdminEventChange,
};

export type AdminWorkspaceStatus = "loading" | "ready" | "unavailable";

export interface AdminWorkspaceSnapshot {
  event: ReturnType<typeof getCurrentAdminEvent>;
  status: AdminWorkspaceStatus;
  hasEvent: boolean;
}

export function getAdminWorkspace(): AdminWorkspaceSnapshot {
  const event = getCurrentAdminEvent();

  return {
    event,
    status: event ? "ready" : "unavailable",
    hasEvent: !!event,
  };
}

interface AdminWorkspaceContextValue extends AdminWorkspaceSnapshot {
  refresh: () => void;
}

const AdminWorkspaceContext =
  createContext<AdminWorkspaceContextValue | null>(null);

export function AdminWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [workspace, setWorkspace] = useState(getAdminWorkspace);

  const refresh = () => {
    setWorkspace(getAdminWorkspace());
  };

  useEffect(() => subscribeToAdminWorkspace(refresh), []);

  const value = useMemo(
    () => ({ ...workspace, refresh }),
    [workspace],
  );

  return (
    <AdminWorkspaceContext.Provider value={value}>
      {children}
    </AdminWorkspaceContext.Provider>
  );
}

export function useAdminWorkspace() {
  const context = useContext(AdminWorkspaceContext);

  if (!context) {
    throw new Error(
      "useAdminWorkspace must be used within an AdminWorkspaceProvider",
    );
  }

  return context;
}

/**
 * Subscribe to Admin working-Event changes. Thin alias for the canonical
 * `subscribeToAdminEventChange` so every event-scoped Admin page shares one
 * implementation: same-tab CustomEvent *and* cross-tab `storage` events (key
 * filtered), coalesced to one callback per distinct change. Pages that
 * additionally need to invalidate stale event-scoped state and reject late
 * results should use `useAdminWorkingEventScope` instead of a bare reload.
 */
export function subscribeToAdminWorkspace(callback: () => void): () => void {
  return subscribeToAdminEventChange(callback);
}

// ---------------------------------------------------------------------------
// Shared working-Event scope: stale-state invalidation + stale-result guard.
//
// A working-Event change (this tab or another) must, in every event-scoped
// consumer: update the local selected-Event state, drop the data loaded for
// the previous Event *before* the new fetch resolves, and make any late
// response or queued mutation for the previous Event a no-op. This is the
// shared mechanism; a page supplies only its own "clear + refetch" closure.
// ---------------------------------------------------------------------------

export interface AdminWorkingEventScope {
  /** Canonical working-Event id, reactive to same-tab AND cross-tab change. */
  eventId: string | null;
  /** Increments once per working-Event change. */
  generation: number;
  /** Snapshot the live generation at the start of an async load/action. */
  captureGeneration: () => number;
  /**
   * False once the working Event has changed since `generation` was
   * captured. Gate every post-await `setState` and every mutation on this
   * so a result or action for Event A cannot land after switching to B.
   */
  isCurrent: (generation: number) => boolean;
}

interface WorkingEventScopeCore {
  readonly generation: number;
  readonly eventId: string | null;
  /** Record the latest working-Event id; reports whether the scope changed. */
  sync: (eventId: string | null) => { changed: boolean; generation: number };
  isCurrent: (generation: number) => boolean;
}

/**
 * Pure core of `useAdminWorkingEventScope` -- no React, no DOM. Exported for
 * focused tests of the generation / stale-result-rejection contract.
 */
export function createAdminWorkingEventScopeCore(
  initialEventId: string | null,
): WorkingEventScopeCore {
  const state: { generation: number; eventId: string | null } = {
    generation: 0,
    eventId: initialEventId,
  };

  return {
    get generation() {
      return state.generation;
    },
    get eventId() {
      return state.eventId;
    },
    sync(eventId: string | null) {
      if (eventId === state.eventId) {
        return { changed: false, generation: state.generation };
      }
      state.eventId = eventId;
      state.generation += 1;
      return { changed: true, generation: state.generation };
    },
    isCurrent(generation: number) {
      return generation === state.generation;
    },
  };
}

/**
 * Subscribe a component to working-Event changes with a shared
 * invalidation + stale-result guard.
 *
 * `onChange(nextEventId)` runs *synchronously* the moment the working Event
 * changes -- before React re-renders and long before any refetch resolves.
 * Use it to clear the previous Event's state and kick off the new load.
 *
 * The returned `captureGeneration()` / `isCurrent()` reject late work:
 * snapshot the generation before an await, check `isCurrent(snapshot)`
 * after it (and before any mutation) so Event A's response or queued
 * action cannot repopulate or mutate Event B.
 */
export function useAdminWorkingEventScope(
  onChange?: (nextEventId: string | null) => void,
): AdminWorkingEventScope {
  const coreRef = useRef<WorkingEventScopeCore | null>(null);
  const core =
    coreRef.current ??
    (coreRef.current = createAdminWorkingEventScopeCore(
      getCurrentAdminEvent()?.id ?? null,
    ));

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [, forceRender] = useState(0);

  useEffect(() => {
    const settle = () => {
      const { changed } = core.sync(getCurrentAdminEvent()?.id ?? null);
      if (!changed) {
        return;
      }
      // Synchronous: the caller clears Event A's state and starts Event B's
      // load here; `isCurrent()` already reports the bumped generation.
      onChangeRef.current?.(core.eventId);
      forceRender((n) => n + 1);
    };

    // The working Event can change between the initial render and this
    // effect running; settle() is a no-op when it did not.
    settle();

    return subscribeToAdminEventChange(settle);
  }, [core]);

  const captureGeneration = useCallback(() => core.generation, [core]);
  const isCurrent = useCallback(
    (generation: number) => core.isCurrent(generation),
    [core],
  );

  return {
    eventId: core.eventId,
    generation: core.generation,
    captureGeneration,
    isCurrent,
  };
}

