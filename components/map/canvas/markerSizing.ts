// components/map/canvas/markerSizing.ts
//
// Density-aware marker sizing. Every marker lives inside the same
// pre-transform coordinate space as the map image (percentages resolve
// against the natural, unscaled image size), so a diameter expressed in
// native image px keeps the same visual proportion to the underlying
// artwork at any pinch/zoom level -- it is not something that needs to
// track scale itself. What it does need to track is how tightly the
// real markers on a given map are actually packed, which fixed
// screen-px marker sizes (14-60px across the various pages that predate
// this file) never accounted for: a dense map (Saint George's 234 sites
// on a 606x806 image, ~11 native px apart) needs a much smaller marker
// than a sparse one to avoid the marker's own footprint overwhelming
// the real site spacing -- confirmed against real production data
// during the Shared Map Engine Stage 2D investigation.

export type MarkerSpacingStats = {
  /** median nearest-neighbor distance across all markers, native px */
  median: number;
  /** 10th percentile (the tightest 10% of gaps), native px */
  p10: number;
  /** the single tightest gap, native px */
  min: number;
};

/**
 * Computes real nearest-neighbor spacing between markers, in native
 * image px. Returns null when there are fewer than 2 markers (spacing
 * is undefined) so callers can fall back to a sane default size.
 */
export function computeNearestNeighborSpacingPx(
  markers: { xPct: number; yPct: number }[],
  natural: { width: number; height: number },
): MarkerSpacingStats | null {
  if (markers.length < 2 || !natural.width || !natural.height) {
    return null;
  }

  const points = markers.map((m) => ({
    x: (m.xPct / 100) * natural.width,
    y: (m.yPct / 100) * natural.height,
  }));

  const distances: number[] = [];
  for (let i = 0; i < points.length; i++) {
    let best = Infinity;
    for (let j = 0; j < points.length; j++) {
      if (i === j) {
        continue;
      }
      const dx = points[i]!.x - points[j]!.x;
      const dy = points[i]!.y - points[j]!.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) {
        best = d;
      }
    }
    if (Number.isFinite(best)) {
      distances.push(best);
    }
  }

  if (distances.length === 0) {
    return null;
  }

  distances.sort((a, b) => a - b);
  const median = distances[Math.floor(distances.length / 2)]!;
  const p10 = distances[Math.floor(distances.length * 0.1)]!;
  const min = distances[0]!;

  return { median, p10, min };
}

const DEFAULT_FLOOR_PX = 8;
const DEFAULT_CEILING_PX = 22;
const DEFAULT_NARROW_CEILING_PX = 32;
/** How much of the real gap between neighbors a marker may occupy. */
const DEFAULT_SPACING_FRACTION = 0.7;
/** How much larger a selected marker renders than its own base size. */
export const SELECTED_SIZE_MULTIPLIER = 1.35;

/**
 * Resolves a marker diameter, in native image px, from real spacing
 * stats. Uses p10 (the tightest 10% of gaps) rather than the median so
 * a map with one dense cluster and mostly sparse markers still sizes
 * for its densest area, not its average. Falls back to the (narrow-
 * aware) ceiling when spacing is unknown (fewer than 2 markers).
 */
export function resolveDensityAwareMarkerSize(
  spacing: MarkerSpacingStats | null,
  opts: { isNarrow: boolean; selected?: boolean } = { isNarrow: false },
): number {
  const ceiling = opts.isNarrow ? DEFAULT_NARROW_CEILING_PX : DEFAULT_CEILING_PX;
  const base = spacing
    ? Math.max(DEFAULT_FLOOR_PX, Math.min(ceiling, spacing.p10 * DEFAULT_SPACING_FRACTION))
    : ceiling;

  return opts.selected ? base * SELECTED_SIZE_MULTIPLIER : base;
}
