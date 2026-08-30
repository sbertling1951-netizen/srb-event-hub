import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260911000000_create_governed_google_place_id_event_reuse.sql", import.meta.url),
  ),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260911000000_google_place_id_event_reuse_rollback.sql",
      import.meta.url,
    ),
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
    "CREATE OR REPLACE FUNCTION public.reuse_nearby_places_by_google_place_id_for_event",
  );
  assert.notEqual(start, -1, "missing reuse RPC");
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing reuse RPC terminator");
  return SQL.slice(start, end);
}

test("the linked rollback fixture installs the exact reuse RPC inside one outer rollback", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
});

test("the RPC returns only a collapsed per-Place-ID outcome and never a master id", () => {
  const body = functionBody();
  assert.match(body, /RETURNS TABLE \(\s*google_place_id text,\s*outcome text\s*\)/);
  // outcome vocabulary
  assert.match(body, /outcome := 'reused'/);
  assert.match(body, /outcome := 'already_associated'/);
  assert.match(body, /outcome := 'not_reusable'/);
  // no master id, tenant status, or review status is ever RETURN NEXTed
  assert.doesNotMatch(body, /outcome := '(wrong_tenant|pending|rejected|no_row|not_found|missing)'/);
  assert.doesNotMatch(body, /nearby_master_id\s+uuid\s*\)/);
  assert.doesNotMatch(body, /RETURN QUERY[\s\S]*master\.id/);
});

test("authority is event.nearby.manage for the Event -- the same gate the association RPC uses, not the stricter suppression-matcher gate", () => {
  const body = functionBody();
  assert.match(
    body,
    /resolve_task_authority\(v_actor, 'event\.nearby\.manage', p_event_id\)/,
  );
  assert.match(body, /v_actor uuid := auth\.uid\(\)/);
  assert.match(body, /IF v_actor IS NULL THEN\s*RAISE EXCEPTION 'Nearby place reuse requires authenticated authority\.'/);
  assert.match(
    body,
    /v_event_task_allowed IS DISTINCT FROM true OR v_event_tenant_id IS NULL[\s\S]*?RAISE EXCEPTION 'Nearby place reuse requires event\.nearby\.manage authority\.'/,
  );
  // reuse eligibility must NOT require Tenant catalog-management authority
  assert.doesNotMatch(body, /has_tenant_admin_authority/);
  assert.doesNotMatch(body, /has_platform_admin_authority/);
});

test("eligibility predicate mirrors associate_nearby_master_place_with_event exactly, by exact Google Place ID only", () => {
  const body = functionBody();
  assert.match(body, /provider_identity\.provider = 'google_places'/);
  assert.match(body, /provider_identity\.provider_place_id = v_place_id/);
  assert.match(body, /master\.status = 'active'/);
  assert.match(body, /master\.review_status = 'approved'/);
  assert.match(
    body,
    /master\.scope = 'shared_public'\s*OR \(master\.scope = 'tenant_specific' AND master\.tenant_id = v_event_tenant_id\)/,
  );
  // no fuzzy / name / address / coordinate matching anywhere
  assert.doesNotMatch(body, /ILIKE|similarity|levenshtein|lower\(|master\.(?:name|address|lat|lng)/);
});

test("the actual association is delegated to the existing governed primitive, not reimplemented", () => {
  const body = functionBody();
  assert.match(body, /PERFORM public\.associate_nearby_master_place_with_event\(p_event_id, v_master_id\)/);
  assert.match(body, /PERFORM public\.assert_event_lifecycle_mutable\(p_event_id\)/);
  // it does not open-code the snapshot insert
  assert.doesNotMatch(body, /INSERT INTO public\.event_nearby_places/);
});

test("a failed association is re-classified from CURRENT state, never from the nested exception's SQLSTATE", () => {
  const body = functionBody();

  // The nested exception is caught with a bare WHEN OTHERS and discarded
  // (NULL), never inspected. No SQLSTATE-based branch survives.
  assert.match(
    body,
    /PERFORM public\.associate_nearby_master_place_with_event\(p_event_id, v_master_id\);\s*\n\s*outcome := 'reused';\s*\n\s*RETURN NEXT;\s*\n\s*CONTINUE;\s*\n\s*EXCEPTION WHEN OTHERS THEN\s*\n[\s\S]*?NULL;\s*\n\s*END;/,
  );
  assert.doesNotMatch(body, /WHEN raise_exception THEN/);
  assert.doesNotMatch(body, /WHEN sqlstate/i);
  assert.doesNotMatch(body, /EXCEPTION WHEN OTHERS THEN\s*\n\s*outcome := 'not_reusable'/);

  // Post-failure it re-checks, in order: authority, lifecycle, then the
  // exact eligibility predicate.
  assert.match(
    body,
    /resolve_task_authority\(v_actor, 'event\.nearby\.manage', p_event_id\)[\s\S]*?v_recheck_allowed IS DISTINCT FROM true OR v_recheck_tenant_id IS NULL[\s\S]*?v_failure_class := 'authority_lost'/,
  );
  assert.match(
    body,
    /ELSE\s*\n\s*PERFORM public\.assert_event_lifecycle_mutable\(p_event_id\);/,
  );
  // the re-check eligibility predicate is byte-identical to the pre-check one
  assert.match(
    body,
    /provider_identity\.provider = 'google_places'\s*\n\s*AND provider_identity\.provider_place_id = v_place_id\s*\n\s*AND master\.status = 'active'\s*\n\s*AND master\.review_status = 'approved'\s*\n\s*AND \(\s*\n\s*master\.scope = 'shared_public'\s*\n\s*OR \(master\.scope = 'tenant_specific' AND master\.tenant_id = v_recheck_tenant_id\)/,
  );
  // the WHOLE re-check runs under ONE enclosing WHEN OTHERS handler
  // (not one per step) so a raise from any step is sanitized to a
  // generic failure and its text cannot leak.
  assert.match(
    body,
    /EXCEPTION WHEN OTHERS THEN\s*\n[\s\S]*?v_failure_class := 'unexpected';\s*\n\s*END;/,
  );
  // exactly two BEGIN..EXCEPTION blocks in the loop body: the association
  // subtransaction and the single enclosing re-check handler.
  const loopBody = body.slice(body.indexOf("LOOP"));
  assert.equal((loopBody.match(/\bEXCEPTION WHEN OTHERS THEN\b/g) || []).length, 2);
  assert.doesNotMatch(loopBody, /v_failure_class := 'unexpected';[\s\S]*?EXCEPTION WHEN OTHERS THEN[\s\S]*?EXCEPTION WHEN OTHERS THEN/);

  // not_reusable is reachable ONLY from the proven-ineligible re-check
  assert.match(
    body,
    /IF v_failure_class = 'ineligible' THEN\s*\n[\s\S]*?outcome := 'not_reusable';\s*\n\s*RETURN NEXT;\s*\n\s*CONTINUE;\s*\n\s*END IF;/,
  );
  // exactly two `outcome := 'not_reusable'` sites total: the pre-check
  // "no eligible master" branch and this proven-ineligible re-check.
  assert.equal((body.match(/outcome := 'not_reusable'/g) || []).length, 2);

  // every other failure class raises ONLY the generic identifier-free error
  assert.match(body, /RAISE EXCEPTION 'Nearby place reuse failed\.';\s*\n\s*END LOOP;/);
  assert.doesNotMatch(body, /RAISE EXCEPTION '[^']*%[^']*'/); // no format params in any RAISE
});

test("duplicate / blank input Place IDs are de-duplicated and trimmed", () => {
  const body = functionBody();
  assert.match(
    body,
    /SELECT DISTINCT nullif\(btrim\(candidate\.value\), ''\)\s*FROM unnest\(p_google_place_ids\)/,
  );
});

test("the read surface is hardened and does not reopen direct provider-identity browsing", () => {
  assert.match(SQL, /SECURITY DEFINER/);
  assert.match(SQL, /SET search_path TO 'pg_catalog'/);
  assert.match(
    SQL,
    /ALTER FUNCTION public\.reuse_nearby_places_by_google_place_id_for_event\(uuid, text\[\]\) OWNER TO postgres/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.reuse_nearby_places_by_google_place_id_for_event\(uuid, text\[\]\)\s*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.reuse_nearby_places_by_google_place_id_for_event\(uuid, text\[\]\)\s*TO authenticated/,
  );
  assert.doesNotMatch(SQL, /GRANT (?:SELECT|ALL) ON TABLE public\.nearby_master_provider_identities/);
});

test("the linked proof covers auth fail-closed, delegation, idempotence, the collapsed outcome, exact-ID only, and lifecycle", () => {
  for (const evidence of [
    "anonymous caller cannot execute the governed reuse RPC",
    "unauthorized Event actor is denied before identity exposure",
    "approved active Shared place is reused for an authorized Event",
    "reuse creates exactly one canonical-linked Event association",
    "a second reuse of the same place reports already_associated",
    "idempotent reuse never inserts a duplicate association",
    "approved active same-Tenant place is reused",
    "wrong-Tenant, inactive, pending, rejected, and unknown all collapse to not_reusable",
    "a canonical place with no exact Google Place ID is never reusable by any other attribute",
    "duplicate and whitespace-padded input Place IDs deduplicate to one outcome",
    "reuse into an archived Event is refused by the lifecycle guard",
    "no browser-reachable role gains direct provider identity table SELECT",
    "reuse RPC EXECUTE is granted to authenticated only",
    "a nested association failure while the candidate is still eligible re-raises generically and is never not_reusable",
    "a non-P0001 nested failure while still eligible also re-raises generically, never not_reusable",
    "a post-failure Event lifecycle that is no longer mutable re-raises generically and is never not_reusable",
    "a candidate that becomes genuinely ineligible on the post-failure re-query is reported not_reusable",
    "a post-failure loss of event.nearby.manage authority re-raises generically and is never not_reusable",
    "no failed association -- collapsed or generic -- ever leaves a partial Event row",
  ]) {
    assert.ok(
      FIXTURE.includes(evidence),
      `linked fixture must prove: ${evidence}`,
    );
  }
});
