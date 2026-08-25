import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
