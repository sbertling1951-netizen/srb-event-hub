import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Stored Area selection remains template-based while parent identity is only consumed from the explicit resolved relationship", () => {
  assert.match(PAGE_SOURCE, /type StoredArea = \{\s*id: string;\s*nearby_area_id: string \| null;/);
  assert.match(PAGE_SOURCE, /\.from\("nearby_area_templates"\)[\s\S]*?"id,nearby_area_id,name/);
  assert.match(PAGE_SOURCE, /const selectedAreaParentId = selectedArea\?\.nearby_area_id \?\? null;/);
  assert.match(PAGE_SOURCE, /p_template_id: selectedAreaId/);
  assert.doesNotMatch(PAGE_SOURCE, /p_area_id: selectedAreaId/);
});

test("Stored Area creation uses the atomic governed RPC and legacy reads/copy operations use only the resolved parent", () => {
  assert.match(PAGE_SOURCE, /supabase\.rpc\("create_stored_area", payload\)/);
  assert.doesNotMatch(PAGE_SOURCE, /\.from\("nearby_area_templates"\)[\s\S]{0,240}\.insert\(/);
  assert.match(PAGE_SOURCE, /void loadStoredPlaces\(selectedAreaParentId\)/);
  assert.match(PAGE_SOURCE, /\.eq\("area_id", selectedAreaParentId\)/);
  assert.match(PAGE_SOURCE, /has no explicit Nearby Area parent mapping/);
});
