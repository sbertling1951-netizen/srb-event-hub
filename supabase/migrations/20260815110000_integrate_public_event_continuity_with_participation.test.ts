import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260815110000_integrate_public_event_continuity_with_participation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

function functionBody(name: string) {
  const match = executableSql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\n\\$\\$;`),
  );
  assert.ok(match, `${name} definition not found`);
  return match[0];
}

test("member continuity is actor-derived, participation-bound, and retains the narrow continuity projection", () => {
  const body = functionBody("get_my_member_event_continuity_context");
  assert.match(body, /p_event_id uuid/);
  assert.match(body, /public\.resolve_auth_person_link\(auth\.uid\(\)\)/);
  assert.match(body, /FROM public\.person_event_participations pep/);
  assert.match(body, /JOIN public\.events e ON e\.id = pep\.event_id/);
  assert.match(body, /pep\.person_id = v_person_id/);
  assert.match(body, /pep\.event_id = p_event_id/);
  assert.match(body, /pep\.participation_state = 'eligible'/);
  assert.equal(/p_person_id|p_tenant_id|p_auth_user_id/.test(body), false);
  assert.equal(/visible_to_members|e\.is_active|lifecycle_state|registration_status|attendees/.test(body), false);
  for (const forbidden of ["event_code", "tenant_id", "archived_at", "revoked_reason"]) {
    assert.equal(body.includes(forbidden), false, `${forbidden} must not be projected`);
  }
  for (const column of ["e.id", "e.name", "e.coach_map_open_scale", "e.short_name"]) {
    assert.match(body, new RegExp(column.replace(".", "\\.")));
  }
});

test("public known-ID continuity uses the exact canonical public predicate and preserves the safe projection", () => {
  const body = functionBody("get_event_continuity_context");
  assert.match(body, /WHERE e\.id = p_event_id/);
  assert.match(body, /e\.visible_to_members = true/);
  assert.match(body, /coalesce\(e\.is_active, true\) = true/);
  assert.match(body, /lower\(trim\(coalesce\(e\.status, ''\)\)\) NOT IN \([\s\S]*?'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'/);
  assert.equal(/event_code|tenant_id|lifecycle_state|archived_at/.test(body), false);
  assert.match(body, /e\.short_name/);
});

test("tenant ownership requires caller-derived eligible participation as well as stored Event tenant ownership", () => {
  const body = functionBody("get_tenant_owned_event_ids");
  assert.match(body, /public\.resolve_auth_person_link\(auth\.uid\(\)\)/);
  assert.match(body, /FROM public\.person_event_participations pep/);
  assert.match(body, /pep\.person_id = v_person_id/);
  assert.match(body, /pep\.participation_state = 'eligible'/);
  assert.match(body, /e\.id = ANY\(p_event_ids\)/);
  assert.match(body, /e\.tenant_id = p_tenant_id/);
  assert.equal(/visible_to_members|e\.is_active|lifecycle_state|registration_status/.test(body), false);
});

test("ACLs close member and ownership writers to anon while preserving required public and authenticated reads", () => {
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.get_my_member_event_continuity_context\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.get_my_member_event_continuity_context\(uuid\) TO authenticated;/);
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.get_event_continuity_context\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.get_event_continuity_context\(uuid\) TO anon, authenticated;/);
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.get_tenant_owned_event_ids\(uuid\[\], uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.get_tenant_owned_event_ids\(uuid\[\], uuid\) TO authenticated;/);
});

test("integration does not alter current-active, direct event RLS, participation schema, or vendor/admin domains", () => {
  for (const forbidden of [
    "get_current_active_event",
    "CREATE TABLE public.person_event_participations",
    "ALTER TABLE public.events",
    "CREATE POLICY",
    "event_vendors",
    "admin_event_access",
  ]) {
    assert.equal(executableSql.includes(forbidden), false, `${forbidden} is out of scope`);
  }
});
