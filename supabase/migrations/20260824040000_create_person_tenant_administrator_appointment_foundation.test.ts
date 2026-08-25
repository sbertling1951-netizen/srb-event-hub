import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260824040000_create_person_tenant_administrator_appointment_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260824040000_person_tenant_administrator_appointment_foundation_rollback.sql",
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

test("linked rollback fixture installs the exact pending T8 definitions once", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("appointment is a retained, role-specific Person x Tenant lineage", () => {
  assert.match(
    SQL,
    /CREATE TABLE public\.person_tenant_administrator_appointments/,
  );
  assert.match(
    SQL,
    /person_id uuid NOT NULL REFERENCES public\.people\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    SQL,
    /tenant_id uuid NOT NULL REFERENCES public\.tenants\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    SQL,
    /UNIQUE \(person_id, tenant_id\)/,
  );
  assert.match(SQL, /appointment_basis = 'platform_appointment'/);
  assert.match(SQL, /activated_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(
    SQL,
    /is_active = true AND revoked_at IS NULL[\s\S]*?is_active = false AND revoked_at IS NOT NULL/,
  );
  assert.match(
    SQL,
    /ALTER TABLE public\.person_tenant_administrator_appointments ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.person_tenant_administrator_appointments\s+FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(
    SQL,
    /GRANT [^;]+ ON TABLE public\.person_tenant_administrator_appointments/,
  );
});

test("appointment audit is append-only, bounded, and inaccessible through raw tables", () => {
  for (const action of ["appointed", "revoked", "reactivated", "unchanged"]) {
    assert.match(SQL, new RegExp(`'${action}'`));
  }
  assert.match(SQL, /reason text CHECK \(reason IS NULL OR length\(reason\) <= 500\)/);
  assert.match(
    SQL,
    /appointment_id IS NOT NULL OR action = 'unchanged'/,
  );
  assert.match(
    SQL,
    /BEFORE UPDATE OR DELETE ON public\.person_tenant_administrator_appointment_audit/,
  );
  assert.match(
    SQL,
    /RAISE EXCEPTION 'person_tenant_administrator_appointment_audit is immutable'/,
  );
  assert.match(
    SQL,
    /ALTER TABLE public\.person_tenant_administrator_appointment_audit ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.person_tenant_administrator_appointment_audit\s+FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(
    SQL,
    /GRANT [^;]+ ON TABLE public\.person_tenant_administrator_appointment_audit/,
  );
});

test("T8 commands use Platform authority and exact canonical identity only", () => {
  const set = functionBody(SQL, "set_person_tenant_administrator_appointment");
  const list = functionBody(
    SQL,
    "list_person_tenant_administrator_appointments_for_administration",
  );
  const audit = functionBody(
    SQL,
    "list_person_tenant_administrator_appointment_audit_for_administration",
  );
  const executableSet = set.replace(/^\s*--.*$/gm, "");

  for (const body of [set, list, audit]) {
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path TO 'pg_catalog'/);
    assert.match(body, /_require_platform_admin_actor\(\)/);
  }

  assert.match(set, /JOIN public\.person_auth_accounts AS paa/);
  assert.match(set, /paa\.status = 'active'/);
  assert.match(set, /paa\.is_primary = true/);
  assert.match(set, /JOIN auth\.users AS u ON u\.id = paa\.auth_user_id/);
  assert.match(set, /JOIN public\.admin_users AS au/);
  assert.match(set, /au\.user_id = u\.id/);
  assert.match(set, /au\.is_active = true/);
  assert.match(set, /p\.status = 'active'/);
  assert.match(set, /v_canonical_identity_count <> 1/);
  assert.match(
    set,
    /Person does not have exactly one active canonical Administrator identity/,
  );
  for (const forbidden of [
    "person_identifiers",
    "admin_tenant_access",
    "email",
    "display_name",
    "membership",
  ]) {
    assert.doesNotMatch(
      executableSet,
      new RegExp(forbidden),
      `${forbidden} cannot be Person appointment evidence`,
    );
  }
});

test("lifecycle is retained, deterministic, and writes immutable evidence", () => {
  const set = functionBody(SQL, "set_person_tenant_administrator_appointment");

  assert.match(set, /IF NOT FOUND AND p_is_active THEN/);
  assert.match(set, /v_action := 'appointed'/);
  assert.match(set, /ELSIF v_before\.is_active = p_is_active THEN/);
  assert.match(set, /v_action := 'unchanged'/);
  assert.match(set, /SET is_active = true,[\s\S]*?revoked_at = NULL/);
  assert.match(set, /v_action := 'reactivated'/);
  assert.match(set, /SET is_active = false,[\s\S]*?revoked_at = now\(\)/);
  assert.match(set, /v_action := 'revoked'/);
  assert.match(
    set,
    /INSERT INTO public\.person_tenant_administrator_appointment_audit/,
  );
  assert.doesNotMatch(set, /DELETE FROM public\./);
  assert.doesNotMatch(
    set,
    /UPDATE public\.(?:people|admin_users|admin_tenant_access|events)/,
  );
});

test("the T8 substrate is explicitly parallel and cannot alter live authority or Event ownership", () => {
  const stripped = SQL.replace(/^--.*$/gm, "");
  for (const forbidden of [
    "CREATE OR REPLACE FUNCTION public.has_tenant_admin_authority",
    "CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority",
    "CREATE OR REPLACE FUNCTION public.has_event_admin_authority",
    "CREATE OR REPLACE FUNCTION public.resolve_task_authority",
    "ALTER TABLE public.events",
    "INSERT INTO public.events",
    "UPDATE public.events",
    "DELETE FROM public.events",
    "INSERT INTO public.admin_tenant_access",
    "UPDATE public.admin_tenant_access",
    "DELETE FROM public.admin_tenant_access",
  ]) {
    assert.equal(stripped.includes(forbidden), false, `${forbidden} is out of scope`);
  }
  assert.match(
    SQL,
    /parallel, non-authoritative durable affiliation and history model/,
  );
  assert.match(
    SQL,
    /admin_tenant_access remains the sole live Tenant-Admin authority source/,
  );
});

test("T8 functions are postgres-owned, closed to anon, and only callable by authenticated", () => {
  const publicFunctions = [
    "set_person_tenant_administrator_appointment\\(uuid, uuid, boolean, text\\)",
    "list_person_tenant_administrator_appointments_for_administration\\(uuid\\)",
    "list_person_tenant_administrator_appointment_audit_for_administration\\(uuid, integer\\)",
  ];

  for (const signature of publicFunctions) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${signature}`));
    assert.match(
      SQL,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`,
      ),
    );
    assert.match(
      SQL,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO authenticated;`,
      ),
    );
  }
  assert.doesNotMatch(SQL, /GRANT EXECUTE[^;]+TO anon/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE[^;]+TO service_role/);
});

test("the appointment-audit client RPC uses PostgreSQL's applied catalog identifier", () => {
  assert.match(
    TENANT_ADMINISTRATION_CLIENT,
    /list_person_tenant_administrator_appointment_audit_for_administ/,
  );
  assert.doesNotMatch(
    TENANT_ADMINISTRATION_CLIENT,
    /list_person_tenant_administrator_appointment_audit_for_administration/,
  );
});

test("linked fixture covers canonical identity denial, lifecycle, non-authority, audit, and rollback", () => {
  for (const evidence of [
    "active canonical Person can be appointed only by Platform Administrator",
    "absent canonical Person identity fails closed",
    "ambiguous canonical Person identity fails closed",
    "conflicting canonical Person identity fails closed",
    "direct Event Admin cannot manage a Tenant appointment",
    "authenticated non-Platform caller cannot manage a Tenant appointment",
    "anon has no appointment execution surface",
    "revocation retains the appointment lineage and immutable evidence",
    "reactivation reuses the retained appointment lineage without duplication",
    "inactive Tenant retains the parallel appointment but receives no authority",
    "appointment lifecycle does not change legacy Tenant authority",
    "appointment lifecycle does not change Event authority or Event ownership",
    "raw authenticated Event INSERT remains closed",
    "audit UPDATE is blocked even for table owner execution",
    "audit DELETE is blocked even for table owner execution",
    "forced audit failure rolls back the appointment mutation in the same transaction",
    "pre-existing canonical authority definitions remain byte/value-equivalent",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
