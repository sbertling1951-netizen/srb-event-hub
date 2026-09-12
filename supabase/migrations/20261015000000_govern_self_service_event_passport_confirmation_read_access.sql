-- Stripe Passport Checkout Integration -- confirmed-state read access for the
-- organizer's own checkout-status display
-- (docs/architecture/EPICENTRAX_STRIPE_PASSPORT_CHECKOUT_IMPLEMENTATION_SPECIFICATION.md).
--
-- Root cause this migration addresses: the browser's checkout-status poll
-- (GET /api/passport/checkout) calls get_my_self_service_event_passport_checkout_attempt
-- (live since 20261014000000), whose OWN documented contract returns the
-- caller-safe 'no_open_attempt' outcome once an attempt leaves preparing/open
-- -- including the moment it is CONFIRMED. That collapse is completely
-- correct for that reader's one job (report whether an OPEN attempt exists),
-- but it means the browser currently cannot distinguish "never started a
-- checkout" from "already paid; Passport confirmed" -- both read back
-- identically today. This migration adds exactly the one additional signal
-- needed to tell them apart. It does not modify, restate, or broaden
-- get_my_self_service_event_passport_checkout_attempt or any other existing
-- reader/writer in this family -- every one of them is byte-for-byte
-- untouched, including its exact grants.
--
-- Adds exactly:
--
--   * get_my_self_service_event_passport_confirmation(p_event_id uuid) --
--     authenticated, owner-scoped. Resolves the caller through the
--     IDENTICAL identity/ownership rules as
--     get_my_self_service_event_passport_checkout_attempt (same
--     resolve_auth_person_link usage; same appointment/draft/tenant join
--     shape; same non-enumerating 'Event not found.' for any other link
--     status or a foreign/ineligible Event) -- deliberately NOT the
--     passport-preserved-excluding predicate prepare/delete use, for the
--     exact same reason that reader isn't either: a reserved/preserved
--     Event must still read safely here. Returns exactly one column,
--     outcome text, one of:
--       'confirmed'      -> public.is_self_service_event_passport_preserved
--                            (reserved/active/expired; live since
--                            20261012000000) is true for this Event --
--                            payment is confirmed and the Event is
--                            preserved
--       'not_confirmed'  -> the caller owns an eligible Event, but its
--                            Passport is not (yet) preserved -- no Passport
--                            row at all, or one still payment_pending
--     Never touches self_service_event_passports directly and never returns
--     a Passport row, timestamp, provider id, receipt fact, or any other
--     Event/Person data -- it reuses the SAME internal preservation
--     predicate every capacity/Delete/Replace path already calls, exactly
--     the established nested-SECURITY-DEFINER pattern (predicate itself
--     carries no EXECUTE grant to any role; called only from other
--     postgres-owned SECURITY DEFINER functions, already an established
--     cross-migration pattern -- see 20261013000000's prepare_* call).
--     REVOKE ALL then GRANT EXECUTE to authenticated only -- never PUBLIC,
--     anon, or service_role.
--
-- What this migration does NOT do: creates no table, no table grant, no RLS
-- policy, no seed row, no restatement of any existing reader or writer
-- (get_my_self_service_event_passport_checkout_attempt,
-- get_self_service_event_passport_checkout_attempt_for_server,
-- prepare_self_service_event_passport_checkout_attempt,
-- bind_self_service_event_passport_checkout_session,
-- record_self_service_event_passport_checkout_terminal_state,
-- confirm_self_service_event_passport_payment,
-- delete_self_service_organizer_event, replace_self_service_organizer_event
-- are all completely unchanged), no mutation of attempt/Passport/receipt
-- state, no Stripe SDK, API call, webhook route, secret, or checkout-session
-- creation of any kind.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_self_service_event_passport_confirmation(
  p_event_id uuid
)
-- The sole column is the discriminator:
--   'confirmed'      -> this Event's Passport is preserved (reserved/
--                        active/expired) -- payment confirmed
--   'not_confirmed'  -> the caller owns an eligible Event, but its Passport
--                        is not preserved (no Passport row, or
--                        payment_pending)
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
