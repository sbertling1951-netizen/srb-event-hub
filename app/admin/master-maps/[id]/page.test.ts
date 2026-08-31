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
