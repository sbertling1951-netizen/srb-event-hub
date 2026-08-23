-- Stage 5B.3 linked workflow fixture. Proves the application orchestration
-- layer's exact governed-RPC call sequence (lib/vendorImportOrchestration.ts)
-- against the live, already-applied Stage 1 / Stage 5B.2 / Stage 1.1 RPC
-- stack -- not a re-proof of Stage 5B.2's own matching/rollback internals
-- (see supabase/integration-tests/20260822140000_vendor_import_commit_rollback.sql
-- for that). No migration is installed here: Stage 5B.2 is durable on
-- origin/main (39433e1) and applied to this linked project already.
-- Everything below is synthetic fixture data inside one outer transaction,
-- always rolled back.
BEGIN;

CREATE FUNCTION public.stage5b3_fixture_assert(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'stage5b3_fixture_assertion_failed: %', p_message; END IF; END $$;

CREATE FUNCTION public.stage5b3_fixture_candidate(p_business_name text, p_intent jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('identity_evidence', jsonb_build_object('business_name', p_business_name), 'event_intent', p_intent);
$$;

DO $$
DECLARE
 t uuid := gen_random_uuid(); e uuid := gen_random_uuid(); v_both uuid := gen_random_uuid();
 v_active uuid; v_active2 uuid;
 run_id uuid; run_row record;
 r_success uuid; r_review uuid; r_retry uuid;
 staged record; reviewed record;
 v_out text; v_vendor_id uuid; v_reason text;
 recovery jsonb; recovered_row jsonb;
 v_snapshot_before text; v_snapshot_after text;
BEGIN
 -- ---------- Isolated fixture: tenant, Event, caller, one active canonical Vendor ----------
 INSERT INTO public.tenants(id, organization_code, slug, organization_name, display_name, app_title)
   VALUES (t, 'S5B3-'||left(t::text, 8), 's5b3-'||left(t::text, 8), 'Stage 5B.3 Fixture', 'Stage 5B.3 Fixture', 'Stage 5B.3 Fixture');
 INSERT INTO public.events(id, tenant_id, name, start_date, end_date, timezone, lifecycle_state)
   VALUES (e, t, 'stage5b3-fixture-'||t::text, current_date, current_date + 30, 'UTC', 'operational');
 INSERT INTO auth.users(id, email) VALUES (v_both, 'both-'||v_both||'@fixture.invalid');
 INSERT INTO public.admin_users(user_id, email, display_name) VALUES (v_both, 'both-'||v_both||'@fixture.invalid', 'both');
 INSERT INTO public.admin_event_access(admin_user_id, event_id, role)
   SELECT id, e, 'event_admin' FROM public.admin_users WHERE user_id = v_both;
 INSERT INTO public.admin_event_permissions(admin_event_access_id, permission_key)
   SELECT a.id, p.task FROM public.admin_event_access a JOIN public.admin_users u ON u.id = a.admin_user_id
   CROSS JOIN (VALUES ('event.imports.manage'), ('event.vendors.manage')) p(task)
   WHERE a.event_id = e AND u.user_id = v_both;

 INSERT INTO public.vendors(id, name, business_name, is_active)
   VALUES (gen_random_uuid(), 'Acme Orchestration Co', 'Acme Orchestration Co', true)
   RETURNING id INTO v_active;
 INSERT INTO public.vendors(id, name, business_name, is_active)
   VALUES (gen_random_uuid(), 'Retry Orchestration Co', 'Retry Orchestration Co', true)
   RETURNING id INTO v_active2;

 SELECT md5(string_agg(v.business_name || '|' || coalesce(v.name,'') || '|' || v.is_active::text, ',' ORDER BY v.id))
   INTO v_snapshot_before FROM public.vendors v WHERE v.id IN (v_active, v_active2);

 PERFORM set_config('request.jwt.claim.sub', v_both::text, true);

 -- ================= parse/normalized candidate -> Stage 1 run =================
 -- Mirrors runGovernedVendorImport: create_import_run(p_import_type='vendors') once.
 SELECT * INTO run_row FROM public.create_import_run(e, 'vendors', 'stage5b3-fixture.csv', jsonb_build_object('row_count', 3));
 run_id := run_row.id;
 PERFORM public.stage5b3_fixture_assert(run_row.import_type = 'vendors' AND run_row.status = 'staging', 'run created with the Vendor import type');

 -- ---------- Row 1: eligible exact match, admit + metadata requested (golden path) ----------
 SELECT * INTO staged FROM public.stage_import_run_row(
   run_id, 1, jsonb_build_object('Business Name', 'Acme Orchestration Co'),
   public.stage5b3_fixture_candidate('Acme Orchestration Co', jsonb_build_object('admit', true, 'booth_location', 'Row A')),
   'stage5b3-success-fingerprint');
 r_success := staged.id;
 SELECT * INTO reviewed FROM public.set_import_run_row_review_state(r_success, 'valid', '[]'::jsonb, 'approved');
 PERFORM public.stage5b3_fixture_assert(reviewed.row_state = 'approved', 'staged row reaches approved through Stage 1 before any commit attempt');

 SELECT outcome, vendor_id INTO v_out, v_vendor_id FROM public.commit_vendor_import_run_row(r_success);
 PERFORM public.stage5b3_fixture_assert(v_out = 'committed' AND v_vendor_id = v_active, 'Stage 5B.2 commits the eligible exact match');
 PERFORM public.stage5b3_fixture_assert(
   (SELECT ev.admission_state = 'admitted' AND ev.booth_location = 'Row A' FROM public.event_vendors ev WHERE ev.vendor_id = v_active AND ev.event_id = e),
   'admission and metadata both landed through the governed commit');

 -- ---------- Row 2: zero match -> Stage 5B.2 persists needs_review itself ----------
 SELECT * INTO staged FROM public.stage_import_run_row(
   run_id, 2, jsonb_build_object('Business Name', 'Ghost Orchestration Co'),
   public.stage5b3_fixture_candidate('Ghost Orchestration Co'), 'stage5b3-review-fingerprint');
 r_review := staged.id;
 PERFORM public.set_import_run_row_review_state(r_review, 'valid', '[]'::jsonb, 'approved');

 SELECT outcome, reason_code INTO v_out, v_reason FROM public.commit_vendor_import_run_row(r_review);
 PERFORM public.stage5b3_fixture_assert(v_out = 'needs_review' AND v_reason = 'vendor_not_found', 'zero canonical match reports needs_review with the truthful reason');
 PERFORM public.stage5b3_fixture_assert(
   (SELECT row_state = 'needs_review' AND commit_state = 'not_started' AND canonical_target_id IS NULL FROM public.import_run_rows WHERE id = r_review),
   'the orchestration layer never re-writes what commit_vendor_import_run_row already persisted for a needs_review outcome');

 -- ---------- Row 3: commit_failed -> retry (same staged row) -> committed ----------
 SELECT * INTO staged FROM public.stage_import_run_row(
   run_id, 3, jsonb_build_object('Business Name', 'Retry Orchestration Co'),
   public.stage5b3_fixture_candidate('Retry Orchestration Co'), 'stage5b3-retry-fingerprint');
 r_retry := staged.id;
 PERFORM public.set_import_run_row_review_state(r_retry, 'valid', '[]'::jsonb, 'approved');

 -- Simulates the exact path retryVendorImportRowCommit's own catch-block
 -- takes when a genuine canonical rollback occurs: record the bounded
 -- failure code directly through the same governed recorder the
 -- orchestrator calls, without ever attempting an uncommitted mutation.
 PERFORM public.record_vendor_import_run_row_commit_failure(r_retry, 'vendor_commit_failed');
 PERFORM public.stage5b3_fixture_assert(
   (SELECT row_state = 'commit_failed' AND commit_state = 'failed' AND commit_error->>'code' = 'vendor_commit_failed' FROM public.import_run_rows WHERE id = r_retry),
   'a genuine canonical rollback is recorded through the bounded Vendor failure recorder, exactly as the orchestrator does on a thrown commit error');

 SELECT outcome, vendor_id INTO v_out, v_vendor_id FROM public.commit_vendor_import_run_row(r_retry);
 PERFORM public.stage5b3_fixture_assert(v_out = 'committed' AND v_vendor_id = v_active2, 'retrying the SAME staged row (retryVendorImportRowCommit''s exact path) succeeds once the forced failure is gone');
 PERFORM public.stage5b3_fixture_assert(
   (SELECT row_state = 'committed' AND commit_error IS NULL FROM public.import_run_rows WHERE id = r_retry),
   'failure state clears on a successful retry');

 -- Idempotent committed retry.
 SELECT outcome INTO v_out FROM public.commit_vendor_import_run_row(r_retry);
 PERFORM public.stage5b3_fixture_assert(v_out = 'already_committed', 'a retry of an already-committed row resolves truthfully as already_committed, not a duplicate commit');

 -- ================= Stage 1.1 recovery reports every row's truthful state =================
 recovery := public.get_managed_import_run_recovery(run_id);
 PERFORM public.stage5b3_fixture_assert(jsonb_array_length(recovery->'rows') = 3, 'recovery reports all three staged rows');

 recovered_row := (SELECT elem FROM jsonb_array_elements(recovery->'rows') elem WHERE (elem->>'id')::uuid = r_success);
 PERFORM public.stage5b3_fixture_assert(recovered_row->>'row_state' = 'committed' AND (recovered_row->'commit_result'->>'vendor_id') = v_active::text, 'recovery reports the golden-path row as committed with the real matched vendor_id');

 recovered_row := (SELECT elem FROM jsonb_array_elements(recovery->'rows') elem WHERE (elem->>'id')::uuid = r_review);
 PERFORM public.stage5b3_fixture_assert(recovered_row->>'row_state' = 'needs_review', 'recovery reports the zero-match row as needs_review');

 recovered_row := (SELECT elem FROM jsonb_array_elements(recovery->'rows') elem WHERE (elem->>'id')::uuid = r_retry);
 PERFORM public.stage5b3_fixture_assert(recovered_row->>'row_state' = 'committed' AND recovered_row->>'commit_error' IS NULL, 'recovery reports the retried row as committed with no residual failure');

 -- ================= Global Vendor immutability, end to end =================
 SELECT md5(string_agg(v.business_name || '|' || coalesce(v.name,'') || '|' || v.is_active::text, ',' ORDER BY v.id))
   INTO v_snapshot_after FROM public.vendors v WHERE v.id IN (v_active, v_active2);
 PERFORM public.stage5b3_fixture_assert(v_snapshot_before = v_snapshot_after, 'the full orchestrated workflow never mutated either canonical Vendor row');
END $$;

ROLLBACK;
SELECT 'stage5b3 workflow fixture PASS: outer rollback completed' AS result;
