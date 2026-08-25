-- Governed Google Nearby exact identity matching linked proof.
--
-- Installs the exact pending read definition within one outer transaction,
-- verifies scope-aware exact-ID results against the live T9 authority model,
-- and rolls every fixture object and definition back.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_matching_google_place_ids_for_nearby_administration(
  p_event_id uuid,
  p_google_place_ids text[]
)
RETURNS TABLE (
  google_place_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_event_tenant_id uuid;
  v_event_task_allowed boolean;
  v_is_platform_admin boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Google Nearby candidate matching requires authenticated authority.';
  END IF;

  SELECT authority.allowed, authority.tenant_id
    INTO v_event_task_allowed, v_event_tenant_id
  FROM public.resolve_task_authority(v_actor, 'event.nearby.manage', p_event_id) AS authority;

  IF v_event_task_allowed IS DISTINCT FROM true OR v_event_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Google Nearby candidate matching requires event.nearby.manage authority.';
  END IF;

  IF coalesce(cardinality(p_google_place_ids), 0) = 0 THEN
    RETURN;
  END IF;

  v_is_platform_admin := public.has_platform_admin_authority(v_actor);

  RETURN QUERY
  SELECT DISTINCT provider_identity.provider_place_id
  FROM public.nearby_master_provider_identities AS provider_identity
  JOIN public.nearby_master AS master
    ON master.id = provider_identity.nearby_master_id
  WHERE provider_identity.provider = 'google_places'
    AND provider_identity.provider_place_id IN (
      SELECT nullif(btrim(search_result.google_place_id), '')
      FROM unnest(p_google_place_ids) AS search_result(google_place_id)
      WHERE nullif(btrim(search_result.google_place_id), '') IS NOT NULL
    )
    AND master.status = 'active'
    AND (
      (master.scope = 'shared_public' AND v_is_platform_admin)
      OR (
        master.scope = 'tenant_specific'
        AND master.tenant_id = v_event_tenant_id
        AND public.has_tenant_admin_authority(v_actor, master.tenant_id)
      )
    )
  ORDER BY provider_identity.provider_place_id;
END;
$function$;

ALTER FUNCTION public.list_matching_google_place_ids_for_nearby_administration(uuid, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_matching_google_place_ids_for_nearby_administration(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_matching_google_place_ids_for_nearby_administration(uuid, text[])
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

CREATE FUNCTION public.google_nearby_identity_match_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Google Nearby identity matching fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.google_nearby_identity_match_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.google_nearby_identity_match_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
BEGIN
  PERFORM public.google_nearby_identity_match_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants
      WHERE organization_code IN ('GOOGLE-IDENTITY-FIXTURE-A', 'GOOGLE-IDENTITY-FIXTURE-B')
    ),
    'fixture Tenant identities must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title, is_active
  ) VALUES
    ('b1000000-0000-4000-8000-000000000001', 'GOOGLE-IDENTITY-FIXTURE-A',
     'google-identity-fixture-a', 'Google Identity Fixture Tenant A',
     'Google Identity Tenant A', 'Google Identity Tenant A', true),
    ('b1000000-0000-4000-8000-000000000002', 'GOOGLE-IDENTITY-FIXTURE-B',
     'google-identity-fixture-b', 'Google Identity Fixture Tenant B',
     'Google Identity Tenant B', 'Google Identity Tenant B', true);

  INSERT INTO public.events (
    id, tenant_id, name, location, start_date, end_date, timezone,
    lifecycle_state, status, visible_to_members, is_active
  ) VALUES
    ('b2000000-0000-4000-8000-000000000001',
     'b1000000-0000-4000-8000-000000000001',
     'Google Identity Fixture Event A', 'Fixture A location', current_date,
     current_date + 10, 'UTC', 'operational', 'Draft', false, false),
    ('b2000000-0000-4000-8000-000000000002',
     'b1000000-0000-4000-8000-000000000002',
     'Google Identity Fixture Event B', 'Fixture B location', current_date,
     current_date + 10, 'UTC', 'operational', 'Draft', false, false);

  INSERT INTO auth.users (id, email) VALUES
    ('b3000000-0000-4000-8000-000000000001', 'google-identity-platform@fixture.invalid'),
    ('b3000000-0000-4000-8000-000000000002', 'google-identity-tenant-a@fixture.invalid'),
    ('b3000000-0000-4000-8000-000000000003', 'google-identity-tenant-b@fixture.invalid'),
    ('b3000000-0000-4000-8000-000000000004', 'google-identity-direct@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id, privilege_group
  ) VALUES
    ('b4000000-0000-4000-8000-000000000001', 'google-identity-platform@fixture.invalid',
     'Google Identity Platform', true, true,
     'b3000000-0000-4000-8000-000000000001', 'super_admin'),
    ('b4000000-0000-4000-8000-000000000002', 'google-identity-tenant-a@fixture.invalid',
     'Google Identity Tenant A', true, false,
     'b3000000-0000-4000-8000-000000000002', 'event_admin'),
    ('b4000000-0000-4000-8000-000000000003', 'google-identity-tenant-b@fixture.invalid',
     'Google Identity Tenant B', true, false,
     'b3000000-0000-4000-8000-000000000003', 'event_admin'),
    ('b4000000-0000-4000-8000-000000000004', 'google-identity-direct@fixture.invalid',
     'Google Identity Direct Event Admin', true, false,
     'b3000000-0000-4000-8000-000000000004', 'event_admin');

  INSERT INTO public.people (id, display_first_name, display_last_name, status) VALUES
    ('b5000000-0000-4000-8000-000000000001', 'Google', 'IdentityTenantA', 'active'),
    ('b5000000-0000-4000-8000-000000000002', 'Google', 'IdentityTenantB', 'active');

  INSERT INTO public.person_auth_accounts (id, person_id, auth_user_id, status, is_primary) VALUES
    ('b6000000-0000-4000-8000-000000000001',
     'b5000000-0000-4000-8000-000000000001',
     'b3000000-0000-4000-8000-000000000002', 'active', true),
    ('b6000000-0000-4000-8000-000000000002',
     'b5000000-0000-4000-8000-000000000002',
     'b3000000-0000-4000-8000-000000000003', 'active', true);

  INSERT INTO public.person_tenant_administrator_appointments (
    person_id, tenant_id, is_active, appointment_basis
  ) VALUES
    ('b5000000-0000-4000-8000-000000000001',
     'b1000000-0000-4000-8000-000000000001', true, 'platform_appointment'),
    ('b5000000-0000-4000-8000-000000000002',
     'b1000000-0000-4000-8000-000000000002', true, 'platform_appointment');

  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES (
    'b7000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000004',
    'b2000000-0000-4000-8000-000000000001',
    'event_admin'
  );
  INSERT INTO public.admin_event_permissions (
    admin_event_access_id, permission_key, grant_source
  ) VALUES (
    'b7000000-0000-4000-8000-000000000001',
    'event.nearby.manage', 'manual'
  );

  INSERT INTO public.nearby_master (
    id, name, category, address, status, scope, tenant_id, review_status
  ) VALUES
    ('b9000000-0000-4000-8000-000000000001', 'Fixture Same Name', 'Fixture',
     '1 Same Address', 'active', 'tenant_specific',
     'b1000000-0000-4000-8000-000000000001', 'approved'),
    ('b9000000-0000-4000-8000-000000000002', 'Fixture Shared Place', 'Fixture',
     '2 Shared Address', 'active', 'shared_public', NULL, 'pending_review'),
    ('b9000000-0000-4000-8000-000000000003', 'Fixture Same Name', 'Fixture',
     '1 Same Address', 'active', 'tenant_specific',
     'b1000000-0000-4000-8000-000000000002', 'approved'),
    ('b9000000-0000-4000-8000-000000000004', 'Fixture Legacy Same Name', 'Fixture',
     '1 Same Address', 'active', 'tenant_specific',
     'b1000000-0000-4000-8000-000000000001', 'approved');

  INSERT INTO public.nearby_master_provider_identities (
    nearby_master_id, provider, provider_place_id, created_by_auth_user_id
  ) VALUES
    ('b9000000-0000-4000-8000-000000000001', 'google_places',
     'fixture-google-tenant-a', 'b3000000-0000-4000-8000-000000000001'),
    ('b9000000-0000-4000-8000-000000000002', 'google_places',
     'fixture-google-shared', 'b3000000-0000-4000-8000-000000000001'),
    ('b9000000-0000-4000-8000-000000000003', 'google_places',
     'fixture-google-tenant-b', 'b3000000-0000-4000-8000-000000000001');
END;
$fixture$;

DO $fixture$
DECLARE
  v_matches text[];
  v_failed boolean;
BEGIN
  -- Tenant authority returns only its exact same-Tenant canonical identity.
  PERFORM set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000002', true);
  SELECT coalesce(array_agg(google_place_id ORDER BY google_place_id), ARRAY[]::text[])
    INTO v_matches
  FROM public.list_matching_google_place_ids_for_nearby_administration(
    'b2000000-0000-4000-8000-000000000001',
    ARRAY['fixture-google-tenant-a', 'fixture-google-shared', 'fixture-google-tenant-b']
  );
  PERFORM public.google_nearby_identity_match_fixture_assert(
    v_matches = ARRAY['fixture-google-tenant-a'],
    'Tenant authority returns only its exact same-Tenant canonical identity'
  );

  -- Platform authority returns authorized Tenant and Shared exact canonical identities only.
  PERFORM set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000001', true);
  SELECT coalesce(array_agg(google_place_id ORDER BY google_place_id), ARRAY[]::text[])
    INTO v_matches
  FROM public.list_matching_google_place_ids_for_nearby_administration(
    'b2000000-0000-4000-8000-000000000001',
    ARRAY['fixture-google-tenant-a', 'fixture-google-shared', 'fixture-google-tenant-b']
  );
  PERFORM public.google_nearby_identity_match_fixture_assert(
    v_matches = ARRAY['fixture-google-shared', 'fixture-google-tenant-a'],
    'Platform authority returns authorized Tenant and Shared exact canonical identities only'
  );

  -- Similar visible fields never participate: same name or address with a different Google Place ID remains pending.
  SELECT coalesce(array_agg(google_place_id), ARRAY[]::text[])
    INTO v_matches
  FROM public.list_matching_google_place_ids_for_nearby_administration(
    'b2000000-0000-4000-8000-000000000001', ARRAY['fixture-google-different']
  );
  PERFORM public.google_nearby_identity_match_fixture_assert(
    cardinality(v_matches) = 0,
    'same name or address with a different Google Place ID remains pending'
  );

  -- A canonical record without a Google identity cannot suppress a candidate.
  SELECT coalesce(array_agg(google_place_id), ARRAY[]::text[])
    INTO v_matches
  FROM public.list_matching_google_place_ids_for_nearby_administration(
    'b2000000-0000-4000-8000-000000000001', ARRAY['fixture-google-legacy-no-id']
  );
  PERFORM public.google_nearby_identity_match_fixture_assert(
    cardinality(v_matches) = 0,
    'canonical record without a Google Place ID cannot suppress a candidate'
  );

  -- Direct Event Admin has Event authority only: no canonical identity is exposed, and Event-only candidates remain unsuppressed.
  PERFORM set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000004', true);
  SELECT coalesce(array_agg(google_place_id), ARRAY[]::text[])
    INTO v_matches
  FROM public.list_matching_google_place_ids_for_nearby_administration(
    'b2000000-0000-4000-8000-000000000001', ARRAY['fixture-google-tenant-a']
  );
  PERFORM public.google_nearby_identity_match_fixture_assert(
    cardinality(v_matches) = 0,
    'direct Event Admin sees no canonical identity match and Event-only candidates remain unsuppressed'
  );

  -- A Tenant B administrator cannot use Event A as an identity-discovery oracle.
  PERFORM set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN
    PERFORM public.list_matching_google_place_ids_for_nearby_administration(
      'b2000000-0000-4000-8000-000000000001', ARRAY['fixture-google-tenant-a']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Google Nearby candidate matching requires event.nearby.manage authority.';
  END;
  PERFORM public.google_nearby_identity_match_fixture_assert(
    v_failed, 'cross-Tenant caller is denied before identity exposure'
  );

  PERFORM public.google_nearby_identity_match_fixture_assert(
    NOT has_table_privilege('authenticated', 'public.nearby_master_provider_identities', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.nearby_master_provider_identities', 'SELECT'),
    'authenticated and anonymous roles have no direct provider identity table privilege'
  );

  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN
    PERFORM public.list_matching_google_place_ids_for_nearby_administration(
      'b2000000-0000-4000-8000-000000000001', ARRAY['fixture-google-tenant-a']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Google Nearby candidate matching requires authenticated authority.';
  END;
  PERFORM public.google_nearby_identity_match_fixture_assert(
    v_failed, 'anonymous caller cannot execute the governed matching RPC'
  );
END;
$fixture$;

ROLLBACK;

DO $fixture$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE organization_code IN ('GOOGLE-IDENTITY-FIXTURE-A', 'GOOGLE-IDENTITY-FIXTURE-B')
  )
  OR EXISTS (
    SELECT 1 FROM public.nearby_master
    WHERE id::text LIKE 'b9000000-0000-4000-8000-00000000000%'
  )
  OR to_regprocedure('public.google_nearby_identity_match_fixture_assert(boolean,text)') IS NOT NULL
  OR to_regprocedure('public.list_matching_google_place_ids_for_nearby_administration(uuid,text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Google Nearby identity matching rollback left fixture residue';
  END IF;
END;
$fixture$;
