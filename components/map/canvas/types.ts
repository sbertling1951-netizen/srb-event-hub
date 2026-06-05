// components/map/canvas/types.ts
//
// Public API for the MapCanvas platform engine. Coordinates are ALWAYS
// percentages of the natural image dimensions (0..100). No pixel/viewport
// values cross this boundary — that is what guarantees cross-page parity.

import type { ReactNode } from "react";

export type MapPercentPoint = { xPct: number; yPct: number };

export type MarkerPositionUpdate = { id: string; xPct: number; yPct: number };

export type MapViewportState = {
  scale: number;
  /** percent point currently at the viewport center */
  centerXPct: number;
  centerYPct: number;
};

export type SelectionMode = "none" | "single" | "multi" | "rectangle";

/** A point in the viewport's internal transform space. */
export type ViewTransform = { scale: number; panX: number; panY: number };

export type MapMarker = {
  id: string;
  /** 0..100 of natural image dimensions — the source of truth */
  xPct: number;
  yPct: number;
  /** page-computed presentation (business rule output), all optional */
  label?: string;
  color?: string;
  size?: number;
  /** logical layer so multiple marker types can coexist (e.g. "sites" vs "amenities") */
  layer?: string;
  /** default true; non-selectable markers (e.g. amenity pins) ignore selection */
  selectable?: boolean;
  /** arbitrary payload round-tripped back in callbacks */
  data?: unknown;
};

/** Canonical Master Map Editor semantics: align = equalize to mean. */
export type AlignAxis = "horizontal" | "vertical"; // horizontal => shared Y (mean), vertical => shared X (mean)
export type DistributeAxis = "horizontal" | "vertical";

export type Selection = { selectedIds: string[]; primaryId: string | null };

export type MapCanvasHandle = {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  centerOnMarker(id: string, scale?: number): void;
  centerOnPercent(xPct: number, yPct: number, scale?: number): void;
  getViewport(): MapViewportState;

  getViewportTransform():
    | {
        x: number;
        y: number;
        scale: number;
      }
    | undefined;

  setViewportTransform(x: number, y: number, scale: number): void;

  // selection (MapCanvas-owned; reports out via onSelectionChange)

  // selection (MapCanvas-owned; reports out via onSelectionChange)
  getSelection(): Selection;
  setSelection(ids: string[], primaryId?: string | null): void;
  clearSelection(): void;

  // bulk geometry ops — compute here (coordinate math), emit via onMarkersChange,
  // the page persists. Mean-based align per the canonical reference.
  alignSelected(axis: AlignAxis): void;
  distributeSelected(axis: DistributeAxis): void;
  nudgeSelected(dxPct: number, dyPct: number): void;

  // undo subsystem
  undo(): void;
  undoAll(): void;
  undoDepth(): number;
};

export interface MapCanvasProps {
  imageUrl: string | null;
  markers?: MapMarker[];
  /** optional explicit natural size; otherwise read from the image onLoad */
  naturalWidth?: number;
  naturalHeight?: number;

  // capabilities
  editable?: boolean;
  selectionMode?: SelectionMode;
  showLabels?: boolean;
  pendingMarker?: MapPercentPoint | null;

  // controlled selection (optional — omit to let MapCanvas own it)
  selectedIds?: string[];
  primaryId?: string | null;

  // viewport
  viewportHeight?: string | number;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  /** apply the full-bleed page scroll lock (generalized coach-map-lock) while mounted */
  lockPageScroll?: boolean;

  // callbacks — PERCENT coordinates only
  onMapTap?: (pt: MapPercentPoint) => void; // clean tap on empty map (not drag/pinch)
  onMarkerTap?: (markerId: string) => void;
  onSelectionChange?: (sel: Selection) => void;
  onMarkersChange?: (updates: MarkerPositionUpdate[]) => void; // align/distribute/nudge/undo results
  onViewportChange?: (vp: MapViewportState) => void;

  // reserved future marker drag-editing (touch + mouse); structured for, off by default
  onMarkerMoveStart?: (id: string) => void;
  onMarkerMove?: (u: MarkerPositionUpdate) => void;
  onMarkerMoveEnd?: (u: MarkerPositionUpdate) => void;

  /** optional page-supplied marker visual; MapCanvas still positions it */
  renderMarker?: (
    marker: MapMarker,
    state: { selected: boolean; primary: boolean },
  ) => ReactNode;

  /** extra overlay children rendered inside the content layer (e.g. amenity layer) */
  children?: ReactNode;
}
