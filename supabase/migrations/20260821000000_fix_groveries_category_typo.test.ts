import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the "Groveries" -> "Grocery" category
// typo fix. This corrects a real, already-live public.place_categories
// row (backfilled verbatim from a historical free-text typo in
// public.nearby_master.category) -- not app/admin/nearby/page.tsx's own
// UI, which is unrelated and untouched.
//
// Run with:
//   npx tsx --test supabase/migrations/20260821000000_fix_groveries_category_typo.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260821000000_fix_groveries_category_typo.sql", import.meta.url)),
  "utf8",
);

test("is a no-op if the 'groveries' category does not exist -- guarded, not assumed present", () => {
  assert.match(SQL, /IF groveries_id IS NULL THEN\s*\n\s*RETURN;/);
});

test("fails loudly rather than silently if 'grocery' is missing -- never merges into a category that doesn't exist", () => {
  assert.match(SQL, /IF grocery_id IS NULL THEN\s*\n\s*RAISE EXCEPTION/);
});

test("repoints every real nearby_master place off the typo'd category before it can be deleted", () => {
  assert.match(
    SQL,
    /UPDATE public\.nearby_master\s*\n\s*SET category_id = grocery_id\s*\n\s*WHERE category_id = groveries_id;/,
  );
});

test("merges tenant_category_overrides without risking the tenant_id/category_id unique-constraint violation -- drops the duplicate, then repoints the rest", () => {
  const deleteIdx = SQL.indexOf("DELETE FROM public.tenant_category_overrides");
  const updateIdx = SQL.indexOf("UPDATE public.tenant_category_overrides");
  assert.notEqual(deleteIdx, -1);
  assert.notEqual(updateIdx, -1);
  assert.ok(deleteIdx < updateIdx, "the duplicate-guard delete must run before the blanket repoint");

  const deleteBlock = SQL.slice(deleteIdx, updateIdx);
  assert.match(deleteBlock, /grocery_row\.tenant_id = groveries_row\.tenant_id/);
  assert.match(deleteBlock, /grocery_row\.category_id = grocery_id/);
});

test("merges tenant_type_category_defaults with the same duplicate guard", () => {
  const deleteIdx = SQL.indexOf("DELETE FROM public.tenant_type_category_defaults");
  const updateIdx = SQL.indexOf("UPDATE public.tenant_type_category_defaults");
  assert.notEqual(deleteIdx, -1);
  assert.notEqual(updateIdx, -1);
  assert.ok(deleteIdx < updateIdx, "the duplicate-guard delete must run before the blanket repoint");

  const deleteBlock = SQL.slice(deleteIdx, updateIdx);
  assert.match(deleteBlock, /grocery_row\.tenant_type_id = groveries_row\.tenant_type_id/);
  assert.match(deleteBlock, /grocery_row\.category_id = grocery_id/);
});

test("deletes the typo'd place_categories row itself, last, after every reference is repointed", () => {
  const deleteIdx = SQL.indexOf("DELETE FROM public.place_categories WHERE id = groveries_id;");
  assert.notEqual(deleteIdx, -1);

  for (const priorStatement of [
    "UPDATE public.nearby_master",
    "UPDATE public.tenant_category_overrides",
    "UPDATE public.tenant_type_category_defaults",
  ]) {
    const idx = SQL.indexOf(priorStatement);
    assert.notEqual(idx, -1);
    assert.ok(idx < deleteIdx, `${priorStatement} must run before the category row is deleted`);
  }
});

test("touches only the four expected tables -- no unrelated schema/data change", () => {
  const tableRefs = new Set(
    [...SQL.matchAll(/(?:FROM|UPDATE|INTO)\s+public\.(\w+)/g)].map((m) => m[1]),
  );
  assert.deepEqual(
    tableRefs,
    new Set([
      "place_categories",
      "nearby_master",
      "tenant_category_overrides",
      "tenant_type_category_defaults",
    ]),
  );
});

test("never touches nearby_master's or event_nearby_places' legacy free-text category column, or app/admin/nearby/page.tsx's own workflow", () => {
  assert.equal(/\bcategory\b(?!_id)/.test(SQL.replace(/--.*$/gm, "")), false);
  assert.equal(/event_nearby_places/.test(SQL), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
