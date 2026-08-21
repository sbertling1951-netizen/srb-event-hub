import assert from "node:assert/strict";
import { test } from "node:test";

import { pickSampleSites } from "./MapGeometryTestClient";

// Stage 2B diagnostic: pickSampleSites must spread its five sample points
// across the FULL vertical extent of the map (upper/upper-mid/center/
// lower-mid/lower), since the whole point of Stage 2B's error-function
// readout is checking whether error grows with distance down the map --
// clustering samples near one end would silently hide exactly the
// spatially-progressive error pattern this diagnostic exists to catch.

function site(id: string, y: number) {
  return { id, site_number: id, display_label: null, map_x: 50, map_y: y };
}

test("spreads five samples across the full sorted range for a large site list", () => {
  const sites = Array.from({ length: 100 }, (_, i) => site(`s${i}`, i));
  const picked = pickSampleSites(sites);
  const ys = picked.map((s) => s.map_y);
  assert.equal(ys.length, 5);
  assert.equal(ys[0], 0);
  assert.equal(ys[ys.length - 1], 99);
  // Strictly increasing -- upper, upper-mid, center, lower-mid, lower.
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i]! > ys[i - 1]!, `expected ${ys[i]} > ${ys[i - 1]}`);
  }
});

test("returns an empty list when no site has a y coordinate", () => {
  const sites = [{ id: "a", site_number: "a", display_label: null, map_x: 50, map_y: null }];
  assert.deepEqual(pickSampleSites(sites), []);
});

test("de-duplicates sample positions for a small site list without erroring", () => {
  const sites = [site("a", 0), site("b", 50), site("c", 100)];
  const picked = pickSampleSites(sites);
  const ids = picked.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(picked.length <= 5 && picked.length >= 1);
});

test("sorts by y regardless of input order", () => {
  const sites = [site("bottom", 90), site("top", 5), site("mid", 50)];
  const picked = pickSampleSites(sites);
  const ys = picked.map((s) => s.map_y);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i]! >= ys[i - 1]!);
  }
});
