import assert from "node:assert/strict";
import { test } from "node:test";

import {
  centerOnPercentTransform,
  fitTransform,
  viewportToState,
} from "./coords";

const viewport = { width: 900, height: 600 };
const natural = { width: 1200, height: 800 };

test("centerOnPercentTransform centers the natural map while preserving default, zoomed-in, and zoomed-out scales", () => {
  for (const scale of [0.6, 3, 0.3]) {
    const transform = centerOnPercentTransform(50, 50, scale, viewport, natural);
    const state = viewportToState(transform, viewport, natural);

    assert.equal(state.scale, scale);
    assert.equal(state.centerXPct, 50);
    assert.equal(state.centerYPct, 50);
  }
});

test("repeated center-only transforms are stable and do not fall back to fit scale", () => {
  const first = centerOnPercentTransform(50, 50, 3, viewport, natural);
  const second = centerOnPercentTransform(50, 50, first.scale, viewport, natural);
  const reset = fitTransform(viewport, natural, 0.1, 3);

  assert.deepEqual(second, first);
  assert.equal(second.scale, 3);
  assert.notEqual(reset.scale, second.scale);
});
