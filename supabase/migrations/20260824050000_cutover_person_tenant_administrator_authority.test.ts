import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260824050000_cutover_person_tenant_administrator_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260824050000_person_tenant_administrator_authority_cutover_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const TENANT_ADMINISTRATION_CLIENT = readFileSync(
  "lib/tenantAdministration.ts",
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

function executable(source: string) {
  return source.replace(/^\s*--.*$/gm, "");
}

test("linked rollback fixture installs the exact pending T9 definitions once", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the transactional parity gate fails closed before authority replacement", () => {
  const gate = functionBody(SQL, "_assert_person_tenant_administrator_cutover_parity");
  const stripped = executable(gate);

  assert.match(SQL, /PERFORM public\._assert_person_tenant_administrator_cutover_parity\(\);/);
  assert.match(gate, /FROM public\.admin_tenant_access AS ata/);
  assert.match(gate, /FROM public\.person_tenant_administrator_appointments AS ptaa/);
  assert.match(gate, /paa\.status = 'active'/);
  assert.match(gate, /paa\.is_primary = true/);
  assert.match(gate, /p\.status = 'active'/);
  assert.match(gate, /au\.is_active/);
  assert.match(gate, /ptaa\.tenant_id = ata\.tenant_id/);
  assert.match(gate, /<> 1/);
  assert.match(gate, /T9 Person-backed Tenant Administrator parity gate failed/);
  for (const forbidden of [
    "INSERT INTO public.",
    "UPDATE public.",
    "DELETE FROM public.",
    "person_identifiers",
    "membership",
  ]) {
    assert.equal(stripped.includes(forbidden), false, `${forbidden} is forbidden in parity`);
  }
});

test("ordinary Tenant authority derives only from the exact canonical appointment chain", () => {
  for (const name of ["has_tenant_admin_authority", "has_any_tenant_admin_authority"]) {
    const body = executable(functionBody(SQL, name));
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path TO 'pg_catalog'/);
    assert.match(body, /has_platform_admin_authority/);
    assert.match(body, /person_tenant_administrator_appointments/);
    assert.match(body, /person_auth_accounts/);
    assert.match(body, /paa\.status = 'active'/);
    assert.match(body, /paa\.is_primary = true/);
    assert.match(body, /p\.status = 'active'/);
    assert.match(body, /exact_au\.is_active/);
    assert.match(body, /t\.is_active/);
    assert.equal(body.includes("admin_tenant_access"), false, `${name} cannot retain legacy authority`);
  }
});

test("self-scoped Tenant discovery has the same single source and preserves Platform behavior", () => {
  const body = executable(functionBody(SQL, "list_my_tenant_admin_access"));
  assert.match(body, /v_uid := auth\.uid\(\)/);
  assert.match(body, /has_platform_admin_authority\(v_uid\)/);
  assert.match(body, /person_tenant_administrator_appointments/);
  assert.match(body, /ORDER BY t\.display_name, t\.id/);
  assert.equal(body.includes("admin_tenant_access"), false);
  assert.equal(body.includes("p_tenant_id"), false);
});

test("T3 uses Person-backed candidates and appointment reads while effective counts use the new source", () => {
  const listTenants = executable(functionBody(SQL, "list_tenants_for_administration"));
  const candidates = executable(
    functionBody(SQL, "list_eligible_person_tenant_administrator_candidates_for_administration"),
  );
  const appointments = executable(
    functionBody(SQL, "list_tenant_administrator_appointments_for_administration"),
  );

  assert.match(listTenants, /person_tenant_administrator_appointments/);
  assert.match(listTenants, /t\.is_active/);
  assert.equal(listTenants.includes("admin_tenant_access"), false);
  for (const body of [candidates, appointments]) {
    assert.match(body, /_require_platform_admin_actor\(\)/);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path TO 'pg_catalog'/);
  }
  assert.match(candidates, /canonical_identity_count = 1/);
  assert.match(candidates, /paa\.status = 'active'/);
  assert.match(candidates, /paa\.is_primary = true/);
  assert.equal(candidates.includes("person_identifiers"), false);
  assert.equal(candidates.includes("admin_tenant_access"), false);
  assert.match(appointments, /is_effective/);
  assert.match(appointments, /identity\.admin_user_id IS NOT NULL/);
});

test("the eligible-Person client RPC uses PostgreSQL's applied catalog identifier", () => {
  assert.match(
    TENANT_ADMINISTRATION_CLIENT,
    /list_eligible_person_tenant_administrator_candidates_for_admini/,
  );
  assert.doesNotMatch(
    TENANT_ADMINISTRATION_CLIENT,
    /list_eligible_person_tenant_administrator_candidates_for_administration/,
  );
});

test("the legacy assignment writer is retired, non-executable, and cannot become a compatibility authority path", () => {
  const body = executable(functionBody(SQL, "set_tenant_admin_access"));
  assert.match(body, /_require_platform_admin_actor\(\)/);
  assert.match(body, /is retired; use the governed Person-backed appointment command/);
  assert.doesNotMatch(body, /INSERT INTO public\.admin_tenant_access/);
  assert.doesNotMatch(body, /UPDATE public\.admin_tenant_access/);
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.set_tenant_admin_access\(uuid, uuid, boolean, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.set_tenant_admin_access\(uuid, uuid, boolean, text\)/,
  );
});

test("owners, search paths, and grants preserve the intended authenticated-only surface", () => {
  for (const signature of [
    "has_tenant_admin_authority\\(uuid, uuid\\)",
    "has_any_tenant_admin_authority\\(\\)",
    "list_my_tenant_admin_access\\(\\)",
    "list_tenants_for_administration\\(\\)",
    "list_eligible_person_tenant_administrator_candidates_for_administration\\(\\)",
    "list_tenant_administrator_appointments_for_administration\\(uuid\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${signature}`));
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`),
    );
  }
  assert.doesNotMatch(SQL, /GRANT EXECUTE[^;]+TO anon/);
});

test("fixture proves parity failures, one-source authority, lifecycle, T3/T5/T6, RLS, and rollback", () => {
  for (const evidence of [
    "parity gate rejects missing Person linkage",
    "parity gate rejects nonexact canonical identity",
    "parity gate rejects missing appointment",
    "parity gate rejects wrong-Tenant appointment",
    "parity gate rejects revoked appointment",
    "parity gate rejects unmatched active appointment",
    "valid Person-backed Tenant Admin has exact Tenant and T6 discovery authority",
    "Tenant appointment dynamically inherits only same-Tenant Event authority",
    "Tenant appointment reaches unchanged tenant-inherited task authority",
    "T5 creation keeps explicit Tenant ownership and inherits Event administration",
    "legacy-only Tenant Admin has no authority after cutover",
    "direct Event Admin remains Event-only",
    "inactive Admin is denied despite retained appointment and legacy row",
    "inactive Person is denied despite retained appointment and legacy row",
    "raw authenticated Event INSERT remains closed",
    "T3 appointment reads use canonical Person identity only",
    "appointment lifecycle never mutates legacy assignments, duplicates lineage, or omits audit evidence",
    "multi-Tenant authority is independently derived per appointment",
    "revoked appointment denies ordinary authority",
    "reactivation restores derived ordinary authority",
    "inactive Tenant denies ordinary appointment authority",
    "Platform recovery remains independent and T6 list stays active-Tenant scoped",
    "retired legacy setter has no authenticated execution surface",
    "anonymous caller has no Tenant authority execution surface",
    "pre-existing legacy evidence remains byte/value-equivalent",
    "pre-existing Event rows remain byte/value-equivalent",
    "no fixture Event ownership is copied or reassigned",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
