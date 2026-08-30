import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./20260913000000_cut_over_event_map_settings_to_event_definition_authority.sql", import.meta.url)),
  "utf8",
);
const EXECUTABLE = SOURCE.replace(/--.*$/gm, "");

function policy(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = EXECUTABLE.match(new RegExp(`CREATE POLICY "${escaped}"[\\s\\S]*?;`));
  assert.ok(match, `expected policy ${name}`);
  return match[0];
}

function functionBody() {
  const match = EXECUTABLE.match(
    /CREATE OR REPLACE FUNCTION public\.admin_save_event_assignments_guarded\([\s\S]*?\n\$\$;\n/,
  );
  assert.ok(match, "expected governed Event-assignment function replacement");
  return match[0];
}

test("uses one transactional migration with exact baseline guards", () => {
  assert.match(EXECUTABLE, /BEGIN;/);
  assert.match(EXECUTABLE, /COMMIT;/);
  assert.match(EXECUTABLE, /event\.definition\.manage is not an active Event task/);
  assert.match(EXECUTABLE, /event_map_settings RLS is not enabled/);
  assert.match(EXECUTABLE, /event_map_settings\.event_id is absent/);
  assert.match(EXECUTABLE, /public event_map_settings read policy is absent or changed/);
  assert.match(EXECUTABLE, /expected inline event_map_settings policy is absent or changed/);
});

test("replaces every inline administrative Event-map policy with Event-definition authority", () => {
  for (const oldName of [
    "Admins can view event map settings",
    "Admins can insert event map settings",
    "Admins can update event map settings",
  ]) {
    assert.match(EXECUTABLE, new RegExp(`DROP POLICY "${oldName}" ON public\\.event_map_settings;`));
  }

  const select = policy("Event definition admins can view event map settings");
  const insert = policy("Event definition admins can insert event map settings");
  const update = policy("Event definition admins can update event map settings");
  for (const block of [select, insert, update]) {
    assert.match(block, /TO authenticated/);
    assert.match(block, /public\.has_event_task_authority\('event\.definition\.manage', event_id\)/);
    assert.doesNotMatch(block, /admin_users|privilege_group|is_current_admin|is_active_admin|is_super_admin/);
  }
  assert.match(select, /FOR SELECT/);
  assert.match(insert, /FOR INSERT/);
  assert.match(insert, /WITH CHECK/);
  assert.match(update, /FOR UPDATE/);
  assert.match(update, /USING/);
  assert.match(update, /WITH CHECK/);
});

test("preserves the independent public read branch", () => {
  assert.match(EXECUTABLE, /policy\.polname = 'public read event_map_settings'/);
  assert.match(EXECUTABLE, /pg_get_expr\(policy\.polqual, policy\.polrelid\) = 'true'/);
  assert.doesNotMatch(EXECUTABLE, /DROP POLICY "public read event_map_settings"/);
  assert.doesNotMatch(EXECUTABLE, /CREATE POLICY "public read event_map_settings"/);
});

test("assignment RPC uses Event-definition authority and preserves its concurrency contract", () => {
  const body = functionBody();
  assert.match(body, /v_actor uuid := auth\.uid\(\)/);
  assert.match(body, /IF NOT public\.has_event_task_authority\('event\.definition\.manage', p_event_id\) THEN/);
  assert.doesNotMatch(body, /has_event_admin_authority/);
  assert.match(body, /FROM public\.events AS e\s*\n\s*WHERE e\.id = p_event_id\s*\n\s*FOR UPDATE;/);
  assert.match(body, /FROM public\.event_map_settings AS ems\s*\n\s*WHERE ems\.event_id = p_event_id\s*\n\s*FOR UPDATE;/);
  assert.match(body, /RAISE EXCEPTION 'stale_event_assignments';/);
  const stale = body.indexOf("RAISE EXCEPTION 'stale_event_assignments'");
  const firstWrite = Math.min(body.indexOf("UPDATE public.events"), body.indexOf("INSERT INTO public.event_map_settings"));
  assert.ok(stale >= 0 && stale < firstWrite, "stale check must precede both writes");
});

test("keeps the governed RPC authenticated-only and leaves other Stage 6 cohorts untouched", () => {
  assert.match(EXECUTABLE, /REVOKE ALL ON FUNCTION public\.admin_save_event_assignments_guarded[\s\S]*?FROM PUBLIC;/);
  assert.match(EXECUTABLE, /GRANT EXECUTE ON FUNCTION public\.admin_save_event_assignments_guarded[\s\S]*?TO authenticated;/);
  for (const forbidden of ["announcements", "parking_sites", "master_maps", "master_map_sites", "vendor_services", "nearby_event", "nearby_areas"]) {
    assert.equal(EXECUTABLE.includes(forbidden), false, `must not touch ${forbidden}`);
  }
});
