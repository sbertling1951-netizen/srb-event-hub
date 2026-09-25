import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Stage 6C retirement of the Master Maps editor's
// direct browser parking_sites writes. Run with:
//   npx tsx --test "app/admin/master-maps/[id]/page.test.ts"

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Stage 6C: the editor performs NO direct browser mutation of parking_sites", () => {
  assert.equal(
    /\.from\("parking_sites"\)\s*\n?\s*\.(insert|update|delete|upsert)\(/.test(PAGE_SOURCE),
    false,
    "no direct parking_sites insert/update/delete/upsert may remain",
  );
});

test("Stage 6C: the destructive publish-to-Event path is retired", () => {
  assert.equal(/publishToSelectedEvent/.test(PAGE_SOURCE), false);
  assert.equal(/safeSyncToSelectedEvent/.test(PAGE_SOURCE), false);
  assert.equal(/Replace Selected Event Sites From Map/.test(PAGE_SOURCE), false);
  assert.equal(/\.delete\(\)\s*\n?\s*\.eq\("event_id"/.test(PAGE_SOURCE), false);
});

test("Stage 6C: Event inventory sync goes through the governed RPC with selected-map + revision compare-and-swap", () => {
  assert.match(PAGE_SOURCE, /async function syncInventoryToSelectedEvent\(\)/);
  assert.match(
    PAGE_SOURCE,
    /\.rpc\(\s*\n?\s*"sync_master_map_parking_inventory_to_event",/g,
  );
  assert.match(PAGE_SOURCE, /p_event_id: currentEvent\.id/);
  assert.match(PAGE_SOURCE, /p_expected_selected_master_map_id: selectedMapId/);
  assert.match(PAGE_SOURCE, /p_expected_map_revision: mapRow\.revision/);
  // the source of truth is the EVENT's own selected map, read from event_map_settings
  assert.match(
    PAGE_SOURCE,
    /\.from\("event_map_settings"\)\s*\n?\s*\.select\("selected_master_map_id"\)/,
  );
});

test("Stage 6C: sync is preview -> explicit confirmation -> apply", () => {
  const idx = PAGE_SOURCE.indexOf("async function syncInventoryToSelectedEvent()");
  const body = PAGE_SOURCE.slice(idx, PAGE_SOURCE.indexOf("\n  }\n", idx));
  const iPreview = body.indexOf("p_apply: false");
  const iConfirm = body.indexOf("window.confirm");
  const iApply = body.indexOf("p_apply: true");
  assert.ok(iPreview > 0 && iConfirm > iPreview && iApply > iConfirm, "order must be preview -> confirm -> apply");
  assert.match(body, /outcome === "rejected"/);
  assert.match(body, /unresolved_conflicts/);
});

test("Stage 6C: the Stage 6B governed master-map RPC call sites are unchanged", () => {
  assert.match(PAGE_SOURCE, /\.rpc\(\s*\n?\s*"apply_master_map_marker_changes",/);
  assert.match(PAGE_SOURCE, /\.rpc\("update_master_map_details",/);
  assert.match(PAGE_SOURCE, /\.rpc\(\s*\n?\s*"create_master_map_draft_from",/);
  assert.equal(/\.from\("master_maps"\)\s*\n?\s*\.(insert|update|delete|upsert)\(/.test(PAGE_SOURCE), false);
  assert.equal(/\.from\("master_map_sites"\)\s*\n?\s*\.(insert|update|delete|upsert)\(/.test(PAGE_SOURCE), false);
});

// ── Marker visibility and sizing repair ──────────────────────────────────────
// These assert BEHAVIOURAL properties (what the size depends on, what it may
// never touch), not the arithmetic. The measured proof -- rendered marker,
// label and target sizes across resolutions, orientations, viewports and zoom
// levels in Chromium and WebKit -- lives in the repair evidence directory.

test("marker size comes from the ENGINE's reported geometry, never a locally estimated fit", () => {
  // The page must consume MapCanvas's geometry report rather than measuring its
  // own container: its own box includes padding/border and is only an estimate,
  // which is what previously forced a fudge factor.
  assert.match(PAGE_SOURCE, /onGeometryChange=\{handleGeometryChange\}/);
  assert.match(PAGE_SOURCE, /const \[mapGeometry, setMapGeometry\] = useState<MapGeometry \| null>\(null\);/);
  const idx = PAGE_SOURCE.indexOf("const markerGeometry = useMemo(");
  const body = PAGE_SOURCE.slice(idx, PAGE_SOURCE.indexOf("}, [", idx));
  assert.match(body, /mapGeometry\.fitScale/);
  // No local fit calculation, no container measurement, no safety factor.
  assert.equal(/MARKER_HIT_SAFETY/.test(PAGE_SOURCE), false);
  assert.equal(/ResizeObserver/.test(PAGE_SOURCE), false);
  assert.equal(/new Image\(\)/.test(PAGE_SOURCE), false);
  assert.equal(/Math\.min\(vw \/ nw/.test(PAGE_SOURCE), false);
});

test("every interactive part is bounded to the marker's own territory", () => {
  // Bounding only the pad left labels and the primary delete control free to
  // overlap, which is how a neighbour stole an unambiguous click.
  assert.match(PAGE_SOURCE, /MARKER_DOT_TERRITORY_FRACTION/);
  assert.match(PAGE_SOURCE, /MARKER_DELETE_TERRITORY_FRACTION/);
  assert.match(PAGE_SOURCE, /const boundedHit = Math\.max\(boundedDot, Math\.min\(hit, half\)\);/);
  assert.match(PAGE_SOURCE, /labelMaxWidth/);
  assert.match(PAGE_SOURCE, /labelVisible/);
  // Clearance must be DIRECTIONAL -- one scalar distance hid labels that had
  // room in the direction that actually mattered.
  assert.match(PAGE_SOURCE, /clearX/);
  assert.match(PAGE_SOURCE, /clearYBelow/);
});

test("label legibility follows the LIVE zoom while sizes stay fit-derived", () => {
  // Visibility is an on-screen test at the current zoom, so zooming in can
  // reveal a crowded label; sizes remain derived from the fit scale, so
  // markers still scale proportionally and nothing is counter-scaled.
  assert.match(PAGE_SOURCE, /onScaleChange=\{handleScaleChange\}/);
  assert.match(PAGE_SOURCE, /const renderScale = liveScale \?\? \(fitScale > 0 \? fitScale : 1\);/);
  assert.match(PAGE_SOURCE, /const legibleNative = MARKER_LABEL_MIN_CSS \/ renderScale;/);
  // Sizes must NOT consume liveScale -- that would be counter-scaling.
  const geo = PAGE_SOURCE.slice(
    PAGE_SOURCE.indexOf("const markerGeometry = useMemo("),
    PAGE_SOURCE.indexOf("}, [mapGeometry, markerSizePct]);"),
  );
  assert.equal(/liveScale/.test(geo), false);
  // Quantised before it reaches state, so a gesture cannot render per frame.
  assert.match(PAGE_SOURCE, /const MARKER_SCALE_QUANTUM = 0\.05;/);
  assert.match(PAGE_SOURCE, /Math\.round\(scale \/ MARKER_SCALE_QUANTUM\) \* MARKER_SCALE_QUANTUM/);
});

test("horizontal clearance is computed only after the label height is known", () => {
  // A neighbour directly below has dx = 0; counting it as width clearance
  // zeroed the budget and kept a crowded label hidden at every zoom level.
  assert.match(PAGE_SOURCE, /Pass 1 -- radial gap/);
  assert.match(PAGE_SOURCE, /Pass 2 -- horizontal clearance/);
  assert.match(PAGE_SOURCE, /nBottom > labelTop && nTop < labelBottom/);
});

test("density is applied PER MARKER, so a cluster cannot shrink an isolated marker", () => {
  assert.match(PAGE_SOURCE, /const neighborClearance = useMemo\(/);
  assert.match(PAGE_SOURCE, /const geometryForMarker = useCallback\(/);
  assert.match(PAGE_SOURCE, /geometryForMarker\(marker\.id\)/);
  // The map-wide percentile helper must no longer drive marker size.
  assert.equal(/computeNearestNeighborSpacingPx/.test(PAGE_SOURCE), false);
  // Visible size and selection geometry are bounded separately.
  assert.match(PAGE_SOURCE, /MARKER_DOT_FLOOR_PX/);
});

test("the pending marker uses the editor's size through the optional shared prop", () => {
  assert.match(PAGE_SOURCE, /pendingMarkerSize=\{markerGeometry\.dot\}/);
});

test("a marker's own label is clickable so selecting through it cannot place a marker", () => {
  const idx = PAGE_SOURCE.indexOf('data-marker-label="true"');
  const block = PAGE_SOURCE.slice(idx, idx + 1400);
  assert.match(block, /pointerEvents: "auto"/);
  assert.match(block, /cursor: "pointer"/);
});

test("marker geometry is expressed in native image px, so markers scale with zoom rather than being counter-scaled", () => {
  // A counter-scale would have to consult the live viewport transform on every
  // render. Nothing in this page may do that.
  assert.equal(/getViewportTransform\(\)/.test(PAGE_SOURCE), false);
  assert.equal(/1 \/ scale|1\/scale|invScale|counterScale/.test(PAGE_SOURCE), false);
});

test("the marker root is a zero-size anchor so the dot centre stays on the stored coordinate", () => {
  assert.match(
    PAGE_SOURCE,
    /<div style=\{\{ position: "relative", width: 0, height: 0 \}\}>/,
  );
  // The dot is centred on that origin.
  assert.match(PAGE_SOURCE, /data-marker-dot="true"/);
  assert.match(PAGE_SOURCE, /left: -dot \/ 2,\s*\n\s*top: -dot \/ 2,/);
});

test("a dedicated tap target exists and can never overlap a neighbour's", () => {
  assert.match(PAGE_SOURCE, /data-marker-hit="true"/);
  // Two equal pads centred `gap` apart may each reach at most half that gap.
  // Territory is half the gap to the nearest neighbour; two parts each within
  // their own territory can never overlap.
  assert.match(PAGE_SOURCE, /const half = Number\.isFinite\(gap\) \? gap \* 0\.5 : Infinity;/);
  assert.match(PAGE_SOURCE, /Math\.min\(dot, half \* MARKER_DOT_TERRITORY_FRACTION\)/);
});

test("the dot renders whether or not labels are on, so the selected/primary cue is never lost", () => {
  const idx = PAGE_SOURCE.indexOf("const renderMarker = useCallback(");
  const body = PAGE_SOURCE.slice(idx, PAGE_SOURCE.indexOf("\n  );", idx));
  const dotAt = body.indexOf('data-marker-dot="true"');
  const labelGate = body.indexOf("{showLabels && labelVisible && (");
  assert.ok(dotAt > 0, "the dot must be rendered");
  assert.ok(dotAt < labelGate, "the dot must not sit behind the showLabels gate");
});

test("Marker Size is a bounded, labelled, keyboard-operable editor-local control", () => {
  assert.match(PAGE_SOURCE, /id="marker-size"/);
  assert.match(PAGE_SOURCE, /type="range"/);
  assert.match(PAGE_SOURCE, /htmlFor="marker-size"/);
  assert.match(PAGE_SOURCE, /aria-label="Marker size"/);
  assert.match(PAGE_SOURCE, /min=\{MARKER_SIZE_MIN_PCT\}/);
  assert.match(PAGE_SOURCE, /max=\{MARKER_SIZE_MAX_PCT\}/);
  assert.match(PAGE_SOURCE, /useState\(MARKER_SIZE_DEFAULT_PCT\)/);
});

test("Marker Size is never persisted and can never reach a write or the markers array", () => {
  // No persistence mechanism of any kind.
  assert.equal(/localStorage|sessionStorage|indexedDB/.test(PAGE_SOURCE), false);
  assert.equal(/marker_size|markerSize:|p_marker_size/.test(PAGE_SOURCE), false);
  // The markers array must not depend on the size, so changing it cannot alter
  // marker identity, mark placement dirty, or trigger a save.
  const idx = PAGE_SOURCE.indexOf("const markers = useMemo<MapMarker[]>(");
  const body = PAGE_SOURCE.slice(idx, PAGE_SOURCE.indexOf("}, [", idx));
  assert.equal(/markerSizePct/.test(body), false);
  assert.equal(
    /\.rpc\([^)]*markerSizePct/.test(PAGE_SOURCE),
    false,
    "the size may never be sent to any RPC",
  );
});

test("selection mode and the governed write path are unchanged by this repair", () => {
  assert.match(PAGE_SOURCE, /selectionMode="rectangle"/);
  assert.match(PAGE_SOURCE, /onMarkerTap=\{handleMarkerTap\}/);
  assert.match(PAGE_SOURCE, /onSelectionChange=\{handleSelectionChange\}/);
  assert.match(PAGE_SOURCE, /onMapTap=\{handleMapTap\}/);
  assert.match(PAGE_SOURCE, /\.rpc\(\s*\n?\s*"apply_master_map_marker_changes",/);
});

test("the repair touches no shared map component or shared sizing rule", () => {
  // computeNearestNeighborSpacingPx is CONSUMED from the shared module; the
  // page must not restate or fork the shared sizing/visual helpers.
  assert.match(PAGE_SOURCE, /type MapGeometry,\s*\n\} from "@\/components\/map\/canvas";/);
  assert.equal(/resolveDensityAwareMarkerSize/.test(PAGE_SOURCE), false);
  assert.equal(/MarkerDot|MarkerLabelChip/.test(PAGE_SOURCE), false);
});

// ── Nudge and selection repair ──────────────────────────────────────────────
// Behaviour is proven in mounted Chromium/WebKit probes; these guard the
// source-level contracts that made the old defects possible.

const bodyOf = (signature: string) => {
  const start = PAGE_SOURCE.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  // ends at the function's own closing brace (plain function or useCallback)
  const closes = ["\n  }\n", "\n  }, ["]
    .map((c) => PAGE_SOURCE.indexOf(c, start + signature.length))
    .filter((i) => i > 0);
  return PAGE_SOURCE.slice(start, Math.min(...closes));
};

test("pad and arrow keys share ONE nudge route; a pending marker moves locally only", () => {
  const route = bodyOf("const nudgeTarget = useCallback(");
  const pendingBranch = route.slice(0, route.indexOf("mapRef.current?.nudgeSelected"));
  assert.match(pendingBranch, /if \(pendingMarkerRef\.current\)/);
  assert.match(pendingBranch, /setPendingMarker\(/);
  assert.match(pendingBranch, /clampPercent\(/);
  // the pending branch never writes, never touches saved markers or undo
  assert.equal(/applyMarkerChanges|\.rpc\(|nudgeSelected|onMarkersChange/.test(pendingBranch), false);
  // every nudge entry point goes through the route
  assert.equal((PAGE_SOURCE.match(/nudgeTarget\(/g) || []).length, 8, "4 arrow keys + 4 pad buttons");
  assert.equal((PAGE_SOURCE.match(/nudgeSelected\(/g) || []).length, 1, "only the route calls the engine");
});

test("the nudge pad is enabled for a pending marker as well as a saved selection", () => {
  assert.match(
    PAGE_SOURCE,
    /const nudgePadDisabled =\s*\n\s*readOnlyMarkers \|\|\s*\n\s*loading \|\|\s*\n\s*\(pendingMarker \? isSavingMarker : !primarySelectedSiteId\);/,
  );
  assert.equal((PAGE_SOURCE.match(/disabled=\{nudgePadDisabled\}/g) || []).length, 4);
});

test("arrow keys stay text-editing keys inside editable fields", () => {
  const handler = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("function handleKeyDown(e: KeyboardEvent)"));
  const guard = handler.indexOf('tag === "input" || tag === "textarea" || target?.isContentEditable');
  assert.ok(guard > 0 && guard < handler.indexOf("nudgeTarget("), "the editable-field guard precedes every nudge");
});

test("a pending marker blocks saved-marker selection without saving or discarding it", () => {
  const onSelect = bodyOf("function handleSelectionChange(sel: Selection)");
  const guard = onSelect.slice(0, onSelect.indexOf("setSelectedSiteIds("));
  assert.match(guard, /if \(pendingMarker\) \{/);
  assert.match(guard, /Save or Cancel the pending marker/);
  assert.match(guard, /return;/);
  // the handler never clears or saves the pending marker, and the refusal path
  // leaves the entered number alone (setSiteNumber runs only for a real selection)
  assert.equal(/setPendingMarker\(null\)|saveNewMarkerInternal/.test(onSelect), false);
  assert.equal(/setSiteNumber/.test(guard), false);
  const onTap = bodyOf("function handleMarkerTap(id: string)");
  assert.match(onTap.slice(0, onTap.indexOf("sites.find")), /if \(pendingMarker\) \{\s*\n\s*return;/);
  assert.equal(/setPendingMarker\(null\)/.test(onTap), false);
});

test("Cancel is the explicit way out of a pending marker, shared with Escape", () => {
  const cancel = bodyOf("const cancelPendingMarker = useCallback(");
  assert.match(cancel, /setPendingMarker\(null\)/);
  assert.equal(/applyMarkerChanges|\.rpc\(/.test(cancel), false, "Cancel never writes");
  assert.match(PAGE_SOURCE, /onClick=\{cancelPendingMarker\}/);
  assert.match(PAGE_SOURCE, /if \(pendingMarker\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*cancelPendingMarker\(\);/);
});

test("Save Position and a successful Update do not return focus to the site-number input", () => {
  assert.equal(/focusSiteNumber\(\)/.test(bodyOf("async function saveSelectedPosition()")), false);
  const update = bodyOf("async function updateSelectedMarker()");
  const afterWrite = update.slice(update.indexOf("await applyMarkerChanges("));
  assert.equal(/focusSiteNumber\(\)/.test(afterWrite), false);
});

test("selecting a saved marker on the map releases a focused site-number input", () => {
  const onTap = bodyOf("function handleMarkerTap(id: string)");
  assert.match(onTap, /document\.activeElement === siteNumberRef\.current/);
  assert.match(onTap, /siteNumberRef\.current\?\.blur\(\)/);
});

test("deliberate empty-map placement keeps its save-and-continue behaviour", () => {
  const onMapTap = bodyOf("async function handleMapTap(pt: MapPercentPoint)");
  assert.match(onMapTap, /if \(pendingMarker && siteNumber\.trim\(\)\) \{\s*\n\s*await saveNewMarkerInternal\(true\);/);
  assert.match(onMapTap, /setPendingMarker\(\{ xPct: pt\.xPct, yPct: pt\.yPct \}\)/);
});
