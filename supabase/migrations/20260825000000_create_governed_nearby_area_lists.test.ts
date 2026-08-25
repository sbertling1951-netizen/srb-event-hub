import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260825000000_create_governed_nearby_area_lists.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(new URL("../integration-tests/20260825000000_governed_nearby_area_lists_rollback.sql", import.meta.url)),
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
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing function body terminator for ${name}`);
  return SQL.slice(start, end);
}

test("linked rollback fixture installs the exact pending Area List definitions inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("Area Lists and memberships have durable scope and identity constraints", () => {
  assert.match(SQL, /CREATE TABLE public\.nearby_area_lists/);
  assert.match(SQL, /scope IN \('shared_public', 'tenant_specific'\)/);
  assert.match(SQL, /shared_public' AND tenant_id IS NULL/);
  assert.match(SQL, /tenant_specific' AND tenant_id IS NOT NULL/);
  assert.match(SQL, /nearby_area_lists_shared_normalized_name_unique_idx/);
  assert.match(SQL, /nearby_area_lists_tenant_normalized_name_unique_idx/);
  assert.match(SQL, /CREATE TABLE public\.nearby_area_list_members/);
  assert.match(SQL, /CONSTRAINT nearby_area_list_members_unique_identity UNIQUE \(area_list_id, nearby_master_id\)/);
  assert.match(SQL, /member_reactivated/);
  assert.doesNotMatch(SQL.replace(/^--.*$/gm, ""), /(?:FROM|INTO|UPDATE|DELETE) public\.(?:nearby_area_templates|nearby_areas)/);
});

test("provider identity stores only exact Google identity with canonical uniqueness", () => {
  assert.match(SQL, /CREATE TABLE public\.nearby_master_provider_identities/);
  assert.match(SQL, /provider = 'google_places'/);
  assert.match(SQL, /UNIQUE \(provider, provider_place_id\)/);
  assert.match(SQL, /UNIQUE \(nearby_master_id, provider\)/);
  const link = functionBody("link_google_place_id_to_nearby_master");
  assert.match(link, /nullif\(btrim\(p_google_place_id\), ''\)/);
  assert.match(link, /has_platform_admin_authority/);
  assert.match(link, /has_tenant_admin_authority/);
  assert.doesNotMatch(link, /ILIKE|similarity|levenshtein|email|membership/);
});

test("application is category-filtered, lifecycle-gated, additive, and delegates snapshot/idempotency to the canonical association RPC", () => {
  const apply = functionBody("apply_nearby_area_list_to_event");
  assert.match(apply, /has_event_task_authority\('event\.nearby\.manage', p_event_id\)/);
  assert.match(apply, /assert_event_lifecycle_mutable\(p_event_id\)/);
  assert.match(apply, /nm\.category_id = ANY \(p_category_ids\)/);
  assert.match(apply, /nm\.status = 'active'/);
  assert.match(apply, /nm\.review_status = 'approved'/);
  assert.match(apply, /PERFORM public\.associate_nearby_master_place_with_event\(p_event_id, v_place_id\)/);
  assert.match(apply, /INSERT INTO public\.nearby_area_list_application_audit/);
  assert.doesNotMatch(apply, /INSERT INTO public\.event_nearby_places/);
  assert.doesNotMatch(apply, /DELETE FROM public\.event_nearby_places|UPDATE public\.event_nearby_places/);
});

test("new tables are RLS-enabled, browser-direct access is closed, and RPCs are authenticated-only", () => {
  for (const table of [
    "nearby_area_lists",
    "nearby_area_list_members",
    "nearby_master_provider_identities",
    "nearby_area_list_command_audit",
    "nearby_area_list_application_audit",
    "nearby_master_provider_identity_audit",
  ]) {
    assert.match(SQL, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated, service_role`));
  }
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.apply_nearby_area_list_to_event\(uuid, uuid, uuid\[\]\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.apply_nearby_area_list_to_event\(uuid, uuid, uuid\[\]\) TO authenticated/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE ON FUNCTION public\.(?:create_nearby_area_list|apply_nearby_area_list_to_event)[\s\S]*?TO anon/);
});

test("all command evidence is immutable and the linked fixture proves authority, source-master identity, curation independence, and rollback", () => {
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON public\.nearby_area_list_command_audit/);
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON public\.nearby_area_list_application_audit/);
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON public\.nearby_master_provider_identity_audit/);
  for (const evidence of [
    "membership add, removal, and reactivation preserve one durable identity",
    "exact Google Place ID cannot be linked to competing canonical place",
    "Tenant Admin cannot manage Shared Area Lists",
    "category-filtered application creates the canonical Event snapshot with source_master_id",
    "second Area List application is idempotent and reports already-associated truth",
    "Event-specific curation remains an independent snapshot",
    "cross-Event Tenant Admin application is denied",
    "immutable Event lifecycle denies Area List application",
    "direct Event Admin gains no source-list authority",
    "authenticated callers have no raw Area List write grant",
    "anonymous caller cannot execute Area List application",
    "Nearby Area List rollback left fixture residue",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
