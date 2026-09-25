import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the two OPTIONAL shared capabilities added for the Master
// Map Editor marker repair:
//
//   * MapCanvas.onGeometryChange -- reports the engine's own measured viewport,
//     the natural image size and the engine's own fit scale, so a consumer
//     never re-derives the fit from its own container.
//   * MapCanvas.pendingMarkerSize -> MarkerLayer.pendingSize -- an optional
//     diameter for the pending-placement dot.
//
// The governing requirement for both is that OMITTING them leaves every
// existing consumer byte-for-byte unchanged.

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const VIEWPORT = read("../GestureMapViewportV2.tsx");
const CANVAS = read("./MapCanvas.tsx");
const LAYER = read("./MarkerLayer.tsx");
const TYPES = read("./types.ts");
const INDEX = read("./index.ts");

test("the engine has exactly ONE fit calculation, and every site uses it", () => {
  assert.match(VIEWPORT, /function fitScaleFor\(/);
  // The literal fit expression must exist exactly once -- inside the helper --
  // and nowhere else, so no site can drift from the engine's definition.
  const inlineFits = VIEWPORT.match(
    /Math\.min\(\s*\n?\s*viewport(Width)?\.?\w*\s*\/\s*width,/g,
  ) || [];
  assert.equal(inlineFits.length, 1, "the fit expression must exist only once");
  const helper = VIEWPORT.slice(
    VIEWPORT.indexOf("function fitScaleFor("),
    VIEWPORT.indexOf("}", VIEWPORT.indexOf("function fitScaleFor(")) + 1,
  );
  assert.match(helper, /Math\.min\(/, "that one occurrence is the helper's own definition");
  // reset() and the centering effect both go through the helper.
  assert.equal(
    (VIEWPORT.match(/fitScaleFor\(\s*\n?\s*viewport,\s*\n?\s*width,\s*\n?\s*height,\s*\n?\s*minScale,\s*\n?\s*maxScale,?\s*\n?\s*\)/g) || []).length,
    3,
    "reset, the centering effect and the geometry report all call the one helper",
  );
});

test("the reported fit scale is the APPLIED scale, bounded by minScale/maxScale", () => {
  // Reporting the raw ratio while reset() clamped it was a real defect: a map
  // whose raw fit fell below minScale displayed at minScale but reported the
  // smaller value, so a consumer sizing from it oversized every marker.
  assert.match(VIEWPORT, /function fitScaleFor\([\s\S]{0,200}?minScale: number,\s*\n\s*maxScale: number,\s*\n\): number \{\s*\n\s*return clamp\(/);
  // No caller may re-clamp, which would reintroduce two definitions.
  assert.equal(/clamp\(\s*\n?\s*fitScaleFor\(/.test(VIEWPORT), false);
});

test("onGeometryChange is optional and computes nothing when omitted", () => {
  assert.match(VIEWPORT, /onGeometryChange\?: \(geometry: \{/);
  // The emitter returns early with no callback, so an omitting consumer pays
  // nothing and observes no behaviour change.
  assert.match(
    VIEWPORT,
    /const report = onGeometryChangeRef\.current;[\s\S]{0,200}?if \(!report \|\| !viewport\) \{\s*\n\s*return;/,
  );
});

test("geometry is reported on mount, on content change and on viewport resize", () => {
  // Initial centering effect -- and its dependency array must stay exactly as
  // it was, or the engine would re-fit on resize instead of re-clamping.
  assert.match(VIEWPORT, /renderTransform\(\);\s*\n\s*emitGeometryRef\.current\(\);\s*\n\s*\}, \[width, height, maxScale\]\);/);
  // The existing ResizeObserver, which already handled real resizes.
  assert.match(VIEWPORT, /emitGeometryRef\.current\(\);\s*\n\s*\}\);\s*\n\s*observer\.observe\(viewport\);/);
  assert.match(VIEWPORT, /return \(\) => observer\.disconnect\(\);\s*\n\s*\}, \[width, height\]\);/);
});

test("MapCanvas relays geometry without recomputing the fit and without a stale natural size", () => {
  // No second fit calculation in MapCanvas.
  assert.equal(/Math\.min\([^)]*\/ *natural\.width/.test(CANVAS), false);
  // The relay must read a render-synchronised ref: the viewport's own layout
  // effect emits BEFORE the effect that refreshes a callback ref, so a captured
  // value would report the previous image's size beside the new fit scale.
  assert.match(CANVAS, /const naturalRef = useRef\(natural\);\s*\n\s*naturalRef\.current = natural;/);
  assert.match(CANVAS, /naturalWidth: naturalRef\.current\.width/);
  assert.match(CANVAS, /naturalHeight: naturalRef\.current\.height/);
  assert.match(CANVAS, /onGeometryChange=\{relayGeometry\}/);
});

test("MapGeometry is exported for consumers", () => {
  assert.match(TYPES, /export type MapGeometry = \{/);
  assert.match(TYPES, /fitScale: number;/);
  assert.match(INDEX, /MapGeometry,/);
});

test("onScaleChange is optional, emitted from the one transform-application point, and deduplicated", () => {
  assert.match(VIEWPORT, /onScaleChange\?: \(scale: number\) => void;/);
  // Emitted from renderTransform -- the single place the transform is applied
  // -- so a consumer never reads the DOM or polls for the current zoom, and the
  // reported number is literally the scale that was just rendered.
  const renderTransform = VIEWPORT.slice(
    VIEWPORT.indexOf("const renderTransform = () => {"),
    VIEWPORT.indexOf("const requestRender = () => {"),
  );
  assert.ok(renderTransform.includes("const { x, y, scale } = stateRef.current;"));
  assert.ok(renderTransform.includes("contentRef.current.style.transform"));
  assert.ok(renderTransform.includes("report(scale);"));
  assert.ok(
    renderTransform.indexOf("contentRef.current.style.transform") <
      renderTransform.indexOf("report(scale);"),
  );
  // The emit exists nowhere else, so there is no second source of truth.
  assert.equal(VIEWPORT.split("report(scale);").length - 1, 1);
  // No callback means no work, and an unchanged scale emits nothing.
  assert.match(VIEWPORT, /if \(report && scale !== lastReportedScaleRef\.current\)/);
  assert.match(TYPES, /onScaleChange\?: \(scale: number\) => void;/);
  assert.match(CANVAS, /onScaleChange=\{onScaleChange\}/);
});

test("pendingMarkerSize is optional and threads through to MarkerLayer", () => {
  assert.match(TYPES, /pendingMarkerSize\?: number;/);
  assert.match(CANVAS, /pendingSize=\{pendingMarkerSize\}/);
  assert.match(LAYER, /pendingSize\?: number;/);
});

test("omitting pendingSize preserves the existing pending-marker appearance exactly", () => {
  // The historical values were a 16px dot with a 2px border, and a 10px label
  // 4px below it. Every one must remain the fallback.
  assert.match(LAYER, /width: pendingSize \?\? 16,/);
  assert.match(LAYER, /height: pendingSize \?\? 16,/);
  assert.match(LAYER, /pendingSize \? Math\.max\(2, pendingSize \* 0\.12\) : 2\}px solid #fff/);
  assert.match(LAYER, /marginTop: pendingSize \? pendingSize \* 0\.25 : 4,/);
  assert.match(LAYER, /fontSize: pendingSize \? Math\.max\(8, pendingSize \* 0\.62\) : 10,/);
});

test("no existing shared default, gesture rule or consumer contract was altered", () => {
  // Density defaults are untouched.
  const sizing = read("./markerSizing.ts");
  assert.match(sizing, /const DEFAULT_FLOOR_PX = 8;/);
  assert.match(sizing, /const DEFAULT_CEILING_PX = 22;/);
  assert.match(sizing, /const DEFAULT_SPACING_FRACTION = 0\.7;/);
  // The hit-test floor and the selectionMode routing are unchanged.
  assert.match(read("./markerVisuals.tsx"), /export const MARKER_MIN_HIT_AREA_PX = 32;/);
  assert.match(CANVAS, /selectionMode === "none" &&/);
  // MarkerLayer still positions by percentage and still defaults size to 14.
  assert.match(LAYER, /const size = m\.size \?\? 14;/);
  assert.match(LAYER, /left: `\$\{m\.xPct\}%`/);
});
