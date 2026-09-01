// components/map/canvas/hitTest.ts
//
// Marker hit-testing — PURE, no React, no DOM. Given a tap that the coordinate
// engine (coords.ts / GestureMapViewportV2) has already resolved to CONTENT-space
// pixels, this decides WHICH marker (if any) that tap selects.
//
// Why this exists
// ---------------
// MarkerLayer positions every marker as an absolutely-placed DOM element and
// (for selectionMode="none" consumers) used to let the browser's own hit-testing
// pick whichever marker element sat under the cursor. Each marker carries a
// minimum touch target (MARKER_MIN_HIT_AREA_PX = 32 native px). On a dense map
// -- Saint George Parking is ~230 sites roughly 11 native px apart -- that target
// is ~3x the real spacing, so adjacent markers' invisible hit boxes overlap
// heavily and the browser resolves the tap by paint order / CSS z-index, NEVER by
// which marker is actually closest. The instant one marker gains an elevated
// z-index (which selecting an assigned site does), it starts capturing taps aimed
// at the markers around it -- exactly the "click one marker, the neighbouring
// site gets selected, only after an assignment" report.
//
// The fix is a deterministic, geometry-only rule: the marker whose centre is
// closest to the tap wins. Overlap, paint order and z-index become irrelevant.

import { percentToContent, type Size } from "./coords";

export type HitTestMarker = {
  id: string;
  /** 0..100 of natural width */
  xPct: number;
  /** 0..100 of natural height */
  yPct: number;
  /** visible diameter in native/content px, if known (feeds the accept radius) */
  size?: number;
};

/**
 * The id of the marker whose centre is nearest `point` (content-space px),
 * provided that centre is within `maxRadiusContentPx`. Nearest wins; an exact
 * tie resolves to the earlier marker in `markers`. Returns null when nothing is
 * in range -- the caller then treats the tap as empty-map space.
 *
 * Pure geometry. The caller converts the raw pointer position to content-space
 * px first (via the engine transform), so this is independent of zoom, pan,
 * container size, device pixel ratio, and any CSS scaling on the way down.
 */
export function pickNearestMarker(
  point: { cx: number; cy: number },
  markers: readonly HitTestMarker[],
  natural: Size,
  maxRadiusContentPx: number,
): string | null {
  let bestId: string | null = null;
  let bestDistSq =
    Number.isFinite(maxRadiusContentPx) && maxRadiusContentPx > 0
      ? maxRadiusContentPx * maxRadiusContentPx
      : Infinity;

  for (const m of markers) {
    if (!Number.isFinite(m.xPct) || !Number.isFinite(m.yPct)) {
      continue;
    }
    const { cx, cy } = percentToContent(m.xPct, m.yPct, natural);
    const dx = cx - point.cx;
    const dy = cy - point.cy;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = m.id;
    }
  }

  return bestId;
}

/**
 * The content-px radius within which a tap counts as "on" a marker at all.
 * Derived from the markers' own rendered size with a floor, so it tracks marker
 * density instead of being a fixed screen guess. Because pickNearestMarker is
 * nearest-wins, this only governs the marker-vs-empty-space boundary -- never
 * which of two markers is chosen.
 */
export function markerHitRadiusContentPx(
  markers: readonly HitTestMarker[],
  minRadiusContentPx: number,
): number {
  let maxSize = 0;
  for (const m of markers) {
    if (typeof m.size === "number" && Number.isFinite(m.size) && m.size > maxSize) {
      maxSize = m.size;
    }
  }
  return Math.max(minRadiusContentPx, maxSize);
}
