import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { shouldShowNoListsEmptyState } from "@/components/nearby/EventNearbyAreaListApplication";

const MANAGER = readFileSync(
  fileURLToPath(new URL("./NearbyAreaListManager.tsx", import.meta.url)),
  "utf8",
);
const APPLICATION = readFileSync(
  fileURLToPath(new URL("./EventNearbyAreaListApplication.tsx", import.meta.url)),
  "utf8",
);
const SETTINGS = readFileSync(
  fileURLToPath(new URL("../../app/admin/nearby-settings/page.tsx", import.meta.url)),
  "utf8",
);
const NEARBY = readFileSync(
  fileURLToPath(new URL("../../app/admin/nearby/page.tsx", import.meta.url)),
  "utf8",
);

test("Nearby Settings adopts the governed reusable Area List manager without browser table writes", () => {
  assert.match(SETTINGS, /NearbyAreaListManager/);
  assert.match(MANAGER, /list_nearby_area_lists_for_administration/);
  assert.match(MANAGER, /create_nearby_area_list/);
  assert.match(MANAGER, /update_nearby_area_list/);
  assert.match(MANAGER, /retire_nearby_area_list/);
  assert.match(MANAGER, /set_nearby_area_list_membership/);
  assert.match(MANAGER, /link_google_place_id_to_nearby_master/);
  assert.equal(/\.from\("nearby_area_lists"\)/.test(MANAGER), false);
  assert.equal(/\.from\("nearby_area_list_members"\)/.test(MANAGER), false);
  assert.equal(/\.from\("nearby_master_provider_identities"\)/.test(MANAGER), false);
  assert.equal(/\.from\("nearby_master"\)/.test(MANAGER), false);
});

// ---------------------------------------------------------------------------
// "Add eligible Stored Place" picker -- Area -> marker type -> name
// organization over the governed candidate read. Display only: the RPC
// already scoped what the admin may add; these controls never widen or
// bypass it, and batch add reuses the governed membership op.
// ---------------------------------------------------------------------------

test("the picker organizes the governed candidate read by Area then marker type", () => {
  // it consumes the Area-identity-carrying read
  assert.match(MANAGER, /list_nearby_master_places_for_area_list/);
  // grouping / filtering is delegated to the pure, tested module
  assert.match(
    MANAGER,
    /import \{[\s\S]*?filterAreaListCandidates,[\s\S]*?groupAreaListCandidates,[\s\S]*?\} from "@\/lib\/nearbyAreaListPicker"/,
  );
  assert.match(MANAGER, /groupAreaListCandidates\(filteredCandidates\)/);
  assert.match(MANAGER, /areaGroup\.typeGroups\.map\(/);
  assert.match(MANAGER, /typeGroup\.places\.map\(/);
  // the Unassigned ("no geographic Area") group is surfaced, not dropped
  assert.match(MANAGER, /No geographic Area/);
});

test("the picker exposes name + marker-type filters over the live vocabulary", () => {
  assert.match(MANAGER, /Filter by place name/);
  assert.match(MANAGER, /setPickerNameQuery\(event\.target\.value\)/);
  assert.match(MANAGER, /Filter by marker type/);
  assert.match(MANAGER, /areaListCandidateTypeOptions\(candidates\)/);
  assert.match(MANAGER, /togglePickerType\(option\.key\)/);
  // filter feeds filterAreaListCandidates with the membership exclusion
  assert.match(
    MANAGER,
    /filterAreaListCandidates\(candidates, \{\s*\n\s*nameQuery: pickerNameQuery,\s*\n\s*categoryKeys: pickerCategoryKeys,\s*\n\s*activeMemberIds,/,
  );
});

test("Select all / Deselect all act on the CURRENT filtered result set only", () => {
  assert.match(MANAGER, /Select all shown/);
  assert.match(MANAGER, /Deselect all/);
  assert.match(
    MANAGER,
    /function selectAllFilteredCandidates\(\) \{\s*\n\s*setPickerSelectedIds\(new Set\(selectableAreaListCandidateIds\(filteredCandidates\)\)\);/,
  );
  // a filtered-out row can never remain selected (so never batch-added)
  assert.match(MANAGER, /pruneSelectionToFiltered\(current, filteredCandidates\)/);
});

test("batch add reuses the governed membership operation, one call per place, no bypass", () => {
  assert.match(MANAGER, /async function addSelectedCandidatesToList\(\)/);
  const batch = MANAGER.slice(
    MANAGER.indexOf("async function addSelectedCandidatesToList()"),
    MANAGER.indexOf("return (", MANAGER.indexOf("async function addSelectedCandidatesToList()")),
  );
  assert.match(batch, /for \(const id of ids\) \{[\s\S]*?supabase\.rpc\("set_nearby_area_list_membership", \{/);
  assert.match(batch, /p_is_active: true,/);
  // no direct table write, no alternative RPC
  assert.doesNotMatch(batch, /\.from\(/);
  assert.doesNotMatch(batch, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  // selection is drawn from the filtered set, so nothing hidden is added
  assert.match(batch, /selectableAreaListCandidateIds\(filteredCandidates\)\.filter\(\(id\) =>\s*\n?\s*pickerSelectedIds\.has\(id\)/);
});

test("the single-row Add to Area List button is still available", () => {
  assert.match(MANAGER, /void setMembership\(candidate\.nearby_master_id, true\)/);
});

test("Nearby Admin uses only the event-scoped governed Area List application path", () => {
  assert.match(NEARBY, /EventNearbyAreaListApplication/);
  assert.match(NEARBY, /Google Maps results/);
  assert.match(APPLICATION, /list_nearby_area_lists_for_event_application/);
  assert.match(APPLICATION, /preview_nearby_area_list_event_application/);
  assert.match(APPLICATION, /apply_nearby_area_list_to_event/);
  assert.match(APPLICATION, /p_category_ids: selectedCategoryIds/);
  assert.match(APPLICATION, /Existing Event Nearby places and subsequent Event-specific curation remain independent/);
  assert.equal(/\.from\("event_nearby_places"\)[\s\S]*?\.insert/.test(APPLICATION), false);
  assert.equal(/\.from\("nearby_area_lists"\)/.test(APPLICATION), false);
});

// ---------------------------------------------------------------------------
// A loader failure must surface the error only -- never a simultaneous
// "successful and empty" message.
// ---------------------------------------------------------------------------

test("the zero-lists EmptyState render is gated on !error", () => {
  // The JSX must not render the "No active Area Lists" message while an
  // error is showing.
  assert.match(
    APPLICATION,
    /shouldShowNoListsEmptyState\(\{[\s\S]*?hasError: !!error[\s\S]*?\}\)\s*\?\s*<EmptyState message="No active Area Lists/,
  );
  // the loader still sets the error + clears the list on an rpcError
  assert.match(APPLICATION, /if \(rpcError\) \{\s*\n\s*setLists\(\[\]\);[\s\S]*?setError\("Could not load Area Lists available to this Event\."\);/);
});

test("successful zero-result load shows the EmptyState", () => {
  assert.equal(
    shouldShowNoListsEmptyState({ hasEventId: true, loading: false, hasError: false, listCount: 0 }),
    true,
  );
});

test("failed load does NOT show the EmptyState (error banner only)", () => {
  assert.equal(
    shouldShowNoListsEmptyState({ hasEventId: true, loading: false, hasError: true, listCount: 0 }),
    false,
  );
});

test("successful non-empty load does not show the EmptyState (list renders)", () => {
  assert.equal(
    shouldShowNoListsEmptyState({ hasEventId: true, loading: false, hasError: false, listCount: 3 }),
    false,
  );
});

test("EmptyState is suppressed while loading and when no Event is selected", () => {
  assert.equal(
    shouldShowNoListsEmptyState({ hasEventId: true, loading: true, hasError: false, listCount: 0 }),
    false,
  );
  assert.equal(
    shouldShowNoListsEmptyState({ hasEventId: false, loading: false, hasError: false, listCount: 0 }),
    false,
  );
});
