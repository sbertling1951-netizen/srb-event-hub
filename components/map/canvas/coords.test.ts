import assert from "node:assert/strict";
import { test } from "node:test";

import {
  centerOnPercentTransform,
  clampPan,
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


test("clampPan admits the centered pan for an undersized axis (balanced position, not the top-left origin)", () => {
  // The exact case from the Center repair: 606x806 image at 0.3 in a 368x243
  // content viewport. The X axis is undersized (181.8 < 368); its centered pan
  // is (368 - 181.8) / 2 = 93.1. The old clamp capped X at overscroll*1.5
  // (~44.16) around the origin and rejected 93.1; the fix admits it.
  const vp = { width: 368, height: 243 };
  const nat = { width: 606, height: 806 };
  const scale = 0.3;
  const centeredX = (vp.width - nat.width * scale) / 2; // 93.1
  const c = clampPan(centeredX, 0, scale, vp, nat);
  assert.ok(Math.abs(c.panX - centeredX) < 1e-9, `centered undersized pan must be admitted, got ${c.panX}`);
  // Overscroll is allowed AROUND the centered position, and springs back to it.
  const overX = Math.min(60, vp.width * 0.08);
  const farRight = clampPan(centeredX + 999, 0, scale, vp, nat);
  assert.ok(Math.abs(farRight.panX - (centeredX + overX * 1.5)) < 1e-9, "overscroll is measured from the centered position");
  const farLeft = clampPan(centeredX - 999, 0, scale, vp, nat);
  assert.ok(Math.abs(farLeft.panX - (centeredX - overX * 1.5)) < 1e-9, "left overscroll is measured from the centered position");
});

test("clampPan preserves oversized-axis limits unchanged (edges reachable, centered pan admitted)", () => {
  // Y axis oversized: 806*0.6 = 483.6 > 400.
  const vp = { width: 400, height: 400 };
  const nat = { width: 606, height: 806 };
  const scale = 0.6;
  const scaledH = nat.height * scale; // 483.6 (oversized)
  const overY = Math.min(40, vp.height * 0.06);
  const minY = Math.min(0, vp.height - scaledH) - overY;
  const centeredY = (vp.height - scaledH) / 2; // negative, within [minY, overY]
  assert.ok(Math.abs(clampPan(0, centeredY, scale, vp, nat).panY - centeredY) < 1e-9, "oversized centered pan admitted");
  assert.ok(Math.abs(clampPan(0, minY - 999, scale, vp, nat).panY - minY) < 1e-9, "oversized lower bound unchanged");
  assert.ok(Math.abs(clampPan(0, 999, scale, vp, nat).panY - overY) < 1e-9, "oversized upper bound unchanged");
});

test("clampPan centers a mixed-axis image on the undersized axis while clamping the oversized axis", () => {
  // 1600x240 @0.3 -> 480x72: X oversized (480>402 content), Y undersized (72<vh).
  const vp = { width: 402, height: 510 };
  const nat = { width: 1600, height: 240 };
  const scale = 0.3;
  const centeredY = (vp.height - nat.height * scale) / 2;
  const c = clampPan(0, centeredY, scale, vp, nat);
  assert.ok(Math.abs(c.panY - centeredY) < 1e-9, "undersized Y admits centered pan");
});
