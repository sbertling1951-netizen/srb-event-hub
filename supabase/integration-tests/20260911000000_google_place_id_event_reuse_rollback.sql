-- Governed Google Place-ID -> Event canonical reuse linked proof.
--
-- Installs the exact function definition inside one outer transaction,
-- exercises it against the live task-authority + Nearby scope model, and
-- rolls every fixture object and the definition back. Proves: authority
-- fail-closed, association delegation, idempotence, the collapsed
-- not_reusable outcome (no catalog-membership oracle), exact-ID only (no
-- name/address matching), Event-lifecycle enforcement, and continued
-- provider-identity table opacity.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE OR REPLACE FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(
  p_event_id uuid,
  p_google_place_ids text[]
)
RETURNS TABLE (
  google_place_id text,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_event_task_allowed boolean;
  v_event_tenant_id uuid;
  v_place_id text;
  v_master_id uuid;
  v_already boolean;
  v_recheck_allowed boolean;
  v_recheck_tenant_id uuid;
  v_recheck_master_id uuid;
  v_failure_class text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nearby place reuse requires authenticated authority.';
  END IF;

  -- Same authority as associate_nearby_master_place_with_event: the
  -- resolve_task_authority call also yields the Event's Tenant, used for
  -- the tenant_specific scope check below.
  SELECT authority.allowed, authority.tenant_id
    INTO v_event_task_allowed, v_event_tenant_id
  FROM public.resolve_task_authority(v_actor, 'event.nearby.manage', p_event_id) AS authority;

  IF v_event_task_allowed IS DISTINCT FROM true OR v_event_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nearby place reuse requires event.nearby.manage authority.';
  END IF;

  -- Fail early and uniformly on an immutable Event; the association RPC
  -- would raise the same condition per row.
  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  IF coalesce(cardinality(p_google_place_ids), 0) = 0 THEN
    RETURN;
  END IF;

  FOR v_place_id IN
    SELECT DISTINCT nullif(btrim(candidate.value), '')
    FROM unnest(p_google_place_ids) AS candidate(value)
    WHERE nullif(btrim(candidate.value), '') IS NOT NULL
  LOOP
    google_place_id := v_place_id;
    v_master_id := NULL;

    -- Exact provider identity only. No name/address/coordinate matching.
    -- The scope/status/review predicate is exactly what
    -- associate_nearby_master_place_with_event will itself enforce.
    SELECT master.id
      INTO v_master_id
    FROM public.nearby_master_provider_identities AS provider_identity
    JOIN public.nearby_master AS master
      ON master.id = provider_identity.nearby_master_id
    WHERE provider_identity.provider = 'google_places'
      AND provider_identity.provider_place_id = v_place_id
      AND master.status = 'active'
      AND master.review_status = 'approved'
      AND (
        master.scope = 'shared_public'
        OR (master.scope = 'tenant_specific' AND master.tenant_id = v_event_tenant_id)
      );

    IF v_master_id IS NULL THEN
      -- Collapsed: no canonical row, wrong Tenant, pending_review, and
      -- rejected all report the same thing.
      outcome := 'not_reusable';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_nearby_places AS existing
      WHERE existing.event_id = p_event_id
        AND existing.source_master_id = v_master_id
    )
      INTO v_already;

    IF v_already THEN
      outcome := 'already_associated';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Delegate the write in a subtransaction. The eligibility SELECT above
    -- and this PERFORM are not atomic; the BEGIN..EXCEPTION block is a
    -- subtransaction, so ANY failure here rolls back a partial association
    -- -- nothing half-written can persist.
    BEGIN
      PERFORM public.associate_nearby_master_place_with_event(p_event_id, v_master_id);
      outcome := 'reused';
      RETURN NEXT;
      CONTINUE;
    EXCEPTION WHEN OTHERS THEN
      -- Discard the nested exception UNSEEN. Its SQLSTATE proves nothing
      -- (P0001 is PostgreSQL's generic user-raised code; the delegated
      -- function and its downstream checks use it for authority, Event
      -- lifecycle, AND ineligibility). The true reason is re-derived from
      -- CURRENT state below -- never inferred from the nested error.
      NULL;
    END;

    -- Re-establish, in order, ALL WITHIN ONE enclosing WHEN OTHERS
    -- handler (below) so that a raise from any of these steps -- a
    -- lifecycle raise (event_archived), a resolve_task_authority error,
    -- anything -- is sanitized to a generic failure and its text can
    -- never leak:
    --   (a) the caller still holds event.nearby.manage for this Event;
    --   (b) the Event is still lifecycle-mutable;
    --   (c) this exact canonical candidate is still reuse-eligible, by the
    --       identical predicate used above.
    v_failure_class := 'unexpected';
    v_recheck_master_id := NULL;
    BEGIN
      SELECT authority.allowed, authority.tenant_id
        INTO v_recheck_allowed, v_recheck_tenant_id
      FROM public.resolve_task_authority(v_actor, 'event.nearby.manage', p_event_id) AS authority;

      IF v_recheck_allowed IS DISTINCT FROM true OR v_recheck_tenant_id IS NULL THEN
        v_failure_class := 'authority_lost';
      ELSE
        PERFORM public.assert_event_lifecycle_mutable(p_event_id);

        SELECT master.id
          INTO v_recheck_master_id
        FROM public.nearby_master_provider_identities AS provider_identity
        JOIN public.nearby_master AS master
          ON master.id = provider_identity.nearby_master_id
        WHERE provider_identity.provider = 'google_places'
          AND provider_identity.provider_place_id = v_place_id
          AND master.status = 'active'
          AND master.review_status = 'approved'
          AND (
            master.scope = 'shared_public'
            OR (master.scope = 'tenant_specific' AND master.tenant_id = v_recheck_tenant_id)
          );

        IF v_recheck_master_id IS NULL THEN
          v_failure_class := 'ineligible';
        ELSE
          v_failure_class := 'still_eligible';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A lifecycle raise (event_archived), or any unexpected error in
      -- the re-check itself. Never a statement about reuse eligibility.
      v_failure_class := 'unexpected';
    END;

    IF v_failure_class = 'ineligible' THEN
      -- Proven from post-failure state: this exact canonical candidate is
      -- now genuinely ineligible (retired / rejected / re-scoped /
      -- deleted). This is the ONLY path to not_reusable after a failed
      -- association.
      outcome := 'not_reusable';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- authority_lost | still_eligible | unexpected (incl.
    -- lifecycle-immutable): fail generically. Never not_reusable, so the
    -- client performs no Event-only fallback. No nested / id-bearing /
    -- distinguishing detail is exposed.
    RAISE EXCEPTION 'Nearby place reuse failed.';
  END LOOP;
END;
$function$;

ALTER FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[])
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

CREATE FUNCTION public.google_place_reuse_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Google Place reuse fixture assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.google_place_reuse_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.google_place_reuse_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $fixture$
BEGIN
  PERFORM public.google_place_reuse_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants
      WHERE organization_code IN ('GOOGLE-REUSE-FIXTURE-A', 'GOOGLE-REUSE-FIXTURE-B')
    ),
    'fixture Tenant identities must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title, is_active
  ) VALUES
    ('c1000000-0000-4000-8000-000000000001', 'GOOGLE-REUSE-FIXTURE-A',
     'google-reuse-fixture-a', 'Google Reuse Fixture Tenant A',
     'Google Reuse Tenant A', 'Google Reuse Tenant A', true),
    ('c1000000-0000-4000-8000-000000000002', 'GOOGLE-REUSE-FIXTURE-B',
     'google-reuse-fixture-b', 'Google Reuse Fixture Tenant B',
     'Google Reuse Tenant B', 'Google Reuse Tenant B', true);

  INSERT INTO public.events (
    id, tenant_id, name, location, start_date, end_date, timezone,
    lifecycle_state, status, visible_to_members, is_active
  ) VALUES
    ('c2000000-0000-4000-8000-000000000001',
     'c1000000-0000-4000-8000-000000000001',
     'Google Reuse Fixture Event A', 'Fixture A location', current_date,
     current_date + 10, 'UTC', 'operational', 'Draft', false, false),
    ('c2000000-0000-4000-8000-000000000002',
     'c1000000-0000-4000-8000-000000000002',
     'Google Reuse Fixture Event B', 'Fixture B location', current_date,
     current_date + 10, 'UTC', 'operational', 'Draft', false, false),
    ('c2000000-0000-4000-8000-000000000003',
     'c1000000-0000-4000-8000-000000000001',
     'Google Reuse Fixture Archived Event', 'Fixture archived location',
     current_date - 400, current_date - 390, 'UTC', 'archived', 'Completed',
     false, false);

  INSERT INTO auth.users (id, email) VALUES
    ('c3000000-0000-4000-8000-000000000001', 'google-reuse-event-admin@fixture.invalid'),
    ('c3000000-0000-4000-8000-000000000002', 'google-reuse-outsider@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id, privilege_group
  ) VALUES
    ('c4000000-0000-4000-8000-000000000001', 'google-reuse-event-admin@fixture.invalid',
     'Google Reuse Event Admin', true, false,
     'c3000000-0000-4000-8000-000000000001', 'event_admin'),
    ('c4000000-0000-4000-8000-000000000002', 'google-reuse-outsider@fixture.invalid',
     'Google Reuse Outsider Admin', true, false,
     'c3000000-0000-4000-8000-000000000002', 'event_admin');

  -- The primary actor: an Event Admin with an explicit event.nearby.manage
  -- grant on Event A and NO Tenant/Platform authority anywhere. This is
  -- exactly the population the association RPC already serves and the
  -- suppression matcher (20260825020000) deliberately does not.
  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES (
    'c7000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    'event_admin'
  );
  INSERT INTO public.admin_event_permissions (
    admin_event_access_id, permission_key, grant_source
  ) VALUES (
    'c7000000-0000-4000-8000-000000000001',
    'event.nearby.manage', 'manual'
  );

  -- Same actor also holds event.nearby.manage on the archived Event A,
  -- so the lifecycle guard is proven independently of authority.
  INSERT INTO public.admin_event_access (id, admin_user_id, event_id, role) VALUES (
    'c7000000-0000-4000-8000-000000000002',
    'c4000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000003',
    'event_admin'
  );
  INSERT INTO public.admin_event_permissions (
    admin_event_access_id, permission_key, grant_source
  ) VALUES (
    'c7000000-0000-4000-8000-000000000002',
    'event.nearby.manage', 'manual'
  );

  INSERT INTO public.nearby_master (
    id, name, category, address, status, scope, tenant_id, review_status
  ) VALUES
    -- reusable: approved active Shared
    ('c9000000-0000-4000-8000-000000000001', 'Fixture Shared Cafe', 'Fixture',
     '1 Shared Street', 'active', 'shared_public', NULL, 'approved'),
    -- reusable: approved active Tenant A place (Event A is Tenant A)
    ('c9000000-0000-4000-8000-000000000002', 'Fixture Tenant A Diner', 'Fixture',
     '2 Tenant Street', 'active', 'tenant_specific',
     'c1000000-0000-4000-8000-000000000001', 'approved'),
    -- not reusable for Event A: Tenant B place
    ('c9000000-0000-4000-8000-000000000003', 'Fixture Tenant B Diner', 'Fixture',
     '3 Other Street', 'active', 'tenant_specific',
     'c1000000-0000-4000-8000-000000000002', 'approved'),
    -- not reusable: inactive
    ('c9000000-0000-4000-8000-000000000004', 'Fixture Inactive Shared', 'Fixture',
     '4 Hidden Street', 'hidden', 'shared_public', NULL, 'approved'),
    -- not reusable: pending_review
    ('c9000000-0000-4000-8000-000000000005', 'Fixture Pending Shared', 'Fixture',
     '5 Pending Street', 'active', 'shared_public', NULL, 'pending_review'),
    -- not reusable: rejected
    ('c9000000-0000-4000-8000-000000000006', 'Fixture Rejected Shared', 'Fixture',
     '6 Rejected Street', 'active', 'shared_public', NULL, 'rejected'),
    -- approved active Shared, but deliberately given NO provider identity
    -- row -- proves a canonical place is reachable only through its exact
    -- Google Place ID, never by any other attribute.
    ('c9000000-0000-4000-8000-000000000007', 'Fixture Orphan Canonical', 'Fixture',
     '7 Orphan Street', 'active', 'shared_public', NULL, 'approved'),
    -- approved active Shared, reserved for the exception-discrimination
    -- probes (never associated by any other scenario).
    ('c9000000-0000-4000-8000-000000000008', 'Fixture Exception Probe', 'Fixture',
     '8 Probe Street', 'active', 'shared_public', NULL, 'approved');

  INSERT INTO public.nearby_master_provider_identities (
    nearby_master_id, provider, provider_place_id, created_by_auth_user_id
  ) VALUES
    ('c9000000-0000-4000-8000-000000000001', 'google_places',
     'reuse-fx-shared-approved', 'c3000000-0000-4000-8000-000000000001'),
    ('c9000000-0000-4000-8000-000000000002', 'google_places',
     'reuse-fx-tenant-a-approved', 'c3000000-0000-4000-8000-000000000001'),
    ('c9000000-0000-4000-8000-000000000003', 'google_places',
     'reuse-fx-tenant-b-approved', 'c3000000-0000-4000-8000-000000000001'),
    ('c9000000-0000-4000-8000-000000000004', 'google_places',
     'reuse-fx-shared-inactive', 'c3000000-0000-4000-8000-000000000001'),
    ('c9000000-0000-4000-8000-000000000005', 'google_places',
     'reuse-fx-shared-pending', 'c3000000-0000-4000-8000-000000000001'),
    ('c9000000-0000-4000-8000-000000000006', 'google_places',
     'reuse-fx-shared-rejected', 'c3000000-0000-4000-8000-000000000001'),
    ('c9000000-0000-4000-8000-000000000008', 'google_places',
     'reuse-fx-exception-probe', 'c3000000-0000-4000-8000-000000000001');
END;
$fixture$;

DO $fixture$
DECLARE
  v_rows record;
  v_outcome text;
  v_count integer;
  v_failed boolean;
  v_event_place_count integer;
BEGIN
  -- Anonymous caller is denied before anything else.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  BEGIN
    PERFORM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-shared-approved']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Nearby place reuse requires authenticated authority.';
  END;
  PERFORM public.google_place_reuse_fixture_assert(
    v_failed, 'anonymous caller cannot execute the governed reuse RPC'
  );

  -- An admin with no authority for Event A is denied before any lookup.
  PERFORM set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN
    PERFORM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-shared-approved']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Nearby place reuse requires event.nearby.manage authority.';
  END;
  PERFORM public.google_place_reuse_fixture_assert(
    v_failed, 'unauthorized Event actor is denied before identity exposure'
  );

  -- The pure Event Admin acts from here on.
  PERFORM set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);

  -- Approved active Shared place: reused, and an Event association row is
  -- created carrying source_master_id (canonical linkage), not an
  -- Event-only snapshot.
  SELECT outcome INTO v_outcome
  FROM public.reuse_nearby_places_by_google_place_id_for_event(
    'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-shared-approved']
  );
  PERFORM public.google_place_reuse_fixture_assert(
    v_outcome = 'reused',
    'approved active Shared place is reused for an authorized Event'
  );
  SELECT count(*) INTO v_event_place_count
  FROM public.event_nearby_places
  WHERE event_id = 'c2000000-0000-4000-8000-000000000001'
    AND source_master_id = 'c9000000-0000-4000-8000-000000000001';
  PERFORM public.google_place_reuse_fixture_assert(
    v_event_place_count = 1,
    'reuse creates exactly one canonical-linked Event association'
  );

  -- Second call: idempotent, reported as already_associated, no new row.
  SELECT outcome INTO v_outcome
  FROM public.reuse_nearby_places_by_google_place_id_for_event(
    'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-shared-approved']
  );
  PERFORM public.google_place_reuse_fixture_assert(
    v_outcome = 'already_associated',
    'a second reuse of the same place reports already_associated'
  );
  SELECT count(*) INTO v_event_place_count
  FROM public.event_nearby_places
  WHERE event_id = 'c2000000-0000-4000-8000-000000000001'
    AND source_master_id = 'c9000000-0000-4000-8000-000000000001';
  PERFORM public.google_place_reuse_fixture_assert(
    v_event_place_count = 1,
    'idempotent reuse never inserts a duplicate association'
  );

  -- Approved active Tenant place matching the Event's Tenant: reused.
  SELECT outcome INTO v_outcome
  FROM public.reuse_nearby_places_by_google_place_id_for_event(
    'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-tenant-a-approved']
  );
  PERFORM public.google_place_reuse_fixture_assert(
    v_outcome = 'reused',
    'approved active same-Tenant place is reused'
  );

  -- Every ineligible reason collapses to not_reusable -- the caller
  -- cannot tell a wrong-Tenant place from a pending one from a
  -- non-existent one.
  FOR v_rows IN
    SELECT google_place_id, outcome
    FROM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000001',
      ARRAY[
        'reuse-fx-tenant-b-approved',
        'reuse-fx-shared-inactive',
        'reuse-fx-shared-pending',
        'reuse-fx-shared-rejected',
        'reuse-fx-not-a-real-place-id'
      ]
    )
  LOOP
    PERFORM public.google_place_reuse_fixture_assert(
      v_rows.outcome = 'not_reusable',
      'wrong-Tenant, inactive, pending, rejected, and unknown all collapse to not_reusable ('
        || v_rows.google_place_id || ')'
    );
  END LOOP;

  -- An approved active Shared canonical place with no provider identity
  -- row cannot be reached at all -- identity is the exact Google Place ID
  -- and nothing else.
  SELECT outcome INTO v_outcome
  FROM public.reuse_nearby_places_by_google_place_id_for_event(
    'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-orphan-no-identity']
  );
  PERFORM public.google_place_reuse_fixture_assert(
    v_outcome = 'not_reusable',
    'a canonical place with no exact Google Place ID is never reusable by any other attribute'
  );

  -- Duplicate input Place IDs yield a single outcome row.
  SELECT count(*) INTO v_count
  FROM public.reuse_nearby_places_by_google_place_id_for_event(
    'c2000000-0000-4000-8000-000000000001',
    ARRAY['reuse-fx-shared-approved', 'reuse-fx-shared-approved', '  reuse-fx-shared-approved  ']
  );
  PERFORM public.google_place_reuse_fixture_assert(
    v_count = 1,
    'duplicate and whitespace-padded input Place IDs deduplicate to one outcome'
  );

  -- Archived Event: the lifecycle guard fires before any association.
  v_failed := false;
  BEGIN
    PERFORM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000003', ARRAY['reuse-fx-shared-approved']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'event_archived';
  END;
  PERFORM public.google_place_reuse_fixture_assert(
    v_failed, 'reuse into an archived Event is refused by the lifecycle guard'
  );

  -- The provider identity table stays opaque to every browser-reachable role.
  PERFORM public.google_place_reuse_fixture_assert(
    NOT has_table_privilege('authenticated', 'public.nearby_master_provider_identities', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.nearby_master_provider_identities', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.nearby_master_provider_identities', 'SELECT'),
    'no browser-reachable role gains direct provider identity table SELECT'
  );

  -- The function itself is executable only by authenticated.
  PERFORM public.google_place_reuse_fixture_assert(
    has_function_privilege('authenticated',
      'public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[])', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[])', 'EXECUTE')
    AND NOT has_function_privilege('service_role',
      'public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[])', 'EXECUTE'),
    'reuse RPC EXECUTE is granted to authenticated only'
  );

  -- ============================================================
  -- Failed-association re-classification.
  --
  -- A single BEGIN..ROLLBACK script cannot contain a *committed* second
  -- transaction, so a truly concurrent state change between the reuse
  -- RPC's eligibility SELECT and its delegated association cannot occur
  -- naturally here. It is staged instead by temporarily replacing (inside
  -- this rolled-back transaction) associate_nearby_master_place_with_event
  -- -- always -- plus, per scenario, resolve_task_authority or
  -- assert_event_lifecycle_mutable, using a NON-transactional temp
  -- sequence as a call counter (sequence advances survive the
  -- subtransaction aborts the RPC performs). 'reuse-fx-exception-probe'
  -- (c9...008) passes the RPC's own pre-check, so control reaches the
  -- delegated association and then the re-classification path.
  --
  -- Not staged here: the exact "genuine concurrent retire, observed only
  -- by the post-failure re-query" path is exercised in scenario (5) by a
  -- stub that mutates the probe row on its second call; a real committed
  -- concurrent writer is out of a serial fixture's reach and remains
  -- unverified until applied against a live database.
  -- ============================================================
  PERFORM set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
  CREATE TEMP SEQUENCE fixture_probe_calls;

  -- associate_ always fails from here on (the RPC must never trust the
  -- nested error).
  CREATE OR REPLACE FUNCTION public.associate_nearby_master_place_with_event(
    p_event_id uuid, p_place_id uuid
  ) RETURNS public.event_nearby_places
  LANGUAGE plpgsql AS $stub_assoc$
  BEGIN
    RAISE EXCEPTION
      'associate_nearby_master_place_with_event: place % is not approved (review_status=%)',
      p_place_id, 'rejected';
  END;
  $stub_assoc$;

  -- (1) Nested failure, but the candidate is STILL eligible on re-query
  -- (authority ok, lifecycle ok, exact predicate still matches). The
  -- nested failure was genuinely unexpected -> generic failure, NEVER
  -- not_reusable.
  v_failed := false;
  BEGIN
    PERFORM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-exception-probe']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Nearby place reuse failed.';
  END;
  PERFORM public.google_place_reuse_fixture_assert(
    v_failed,
    'a nested association failure while the candidate is still eligible re-raises generically and is never not_reusable'
  );

  -- (2) Same, with a NON-P0001 nested SQLSTATE -- still generic, still not
  -- not_reusable (the RPC never classifies by SQLSTATE).
  CREATE OR REPLACE FUNCTION public.associate_nearby_master_place_with_event(
    p_event_id uuid, p_place_id uuid
  ) RETURNS public.event_nearby_places
  LANGUAGE plpgsql AS $stub_assoc_xx$
  BEGIN
    RAISE EXCEPTION 'internal boom for %', p_place_id USING ERRCODE = 'XX000';
  END;
  $stub_assoc_xx$;
  v_failed := false;
  BEGIN
    PERFORM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-exception-probe']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Nearby place reuse failed.';
  END;
  PERFORM public.google_place_reuse_fixture_assert(
    v_failed,
    'a non-P0001 nested failure while still eligible also re-raises generically, never not_reusable'
  );

  -- restore the P0001-style stub for the remaining scenarios
  CREATE OR REPLACE FUNCTION public.associate_nearby_master_place_with_event(
    p_event_id uuid, p_place_id uuid
  ) RETURNS public.event_nearby_places
  LANGUAGE plpgsql AS $stub_assoc2$
  BEGIN
    RAISE EXCEPTION
      'associate_nearby_master_place_with_event: place % is not approved (review_status=%)',
      p_place_id, 'rejected';
  END;
  $stub_assoc2$;

  -- (3) Event lifecycle becomes immutable between the pre-check and the
  -- post-failure re-check -> generic failure, NEVER not_reusable, and the
  -- lifecycle raise text does not leak.
  ALTER SEQUENCE fixture_probe_calls RESTART WITH 1;
  CREATE OR REPLACE FUNCTION public.assert_event_lifecycle_mutable(p_event_id uuid)
  RETURNS void LANGUAGE plpgsql AS $stub_life$
  BEGIN
    IF nextval('pg_temp.fixture_probe_calls') >= 2 THEN
      RAISE EXCEPTION 'event_archived';
    END IF;
  END;
  $stub_life$;
  v_failed := false;
  BEGIN
    PERFORM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-exception-probe']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Nearby place reuse failed.';
  END;
  PERFORM public.google_place_reuse_fixture_assert(
    v_failed,
    'a post-failure Event lifecycle that is no longer mutable re-raises generically and is never not_reusable'
  );

  -- (4) The candidate is genuinely retired between the pre-check and the
  -- post-failure re-query -> not_reusable (the ONLY post-failure path to
  -- not_reusable). The stub deactivates the probe master on its second
  -- call, standing in for a committed concurrent retire.
  ALTER SEQUENCE fixture_probe_calls RESTART WITH 1;
  CREATE OR REPLACE FUNCTION public.assert_event_lifecycle_mutable(p_event_id uuid)
  RETURNS void LANGUAGE plpgsql AS $stub_life2$
  BEGIN
    IF nextval('pg_temp.fixture_probe_calls') >= 2 THEN
      UPDATE public.nearby_master
        SET status = 'hidden'
      WHERE id = 'c9000000-0000-4000-8000-000000000008';
    END IF;
  END;
  $stub_life2$;
  SELECT outcome INTO v_outcome
  FROM public.reuse_nearby_places_by_google_place_id_for_event(
    'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-exception-probe']
  );
  PERFORM public.google_place_reuse_fixture_assert(
    v_outcome = 'not_reusable',
    'a candidate that becomes genuinely ineligible on the post-failure re-query is reported not_reusable'
  );
  -- put the probe row back for scenario (5)
  UPDATE public.nearby_master SET status = 'active'
  WHERE id = 'c9000000-0000-4000-8000-000000000008';
  -- restore the real lifecycle assertion
  CREATE OR REPLACE FUNCTION public.assert_event_lifecycle_mutable(p_event_id uuid)
  RETURNS void LANGUAGE plpgsql AS $stub_life_ok$
  BEGIN
    NULL;
  END;
  $stub_life_ok$;

  -- (5) The caller's event.nearby.manage authority is revoked between the
  -- pre-check and the post-failure re-check -> generic failure, NEVER
  -- not_reusable, and no Event association is created.
  ALTER SEQUENCE fixture_probe_calls RESTART WITH 1;
  CREATE OR REPLACE FUNCTION public.resolve_task_authority(
    p_actor_auth_user_id uuid, p_task_key text, p_event_id uuid
  ) RETURNS TABLE(
    allowed boolean, decision_branch text, task_key text, event_id uuid,
    tenant_id uuid, admin_event_access_id uuid, admin_event_permission_id uuid,
    denial_reason text
  ) LANGUAGE plpgsql AS $stub_authz$
  BEGIN
    IF nextval('pg_temp.fixture_probe_calls') >= 2 THEN
      allowed := false; tenant_id := NULL; RETURN NEXT;
    ELSE
      allowed := true;
      tenant_id := 'c1000000-0000-4000-8000-000000000001';
      RETURN NEXT;
    END IF;
  END;
  $stub_authz$;
  v_failed := false;
  BEGIN
    PERFORM public.reuse_nearby_places_by_google_place_id_for_event(
      'c2000000-0000-4000-8000-000000000001', ARRAY['reuse-fx-exception-probe']
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Nearby place reuse failed.';
  END;
  PERFORM public.google_place_reuse_fixture_assert(
    v_failed,
    'a post-failure loss of event.nearby.manage authority re-raises generically and is never not_reusable'
  );

  -- Across every failed-association scenario above, no partial Event
  -- association was ever left behind (the RPC subtransaction rolled each
  -- one back).
  PERFORM public.google_place_reuse_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.event_nearby_places
      WHERE source_master_id = 'c9000000-0000-4000-8000-000000000008'
    ),
    'no failed association -- collapsed or generic -- ever leaves a partial Event row'
  );
END;
$fixture$;

ROLLBACK;

DO $fixture$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE organization_code IN ('GOOGLE-REUSE-FIXTURE-A', 'GOOGLE-REUSE-FIXTURE-B')
  )
  OR EXISTS (
    SELECT 1 FROM public.nearby_master
    WHERE id::text LIKE 'c9000000-0000-4000-8000-00000000000%'
  )
  OR to_regprocedure('public.google_place_reuse_fixture_assert(boolean,text)') IS NOT NULL
  OR to_regprocedure('public.reuse_nearby_places_by_google_place_id_for_event(uuid,text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Google Place reuse rollback left fixture residue';
  END IF;
END;
$fixture$;
