import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260824030000_create_governed_event_provisioning.sql", import.meta.url),
  ),
  "utf8",
);

const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260824030000_governed_event_provisioning_rollback.sql",
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
  const end = source.indexOf(`ALTER FUNCTION public.${name}`, start);
  assert.notEqual(end, -1, `missing ${name} ownership declaration`);
  return source.slice(start, end);
}

const CREATE = functionBody(SQL, "create_event_for_tenant");

test("linked rollback fixture installs the exact pending T5 definitions once", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("create_event_for_tenant exposes one narrow typed contract", () => {
  const signature = CREATE.slice(0, CREATE.indexOf("RETURNS TABLE"));
  assert.match(
    signature,
    /create_event_for_tenant\(\s*p_tenant_id uuid,\s*p_name text,\s*p_end_date date,\s*p_timezone text,\s*p_start_date date DEFAULT NULL,\s*p_location text DEFAULT NULL,\s*p_event_code text DEFAULT NULL,\s*p_lat numeric DEFAULT NULL,\s*p_lng numeric DEFAULT NULL\s*\)/,
  );
  assert.doesNotMatch(signature, /jsonb|p_status|p_is_active|p_visible|p_lifecycle|p_created|p_actor/);
  assert.match(CREATE, /RETURNS TABLE\([\s\S]*?tenant_id uuid,[\s\S]*?lifecycle_state text,[\s\S]*?created_at timestamp/);
});

test("the command uses canonical Tenant authority and active server-side Tenant resolution", () => {
  assert.match(CREATE, /v_actor_auth_user_id uuid := auth\.uid\(\)/);
  assert.match(CREATE, /au\.is_active = true/);
  assert.match(CREATE, /public\.has_tenant_admin_authority\(\s*v_actor_auth_user_id,\s*p_tenant_id\s*\)/);
  assert.match(CREATE, /FROM public\.tenants AS t[\s\S]*?WHERE t\.id = p_tenant_id[\s\S]*?FOR SHARE/);
  assert.match(CREATE, /v_tenant_is_active IS DISTINCT FROM true/);
  assert.doesNotMatch(CREATE, /has_event_admin_authority|has_event_task_authority|admin_event_access/);
});

test("ownership and lifecycle/system state cannot be caller-controlled", () => {
  assert.match(CREATE, /INSERT INTO public\.events \([\s\S]*?tenant_id,[\s\S]*?\) VALUES \([\s\S]*?p_tenant_id,/);
  assert.match(CREATE, /'Draft',\s*false,\s*false/);
  assert.doesNotMatch(CREATE, /UPDATE public\.events|DELETE FROM public\.events/);
  assert.doesNotMatch(CREATE, /INSERT INTO public\.admin_event_access/);
});

test("required fields, dates, coordinates, and IANA timezone are validated server-side", () => {
  assert.match(CREATE, /IF v_name IS NULL/);
  assert.match(CREATE, /IF p_end_date IS NULL/);
  assert.match(CREATE, /p_end_date < p_start_date/);
  assert.match(CREATE, /FROM pg_timezone_names AS tz/);
  assert.match(CREATE, /\(p_lat IS NULL\) <> \(p_lng IS NULL\)/);
  assert.match(CREATE, /p_lat < -90 OR p_lat > 90/);
  assert.match(CREATE, /p_lng < -180 OR p_lng > 180/);
});

test("Event code uses the established normalized identity and a collision lock", () => {
  assert.match(CREATE, /pg_advisory_xact_lock/);
  assert.match(CREATE, /lower\(btrim\(e\.event_code\)\) = lower\(v_event_code\)/);
  assert.match(CREATE, /Event code is already in use/);
});

test("successful creation writes one bounded immutable audit row atomically", () => {
  assert.match(SQL, /CREATE TABLE public\.event_definition_command_audit/);
  assert.match(SQL, /action text NOT NULL CHECK \(action = 'event_created'\)/);
  assert.match(CREATE, /INSERT INTO public\.event_definition_command_audit/);
  assert.match(CREATE, /actor_auth_user_id,[\s\S]*?actor_admin_user_id/);
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON public\.event_definition_command_audit/);
  assert.match(SQL, /event_definition_command_audit is immutable/);
  assert.match(SQL, /ENABLE ROW LEVEL SECURITY/);
  assert.match(SQL, /REVOKE ALL ON TABLE public\.event_definition_command_audit\s+FROM PUBLIC, anon, authenticated, service_role/);
});

test("the RPC is postgres-owned, search-path hardened, and authenticated-only", () => {
  assert.match(CREATE, /SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
  assert.match(SQL, /ALTER FUNCTION public\.create_event_for_tenant\([\s\S]*?\) OWNER TO postgres/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.create_event_for_tenant\([\s\S]*?FROM PUBLIC, anon, service_role/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.create_event_for_tenant\([\s\S]*?TO authenticated/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?create_event_for_tenant[\s\S]*?TO anon/);
});

test("T5 does not open raw Event INSERT or create unrelated domain state", () => {
  assert.doesNotMatch(SQL, /CREATE POLICY[\s\S]*?ON public\.events[\s\S]*?FOR INSERT/);
  assert.doesNotMatch(SQL, /GRANT INSERT ON (?:TABLE )?public\.events/);
  assert.doesNotMatch(
    CREATE,
    /INSERT INTO public\.(?:admin_event_access|admin_tenant_access|admin_users|people|attendees|vendors|event_map_settings|nearby_area_templates)/,
  );
});

test("fixture covers authority, lifecycle, ownership, payload, side effects, audit, and raw INSERT denial", () => {
  for (const evidence of [
    "Platform authority can provision",
    "Tenant Admin can create only",
    "direct Event Admin cannot create",
    "ordinary authenticated Admin is denied",
    "inactive Admin is denied",
    "inactive target Tenant is denied",
    "anonymous caller cannot execute",
    "T0 prevents post-creation Tenant transfer",
    "authenticated Platform client cannot bypass",
    "zero Event-dependent side effects",
    "manufactures no Admin User",
    "Event creation audit UPDATE is blocked",
    "Event creation audit DELETE is blocked",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
