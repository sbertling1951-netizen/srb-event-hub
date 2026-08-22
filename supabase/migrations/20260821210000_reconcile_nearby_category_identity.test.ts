import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Nearby Category Authority Stage A
// reconciliation migration. No local Supabase/Docker instance is available
// in this environment to test-apply it (same constraint documented for
// every prior migration in this repository) -- these assertions verify the
// SQL's shape/guards/ordering, matching the established style already used
// by 20260821000000_fix_groveries_category_typo.test.ts.
//
// Run with:
//   npx tsx --test supabase/migrations/20260821210000_reconcile_nearby_category_identity.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260821210000_reconcile_nearby_category_identity.sql", import.meta.url)),
  "utf8",
);

test("is a no-op if the 'groceries' category does not exist -- guarded, not assumed present", () => {
  assert.match(SQL, /IF groceries_id IS NULL THEN\s*\n\s*RETURN;/);
});

test("fails loudly rather than silently if 'grocery' is missing -- never merges into a category that doesn't exist", () => {
  assert.match(SQL, /IF grocery_id IS NULL THEN\s*\n\s*RAISE EXCEPTION/);
});

test("repoints every real nearby_master place off the 'groceries' category before it can be deleted", () => {
  assert.match(
    SQL,
    /UPDATE public\.nearby_master\s*\n\s*SET category_id = grocery_id\s*\n\s*WHERE category_id = groceries_id;/,
  );
});

test("merges tenant_category_overrides/tenant_type_category_defaults with the same duplicate-collision guard as the 20260821000000 precedent", () => {
  const overridesDeleteIdx = SQL.indexOf("DELETE FROM public.tenant_category_overrides");
  const overridesUpdateIdx = SQL.indexOf("UPDATE public.tenant_category_overrides");
  assert.notEqual(overridesDeleteIdx, -1);
  assert.notEqual(overridesUpdateIdx, -1);
  assert.ok(overridesDeleteIdx < overridesUpdateIdx, "the duplicate-guard delete must run before the blanket repoint");

  const defaultsDeleteIdx = SQL.indexOf("DELETE FROM public.tenant_type_category_defaults");
  const defaultsUpdateIdx = SQL.indexOf("UPDATE public.tenant_type_category_defaults");
  assert.notEqual(defaultsDeleteIdx, -1);
  assert.notEqual(defaultsUpdateIdx, -1);
  assert.ok(defaultsDeleteIdx < defaultsUpdateIdx, "the duplicate-guard delete must run before the blanket repoint");
});

test("deletes the 'groceries' place_categories row itself, last, after every reference is repointed", () => {
  const deleteIdx = SQL.indexOf("DELETE FROM public.place_categories WHERE id = groceries_id;");
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

test("corrects the legacy free-text 'Groveries' misspelling in both nearby_master.category and event_nearby_places.category -- explicitly does not rewrite 'Groceries'", () => {
  assert.match(SQL, /UPDATE public\.nearby_master SET category = 'Grocery' WHERE category = 'Groveries';/);
  assert.match(SQL, /UPDATE public\.event_nearby_places SET category = 'Grocery' WHERE category = 'Groveries';/);
  assert.equal(/WHERE category = 'Groceries'/.test(SQL), false);
});

test("the free-text correction runs before the event_nearby_places.category_id backfill, so the corrected text resolves cleanly", () => {
  const correctionIdx = SQL.indexOf("UPDATE public.event_nearby_places SET category = 'Grocery'");
  const backfillIdx = SQL.indexOf("UPDATE public.event_nearby_places AS enp");
  assert.notEqual(correctionIdx, -1);
  assert.notEqual(backfillIdx, -1);
  assert.ok(correctionIdx < backfillIdx);
});

test("adds event_nearby_places.category_id as a nullable FK to place_categories -- no NOT NULL, mirroring nearby_master.category_id's own nullability", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.event_nearby_places\s*\n\s*ADD COLUMN category_id uuid REFERENCES public\.place_categories\(id\);/,
  );
  assert.equal(/category_id uuid REFERENCES public\.place_categories\(id\) NOT NULL/.test(SQL), false);
});

test("adds a partial index on event_nearby_places.category_id, matching the nearby_master_category_id_idx convention", () => {
  assert.match(
    SQL,
    /CREATE INDEX event_nearby_places_category_id_idx\s*\n\s*ON public\.event_nearby_places \(category_id\) WHERE category_id IS NOT NULL;/,
  );
});

test("the category_id backfill uses the exact same normalization as the original nearby_master backfill (lowercase, non-alnum runs to underscore, trimmed)", () => {
  assert.match(
    SQL,
    /pc\.code = btrim\(\s*\n\s*lower\(regexp_replace\(btrim\(enp\.category\), '\[\^a-zA-Z0-9\]\+', '_', 'g'\)\),\s*\n\s*'_'\s*\n\s*\);/,
  );
});

test("the backfill only ever fills a currently-null category_id, and only from a non-blank category value -- never overwrites an existing value", () => {
  const backfillStart = SQL.indexOf("UPDATE public.event_nearby_places AS enp");
  const backfillBody = SQL.slice(backfillStart, SQL.indexOf("COMMIT;"));
  assert.match(backfillBody, /enp\.category_id IS NULL/);
  assert.match(backfillBody, /enp\.category IS NOT NULL/);
  assert.match(backfillBody, /btrim\(enp\.category\) <> ''/);
});

test("no category is invented -- the backfill only ever joins to an existing place_categories row, never inserts one", () => {
  assert.equal(/INSERT INTO public\.place_categories/.test(SQL), false);
});

test("touches only the five expected tables -- no unrelated schema/data change", () => {
  const tableRefs = new Set(
    [...SQL.matchAll(/(?:FROM|UPDATE|INTO|TABLE)\s+public\.(\w+)/g)].map((m) => m[1]),
  );
  assert.deepEqual(
    tableRefs,
    new Set([
      "place_categories",
      "nearby_master",
      "tenant_category_overrides",
      "tenant_type_category_defaults",
      "event_nearby_places",
    ]),
  );
});

test("no RPC, function, trigger, grant, or RLS policy is introduced -- reconciliation/schema only, per the Stage A authority boundary", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(SQL), false);
  assert.equal(/CREATE TRIGGER/.test(SQL), false);
  assert.equal(/\bGRANT\b|\bREVOKE\b/.test(SQL), false);
  assert.equal(/CREATE POLICY|ALTER POLICY/.test(SQL), false);
  assert.equal(/ENABLE ROW LEVEL SECURITY/.test(SQL), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});

test("does not touch app/member/nearby/page.tsx's or app/admin/nearby-settings/page.tsx's own consumer contracts -- schema/data only", () => {
  assert.equal(/resolve_effective_nearby_places/.test(SQL), false);
  assert.equal(/rename_place_category/.test(SQL), false);
});
