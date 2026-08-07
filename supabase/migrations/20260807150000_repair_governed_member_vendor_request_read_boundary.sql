-- Governed read boundary repair for member Vendor Requests.
--
-- 20260807120000_create_governed_member_vendor_request_read.sql's
-- get_my_vendor_service_requests returns a bare zero-row result both when
-- resolve_temporary_or_authenticated_attendee(...) cannot verify the
-- caller for this Event, and when a verified attendee genuinely has zero
-- matching vendor requests. app/api/member/vendor-requests/route.ts (GET)
-- then wraps either case identically as 200 { data: [] }, so a resolver
-- failure is indistinguishable from a confirmed-empty result once it
-- reaches the Provider or any other consumer.
--
-- This collapses two materially different states into one successful
-- response, which the accepted Domain Model's Fundamental Principles
-- ("fail closed rather than fabricate or over-assert Identity...
-- determination") and Insufficient Evidence ("insufficient evidence is not
-- evidence of nonexistence") both prohibit: an unresolvable session must
-- never be silently represented as a governed-confirmed zero.
--
-- Fix: mirror the already-proven shape of
-- 20260807140000_create_governed_member_assignment_read.sql's
-- get_my_active_assignments exactly -- an explicit `status` column, with a
-- sentinel `resolved` row (id NULL) standing in for a governed-confirmed
-- zero, so that a genuine resolver failure (zero rows, no sentinel) is
-- structurally distinguishable from a confirmed-zero result (one sentinel
-- row) at the wrapping route.
--
-- No `identity_unavailable` state is added here. Unlike assignments (which
-- resolves attendees.person_id as a second step, sparsely populated for
-- COPILOT/HOUSEHOLD_MEMBER roles per
-- EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md), vendor
-- requests are owned directly by attendee_id -- the exact identity
-- resolve_temporary_or_authenticated_attendee itself already verifies.
-- There is no second, separately-nullable identity fact here for a
-- distinct "verified session, unresolved identity" state to describe;
-- inventing one would be exactly the kind of casually-added status this
-- repair must avoid.
--
-- No ownership, ordering, or field selection changes: this migration only
-- adds the status discriminator and the confirmed-zero sentinel row on top
-- of the existing, unchanged query and its existing WHERE/ORDER BY. Grants
-- (anon, authenticated), SECURITY DEFINER posture, and every other RPC in
-- this boundary (submit_my_vendor_service_request,
-- set_my_vendor_service_request_status) are untouched.
--
-- CREATE OR REPLACE cannot be used here: PostgreSQL rejects an attempt to
-- change a function's RETURNS TABLE / OUT-parameter row type in place
-- (42P13, "cannot change return type of existing function... Row type
-- defined by OUT parameters is different"), and this repair adds a new
-- leading `status` column, which is exactly that kind of change. The
-- existing 20260807120000 function --
-- public.get_my_vendor_service_requests(uuid, text, text), identified by
-- its input argument types only (PostgreSQL function identity, unlike
-- overload resolution, ignores argument names/defaults and the return
-- type) -- must therefore be dropped and recreated. No object anywhere in
-- this repository's migration history calls, references, or otherwise
-- depends on this function; it is invoked only from application code
-- (app/api/member/vendor-requests/route.ts), outside the database. A
-- plain DROP, without CASCADE, is therefore expected to succeed and is
-- used deliberately: CASCADE is never appropriate here, since it would
-- silently drop any dependent this inspection missed rather than failing
-- closed and surfacing it.
DROP FUNCTION public.get_my_vendor_service_requests(uuid, text, text);

CREATE FUNCTION public.get_my_vendor_service_requests(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  status text,
  id uuid,
  vendor_business_name text,
  requested_service text,
  guest_count integer,
  request_notes text,
  request_status text,
  created_at timestamptz,
  site_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_verified_attendee_id uuid;
  v_request_count integer;
BEGIN
  -- Fail closed on ambiguous, absent, expired, or invalid registration
  -- evidence: the shared resolver returns NULL for every one of those
  -- conditions, for both the authenticated and the temporary/event-code
  -- branch. Returning no rows at all here -- never a sentinel, never a
  -- confirmed-zero row -- is what lets the wrapping route distinguish this
  -- outcome (mapped to invalid_session) from a genuine confirmed zero
  -- below, exactly as get_my_active_assignments already establishes for
  -- the identical resolver-NULL case.
  v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_verified_attendee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_request_count
  FROM public.vendor_service_requests AS vsr
  WHERE vsr.attendee_id = v_verified_attendee_id
    AND vsr.event_id = p_event_id;

  IF v_request_count = 0 THEN
    -- A verified attendee with zero matching vendor requests is a
    -- governed-confirmed zero, not the same outcome as an unresolvable
    -- session. Without this sentinel row, a bare zero-row result here
    -- would be indistinguishable from the resolver-NULL branch above.
    RETURN QUERY
    SELECT
      'resolved'::text,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::integer,
      NULL::text,
      NULL::text,
      NULL::timestamptz,
      NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'resolved'::text AS status,
    vsr.id,
    v.business_name,
    vsr.requested_service,
    vsr.guest_count,
    vsr.request_notes,
    vsr.request_status,
    vsr.created_at,
    vsr.site_number
  FROM public.vendor_service_requests AS vsr
  LEFT JOIN public.vendors AS v
    ON v.id = vsr.vendor_id
  WHERE vsr.attendee_id = v_verified_attendee_id
    -- Reject mismatched event context explicitly, in addition to the
    -- resolver's own event-scoped verification, mirroring
    -- get_my_attendee_record's final defensive event_id check.
    AND vsr.event_id = p_event_id
  ORDER BY vsr.created_at DESC;
END;
$function$;

ALTER FUNCTION public.get_my_vendor_service_requests(uuid, text, text)
  OWNER TO postgres;

-- Never grant direct SELECT on vendor_service_requests to anon or
-- authenticated -- this function remains the only new read pathway, it is
-- SECURITY DEFINER (runs as table owner), and it returns only the minimum
-- fields the member page currently renders, unchanged from
-- 20260807120000.
REVOKE ALL ON FUNCTION public.get_my_vendor_service_requests(uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_vendor_service_requests(uuid, text, text)
TO anon, authenticated;
