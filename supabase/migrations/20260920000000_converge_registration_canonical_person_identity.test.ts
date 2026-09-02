import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level tests for the permanent registration <-> canonical-person
// convergence migration, incl. the Doug blocker-remediation pass:
//   1. durable failure observability (issue table + subtransaction rollback)
//   2. order-independent shared-destination handling (POLICY 1, guard removed)
//   3. one canonical phone/name/email normalizer used everywhere
// Behavioural proof:
//   supabase/integration-tests/20260920000000_registration_identity_convergence_behavior.sql

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260920000000_converge_registration_canonical_person_identity.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const EXEC = SQL.replace(/--.*$/gm, "");

function bodyOf(name: string): string {
  const start = EXEC.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start > -1, `expected CREATE OR REPLACE for ${name}`);
  const end = EXEC.indexOf("$$;", start);
  assert.ok(end > start, `expected terminated body for ${name}`);
  return EXEC.slice(start, end + 3);
}

test("transactional envelope + postgres-owner + authority prerequisites guard", () => {
  assert.match(EXEC, /^\s*BEGIN;/);
  assert.match(EXEC, /COMMIT;\s*$/);
  assert.match(EXEC, /IF current_user <> 'postgres' THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(EXEC, /prerequisite missing: authority primitives/);
});

test("does NOT touch resolve_member_account / TEA / add an email fallback", () => {
  assert.equal(/FUNCTION public\.resolve_member_account/.test(EXEC), false);
  assert.equal(/verify_member_event_login/.test(EXEC), false);
  assert.equal(/resolve_temporary_or_authenticated_attendee/.test(EXEC), false);
});

// ---- Doug blocker 3: one normalizer -------------------------------------

test("blocker 3: exactly one phone/name/email normalizer, IMMUTABLE, reused everywhere", () => {
  for (const fn of [
    "_identity_convergence_norm_name",
    "_identity_convergence_norm_email",
    "_identity_convergence_norm_phone",
  ]) {
    const b = bodyOf(fn);
    assert.match(b, /IMMUTABLE/, `${fn} must be IMMUTABLE`);
  }
  // the 11-digit leading-1 strip lives ONLY in _norm_phone
  const normPhone = bodyOf("_identity_convergence_norm_phone");
  assert.match(normPhone, /= 11[\s\S]*left\(regexp_replace/);
  // and NO other function re-implements a raw phone regex
  const rawPhoneRegex = /regexp_replace\([^)]*'\[\^0-9\]'/g;
  const offenders = [
    "_identity_convergence_controlled_destinations",
    "_identity_convergence_resolve_role",
    "reconcile_attendee_registration_identity",
    "reconcile_my_member_registrations",
  ].filter((fn) => rawPhoneRegex.test(bodyOf(fn)));
  assert.deepEqual(offenders, [], `raw phone regex leaked into: ${offenders.join(", ")}`);
  // every phone comparison goes through the normalizer
  assert.match(bodyOf("_identity_convergence_controlled_destinations"), /_identity_convergence_norm_phone\(u\.phone\)/);
  assert.match(bodyOf("reconcile_my_member_registrations"), /_identity_convergence_norm_phone\(/);
});

// ---- Doug blocker 1: durable failure observability ----------------------

test("blocker 1: durable issue table -- RLS on, default-deny, dedupe index", () => {
  assert.match(EXEC, /CREATE TABLE IF NOT EXISTS public\.registration_identity_convergence_issues/);
  assert.match(EXEC, /issue_type text NOT NULL[\s\S]*'ENGINE_ERROR'[\s\S]*'IDENTITY_CONFLICT'[\s\S]*'IDENTITY_AMBIGUITY'/);
  assert.match(EXEC, /ALTER TABLE public\.registration_identity_convergence_issues ENABLE ROW LEVEL SECURITY;/);
  assert.match(EXEC, /REVOKE ALL ON TABLE public\.registration_identity_convergence_issues\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/);
  // one open row per (attendee, type, role-key)
  assert.match(
    EXEC,
    /CREATE UNIQUE INDEX[\s\S]*registration_identity_convergence_issues_open_dedupe[\s\S]*attendee_id, issue_type, coalesce\(source_role_instance_key, ''\)[\s\S]*WHERE status = 'open'/,
  );
});

test("blocker 1: engine wraps mutation in a subtransaction and records the failure OUTSIDE it", () => {
  const engine = bodyOf("reconcile_attendee_registration_identity");
  // subtransaction handler capturing SQLSTATE + message
  assert.match(engine, /EXCEPTION WHEN OTHERS THEN/);
  assert.match(engine, /v_engine_error := true;/);
  assert.match(engine, /GET STACKED DIAGNOSTICS/);
  assert.match(engine, /v_err_sqlstate = RETURNED_SQLSTATE/);
  // the ENGINE_ERROR issue write is gated on v_engine_error and happens
  // AFTER the handler completes (outer body)
  const handlerIdx = engine.indexOf("GET STACKED DIAGNOSTICS");
  const guardResetIdx = engine.indexOf("identity_convergence_active', 'false'", handlerIdx);
  const recordIdx = engine.indexOf("'ENGINE_ERROR', v_err_sqlstate");
  assert.ok(handlerIdx > -1 && guardResetIdx > handlerIdx && recordIdx > guardResetIdx,
    "ENGINE_ERROR must be recorded in the outer body after the handler + guard reset");
  // issue recording never runs inside the rolled-back sub-block (before the handler)
  const forLoopIdx = engine.indexOf("FOR v_role IN");
  const handlerStart = engine.indexOf("EXCEPTION WHEN OTHERS THEN");
  assert.equal(
    /_identity_convergence_record_issue/.test(engine.slice(forLoopIdx, handlerStart)),
    false,
    "issue recording must never run inside the sub-block",
  );
  // the engine never re-raises
  assert.equal(/RAISE\s+EXCEPTION/.test(engine), false);
});

test("blocker 1: recorder dedupes (occurrence_count++)", () => {
  const rec = bodyOf("_identity_convergence_record_issue");
  assert.match(rec, /ON CONFLICT \(attendee_id, issue_type, coalesce\(source_role_instance_key, ''\)\)/);
  assert.match(rec, /WHERE status = 'open'/);
  assert.match(rec, /occurrence_count = [\s\S]{0,90}\+ 1/);
});

test("double-failure fallback: recorder failure -> ONE bounded WARNING, never re-raised, PII-free", () => {
  // executable proof: scripts/verify-convergence-double-failure.sh (TEST O2)
  const rec = bodyOf("_identity_convergence_record_issue");
  // the recorder's OWN failure is captured and warned, not re-raised
  assert.match(rec, /GET STACKED DIAGNOSTICS/);
  assert.match(rec, /v_rec_sqlstate = RETURNED_SQLSTATE/);
  assert.match(rec, /RAISE WARNING/);
  assert.match(rec, /durable issue persistence FAILED/);
  assert.equal(/RAISE\s+EXCEPTION/.test(rec), false, "recorder must never raise an exception");
  // bounded, safe fields only -- SQLSTATEs + ids, bounded recorder error text
  assert.match(rec, /attendee_id=% event_id=% issue_type=%/);
  assert.match(rec, /original_sqlstate=% recorder_sqlstate=%/);
  assert.match(rec, /left\(coalesce\(v_rec_message, ''\), 300\)/);
  // explicitly NOT the caller-supplied detail / any PII column name in the WARNING
  const warnBlock = rec.slice(rec.indexOf("RAISE WARNING"), rec.indexOf("RAISE WARNING") + 700);
  assert.equal(/p_detail|p_evidence_person_id|email|phone|first_name|pilot_|display_/i.test(warnBlock), false);
  // even the WARNING path is wrapped so it can never abort the registration
  const warnHandler = rec.slice(rec.indexOf("RAISE WARNING"));
  assert.match(warnHandler, /EXCEPTION WHEN OTHERS THEN[\s\S]{0,120}NULL;/);
  // the same treatment is applied to the sibling auto-resolve helper
  const res = bodyOf("_identity_convergence_resolve_open_issues");
  assert.match(res, /RAISE WARNING/);
  assert.match(res, /stale-issue auto-resolve FAILED/);
  assert.equal(/RAISE\s+EXCEPTION/.test(res), false);
});

test("blocker 1: explicit conflicts + ambiguity are recorded; benign no-match is not", () => {
  const engine = bodyOf("reconcile_attendee_registration_identity");
  // CASE 3 (attendees.person_id) and CASE 5 (existing PRI vs new evidence)
  assert.match(engine, /existing role instance is attributed to a different canonical person/);
  assert.match(engine, /attendees\.person_id already bound to a different canonical person/);
  // ambiguity ONLY when candidate_count > 1
  assert.match(engine, /IF v_candidate_count > 1 THEN/);
  assert.match(engine, /IDENTITY_AMBIGUITY/);
  // ENGINE_ERROR + CONFLICT + AMBIGUITY are the only issue types emitted
  assert.match(engine, /'ENGINE_ERROR'/);
  assert.match(engine, /'IDENTITY_CONFLICT'/);
});

// ---- Doug blocker 2: order independence / POLICY 1 ---------------------

test("blocker 2: the insertion-order-dependent shared-identifier guard is GONE", () => {
  assert.equal(
    /identifier_shared_with_other_name/.test(SQL),
    false,
    "the over-conservative shared-identifier guard must be removed (POLICY 1)",
  );
  assert.equal(
    /roles\.f <> v_role\.n_first OR roles\.l <> v_role\.n_last/.test(SQL),
    false,
    "no cross-role name-conflict scan remains",
  );
  // POLICY is stated explicitly in the header comment
  assert.match(SQL, /SHARED-DESTINATION POLICY[\s\S]*POLICY 1/);
  assert.match(SQL, /order-independent by[\s\S]{0,40}construction/);
});

test("blocker 2: an existing PRI is never re-pointed; later mismatched evidence -> IDENTITY_CONFLICT", () => {
  const engine = bodyOf("reconcile_attendee_registration_identity");
  assert.match(
    engine,
    /IF FOUND THEN\s*\n\s*IF v_resolved_person_id IS NOT NULL\s*\n\s*AND v_existing_pri\.person_id <> v_resolved_person_id THEN/,
  );
  // consistent / unresolvable -> just ensure PEP + clear stale issues
  assert.match(engine, /establish_person_event_participation_from_role_instance\(\s*\n\s*v_existing_pri\.id/);
  assert.match(engine, /_identity_convergence_resolve_open_issues\(v_att\.id, v_key\)/);
});

test("resolver returns candidate_count so 0 (benign) is distinct from >1 (ambiguous)", () => {
  assert.match(EXEC, /DROP FUNCTION IF EXISTS public\._identity_convergence_resolve_role\(text, text, text, text\);/);
  const r = bodyOf("_identity_convergence_resolve_role");
  assert.match(r, /RETURNS TABLE\(resolved_person_id uuid, candidate_count integer\)/);
  assert.match(r, /IF candidate_count = 1 THEN\s*\n\s*resolved_person_id := v_person_ids\[1\]/);
});

test("controlled destinations remain proof-of-possession only", () => {
  const d = bodyOf("_identity_convergence_controlled_destinations");
  assert.match(d, /email_confirmed_at IS NOT NULL/);
  assert.match(d, /phone_confirmed_at IS NOT NULL/);
  assert.equal(/person_identifiers/.test(d), false);
});

test("attendees.person_id PILOT-only bridge, guarded on NULL; participation delegated", () => {
  const engine = bodyOf("reconcile_attendee_registration_identity");
  assert.match(engine, /IF v_role\.identity_role = 'PILOT' THEN\s*\n\s*UPDATE public\.attendees\s*\n\s*SET person_id = v_resolved_person_id\s*\n\s*WHERE id = v_att\.id\s*\n\s*AND person_id IS NULL/);
  assert.match(engine, /establish_person_event_participation_from_role_instance\(\s*\n\s*v_new_pri_id/);
  assert.equal(/INSERT INTO public\.person_event_participations/.test(EXEC), false);
  assert.match(engine, /ON CONFLICT \(source_role_instance_key\) DO NOTHING/);
});

test("re-entrancy guard is set in the OUTER context so it survives an inner rollback", () => {
  const engine = bodyOf("reconcile_attendee_registration_identity");
  const guardOn = engine.indexOf("identity_convergence_active', 'true'");
  const forLoop = engine.indexOf("FOR v_role IN");
  const handler = engine.indexOf("EXCEPTION WHEN OTHERS THEN");
  const guardOffAfterHandler = engine.indexOf("identity_convergence_active', 'false'", handler);
  assert.ok(guardOn > -1 && guardOn < forLoop, "guard must be enabled before the loop / sub-block");
  assert.ok(guardOffAfterHandler > handler, "guard reset must be in the outer body after the handler");
});

test("member recovery RPC: authority internal, no client person_id, normalizer-based scan", () => {
  const rpc = bodyOf("reconcile_my_member_registrations");
  assert.match(rpc, /v_uid uuid := auth\.uid\(\)/);
  assert.match(rpc, /resolve_auth_person_link\(v_uid\)/);
  assert.match(rpc, /v_link_status IS DISTINCT FROM 'resolved'/);
  assert.equal(/\bp_person_id\b/.test(rpc), false);
  assert.match(rpc, /_identity_convergence_norm_email\(a\.email\)/);
});

test("governed operator read RPC is authority-gated (event task OR platform admin)", () => {
  const rpc = bodyOf("list_registration_identity_convergence_issues");
  assert.match(rpc, /has_event_task_authority\('event\.attendees\.manage', p_event_id\)/);
  assert.match(rpc, /has_platform_admin_authority\(v_uid\)/);
  assert.match(rpc, /RAISE EXCEPTION 'authentication required'/);
});

test("grants: helpers/engine/recorder postgres-only; only the two RPCs granted", () => {
  for (const fn of [
    "public._identity_convergence_norm_name(text)",
    "public._identity_convergence_norm_email(text)",
    "public._identity_convergence_norm_phone(text)",
    "public._identity_convergence_person_name_variants(uuid)",
    "public._identity_convergence_controlled_destinations(uuid)",
    "public._identity_convergence_resolve_role(text, text, text, text)",
    "public._identity_convergence_record_issue(uuid, uuid, uuid, text, text, text, text, uuid, uuid, uuid)",
    "public._identity_convergence_resolve_open_issues(uuid, text)",
    "public.reconcile_attendee_registration_identity(uuid, uuid)",
    "public.tg_reconcile_attendee_identity()",
    "public.reconcile_my_member_registrations()",
    "public.list_registration_identity_convergence_issues(uuid, text)",
  ]) {
    assert.ok(EXEC.includes(`ALTER FUNCTION ${fn} OWNER TO postgres;`), `${fn} owner`);
    assert.ok(
      EXEC.includes(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated, service_role;`),
      `${fn} revoke`,
    );
  }
  assert.match(EXEC, /GRANT EXECUTE ON FUNCTION public\.reconcile_my_member_registrations\(\) TO authenticated;/);
  assert.match(EXEC, /GRANT EXECUTE ON FUNCTION public\.list_registration_identity_convergence_issues\(uuid, text\) TO authenticated;/);
  assert.equal(
    /GRANT EXECUTE ON FUNCTION public\.reconcile_attendee_registration_identity/.test(EXEC),
    false,
  );
});

test("triggers on both registration tables, identity-column-gated", () => {
  assert.match(EXEC, /CREATE TRIGGER reconcile_attendee_identity_after_write\s*\n\s*AFTER INSERT OR UPDATE ON public\.attendees/);
  assert.match(EXEC, /CREATE TRIGGER reconcile_household_identity_after_write\s*\n\s*AFTER INSERT OR UPDATE ON public\.attendee_household_members/);
  const tg = bodyOf("tg_reconcile_attendee_identity");
  for (const col of ["pilot_first", "email", "cell_phone", "copilot_email", "person_id", "first_name", "attendee_id"]) {
    assert.ok(tg.includes(col), `trigger should gate on ${col}`);
  }
});

test("backfill reports linked / conflict / ambiguity / engine-error, no hardcoded identifiers", () => {
  assert.match(EXEC, /FOR v_attendee_id IN\s*\n\s*SELECT id FROM public\.attendees/);
  assert.match(EXEC, /% linked, % conflict, % ambiguity, % engine-error/);
  assert.equal(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(EXEC),
    false,
  );
  assert.equal(/fcoc|freightliner|gulf shores|lakeland|bertling/i.test(EXEC), false);
});

test("attribution_method CHECK widened additively", () => {
  assert.match(
    EXEC,
    /CHECK \(attribution_method IN \(\s*\n\s*'automatic_backfill',\s*\n\s*'member_claim_verified',\s*\n\s*'registration_lifecycle_convergence'\s*\n\s*\)\)/,
  );
});
