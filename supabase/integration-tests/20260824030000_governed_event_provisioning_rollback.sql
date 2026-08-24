-- Tenant T5 linked-database integration proof.
--
-- Installs the exact pending migration definitions inside one outer
-- transaction, creates isolated Tenant/Event/authority fixtures, exercises
-- the real governed command and the raw RLS/ACL boundary, and rolls every
-- fixture row and temporary object back.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE TABLE public.event_definition_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'event_created'),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_admin_user_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_definition_command_audit OWNER TO postgres;

CREATE INDEX event_definition_command_audit_event_idx
  ON public.event_definition_command_audit (event_id, occurred_at DESC);

CREATE INDEX event_definition_command_audit_tenant_idx
  ON public.event_definition_command_audit (tenant_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_event_definition_command_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'event_definition_command_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_event_definition_command_audit_mutation()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_event_definition_command_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_event_definition_command_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.event_definition_command_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_event_definition_command_audit_mutation();

ALTER TABLE public.event_definition_command_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_definition_command_audit
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_event_for_tenant(
  p_tenant_id uuid,
  p_name text,
  p_end_date date,
  p_timezone text,
  p_start_date date DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_event_code text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  name text,
  location text,
  start_date date,
  end_date date,
  timezone text,
  event_code text,
  status text,
  is_active boolean,
  visible_to_members boolean,
  lat numeric,
  lng numeric,
  lifecycle_state text,
  created_at timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_auth_user_id uuid := auth.uid();
  v_actor_admin_user_id uuid;
  v_tenant_is_active boolean;
  v_name text := nullif(btrim(p_name), '');
  v_timezone text := nullif(btrim(p_timezone), '');
  v_location text := nullif(btrim(p_location), '');
  v_event_code text := nullif(btrim(p_event_code), '');
  v_event public.events%ROWTYPE;
BEGIN
  IF v_actor_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Event creation requires active Platform or Tenant Admin authority.';
  END IF;

  SELECT au.id
    INTO v_actor_admin_user_id
  FROM public.admin_users AS au
  WHERE au.user_id = v_actor_auth_user_id
    AND au.is_active = true
  ORDER BY au.id
  LIMIT 1;

  IF v_actor_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Event creation requires active Platform or Tenant Admin authority.';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Owning Tenant is required.';
  END IF;

  IF NOT public.has_tenant_admin_authority(
    v_actor_auth_user_id,
    p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Event creation requires active Platform or Tenant Admin authority.';
  END IF;

  SELECT t.is_active
    INTO v_tenant_is_active
  FROM public.tenants AS t
  WHERE t.id = p_tenant_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owning Tenant not found.';
  END IF;

  IF v_tenant_is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Owning Tenant must be active.';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Event name is required.';
  END IF;

  IF p_end_date IS NULL THEN
    RAISE EXCEPTION 'Event end date is required.';
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Event end date cannot be before start date.';
  END IF;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_timezone_names AS tz
    WHERE tz.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'A valid IANA Event timezone is required.';
  END IF;

  IF (p_lat IS NULL) <> (p_lng IS NULL) THEN
    RAISE EXCEPTION 'Event latitude and longitude must be supplied together.';
  END IF;

  IF p_lat IS NOT NULL AND (p_lat < -90 OR p_lat > 90) THEN
    RAISE EXCEPTION 'Event latitude must be between -90 and 90.';
  END IF;

  IF p_lng IS NOT NULL AND (p_lng < -180 OR p_lng > 180) THEN
    RAISE EXCEPTION 'Event longitude must be between -180 and 180.';
  END IF;

  IF v_event_code IS NOT NULL THEN
    -- Member Event-code resolution already compares lower(btrim(code)). Use
    -- that one established normalization here, and serialize concurrent T5
    -- creates for the same normalized value before checking for a collision.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('event_code:' || lower(v_event_code), 0)
    );

    IF EXISTS (
      SELECT 1
      FROM public.events AS e
      WHERE lower(btrim(e.event_code)) = lower(v_event_code)
    ) THEN
      RAISE EXCEPTION 'Event code is already in use.';
    END IF;
  END IF;

  INSERT INTO public.events (
    tenant_id,
    name,
    location,
    start_date,
    end_date,
    timezone,
    event_code,
    status,
    is_active,
    visible_to_members,
    lat,
    lng
  ) VALUES (
    p_tenant_id,
    v_name,
    v_location,
    p_start_date,
    p_end_date,
    v_timezone,
    v_event_code,
    'Draft',
    false,
    false,
    p_lat,
    p_lng
  )
  RETURNING * INTO v_event;

  INSERT INTO public.event_definition_command_audit (
    event_id,
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    after_state
  ) VALUES (
    v_event.id,
    v_event.tenant_id,
    'event_created',
    v_actor_auth_user_id,
    v_actor_admin_user_id,
    jsonb_build_object(
      'id', v_event.id,
      'tenant_id', v_event.tenant_id,
      'name', v_event.name,
      'location', v_event.location,
      'start_date', v_event.start_date,
      'end_date', v_event.end_date,
      'timezone', v_event.timezone,
      'event_code', v_event.event_code,
      'status', v_event.status,
      'is_active', v_event.is_active,
      'visible_to_members', v_event.visible_to_members,
      'lifecycle_state', v_event.lifecycle_state
    )
  );

  RETURN QUERY
  SELECT
    v_event.id,
    v_event.tenant_id,
    v_event.name,
    v_event.location,
    v_event.start_date,
    v_event.end_date,
    v_event.timezone,
    v_event.event_code,
    v_event.status,
    v_event.is_active,
    v_event.visible_to_members,
    v_event.lat,
    v_event.lng,
    v_event.lifecycle_state,
    v_event.created_at;
END;
$function$;

ALTER FUNCTION public.create_event_for_tenant(
  uuid, text, date, text, date, text, text, numeric, numeric
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_event_for_tenant(
  uuid, text, date, text, date, text, text, numeric, numeric
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.create_event_for_tenant(
  uuid, text, date, text, date, text, text, numeric, numeric
) TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

CREATE FUNCTION public.t5_event_provisioning_fixture_assert(
  p_condition boolean,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'T5 assertion failed: %', p_message;
  END IF;
END;
$function$;

ALTER FUNCTION public.t5_event_provisioning_fixture_assert(boolean, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t5_event_provisioning_fixture_assert(boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t5_event_provisioning_fixture_assert(boolean, text)
  TO anon, authenticated;

CREATE FUNCTION public.t5_event_provisioning_fixture_event_id(p_event_code text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT e.id
  FROM public.events AS e
  WHERE e.event_code = p_event_code;
$function$;

ALTER FUNCTION public.t5_event_provisioning_fixture_event_id(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t5_event_provisioning_fixture_event_id(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t5_event_provisioning_fixture_event_id(text)
  TO authenticated;

CREATE FUNCTION public.t5_event_provisioning_fixture_audit_count(
  p_event_id uuid DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT count(*)
  FROM public.event_definition_command_audit AS a
  WHERE (p_event_id IS NULL OR a.event_id = p_event_id)
    AND (p_tenant_id IS NULL OR a.tenant_id = p_tenant_id);
$function$;

ALTER FUNCTION public.t5_event_provisioning_fixture_audit_count(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t5_event_provisioning_fixture_audit_count(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t5_event_provisioning_fixture_audit_count(uuid, uuid)
  TO authenticated;

CREATE FUNCTION public.t5_event_provisioning_fixture_audit_matches(
  p_event_id uuid,
  p_tenant_id uuid,
  p_actor_auth_user_id uuid,
  p_actor_admin_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_definition_command_audit AS a
    WHERE a.event_id = p_event_id
      AND a.tenant_id = p_tenant_id
      AND a.action = 'event_created'
      AND a.actor_auth_user_id = p_actor_auth_user_id
      AND a.actor_admin_user_id = p_actor_admin_user_id
      AND a.after_state ->> 'id' = p_event_id::text
      AND a.after_state ->> 'tenant_id' = p_tenant_id::text
      AND a.after_state ->> 'status' = 'Draft'
      AND a.after_state ->> 'lifecycle_state' = 'operational'
  );
$function$;

ALTER FUNCTION public.t5_event_provisioning_fixture_audit_matches(
  uuid, uuid, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t5_event_provisioning_fixture_audit_matches(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t5_event_provisioning_fixture_audit_matches(
  uuid, uuid, uuid, uuid
) TO authenticated;

CREATE FUNCTION public.t5_event_provisioning_fixture_dependency_count(
  p_event_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_relation regclass;
  v_column name;
  v_relation_count bigint;
  v_total bigint := 0;
BEGIN
  FOR v_relation, v_column IN
    SELECT c.conrelid::regclass, source_column.attname
    FROM pg_constraint AS c
    JOIN LATERAL unnest(c.conkey, c.confkey)
      AS keys(source_attnum, target_attnum) ON true
    JOIN pg_attribute AS source_column
      ON source_column.attrelid = c.conrelid
     AND source_column.attnum = keys.source_attnum
    JOIN pg_attribute AS target_column
      ON target_column.attrelid = c.confrelid
     AND target_column.attnum = keys.target_attnum
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.events'::regclass
      AND target_column.attname = 'id'
      AND c.conrelid <> 'public.event_definition_command_audit'::regclass
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE %I = $1',
      v_relation,
      v_column
    )
    INTO v_relation_count
    USING p_event_id;

    v_total := v_total + v_relation_count;
  END LOOP;

  RETURN v_total;
END;
$function$;

ALTER FUNCTION public.t5_event_provisioning_fixture_dependency_count(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t5_event_provisioning_fixture_dependency_count(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t5_event_provisioning_fixture_dependency_count(uuid)
  TO authenticated;

CREATE FUNCTION public.t5_event_provisioning_fixture_global_counts()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'admin_users', (SELECT count(*) FROM public.admin_users),
    'tenant_access', (SELECT count(*) FROM public.admin_tenant_access),
    'people', (SELECT count(*) FROM public.people),
    'vendors', (SELECT count(*) FROM public.vendors)
  );
$function$;

ALTER FUNCTION public.t5_event_provisioning_fixture_global_counts()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t5_event_provisioning_fixture_global_counts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t5_event_provisioning_fixture_global_counts()
  TO authenticated;

CREATE FUNCTION public.t5_event_provisioning_fixture_direct_assignment_count(
  p_event_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT count(*)
  FROM public.admin_event_access AS aea
  WHERE aea.event_id = p_event_id;
$function$;

ALTER FUNCTION public.t5_event_provisioning_fixture_direct_assignment_count(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.t5_event_provisioning_fixture_direct_assignment_count(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.t5_event_provisioning_fixture_direct_assignment_count(uuid)
  TO authenticated;

DO $fixture$
BEGIN
  PERFORM public.t5_event_provisioning_fixture_assert(
    NOT EXISTS (
      SELECT 1
      FROM public.tenants AS t
      WHERE t.organization_code LIKE 'T5-PROVISION-%'
    ),
    'fixture Tenant codes must be unused before setup'
  );

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title,
    is_active
  ) VALUES
    ('71000000-0000-4000-8000-000000000001', 'T5-PROVISION-A',
     't5-provision-a', 'T5 Provision Tenant A', 'T5 Tenant A', 'T5 Tenant A', true),
    ('71000000-0000-4000-8000-000000000002', 'T5-PROVISION-B',
     't5-provision-b', 'T5 Provision Tenant B', 'T5 Tenant B', 'T5 Tenant B', true),
    ('71000000-0000-4000-8000-000000000003', 'T5-PROVISION-INACTIVE',
     't5-provision-inactive', 'T5 Inactive Tenant', 'T5 Inactive', 'T5 Inactive', false);

  INSERT INTO public.events (
    id, tenant_id, name, start_date, end_date, timezone, lifecycle_state,
    status, visible_to_members, is_active, event_code
  ) VALUES (
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'T5 Existing Direct-Admin Event', current_date, current_date + 10, 'UTC',
    'operational', 'Draft', false, false, 'T5-EXISTING'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('74000000-0000-4000-8000-000000000001', 't5-platform@fixture.invalid'),
    ('74000000-0000-4000-8000-000000000002', 't5-tenant-a@fixture.invalid'),
    ('74000000-0000-4000-8000-000000000003', 't5-tenant-b@fixture.invalid'),
    ('74000000-0000-4000-8000-000000000004', 't5-direct@fixture.invalid'),
    ('74000000-0000-4000-8000-000000000005', 't5-neither@fixture.invalid'),
    ('74000000-0000-4000-8000-000000000006', 't5-inactive-admin@fixture.invalid');

  INSERT INTO public.admin_users (
    id, email, display_name, is_active, is_super_admin, user_id,
    privilege_group
  ) VALUES
    ('73000000-0000-4000-8000-000000000001', 't5-platform@fixture.invalid',
     'T5 Platform', true, true,
     '74000000-0000-4000-8000-000000000001', 'super_admin'),
    ('73000000-0000-4000-8000-000000000002', 't5-tenant-a@fixture.invalid',
     'T5 Tenant A Admin', true, false,
     '74000000-0000-4000-8000-000000000002', 'event_admin'),
    ('73000000-0000-4000-8000-000000000003', 't5-tenant-b@fixture.invalid',
     'T5 Tenant B Admin', true, false,
     '74000000-0000-4000-8000-000000000003', 'event_admin'),
    ('73000000-0000-4000-8000-000000000004', 't5-direct@fixture.invalid',
     'T5 Direct Event Admin', true, false,
     '74000000-0000-4000-8000-000000000004', 'event_admin'),
    ('73000000-0000-4000-8000-000000000005', 't5-neither@fixture.invalid',
     'T5 Neither Admin', true, false,
     '74000000-0000-4000-8000-000000000005', 'event_admin'),
    ('73000000-0000-4000-8000-000000000006', 't5-inactive-admin@fixture.invalid',
     'T5 Inactive Admin', false, false,
     '74000000-0000-4000-8000-000000000006', 'event_admin');

  INSERT INTO public.admin_tenant_access (
    admin_user_id, tenant_id, is_active, created_by
  ) VALUES
    ('73000000-0000-4000-8000-000000000002',
     '71000000-0000-4000-8000-000000000001', true, 't5-fixture'),
    ('73000000-0000-4000-8000-000000000003',
     '71000000-0000-4000-8000-000000000002', true, 't5-fixture'),
    ('73000000-0000-4000-8000-000000000006',
     '71000000-0000-4000-8000-000000000001', true, 't5-fixture');

  INSERT INTO public.admin_event_access (
    id, admin_user_id, event_id, role
  ) VALUES (
    '75000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000004',
    '72000000-0000-4000-8000-000000000001',
    'event_admin'
  );
END;
$fixture$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_created record;
  v_event_id uuid;
  v_count bigint;
  v_failed boolean;
  v_global_counts jsonb;
BEGIN
  v_global_counts := public.t5_event_provisioning_fixture_global_counts();

  -- Platform authority can provision for any active Tenant.
  PERFORM set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_created
  FROM public.create_event_for_tenant(
    '71000000-0000-4000-8000-000000000002',
    '  T5 Platform Event  ',
    current_date + 30,
    'UTC',
    current_date + 20,
    '  Platform Venue  ',
    'T5-PLATFORM',
    0,
    0
  );
  v_event_id := v_created.id;

  PERFORM public.t5_event_provisioning_fixture_assert(
    v_created.tenant_id = '71000000-0000-4000-8000-000000000002'
    AND v_created.name = 'T5 Platform Event'
    AND v_created.location = 'Platform Venue'
    AND v_created.start_date = current_date + 20
    AND v_created.end_date = current_date + 30
    AND v_created.timezone = 'UTC'
    AND v_created.event_code = 'T5-PLATFORM'
    AND v_created.status = 'Draft'
    AND v_created.is_active = false
    AND v_created.visible_to_members = false
    AND v_created.lat = 0
    AND v_created.lng = 0
    AND v_created.lifecycle_state = 'operational'
    AND v_created.created_at IS NOT NULL,
    'Platform create returns the authoritative persisted Event and preserves false/zero/default values'
  );
  PERFORM public.t5_event_provisioning_fixture_assert(
    public.event_effective_lifecycle_state(v_event_id) = 'operational',
    'new Event has determinate operational lifecycle from required end date and timezone'
  );
  PERFORM public.t5_event_provisioning_fixture_assert(
    public.t5_event_provisioning_fixture_audit_matches(
      v_event_id,
      '71000000-0000-4000-8000-000000000002',
      '74000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001'
    ),
    'Platform create records immutable actor/Event/Tenant/timestamp state'
  );
  PERFORM public.t5_event_provisioning_fixture_assert(
    public.t5_event_provisioning_fixture_dependency_count(v_event_id) = 0,
    'create has zero Event-dependent side effects outside its audit row'
  );
  PERFORM public.t5_event_provisioning_fixture_assert(
    public.t5_event_provisioning_fixture_global_counts() = v_global_counts,
    'create manufactures no Admin User, Tenant assignment, Person, or Vendor'
  );

  -- Ownership is the exact explicit target and T0 makes it immutable.
  v_failed := false;
  BEGIN
    UPDATE public.events
    SET tenant_id = '71000000-0000-4000-8000-000000000001'
    WHERE id = v_event_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'events.tenant_id is immutable after insert';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed
    AND (SELECT e.tenant_id FROM public.events AS e WHERE e.id = v_event_id)
      = '71000000-0000-4000-8000-000000000002',
    'T0 prevents post-creation Tenant transfer for Platform authority'
  );

  -- Raw client INSERT remains closed even for Platform authority.
  v_failed := false;
  BEGIN
    INSERT INTO public.events (tenant_id, name, end_date, timezone)
    VALUES (
      '71000000-0000-4000-8000-000000000002',
      'T5 Forbidden Raw Insert',
      current_date + 30,
      'UTC'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed,
    'authenticated Platform client cannot bypass the RPC with raw INSERT'
  );

  -- Same normalized Event code is rejected without another Event/audit row.
  v_count := public.t5_event_provisioning_fixture_audit_count(
    NULL,
    '71000000-0000-4000-8000-000000000002'
  );
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000002',
      'T5 Duplicate Code', current_date + 30, 'UTC', NULL, NULL,
      '  t5-platform  ', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event code is already in use.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed
    AND public.t5_event_provisioning_fixture_audit_count(
      NULL,
      '71000000-0000-4000-8000-000000000002'
    ) = v_count,
    'caller-supplied Event code uses established trim/case normalization and fails atomically on collision'
  );

  -- Tenant Admin can create only for their own active Tenant. No direct
  -- assignment is manufactured; inherited authority resolves immediately.
  PERFORM set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_created
  FROM public.create_event_for_tenant(
    '71000000-0000-4000-8000-000000000001',
    'T5 Tenant A Event', current_date + 40, 'America/Chicago', NULL,
    NULL, 'T5-TENANT-A', NULL, NULL
  );
  v_event_id := v_created.id;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_created.tenant_id = '71000000-0000-4000-8000-000000000001'
    AND public.has_event_admin_authority(auth.uid(), v_event_id)
    AND public.t5_event_provisioning_fixture_direct_assignment_count(v_event_id) = 0
    AND public.t5_event_provisioning_fixture_dependency_count(v_event_id) = 0,
    'Tenant Admin create uses explicit ownership and immediate inherited authority without direct assignment or setup rows'
  );
  PERFORM public.t5_event_provisioning_fixture_assert(
    public.t5_event_provisioning_fixture_audit_matches(
      v_event_id,
      '71000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000002',
      '73000000-0000-4000-8000-000000000002'
    ),
    'Tenant Admin create records the actual authenticated actor'
  );

  v_count := public.t5_event_provisioning_fixture_audit_count();
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000002',
      'T5 Cross Tenant', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event creation requires active Platform or Tenant Admin authority.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed AND public.t5_event_provisioning_fixture_audit_count() = v_count,
    'Tenant Admin cannot create for another Tenant and no success audit is fabricated'
  );

  -- Direct Event authority cannot create a sibling/new Event.
  PERFORM set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001',
      'T5 Direct Admin Attempt', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event creation requires active Platform or Tenant Admin authority.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed AND public.t5_event_provisioning_fixture_audit_count() = v_count,
    'direct Event Admin cannot create a sibling Event'
  );

  -- An active Admin with neither Tenant nor Platform authority is denied.
  PERFORM set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000005', true);
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001',
      'T5 Neither Attempt', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event creation requires active Platform or Tenant Admin authority.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed AND public.t5_event_provisioning_fixture_audit_count() = v_count,
    'ordinary authenticated Admin is denied without mutation or audit'
  );

  -- An inactive Admin cannot use a retained Tenant assignment.
  PERFORM set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000006', true);
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001',
      'T5 Inactive Admin Attempt', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event creation requires active Platform or Tenant Admin authority.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed AND public.t5_event_provisioning_fixture_audit_count() = v_count,
    'inactive Admin is denied without mutation or audit'
  );

  -- Platform recovery authority does not bypass active-Tenant creation.
  PERFORM set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000003',
      'T5 Inactive Tenant Attempt', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Owning Tenant must be active.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed AND public.t5_event_provisioning_fixture_audit_count() = v_count,
    'inactive target Tenant is denied even to Platform recovery authority'
  );

  -- Required/typed contract validation is server-controlled and atomic.
  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      NULL, 'T5 Missing Tenant', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Owning Tenant is required.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(v_failed, 'explicit Tenant is required');

  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001', ' ', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event name is required.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(v_failed, 'Event name is required');

  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001', 'T5 Missing End', NULL, 'UTC'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event end date is required.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(v_failed, 'Event end date is required');

  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001',
      'T5 Invalid Timezone', current_date + 30, 'Not/A_Timezone'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'A valid IANA Event timezone is required.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(v_failed, 'IANA timezone is required');

  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001',
      'T5 Invalid Dates', current_date + 10, 'UTC', current_date + 20
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event end date cannot be before start date.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(v_failed, 'date ordering is validated');

  v_failed := false;
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001',
      'T5 Partial Coordinates', current_date + 30, 'UTC', NULL, NULL, NULL, 10, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event latitude and longitude must be supplied together.';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(v_failed, 'coordinate pair is validated');
  PERFORM public.t5_event_provisioning_fixture_assert(
    public.t5_event_provisioning_fixture_audit_count() = v_count,
    'all failed validation cases leave Event and audit state unchanged'
  );
END;
$fixture$;

-- anon has neither EXECUTE nor an authenticated actor.
RESET ROLE;
SET LOCAL ROLE anon;

DO $fixture$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.create_event_for_tenant(
      '71000000-0000-4000-8000-000000000001',
      'T5 Anonymous Attempt', current_date + 30, 'UTC'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed,
    'anonymous caller cannot execute Event creation'
  );
END;
$fixture$;

RESET ROLE;

-- Audit evidence remains immutable even to table-owner execution.
DO $fixture$
DECLARE
  v_audit_id uuid;
  v_failed boolean;
BEGIN
  SELECT a.id INTO v_audit_id
  FROM public.event_definition_command_audit AS a
  ORDER BY a.occurred_at, a.id
  LIMIT 1;

  v_failed := false;
  BEGIN
    UPDATE public.event_definition_command_audit
    SET after_state = '{}'::jsonb
    WHERE id = v_audit_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'event_definition_command_audit is immutable';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed,
    'Event creation audit UPDATE is blocked'
  );

  v_failed := false;
  BEGIN
    DELETE FROM public.event_definition_command_audit WHERE id = v_audit_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'event_definition_command_audit is immutable';
  END;
  PERFORM public.t5_event_provisioning_fixture_assert(
    v_failed,
    'Event creation audit DELETE is blocked'
  );

  PERFORM public.t5_event_provisioning_fixture_assert(
    (SELECT count(*) FROM public.events WHERE tenant_id IN (
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000002',
      '71000000-0000-4000-8000-000000000003'
    )) = 3,
    'fixture contains one setup Event and exactly two governed-created Events before rollback'
  );
END;
$fixture$;

ROLLBACK;
