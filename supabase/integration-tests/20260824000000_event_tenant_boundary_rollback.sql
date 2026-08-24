-- Tenant T0 linked-database integration proof.
--
-- Installs the exact pending Event ownership trigger inside one outer
-- transaction, creates isolated authority fixtures, exercises real events RLS
-- as authenticated callers, and rolls every object and row back at the end.

BEGIN;

-- ============================================================
-- PARITY: 20260824000000_enforce_event_tenant_ownership_immutability.sql
-- ============================================================

CREATE FUNCTION public.prevent_event_tenant_ownership_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'events.tenant_id is immutable after insert';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.prevent_event_tenant_ownership_change() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_event_tenant_ownership_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_event_tenant_ownership_change
BEFORE UPDATE OF tenant_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_event_tenant_ownership_change();

-- The server-side Vendor invitation helper must consume the same canonical
-- predicate as Event RLS rather than reimplementing the hierarchy from raw
-- admin tables. service_role already owns the server-only caller boundary;
-- this grant exposes no new authenticated or anonymous capability.
GRANT EXECUTE ON FUNCTION public.has_event_admin_authority(uuid, uuid)
  TO service_role;

-- ============================================================
-- Isolated fixture and assertion helper
-- ============================================================

CREATE FUNCTION public.t0_event_tenant_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'T0 assertion failed: %', p_message;
  END IF;
END;
$$;

ALTER FUNCTION public.t0_event_tenant_fixture_assert(boolean, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t0_event_tenant_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t0_event_tenant_fixture_assert(boolean, text)
  TO authenticated;

DO $$
BEGIN
  PERFORM public.t0_event_tenant_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM public.tenants
      WHERE organization_code LIKE 'T0-BOUNDARY-%'
    ),
    'fixture Tenant codes must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title,
    is_active
  ) VALUES
    ('10000000-0000-4000-8000-000000000001', 'T0-BOUNDARY-A',
     't0-boundary-a', 'T0 Boundary Tenant A', 'T0 Tenant A', 'T0 Tenant A', true),
    ('10000000-0000-4000-8000-000000000002', 'T0-BOUNDARY-B',
     't0-boundary-b', 'T0 Boundary Tenant B', 'T0 Tenant B', 'T0 Tenant B', true),
    ('10000000-0000-4000-8000-000000000003', 'T0-BOUNDARY-INACTIVE',
     't0-boundary-inactive', 'T0 Boundary Inactive Tenant',
     'T0 Inactive Tenant', 'T0 Inactive Tenant', false);

  INSERT INTO public.events (id, name, tenant_id, location) VALUES
    ('20000000-0000-4000-8000-000000000001', 'T0 Event A1',
     '10000000-0000-4000-8000-000000000001', 'A1 original'),
    ('20000000-0000-4000-8000-000000000002', 'T0 Event A2',
     '10000000-0000-4000-8000-000000000001', 'A2 original'),
    ('20000000-0000-4000-8000-000000000003', 'T0 Event B1',
     '10000000-0000-4000-8000-000000000002', 'B1 original'),
    ('20000000-0000-4000-8000-000000000004', 'T0 Event Inactive Tenant',
     '10000000-0000-4000-8000-000000000003', 'inactive original');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id,
    privilege_group
  ) VALUES
    ('30000000-0000-4000-8000-000000000001', 't0-platform@example.invalid',
     'T0 Platform Admin', true, true,
     '40000000-0000-4000-8000-000000000001', 'super_admin'),
    ('30000000-0000-4000-8000-000000000002', 't0-tenant-a@example.invalid',
     'T0 Tenant A Admin', true, false,
     '40000000-0000-4000-8000-000000000002', 'event_admin'),
    ('30000000-0000-4000-8000-000000000003', 't0-event-a1@example.invalid',
     'T0 Event A1 Admin', true, false,
     '40000000-0000-4000-8000-000000000003', 'event_admin'),
    ('30000000-0000-4000-8000-000000000004', 't0-unauthorized@example.invalid',
     'T0 Unauthorized Admin', true, false,
     '40000000-0000-4000-8000-000000000004', 'event_admin'),
    ('30000000-0000-4000-8000-000000000005', 't0-inactive@example.invalid',
     'T0 Inactive Tenant Admin', true, false,
     '40000000-0000-4000-8000-000000000005', 'event_admin');

  INSERT INTO public.admin_tenant_access (
    admin_user_id, tenant_id, is_active, created_by
  ) VALUES
    ('30000000-0000-4000-8000-000000000002',
     '10000000-0000-4000-8000-000000000001', true, 't0-fixture'),
    ('30000000-0000-4000-8000-000000000005',
     '10000000-0000-4000-8000-000000000003', true, 't0-fixture');

  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    'event_admin'
  );
END;
$$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_rows bigint;
  v_tenant_id uuid;
BEGIN
  -- Direct Event Admin: Event A1 only, no Tenant-wide or cross-Tenant reach.
  PERFORM set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000003',
    true
  );

  PERFORM public.t0_event_tenant_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '20000000-0000-4000-8000-000000000001'
    ),
    'direct Event Admin must retain Event A1 authority'
  );
  PERFORM public.t0_event_tenant_fixture_assert(
    NOT public.has_event_admin_authority(
      auth.uid(), '20000000-0000-4000-8000-000000000002'
    ),
    'direct Event Admin must not inherit Event A2 authority'
  );
  PERFORM public.t0_event_tenant_fixture_assert(
    NOT public.has_event_admin_authority(
      auth.uid(), '20000000-0000-4000-8000-000000000003'
    ),
    'direct Event Admin must not cross into Tenant B'
  );

  UPDATE public.events
  SET location = 'A1 direct metadata edit'
  WHERE id = '20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 1,
    'authorized direct Event metadata edit must succeed'
  );

  UPDATE public.events
  SET location = 'A2 forbidden direct edit'
  WHERE id = '20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 0,
    'direct Event Admin must not edit another Event in the same Tenant'
  );

  BEGIN
    UPDATE public.events
    SET tenant_id = '10000000-0000-4000-8000-000000000002'
    WHERE id = '20000000-0000-4000-8000-000000000001';
    PERFORM public.t0_event_tenant_fixture_assert(
      false,
      'direct Event Admin ownership change unexpectedly succeeded'
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.t0_event_tenant_fixture_assert(
      SQLERRM = 'events.tenant_id is immutable after insert',
      'direct Event Admin must receive the ownership immutability rejection'
    );
  END;

  SELECT tenant_id INTO v_tenant_id
  FROM public.events
  WHERE id = '20000000-0000-4000-8000-000000000001';
  PERFORM public.t0_event_tenant_fixture_assert(
    v_tenant_id = '10000000-0000-4000-8000-000000000001',
    'failed direct Event Admin transfer must preserve Tenant A ownership'
  );

  -- Including the unchanged ownership value is harmless; only a real
  -- ownership change is forbidden.
  UPDATE public.events
  SET tenant_id = '10000000-0000-4000-8000-000000000001',
      location = 'A1 same-owner metadata edit'
  WHERE id = '20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 1,
    'same-owner metadata update must remain valid'
  );

  -- Tenant A Admin: both Tenant A Events through canonical inheritance, no B.
  PERFORM set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000002',
    true
  );

  SELECT count(*) INTO v_rows
  FROM public.events
  WHERE id IN (
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003'
  );
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 2,
    'Tenant A Admin RLS must expose exactly A1 and A2 without direct rows'
  );

  UPDATE public.events
  SET location = 'A2 Tenant Admin metadata edit'
  WHERE id = '20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 1,
    'Tenant Admin inherited metadata edit must succeed'
  );

  UPDATE public.events
  SET location = 'B1 forbidden Tenant A edit'
  WHERE id = '20000000-0000-4000-8000-000000000003';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 0,
    'Tenant A Admin must not edit Tenant B Event'
  );

  BEGIN
    UPDATE public.events
    SET tenant_id = '10000000-0000-4000-8000-000000000002'
    WHERE id = '20000000-0000-4000-8000-000000000002';
    PERFORM public.t0_event_tenant_fixture_assert(
      false,
      'Tenant Admin ownership change unexpectedly succeeded'
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.t0_event_tenant_fixture_assert(
      SQLERRM = 'events.tenant_id is immutable after insert',
      'Tenant Admin must receive the ownership immutability rejection'
    );
  END;

  -- Platform Admin: ordinary metadata remains allowed; ownership still does not.
  PERFORM set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000001',
    true
  );

  UPDATE public.events
  SET location = 'B1 Platform metadata edit'
  WHERE id = '20000000-0000-4000-8000-000000000003';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 1,
    'Platform Admin ordinary metadata edit must succeed'
  );

  BEGIN
    UPDATE public.events
    SET tenant_id = '10000000-0000-4000-8000-000000000001'
    WHERE id = '20000000-0000-4000-8000-000000000003';
    PERFORM public.t0_event_tenant_fixture_assert(
      false,
      'Platform raw ownership change unexpectedly succeeded'
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.t0_event_tenant_fixture_assert(
      SQLERRM = 'events.tenant_id is immutable after insert',
      'Platform Admin must receive the ownership immutability rejection'
    );
  END;

  -- No authority: metadata UPDATE remains denied by the existing RLS policy.
  PERFORM set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000004',
    true
  );
  UPDATE public.events
  SET location = 'unauthorized edit'
  WHERE id = '20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 0,
    'unauthorized Event metadata edit must remain denied'
  );

  -- T0-D evidence only: current inactive-Tenant authority semantics remain
  -- exactly as they were. This test records the inconsistency; it does not
  -- endorse it as the eventual lifecycle policy.
  PERFORM set_config(
    'request.jwt.claim.sub',
    '40000000-0000-4000-8000-000000000005',
    true
  );
  PERFORM public.t0_event_tenant_fixture_assert(
    public.has_event_admin_authority(
      auth.uid(), '20000000-0000-4000-8000-000000000004'
    ),
    'T0 must not silently change inactive-Tenant authority semantics'
  );
  UPDATE public.events
  SET location = 'inactive Tenant current behavior'
  WHERE id = '20000000-0000-4000-8000-000000000004';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.t0_event_tenant_fixture_assert(
    v_rows = 1,
    'inactive-Tenant metadata behavior must remain unchanged in T0'
  );
END;
$$;

RESET ROLE;

ROLLBACK;
