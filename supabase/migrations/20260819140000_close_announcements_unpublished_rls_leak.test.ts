import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Announcements RLS leak closure.
// This migration only drops the three redundant USING(true) SELECT
// policies -- live pre/post grant and RLS-policy evidence, and the live
// anon published-vs-draft REST proof, are reported separately, not
// re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260819140000_close_announcements_unpublished_rls_leak.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260819140000_close_announcements_unpublished_rls_leak.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

test("drops exactly the three redundant USING(true) policies, by exact name", () => {
  const dropStatements = executableSql.match(/DROP POLICY[^;]*;/g) || [];
  assert.equal(dropStatements.length, 3);

  for (const name of [
    "Members can read announcements",
    "Public read announcements",
    "public read announcements",
  ]) {
    assert.match(
      executableSql,
      new RegExp(
        `DROP POLICY IF EXISTS "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" ON public\\.announcements;`,
      ),
    );
  }
});

test("does not drop the two legitimate policies: Admin access and the published-only member policy", () => {
  assert.equal(
    /DROP POLICY[^;]*"Admins can view announcements"/.test(executableSql),
    false,
  );
  assert.equal(
    /DROP POLICY[^;]*"Members can view published announcements"/.test(executableSql),
    false,
  );
});

test("no INSERT/UPDATE/DELETE Admin policy is touched", () => {
  assert.equal(/DROP POLICY[^;]*insert/i.test(executableSql), false);
  assert.equal(/DROP POLICY[^;]*update/i.test(executableSql), false);
  assert.equal(/DROP POLICY[^;]*delete/i.test(executableSql), false);
});

test("no CREATE POLICY, GRANT, REVOKE, or ROW LEVEL SECURITY statement -- policy-drop only", () => {
  assert.equal(/CREATE POLICY/.test(executableSql), false);
  assert.equal(/\bGRANT\b/.test(executableSql), false);
  assert.equal(/\bREVOKE\b/.test(executableSql), false);
  assert.equal(/ROW LEVEL SECURITY/.test(executableSql), false);
});

test("no other table is referenced -- announcements only", () => {
  const tableRefs = executableSql.match(/ON public\.(\w+)/g) || [];
  assert.ok(tableRefs.length > 0);
  for (const ref of tableRefs) {
    assert.equal(ref, "ON public.announcements");
  }
});

test("statement is wrapped in a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});
