import assert from "node:assert/strict";
import { test } from "node:test";

import { computeNearestNeighborSpacingPx, resolveDensityAwareMarkerSize } from "./markerSizing";

test("computeNearestNeighborSpacingPx returns null for fewer than 2 markers", () => {
  assert.equal(computeNearestNeighborSpacingPx([], { width: 606, height: 806 }), null);
  assert.equal(
    computeNearestNeighborSpacingPx([{ xPct: 50, yPct: 50 }], { width: 606, height: 806 }),
    null,
  );
});

test("computeNearestNeighborSpacingPx returns null when natural dimensions are zero", () => {
  assert.equal(
    computeNearestNeighborSpacingPx(
      [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 100 },
      ],
      { width: 0, height: 0 },
    ),
    null,
  );
});

test("computeNearestNeighborSpacingPx computes exact spacing for a known synthetic grid", () => {
  // A 100x100 natural image with markers at 0%, 10%, 20% along x (y fixed):
  // native px positions 0, 10, 20 -- every marker's nearest neighbor is
  // exactly 10px away, so median/p10/min must all be exactly 10.
  const markers = [
    { xPct: 0, yPct: 50 },
    { xPct: 10, yPct: 50 },
    { xPct: 20, yPct: 50 },
  ];
  const stats = computeNearestNeighborSpacingPx(markers, { width: 100, height: 100 });
  assert.ok(stats);
  assert.equal(stats!.min, 10);
  assert.equal(stats!.median, 10);
  assert.equal(stats!.p10, 10);
});

test("computeNearestNeighborSpacingPx's p10 reflects the densest cluster, not the average", () => {
  // Two markers 2px apart (a dense cluster), and two more markers each
  // 100px from their nearest neighbor (sparse). The median across a
  // mixed set should sit well below a naive average, and p10 should
  // reflect the tight cluster.
  const markers = [
    { xPct: 0, yPct: 0 },
    { xPct: 2, yPct: 0 }, // 2 native px from marker 0 (width below is 100)
    { xPct: 52, yPct: 0 }, // 50 native px from marker 1
    { xPct: 102, yPct: 0 }, // 50 native px from marker 2
  ];
  const stats = computeNearestNeighborSpacingPx(markers, { width: 100, height: 100 });
  assert.ok(stats);
  assert.equal(stats!.min, 2);
  assert.ok(stats!.p10 <= 2, "p10 should reflect the tight cluster, not the sparse gaps");
});

test("resolveDensityAwareMarkerSize falls back to the ceiling with unknown spacing", () => {
  assert.equal(resolveDensityAwareMarkerSize(null, { isNarrow: false }), 22);
  assert.equal(resolveDensityAwareMarkerSize(null, { isNarrow: true }), 32);
});

test("resolveDensityAwareMarkerSize clamps to the floor for very dense real-world spacing", () => {
  // Saint George: median ~11.1 native px, p10 ~10.1 native px.
  const size = resolveDensityAwareMarkerSize(
    { median: 11.1, p10: 10.1, min: 9.3 },
    { isNarrow: true },
  );
  assert.equal(size, 8, "dense spacing must clamp to the legibility floor, not scale below it");
});

test("resolveDensityAwareMarkerSize clamps to the ceiling for sparse spacing", () => {
  const size = resolveDensityAwareMarkerSize({ median: 500, p10: 400, min: 300 }, { isNarrow: false });
  assert.equal(size, 22, "sparse spacing must clamp to the ceiling, not grow unbounded");
});

test("resolveDensityAwareMarkerSize enlarges a selected marker relative to its own base size", () => {
  const base = resolveDensityAwareMarkerSize({ median: 100, p10: 90, min: 80 }, { isNarrow: false });
  const selected = resolveDensityAwareMarkerSize(
    { median: 100, p10: 90, min: 80 },
    { isNarrow: false, selected: true },
  );
  assert.ok(selected > base, "a selected marker must render larger than its own unselected size");
});
