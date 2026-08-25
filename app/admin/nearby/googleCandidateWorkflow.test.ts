import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

function sourceBetween(startNeedle: string, endNeedle: string) {
  const start = PAGE_SOURCE.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = PAGE_SOURCE.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return PAGE_SOURCE.slice(start, end);
}

test("Google discovery candidates use the governed exact-ID surface and suppress only server-proven canonical matches", () => {
  assert.match(
    PAGE_SOURCE,
    /import \{[\s\S]*?googlePlaceIdsFromCandidates,[\s\S]*?pendingGooglePlaceCandidates,[\s\S]*?\} from "\.\/googleCandidateIdentity";/,
  );
  assert.match(
    PAGE_SOURCE,
    /\.rpc\(\s*"list_matching_google_place_ids_for_nearby_administration",\s*\{\s*p_event_id: adminEvent\.id,\s*p_google_place_ids: googlePlaceIds,/,
  );
  assert.match(PAGE_SOURCE, /const pendingGoogleResults = useMemo\(/);
  assert.match(PAGE_SOURCE, /pendingGooglePlaceCandidates\(googleResults, matchedGooglePlaceIds\)/);
  assert.match(PAGE_SOURCE, /Pending Google candidates/);
  assert.equal(/similarity|levenshtein|ILIKE/.test(PAGE_SOURCE), false);
});

test("the existing unified Event/Tenant/Shared editor is rendered in the Central UI Dialog without outside dismissal", () => {
  assert.match(PAGE_SOURCE, /import \{ Dialog \} from "@\/components\/ui\/Dialog";/);
  assert.match(
    PAGE_SOURCE,
    /<Dialog\s+open=\{editorExpanded\}[\s\S]*?className="app-dialog-form"[\s\S]*?dismissOnBackdrop=\{false\}/,
  );
  assert.match(PAGE_SOURCE, /title=\{editorMode === "add" \? "Add Nearby Place" : "Edit Nearby Place"\}/);
  assert.match(PAGE_SOURCE, /function loadGooglePlaceIntoNearbyEditor\(place: GoogleNearbyResult\)[\s\S]*?setGoogleCandidateInEditor\(place\)[\s\S]*?setEditorExpanded\(true\)/);
  assert.match(PAGE_SOURCE, /Add to Nearby/);
  assert.equal(PAGE_SOURCE.includes("Load Into Stored Place Editor"), false);
  assert.equal(PAGE_SOURCE.includes("Load Into Nearby Place Editor"), false);
});

test("canonical acceptance removes its exact candidate while Event-only saves and stored-place editing never request Google", () => {
  const tenantAdd = sourceBetween("async function addTenantPlace()", "async function submitSharedPlace()");
  const sharedAdd = sourceBetween("async function submitSharedPlace()", "async function moveNearbyPlace()");
  const eventSave = sourceBetween("async function saveNearbyEventListing()", "async function saveNearbyCanonicalPlace()");
  const storedEdit = sourceBetween(
    "async function openNearbyEditorForPlace",
    "async function requestOpenBlankNearbyEditor",
  );

  assert.match(tenantAdd, /linkGoogleCandidateToCanonicalPlace\(/);
  assert.match(sharedAdd, /linkGoogleCandidateToCanonicalPlace\(/);
  assert.match(PAGE_SOURCE, /setMatchedGooglePlaceIds\(\(current\) => new Set\(\[\.\.\.current, googlePlaceId\]\)\)/);
  assert.doesNotMatch(eventSave, /linkGoogleCandidateToCanonicalPlace/);
  assert.doesNotMatch(storedEdit, /fetch\(|google\//);
});

test("Cancel remains the single explicit close path and preserves the existing dirty-discard confirmation", () => {
  const close = sourceBetween("async function closeNearbyEditor()", "function handleDestinationChange");
  assert.match(close, /isNearbyEditorDirty\(\)/);
  assert.match(close, /Discard Unsaved Changes\?/);
  assert.match(close, /resetNearbyEditorToClosed\(\)/);
});
