import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for the corrective follow-up to
// 20260821210000_reconcile_nearby_category_identity.sql -- see that file's
// header comment and this file's own header for why the follow-up was
// needed: the deterministic normalized-code backfill could not match
// "Groceries" free text once its own catalog code was merged away in the
// same prior migration.
//
// Run with:
//   npx tsx --test supabase/migrations/20260821220000_backfill_groceries_event_places_category_id.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260821220000_backfill_groceries_event_places_category_id.sql", import.meta.url)),
  "utf8",
);

test("only ever fills a currently-null category_id -- never overwrites an existing value", () => {
  assert.match(SQL, /WHERE category_id IS NULL/);
});

test("targets exactly the 'Groceries' free-text spelling, case-sensitive, nothing broader", () => {
  assert.match(SQL, /AND category = 'Groceries';/);
});

test("resolves through the live place_categories row by code, not a hardcoded id literal -- stays correct if the canonical id ever changes", () => {
  assert.match(SQL, /SET category_id = \(SELECT id FROM public\.place_categories WHERE code = 'grocery'\)/);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(SQL), false);
});

test("touches only event_nearby_places -- no unrelated table", () => {
  const tableRefs = new Set(
    [...SQL.matchAll(/(?:FROM|UPDATE|INTO)\s+public\.(\w+)/g)].map((m) => m[1]),
  );
  assert.deepEqual(tableRefs, new Set(["event_nearby_places", "place_categories"]));
});

test("no category is invented -- only ever joins to the already-existing 'grocery' row", () => {
  assert.equal(/INSERT INTO public\.place_categories/.test(SQL), false);
});

test("no RPC, function, trigger, grant, or RLS policy is introduced", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(SQL), false);
  assert.equal(/CREATE TRIGGER/.test(SQL), false);
  assert.equal(/\bGRANT\b|\bREVOKE\b/.test(SQL), false);
  assert.equal(/CREATE POLICY|ALTER POLICY/.test(SQL), false);
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
