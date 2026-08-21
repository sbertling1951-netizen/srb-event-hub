import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { shouldAllowNativeClickThrough } from "./GestureMapViewportV2";

// Shared Map Engine, Stage 1: finger-touch activation of interactive
// markers/labels. shouldAllowNativeClickThrough is the pure decision
// GestureMapViewportV2's onTouchEnd consults to decide whether to skip
// preventDefault() and let the browser's own touch-to-click synthesis
// proceed -- the exact mechanism MarkerLayer's onClick (and any other
// consumer's own click handler on a [data-marker-id] element) depends on.
// No DOM test environment (jsdom included) implements real touch-to-click
// synthesis, so this file proves the decision logic directly; the actual
// browser behavior was verified against the live, unmodified engine via
// real Chromium touch dispatch at /dev/map-test across iPhone/iPad
// portrait and landscape sizes (see task closeout).

function marker(): { closest(selector: string): unknown } {
  return { closest: (selector: string) => (selector === "[data-marker-id]" ? {} : null) };
}

function emptySpace(): { closest(selector: string): unknown } {
  return { closest: () => null };
}

test("a genuine tap landing on an interactive marker allows the native click through", () => {
  assert.equal(
    shouldAllowNativeClickThrough({
      tapCandidate: true,
      startedWithTwoTouches: false,
      target: marker(),
    }),
    true,
  );
});

test("a genuine tap landing on empty space does not allow the native click through (unchanged empty-tap path)", () => {
  assert.equal(
    shouldAllowNativeClickThrough({
      tapCandidate: true,
      startedWithTwoTouches: false,
      target: emptySpace(),
    }),
    false,
  );
});

test("a drag (tapCandidate false) never allows the native click through, even if it ends over a marker", () => {
  assert.equal(
    shouldAllowNativeClickThrough({
      tapCandidate: false,
      startedWithTwoTouches: false,
      target: marker(),
    }),
    false,
  );
});

test("a two-finger tap-to-zoom gesture never allows the native click through, even over a marker", () => {
  assert.equal(
    shouldAllowNativeClickThrough({
      tapCandidate: true,
      startedWithTwoTouches: true,
      target: marker(),
    }),
    false,
  );
});

test("a null/undefined target (no element under the touch point) never allows the native click through", () => {
  assert.equal(
    shouldAllowNativeClickThrough({
      tapCandidate: true,
      startedWithTwoTouches: false,
      target: null,
    }),
    false,
  );
  assert.equal(
    shouldAllowNativeClickThrough({
      tapCandidate: true,
      startedWithTwoTouches: false,
      target: undefined,
    }),
    false,
  );
});

// --- Source-level regression guards -----------------------------------
// Real touch-to-click synthesis can't be exercised in this test runner, so
// these guard the exact structural invariant the fix depends on: nothing
// may reintroduce an unconditional preventDefault() ahead of the
// classification above, and the drag/pinch/zoom mechanics this stage must
// not touch remain byte-identical.

const SOURCE = readFileSync(
  fileURLToPath(new URL("./GestureMapViewportV2.tsx", import.meta.url)),
  "utf8",
);

function extractOnTouchEnd(): string {
  const start = SOURCE.indexOf("onTouchEnd={(e) => {");
  assert.ok(start >= 0, "expected to find onTouchEnd");
  // The handler is the last of the JSX event props before the root div's
  // style prop; slice up to that unambiguous boundary.
  const end = SOURCE.indexOf("style={{\n        position: \"relative\",\n        width: \"100%\",\n        height: viewportHeight,", start);
  assert.ok(end > start, "expected to find the end of onTouchEnd");
  return SOURCE.slice(start, end);
}

test("onTouchEnd does not call preventDefault() as its first statement -- the regression cannot silently return", () => {
  const fn = extractOnTouchEnd();
  // The only preventDefault() calls remaining are the early-return null
  // guard and the classified, conditional one -- never an unconditional
  // call before tapCandidate/startedWithTwoTouches/target are known.
  const firstStatementMatch = fn.match(/onTouchEnd=\{\(e\) => \{\s*\n\s*([^\n]+)/);
  assert.ok(firstStatementMatch, "expected to read onTouchEnd's first statement");
  assert.doesNotMatch(firstStatementMatch![1], /^\s*e\.preventDefault\(\);\s*$/);
});

test("preventDefault() inside onTouchEnd is gated by shouldAllowNativeClickThrough, not called unconditionally", () => {
  const fn = extractOnTouchEnd();
  assert.match(fn, /if \(!tapLandedOnInteractiveTarget\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*\}/);
  // stopPropagation remains unconditional (it only affects this event's
  // own bubbling, never the browser's separate click-synthesis decision).
  assert.match(fn, /\}\s*\n\s*e\.stopPropagation\(\);/);
});

test("shouldAllowNativeClickThrough is computed from tapCandidate, startedWithTwoTouches, and the real touch end point via elementFromPoint", () => {
  const fn = extractOnTouchEnd();
  assert.match(fn, /shouldAllowNativeClickThrough\(\{/);
  assert.match(fn, /document\.elementFromPoint\(\s*\n?\s*endTouch\.clientX,\s*\n?\s*endTouch\.clientY,?\s*\n?\s*\)/);
});

test("the two-finger tap-to-zoom, double-tap, and plain-empty-tap branches are structurally unchanged", () => {
  assert.match(SOURCE, /nextScale = clamp\(\s*currentScale \/ 1\.55,\s*minScale,\s*maxScale,?\s*\)/);
  assert.match(SOURCE, /isDoubleTap = now - lastTapTime < 320/);
  assert.match(SOURCE, /console\.log\("MAP TAP", \{ mapX, mapY \}\)/);
});

test("useDrag/usePinch pan and pinch mechanics are untouched by this stage", () => {
  assert.match(SOURCE, /useDrag\(/);
  assert.match(SOURCE, /usePinch\(/);
  assert.match(
    SOURCE,
    /target: viewportRef,\s*\n\s*pointer: \{\s*\n\s*touch: false,\s*\n\s*\},\s*\n\s*preventDefault: true,\s*\n\s*pointerCapture: false,\s*\n\s*threshold: 0,/,
  );
  assert.match(
    SOURCE,
    /target: viewportRef,\s*\n\s*pointer: \{\s*\n\s*touch: true,\s*\n\s*\},\s*\n\s*preventDefault: true,\s*\n\s*pointerCapture: false,/,
  );
});

test("onTouchStart and onTouchMove (tap-candidate tracking) are untouched by this stage", () => {
  assert.match(SOURCE, /viewportRef\.current\.dataset\.tapCandidate = "true";/);
  assert.match(SOURCE, /if \(Math\.abs\(dx\) > 12 \|\| Math\.abs\(dy\) > 12\) \{\s*\n\s*viewportRef\.current\.dataset\.tapCandidate = "false";/);
});
