import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260824020000_create_governed_tenant_administration_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260824020000_tenant_administration_foundation_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const endMarker = "-- PARITY END";
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end + endMarker.length).trim();
}

function functionBody(source: string, name: string) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  const owner = source.indexOf("ALTER FUNCTION public.", start + 1);
  const candidates = [next, owner].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("linked rollback fixture installs the exact pending T3 definitions once", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("Tenant administration audit is bounded, immutable, and browser-inaccessible", () => {
  for (const action of [
    "tenant_created",
    "tenant_metadata_updated",
    "tenant_activated",
    "tenant_deactivated",
    "tenant_status_unchanged",
    "tenant_admin_assigned",
    "tenant_admin_reactivated",
    "tenant_admin_revoked",
    "tenant_admin_access_unchanged",
    "hostname_mapping_created",
    "hostname_mapping_activated",
    "hostname_mapping_deactivated",
    "hostname_mapping_status_unchanged",
  ]) {
    assert.match(SQL, new RegExp(`'${action}'`));
  }

  assert.match(
    SQL,
    /BEFORE UPDATE OR DELETE ON public\.tenant_administration_audit/,
  );
  assert.match(SQL, /RAISE EXCEPTION 'tenant_administration_audit is immutable'/);
  assert.match(SQL, /ALTER TABLE public\.tenant_administration_audit ENABLE ROW LEVEL SECURITY/);
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.tenant_administration_audit\s+FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(SQL, /GRANT [^;]+ ON TABLE public\.tenant_administration_audit/);
});

test("every T3 read and command surface requires canonical Platform authority", () => {
  for (const name of [
    "_require_platform_admin_actor",
    "list_tenants_for_administration",
    "get_tenant_for_administration",
    "list_tenant_hostname_mappings_for_administration",
    "list_tenant_admin_assignments_for_administration",
    "list_tenant_owned_events_for_administration",
    "list_tenant_administration_audit",
    "create_tenant_for_administration",
    "update_tenant_metadata_for_administration",
    "set_tenant_active_status",
    "add_tenant_hostname_mapping",
    "set_tenant_hostname_mapping_active_status",
    "set_tenant_admin_access",
    "list_tenant_admin_access",
  ]) {
    const body = functionBody(SQL, name);
    assert.match(
      body,
      /has_platform_admin_authority\(auth\.uid\(\)\)|_require_platform_admin_actor\(\)/,
      `${name} must use canonical Platform authority`,
    );
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path TO 'pg_catalog'/);
  }
});

test("Tenant creation is mechanically inactive-first and creates no related records", () => {
  const body = functionBody(SQL, "create_tenant_for_administration");
  const signature = body.slice(0, body.indexOf("RETURNS public.tenants"));

  assert.doesNotMatch(signature, /p_is_active/);
  assert.match(
    body,
    /accent_color,\s+is_active,\s+tenant_type_id,[\s\S]*?nullif\(btrim\(p_accent_color\), ''\),\s+false,\s+p_tenant_type_id/,
  );
  assert.match(body, /'tenant_created'/);
  assert.match(body, /auth\.uid\(\)/);
  assert.doesNotMatch(
    body,
    /INSERT INTO public\.(?:events|admin_tenant_access|tenant_hostname_mappings|people)/,
  );
});

test("Tenant metadata patch uses the exact presentation and configuration allowlist", () => {
  const body = functionBody(SQL, "update_tenant_metadata_for_administration");
  const approved = [
    "organization_name",
    "display_name",
    "app_title",
    "app_tagline",
    "logo_url",
    "favicon_url",
    "primary_color",
    "secondary_color",
    "accent_color",
    "tenant_type_id",
    "post_event_edit_window_days",
  ];

  for (const field of approved) {
    assert.match(body, new RegExp(`'${field}'`));
    assert.match(body, new RegExp(`p_patch \\? '${field}'`));
  }
  for (const excluded of [
    "id",
    "organization_code",
    "slug",
    "is_active",
    "created_at",
  ]) {
    assert.doesNotMatch(
      body,
      new RegExp(`p_patch \\? '${excluded}'`),
      `${excluded} must not be writable`,
    );
  }
  assert.match(body, /Tenant metadata patch contains disallowed fields/);
  assert.match(body, /ELSE t\.app_title/);
  assert.match(body, /ELSE t\.post_event_edit_window_days/);
});

test("Tenant lifecycle command is explicit, idempotent, and preserves owned records", () => {
  const body = functionBody(SQL, "set_tenant_active_status");

  assert.match(body, /IF v_before\.is_active = p_is_active THEN/);
  assert.match(body, /v_action := 'tenant_status_unchanged'/);
  assert.match(body, /WHEN p_is_active THEN 'tenant_activated'/);
  assert.match(body, /ELSE 'tenant_deactivated'/);
  assert.match(body, /SET is_active = p_is_active/);
  assert.doesNotMatch(body, /DELETE FROM public\./);
  assert.doesNotMatch(body, /UPDATE public\.(?:events|admin_tenant_access|tenant_hostname_mappings|people)/);
});

test("hostname governance validates new aliases and only toggles retained status", () => {
  const add = functionBody(SQL, "add_tenant_hostname_mapping");
  const status = functionBody(
    SQL,
    "set_tenant_hostname_mapping_active_status",
  );

  assert.match(add, /v_hostname := lower\(btrim/);
  assert.match(add, /Hostname must be a valid DNS hostname/);
  assert.match(add, /INSERT INTO public\.tenant_hostname_mappings/);
  assert.match(add, /'hostname_mapping_created'/);
  assert.match(status, /IF v_before\.is_active = p_is_active THEN/);
  assert.match(status, /SET is_active = p_is_active/);
  assert.doesNotMatch(status, /SET[\s\S]*?tenant_id\s*=/);
  assert.doesNotMatch(status, /DELETE FROM public\.tenant_hostname_mappings/);
});

test("Tenant Admin compatibility RPC keeps one row and replaces caller text with authenticated evidence", () => {
  const setAccess = functionBody(SQL, "set_tenant_admin_access");
  const listAccess = functionBody(SQL, "list_tenant_admin_access");

  assert.match(
    setAccess,
    /p_admin_user_id uuid,\s+p_tenant_id uuid,\s+p_is_active boolean,\s+p_granted_by text DEFAULT NULL/,
  );
  assert.equal((setAccess.match(/p_granted_by/g) || []).length, 1);
  assert.match(setAccess, /auth\.uid\(\)::text/);
  assert.match(setAccess, /IF v_before\.is_active = p_is_active THEN/);
  assert.match(setAccess, /'tenant_admin_access_unchanged'/);
  assert.match(setAccess, /'tenant_admin_reactivated'/);
  assert.match(setAccess, /'tenant_admin_revoked'/);
  assert.doesNotMatch(setAccess, /DELETE FROM public\.admin_tenant_access/);
  assert.match(listAccess, /p_tenant_id IS NULL OR ata\.tenant_id = p_tenant_id/);
  assert.doesNotMatch(listAccess, /ata\.is_active = true/);
});

test("Platform inspection surfaces include inactive assignments and exact Tenant-owned Events", () => {
  const assignments = functionBody(
    SQL,
    "list_tenant_admin_assignments_for_administration",
  );
  const events = functionBody(SQL, "list_tenant_owned_events_for_administration");

  assert.match(assignments, /WHERE ata\.tenant_id = p_tenant_id/);
  assert.doesNotMatch(assignments, /ata\.is_active = true/);
  assert.match(events, /WHERE e\.tenant_id = p_tenant_id/);
  assert.doesNotMatch(events, /UPDATE public\.events|INSERT INTO public\.events|DELETE FROM public\.events/);
  assert.doesNotMatch(SQL, /transfer_tenant|transfer_event|set_event_tenant/);
});

test("T3 functions are postgres-owned, revoked broadly, and granted only to authenticated", () => {
  const publicFunctions = [
    "list_tenants_for_administration",
    "get_tenant_for_administration",
    "list_tenant_hostname_mappings_for_administration",
    "list_tenant_admin_assignments_for_administration",
    "list_tenant_owned_events_for_administration",
    "list_tenant_administration_audit",
    "create_tenant_for_administration",
    "update_tenant_metadata_for_administration",
    "set_tenant_active_status",
    "add_tenant_hostname_mapping",
    "set_tenant_hostname_mapping_active_status",
    "set_tenant_admin_access",
    "list_tenant_admin_access",
  ];

  for (const name of publicFunctions) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${name}\\(`));
    assert.match(
      SQL,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`,
      ),
    );
    assert.match(
      SQL,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO authenticated;`,
      ),
    );
  }

  assert.doesNotMatch(SQL, /GRANT EXECUTE[^;]+TO anon/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE[^;]+TO service_role/);
  assert.doesNotMatch(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\._require_platform_admin_actor/,
  );
  assert.doesNotMatch(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.prevent_tenant_administration_audit_mutation/,
  );
});

test("linked fixture covers authority, lifecycle, retained history, audit, and rollback", () => {
  for (const evidence of [
    "ordinary authenticated caller cannot list administrative Tenants",
    "anon has no Tenant administration execution surface",
    "metadata command exercises every approved field",
    "omitted metadata fields preserve their canonical values",
    "active hostname row does not make an inactive Tenant operational",
    "canonical hostname uniqueness blocks reassignment",
    "safe hostname removal deactivates the retained row",
    "Tenant Admin assignment stores authenticated actor identity",
    "revoked Tenant Admin assignment remains inspectable as retained history",
    "inactive Tenant freezes retained Tenant and Event authority",
    "activation restores public discovery through the retained Event",
    "deactivation preserves Event, assignment, and hostname records",
    "reactivation reuses all retained canonical records without duplication",
    "audit UPDATE is blocked even for table owner execution",
    "audit DELETE is blocked even for table owner execution",
    "pre-existing FCOC Tenant remains byte/value-equivalent and active",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});

test("T3 does not define UI, Event ownership mutation, or destructive Tenant commands", () => {
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.(?:delete|transfer)_/);
  assert.doesNotMatch(SQL, /DELETE FROM public\.(?:tenants|events|admin_tenant_access|tenant_hostname_mappings)/);
  assert.doesNotMatch(SQL, /UPDATE public\.events/);
  assert.doesNotMatch(SQL, /INSERT INTO public\.events/);
  assert.doesNotMatch(SQL, /CREATE POLICY/);
});
