-- Tenant T5: governed Event provisioning.
--
-- Every new Event is created through one explicit Tenant-owned command. The
-- target Tenant is supplied by UUID, resolved and required active on the
-- server, and authorized through the canonical Platform/Tenant hierarchy.
-- Direct Event assignment is intentionally irrelevant: Event-scoped authority
-- starts only after an Event exists, while Tenant authority already covers a
-- newly-created Event dynamically through events.tenant_id.
--
-- The command creates exactly one public.events row plus immutable command
-- audit evidence. It creates no Event assignment, Person, participation,
-- attendee, Vendor, commercial, map, settings, or other setup row.

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

COMMIT;
