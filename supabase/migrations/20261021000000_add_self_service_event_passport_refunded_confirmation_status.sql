-- Passport confirmation reader: add a third, minimal 'refunded'
-- discriminator so the organizer UI can distinguish "never confirmed" from
-- "confirmed, then refunded" instead of collapsing both into
-- 'not_confirmed' and rendering a misleading purchase/return-confirming
-- state after a genuinely completed refund.
--
-- Replaces only get_my_self_service_event_passport_confirmation(uuid) from
-- 20261015000000_govern_self_service_event_passport_confirmation_read_access.sql.
-- Every existing authenticated/identity/ownership/private-Draft/tenant/Event
-- check above the discriminator is untouched; only the discriminator logic
-- below is extended. No table, grant, or revoke changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_self_service_event_passport_confirmation(
  p_event_id uuid
)
-- The sole column is the discriminator:
--   'confirmed'      -> this Event's Passport is preserved (reserved/
--                        active/expired) -- payment confirmed
--   'refunded'       -> this Event's Passport was confirmed and has since
--                        been refunded; the Event is back in its ordinary
--                        unpaid Delete/Replace cycle and no further Passport
--                        checkout is offered from this state
--   'not_confirmed'  -> the caller owns an eligible Event, but its Passport
--                        is not preserved and was never refunded (no
--                        Passport row, or payment_pending)
-- A foreign, non-owned, or ineligible Event id -- or an uncertain identity
-- link -- RAISEs the SAME non-enumerating 'Event not found.' every other
-- command in this family already uses.
RETURNS TABLE(
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_appointment_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Reading a Passport confirmation status requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Reading a Passport confirmation status requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'An event is required.';
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT oa.id
    INTO v_appointment_id
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  WHERE d.event_id = p_event_id
    AND oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_actor)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  IF public.is_self_service_event_passport_preserved(p_event_id) THEN
    RETURN QUERY SELECT 'confirmed'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.self_service_event_passports AS p
    WHERE p.event_id = p_event_id AND p.state = 'refunded'
  ) THEN
    RETURN QUERY SELECT 'refunded'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'not_confirmed'::text;
END;
$function$;

ALTER FUNCTION public.get_my_self_service_event_passport_confirmation(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_self_service_event_passport_confirmation(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_self_service_event_passport_confirmation(uuid)
  TO authenticated;

COMMIT;
