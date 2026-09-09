-- Catalog P2 linked-database behavior proof: an optional, owner-private
-- Registry Provider Catalog search and attachment inside the existing
-- private Registry Plan.
--
-- Run only after 20260924000000 … 20261009000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- NOT EXECUTED as part of this task: per the CMD-LEM's explicit instruction,
-- this fixture was written to repository convention but was NOT run against
-- any database. It is a proof artifact for a separately authorized
-- execution step.
--
-- ONE KNOWN LIMITATION, stated honestly rather than silently assumed: the
-- "concurrent selection/deactivation" requirement is proven here as two
-- SEPARATE, serialized orderings inside one connection (deactivate-then-
-- attach, and attach-then-deactivate) -- each individually exercises the
-- exact lock-and-check code path a true two-backend race would hit, and
-- together they cover both of the two allowed outcomes ("selection
-- completes with its save-time snapshot before retirement" / "selection
-- fails because the asset is inactive"). A genuine two-session race is not
-- reasonably exercised inside one psql script and is not attempted here.
--
-- It proves:
--   1.  strict identity: search / attach / detach / list-with-catalog all
--       refuse a no_link or invalid_or_ambiguous caller with the bare
--       'identity_resolution_required' sentinel -- while the SAME no_link
--       identity's ORDINARY Registry Plan (list/add/update/delete,
--       untouched by this migration) keeps working exactly as before;
--   2.  search: blank / one character / '%' / '_' all return zero rows
--       (never a browse or a wildcard); a real two-character-or-more query
--       returns only active assets, alphabetically, capped at 10, with
--       exactly the four approved columns; an inactive asset never appears;
--   3.  attach captures the asset id + a three-field snapshot atomically,
--       preserves the entry's typed name/URL/note/status untouched, and
--       writes exactly one 'attached' audit row;
--   4.  replace is explicit, captures a NEW snapshot, and writes a
--       'replaced' (not 'attached') audit row;
--   5.  an ORDINARY update_my_private_draft_registry_plan call (untouched by
--       this migration) never clears or changes an existing snapshot;
--   6.  detach clears ONLY the four catalog columns, preserves every
--       ordinary field, writes exactly one 'detached' audit row, and a
--       second detach on an already-clear entry writes NO further audit row;
--   7.  a catalog CORRECTION, then a DEACTIVATION, then a REACTIVATION of the
--       attached asset never rewrites the existing snapshot -- it keeps
--       showing the values captured at attach time throughout;
--   8.  a deactivated asset cannot be newly searched or newly attached;
--       reactivating it makes it searchable/attachable again;
--   9.  a genuine other-tenant Tenant Administrator appointment does not
--       authorize any Catalog P2 operation on someone else's Draft;
--  10.  direct table access to the new audit table is unavailable to every
--       browser role, and no RPC reads it;
--  11.  deleting the Draft removes the registry-plan row (and therefore its
--       reference/snapshot) while the catalog assets and the OTHER
--       organizer's Draft survive untouched;
--  12.  no vendor / venue / budget / checklist / people / event / tenant
--       row is created, changed, or read by any Catalog P2 action;
--  13.  Pap's approved multi-entry rule: an organizer may hold any number of
--       Registry Plan entries; attach/replace/detach on ONE entry never
--       creates, reads, or mutates another entry's typed fields OR its own
--       independent catalog selection -- proven with two entries in the
--       same Draft, attached to different providers, one explicitly
--       replaced and then detached while the other is asserted untouched
--       at every step.

BEGIN;

CREATE OR REPLACE FUNCTION public.p2_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Catalog P2 fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p2_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p2_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2_plan_row(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT to_jsonb(rp) FROM public.self_service_private_draft_registry_plans AS rp WHERE rp.id = p_id;
$function$;
ALTER FUNCTION public.p2_plan_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2_plan_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2_plan_row(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2_audit_count_for(p_registry_plan_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.registry_plan_catalog_selection_audit
  WHERE registry_plan_id = p_registry_plan_id;
$function$;
ALTER FUNCTION public.p2_audit_count_for(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2_audit_count_for(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2_audit_count_for(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2_latest_audit_action(p_registry_plan_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  -- now() is frozen for this whole fixture transaction; cmin (cast through
  -- text to bigint, since cid has no ordering operator) is this
  -- transaction's own advancing per-command counter -- reliable here because
  -- the audit table is guaranteed empty before this transaction begins.
  SELECT action FROM public.registry_plan_catalog_selection_audit
  WHERE registry_plan_id = p_registry_plan_id
  ORDER BY (cmin::text)::bigint DESC LIMIT 1;
$function$;
ALTER FUNCTION public.p2_latest_audit_action(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2_latest_audit_action(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2_latest_audit_action(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2_untouched_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'vendor_plans', (SELECT count(*) FROM public.self_service_private_draft_vendor_plans),
    'venue_plans', (SELECT count(*) FROM public.self_service_private_draft_venue_plans),
    'budget_lines', (SELECT count(*) FROM public.self_service_private_draft_budget_lines),
    'checklist_items', (SELECT count(*) FROM public.self_service_private_draft_checklist_items),
    'vendors', (SELECT count(*) FROM public.vendors),
    'event_vendors', (SELECT count(*) FROM public.event_vendors)
  );
$function$;
ALTER FUNCTION public.p2_untouched_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2_untouched_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2_untouched_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p2_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p2_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2_event_exists(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p2_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p2_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p2_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p2_link(uuid, uuid, boolean) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
  v_ordinary_tenant uuid;
  v_ordinary_admin_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '96c00000-0000-4000-8000-000000000001', '96c00000-0000-4000-8000-000000000002',
    '96c00000-0000-4000-8000-000000000003', '96c00000-0000-4000-8000-000000000004',
    '96c00000-0000-4000-8000-000000000005', '96c00000-0000-4000-8000-000000000006'
  )) THEN
    RAISE EXCEPTION 'Catalog P2 fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('96c00000-0000-4000-8000-000000000001', 'p2-alice@fixture.invalid', now()),   -- resolved organizer
    ('96c00000-0000-4000-8000-000000000002', 'p2-bob@fixture.invalid', now()),     -- resolved, second Draft
    ('96c00000-0000-4000-8000-000000000003', 'p2-nolink@fixture.invalid', now()),  -- no_link organizer
    ('96c00000-0000-4000-8000-000000000004', 'p2-ambiguous@fixture.invalid', now()), -- invalid_or_ambiguous
    ('96c00000-0000-4000-8000-000000000005', 'p2-platform-admin@fixture.invalid', now()), -- Catalog P1 curator
    ('96c00000-0000-4000-8000-000000000006', 'p2-tenant-admin@fixture.invalid', now()); -- genuine OTHER-tenant Tenant Admin

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2_link(v_person, '96c00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2_link(v_person, '96c00000-0000-4000-8000-000000000002', true);
  -- no_link: an auth.users row with NO person_auth_accounts row at all.
  -- invalid_or_ambiguous: resolve_auth_person_link (20260801120800) computes
  -- v_link_count (all links for this auth_user_id) and v_valid_count (links
  -- where BOTH person_auth_accounts.status = 'active' AND people.status =
  -- 'active'), and returns 'invalid_or_ambiguous' for anything other than
  -- exactly (1, 1). person_auth_accounts.auth_user_id carries a GLOBAL
  -- UNIQUE index (person_auth_accounts_unique_auth_user_id_idx), so two
  -- people can never actually share one auth_user_id -- v_link_count can
  -- only ever be 0 or 1 in practice. The one reachable ambiguous case is
  -- v_link_count = 1 with v_valid_count = 0: a single link whose own status
  -- is not 'active'. 'disputed' is one of the two non-active values the
  -- person_auth_accounts_status_check constraint allows (the other,
  -- 'retired', requires a non-null retired_at).
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (v_person, '96c00000-0000-4000-8000-000000000004', 'disputed', true, now());

  -- The Catalog P1 Platform Administrator (super_admin, active).
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group, user_id)
  VALUES ('p2-platform-admin@fixture.invalid', true, true, 'super_admin', '96c00000-0000-4000-8000-000000000005');

  -- A GENUINE other-tenant Tenant Administrator: real person_tenant_administrator_appointments
  -- row, real active admin_users row (non-super_admin), for an ordinary
  -- (non-self-service-private-draft) tenant that has nothing to do with
  -- Alice's or Bob's private workspace.
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p2_link(v_person, '96c00000-0000-4000-8000-000000000006', true);
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p2-fixture-ordinary', 'p2-fixture-ordinary', 'P2 Ordinary Org', 'P2 Ordinary Org', 'P2 Ordinary Org')
  RETURNING id INTO v_ordinary_tenant;
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group, user_id)
  VALUES ('p2-tenant-admin@fixture.invalid', true, false, 'event_admin', '96c00000-0000-4000-8000-000000000006')
  RETURNING id INTO v_ordinary_admin_id;
  INSERT INTO public.person_tenant_administrator_appointments (person_id, tenant_id, is_active, activated_at)
  VALUES (v_person, v_ordinary_tenant, true, now());
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_untouchable jsonb;
  v_da record; v_db record;
  v_da_event uuid; v_db_event uuid;
  v_entry record; v_edited record; v_attached record; v_replaced record; v_detached record;
  v_asset_a record; v_asset_b record; v_asset_inactive record;
  v_results jsonb; v_count integer; v_failed boolean;
  v_i integer; v_bulk_asset record;
  -- MULTI-ENTRY (Pap's approved product rule): two DISTINCT Registry Plan
  -- entries, never reused as v_entry, which the rest of this fixture
  -- exercises alone.
  v_multi_a record; v_multi_b record; v_asset_c record;
BEGIN
  -- ================================================================
  -- Two organizer Drafts, and three catalog assets (two active, one
  -- inactive), created as the Platform Administrator via the UNTOUCHED
  -- Catalog P1 RPCs.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Alice Org', p_event_name => 'Alice Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '96bccc00-0000-4000-8000-000000000001',
    p_start_date => NULL, p_location_mode => 'no_location',
    p_location => NULL, p_starter_template => 'casual'
  );
  v_da_event := v_da.event_id;

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Bob Org', p_event_name => 'Bob Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '96bccc00-0000-4000-8000-000000000002',
    p_start_date => NULL, p_location_mode => 'no_location',
    p_location => NULL, p_starter_template => 'casual'
  );
  v_db_event := v_db.event_id;

  v_untouchable := public.p2_untouched_counts();

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  SELECT * INTO v_asset_a FROM public.create_registry_provider_catalog_asset(
    'Acme Gift Registry', 'A general-purpose gift registry.', 'https://acme-registry.example.com');
  PERFORM public.set_registry_provider_catalog_asset_active_status(v_asset_a.id, 0, true);

  SELECT * INTO v_asset_b FROM public.create_registry_provider_catalog_asset(
    'Acme Home Goods', 'A home-goods registry provider.', 'https://acme-home.example.com');
  PERFORM public.set_registry_provider_catalog_asset_active_status(v_asset_b.id, 0, true);

  SELECT * INTO v_asset_inactive FROM public.create_registry_provider_catalog_asset(
    'Acme Camping Registry', 'Stays inactive throughout.', 'https://acme-camp.example.com');
  -- deliberately left inactive

  -- 11 more active assets sharing the "Zzz" prefix, to prove the 10-result cap.
  FOR v_i IN 1..11 LOOP
    SELECT * INTO v_bulk_asset FROM public.create_registry_provider_catalog_asset(
      'Zzz Registry ' || lpad(v_i::text, 2, '0'), 'Bulk cap-test provider.', 'https://zzz.example.com/' || v_i);
    PERFORM public.set_registry_provider_catalog_asset_active_status(v_bulk_asset.id, 0, true);
  END LOOP;

  -- ================================================================
  -- Alice's registry-plan entry, via the UNTOUCHED add RPC.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_entry FROM public.add_my_private_draft_registry_plan(
    v_da_event, 'Aunt Ruth''s barn', 'https://example.com/our-real-registry', 'considering', 'a private note'
  );

  -- ================================================================
  -- 2: SEARCH -- blank / one char / '%' / '_' all return zero rows.
  -- ================================================================
  SELECT count(*) INTO v_count FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, '');
  PERFORM public.p2_assert(v_count = 0, 'a blank query returns zero rows -- never a browse');
  SELECT count(*) INTO v_count FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'A');
  PERFORM public.p2_assert(v_count = 0, 'a single character returns zero rows');
  SELECT count(*) INTO v_count FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, '%');
  PERFORM public.p2_assert(v_count = 0, '''%'' alone is an ordinary two-character-short query -- and is not a wildcard even at length');
  SELECT count(*) INTO v_count FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, '__');
  PERFORM public.p2_assert(v_count = 0, '''__'' matches no real provider name literally -- it is NOT a wildcard');

  -- A real two-character prefix: matches Acme Gift Registry + Acme Home
  -- Goods (both active), never Acme Camping Registry (inactive).
  SELECT jsonb_agg(provider_name ORDER BY provider_name) INTO v_results
  FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'ac');
  PERFORM public.p2_assert(
    v_results = '["Acme Gift Registry", "Acme Home Goods"]'::jsonb,
    'a real prefix returns only ACTIVE matches, alphabetically, and case-insensitively'
  );

  -- The 10-result cap against 11 active "Zzz" matches.
  SELECT count(*) INTO v_count FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'zz');
  PERFORM public.p2_assert(v_count = 10, 'results are capped at 10 even when 11 active assets match');

  -- ================================================================
  -- 3: ATTACH -- captures id + snapshot atomically, preserves typed fields,
  --    writes exactly one 'attached' audit row.
  -- ================================================================
  SELECT * INTO v_attached FROM public.attach_my_private_draft_registry_plan_catalog_selection(
    v_da_event, v_entry.id, v_asset_a.id
  );
  PERFORM public.p2_assert(
    v_attached.catalog_asset_id = v_asset_a.id
    AND v_attached.catalog_provider_name_snapshot = 'Acme Gift Registry'
    AND v_attached.catalog_description_snapshot = 'A general-purpose gift registry.'
    AND v_attached.catalog_website_snapshot = 'https://acme-registry.example.com',
    'attach captures the asset id and all three card fields atomically'
  );
  PERFORM public.p2_assert(
    v_attached.provider_name = 'Aunt Ruth''s barn'
    AND v_attached.registry_url = 'https://example.com/our-real-registry'
    AND v_attached.planning_status = 'considering'
    AND v_attached.organizer_note = 'a private note',
    'attach never overwrites the organizer''s typed provider name, URL, status, or note'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_entry.id) = 1, 'exactly one audit row was written');
  PERFORM public.p2_assert(public.p2_latest_audit_action(v_entry.id) = 'attached', 'the audit action is attached, not replaced');

  -- ================================================================
  -- 4: REPLACE -- explicit, captures a NEW snapshot, audits as 'replaced'.
  -- ================================================================
  SELECT * INTO v_replaced FROM public.attach_my_private_draft_registry_plan_catalog_selection(
    v_da_event, v_entry.id, v_asset_b.id
  );
  PERFORM public.p2_assert(
    v_replaced.catalog_asset_id = v_asset_b.id
    AND v_replaced.catalog_provider_name_snapshot = 'Acme Home Goods',
    'replace captures the NEW asset''s snapshot'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_entry.id) = 2, 'replace writes one more audit row');
  PERFORM public.p2_assert(public.p2_latest_audit_action(v_entry.id) = 'replaced', 'the audit action is replaced, not attached');

  -- ================================================================
  -- 13: MULTI-ENTRY -- Pap's approved product rule. An organizer may create
  --    any number of Registry Plan entries; each holds zero or one catalog
  --    selection, independent of every other entry's. Two BRAND NEW entries
  --    here (v_multi_a / v_multi_b) -- v_entry above, and everything that
  --    follows this block, is completely unaffected by any of it.
  -- ================================================================

  -- 1: two distinct entries, same organizer, same eligible private Draft.
  SELECT * INTO v_multi_a FROM public.add_my_private_draft_registry_plan(
    v_da_event, 'Multi-Entry Registry A', 'https://example.com/registry-a', 'considering', 'entry A note'
  );
  SELECT * INTO v_multi_b FROM public.add_my_private_draft_registry_plan(
    v_da_event, 'Multi-Entry Registry B', 'https://example.com/registry-b', 'contacted', 'entry B note'
  );
  PERFORM public.p2_assert(
    v_multi_a.id <> v_multi_b.id,
    'two distinct Registry Plan entries exist for the same organizer and Draft'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_a.id) = 0, 'Entry A starts with zero catalog audit rows');
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_b.id) = 0, 'Entry B starts with zero catalog audit rows');

  -- A third active asset with a name that matches neither the 'ac' nor the
  -- 'zz' search-prefix tests above/below, so its existence changes NONE of
  -- those exact result counts.
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  SELECT * INTO v_asset_c FROM public.create_registry_provider_catalog_asset(
    'Riverbend Registry Co.', 'A third, unrelated active provider for the replace step.', 'https://riverbend.example.com'
  );
  PERFORM public.set_registry_provider_catalog_asset_active_status(v_asset_c.id, 0, true);
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);

  -- 2: attach a provider to Entry A.
  SELECT * INTO v_multi_a FROM public.attach_my_private_draft_registry_plan_catalog_selection(
    v_da_event, v_multi_a.id, v_asset_a.id
  );
  PERFORM public.p2_assert(
    v_multi_a.catalog_asset_id = v_asset_a.id AND v_multi_a.catalog_provider_name_snapshot = 'Acme Gift Registry',
    'Entry A is attached to the first provider'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_a.id) = 1, 'Entry A has exactly one audit row');
  PERFORM public.p2_assert(public.p2_latest_audit_action(v_multi_a.id) = 'attached', 'Entry A''s audit action is attached');
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_b.id) = 0, 'attaching Entry A wrote NO audit row for Entry B');

  -- 3: attach a DIFFERENT provider to Entry B.
  SELECT * INTO v_multi_b FROM public.attach_my_private_draft_registry_plan_catalog_selection(
    v_da_event, v_multi_b.id, v_asset_b.id
  );
  PERFORM public.p2_assert(
    v_multi_b.catalog_asset_id = v_asset_b.id AND v_multi_b.catalog_provider_name_snapshot = 'Acme Home Goods',
    'Entry B is attached to a DIFFERENT provider than Entry A'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_b.id) = 1, 'Entry B has exactly one audit row');
  PERFORM public.p2_assert(public.p2_latest_audit_action(v_multi_b.id) = 'attached', 'Entry B''s audit action is attached');
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_a.id) = 1, 'Entry A''s audit count is unchanged by attaching Entry B');

  -- 4: replace Entry A's selection with a THIRD active provider.
  SELECT * INTO v_multi_a FROM public.attach_my_private_draft_registry_plan_catalog_selection(
    v_da_event, v_multi_a.id, v_asset_c.id
  );
  PERFORM public.p2_assert(
    v_multi_a.catalog_asset_id = v_asset_c.id
    AND v_multi_a.catalog_provider_name_snapshot = 'Riverbend Registry Co.'
    AND v_multi_a.catalog_description_snapshot = 'A third, unrelated active provider for the replace step.'
    AND v_multi_a.catalog_website_snapshot = 'https://riverbend.example.com',
    'Entry A''s selection is replaced with the third provider''s snapshot'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_a.id) = 2, 'Entry A has two audit rows: attached, replaced');
  PERFORM public.p2_assert(public.p2_latest_audit_action(v_multi_a.id) = 'replaced', 'Entry A''s latest audit action is replaced');

  -- 5: Entry B's catalog snapshot AND every typed field are byte-for-byte
  --    unchanged by Entry A's replace.
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_multi_b.id)->>'catalog_asset_id')::uuid = v_asset_b.id
    AND (public.p2_plan_row(v_multi_b.id)->>'catalog_provider_name_snapshot') = 'Acme Home Goods'
    AND (public.p2_plan_row(v_multi_b.id)->>'catalog_description_snapshot') = 'A home-goods registry provider.'
    AND (public.p2_plan_row(v_multi_b.id)->>'catalog_website_snapshot') = 'https://acme-home.example.com'
    AND (public.p2_plan_row(v_multi_b.id)->>'provider_name') = 'Multi-Entry Registry B'
    AND (public.p2_plan_row(v_multi_b.id)->>'registry_url') = 'https://example.com/registry-b'
    AND (public.p2_plan_row(v_multi_b.id)->>'planning_status') = 'contacted'
    AND (public.p2_plan_row(v_multi_b.id)->>'organizer_note') = 'entry B note',
    'Entry B''s catalog snapshot and every typed field are byte-for-byte unchanged by Entry A''s replace'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_b.id) = 1, 'Entry B''s audit count is unchanged by Entry A''s replace');

  -- 6: detach Entry A.
  SELECT * INTO v_multi_a FROM public.detach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_multi_a.id);
  PERFORM public.p2_assert(
    v_multi_a.catalog_asset_id IS NULL AND v_multi_a.catalog_provider_name_snapshot IS NULL
    AND v_multi_a.catalog_description_snapshot IS NULL AND v_multi_a.catalog_website_snapshot IS NULL,
    'Entry A''s catalog selection is cleared'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_a.id) = 3, 'Entry A has three audit rows: attached, replaced, detached');
  PERFORM public.p2_assert(public.p2_latest_audit_action(v_multi_a.id) = 'detached', 'Entry A''s latest audit action is detached');

  -- 7: Entry B remains attached and unchanged after Entry A is detached.
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_multi_b.id)->>'catalog_asset_id')::uuid = v_asset_b.id
    AND (public.p2_plan_row(v_multi_b.id)->>'catalog_provider_name_snapshot') = 'Acme Home Goods',
    'Entry B remains attached to its own provider after Entry A is detached'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_multi_b.id) = 1, 'Entry B''s audit count is unchanged by Entry A''s detach');

  -- 8: Entry A retains every typed field after detachment -- only its own
  --    catalog fields were cleared.
  PERFORM public.p2_assert(
    v_multi_a.provider_name = 'Multi-Entry Registry A'
    AND v_multi_a.registry_url = 'https://example.com/registry-a'
    AND v_multi_a.planning_status = 'considering'
    AND v_multi_a.organizer_note = 'entry A note',
    'Entry A retains every typed field after detachment'
  );

  -- ================================================================
  -- 5: an ORDINARY update (untouched RPC) never clears or changes the
  --    snapshot.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_registry_plan(
    v_da_event, v_entry.id, 'Aunt Ruth''s barn (updated)', 'https://example.com/our-real-registry', 'contacted', 'an updated note'
  );
  PERFORM public.p2_assert(
    v_edited.provider_name = 'Aunt Ruth''s barn (updated)' AND v_edited.planning_status = 'contacted',
    'the ordinary typed fields did change'
  );
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_entry.id)->>'catalog_asset_id')::uuid = v_asset_b.id,
    'the ordinary update did NOT clear or change the still-attached snapshot'
  );

  -- ================================================================
  -- 6: DETACH -- clears ONLY the four catalog columns; a second detach is a
  --    silent no-op with no further audit row.
  -- ================================================================
  SELECT * INTO v_detached FROM public.detach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id);
  PERFORM public.p2_assert(
    v_detached.catalog_asset_id IS NULL AND v_detached.catalog_provider_name_snapshot IS NULL
    AND v_detached.catalog_description_snapshot IS NULL AND v_detached.catalog_website_snapshot IS NULL,
    'detach clears all four catalog columns'
  );
  PERFORM public.p2_assert(
    v_detached.provider_name = 'Aunt Ruth''s barn (updated)' AND v_detached.planning_status = 'contacted'
    AND v_detached.organizer_note = 'an updated note',
    'detach preserves every ordinary typed field'
  );
  PERFORM public.p2_assert(public.p2_audit_count_for(v_entry.id) = 3, 'detach wrote exactly one more audit row');
  PERFORM public.p2_assert(public.p2_latest_audit_action(v_entry.id) = 'detached', 'the audit action is detached');

  PERFORM public.detach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id);
  PERFORM public.p2_assert(public.p2_audit_count_for(v_entry.id) = 3, 'detaching an already-clear entry writes NO further audit row');

  -- ================================================================
  -- 7 + 8: correction / deactivation / reactivation never rewrite an
  --    existing snapshot; a deactivated asset cannot be newly attached or
  --    searched; reactivation restores searchability/attachability.
  -- ================================================================
  SELECT * INTO v_attached FROM public.attach_my_private_draft_registry_plan_catalog_selection(
    v_da_event, v_entry.id, v_asset_a.id
  );
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  PERFORM public.update_registry_provider_catalog_asset(
    v_asset_a.id, 1, 'Acme Gift Registry (corrected)', 'A corrected description.', 'https://acme-registry.example.com/new'
  );
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_entry.id)->>'catalog_provider_name_snapshot') = 'Acme Gift Registry',
    'a catalog CORRECTION does not rewrite the existing snapshot -- it still reads the value captured at attach time'
  );

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  PERFORM public.set_registry_provider_catalog_asset_active_status(v_asset_a.id, 2, false);
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_entry.id)->>'catalog_provider_name_snapshot') = 'Acme Gift Registry',
    'DEACTIVATING the attached asset does not rewrite the existing snapshot either'
  );
  SELECT count(*) INTO v_count FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'ac');
  PERFORM public.p2_assert(v_count = 1, 'the now-inactive asset disappears from new search -- only Acme Home Goods remains');

  v_failed := false;
  BEGIN
    PERFORM public.attach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id, v_asset_a.id);
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'registry_provider_catalog_asset_inactive'); END;
  PERFORM public.p2_assert(v_failed, 'an inactive asset cannot be newly attached (deactivate-then-attach ordering)');
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_entry.id)->>'catalog_provider_name_snapshot') = 'Acme Gift Registry',
    'the failed attach attempt left the existing snapshot completely unchanged'
  );

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  PERFORM public.set_registry_provider_catalog_asset_active_status(v_asset_a.id, 3, true);
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_entry.id)->>'catalog_provider_name_snapshot') = 'Acme Gift Registry',
    'REACTIVATING does not refresh the snapshot -- still the original attach-time value'
  );
  SELECT count(*) INTO v_count FROM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'ac');
  PERFORM public.p2_assert(v_count = 2, 'reactivation restores the asset to new search');

  -- attach-then-deactivate ordering: selection completes with its save-time
  -- snapshot BEFORE retirement.
  PERFORM public.detach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id);
  SELECT * INTO v_attached FROM public.attach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id, v_asset_b.id);
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  PERFORM public.set_registry_provider_catalog_asset_active_status(v_asset_b.id, 1, false);
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);
  PERFORM public.p2_assert(
    (public.p2_plan_row(v_entry.id)->>'catalog_provider_name_snapshot') = 'Acme Home Goods',
    'attach-then-deactivate: the selection completed with its save-time snapshot, unaffected by the later deactivation'
  );
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  PERFORM public.set_registry_provider_catalog_asset_active_status(v_asset_b.id, 2, true);
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);

  -- ================================================================
  -- 1: STRICT IDENTITY -- no_link and invalid_or_ambiguous are refused with
  --    the bare sentinel; the SAME no_link identity's ORDINARY Registry Plan
  --    keeps working via the untouched RPCs.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'ac');
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'identity_resolution_required'); END;
  PERFORM public.p2_assert(v_failed, 'a no_link caller is refused catalog search with identity_resolution_required');

  v_failed := false;
  BEGIN PERFORM public.attach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id, v_asset_a.id);
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'identity_resolution_required'); END;
  PERFORM public.p2_assert(v_failed, 'a no_link caller is refused attach');

  v_failed := false;
  BEGIN PERFORM public.detach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id);
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'identity_resolution_required'); END;
  PERFORM public.p2_assert(v_failed, 'a no_link caller is refused detach');

  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_registry_plans_with_catalog(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'identity_resolution_required'); END;
  PERFORM public.p2_assert(v_failed, 'a no_link caller is refused the catalog-aware list');

  -- invalid_or_ambiguous: same bare sentinel, no plan/catalog content revealed.
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'ac');
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'identity_resolution_required'); END;
  PERFORM public.p2_assert(v_failed, 'an invalid_or_ambiguous caller is refused with the same bare sentinel');

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);
  -- Six real mutations on this entry so far: attach A, replace B, detach,
  -- re-attach A, detach (before the attach-then-deactivate ordering test),
  -- attach B. Every denied-identity attempt above wrote none of these.
  PERFORM public.p2_assert(public.p2_audit_count_for(v_entry.id) = 6, 'no denied identity attempt above wrote any audit row');

  -- ================================================================
  -- 9: a GENUINE other-tenant Tenant Administrator does not authorize any
  --    Catalog P2 operation on Alice's Draft.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000006', true);
  v_failed := false;
  BEGIN PERFORM public.search_my_private_draft_registry_provider_catalog(v_da_event, 'ac');
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'Draft not found.'); END;
  PERFORM public.p2_assert(v_failed, 'a real other-tenant Tenant Administrator cannot search on Alice''s Draft');

  v_failed := false;
  BEGIN PERFORM public.attach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id, v_asset_a.id);
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'Draft not found.'); END;
  PERFORM public.p2_assert(v_failed, 'and cannot attach on it either -- Tenant authority grants nothing here');

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000001', true);

  -- ================================================================
  -- 10: DIRECT TABLE ACCESS to the new audit table is unavailable.
  -- ================================================================
  v_failed := false;
  BEGIN
    EXECUTE 'SELECT 1 FROM public.registry_plan_catalog_selection_audit LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  PERFORM public.p2_assert(v_failed, 'the audit table cannot be SELECTed directly, even by an authenticated session');

  -- ================================================================
  -- 12: nothing outside the registry plan / catalog surface moved.
  -- ================================================================
  PERFORM public.p2_assert(public.p2_untouched_counts() = v_untouchable, 'no vendor / venue / budget / checklist row was created, changed, or read');

  -- ================================================================
  -- 11: Draft deletion removes the reference/snapshot; catalog assets and
  --    the OTHER organizer's Draft survive.
  -- ================================================================
  SELECT * INTO v_attached FROM public.attach_my_private_draft_registry_plan_catalog_selection(v_da_event, v_entry.id, v_asset_a.id);
  PERFORM public.delete_self_service_organizer_event(v_da_event, '96bdcd00-0000-4000-8000-000000000001');
  PERFORM public.p2_assert(NOT public.p2_event_exists(v_da_event), 'Alice''s event is gone');

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000005', true);
  PERFORM public.p2_assert(
    (SELECT count(*) FROM public.list_registry_provider_catalog_assets_for_platform_admin()) >= 13,
    'the catalog assets all survive the Draft deletion'
  );

  PERFORM set_config('request.jwt.claim.sub', '96c00000-0000-4000-8000-000000000002', true);
  PERFORM public.p2_assert(public.p2_event_exists(v_db_event), 'Bob''s Draft was never touched and still exists');
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_registry_plans_with_catalog(v_db_event);
  PERFORM public.p2_assert(v_count = 0, 'Bob''s registry plan is untouched and still empty');

  RAISE NOTICE 'ALL CATALOG P2 REGISTRY PLAN CATALOG SELECTION ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
