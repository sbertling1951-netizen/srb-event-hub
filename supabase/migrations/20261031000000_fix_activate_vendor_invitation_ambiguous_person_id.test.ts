import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level regression for the activate_vendor_invitation `person_id`
// ambiguity (42702 under plpgsql.variable_conflict = error). Mel also verified
// the deployed function fails and this repair succeeds in isolated PostgreSQL
// with synthetic records and a stub identity resolver; see the Brief.
//
// Run with:
//   npx tsx --test supabase/migrations/20261031000000_fix_activate_vendor_invitation_ambiguous_person_id.test.ts

function readMigration(name: string) {
  const sql = readFileSync(
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    "utf8",
  );
  return sql.replace(/^\s*--.*$/gm, "");
}

const FIXED = readMigration(
  "20261031000000_fix_activate_vendor_invitation_ambiguous_person_id.sql",
);
const APPLIED = readMigration(
  "20260801120300_create_atomic_vendor_invitation_activation.sql",
);

// Output columns of RETURNS TABLE(...) -- PL/pgSQL variables in the body.
const OUT_COLUMNS = ["outcome", "person_id", "resolution_audit_id", "activated_access_id"];

function functionBody(sql: string) {
  const match = sql.match(
    /FUNCTION public\.activate_vendor_invitation\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert.ok(match, "expected an activate_vendor_invitation definition");
  return match[1];
}

// Every unqualified output-column name used as a column in a WHERE predicate.
// SET targets and INSERT column lists are not variable references and are
// not scanned.
function ambiguousWhereReferences(body: string) {
  const found: string[] = [];
  for (const statement of body.split(";")) {
    const where = statement.match(/\bWHERE\b([\s\S]*)/);
    if (!where) continue;
    for (const name of OUT_COLUMNS) {
      if (new RegExp(`(?<![\\w.])${name}\\b`).test(where[1])) found.push(name);
    }
  }
  return found;
}

const APPLIED_LINK_UPDATE = `UPDATE public.vendor_contacts
  SET person_id = v_person_id
  WHERE id = v_vendor_contact_id
    AND vendor_id = v_vendor_id
    AND person_id IS NULL;`;

const FIXED_LINK_UPDATE = `UPDATE public.vendor_contacts AS vc
  SET person_id = v_person_id
  WHERE vc.id = v_vendor_contact_id
    AND vc.vendor_id = v_vendor_id
    AND vc.person_id IS NULL;`;

test("the applied definition contains the ambiguous WHERE person_id the fix targets", () => {
  assert.deepEqual(ambiguousWhereReferences(functionBody(APPLIED)), ["person_id"]);
});

test("the replacement has no unqualified output-column name in any WHERE predicate", () => {
  assert.deepEqual(ambiguousWhereReferences(functionBody(FIXED)), []);
});

test("the only body change is alias-qualifying the vendor_contacts link statement", () => {
  const applied = functionBody(APPLIED);
  assert.ok(applied.includes(APPLIED_LINK_UPDATE));
  assert.ok(functionBody(FIXED).includes(FIXED_LINK_UPDATE));
  assert.equal(
    functionBody(FIXED),
    applied.replace(APPLIED_LINK_UPDATE, FIXED_LINK_UPDATE),
  );
});

test("signature, return shape, security context, owner and grants are unchanged", () => {
  const header = (sql: string) =>
    sql.match(/FUNCTION public\.activate_vendor_invitation\([\s\S]*?AS \$\$/)![0];
  assert.equal(header(FIXED), header(APPLIED));
  assert.match(header(FIXED), /SECURITY DEFINER\s*\nSET search_path TO pg_catalog/);

  const grants = (sql: string) => sql.slice(sql.lastIndexOf("$$;")).replace(/\s+/g, " ");
  assert.equal(
    grants(FIXED).replace(/ COMMIT; $/, ""),
    grants(APPLIED).trim(),
  );
  assert.doesNotMatch(FIXED, /TO (anon|authenticated)\b/);
});

test("only this function is replaced; no schema, RLS or resolver change", () => {
  assert.deepEqual(
    [...FIXED.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g)].map((m) => m[1]),
    ["activate_vendor_invitation"],
  );
  assert.doesNotMatch(FIXED, /CREATE TABLE|ALTER TABLE|DROP |CREATE POLICY|ALTER POLICY/);
  assert.doesNotMatch(FIXED, /FUNCTION public\.resolve_vendor_person_identity/);
});
