// components/map/canvas/useSelection.ts
//
// Selection subsystem. MapCanvas-owned by default (the canonical model from the
// Master Map Editor: a set of selectedIds plus a primaryId, with shift/tap
// toggle and rectangle marquee). Supports an optional controlled mode when the
// page passes selectedIds/primaryId. Reports every change via onSelectionChange.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { normalizeRectPct, pointInRectPct } from "./coords";
import type { MapMarker, Selection } from "./types";

type Args = {
  markers: MapMarker[];
  controlledIds?: string[];
  controlledPrimary?: string | null;
  onSelectionChange?: (sel: Selection) => void;
};

const EMPTY: Selection = { selectedIds: [], primaryId: null };

export function useSelection({
  markers,
  controlledIds,
  controlledPrimary,
  onSelectionChange,
}: Args) {
  const controlled = controlledIds !== undefined;
  const [internal, setInternal] = useState<Selection>(EMPTY);

  const selection: Selection = useMemo(
    () =>
      controlled
        ? {
            selectedIds: controlledIds ?? [],
            primaryId: controlledPrimary ?? null,
          }
        : internal,
    [controlled, controlledIds, controlledPrimary, internal],
  );

  // keep a ref so event handlers read live selection without re-subscribing
  const selRef = useRef(selection);
  useEffect(() => {
    selRef.current = selection;
  }, [selection]);

  const emit = useCallback(
    (next: Selection) => {
      if (!controlled) {
        setInternal(next);
      }
      onSelectionChange?.(next);
    },
    [controlled, onSelectionChange],
  );

  const isSelectable = useCallback(
    (id: string) => {
      const m = markers.find((mm) => mm.id === id);
      return !!m && m.selectable !== false;
    },
    [markers],
  );

  const selectSingle = useCallback(
    (id: string) => {
      if (!isSelectable(id)) {
        return;
      }
      emit({ selectedIds: [id], primaryId: id });
    },
    [emit, isSelectable],
  );

  const toggle = useCallback(
    (id: string) => {
      if (!isSelectable(id)) {
        return;
      }
      const cur = selRef.current;
      const has = cur.selectedIds.includes(id);
      const ids = has
        ? cur.selectedIds.filter((x) => x !== id)
        : [...cur.selectedIds, id];
      const primaryId = has ? (ids[0] ?? null) : id;
      emit({ selectedIds: ids, primaryId });
    },
    [emit, isSelectable],
  );

  const setMany = useCallback(
    (ids: string[], primaryId?: string | null) => {
      const filtered = ids.filter(isSelectable);
      emit({
        selectedIds: filtered,
        primaryId: primaryId !== undefined ? primaryId : (filtered[0] ?? null),
      });
    },
    [emit, isSelectable],
  );

  const clear = useCallback(() => emit(EMPTY), [emit]);

  /** Select all selectable markers whose percent point falls inside the marquee. */
  const selectInRect = useCallback(
    (a: { xPct: number; yPct: number }, b: { xPct: number; yPct: number }) => {
      const rect = normalizeRectPct(a, b);
      const ids = markers
        .filter(
          (m) =>
            m.selectable !== false &&
            Number.isFinite(m.xPct) &&
            Number.isFinite(m.yPct) &&
            pointInRectPct(m.xPct, m.yPct, rect),
        )
        .map((m) => m.id);
      const currentPrimary = selRef.current.primaryId;

      console.log("RECT SELECT IDS", ids.length, ids);

      const primaryId = ids.includes(currentPrimary ?? "")
        ? currentPrimary
        : (ids[0] ?? null);

      emit({ selectedIds: ids, primaryId });
    },
    [emit, markers],
  );

  const selectedSet = useMemo(
    () => new Set(selection.selectedIds),
    [selection.selectedIds],
  );

  return {
    selection,
    selectedSet,
    selectSingle,
    toggle,
    setMany,
    clear,
    selectInRect,
    getSelection: () => selRef.current,
  };
}
