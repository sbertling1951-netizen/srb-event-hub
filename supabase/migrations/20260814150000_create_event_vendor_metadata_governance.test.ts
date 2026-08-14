import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Event-Vendor Metadata Governance
// Bridge migration. This migration creates one SECURITY DEFINER RPC --
// its authority usage, allowlist enforcement, and lifecycle-column
// protection are all provable from its SQL text. Live proofs (authority
// resolution, partial-update/null-clearing semantics, concurrency,
// lifecycle/intelligence non-interference, zero residue) were
// independently verified against the linked database and are reported
// separately, not re-asserted here.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814150000_create_event_vendor_metadata_governance.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814150000_create_event_vendor_metadata_governance.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

const ALLOWED_FIELDS = [
  "is_featured", "is_visible_to_members", "action_type", "signup_url",
  "display_order", "event_note", "booth_location", "show_on_member_dashboard",
  "allow_service_requests", "notes",
];

const LIFECYCLE_COLUMNS = [
  "application_id", "admission_state", "admitted_at",
  "admitted_by_auth_user_id", "admitted_by_admin_user_id",
  "admission_authority_basis", "current_disposition_id",
];

function functionBody(): string {
  const m = executableSql.match(/CREATE OR REPLACE FUNCTION public\.update_event_vendor_metadata\([\s\S]*?\$\$;/);
  assert.ok(m, "function body not found");
  return m[0];
}

test("statement is wrapped in a single transaction", () => {
  assert.match(executableSql.trim(), /^BEGIN;/);
  assert.match(executableSql.trim(), /COMMIT;$/);
});

test("creates exactly one function", () => {
  const creates = executableSql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
  assert.deepEqual(creates, ["CREATE OR REPLACE FUNCTION public.update_event_vendor_metadata"]);
});

test("is SECURITY DEFINER with a fixed, safe search_path", () => {
  const body = functionBody();
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
});

test("owned by postgres, no anon/service_role/PUBLIC EXECUTE, explicit authenticated grant", () => {
  assert.match(executableSql, /ALTER FUNCTION public\.update_event_vendor_metadata\(uuid, uuid, jsonb\) OWNER TO postgres;/);
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.update_event_vendor_metadata\(uuid, uuid, jsonb\) FROM PUBLIC;/);
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.update_event_vendor_metadata\(uuid, uuid, jsonb\) FROM anon;/);
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.update_event_vendor_metadata\(uuid, uuid, jsonb\) FROM service_role;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.update_event_vendor_metadata\(uuid, uuid, jsonb\) TO authenticated;/);
});

test("uses canonical event.vendors.manage authority -- not is_active_admin, not has_vendor_catalog_admin_authority", () => {
  const body = functionBody();
  assert.match(body, /has_event_task_authority\('event\.vendors\.manage', p_event_id\)/);
  assert.equal(/is_active_admin/.test(body), false);
  assert.equal(/has_vendor_catalog_admin_authority/.test(body), false);
});

test("no Tenant ID or authority-basis parameter is accepted", () => {
  const body = functionBody();
  assert.equal(/p_tenant_id/.test(body), false);
  assert.equal(/p_authority_basis/.test(body), false);
  assert.equal(/authority_basis/.test(body), false, "this RPC never writes an authority-provenance column, so none should be referenced");
});

test("structurally rejects any key outside the ten-field allowlist before any row is touched", () => {
  const body = functionBody();
  assert.match(body, /jsonb_object_keys\(p_updates\)/);
  for (const field of ALLOWED_FIELDS) {
    assert.match(body, new RegExp(`'${field}'`), `allowlist must include ${field}`);
  }
  assert.match(body, /RAISE EXCEPTION 'unsupported_metadata_field/);
});

test("the UPDATE statement's SET list contains exactly the ten allowed columns and none of the seven lifecycle columns", () => {
  const body = functionBody();
  const updateMatch = body.match(/UPDATE public\.event_vendors AS ev\s*\n\s*SET\s*\n([\s\S]*?)\n\s*WHERE ev\.id = v_event_vendor_id/);
  assert.ok(updateMatch, "UPDATE statement not found");
  const setClause = updateMatch[1];

  for (const field of ALLOWED_FIELDS) {
    assert.match(setClause, new RegExp(`^\\s*${field} =`, "m"), `SET clause must assign ${field}`);
  }
  for (const col of LIFECYCLE_COLUMNS) {
    assert.equal(new RegExp(`^\\s*${col} =`, "m").test(setClause), false, `SET clause must never assign lifecycle column ${col}`);
  }

  const assignedColumns = [...setClause.matchAll(/^\s*(\w+) =/gm)].map((m) => m[1]);
  assert.equal(assignedColumns.length, ALLOWED_FIELDS.length, "SET clause must assign exactly the ten allowed columns, nothing more");
});

test("every CASE branch falls through to the column's own current value when the key is omitted (leave-unchanged semantics)", () => {
  const body = functionBody();
  for (const field of ALLOWED_FIELDS) {
    assert.match(
      body,
      new RegExp(`${field} = CASE WHEN p_updates \\? '${field}'[\\s\\S]*?ELSE ev\\.${field} END`),
      `${field} must fall through to ev.${field} when omitted`,
    );
  }
});

test("free-text fields normalize empty string to NULL via nullif/btrim, matching prior UI behavior", () => {
  const body = functionBody();
  for (const field of ["signup_url", "event_note", "booth_location", "notes"]) {
    assert.match(body, new RegExp(`nullif\\(btrim\\(p_updates ->> '${field}'\\), ''\\)`));
  }
});

test("action_type is explicitly validated against the three known values", () => {
  const body = functionBody();
  assert.match(body, /v_action_type NOT IN \('service_request', 'external_signup', 'info_only'\)/);
  assert.match(body, /RAISE EXCEPTION 'invalid_action_type'/);
});

test("fails closed if the event_vendor relationship does not exist, and never creates one", () => {
  const body = functionBody();
  assert.match(body, /RAISE EXCEPTION 'event_vendor_relationship_not_found'/);
  assert.equal(/INSERT INTO public\.event_vendors/.test(body), false);
});

test("locks the target row FOR UPDATE before mutating it (concurrency)", () => {
  const body = functionBody();
  assert.match(body, /FROM public\.event_vendors AS ev\s*\n\s*WHERE ev\.vendor_id = p_vendor_id AND ev\.event_id = p_event_id\s*\n\s*FOR UPDATE;/);
});

test("never references vendor_event_applications, vendor_event_dispositions, or public.vendors in executable code", () => {
  const body = functionBody().replace(/^\s*--.*$/gm, "");
  assert.equal(/vendor_event_applications/.test(body), false);
  assert.equal(/vendor_event_dispositions/.test(body), false);
  assert.equal(/public\.vendors\b/.test(body), false);
  assert.equal(/UPDATE public\.vendors\b/.test(body), false);
});

test("no direct table GRANT is issued anywhere -- only a function EXECUTE grant", () => {
  assert.equal(/GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\s/.test(executableSql), false);
  assert.equal(/ON TABLE public\./.test(executableSql), false);
});

test("no RLS policy or schema change is touched", () => {
  assert.equal(/CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE/.test(executableSql), false);
});
