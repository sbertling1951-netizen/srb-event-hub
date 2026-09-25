import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// A mouse click on an AUTHORING marker (interactive=true) must not also reach
// the viewport's pointerup tap path, which the editor treats as an empty-map
// tap. Read-only consumers (interactive=false) and touch are untouched.
// Run with: npx tsx --test components/map/canvas/markerLayerAuthoringTap.test.ts

const LAYER = readFileSync(
  fileURLToPath(new URL("./MarkerLayer.tsx", import.meta.url)),
  "utf8",
);
const VIEWPORT = readFileSync(
  fileURLToPath(new URL("../GestureMapViewportV2.tsx", import.meta.url)),
  "utf8",
);

const pointerUp = LAYER.slice(
  LAYER.indexOf("onPointerUp={"),
  LAYER.indexOf("style={{", LAYER.indexOf("onPointerUp={")),
);

test("only interactive (authoring) markers carry the pointerup guard", () => {
  assert.match(pointerUp, /interactive\s*\n?\s*\?\s*\(e\) =>/);
  assert.match(pointerUp, /:\s*undefined/);
});

test("the guard stops MOUSE pointerup propagation only, and never cancels it", () => {
  assert.match(pointerUp, /if \(e\.pointerType === "mouse"\) \{\s*\n\s*e\.stopPropagation\(\);/);
  assert.equal(/preventDefault/.test(pointerUp), false);
});

test("selection still runs through the marker's own click handler", () => {
  assert.match(LAYER, /onClick=\{\s*\n\s*interactive\s*\n\s*\? \(e\) => \{\s*\n\s*e\.stopPropagation\(\);\s*\n\s*onMarkerActivate\(m\.id, e\.shiftKey\);/);
});

test("drag completion does not depend on bubbling: the drag listens in the capture phase", () => {
  // @use-gesture binds pointerup on window with these eventOptions when
  // pointerCapture is false, so a bubble-phase stopPropagation cannot starve it.
  const drag = VIEWPORT.slice(VIEWPORT.indexOf("useDrag("), VIEWPORT.indexOf("usePinch("));
  assert.match(drag, /pointerCapture: false,/);
  assert.match(drag, /eventOptions: \{\s*\n\s*passive: false,\s*\n\s*capture: true,/);
});

test("the viewport's mouse tap path remains the React pointerup handler", () => {
  assert.match(VIEWPORT, /onPointerUp=\{\(e\) => \{\s*\n\s*if \(e\.pointerType === "mouse"\) \{/);
});
