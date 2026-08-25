import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260825010000_repair_legacy_stored_area_parent_identity.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(new URL("../integration-tests/20260825010000_legacy_stored_area_parent_identity_rollback.sql", import.meta.url)),
  "utf8",
);

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

function functionBody(name: string) {
  const start = SQL.indexOf(`FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing ${name} body terminator`);
  return SQL.slice(start, end);
}

test("linked rollback fixture installs the exact pending Stored Area repair inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("Stored Area templates gain an explicit nullable parent relationship without changing the existing master FK", () => {
  assert.match(SQL, /ADD COLUMN nearby_area_id uuid/);
  assert.match(SQL, /nearby_area_templates_nearby_area_id_fkey/);
  assert.match(SQL, /REFERENCES public\.nearby_areas\(id\)/);
  assert.match(SQL, /ON DELETE RESTRICT/);
  assert.doesNotMatch(SQL, /DROP CONSTRAINT nearby_master_area_id_fkey/);
  assert.doesNotMatch(SQL, /ALTER TABLE public\.nearby_master[\s\S]*?area_id/);
  assert.doesNotMatch(SQL, /UPDATE public\.nearby_area_templates/);
});

test("upsert accepts template identity, resolves the explicit parent, and never writes the template UUID as the master area ID", () => {
  const upsert = functionBody("upsert_stored_area_place");
  assert.match(upsert, /p_template_id uuid/);
  assert.match(upsert, /FROM public\.nearby_area_templates AS t/);
  assert.match(upsert, /SELECT t\.nearby_area_id/);
  assert.match(upsert, /has no explicit Nearby Area parent mapping/);
  assert.match(upsert, /v_nearby_area_id, p_name/);
  assert.match(upsert, /area_id = v_nearby_area_id/);
  assert.doesNotMatch(upsert, /area_id\s*=\s*p_template_id|\(\s*p_template_id, p_name/);
});

test("atomic Stored Area creation makes separate parent and template records and never infers existing identity", () => {
  const create = functionBody("create_stored_area");
  assert.match(create, /INSERT INTO public\.nearby_areas/);
  assert.match(create, /INSERT INTO public\.nearby_area_templates/);
  assert.match(create, /nearby_area_id/);
  assert.match(create, /requires explicit parent reconciliation/);
  assert.doesNotMatch(create, /ILIKE|similarity|levenshtein|JOIN public\.nearby_areas/);
});

test("Stored Area authority and grants remain bounded, with no Area List participation", () => {
  assert.match(SQL, /privilege_group = ANY \(ARRAY\['super_admin', 'event_admin', 'content_admin'\]\)/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.create_stored_area[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.create_stored_area[\s\S]*?TO authenticated/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.upsert_stored_area_place[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.upsert_stored_area_place[\s\S]*?TO authenticated/);
  assert.doesNotMatch(SQL, /nearby_area_lists|nearby_area_list_members|apply_nearby_area_list_to_event/);
});

test("fixture proves same-ID and different-ID mappings, unmapped zero-mutation denial, atomic creation, grants, authority, and cleanup", () => {
  for (const evidence of [
    "same template/parent UUID writes through the explicit relationship",
    "different template/parent UUID writes only the resolved parent UUID",
    "unmapped template is denied before any Nearby master mutation",
    "atomic Stored Area creation makes distinct valid parent and template identities with an explicit link",
    "nearby_master.area_id foreign key remains unchanged",
    "Stored Area RPC execution grants remain authenticated-only",
    "unauthorized Stored Area creation is denied without partial parent or template mutation",
    "existing governed Area List RPC remains present but is not used by this fixture",
    "Legacy Stored Area parent fixture rollback left residue",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
