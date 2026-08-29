-- Temporary Event Access capability sessions.
--
-- The browser receives only a high-entropy capability hash. The database
-- stores that value bound to one active Event, Tenant, and attendee. The
-- existing member-facing RPC signatures remain stable; the shared resolver
-- recognizes the explicit capability marker and otherwise delegates to the
-- unchanged credential resolver for legacy sessions.

BEGIN;

CREATE TABLE public.temporary_member_capabilities (
  capability_hash text PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX temporary_member_capabilities_lookup_idx
  ON public.temporary_member_capabilities (event_id, attendee_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.temporary_member_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.temporary_member_capabilities FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text)
  RENAME TO resolve_temporary_or_authenticated_attendee_with_credentials;

CREATE OR REPLACE FUNCTION public.resolve_temporary_or_authenticated_attendee(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_capability_hash text;
  v_attendee_id uuid;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The marker prevents a capability from being mistaken for a registration
  -- credential. The hash itself is the bearer capability; it is never an
  -- attendee or Event assertion and is always checked against its binding.
  IF left(p_registration_identifier, char_length('__TEA_CAPABILITY__:')) =
      '__TEA_CAPABILITY__:' THEN
    v_capability_hash := substring(
      p_registration_identifier
      FROM char_length('__TEA_CAPABILITY__:') + 1
    );

    IF v_capability_hash !~ '^[0-9a-f]{64}$' THEN
      RETURN NULL;
    END IF;

    SELECT c.attendee_id
      INTO v_attendee_id
    FROM public.temporary_member_capabilities AS c
    JOIN public.events AS e ON e.id = c.event_id
    JOIN public.tenants AS t ON t.id = c.tenant_id AND t.id = e.tenant_id
    JOIN public.attendees AS a ON a.id = c.attendee_id AND a.event_id = c.event_id
    WHERE c.capability_hash = v_capability_hash
      AND c.event_id = p_event_id
      AND c.revoked_at IS NULL
      AND c.expires_at > now()
      AND t.is_active = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true
      AND coalesce(a.is_active, true) = true;

    RETURN v_attendee_id;
  END IF;

  RETURN public.resolve_temporary_or_authenticated_attendee_with_credentials(
    p_event_id, p_event_code, p_registration_identifier
  );
END;
$function$;

ALTER FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.resolve_temporary_or_authenticated_attendee_with_credentials(uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_temporary_or_authenticated_attendee_with_credentials(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text)
  TO anon, authenticated;

CREATE FUNCTION public.issue_temporary_member_capability(
  p_event_id uuid,
  p_event_code text,
  p_registration_identifier text,
  p_capability_hash text
)
RETURNS TABLE(
  id uuid,
  entry_id text,
  email text,
  pilot_first text,
  pilot_last text,
  copilot_first text,
  copilot_last text,
  has_arrived boolean,
  auth_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_attendee_id uuid;
  v_tenant_id uuid;
BEGIN
  IF p_capability_hash IS NULL OR p_capability_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'temporary access verification failed';
  END IF;

  -- This call uses the original credential branch and therefore preserves
  -- exact-one matching, Event lifecycle checks, and household resolution.
  v_attendee_id := public.resolve_temporary_or_authenticated_attendee_with_credentials(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_attendee_id IS NULL THEN
    RAISE EXCEPTION 'temporary access verification failed';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id
  FROM public.events AS e
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.id = p_event_id AND t.is_active = true;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'temporary access verification failed';
  END IF;

  INSERT INTO public.temporary_member_capabilities (
    capability_hash, event_id, tenant_id, attendee_id, expires_at
  ) VALUES (
    p_capability_hash, p_event_id, v_tenant_id, v_attendee_id,
    now() + interval '8 hours'
  );

  RETURN QUERY
  SELECT a.id, a.entry_id, a.email, a.pilot_first, a.pilot_last,
         a.copilot_first, a.copilot_last, a.has_arrived, a.auth_user_id
  FROM public.attendees AS a
  WHERE a.id = v_attendee_id AND a.event_id = p_event_id;
END;
$function$;

ALTER FUNCTION public.issue_temporary_member_capability(uuid, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_temporary_member_capability(uuid, text, text, text)
  FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_temporary_member_capability(uuid, text, text, text)
  TO anon;

COMMIT;