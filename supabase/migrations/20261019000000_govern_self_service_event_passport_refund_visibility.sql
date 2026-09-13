-- Passport Super-Admin Refund Control -- reserved-only UI visibility signal.
--
-- Root cause this migration addresses: OrganizerPassportCard's Refund
-- control was gated by the browser's own existing 'confirmed' checkout
-- status, which -- by is_self_service_event_passport_preserved's own
-- documented design (20261012000000) -- deliberately collapses
-- 'reserved'/'active'/'expired' into the SAME single signal. The governed
-- preparation command (prepare_self_service_event_passport_refund_request,
-- 20261017000000) accepts only 'reserved'; showing the control for
-- active/expired Passports too was a UI-visibility gap, not a security gap
-- (the preparation command itself already fails closed to 'Event not
-- found.' for both) -- this migration closes that gap with the smallest
-- possible additional signal.
--
-- Adds exactly one function:
--
--   * get_my_self_service_event_passport_refund_eligibility(p_event_id
--     uuid) -- authenticated, owner-scoped. A pure UI-visibility hint: it
--     prepares nothing, executes nothing, writes nothing, and is never
--     itself an authority check -- prepare_self_service_event_passport_
--     refund_request and assert_self_service_event_passport_refund_
--     request_authority remain the SOLE authority boundaries for actually
--     requesting or executing a refund, unchanged and uncalled from here.
--
--     Resolves caller ownership through the IDENTICAL identity/ownership
--     rules as get_my_self_service_event_passport_confirmation
--     (20261015000000) -- same resolve_auth_person_link usage, same
--     appointment/draft/tenant join shape, same non-enumerating 'Event not
--     found.' for any other link status or a foreign/ineligible Event.
--     Returns exactly one column, eligible boolean:
--       true  -> the caller holds Platform Administrator authority (via
--                the existing has_platform_admin_authority primitive) AND
--                this Event's Passport state is EXACTLY 'reserved'
--       false -> every other case: an ordinary (non-super-admin) caller
--                -- including the Event's own organizer-owner -- OR a
--                Passport that is payment_pending, active, expired,
--                refunded, or missing entirely
--     Never returns the Passport state itself, a receipt fact, a provider
--     id, or any other Event/Person data -- one boolean, nothing else. A
--     foreign/non-owned/malformed Event id still fails closed to the SAME
--     'Event not found.' every other reader in this family raises -- this
--     command creates no new private-Event discovery path.
--
--     REVOKE ALL then GRANT EXECUTE to authenticated only -- never PUBLIC,
--     anon, or service_role, exactly mirroring
--     get_my_self_service_event_passport_confirmation's own grant.
--
-- What this migration does NOT do: creates no table, no table grant, no RLS
-- policy, no seed row; does not modify, restate, or broaden
-- get_my_self_service_event_passport_confirmation,
-- get_my_self_service_event_passport_checkout_attempt,
-- prepare_self_service_event_passport_refund_request,
-- assert_self_service_event_passport_refund_request_authority,
-- confirm_self_service_event_passport_refund, or any other existing
-- reader/writer in this family -- every one of them is byte-for-byte
-- untouched, including its exact grants; no mutation of attempt/Passport/
-- receipt/refund-request state anywhere in this function; no Stripe SDK,
-- API call, webhook route, or secret of any kind.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_self_service_event_passport_refund_eligibility(
  p_event_id uuid
)
-- The sole column is a strict boolean capability hint for the Refund
-- control's visibility -- never itself an authorization decision. true only
-- when the caller holds Platform Administrator authority AND this Event's
-- Passport is exactly 'reserved'. Every other combination -- including a
-- non-admin caller, or a foreign/ineligible Event id -- fails closed to
-- false (or, for identity/ownership failures, the same non-enumerating
-- 'Event not found.' this family already raises).
RETURNS TABLE(
  eligible boolean
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
  v_passport_state text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Reading Passport refund eligibility requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Reading Passport refund eligibility requires a verified account email.';
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

  IF NOT public.has_platform_admin_authority(v_actor) THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  SELECT p.state
    INTO v_passport_state
  FROM public.self_service_event_passports AS p
  WHERE p.event_id = p_event_id;

  -- coalesce guards the "no Passport row at all" case, where
  -- v_passport_state is NULL and a bare equality would otherwise yield
  -- NULL rather than a strict false.
  RETURN QUERY SELECT coalesce(v_passport_state = 'reserved', false);
END;
$function$;

ALTER FUNCTION public.get_my_self_service_event_passport_refund_eligibility(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_self_service_event_passport_refund_eligibility(uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_self_service_event_passport_refund_eligibility(uuid)
  TO authenticated;

COMMIT;
