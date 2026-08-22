import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Nearby Category Authority Stage B, Part 3.
// No local Supabase/Docker instance is available in this environment to
// test-apply it -- these verify the SQL's shape/guards, matching this
// repository's established style for every prior migration.
//
// Run with:
//   npx tsx --test supabase/migrations/20260821230000_add_category_identity_to_nearby_resolver.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260821230000_add_category_identity_to_nearby_resolver.sql", import.meta.url)),
  "utf8",
);

test("every pre-existing output column is preserved, unchanged, in its original order", () => {
  const returnsIdx = SQL.indexOf("RETURNS TABLE (");
  const bodyIdx = SQL.indexOf("LANGUAGE plpgsql", returnsIdx);
  const returnsBlock = SQL.slice(returnsIdx, bodyIdx);

  const existingColumns = [
    "id uuid",
    "name text",
    "address text",
    "phone text",
    "website text",
    "category text",
    "notes text",
    "distance_miles numeric",
    "location_code text",
    "is_hidden boolean",
    "lat numeric",
    "lng numeric",
    "sort_order integer",
    "origin text",
  ];
  let lastIdx = -1;
  for (const col of existingColumns) {
    const idx = returnsBlock.indexOf(col);
    assert.notEqual(idx, -1, `expected existing column "${col}" to be preserved`);
    assert.ok(idx > lastIdx, `expected "${col}" to remain in its original relative order`);
    lastIdx = idx;
  }
});

test("the three new category columns are appended after every pre-existing column", () => {
  const originIdx = SQL.indexOf("origin text,");
  const categoryIdIdx = SQL.indexOf("category_id uuid,");
  const categoryCodeIdx = SQL.indexOf("category_code text,");
  const categoryLabelIdx = SQL.indexOf("category_label text");

  assert.ok(originIdx > 0 && categoryIdIdx > originIdx);
  assert.ok(categoryCodeIdx > categoryIdIdx);
  assert.ok(categoryLabelIdx > categoryCodeIdx);
});

test("joins place_categories via LEFT JOIN, not INNER JOIN -- a place with no category assigned must still be returned", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  assert.match(executable, /LEFT JOIN public\.place_categories AS pc ON pc\.id = enp\.category_id/);
  assert.equal(/\bINNER JOIN\b|(?<!LEFT )\bJOIN public\.place_categories\b/.test(executable), false);
});

test("the WHERE clause (event scoping, is_hidden filter) is byte-for-byte unchanged from the pre-Stage-B function", () => {
  assert.match(
    SQL,
    /WHERE enp\.event_id = p_event_id\s*\n\s*AND enp\.is_hidden = false;/,
  );
});

test("the previously-disabled shared/Tenant central-catalog UNION branch is not re-enabled -- the function still selects only from event_nearby_places", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  const fromClauses = [...executable.matchAll(/FROM\s+public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(fromClauses, ["event_nearby_places"]);
  assert.equal(/UNION/.test(executable), false);
});

test("the null-event-id early-return guard is preserved unchanged", () => {
  assert.match(SQL, /IF p_event_id IS NULL THEN\s*\n\s*RETURN;\s*\n\s*END IF;/);
});

test("remains SECURITY DEFINER, owned by postgres, with the same locked-down search_path", () => {
  assert.match(SQL, /SECURITY DEFINER/);
  assert.match(SQL, /SET search_path TO 'pg_catalog'/);
  assert.match(SQL, /ALTER FUNCTION public\.resolve_effective_nearby_places\(uuid\) OWNER TO postgres;/);
});

test("EXECUTE is regranted to exactly authenticated and anon, matching the live-verified pre-migration grant set -- not service_role, not PUBLIC", () => {
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.resolve_effective_nearby_places\(uuid\) FROM PUBLIC;/);
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.resolve_effective_nearby_places\(uuid\) TO authenticated;/,
  );
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.resolve_effective_nearby_places\(uuid\) TO anon;/);
  assert.equal(/TO service_role/.test(SQL), false);
  assert.equal(/TO PUBLIC;\s*$/m.test(SQL.replace(/REVOKE ALL[^\n]*FROM PUBLIC;/, "")), false);
});

test("no table grant, RLS policy, or authority-check change is introduced -- purely a function body/return-shape change", () => {
  assert.equal(/CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/.test(SQL), false);
  assert.equal(/GRANT (SELECT|INSERT|UPDATE|DELETE) ON TABLE/.test(SQL), false);
  assert.equal(/has_platform_admin_authority|has_tenant_admin_authority|has_event_admin_authority/.test(SQL), false);
});

test("touches only the resolver function -- no other table/function name appears", () => {
  const tableRefs = new Set(
    [...SQL.matchAll(/(?:FROM|JOIN)\s+public\.(\w+)/g)].map((m) => m[1]),
  );
  assert.deepEqual(tableRefs, new Set(["event_nearby_places", "place_categories"]));
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
