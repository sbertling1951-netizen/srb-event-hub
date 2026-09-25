import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for Coach Map's Event-resolution branch.
// Authenticated Members resolve Event context through canonical
// Person/Participation continuity (get_my_member_event_continuity_context).
// Temporary Event Access sets the same local memberEvent context but never
// creates a Supabase session and holds no Participation link -- that RPC
// is not anon-executable, so the RPC choice is gated on an actual session
// check rather than on memberEvent presence alone. Same defect and fix
// pattern as the Nearby (d36ad11), Locations (5fc355e), and /map (dc72034)
// reconciliations; live grant/RPC-body evidence is reported separately,
// not re-asserted here.
//
// Run with:
//   npx tsx --test app/coach-map/public/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Event continuity RPC choice is gated on a real Supabase session, not on memberEvent presence alone", () => {
  assert.match(SOURCE, /supabase\.auth\.getSession\(\)/);

  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const continuityRpcVarIndex = SOURCE.indexOf("continuityRpc");
  assert.ok(sessionCheckIndex >= 0 && continuityRpcVarIndex > sessionCheckIndex);

  const between = SOURCE.slice(sessionCheckIndex, continuityRpcVarIndex + 200);
  assert.match(between, /sessionData\?\.session/);
  assert.match(between, /"get_my_member_event_continuity_context"/);
  assert.match(between, /"get_event_continuity_context"/);
});

test("the RPC call itself uses the chosen continuityRpc variable, not a hardcoded RPC name", () => {
  assert.match(
    SOURCE,
    /supabase\s*\n?\s*\.rpc\(continuityRpc,\s*\{\s*p_event_id:\s*memberEvent\.id\s*\}\)/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("no visibility/lifecycle predicate is applied client-side to the continuity result", () => {
  const rpcCallStart = SOURCE.indexOf(".rpc(continuityRpc,");
  const rpcCallEnd = SOURCE.indexOf(";", rpcCallStart);
  const rpcCall = SOURCE.slice(rpcCallStart, rpcCallEnd);
  assert.doesNotMatch(rpcCall, /visible_to_members/);
  assert.doesNotMatch(rpcCall, /is_active/);
  assert.doesNotMatch(rpcCall, /\.eq\(/);
});

test("map fields/scaling behavior are preserved: map_image_url/master_map_id resolution and coach_map_open_scale still flow from the loaded row", () => {
  assert.match(SOURCE, /loadedEvent\.master_map_id/);
  assert.match(SOURCE, /loadedEvent\.map_image_url/);
  assert.match(SOURCE, /loadedEvent\.coach_map_open_scale/);
});

test("the known-id fallback shape (no row found) is unchanged", () => {
  assert.match(SOURCE, /const loadedEvent = \(eventRow as MemberEventRow \| null\) \|\| \{/);
});

test("downstream map RPCs (site geometry, participant roster) are untouched", () => {
  assert.match(SOURCE, /\.rpc\("get_event_public_map_sites",/);
  assert.match(SOURCE, /\.rpc\("get_event_participant_map_roster",/);
});

// ── Member marker sizing ────────────────────────────────────────────────────
// Sizes are measured in mounted Chromium/WebKit probes; these guard the
// source-level contract: bounded on-screen sizing, no persistence, no change
// to opening/navigation zoom, selection or data.

test("marker sizes come from on-screen targets through the engine's live scale", () => {
  assert.match(SOURCE, /onGeometryChange=\{handleGeometryChange\}/);
  assert.match(SOURCE, /onScaleChange=\{handleScaleChange\}/);
  assert.match(SOURCE, /const MARKER_DOT_CSS_AT_OVERVIEW = 16;/);
  assert.match(SOURCE, /const MARKER_LABEL_CSS_AT_OVERVIEW = 11;/);
  assert.match(SOURCE, /const MARKER_DOT_CSS_MIN = 14;\s*\nconst MARKER_DOT_CSS_MAX = 28;/);
  assert.match(SOURCE, /const MARKER_LABEL_CSS_MIN = 11;\s*\nconst MARKER_LABEL_CSS_MAX = 16;/);
  // native = on-screen target / live scale
  assert.match(SOURCE, /dotNative: css\.dot \/ scale,/);
  assert.match(SOURCE, /labelNative: css\.label \/ scale,/);
});

test("growth is bounded and NOT the editor's unbounded zoom-proportional rule", () => {
  const rule = SOURCE.slice(SOURCE.indexOf("function resolveMemberMarkerCss("), SOURCE.indexOf("type LabelProbe"));
  assert.match(rule, /Math\.sqrt\(/);
  assert.equal((rule.match(/clampNumber\(/g) || []).length, 2, "both dot and label are clamped");
  // the selected emphasis is budgeted inside the maximum
  assert.match(rule, /MARKER_DOT_CSS_MAX \/ SELECTED_DOT_RATIO/);
  // no editor-style native = target / fitScale conversion inside the rule
  assert.equal(/fitScale/.test(rule), false);
});

test("the old fixed native sizes are gone from the site and location markers", () => {
  const render = SOURCE.slice(SOURCE.indexOf("const renderMarker = useCallback("), SOURCE.indexOf("const handleMarkerTap = useCallback("));
  assert.equal(/width: isSelected \? 26 : isViewerSite \? 24 : 22/.test(render), false);
  assert.equal(/fontSize: 9,/.test(render), false);
  assert.equal(/width: 14,\s*\n\s*height: 14,/.test(render), false);
  // viewer / selected / occupied / location presentations stay distinct
  assert.match(render, /isSelected \? SELECTED_DOT_RATIO : isViewerSite \? VIEWER_DOT_RATIO : 1/);
  assert.match(render, /"#ff3b30"/);
  assert.match(render, /"#16a34a"/);
  assert.match(render, /"#2563eb"/);
  assert.match(render, /getLocationColor\(loc\.category\)/);
});

test("labels anchor below the dot and hide only on real on-screen collisions", () => {
  const render = SOURCE.slice(SOURCE.indexOf("const renderMarker = useCallback("), SOURCE.indexOf("const handleMarkerTap = useCallback("));
  assert.match(render, /showLabels && !hiddenLabelIds\.has\(marker\.id\)/);
  assert.match(render, /position: "absolute",\s*\n\s*left: "50%",\s*\n\s*top: `calc\(100% \+ \$\{px\(3\)\}px\)`/);
  assert.match(render, /pointerEvents: "none"/);
  assert.match(SOURCE, /const hiddenLabelIds = useMemo\(/);
  assert.match(SOURCE, /return findCollidingLabels\(/);
});

test("each marker carries its native size so the engine's hit radius follows it", () => {
  const markers = SOURCE.slice(SOURCE.indexOf("const markers = useMemo<MapMarker[]>("), SOURCE.indexOf("const hiddenLabelIds"));
  assert.match(markers, /size: markerSizes\.dotNative,/);
  assert.match(markers, /size: markerSizes\.dotNative \* LOCATION_DOT_RATIO,/);
  assert.match(SOURCE, /selectionMode="none"/, "selection stays the engine's nearest-marker hit test");
});

test("scale updates are bucketed and equality-guarded (no per-frame render loop)", () => {
  assert.match(SOURCE, /const bucketed = bucketScale\(scale\);\s*\n\s*setLiveScale\(\(prev\) => \(prev === bucketed \? prev : bucketed\)\);/);
  assert.match(SOURCE, /setMapGeometry\(\(prev\) =>\s*\n\s*prev &&/);
});

test("sizing is presentation only: nothing persisted, zoom values unchanged", () => {
  assert.equal(/localStorage|sessionStorage|marker_size|label_size/.test(SOURCE), false);
  assert.match(SOURCE, /initialScale=\{Number\(event\?\.coach_map_open_scale \|\| 1\)\}/);
  assert.match(SOURCE, /mapViewportRef\.current\?\.centerOnMarker\(site\.key, 1\.25\);/);
  assert.match(SOURCE, /supabase\.rpc\("get_event_participant_map_roster", \{/);
});
