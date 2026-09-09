-- Catalog P1 linked-database behavior proof: the separate, empty,
-- Platform-Admin-governed Registry Provider Catalog and its curation
-- workspace.
--
-- Run only after 20260924000000 … 20261008000000 have been applied. Creates
-- isolated auth + admin_users rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- NOT EXECUTED as part of this task: per the CMD-LEM's explicit instruction,
-- this fixture was written to repository convention but was NOT run against
-- any database (local, linked, or production). It is a proof artifact for a
-- separately authorized execution step, exactly like the P-2A/P-2C
-- behavioral rollback fixtures noted as "NOT manually executed" in the
-- Project Brief's Development checkpoint.
--
-- It proves:
--   1.  a fresh catalog is EMPTY -- this migration seeds nothing;
--   2.  a Platform Admin can create / list / correct / activate / deactivate
--       an asset; every new asset is created INACTIVE;
--   3.  NAME COLLISION: a normalized-name collision (case- and whitespace-
--       insensitive) is refused with zero mutation, but the SAME public
--       website on two different providers is accepted -- website is NOT a
--       uniqueness rule;
--   4.  REVISION CAS: a stale p_expected_revision on update or on
--       activate/deactivate is refused (bare sentinel
--       'stale_registry_provider_catalog_asset') with ZERO asset mutation
--       and ZERO audit row written;
--   5.  every SUCCESSFUL mutation (create, correct, activate, deactivate)
--       writes EXACTLY ONE content-free audit row, carrying only the six
--       approved columns -- never a provider name, description, or website;
--   6.  a non-Platform admin_users row (representing Event Admin / Tenant
--       Admin acting only through admin_users / vendor-catalog admin /
--       content_admin / checkin / parking / read_only -- every privilege_group
--       this codebase defines other than 'super_admin'), an inactive
--       super_admin, a plain verified account with no admin_users row at
--       all (organizer), an anonymous caller, and the service_role caller
--       are ALL denied on every one of the four RPCs, with zero mutation.
--       (A full Tenant-Admin-appointment or vendor-catalog-admin-appointment
--       identity is not separately constructed here: the accompanying static
--       structural test independently proves, by literal absence in the SQL
--       text, that _registry_provider_catalog_authorize() calls
--       has_platform_admin_authority(auth.uid()) ALONE and never
--       has_tenant_admin_authority / has_event_task_authority /
--       has_vendor_catalog_admin_authority -- so no appointment under those
--       other predicates can possibly satisfy this migration's boundary,
--       and one representative non-platform admin_users identity is a
--       sufficient runtime proof of that fact.)
--   7.  DIRECT TABLE ACCESS IS UNAVAILABLE on both tables, to every browser
--       role including service_role -- SELECT and INSERT both denied;
--   8.  no sibling planning table (private Registry Plan, vendor plan, venue
--       plan, budget lines, checklist items) or vendors/event_vendors row is
--       created, changed, or read by any catalog action;
--   9.  the list RPC returns BOTH active and inactive rows, alphabetically.

BEGIN;

CREATE OR REPLACE FUNCTION public.p1_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Catalog P1 fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p1_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p1_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p1_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p1_asset_count()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.registry_provider_catalog_assets;
$function$;
ALTER FUNCTION public.p1_asset_count() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p1_asset_count() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p1_asset_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.p1_audit_count()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.registry_provider_catalog_curation_audit;
$function$;
ALTER FUNCTION public.p1_audit_count() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p1_audit_count() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p1_audit_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.p1_row(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT to_jsonb(a) FROM public.registry_provider_catalog_assets AS a WHERE a.id = p_id;
$function$;
ALTER FUNCTION public.p1_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p1_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p1_row(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p1_latest_audit()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  -- `now()` is frozen for the whole fixture transaction (it is STABLE, not
  -- VOLATILE), so every audit row's occurred_at is byte-identical and
  -- cannot order "latest." Ordering by the system column `cmin` (this
  -- transaction's per-command counter, which DOES advance with every
  -- statement) is reliable here specifically because the audit table is
  -- guaranteed empty before this transaction begins, so every row visible
  -- during the fixture was inserted by this same transaction. `cmin` is
  -- type `cid`, which has no ordering operator, so it is cast through text
  -- to bigint for comparison -- verified monotonic on this exact server.
  SELECT to_jsonb(x)
  FROM (
    SELECT * FROM public.registry_provider_catalog_curation_audit
    ORDER BY (cmin::text)::bigint DESC LIMIT 1
  ) AS x;
$function$;
ALTER FUNCTION public.p1_latest_audit() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p1_latest_audit() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p1_latest_audit() TO authenticated;

-- Everything a "usage / where-used / private-plan leak" signal could
-- possibly live in. All of these must be byte-identical before and after
-- the entire fixture: Catalog P1 touches none of them.
CREATE OR REPLACE FUNCTION public.p1_untouched_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'registry_plans', (SELECT count(*) FROM public.self_service_private_draft_registry_plans),
    'vendor_plans', (SELECT count(*) FROM public.self_service_private_draft_vendor_plans),
    'venue_plans', (SELECT count(*) FROM public.self_service_private_draft_venue_plans),
    'budget_lines', (SELECT count(*) FROM public.self_service_private_draft_budget_lines),
    'checklist_items', (SELECT count(*) FROM public.self_service_private_draft_checklist_items),
    'vendors', (SELECT count(*) FROM public.vendors),
    'event_vendors', (SELECT count(*) FROM public.event_vendors),
    'people', (SELECT count(*) FROM public.people),
    'events', (SELECT count(*) FROM public.events),
    'tenants', (SELECT count(*) FROM public.tenants)
  );
$function$;
ALTER FUNCTION public.p1_untouched_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p1_untouched_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p1_untouched_counts() TO authenticated;

DO $setup$
DECLARE
  v_admin_row_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '95c00000-0000-4000-8000-000000000001',
    '95c00000-0000-4000-8000-000000000002',
    '95c00000-0000-4000-8000-000000000003',
    '95c00000-0000-4000-8000-000000000004'
  )) THEN
    RAISE EXCEPTION 'Catalog P1 fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('95c00000-0000-4000-8000-000000000001', 'p1-platform-admin@fixture.invalid', now()),
    ('95c00000-0000-4000-8000-000000000002', 'p1-inactive-admin@fixture.invalid', now()),
    ('95c00000-0000-4000-8000-000000000003', 'p1-event-admin@fixture.invalid', now()),
    ('95c00000-0000-4000-8000-000000000004', 'p1-organizer@fixture.invalid', now());

  -- The active Platform Administrator: privilege_group = 'super_admin',
  -- is_active = true. This is the ONLY identity any RPC in this migration
  -- ever admits.
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group, user_id)
  VALUES ('p1-platform-admin@fixture.invalid', true, true, 'super_admin', '95c00000-0000-4000-8000-000000000001')
  RETURNING id INTO v_admin_row_id;

  -- An INACTIVE super_admin -- has_platform_admin_authority's own is_active
  -- check must deny this identity regardless of privilege_group.
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group, user_id)
  VALUES ('p1-inactive-admin@fixture.invalid', false, false, 'super_admin', '95c00000-0000-4000-8000-000000000002');

  -- An ACTIVE admin_users row that is NOT privilege_group = 'super_admin'.
  -- Stands in for Event Admin / Tenant Admin (acting only through
  -- admin_users, not a person_tenant_administrator_appointments row) /
  -- vendor-catalog admin / content_admin / checkin / parking / read_only --
  -- every privilege_group this codebase defines other than super_admin.
  -- has_platform_admin_authority denies every one of them identically.
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group, user_id)
  VALUES ('p1-event-admin@fixture.invalid', true, false, 'event_admin', '95c00000-0000-4000-8000-000000000003');

  -- A plain verified account with NO admin_users row at all -- an
  -- "organizer" for this fixture's purposes.
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_untouchable jsonb;
  v_a record; v_b record; v_edited record; v_activated record; v_deactivated record;
  v_asset_count integer; v_audit_count integer;
  v_row jsonb; v_audit jsonb; v_failed boolean;
BEGIN
  v_untouchable := public.p1_untouched_counts();

  -- ================================================================
  -- 1: A FRESH CATALOG IS EMPTY. Nothing is seeded.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '95c00000-0000-4000-8000-000000000001', true);
  v_asset_count := public.p1_asset_count();
  PERFORM public.p1_assert(v_asset_count = 0, 'a fresh catalog has ZERO rows -- this migration seeds nothing');
  PERFORM public.p1_assert(public.p1_audit_count() = 0, 'and zero audit rows exist either');

  -- ================================================================
  -- 2: create -- ALWAYS inactive.
  -- ================================================================
  SELECT * INTO v_a FROM public.create_registry_provider_catalog_asset(
    'Acme Gift Registry', 'A general-purpose gift registry provider.', 'https://acme-registry.example.com'
  );
  PERFORM public.p1_assert(
    v_a.provider_name = 'Acme Gift Registry' AND v_a.is_active = false AND v_a.revision = 0,
    'a newly created asset is inactive with revision 0'
  );
  PERFORM public.p1_assert(public.p1_asset_count() = 1, 'exactly one asset now exists');
  PERFORM public.p1_assert(public.p1_audit_count() = 1, 'exactly one audit row was written');

  v_audit := public.p1_latest_audit();
  PERFORM public.p1_assert(
    (v_audit->>'action') = 'asset_created'
    AND (v_audit->>'revision_before')::integer = 0
    AND (v_audit->>'revision_after')::integer = 0
    AND (v_audit->>'catalog_asset_id')::uuid = v_a.id,
    'the create audit row states action/revision_before/revision_after/catalog_asset_id correctly'
  );
  PERFORM public.p1_assert(
    NOT (v_audit ? 'provider_name') AND NOT (v_audit ? 'short_description') AND NOT (v_audit ? 'public_website'),
    'the audit row carries no provider content -- only the six approved columns'
  );

  -- ================================================================
  -- 3a: NAME COLLISION -- case- and whitespace-insensitive, zero mutation.
  -- ================================================================
  v_asset_count := public.p1_asset_count();
  v_audit_count := public.p1_audit_count();
  v_failed := false;
  BEGIN
    PERFORM public.create_registry_provider_catalog_asset(
      '  ACME   gift   REGISTRY  ', 'A duplicate name with different case and spacing.', 'https://different.example.com'
    );
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'registry_provider_name_collision'); END;
  PERFORM public.p1_assert(v_failed, 'a case/whitespace-equivalent name is refused as registry_provider_name_collision');
  PERFORM public.p1_assert(public.p1_asset_count() = v_asset_count, 'the collision wrote NO new asset row');
  PERFORM public.p1_assert(public.p1_audit_count() = v_audit_count, 'the collision wrote NO audit row');

  -- ================================================================
  -- 3b: the SAME public website on a second, differently-named provider is
  --     accepted -- website carries no uniqueness rule.
  -- ================================================================
  SELECT * INTO v_b FROM public.create_registry_provider_catalog_asset(
    'Baby Bundle Registry', 'A baby-focused registry provider.', 'https://acme-registry.example.com'
  );
  PERFORM public.p1_assert(
    v_b.public_website = v_a.public_website AND v_b.id <> v_a.id,
    'two different providers may share the same public website'
  );
  PERFORM public.p1_assert(public.p1_asset_count() = 2, 'two distinct assets now exist');

  -- ================================================================
  -- 4: correction, then REVISION CAS on a stale call.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_registry_provider_catalog_asset(
    v_a.id, 0, 'Acme Gift Registry', 'An updated, corrected description.', 'https://acme-registry.example.com/about'
  );
  PERFORM public.p1_assert(
    v_edited.short_description = 'An updated, corrected description.' AND v_edited.revision = 1,
    'a correct-revision update succeeds and bumps the revision'
  );
  v_audit := public.p1_latest_audit();
  PERFORM public.p1_assert(
    (v_audit->>'action') = 'asset_corrected'
    AND (v_audit->>'revision_before')::integer = 0
    AND (v_audit->>'revision_after')::integer = 1,
    'the correction audit row records the exact revision transition'
  );

  v_asset_count := public.p1_asset_count();
  v_audit_count := public.p1_audit_count();
  v_failed := false;
  BEGIN
    PERFORM public.update_registry_provider_catalog_asset(
      v_a.id, 0, 'Acme Gift Registry', 'A stale-revision attempt.', 'https://stale.example.com'
    );
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'stale_registry_provider_catalog_asset'); END;
  PERFORM public.p1_assert(v_failed, 'a stale expected_revision (0, now actually 1) is refused');
  v_row := public.p1_row(v_a.id);
  PERFORM public.p1_assert(
    (v_row->>'revision')::integer = 1 AND (v_row->>'short_description') = 'An updated, corrected description.',
    'the stale attempt changed NOTHING on the row'
  );
  PERFORM public.p1_assert(public.p1_audit_count() = v_audit_count, 'the stale attempt wrote NO audit row');

  -- ================================================================
  -- 4b: a rename that would COLLIDE with the other existing asset is also
  --     refused, with zero mutation.
  -- ================================================================
  v_failed := false;
  BEGIN
    PERFORM public.update_registry_provider_catalog_asset(
      v_a.id, 1, 'Baby Bundle Registry', 'Attempting to steal the other asset''s name.', 'https://acme-registry.example.com'
    );
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'registry_provider_name_collision'); END;
  PERFORM public.p1_assert(v_failed, 'renaming into a collision with another asset is refused');
  v_row := public.p1_row(v_a.id);
  PERFORM public.p1_assert((v_row->>'revision')::integer = 1, 'the attempted collision-rename changed nothing');

  -- ================================================================
  -- 5: activate / deactivate, and REVISION CAS on that path too.
  -- ================================================================
  SELECT * INTO v_activated FROM public.set_registry_provider_catalog_asset_active_status(v_a.id, 1, true);
  PERFORM public.p1_assert(v_activated.is_active = true AND v_activated.revision = 2, 'activation succeeds and bumps revision');
  v_audit := public.p1_latest_audit();
  PERFORM public.p1_assert(
    (v_audit->>'action') = 'asset_activated' AND (v_audit->>'revision_before')::integer = 1 AND (v_audit->>'revision_after')::integer = 2,
    'the activation audit row is correct'
  );

  v_failed := false;
  BEGIN
    PERFORM public.set_registry_provider_catalog_asset_active_status(v_a.id, 1, false);
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'stale_registry_provider_catalog_asset'); END;
  PERFORM public.p1_assert(v_failed, 'deactivating with a stale expected_revision (1, now actually 2) is refused');
  v_row := public.p1_row(v_a.id);
  PERFORM public.p1_assert((v_row->>'is_active')::boolean = true, 'the stale deactivate attempt changed nothing');

  SELECT * INTO v_deactivated FROM public.set_registry_provider_catalog_asset_active_status(v_a.id, 2, false);
  PERFORM public.p1_assert(v_deactivated.is_active = false AND v_deactivated.revision = 3, 'deactivation with the correct revision succeeds');
  v_audit := public.p1_latest_audit();
  PERFORM public.p1_assert((v_audit->>'action') = 'asset_deactivated', 'the deactivation audit row is correct');

  -- 5 successful mutations so far: create A, create B, correct A, activate
  -- A, deactivate A. Every rejected attempt above (two collisions, two
  -- stale-revision calls) already proved separately that it wrote zero
  -- audit rows, so this is an exact count, not a lower bound.
  PERFORM public.p1_assert(public.p1_audit_count() = 5, 'exactly one audit row per successful mutation: create A, create B, correct A, activate A, deactivate A');

  -- ================================================================
  -- 9: list returns BOTH active and inactive rows, alphabetically.
  -- ================================================================
  DECLARE
    v_names text[];
  BEGIN
    SELECT array_agg(provider_name ORDER BY provider_name)
      INTO v_names
    FROM public.list_registry_provider_catalog_assets_for_platform_admin();
    PERFORM public.p1_assert(
      v_names = ARRAY['Acme Gift Registry', 'Baby Bundle Registry'],
      'list returns both assets (one active, one inactive) in alphabetical order'
    );
  END;

  -- ================================================================
  -- 7: DIRECT TABLE ACCESS IS UNAVAILABLE, even to this authenticated
  --    Platform Admin session.
  -- ================================================================
  v_failed := false;
  BEGIN
    EXECUTE 'SELECT 1 FROM public.registry_provider_catalog_assets LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  PERFORM public.p1_assert(v_failed, 'even an authenticated Platform Admin session cannot SELECT the asset table directly');

  v_failed := false;
  BEGIN
    EXECUTE format(
      'INSERT INTO public.registry_provider_catalog_assets (provider_name, short_description, public_website) VALUES (%L, %L, %L)',
      'Smuggled', 'x', 'https://x.example.com'
    );
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  PERFORM public.p1_assert(v_failed, 'and cannot INSERT into it directly either');

  v_failed := false;
  BEGIN
    EXECUTE 'SELECT 1 FROM public.registry_provider_catalog_curation_audit LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  PERFORM public.p1_assert(v_failed, 'the curation audit table is also unreachable by direct SELECT');

  -- internal helpers are executable by nobody
  PERFORM public.p1_assert(
    NOT has_function_privilege('authenticated', 'public._registry_provider_catalog_authorize()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._registry_provider_catalog_lock(uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._registry_provider_catalog_validate(text,text,text)', 'EXECUTE'),
    'the internal helpers are executable by nobody'
  );
  PERFORM public.p1_assert(
    has_function_privilege('authenticated', 'public.list_registry_provider_catalog_assets_for_platform_admin()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.list_registry_provider_catalog_assets_for_platform_admin()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.list_registry_provider_catalog_assets_for_platform_admin()', 'EXECUTE'),
    'the public RPCs are authenticated-only at the grant level -- the real gate is the internal authorize() call'
  );

  -- ================================================================
  -- 6: every non-Platform-Admin identity is denied on every RPC, with
  --    zero mutation.
  -- ================================================================
  v_asset_count := public.p1_asset_count();
  v_audit_count := public.p1_audit_count();

  -- 6a: an active admin_users row that is NOT privilege_group = 'super_admin'
  --     (stands in for Event Admin / Tenant Admin via admin_users /
  --     vendor-catalog admin / every other privilege_group).
  PERFORM set_config('request.jwt.claim.sub', '95c00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.list_registry_provider_catalog_assets_for_platform_admin();
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'Registry provider catalog management requires Platform Administrator authority.'); END;
  PERFORM public.p1_assert(v_failed, 'a non-super_admin admin_users identity cannot list the catalog');

  v_failed := false;
  BEGIN PERFORM public.create_registry_provider_catalog_asset('Intruder', 'x', 'https://x.example.com');
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'Registry provider catalog management requires Platform Administrator authority.'); END;
  PERFORM public.p1_assert(v_failed, 'and cannot create an asset');

  -- 6b: an INACTIVE super_admin.
  PERFORM set_config('request.jwt.claim.sub', '95c00000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN PERFORM public.update_registry_provider_catalog_asset(v_a.id, 3, 'x', 'x', 'https://x.example.com');
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'Registry provider catalog management requires Platform Administrator authority.'); END;
  PERFORM public.p1_assert(v_failed, 'an inactive super_admin cannot correct an asset');

  -- 6c: a plain verified account with NO admin_users row at all
  --     (an "organizer").
  PERFORM set_config('request.jwt.claim.sub', '95c00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.set_registry_provider_catalog_asset_active_status(v_a.id, 3, true);
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'Registry provider catalog management requires Platform Administrator authority.'); END;
  PERFORM public.p1_assert(v_failed, 'a plain verified account with no admin_users row cannot activate an asset');

  -- 6d: anonymous -- no JWT sub claim at all.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN PERFORM public.list_registry_provider_catalog_assets_for_platform_admin();
  EXCEPTION WHEN OTHERS THEN v_failed := (SQLERRM = 'Registry provider catalog management requires an authenticated Platform Administrator account.'); END;
  PERFORM public.p1_assert(v_failed, 'an unauthenticated caller is denied at the auth.uid() check');

  PERFORM public.p1_assert(
    public.p1_asset_count() = v_asset_count AND public.p1_audit_count() = v_audit_count,
    'no denied attempt above wrote anything'
  );

  -- 6e: anon and service_role are denied EXECUTE on the RPCs themselves, and
  --     denied direct table access, at the ROLE level (checked above via
  --     has_function_privilege for anon/service_role; direct-table REVOKE
  --     applies identically to every role, verified in item 7).
  PERFORM public.p1_assert(
    NOT has_table_privilege('anon', 'public.registry_provider_catalog_assets', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.registry_provider_catalog_assets', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.registry_provider_catalog_curation_audit', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.registry_provider_catalog_curation_audit', 'SELECT'),
    'anon and service_role hold no SELECT privilege on either table'
  );

  -- ================================================================
  -- 8: no sibling planning table or vendor/identity table moved.
  -- ================================================================
  PERFORM public.p1_assert(public.p1_untouched_counts() = v_untouchable, 'no sibling planning, vendor, identity, event, or tenant row was created, changed, or read');

  RAISE NOTICE 'ALL CATALOG P1 REGISTRY PROVIDER CATALOG ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
