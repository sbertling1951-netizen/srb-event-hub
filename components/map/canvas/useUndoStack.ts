// components/map/canvas/useUndoStack.ts
//
// Undo subsystem. Stores snapshots of marker positions taken BEFORE each
// position-changing operation (nudge / align / distribute / marker-drag).
// The hook owns the stack only; the caller applies restored positions via
// onMarkersChange so persistence stays in the page (per the architecture
// boundary). Mirrors the Master Map Editor's last / all undo behavior.

import { useCallback, useRef, useState } from "react";

import type { MarkerPositionUpdate } from "./types";

type Snapshot = MarkerPositionUpdate[];

export function useUndoStack() {
  const stackRef = useRef<Snapshot[]>([]);
  const [depth, setDepth] = useState(0);

  const sync = useCallback(() => setDepth(stackRef.current.length), []);

  /** Record current positions for the given ids BEFORE mutating them. */
  const capture = useCallback(
    (positions: MarkerPositionUpdate[]) => {
      if (positions.length === 0) return;
      stackRef.current = [...stackRef.current, positions];
      sync();
    },
    [sync],
  );

  /** Pop and return the most recent snapshot to restore (caller persists it). */
  const popLast = useCallback((): Snapshot | null => {
    const stack = stackRef.current;
    if (stack.length === 0) return null;
    const last = stack[stack.length - 1];
    stackRef.current = stack.slice(0, -1);
    sync();
    return last;
  }, [sync]);

  /** Coalesce the EARLIEST recorded position per id across the whole stack. */
  const popAll = useCallback((): Snapshot | null => {
    const stack = stackRef.current;
    if (stack.length === 0) return null;
    const earliest = new Map<string, MarkerPositionUpdate>();
    for (const snap of stack) {
      for (const item of snap) {
        if (!earliest.has(item.id)) earliest.set(item.id, item);
      }
    }
    stackRef.current = [];
    sync();
    return Array.from(earliest.values());
  }, [sync]);

  const clear = useCallback(() => {
    stackRef.current = [];
    sync();
  }, [sync]);

  return { capture, popLast, popAll, clear, depth };
}
