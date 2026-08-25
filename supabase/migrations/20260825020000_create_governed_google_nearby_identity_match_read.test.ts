import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260825020000_create_governed_google_nearby_identity_match_read.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL("../integration-tests/20260825020000_google_nearby_identity_match_rollback.sql", import.meta.url),
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

function functionBody() {
  const start = SQL.indexOf(
    "CREATE OR REPLACE FUNCTION public.list_matching_google_place_ids_for_nearby_administration",
  );
  assert.notEqual(start, -1, "missing matching RPC");
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing matching RPC terminator");
  return SQL.slice(start, end);
}

test("linked rollback fixture installs the exact pending matching RPC inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the narrow RPC returns only exact provider IDs from the caller-authorized canonical scope", () => {
  const body = functionBody();
  assert.match(body, /RETURNS TABLE \(\s*google_place_id text\s*\)/);
  assert.match(body, /resolve_task_authority\(v_actor, 'event\.nearby\.manage', p_event_id\)/);
  assert.match(body, /provider_identity\.provider = 'google_places'/);
  assert.match(body, /provider_identity\.provider_place_id IN/);
  assert.match(body, /master\.scope = 'shared_public' AND v_is_platform_admin/);
  assert.match(body, /master\.scope = 'tenant_specific'/);
  assert.match(body, /master\.tenant_id = v_event_tenant_id/);
  assert.match(body, /has_tenant_admin_authority\(v_actor, master\.tenant_id\)/);
  assert.match(body, /master\.status = 'active'/);
  assert.doesNotMatch(
    body,
    /ILIKE|similarity|levenshtein|lower\(|master\.(?:name|address|lat|lng)|provider_identity\.(?:name|address)/,
  );
});

test("the read surface is hardened and does not reopen direct provider-identity browsing", () => {
  assert.match(SQL, /SECURITY DEFINER/);
  assert.match(SQL, /SET search_path TO 'pg_catalog'/);
  assert.match(
    SQL,
    /ALTER FUNCTION public\.list_matching_google_place_ids_for_nearby_administration\(uuid, text\[\]\) OWNER TO postgres/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.list_matching_google_place_ids_for_nearby_administration\(uuid, text\[\]\)\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.list_matching_google_place_ids_for_nearby_administration\(uuid, text\[\]\)\s*TO authenticated/,
  );
  assert.doesNotMatch(SQL, /GRANT (?:SELECT|ALL) ON TABLE public\.nearby_master_provider_identities/);
});

test("the linked proof covers exact matching, scope non-exposure, Event-only truth, anonymous denial, and rollback", () => {
  for (const evidence of [
    "Tenant authority returns only its exact same-Tenant canonical identity",
    "Platform authority returns authorized Tenant and Shared exact canonical identities only",
    "same name or address with a different Google Place ID remains pending",
    "canonical record without a Google Place ID cannot suppress a candidate",
    "direct Event Admin sees no canonical identity match and Event-only candidates remain unsuppressed",
    "cross-Tenant caller is denied before identity exposure",
    "anonymous caller cannot execute the governed matching RPC",
    "authenticated and anonymous roles have no direct provider identity table privilege",
    "Google Nearby identity matching rollback left fixture residue",
  ]) {
    assert.match(FIXTURE, new RegExp(evidence));
  }
});
