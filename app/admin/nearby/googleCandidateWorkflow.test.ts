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

test("Google discovery candidates use the governed exact-ID surface; canonical reuse is resolved at final save without exposing canonical identity", () => {
  assert.match(
    PAGE_SOURCE,
    /import \{[\s\S]*?googlePlaceIdsFromCandidates,[\s\S]*?pendingGooglePlaceCandidates,[\s\S]*?\} from "\.\/googleCandidateIdentity";/,
  );
  // Nearby Admin UX cleanup (Part C): the governed exact-ID matcher
  // list_matching_google_place_ids_for_nearby_administration is called
  // after a search purely to LABEL candidate state ("Already in catalog").
  // It never blocks a candidate (they stay addable), never returns a
  // master id, and its result feeds only a badge -- exact Google Place-ID
  // reuse is still decided at final save by the governed mutation-owning
  // RPC.
  assert.match(
    PAGE_SOURCE,
    /\.rpc\(\s*\n?\s*"list_matching_google_place_ids_for_nearby_administration",\s*\n?\s*\{ p_event_id: adminEvent\.id, p_google_place_ids: searchPlaceIds \}/,
  );
  // The match result feeds a display set, not a suppression / addability
  // gate.
  assert.match(PAGE_SOURCE, /setCatalogMatchedGooglePlaceIds\(/);
  assert.match(PAGE_SOURCE, /const alreadyInCatalog =\s*\n?\s*!!place\.id && catalogMatchedGooglePlaceIds\.has\(place\.id\)/);
  assert.doesNotMatch(
    PAGE_SOURCE,
    /catalogMatchedGooglePlaceIds[\s\S]{0,200}?(?:addableCandidates|pendingGoogleResults\.filter|return false)/,
  );
  assert.match(
    PAGE_SOURCE,
    /\.rpc\(\s*\n?\s*"reuse_nearby_places_by_google_place_id_for_event",\s*\n?\s*\{ p_event_id: eventId, p_google_place_ids: googlePlaceIds \}/,
  );
  // Exact Google Place ID is still the only identity that participates.
  assert.match(PAGE_SOURCE, /googlePlaceIdsFromCandidates\(/);
  // pendingGoogleResults still filters candidates promoted to a canonical
  // place through the editor this session.
  assert.match(PAGE_SOURCE, /const pendingGoogleResults = useMemo\(/);
  assert.match(PAGE_SOURCE, /pendingGooglePlaceCandidates\(googleResults, matchedGooglePlaceIds\)/);
  assert.match(PAGE_SOURCE, /title="Search Candidates"/);
  assert.match(
    PAGE_SOURCE,
    /const addableCandidates = useMemo\([\s\S]*?pendingGoogleResults\.filter\(/,
  );
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

test("Enter from a single-line modal field and the add-mode primary action share the editor submit path", () => {
  const submit = sourceBetween(
    "async function submitNearbyEditor()",
    "function handleNearbyEditorSubmit",
  );
  const keyDown = sourceBetween(
    "function handleNearbyEditorKeyDown",
    "return (",
  );

  assert.match(
    PAGE_SOURCE,
    /<form\s+[\s\S]*?onSubmit=\{handleNearbyEditorSubmit\}[\s\S]*?onKeyDown=\{handleNearbyEditorKeyDown\}/,
  );
  assert.match(submit, /editorScope === "event_only"[\s\S]*?saveNearbyEventListing\(\)/);
  assert.match(submit, /editorScope === "tenant"[\s\S]*?addTenantPlace\(\)/);
  assert.match(submit, /editorScope === "shared"[\s\S]*?submitSharedPlace\(\)/);
  assert.match(keyDown, /event\.preventDefault\(\)/);
  assert.match(keyDown, /void submitNearbyEditor\(\)/);
  assert.match(PAGE_SOURCE, /type=\{editorMode === "add" \? "submit" : "button"\}/);
});

test("modal keyboard submission keeps multiline/native controls local and never routes to the Stored Area editor", () => {
  const keyDown = sourceBetween(
    "function handleNearbyEditorKeyDown",
    "return (",
  );
  const submit = sourceBetween(
    "async function submitNearbyEditor()",
    "function handleNearbyEditorSubmit",
  );

  assert.match(keyDown, /target instanceof HTMLTextAreaElement/);
  assert.match(keyDown, /target instanceof HTMLSelectElement/);
  assert.match(keyDown, /target instanceof HTMLButtonElement/);
  assert.match(keyDown, /\["button", "checkbox", "radio", "reset", "submit"\]/);
  assert.doesNotMatch(submit, /storedPlaceFormSectionRef|setStoredForm|saveStoredPlace/);
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

test("successful canonical submission retains the Google result state until its exact ID is marked accepted, while failures leave the modal open", () => {
  const tenantAdd = sourceBetween("async function addTenantPlace()", "async function submitSharedPlace()");
  const sharedAdd = sourceBetween("async function submitSharedPlace()", "async function moveNearbyPlace()");
  const reset = sourceBetween("const resetNearbyEditorToClosed", "function openBlankNearbyEditor");

  assert.match(tenantAdd, /linkGoogleCandidateToCanonicalPlace\([\s\S]*?resetNearbyEditorToClosed\(\)/);
  assert.match(sharedAdd, /linkGoogleCandidateToCanonicalPlace\([\s\S]*?resetNearbyEditorToClosed\(\)/);
  assert.match(tenantAdd, /catch \(err: any\)[\s\S]*?showError\(/);
  assert.match(sharedAdd, /catch \(err: any\)[\s\S]*?showError\(/);
  assert.doesNotMatch(reset, /setGoogleResults|setMatchedGooglePlaceIds/);
});

test("Cancel remains the single explicit close path and preserves the existing dirty-discard confirmation", () => {
  const close = sourceBetween("async function closeNearbyEditor()", "function handleDestinationChange");
  assert.match(close, /isNearbyEditorDirty\(\)/);
  assert.match(close, /Discard Unsaved Changes\?/);
  assert.match(close, /resetNearbyEditorToClosed\(\)/);
});
