import assert from "node:assert/strict";
import { test } from "node:test";

import { markerHitRadiusContentPx, pickNearestMarker } from "./hitTest";

// The bug this replaces: on a dense map, adjacent markers' DOM hit boxes
// overlap, so the browser resolved a tap by paint order / z-index rather than
// proximity -- and an assigned (z-elevated) marker then stole taps aimed at its
// neighbours. pickNearestMarker is pure geometry: closest centre wins, always.

const natural = { width: 606, height: 806 }; // real Saint George map dimensions

// A tight vertical column, ~11 native px apart -- the Saint George layout the
// report reproduced against ("primarily vertical, about one site spacing").
function verticalColumn(count: number, spacingPx = 11, xPct = 50, startYpx = 40) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    xPct,
    yPct: ((startYpx + i * spacingPx) / natural.height) * 100,
    size: 8,
  }));
}

function contentOf(m: { xPct: number; yPct: number }) {
  return {
    cx: (m.xPct / 100) * natural.width,
    cy: (m.yPct / 100) * natural.height,
  };
}

test("a tap dead on a marker selects exactly that marker, dense column", () => {
  const markers = verticalColumn(20);
  for (const m of markers) {
    const hit = pickNearestMarker(contentOf(m), markers, natural, 40);
    assert.equal(hit, m.id, `dead-centre tap on ${m.id} must select ${m.id}`);
  }
});

test("a tap just above a marker selects that marker, not the one below it -- the exact reported failure", () => {
  const markers = verticalColumn(20);
  const target = markers[10]!;
  const below = markers[11]!; // in the reported bug this one (selected/elevated) was wrongly chosen
  const p = contentOf(target);
  // 3px above the target's centre -- still clearly closest to `target`
  const hit = pickNearestMarker({ cx: p.cx, cy: p.cy - 3 }, markers, natural, 40);
  assert.equal(hit, target.id);
  assert.notEqual(hit, below.id);
});

test("marker ORDER in the array never changes the result (z-index / paint-order independence)", () => {
  const markers = verticalColumn(20);
  const target = markers[7]!;
  const p = contentOf(target);
  const forward = pickNearestMarker(p, markers, natural, 40);
  const reversed = pickNearestMarker(p, [...markers].reverse(), natural, 40);
  const shuffled = pickNearestMarker(
    p,
    [...markers].sort(() => Math.random() - 0.5),
    natural,
    40,
  );
  assert.equal(forward, target.id);
  assert.equal(reversed, target.id);
  assert.equal(shuffled, target.id);
});

test("the boundary between two adjacent markers is the perpendicular bisector", () => {
  const markers = verticalColumn(20);
  const a = markers[5]!;
  const b = markers[6]!;
  const pa = contentOf(a);
  const pb = contentOf(b);
  const midY = (pa.cy + pb.cy) / 2;
  // Just above the midpoint -> a; just below -> b.
  assert.equal(pickNearestMarker({ cx: pa.cx, cy: midY - 0.5 }, markers, natural, 40), a.id);
  assert.equal(pickNearestMarker({ cx: pa.cx, cy: midY + 0.5 }, markers, natural, 40), b.id);
});

test("a tap in genuinely empty space (beyond the radius) selects nothing", () => {
  const markers = verticalColumn(20);
  const p = contentOf(markers[0]!);
  const far = pickNearestMarker({ cx: p.cx + 500, cy: p.cy + 500 }, markers, natural, 24);
  assert.equal(far, null);
});

test("correct at multiple map positions and at different densities", () => {
  // sparse map: markers 120px apart, larger visible size
  const sparse = Array.from({ length: 6 }, (_, i) => ({
    id: `L${i}`,
    xPct: 10 + i * 15,
    yPct: 20 + i * 12,
    size: 22,
  }));
  for (const m of sparse) {
    assert.equal(pickNearestMarker(contentOf(m), sparse, natural, 40), m.id);
  }
  // corners / edges of the map, dense grid
  const grid: { id: string; xPct: number; yPct: number; size: number }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      grid.push({ id: `g${r}-${c}`, xPct: 4 + c * 13, yPct: 4 + r * 13, size: 9 });
    }
  }
  for (const m of grid) {
    assert.equal(pickNearestMarker(contentOf(m), grid, natural, 40), m.id);
  }
});

test("non-finite marker coords are skipped, not selected", () => {
  const markers = [
    { id: "bad", xPct: NaN, yPct: 10, size: 10 },
    { id: "good", xPct: 50, yPct: 50, size: 10 },
  ];
  const p = contentOf({ xPct: 50, yPct: 50 });
  assert.equal(pickNearestMarker(p, markers, natural, 40), "good");
});

test("markerHitRadiusContentPx honours the floor and grows with the largest marker", () => {
  assert.equal(markerHitRadiusContentPx([{ id: "a", xPct: 1, yPct: 1, size: 8 }], 32), 32);
  assert.equal(markerHitRadiusContentPx([{ id: "a", xPct: 1, yPct: 1, size: 48 }], 32), 48);
  assert.equal(markerHitRadiusContentPx([], 32), 32);
});
