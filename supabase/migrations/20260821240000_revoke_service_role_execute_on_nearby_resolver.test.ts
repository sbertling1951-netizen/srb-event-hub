import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for the corrective follow-up to
// 20260821230000_add_category_identity_to_nearby_resolver.sql -- see that
// file's header and this file's own header for why it was needed:
// Supabase's default ACL grants EXECUTE on every newly-created function to
// service_role automatically, which a DROP+CREATE cannot avoid by only
// reapplying the intended grants -- the unwanted one must be explicitly
// revoked.
//
// Run with:
//   npx tsx --test supabase/migrations/20260821240000_revoke_service_role_execute_on_nearby_resolver.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20260821240000_revoke_service_role_execute_on_nearby_resolver.sql", import.meta.url)),
  "utf8",
);

test("revokes exactly EXECUTE on resolve_effective_nearby_places from service_role, nothing else", () => {
  assert.match(SQL, /^REVOKE EXECUTE ON FUNCTION public\.resolve_effective_nearby_places\(uuid\) FROM service_role;$/m);
});

test("does not touch authenticated or anon's grants -- those remain exactly as the prior migration set them", () => {
  assert.equal(/TO authenticated/.test(SQL), false);
  assert.equal(/TO anon/.test(SQL), false);
  assert.equal(/GRANT/.test(SQL), false);
});

test("does not recreate or alter the function body/return shape -- grants only", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  assert.equal(/CREATE (OR REPLACE )?FUNCTION|DROP FUNCTION/.test(executable), false);
});

test("touches no table, RLS policy, or other function", () => {
  assert.equal(/CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/.test(SQL), false);
  const functionRefs = new Set(
    [...SQL.matchAll(/ON FUNCTION public\.(\w+)/g)].map((m) => m[1]),
  );
  assert.deepEqual(functionRefs, new Set(["resolve_effective_nearby_places"]));
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
