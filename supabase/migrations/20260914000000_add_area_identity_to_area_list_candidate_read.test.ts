import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260914000000_add_area_identity_to_area_list_candidate_read.sql", import.meta.url),
  ),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260914000000_area_identity_area_list_candidate_read_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const ORIGINAL = readFileSync(
  fileURLToPath(
    new URL("./20260825000000_create_governed_nearby_area_lists.sql", import.meta.url),
  ),
  "utf8",
);

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

function functionBody(source: string, marker: string) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing function terminator after ${marker}`);
  return source.slice(start, end);
}

const NEW_FN = functionBody(
  SQL,
  "CREATE FUNCTION public.list_nearby_master_places_for_area_list",
);
const OLD_FN = functionBody(
  ORIGINAL,
  "CREATE OR REPLACE FUNCTION public.list_nearby_master_places_for_area_list",
);

test("the linked rollback fixture installs the exact replacement inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the migration is a transactional DROP + CREATE (RETURNS TABLE shape change)", () => {
  assert.equal((SQL.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((SQL.match(/^COMMIT;$/gm) || []).length, 1);
  assert.match(SQL, /DROP FUNCTION public\.list_nearby_master_places_for_area_list\(uuid\);/);
  assert.match(SQL, /CREATE FUNCTION public\.list_nearby_master_places_for_area_list\(/);
  // never a plain CREATE OR REPLACE (which cannot change the column list)
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.list_nearby_master_places_for_area_list/);
});

test("area_id and area_name are appended AFTER the existing six columns, in order", () => {
  assert.match(
    NEW_FN,
    /RETURNS TABLE \(\s*nearby_master_id uuid,\s*name text,\s*category_id uuid,\s*category_label text,\s*scope text,\s*tenant_id uuid,\s*area_id uuid,\s*area_name text\s*\)/,
  );
  // the SELECT list appends na.id, na.name in the matching positions
  assert.match(
    NEW_FN,
    /SELECT nm\.id, nm\.name, nm\.category_id, pc\.label, nm\.scope, nm\.tenant_id,\s*\n\s*na\.id, na\.name/,
  );
});

test("the authority gate is unchanged -- assert_nearby_area_list_management_authority still runs first", () => {
  assert.match(
    NEW_FN,
    /v_list := public\.assert_nearby_area_list_management_authority\(p_area_list_id\);/,
  );
  // the gate is the FIRST statement in the body, before the RETURN QUERY
  const gateIdx = NEW_FN.indexOf("assert_nearby_area_list_management_authority");
  const queryIdx = NEW_FN.indexOf("RETURN QUERY");
  assert.ok(gateIdx !== -1 && queryIdx !== -1 && gateIdx < queryIdx);
});

test("the eligibility / scope predicate is byte-identical to 20260825000000 -- no narrowing", () => {
  function predicate(fn: string) {
    const start = fn.indexOf("WHERE nm.status = 'active'");
    const end = fn.indexOf("ORDER BY", start);
    assert.ok(start !== -1 && end !== -1);
    return fn.slice(start, end).trim();
  }
  assert.equal(predicate(NEW_FN), predicate(OLD_FN));
  // spelled out for clarity: shared always; tenant lists also see shared + own-tenant
  assert.match(NEW_FN, /v_list\.scope = 'shared_public' AND nm\.scope = 'shared_public'/);
  assert.match(
    NEW_FN,
    /v_list\.scope = 'tenant_specific'\s*\n\s*AND \(nm\.scope = 'shared_public' OR nm\.tenant_id = v_list\.tenant_id\)/,
  );
});

test("Area identity is the candidate place's own nearby_master.area_id via a LEFT JOIN (Unassigned survives)", () => {
  assert.match(NEW_FN, /LEFT JOIN public\.nearby_areas AS na ON na\.id = nm\.area_id/);
  // LEFT, never INNER -- a place with a NULL area_id must still be returned
  assert.doesNotMatch(NEW_FN, /\bJOIN public\.nearby_areas\b(?! AS na ON)/);
  assert.doesNotMatch(NEW_FN, /INNER JOIN public\.nearby_areas/);
});

test("no Area-List geography schema is introduced", () => {
  const executable = SQL.replace(/^--.*$/gm, "");
  assert.doesNotMatch(executable, /ALTER TABLE\s+public\.nearby_area_lists/);
  assert.doesNotMatch(executable, /nearby_area_lists\.nearby_area_id|nearby_area_lists_areas|area_list_areas/);
  assert.doesNotMatch(executable, /CREATE TABLE/);
  // it reads nearby_areas but never writes any Nearby structural table
  assert.doesNotMatch(executable, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:nearby_areas|nearby_area_lists|nearby_area_list_members|nearby_master|events)/);
});

test("member Nearby resolver and Google reuse / association contracts are untouched", () => {
  const executable = SQL.replace(/^--.*$/gm, "");
  assert.doesNotMatch(executable, /resolve_effective_nearby_places/);
  assert.doesNotMatch(executable, /reuse_nearby_places_by_google_place_id_for_event/);
  assert.doesNotMatch(executable, /associate_nearby_master_place_with_event/);
  assert.doesNotMatch(executable, /set_nearby_area_list_membership/);
  assert.doesNotMatch(executable, /upsert_stored_area_place|create_stored_area|delete_stored_area_place/);
});

test("owner + REVOKE/GRANT posture from 20260825000000 is reapplied verbatim", () => {
  assert.match(
    SQL,
    /ALTER FUNCTION public\.list_nearby_master_places_for_area_list\(uuid\) OWNER TO postgres;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.list_nearby_master_places_for_area_list\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.list_nearby_master_places_for_area_list\(uuid\)\s*\n\s*TO authenticated;/,
  );
  assert.doesNotMatch(SQL, /GRANT (?:SELECT|ALL) ON TABLE public\.nearby_master\b/);
  assert.match(NEW_FN, /SECURITY DEFINER/);
  assert.match(NEW_FN, /SET search_path TO 'pg_catalog'/);
});

test("the linked proof covers authority, predicate preservation, Area identity, and Unassigned", () => {
  for (const evidence of [
    "unauthorized caller is refused by the unchanged authority gate before any candidate is returned",
    "exactly the four active + approved fixture places are eligible (predicate preserved)",
    "a shared_public place from another geographic Area is still returned, not hidden",
    "area_id is read from the candidate place nearby_master.area_id",
    "area_name resolves through nearby_areas",
    "a canonical place with no area_id is returned with a NULL area (Unassigned), not dropped",
    "the Unassigned place sorts last",
    "the read returns exactly eight OUT columns",
  ]) {
    assert.ok(FIXTURE.includes(evidence), `linked fixture must prove: ${evidence}`);
  }
});
