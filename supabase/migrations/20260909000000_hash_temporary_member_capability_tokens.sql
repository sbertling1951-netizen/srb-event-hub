-- Store only a digest of the bearer token; the browser receives the raw token.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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
  v_capability_token text;
  v_capability_hash text;
  v_attendee_id uuid;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF left(p_registration_identifier, char_length('__TEA_CAPABILITY__:')) =
      '__TEA_CAPABILITY__:' THEN
    v_capability_token := substring(
      p_registration_identifier
      FROM char_length('__TEA_CAPABILITY__:') + 1
    );

    IF v_capability_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RETURN NULL;
    END IF;

    v_capability_hash := encode(
      extensions.digest(v_capability_token, 'sha256'),
      'hex'
    );

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

COMMIT;
