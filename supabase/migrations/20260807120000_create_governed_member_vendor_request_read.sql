-- Governed read repair for the member vendor-request boundary.
--
-- 20260804160000_create_governed_member_vendor_request_boundary.sql closed
-- direct browser mutation of public.vendor_service_requests and revoked all
-- table access from anon, but its own comment explicitly deferred the read
-- path: "the read path... [is] unchanged and out of scope." The client
-- (app/member/vendor-signup/page.tsx) still performs a direct
-- .from("vendor_service_requests").select(...) as the caller's own role.
--
-- That is safe for a genuinely authenticated member, but MemberRouteGuard
-- (components/auth/MemberRouteGuard.tsx) explicitly allows a member through
-- on a local, non-Supabase-Auth "legacy" event-code session
-- (mode === "member" && hasIdentity && hasEvent) before ever checking
-- supabase.auth.getSession(). That legacy path is a fully supported member
-- entry method, not an edge case -- and for it, the browser's Postgrest
-- client executes as anon, which now has zero grant on this table, so the
-- direct select fails with 42501 "permission denied for table
-- vendor_service_requests" every time. Confirmed live against the linked
-- project (both via a direct anon-role SQL simulation and a real
-- unauthenticated REST call).
--
-- Governing decision (per authorized task): a member who entered through
-- the supported event-code/registration-identifier path is authorized to
-- see the vendor-service requests belonging to that verified registration,
-- without requiring a Supabase Auth account. The proof must come through
-- the same governed member identity boundary already used by every other
-- read on this page -- not by reopening SELECT for anon, and not by
-- pretending auth.uid() exists for a caller who never authenticated.
--
-- This migration adds exactly one new governed read RPC. It reuses
-- public.resolve_temporary_or_authenticated_attendee(...) -- the shared
-- verifier already introduced by
-- 20260803120000_close_unrestricted_anon_attendee_select.sql and already
-- used by get_my_attendee_record, get_my_household_members,
-- get_event_attendee_locator, and get_event_locator_household_members
-- (the last three of which, notably, already grant EXECUTE to anon for
-- exactly this same class of read). No new identity-verification logic is
-- introduced; this function only adds the vendor-request-specific
-- ownership predicate and result shape on top of that shared verifier.
--
-- Nothing here alters 20260804160000's or 20260804170000's grants,
-- policies, or RPCs. Admin access (vendor_service_requests_admin_all_policy)
-- and the existing authenticated-only submit/cancel RPCs
-- (submit_my_vendor_service_request, set_my_vendor_service_request_status)
-- are untouched.

CREATE OR REPLACE FUNCTION public.get_my_vendor_service_requests(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
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
BEGIN
  -- Fail closed on ambiguous, absent, expired (session-level, enforced by
  -- Supabase Auth before auth.uid() is ever set), or invalid registration
  -- evidence: the shared resolver returns NULL for every one of those
  -- conditions, for both the authenticated and the temporary/event-code
  -- branch, exactly as it already does for get_my_attendee_record.
  v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_verified_attendee_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
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
-- authenticated -- this function is the only new read pathway, it is
-- SECURITY DEFINER (runs as table owner), and it returns only the minimum
-- fields the member page currently renders.
REVOKE ALL ON FUNCTION public.get_my_vendor_service_requests(uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_vendor_service_requests(uuid, text, text)
TO anon, authenticated;
