import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260824010000_enforce_inactive_tenant_operational_freeze.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260824010000_inactive_tenant_operational_freeze_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BROWSER_AUTHORITY = readFileSync(
  `${ROOT}lib/getCurrentAdminAccess.ts`,
  "utf8",
);
const SERVER_AUTHORITY = readFileSync(`${ROOT}lib/server/adminAuthz.ts`, "utf8");
const VENDOR_INVITATIONS = readFileSync(
  `${ROOT}app/api/admin/vendors/invitations/route.ts`,
  "utf8",
);
const TENANT_RESOLVER = readFileSync(
  `${ROOT}lib/server/tenantResolver.ts`,
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
  const policy = source.indexOf("CREATE POLICY ", start + 1);
  const owner = source.indexOf("ALTER FUNCTION public.", start + 1);
  const candidates = [next, policy, owner].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function sourceFunctionBody(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}`) >= 0
    ? source.indexOf(`export async function ${name}`)
    : source.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `missing source function ${name}`);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, `unterminated source function ${name}`);
  return source.slice(start, end + 2);
}

test("linked rollback fixture installs the exact pending T2 definitions", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.match(FIXTURE, /^BEGIN;/m);
  assert.match(FIXTURE, /^ROLLBACK;/m);
});

test("Tenant and coarse route authority require an active exact Tenant for non-Platform admins", () => {
  const tenant = functionBody(SQL, "has_tenant_admin_authority");
  const anyTenant = functionBody(SQL, "has_any_tenant_admin_authority");

  for (const body of [tenant, anyTenant]) {
    assert.match(body, /JOIN public\.tenants AS t ON t\.id = ata\.tenant_id/);
    assert.match(body, /AND t\.is_active = true/);
    assert.match(body, /JOIN public\.admin_users AS au ON au\.id = ata\.admin_user_id/);
    assert.match(body, /AND au\.is_active = true/);
    assert.match(body, /AND ata\.is_active = true/);
  }

  assert.match(tenant, /AND ata\.tenant_id = p_tenant_id/);
  assert.ok(
    tenant.indexOf("has_platform_admin_authority") <
      tenant.indexOf("JOIN public.tenants"),
    "Platform recovery must short-circuit before ordinary Tenant activity",
  );
});

test("Event authority blocks inactive owning Tenants before direct Event assignment", () => {
  const body = functionBody(SQL, "has_event_admin_authority");
  const platform = body.indexOf("has_platform_admin_authority");
  const tenantLookup = body.indexOf("JOIN public.tenants AS t");
  const inactiveDenial = body.indexOf(
    "v_tenant_is_active IS DISTINCT FROM true",
  );
  const directAssignment = body.indexOf("JOIN public.admin_event_access AS aea");

  assert.ok(platform >= 0 && platform < tenantLookup);
  assert.ok(tenantLookup < inactiveDenial && inactiveDenial < directAssignment);
  assert.match(body, /WHERE e\.id = p_event_id/);
  assert.match(body, /AND aea\.event_id = p_event_id/);
});

test("task authority preserves Platform recovery but blocks every ordinary branch for inactive Tenant", () => {
  const body = functionBody(SQL, "resolve_task_authority");
  const platform = body.indexOf("v_task.platform_inherits");
  const inactive = body.indexOf("v_tenant_is_active IS DISTINCT FROM true");
  const tenant = body.indexOf("v_task.tenant_inherits");
  const direct = body.indexOf("FROM public.admin_event_access AS aea");

  assert.match(body, /SELECT e\.tenant_id, t\.is_active/);
  assert.match(body, /denial_reason := 'inactive_tenant'/);
  assert.ok(platform >= 0 && platform < inactive);
  assert.ok(inactive < tenant && tenant < direct);
});

test("every accepted Event discovery and member-account read joins the owning Tenant activity boundary", () => {
  for (const name of [
    "get_public_discoverable_events",
    "get_public_discoverable_events_for_tenant",
    "get_event_continuity_context",
    "get_my_member_event_continuity_context",
    "get_tenant_owned_event_ids",
    "resolve_member_account",
  ]) {
    const body = functionBody(SQL, name);
    assert.match(body, /JOIN public\.tenants AS t ON t\.id = e\.tenant_id/);
    assert.match(body, /t\.is_active = true/);
  }
});

test("member login, identity resolution, and check-in fail before operational work for inactive Tenant", () => {
  for (const name of [
    "resolve_temporary_or_authenticated_attendee",
    "verify_member_event_login",
  ]) {
    const body = functionBody(SQL, name);
    assert.match(
      body,
      /IF NOT EXISTS \(\s*SELECT 1\s*FROM public\.events AS e\s*JOIN public\.tenants AS t ON t\.id = e\.tenant_id[\s\S]*?AND t\.is_active = true\s*\) THEN/,
    );
  }

  const checkin = functionBody(SQL, "submit_member_checkin");
  const tenantCheck = checkin.indexOf("JOIN public.tenants AS t");
  const evidenceWrite = checkin.indexOf("_record_member_site_report");
  const attendeeWrite = checkin.indexOf("UPDATE public.attendees AS a");
  assert.ok(tenantCheck >= 0 && tenantCheck < evidenceWrite);
  assert.ok(tenantCheck < attendeeWrite);
  assert.match(checkin, /AND t\.is_active = true/);
});

test("direct public Event-context RPCs apply the same outer Tenant boundary", () => {
  for (const name of [
    "get_event_public_map_sites",
    "resolve_effective_nearby_places",
    "resolve_effective_event_locations",
    "resolve_attendee_visible_vendor_notices",
    "read_public_presentation_session",
  ]) {
    const body = functionBody(SQL, name);
    assert.match(body, /JOIN public\.tenants AS t ON t\.id = e\.tenant_id/);
    assert.match(body, /t\.is_active = true/);
  }

  const presentation = functionBody(SQL, "read_public_presentation_session");
  assert.ok(
    presentation.indexOf("JOIN public.tenants AS t") <
      presentation.indexOf("advance_presentation_session_if_due_internal"),
    "inactive public presentation read must not advance state first",
  );
});

test("Platform gets a read-only inactive-Tenant recovery policy without Tenant writes", () => {
  assert.match(
    SQL,
    /CREATE POLICY "Platform administrators can read inactive tenants"\s*\nON public\.tenants\s*\nFOR SELECT\s*\nTO authenticated\s*\nUSING \(public\.has_platform_admin_authority\(auth\.uid\(\)\)\);/,
  );
  assert.equal((SQL.match(/CREATE POLICY /g) || []).length, 1);
  assert.equal(/UPDATE public\.tenants|DELETE FROM public\.tenants|INSERT INTO public\.tenants/.test(SQL), false);
});

test("T0 ownership immutability and Event lifecycle formulas are not rewritten", () => {
  assert.equal(/prevent_event_tenant_ownership_change/.test(SQL), false);
  assert.equal(/UPDATE public\.events|DELETE FROM public\.events|INSERT INTO public\.events/.test(SQL), false);
  assert.equal(/event_effective_lifecycle_state|lifecycle_state\s*=/.test(SQL), false);
  assert.equal(/admin_tenant_access\s+SET|DELETE FROM public\.admin_tenant_access/.test(SQL), false);
  assert.equal(/DELETE FROM public\.(?:people|person_event_participations|person_role_instances)/.test(SQL), false);
});

test("changed functions retain postgres ownership, bounded search_path, and least-privilege execution", () => {
  const changed = [
    ["has_tenant_admin_authority", "uuid, uuid"],
    ["has_any_tenant_admin_authority", ""],
    ["has_event_admin_authority", "uuid, uuid"],
    ["resolve_task_authority", "uuid, text, uuid"],
    ["get_public_discoverable_events", ""],
    ["get_public_discoverable_events_for_tenant", "uuid"],
    ["get_event_continuity_context", "uuid"],
    ["get_my_member_event_continuity_context", "uuid"],
    ["get_tenant_owned_event_ids", "uuid[], uuid"],
    ["resolve_member_account", ""],
    ["resolve_temporary_or_authenticated_attendee", "uuid, text, text"],
    ["verify_member_event_login", "uuid, text, text"],
    ["submit_member_checkin", "uuid, uuid, boolean, boolean, text, uuid, text, text"],
    ["get_event_public_map_sites", "uuid"],
    ["resolve_effective_nearby_places", "uuid"],
    ["resolve_effective_event_locations", "uuid"],
    ["resolve_attendee_visible_vendor_notices", "uuid"],
    ["read_public_presentation_session", "uuid"],
  ] as const;

  for (const [name, args] of changed) {
    assert.match(functionBody(SQL, name), /SET search_path TO '?pg_catalog'?/);
    assert.match(
      SQL,
      new RegExp(`ALTER FUNCTION public\\.${name}\\(${args.replace(/[\[\]]/g, "\\$&")}\\) OWNER TO postgres;`),
    );
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(${args.replace(/[\[\]]/g, "\\$&")}\\)[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`),
    );
  }

  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.has_event_admin_authority\(uuid, uuid\)\s*\n\s*TO authenticated, service_role;/,
  );
  for (const signature of [
    "has_tenant_admin_authority\\(uuid, uuid\\)",
    "has_any_tenant_admin_authority\\(\\)",
    "resolve_task_authority\\(uuid, text, uuid\\)",
  ]) {
    assert.doesNotMatch(
      SQL,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${signature}[^;]*?TO[^;]*?anon`,
      ),
    );
  }
});

test("browser, server, Vendor invitation, and hostname consumers inherit the canonical boundary", () => {
  const browser = sourceFunctionBody(BROWSER_AUTHORITY, "canAccessEvent");
  assert.match(browser, /admin\.eventIds\.includes\(eventId\)/);
  assert.doesNotMatch(browser, /tenant\.is_active|admin_tenant_access/i);
  assert.match(
    BROWSER_AUTHORITY,
    /supabase\.from\("events"\)\.select\("id"\)/,
  );

  const server = sourceFunctionBody(SERVER_AUTHORITY, "adminCanManageEvent");
  assert.match(server, /"has_event_admin_authority"/);
  assert.doesNotMatch(
    server,
    /admin_tenant_access|admin_event_access|tenant\.is_active/i,
  );

  assert.equal(
    (VENDOR_INVITATIONS.match(/adminCanManageEvent\(/g) || []).length,
    2,
    "invite and revoke must both use the server canonical predicate",
  );

  assert.match(TENANT_RESOLVER, /if \(!mapping\.is_active\)/);
  assert.match(TENANT_RESOLVER, /if \(!tenant\.is_active\)/);
  assert.match(TENANT_RESOLVER, /unresolvedTenant\("inactive_tenant", hostname\)/);
});

test("fixture proves active, frozen, Platform, member/public, isolation, and reactivation cases", () => {
  for (const evidence of [
    "active Tenant Admin authority works for its own Tenant",
    "direct Event and direct task grants cannot bypass the Tenant freeze",
    "browser effective Event list excludes the inactive-Tenant Event",
    "server canonical predicate denies inactive-Tenant direct Event authority",
    "global public discovery returns only visible Events of active Tenants",
    "member Event-code login denies inactive Tenant",
    "authenticated member continuity denies inactive Tenant",
    "inactive-Tenant member check-in unexpectedly succeeded",
    "Tenant B remains operational while Tenant C is inactive",
    "Platform recovery authority survives Tenant inactivity",
    "reactivation restores inherited authority from preserved assignment",
    "reactivation restores direct Event and task authority from preserved rows",
    "reactivation does not recreate or delete Tenant assignments",
    "deactivation/reactivation preserves Person participation and role evidence",
    "FCOC remains active and untouched",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
