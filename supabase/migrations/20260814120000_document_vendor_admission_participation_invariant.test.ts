import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Vendor Admission Lifecycle Stage 1
// invariant-documentation migration. COMMENT-only -- no schema, RLS, or
// behavioral change -- so its entire effect is provable from its SQL
// text. The underlying behavior this documents (a 'revoked' disposition
// does not rewrite vendor_event_applications.status) was proven live
// during Stage 1 foundation validation and re-proven as part of this
// closeout; that live proof is reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814120000_document_vendor_admission_participation_invariant.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814120000_document_vendor_admission_participation_invariant.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("no schema, RLS, or function change -- only COMMENT ON statements", () => {
  assert.equal(/CREATE TABLE/.test(executableSql), false);
  assert.equal(/ALTER TABLE/.test(executableSql), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/\bGRANT\b|\bREVOKE\b/.test(executableSql), false);
  const commentStatements = executableSql.match(/COMMENT ON[^;]*;/g) || [];
  assert.equal(commentStatements.length, 3);
});

test("documents that vendor_event_applications.status is historical, not current-participation", () => {
  assert.match(
    executableSql,
    /COMMENT ON COLUMN public\.vendor_event_applications\.status IS[\s\S]*?Current participation must always be read from event_vendors\.admission_state/,
  );
});

test("documents that event_vendors.admission_state is the authoritative current-participation source", () => {
  assert.match(
    executableSql,
    /COMMENT ON COLUMN public\.event_vendors\.admission_state IS[\s\S]*?authoritative current participation state/,
  );
});

test("documents that vendor_event_dispositions is historical evidence, not a source to derive current state from", () => {
  assert.match(
    executableSql,
    /COMMENT ON TABLE public\.vendor_event_dispositions IS[\s\S]*?current participation must be read from event_vendors\.admission_state/,
  );
});

test("no other table or column is commented", () => {
  const targets = executableSql.match(/COMMENT ON (?:TABLE|COLUMN) public\.([\w.]+)/g) || [];
  const names = targets.map((t) => t.replace(/COMMENT ON (?:TABLE|COLUMN) public\./, ""));
  assert.deepEqual(
    names.sort(),
    ["event_vendors.admission_state", "vendor_event_applications.status", "vendor_event_dispositions"].sort(),
  );
});

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});
