import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SURFACE = readFileSync(
  fileURLToPath(new URL("./EpicentraxMapSurface.tsx", import.meta.url)),
  "utf8",
);
const RENDERER = readFileSync(
  fileURLToPath(
    new URL("../adapters/leaflet/LeafletMapRenderer.tsx", import.meta.url),
  ),
  "utf8",
);
const CONTRACT = readFileSync(
  fileURLToPath(new URL("../../../lib/mapSurface/contract.ts", import.meta.url)),
  "utf8",
);

// -- selectActivatesObject: pin tap opens the panel directly ----------------

test("selectActivatesObject is a documented, defaulted MapSurfaceProps flag", () => {
  assert.match(CONTRACT, /selectActivatesObject\?: boolean;/);
  assert.match(SURFACE, /selectActivatesObject = false,/);
});

test("when selectActivatesObject is set, a renderer object-select also fires onObjectActivate", () => {
  assert.match(
    SURFACE,
    /onObjectSelect=\{\(objectId\) => \{\s*\n\s*onObjectSelect\?\.\(objectId\);\s*\n\s*if \(selectActivatesObject\) \{\s*\n\s*onObjectActivate\?\.\(objectId\);\s*\n\s*\}\s*\n\s*\}\}/,
  );
});

test("the bridging identity card is rendered only in the default two-step mode", () => {
  assert.match(
    SURFACE,
    /\{selectedObject && !selectActivatesObject \? \(\s*\n\s*<SelectedObjectCard/,
  );
});

test("the default (two-step) flow is preserved: card present, no auto-activate", () => {
  // SelectedObjectCard component and its "View details" CTA still exist.
  assert.match(SURFACE, /function SelectedObjectCard\(/);
  assert.match(SURFACE, /View details ›/);
  // onObjectActivate is still only reachable via the card's own onClick
  // when the flag is off.
  assert.match(SURFACE, /onActivate=\{\(\) => onObjectActivate\?\.\(selectedObject\.id\)\}/);
});

test("the surface still imports no renderer package", () => {
  assert.doesNotMatch(SURFACE, /from "leaflet"|from "react-leaflet"|from "maplibre|from "ol\//);
});

// -- Leaflet adapter: tap does not depend on hover --------------------------

test("marker tap goes straight to onObjectSelect, never through the hover tooltip", () => {
  assert.match(
    RENDERER,
    /eventHandlers=\{\{\s*\n\s*click: \(\) => \{\s*\n\s*onObjectSelect\?\.\(object\.id\);\s*\n\s*\},\s*\n\s*\}\}/,
  );
  // the tooltip is a passive label, not interactive, and not on the tap path
  assert.match(RENDERER, /<Tooltip[^>]*interactive=\{false\}/);
});

test("marker hover/focus label behavior is unchanged (mouseover tooltip + keyboard focus wiring)", () => {
  assert.match(RENDERER, /marker\?\.openTooltip\(\)/);
  assert.match(RENDERER, /marker\?\.closeTooltip\(\)/);
  assert.match(RENDERER, /el\.addEventListener\("focus", handleFocus\)/);
  assert.match(RENDERER, /<Tooltip direction="top"/);
});

test("marker sizing and OpenStreetMap attribution are untouched", () => {
  assert.match(RENDERER, /iconSize: \[18, 30\]/);
  assert.match(RENDERER, /attribution="&copy; OpenStreetMap contributors"/);
});

test("recentering is still driven only by viewportIntent, not by selection", () => {
  // ViewportResizer keys on centerLat/centerLng/zoom from viewportIntent.
  assert.match(RENDERER, /useEffect\(\(\) => \{[\s\S]*?map\.setView\(\[centerLat, centerLng\], zoom\);[\s\S]*?\}, \[map, centerLat, centerLng, zoom\]\)/);
  assert.doesNotMatch(RENDERER, /selectedObjectId[\s\S]*?setView/);
});
