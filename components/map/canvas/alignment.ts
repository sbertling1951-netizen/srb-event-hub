// components/map/canvas/alignment.ts
//
// Alignment / distribution — PURE. Operates in percent space and returns
// MarkerPositionUpdate[] for the caller to persist (via onMarkersChange).
//
// Semantics match the canonical Master Map Editor exactly:
//   align "horizontal"  -> all selected share the MEAN yPct (a horizontal row)
//   align "vertical"    -> all selected share the MEAN xPct (a vertical column)
//   distribute "horizontal" -> even xPct spacing between the extremes (sorted by x)
//   distribute "vertical"   -> even yPct spacing between the extremes (sorted by y)
//
// Minimum selection: align >= 2, distribute >= 3 (as in the reference).

import { round2 } from "./coords";
import type { AlignAxis, DistributeAxis, MapMarker, MarkerPositionUpdate } from "./types";

function selectedWithCoords(markers: MapMarker[], ids: string[]): MapMarker[] {
  const set = new Set(ids);
  return markers.filter(
    (m) => set.has(m.id) && Number.isFinite(m.xPct) && Number.isFinite(m.yPct),
  );
}

export function alignMarkers(
  markers: MapMarker[],
  ids: string[],
  axis: AlignAxis,
): MarkerPositionUpdate[] {
  const sel = selectedWithCoords(markers, ids);
  if (sel.length < 2) return [];

  if (axis === "horizontal") {
    const meanY = round2(sel.reduce((s, m) => s + m.yPct, 0) / sel.length);
    return sel.map((m) => ({ id: m.id, xPct: round2(m.xPct), yPct: meanY }));
  }
  const meanX = round2(sel.reduce((s, m) => s + m.xPct, 0) / sel.length);
  return sel.map((m) => ({ id: m.id, xPct: meanX, yPct: round2(m.yPct) }));
}

export function distributeMarkers(
  markers: MapMarker[],
  ids: string[],
  axis: DistributeAxis,
): MarkerPositionUpdate[] {
  const sel = selectedWithCoords(markers, ids);
  if (sel.length < 3) return [];

  if (axis === "horizontal") {
    const sorted = [...sel].sort((a, b) => a.xPct - b.xPct);
    const start = sorted[0].xPct;
    const end = sorted[sorted.length - 1].xPct;
    const step = (end - start) / (sorted.length - 1);
    return sorted.map((m, i) => ({
      id: m.id,
      xPct: round2(start + step * i),
      yPct: round2(m.yPct),
    }));
  }
  const sorted = [...sel].sort((a, b) => a.yPct - b.yPct);
  const start = sorted[0].yPct;
  const end = sorted[sorted.length - 1].yPct;
  const step = (end - start) / (sorted.length - 1);
  return sorted.map((m, i) => ({
    id: m.id,
    xPct: round2(m.xPct),
    yPct: round2(start + step * i),
  }));
}

/** Nudge a set of markers by a percent delta, clamped to 0..100. */
export function nudgeMarkers(
  markers: MapMarker[],
  ids: string[],
  dxPct: number,
  dyPct: number,
): MarkerPositionUpdate[] {
  const sel = selectedWithCoords(markers, ids);
  return sel.map((m) => ({
    id: m.id,
    xPct: round2(Math.max(0, Math.min(100, m.xPct + dxPct))),
    yPct: round2(Math.max(0, Math.min(100, m.yPct + dyPct))),
  }));
}
