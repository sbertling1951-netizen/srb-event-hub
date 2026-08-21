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

test("the double-tap and plain-empty-tap branches are structurally unchanged", () => {
  assert.match(SOURCE, /isDoubleTap = now - lastTapTime < 320/);
  assert.match(SOURCE, /console\.log\("MAP TAP", \{ mapX, mapY \}\)/);
});

test("onTouchStart and onTouchMove (tap-candidate tracking) are untouched by this stage", () => {
  assert.match(SOURCE, /viewportRef\.current\.dataset\.tapCandidate = "true";/);
  assert.match(SOURCE, /if \(Math\.abs\(dx\) > 12 \|\| Math\.abs\(dy\) > 12\) \{\s*\n\s*viewportRef\.current\.dataset\.tapCandidate = "false";/);
});

// --- Stage 2: fast-pinch rightward-jump fix -----------------------------
// Proven root cause (see task record for the full Playwright/CDP trace
// against the live, unmodified engine): two independent defects, both in
// this same onTouchEnd/useDrag path, that combine to corrupt the
// transform on release of any two-finger gesture:
//
// 1. The "two-finger tap to zoom out" branch fired unconditionally for
//    ANY gesture that started with two touches -- including an ordinary
//    pinch, whose fingers necessarily move well past the tap-movement
//    threshold -- forcibly animating to currentScale/1.55 anchored at
//    wherever the last lifting finger happened to be, discarding
//    usePinch's own already-correct scale/pan.
// 2. useDrag's multi-touch guard checked event.touches.length, which is
//    always 0 for this Pointer-Event-driven gesture (a PointerEvent has
//    no .touches property), so it never actually skipped anything. Worse,
//    even fixed to use @use-gesture's own correct `touches` count, a
//    single per-event check still isn't enough: this recognizer starts
//    tracking on the FIRST finger's own pointerdown (before a second
//    finger arrives), and at the moment that SAME finger later lifts --
//    its own terminal event -- the second finger is often still down, so
//    `touches` has already dropped back to 1, letting a momentum glide
//    launch from that finger's full pinch-duration velocity.

test("the two-finger zoom-out animation only runs for a genuine tap (tapCandidate), not a real pinch", () => {
  const fn = extractOnTouchEnd();
  const branchStart = fn.indexOf("if (startedWithTwoTouches) {");
  assert.ok(branchStart >= 0, "expected to find the startedWithTwoTouches branch");
  const branch = fn.slice(branchStart);
  assert.match(branch, /if \(startedWithTwoTouches\) \{\s*\n(?:\s*\/\/.*\n)*\s*if \(tapCandidate\) \{/);
  assert.match(branch, /nextScale = clamp\(\s*currentScale \/ 1\.55,\s*minScale,\s*maxScale,?\s*\)/);
  // The dataset resets and the early return must remain unconditional --
  // both the tap-shortcut and the real-pinch case need a clean slate for
  // the next gesture.
  assert.match(
    branch,
    /\}\s*\n\s*viewportRef\.current\.dataset\.tapCandidate = "false";\s*\n\s*viewportRef\.current\.dataset\.touchCountStart = "0";\s*\n\s*return;/,
  );
});

test("useDrag ignores its own gesture's terminal event if that gesture was ever concurrent with a second touch", () => {
  assert.match(SOURCE, /const dragSawMultiTouchRef = useRef\(false\);/);
  assert.match(
    SOURCE,
    /if \(first\) \{\s*\n\s*dragSawMultiTouchRef\.current = touches >= 2;\s*\n\s*\} else if \(touches >= 2\) \{\s*\n\s*dragSawMultiTouchRef\.current = true;\s*\n\s*\}/,
  );
  assert.match(
    SOURCE,
    /if \(dragSawMultiTouchRef\.current\) \{\s*\n\s*if \(last\) \{\s*\n\s*dragSawMultiTouchRef\.current = false;\s*\n\s*\}\s*\n\s*return memo;\s*\n\s*\}/,
  );
});

test("useDrag/usePinch pan and pinch mechanics are otherwise untouched by this stage", () => {
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

// --- Stage 2: stale-transform-on-resize/rotation fix --------------------
// Proven root cause (see task record for exact before/after measurements
// against the live, unmodified engine at real iPhone/iPad sizes): the
// applied pan/scale was computed once, from the viewport's rendered size
// at that moment, and never revisited when that size later changed on its
// own (a window resize or an orientation rotation with no subsequent
// touch interaction) -- confirmed by the transform staying byte-identical
// across a simulated rotation, while a fresh mount in the new orientation
// computed a different, correctly-centered one.

test("the initial mount-centering effect keeps its original dependency array (natural content size and maxScale only, never viewport size)", () => {
  assert.match(SOURCE, /\}, \[width, height, maxScale\]\);/);
});

test("a ResizeObserver re-clamps (never re-fits or re-centers) the existing pan when the viewport's own rendered size changes", () => {
  const start = SOURCE.indexOf("useEffect(() => {\n    const viewport = viewportRef.current;\n\n    if (!viewport || typeof ResizeObserver");
  assert.ok(start >= 0, "expected to find the resize-observer effect");
  const end = SOURCE.indexOf("}, [width, height]);", start);
  assert.ok(end > start, "expected to find the effect's own dependency array");
  const fn = SOURCE.slice(start, end);

  // Skips its own guaranteed initial callback -- the mount effect above
  // already established correct geometry for the size at that point.
  assert.match(fn, /if \(!skippedInitial\) \{\s*\n[\s\S]*?skippedInitial = true;\s*\n\s*return;\s*\n\s*\}/);

  // Reads the CURRENT viewport size and the CURRENT stateRef scale/pan
  // fresh at trigger time, via the same clampPan every gesture already
  // uses -- never a fresh fitScale/recenter computation.
  assert.match(fn, /const vw = viewport\.clientWidth;/);
  assert.match(fn, /const vh = viewport\.clientHeight;/);
  assert.match(
    fn,
    /clampPan\(\s*\n\s*stateRef\.current\.x,\s*\n\s*stateRef\.current\.y,\s*\n\s*stateRef\.current\.scale,\s*\n\s*vw,\s*\n\s*vh,\s*\n\s*width,\s*\n\s*height,\s*\n\s*\)/,
  );
  assert.doesNotMatch(fn, /fitScale/);
});

// --- Stage 2B: shared map engine surface protection ---------------------
// Proven root cause (see task record for the full measurement, reproduced
// directly in Chromium with the real Parking chrome structure replicated
// -- no physical device needed to confirm this specific mechanism): the
// pre-existing, unrelated "MOBILE FORM ALIGNMENT FIX" rule in
// app/globals.css (`.card div { max-width: 100% !important }`, written
// for form-field alignment) matches ANY <div> descendant of a
// `.card`-classed container on narrow viewports -- including
// GestureMapViewportV2's own contentRef div and MapCanvas's own inner
// wrapper div, both of which carry an explicit PIXEL width (the natural
// image width) that every marker's percentage position is resolved
// against. Parking's map wrapper legitimately adopted className="card"
// during its Central UI Standard migration; that ambient reset then
// silently clamped these two divs' width to their flex ancestor's own
// width, while their <img> child (not a div, unmatched by that selector)
// kept rendering at its correct, unclamped size -- producing non-uniform
// X/Y scaling for markers specifically, worse the farther a marker's
// stored percentage was from the axis origin, only under the same
// <900px viewport both that reset and Parking's portrait width share.

const CSS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

const CANVAS_MAP_CANVAS_SOURCE = readFileSync(
  fileURLToPath(new URL("./canvas/MapCanvas.tsx", import.meta.url)),
  "utf8",
);

test("GestureMapViewportV2's contentRef div and MapCanvas's own inner wrapper div both carry the protective class", () => {
  const refIndex = SOURCE.indexOf("ref={contentRef}");
  assert.ok(refIndex >= 0, "expected to find contentRef's own div");
  const styleIndex = SOURCE.indexOf("style={{", refIndex);
  assert.ok(styleIndex > refIndex, "expected to find contentRef's own style prop");
  assert.match(SOURCE.slice(refIndex, styleIndex), /className="map-engine-surface"/);
  assert.match(
    CANVAS_MAP_CANVAS_SOURCE,
    /className="map-engine-surface"[\s\S]{0,120}style={{\s*\n\s*position: "relative",\s*\n\s*width: natural\.width,\s*\n\s*height: natural\.height,/,
  );
});

test("globals.css restores max-width for .map-engine-surface with specificity that beats .card div regardless of source order", () => {
  const cardDivIndex = CSS_SOURCE.indexOf(".card div");
  assert.ok(cardDivIndex >= 0, "expected to find the .card div rule this protects against");

  const protectionMatch = CSS_SOURCE.match(
    /\.map-engine-surface\.map-engine-surface\s*\{\s*\n\s*max-width: none !important;\s*\n\s*\}/,
  );
  assert.ok(protectionMatch, "expected the doubled-class .map-engine-surface protection rule");

  // A doubled class selector (0,2,0) beats a class+type selector like
  // `.card div` (0,1,1) in the class-count position regardless of which
  // rule appears first in the stylesheet -- this must not be quietly
  // "fixed" back down to a single class, which would make the win
  // dependent on source order again.
  assert.match(protectionMatch![0], /\.map-engine-surface\.map-engine-surface/);
});
