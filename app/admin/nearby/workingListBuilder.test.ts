import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Nearby curated-list builder -- page wiring (Checkpoint 2).
//
// Consistent with this file's neighbours (page.test.ts,
// googleCandidateWorkflow.test.ts): no RTL/jsdom harness exists in this
// repo, so the page's behaviour is proven from source. The pure Working
// List reducer, the type mapping, the fan-out, and the two routes are
// proven behaviourally in lib/*.test.ts and app/api/google/**/route.test.ts.
//
// Run with:
//   npx tsx --test app/admin/nearby/workingListBuilder.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

function functionSlice(startNeedle: string, endNeedle: string): string {
  const start = PAGE_SOURCE.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = PAGE_SOURCE.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing ${endNeedle} after ${startNeedle}`);
  return PAGE_SOURCE.slice(start, end);
}

// --- Search: new contract, server authority via Bearer -------------------

test("the multi-type search calls the secured route with { eventId, categoryCodes, radiusMiles, freeText } and an Authorization: Bearer header", () => {
  const search = functionSlice(
    "async function searchGoogleNearby()",
    "function toggleSearchCategory",
  );
  assert.match(search, /supabase\.auth\.getSession\(\)/);
  assert.match(search, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(search, /fetch\("\/api\/google\/nearby-search"/);
  assert.match(search, /eventId: adminEvent\.id/);
  assert.match(search, /categoryCodes,/);
  assert.match(search, /radiusMiles: Number\(googleRadius\) \|\| 10/);
  assert.match(search, /freeText: freeText \|\| undefined/);
  assert.match(search, /data\.candidates/);
});

test("the selectable place types come from the live place_categories catalog, never a list hard-coded in this page", () => {
  // the search UI maps placeCategories directly
  assert.match(
    PAGE_SOURCE,
    /placeCategories\.map\(\(category\) => \(\s*<Checkbox\s+key=\{category\.id\}\s+label=\{category\.label\}\s+checked=\{selectedSearchCategoryCodes\.has\(category\.code\)\}/,
  );
  // no reintroduced hard-coded option catalog
  assert.equal(/__custom__/.test(PAGE_SOURCE), false);
});

// --- Candidates are candidates only; searches accumulate ----------------

test("a new search replaces Search Candidates only and never resets the Working List", () => {
  const search = functionSlice(
    "async function searchGoogleNearby()",
    "function toggleSearchCategory",
  );
  assert.match(search, /setGoogleResults\(results\)/);
  assert.match(search, /setSelectedCandidateIds\(new Set\(\)\)/);
  assert.doesNotMatch(search, /setWorkingList\(/);
});

test("only explicitly selected, still-pending, not-already-in-list candidates can enter the Working List", () => {
  const add = functionSlice(
    "async function addSelectedCandidatesToWorkingList()",
    "async function enrichWorkingListEntry",
  );
  assert.match(add, /addableCandidates\.filter\(/);
  assert.match(add, /selectedCandidateIds\.has\(place\.id\)/);
  assert.match(add, /addCandidatesToWorkingList\(/);
  // addable list already excludes matched-canonical and in-list candidates
  assert.match(
    PAGE_SOURCE,
    /const addableCandidates = useMemo\(\s*\(\) =>\s*pendingGoogleResults\.filter\(\s*\(place\) => !!place\.id && !workingListHasGooglePlaceId\(workingList, place\.id\),/,
  );
});

test("candidate / working-list / reused / added states are each derived from their own source and not conflated", () => {
  // an exact new provider candidate -> addable (has a place_id, not yet in list)
  assert.match(
    PAGE_SOURCE,
    /const addableCandidates = useMemo\([\s\S]*?!!place\.id && !workingListHasGooglePlaceId\(workingList, place\.id\)/,
  );
  // already in Working List -> exact googlePlaceId membership
  assert.match(PAGE_SOURCE, /workingListHasGooglePlaceId\(workingList, place\.id\)/);
  // canonical reuse this session -> reuseOutcome from the governed RPC (never a master id)
  assert.match(
    PAGE_SOURCE,
    /entry\.reuseOutcome === "reused" \|\|\s*entry\.reuseOutcome === "already_associated" \? \(\s*<StatusBadge tone="success">Reused from catalog<\/StatusBadge>/,
  );
  // Event-only added / already-present this session -> savedEventPlaceId
  assert.match(
    PAGE_SOURCE,
    /entry\.savedEventPlaceId \? \(\s*<StatusBadge tone="success">In this Event<\/StatusBadge>/,
  );
  // the builder no longer classifies canonical-vs-new at search time
  assert.doesNotMatch(PAGE_SOURCE, /catalogMatchedCandidates/);
});

// --- Lazy Place Details: non-fatal, race-safe --------------------------

test("provider details are fetched lazily per added entry, through the secured route, and a failure is non-destructive", () => {
  const enrich = functionSlice(
    "async function enrichWorkingListEntry",
    "async function removeWorkingListEntryById",
  );
  assert.match(enrich, /fetch\("\/api\/google\/place-details"/);
  assert.match(enrich, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(enrich, /applyPlaceDetails\(current, entryKey, "failed"\)/);
  assert.match(enrich, /applyPlaceDetails\(current, entryKey, "fetched"/);
  // never throws out of the enrichment
  assert.match(enrich, /catch \(err\) \{[\s\S]*?applyPlaceDetails\(current, entryKey, "failed"\)/);
});

// --- Same editor, reused --------------------------------------------------

test("manual add and Working List entry edit reuse the single shared Add/Edit dialog (editorTarget), not a second editor", () => {
  assert.equal((PAGE_SOURCE.match(/<Dialog\s+open=\{editorExpanded\}/g) || []).length, 1);
  assert.equal((PAGE_SOURCE.match(/onSubmit=\{handleNearbyEditorSubmit\}/g) || []).length, 1);

  const submit = functionSlice(
    "async function submitNearbyEditor()",
    "function handleNearbyEditorSubmit",
  );
  assert.match(submit, /if \(editorTarget === "working_list"\) \{\s*await saveEditorToWorkingList\(\);\s*return;/);

  for (const opener of ["openManualWorkingListEditor", "openWorkingListEntryInEditor"]) {
    const body = functionSlice(`function ${opener}(`, "\n  }\n");
    assert.match(body, /setEditorTarget\("working_list"\)/);
    assert.match(body, /setEditorExpanded\(true\)/);
  }
});

test("saving from the editor to the Working List reuses the shared coordinate resolver and writes NO database row", () => {
  const save = functionSlice(
    "async function saveEditorToWorkingList()",
    "async function addWorkingListToEvent()",
  );
  assert.match(save, /resolveNearbyCoordinates\(/);
  assert.match(save, /updateWorkingListEntry\(current, editorWorkingListKey, fields\)/);
  assert.match(save, /addManualWorkingListEntry\(current, fields\)/);
  assert.match(save, /findWorkingListDuplicates\(/);
  assert.doesNotMatch(save, /\.from\("event_nearby_places"\)/);
  assert.doesNotMatch(save, /supabase\.rpc\(/);
});

// --- Final save: additive, Event-only, retry-safe ----------------------

test("Add Working List to This Event: canonical reuse via the governed RPC, everything else additive Event-only, no destructive replace", () => {
  const save = functionSlice(
    "async function addWorkingListToEvent()",
    "function clearSavedFromWorkingList",
  );
  assert.match(save, /entriesPendingSave\(workingList\)/);
  // Google entries -> the governed mutation-owning reuse RPC (never a master id)
  assert.match(
    save,
    /supabase\.rpc\(\s*\n?\s*"reuse_nearby_places_by_google_place_id_for_event",/,
  );
  assert.match(save, /markWorkingListEntriesReuseOutcome\(current, reuseSettled\)/);
  assert.doesNotMatch(save, /nearby_master_id|p_place_id/);
  // manual + not_reusable entries -> additive Event-only insert
  assert.match(save, /\.from\("event_nearby_places"\)\s*\n\s*\.insert\(payload\)/);
  assert.match(save, /source_master_id: null,/);
  assert.match(save, /markWorkingListEntriesSaved\(current, settledEventPlaces\)/);
  // D1: existing Event place -> skip, never re-insert
  assert.match(save, /findExistingEventPlaceMatch\(entry, eventPlaces\)/);
  assert.match(save, /skipped\.push\(\{ key: entry\.key/);
  // no destructive replace, no catalog CRUD escalation, no direct association call
  assert.doesNotMatch(save, /replace_event_nearby_from_stored_area/);
  assert.doesNotMatch(
    save,
    /\.rpc\(\s*\n?\s*"(add_tenant_place_to_event|record_tenant_place|associate_nearby_master_place_with_event)"/,
  );
  // D3: try/finally resets the saving flag; sort-order query error surfaced
  assert.match(save, /\} finally \{\s*\n\s*setSavingWorkingListToEvent\(false\);/);
  assert.match(save, /maxSortError\) \{/);
  // partial failure keeps failed entries; never clears the whole list
  assert.match(save, /failed\.push\(\{/);
  assert.doesNotMatch(save, /setWorkingList\(EMPTY_WORKING_LIST\)/);
});

test("an unexpected reuse-RPC error aborts the whole save -- no Event-only fallback, nothing settled, full retry", () => {
  const save = functionSlice(
    "async function addWorkingListToEvent()",
    "function clearSavedFromWorkingList",
  );
  const reuseErrIdx = save.indexOf("if (reuseError) {");
  const eventInsertIdx = save.indexOf('.from("event_nearby_places")');
  assert.ok(reuseErrIdx >= 0 && eventInsertIdx >= 0);
  // the reuseError guard, and its `return;`, come BEFORE the Event-only
  // insert loop -- an RPC failure performs no Event-only fallback.
  const returnIdx = save.indexOf("return;", reuseErrIdx);
  assert.ok(returnIdx >= 0 && returnIdx < eventInsertIdx);
  assert.ok(reuseErrIdx < returnIdx);
  // the message surfaced is the RPC's own generic text (or a generic fallback), never an id
  assert.match(save, /reuseError\.message \|\| "Nearby place reuse failed\."/);
});

test("the builder never uses a service-role / admin Supabase client in the browser", () => {
  assert.equal(/getSupabaseAdminClient|SERVICE_ROLE/.test(PAGE_SOURCE), false);
});

// --- Unsaved Working-List protection (Area J) --------------------------

test("Working-List Event-context clearing is delegated to resolveWorkingListEventTransition (D7); only 'clear' wipes; pending entries arm a beforeunload guard", () => {
  // the effect asks the pure helper for the transition -- it does NOT
  // hand-roll `workingListEventId !== currentEventId`
  assert.match(
    PAGE_SOURCE,
    /const transition = resolveWorkingListEventTransition\(\s*workingListEventId,\s*adminEvent\?\.id,\s*\)/,
  );
  assert.doesNotMatch(PAGE_SOURCE, /workingListEventId !== currentEventId/);
  // only the "clear" branch wipes the list
  assert.match(
    PAGE_SOURCE,
    /if \(transition\.action === "clear"\) \{[\s\S]*?setWorkingList\(EMPTY_WORKING_LIST\)[\s\S]*?setWorkingListEventId\(transition\.eventId\)/,
  );
  assert.match(
    PAGE_SOURCE,
    /if \(transition\.action === "hold"\) \{\s*\n\s*return;\s*\n\s*\}/,
  );
  assert.match(PAGE_SOURCE, /The Working List was cleared because the Admin Working Event changed/);
  assert.match(
    PAGE_SOURCE,
    /if \(workingListPendingCount === 0\) \{\s*return;\s*\}\s*function warnBeforeUnload/,
  );
});

// --- Canonical reuse (follow-up) --------------------------------------

test("a candidate that matches a canonical place is NOT blocked -- it is addable, and reuse is resolved at save", () => {
  // The exact-ID matcher is now called after a search, but ONLY to label
  // state -- it never removes a candidate from the addable set and never
  // gates addability.
  assert.match(
    PAGE_SOURCE,
    /\.rpc\(\s*\n?\s*"list_matching_google_place_ids_for_nearby_administration"/,
  );
  // addable set is STILL just "has an exact place_id and not already in
  // the list" -- catalogMatchedGooglePlaceIds does not appear in it.
  assert.match(
    PAGE_SOURCE,
    /pendingGoogleResults\.filter\(\s*\(place\) => !!place\.id && !workingListHasGooglePlaceId\(workingList, place\.id\),/,
  );
  const addable = functionSlice(
    "const addableCandidates = useMemo(",
    "function toggleCandidateSelection",
  );
  assert.doesNotMatch(addable, /catalogMatchedGooglePlaceIds/);
});

test("canonical reuse is retry-safe and never creates a duplicate Event-only row", () => {
  const save = functionSlice(
    "async function addWorkingListToEvent()",
    "function clearSavedFromWorkingList",
  );
  // only manual + not_reusable entries take the Event-only insert path
  assert.match(
    save,
    /const eventOnlyEntries = pending\.filter\(\s*\(entry\) => entry\.source === "manual" \|\| notReusableKeys\.has\(entry\.key\),/,
  );
  // reused / already_associated entries settle via markWorkingListEntriesReuseOutcome
  assert.match(save, /markWorkingListEntriesReuseOutcome\(current, reuseSettled\)/);
  // F11: a MISSING RPC outcome fails closed -> failed/retryable, never inferred not_reusable
  assert.match(
    save,
    /const outcome = reuseByPlaceId\.get\(entry\.googlePlaceId as string\);\s*\n\s*if \(!outcome\) \{\s*\n\s*failed\.push\(\{/,
  );
  assert.doesNotMatch(save, /\?\? "not_reusable"/);
  // entriesPendingSave (which excludes settled entries) is the retry source
  assert.match(save, /const pending = entriesPendingSave\(workingList\)/);
});

test("the reuse flow never asks for, and the Working List model never carries, a nearby_master id", () => {
  const save = functionSlice(
    "async function addWorkingListToEvent()",
    "function clearSavedFromWorkingList",
  );
  // The RPC row shape the page consumes is exactly { google_place_id,
  // outcome } -- no canonical id crosses the boundary. (source_master_id:
  // null, the Event-only insert marker, is a different, expected thing.)
  assert.match(
    save,
    /google_place_id: string;\s*outcome: "reused" \| "already_associated" \| "not_reusable";/,
  );
  assert.doesNotMatch(save, /\bnearby_master_id\b/);
  assert.doesNotMatch(save, /p_place_id/);
  // the model addition is a non-sensitive outcome only
  assert.doesNotMatch(PAGE_SOURCE, /canonicalNearbyMasterId|canonicalMasterId/);
  assert.match(PAGE_SOURCE, /reuseOutcome/);
});

// --- Working List editor field cleanup (Step 8) ----------------------

test("the Working List editor hides Distance and Hidden-from-members; the normal Event editor still shows them", () => {
  assert.match(
    PAGE_SOURCE,
    /\{editorTarget === "working_list" \? null : \(\s*<Field label="Distance \(miles\)">/,
  );
  assert.match(
    PAGE_SOURCE,
    /\{editorTarget === "working_list" \? null : \(\s*<Checkbox\s+label="Hidden from members"/,
  );
  // the fields are still in source for the Event editor
  assert.match(PAGE_SOURCE, /<Field label="Distance \(miles\)">/);
  assert.match(PAGE_SOURCE, /label="Hidden from members"/);
  // editor makes its staging nature explicit
  assert.match(
    PAGE_SOURCE,
    /This edits the Working List\. Nothing is added to the Event/,
  );
});

// --- D2: category identity -------------------------------------------

test("a Google candidate's producing category is resolved to a canonical category_id, never persisted as a raw code", () => {
  const add = functionSlice(
    "async function addSelectedCandidatesToWorkingList()",
    "async function enrichWorkingListEntry",
  );
  assert.match(add, /placeCategories\.find\(\s*\(category\) => category\.code === producingCode\)/);
  assert.match(add, /categoryId: matchedCategory\?\.id \?\? ""/);

  const finalSave = functionSlice(
    "async function addWorkingListToEvent()",
    "function clearSavedFromWorkingList",
  );
  // label column derives from category_id, never entry.categoryCode
  assert.match(
    finalSave,
    /category: entry\.categoryId\s*\?\s*categoryLabelById\.get\(entry\.categoryId\) \?\? null\s*:\s*null,/,
  );
  assert.doesNotMatch(finalSave, /category: entry\.categoryCode/);
});

// --- Route guard unchanged -------------------------------------------------

test("the page route guard remains event.nearby.manage", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredTask="event\.nearby\.manage">/);
});
