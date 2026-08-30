import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260912000000_repair_stored_area_contribution_and_canonical_authority.sql", import.meta.url),
  ),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260912000000_stored_area_contribution_and_canonical_authority_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const PAGE = readFileSync(
  fileURLToPath(new URL("../../app/admin/nearby/page.tsx", import.meta.url)),
  "utf8",
);

// Executable SQL only -- drop full-line `--` comments so "this token never
// appears" assertions test the DDL, not the explanatory header prose (which
// deliberately names what the migration does NOT do).
const SQL_CODE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function parityBlock(source: string) {
  const start = source.indexOf("-- PARITY START:");
  const end = source.indexOf("-- PARITY END", start);
  assert.notEqual(start, -1, "missing parity start");
  assert.notEqual(end, -1, "missing parity end");
  return source.slice(start, end + "-- PARITY END".length).trim();
}

function functionBody(signaturePrefix: string) {
  const start = SQL.indexOf(signaturePrefix);
  assert.notEqual(start, -1, `missing ${signaturePrefix}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing ${signaturePrefix} body terminator`);
  return SQL.slice(start, end);
}

function pageFunctionBody(name: string) {
  const start = PAGE.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `missing page function ${name}`);
  // end at the function's own closing brace (2-space indent), which stops
  // before the next function's preceding comment block.
  const end = PAGE.indexOf("\n  }\n", start);
  assert.notEqual(end, -1, `missing end of page function ${name}`);
  return PAGE.slice(start, end);
}

test("the linked rollback fixture installs the exact repair inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
  assert.equal((SQL.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((SQL.match(/^COMMIT;$/gm) || []).length, 1);
});

test("no global privilege_group-only gate survives anywhere in the P1 surface", () => {
  assert.doesNotMatch(
    SQL_CODE,
    /privilege_group = ANY \(ARRAY\['super_admin', 'event_admin', 'content_admin'\]\)/,
  );
  assert.doesNotMatch(SQL_CODE, /privilege_group/);
  assert.doesNotMatch(SQL_CODE, /public\.admin_users/);
});

test("contribution authority is real governed Event authority, fail-closed, lifecycle-aware", () => {
  const body = functionBody("FUNCTION public.assert_stored_area_contribution_authority(p_event_id uuid)");
  assert.match(body, /IF p_event_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Stored Area contribution requires a working Event context\.'/);
  assert.match(body, /has_event_task_authority\('event\.nearby\.manage', p_event_id\)/);
  assert.match(body, /PERFORM public\.assert_event_lifecycle_mutable\(p_event_id\)/);
  // contribution must NOT be a platform/tenant catalog-management gate
  assert.doesNotMatch(body, /has_platform_admin_authority|has_tenant_admin_authority/);
});

test("canonical authority is System Admin only", () => {
  const body = functionBody("FUNCTION public.assert_stored_area_canonical_authority()");
  assert.match(body, /IF NOT public\.has_platform_admin_authority\(auth\.uid\(\)\) THEN/);
  assert.match(body, /RAISE EXCEPTION 'Shared Nearby catalog changes require System Administrator authority\.'/);
  assert.doesNotMatch(body, /has_event_task_authority|has_tenant_admin_authority/);
});

test("assert_stored_area_management_authority keeps its signature but now enforces canonical authority only", () => {
  const body = functionBody("FUNCTION public.assert_stored_area_management_authority()");
  assert.match(body, /PERFORM public\.assert_stored_area_canonical_authority\(\)/);
  assert.doesNotMatch(body, /admin_users|privilege_group/);
});

test("upsert_stored_area_place splits contribution (insert) from canonical modification (existing id)", () => {
  const body = functionBody(
    "FUNCTION public.upsert_stored_area_place(\n  p_place_id uuid,",
  );
  // new trailing Event context param
  assert.match(body, /p_event_id uuid DEFAULT NULL\n\)/);

  // authority is the FIRST statement, branched purely on p_place_id
  assert.match(
    body,
    /BEGIN\n[\s\S]{0,120}?IF p_place_id IS NULL THEN\n\s*PERFORM public\.assert_stored_area_contribution_authority\(p_event_id\);\n\s*ELSE\n\s*PERFORM public\.assert_stored_area_canonical_authority\(\);\n\s*END IF;/,
  );
  // insert is explicit about scope/status/review_status/provenance, not defaults
  assert.match(body, /scope, status, review_status, created_by\n\s*\) VALUES \(/);
  assert.match(body, /'shared_public', 'active', 'approved', auth\.uid\(\)::text/);

  // both authority asserts precede every data probe (template lookup + target row read)
  const contribIdx = body.indexOf("assert_stored_area_contribution_authority(p_event_id)");
  const canonIdx = body.indexOf("assert_stored_area_canonical_authority()");
  const templateProbeIdx = body.indexOf("FROM public.nearby_area_templates AS t");
  const targetRowIdx = body.indexOf("FROM public.nearby_master\n  WHERE id = p_place_id");
  assert.ok(contribIdx !== -1 && canonIdx !== -1 && templateProbeIdx !== -1 && targetRowIdx !== -1);
  assert.ok(
    contribIdx < templateProbeIdx && canonIdx < templateProbeIdx && canonIdx < targetRowIdx,
    "authority must be asserted before any template lookup or target-row read",
  );

  // canonical scope guard: legacy bucket + shared_public only
  assert.match(body, /IF v_existing_area_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Place % is not a Stored Area place\.'/);
  assert.match(
    body,
    /IF v_existing_scope IS DISTINCT FROM 'shared_public' THEN\s*\n\s*RAISE EXCEPTION 'Place % is a tenant-scoped catalog record; use update_nearby_master_place\.'/,
  );

  // a supplied template id is only a parent lookup, never an authority source
  assert.doesNotMatch(body, /assert_stored_area_contribution_authority\(p_template_id\)/);
});

test("delete_stored_area_place no longer hard-deletes -- it delegates to the canonical retire primitive", () => {
  const body = functionBody("FUNCTION public.delete_stored_area_place(p_place_id uuid)");
  assert.doesNotMatch(SQL_CODE, /DELETE FROM public\.nearby_master/);
  assert.match(body, /PERFORM public\.retire_nearby_master_place\(p_place_id\)/);
  assert.match(body, /IF v_area_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Place % is not a Stored Area place\.'/);
  assert.match(
    body,
    /IF v_scope IS DISTINCT FROM 'shared_public' THEN\s*\n\s*RAISE EXCEPTION 'Place % is a tenant-scoped catalog record; use retire_nearby_master_place\.'/,
  );
  // no reference cascade is opened here
  assert.doesNotMatch(body, /event_nearby_places|tenant_place_relevance|nearby_area_list_members/);
});

test("every function stays SECURITY DEFINER / pinned search_path / postgres-owned, with the same authenticated-only EXECUTE posture", () => {
  // all six definitions carry the exact plpgsql / SECURITY DEFINER /
  // pinned-search_path block
  assert.equal(
    (SQL.match(/LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path TO 'pg_catalog'/g) || []).length,
    6,
  );

  for (const sig of [
    "public.assert_stored_area_contribution_authority(uuid)",
    "public.assert_stored_area_canonical_authority()",
    "public.assert_stored_area_management_authority()",
    "public.create_stored_area(text, text, numeric, text, text, text, uuid)",
    "public.upsert_stored_area_place(\n  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid\n)",
    "public.delete_stored_area_place(uuid)",
  ]) {
    const escaped = sig.replace(/[.()[\]]/g, "\\$&").replace(/\n/g, "\\n").replace(/ +/g, "\\s*");
    assert.match(SQL, new RegExp(`ALTER FUNCTION ${escaped} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION ${escaped}\\s*FROM PUBLIC, anon, authenticated, service_role`));
  }

  // the internal assert_* helpers are REVOKE-only: no GRANT back to any role
  assert.doesNotMatch(SQL, /GRANT EXECUTE ON FUNCTION public\.assert_stored_area_/);

  // the three browser RPCs keep authenticated EXECUTE
  for (const sig of [
    "public.create_stored_area(text, text, numeric, text, text, text, uuid)",
    "public.upsert_stored_area_place(\n  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric, uuid\n)",
    "public.delete_stored_area_place(uuid)",
  ]) {
    const escaped = sig.replace(/[.()[\]]/g, "\\$&").replace(/\n/g, "\\n").replace(/ +/g, "\\s*");
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION ${escaped}\\s*TO authenticated`));
  }
});

test("the migration does not touch P2 or tenant/history governance", () => {
  assert.doesNotMatch(SQL_CODE, /nearby_master_authenticated_select_policy/);
  assert.doesNotMatch(SQL_CODE, /CREATE POLICY|DROP POLICY|ALTER POLICY/);
  assert.doesNotMatch(SQL_CODE, /admin_tenant_access|set_tenant_admin_access/);
  assert.doesNotMatch(SQL_CODE, /reuse_nearby_places_by_google_place_id_for_event/);
  assert.doesNotMatch(SQL_CODE, /ALTER TABLE|CREATE TABLE|ADD COLUMN/);
});

test("the Stored Area panel passes a real Event context for contribution and labels retirement honestly", () => {
  const save = pageFunctionBody("saveStoredPlace");
  assert.match(save, /p_event_id: adminEvent\?\.id \?\? null/);
  assert.match(save, /supabase\.rpc\("upsert_stored_area_place", rpcArgs\)/);
  // contribution requires a working Event; canonical edit is System-Admin advisory-gated
  assert.match(save, /Select a working Event/);
  assert.match(save, /System Administrator/);

  const create = pageFunctionBody("createStoredArea");
  assert.match(create, /p_event_id: adminEvent\.id/);
  assert.match(create, /supabase\.rpc\("create_stored_area", payload\)/);
  assert.match(create, /Select a working Event/);

  const del = pageFunctionBody("deleteStoredPlace");
  assert.match(del, /supabase\.rpc\("delete_stored_area_place"/);
  assert.match(del, /[Rr]etire/);
  assert.doesNotMatch(del, /This cannot be undone/);
});

test("Event-specific hide / remove is unchanged and still operates on event_nearby_places, never the canonical row", () => {
  const remove = pageFunctionBody("deleteOrRemoveNearbyPlace");
  assert.match(remove, /\.from\("event_nearby_places"\)\s*\n?\s*\.delete\(\)/);
  assert.doesNotMatch(remove, /delete_stored_area_place|upsert_stored_area_place|retire_nearby_master_place/);
});

test("the linked proof covers the full split, fail-closed contribution, canonical System-Admin gate, retire-not-delete, and Event-relationship isolation", () => {
  for (const evidence of [
    "anonymous caller cannot contribute a Stored Area place",
    "content_admin with only the legacy privilege_group flag but no event.nearby.manage grant is denied contribution",
    "Event Admin with event.nearby.manage contributes a new shared_public catalog place for their Event",
    "a contribution stamps created_by and confers no later canonical edit authority",
    "the same Event Admin cannot edit the canonical record they just contributed",
    "an Event Admin from another Event/Tenant cannot edit the shared canonical row",
    "System Administrator edits the canonical shared record",
    "System Administrator reassigns the canonical record between Stored Areas",
    "a caller-supplied p_place_id cannot turn a contribution into a canonical update",
    "a caller-supplied template id confers no authority",
    "contribution into an archived Event is refused by the lifecycle guard",
    "delete_stored_area_place archives the canonical record and never physically deletes it",
    "canonical retirement requires System Administrator authority",
    "existing Event associations and tenant relevance rows survive canonical retirement intact",
    "a tenant-scoped catalog row is refused by both the upsert and delete Stored Area paths",
    "Stored Area RPC EXECUTE remains authenticated-only and the internal assert helpers are uncallable",
    "Stored Area contribution and canonical authority rollback left residue",
  ]) {
    assert.ok(FIXTURE.includes(evidence), `linked fixture must prove: ${evidence}`);
  }
});
