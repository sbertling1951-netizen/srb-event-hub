-- resolve_attendee_visible_vendor_notices -- governed attendee-facing
-- Vendor "Notice" read boundary for Temporary Event Access.
--
-- Temporary Event Access attendee-facing Vendor path reconciliation
-- (follow-up to Nearby d36ad11, Locations 5fc355e, /map dc72034).
--
-- SCOPE DISCOVERY: repo-wide search for vendor_event_status/event_vendors/
-- vendors/vendor-related Supabase calls in member/attendee-facing code
-- found exactly two Temporary-Event-Access-reachable consumers reading
-- public.vendor_event_status directly via the anon Supabase client:
-- app/member/vendor-signup/page.tsx (MemberRouteGuard-wrapped) and
-- app/member/page.tsx (the member dashboard's vendor carousel, reads the
-- same local memberEvent context Temporary Event Access sets). A third
-- consumer, app/member/my-requests/page.tsx, renders vendor-request items
-- entirely through the already-governed GET /api/member/vendor-requests ->
-- public.get_my_vendor_service_requests path and touches no vendor table
-- directly -- not affected by, and not part of, this defect.
--
-- ROOT CAUSE: both consumers call
-- .from("vendor_event_status").select("vendor_id,status_type,message,
-- expires_at,is_active") directly. anon's raw grant on this table is
-- REFERENCES,TRIGGER only (confirmed live via information_schema.role_
-- table_grants) -- correctly and deliberately hardened by the recent
-- vendor-governance work (vendor_event_status authority reconciled to
-- event.vendors.manage); RLS is irrelevant here since the anon role has no
-- table-level SELECT grant to even reach policy evaluation. The read
-- fails (42501 permission denied for table vendor_event_status) for
-- Temporary Event Access. Both consumers already catch this error and
-- degrade gracefully (an empty notice map, not a page failure) -- so this
-- is not a hard breakage, but it is a genuine, confirmed attendee-facing
-- feature gap: the per-vendor "Notice" (available today / show special /
-- closed / etc., see lib/vendorNotice.ts) never displays for Temporary
-- Event Access, which the rest of this audit treats as the common
-- attendee path.
--
-- CLASSIFICATION: public.vendor_event_status carries exactly four
-- attendee-facing columns beyond its identity/audit columns --
-- status_type, message, expires_at, is_active -- confirmed via
-- information_schema.columns; it holds NO candidacy/admission governance
-- state, no rejection/revocation reason, no risk/intelligence signal, and
-- no organization/contact-access data (those live on event_vendors --
-- admission_state/admitted_by_*/admission_authority_basis/current_
-- disposition_id -- and on vendor_contacts/vendor_org_access, neither
-- touched by this migration or by either attendee-facing consumer). This
-- is squarely "attendee-visible admitted vendor information," the
-- category this migration is authorized to serve.
--
-- WHY A NEW RPC AND NOT A GRANT RESTORATION: restoring anon SELECT on
-- vendor_event_status would also restore raw access to
-- updated_by_auth_user_id and every future column added to this
-- governance-adjacent table, and would bypass the Event-visibility
-- re-validation this migration adds (a bare table grant only offers the
-- existing RLS predicate, which does not independently confirm the
-- Event itself -- as opposed to the event_vendors join row -- is still
-- visible_to_members/active). A new, narrowly-scoped, postgres-owned
-- SECURITY DEFINER function is the smaller, more precise correction, and
-- matches the exact governed-RPC pattern already established for Nearby
-- (resolve_effective_nearby_places) and Locations
-- (resolve_effective_event_locations): re-derive the same admission
-- predicate get_event_continuity_context already uses, then return only
-- the minimum attendee-safe fields, scoped to vendors already visible for
-- that specific Event via the same is_visible_to_members/is_active
-- criteria the working vendor-listing read (event_vendors -> vendors,
-- already anon-readable and left untouched by this migration) already
-- requires -- never trusting p_event_id alone, never returning governance
-- columns, never touching an unrelated Event's rows.
--
-- vendor_service_requests (the caller's own request/status information)
-- is out of scope for this migration: get_my_vendor_service_requests,
-- submit_my_vendor_service_request, and set_my_vendor_service_request_status
-- were all found live already anon+authenticated EXECUTE-granted and
-- already re-derive caller identity through
-- resolve_temporary_or_authenticated_attendee (never a client-supplied
-- attendee id) -- no defect, no change needed or made there.
--
-- SEPARATE FINDING, NOT REMEDIATED HERE (reported only): anon's existing,
-- already-working SELECT grant on public.vendors and public.event_vendors
-- (required for the attendee-visible listing both consumers already use
-- successfully) is not column-restricted -- information_schema.column_
-- privileges confirms anon holds SELECT on all 14 vendors columns and all
-- 22 event_vendors columns, including event_vendors.admission_state,
-- .admitted_by_admin_user_id, .admitted_by_auth_user_id, .admission_
-- authority_basis, .current_disposition_id, .application_id, .notes, and
-- vendors.notes/.contact_name. Both consumers' own client-side .select()
-- column lists already avoid requesting these fields, and RLS still
-- correctly restricts which ROWS are reachable (is_active/is_visible_to_
-- members), but a caller querying the REST endpoint directly with an
-- explicit column list could still retrieve these governance-adjacent
-- columns for any row RLS already permits. This is a pre-existing,
-- independently-discovered column-level exposure, not something this
-- migration introduces, and fixing it is not mechanically required to
-- reconcile the Temporary Event Access Notice defect above -- it is
-- reported here as a distinct, separately actionable grant-hygiene
-- finding per instruction, not remediated in this workstream.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_attendee_visible_vendor_notices(p_event_id uuid)
RETURNS TABLE(
  vendor_id uuid,
  status_type text,
  message text,
  expires_at timestamptz,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  -- Same admission predicate as get_event_continuity_context and the
  -- other Temporary Event Access reconciliations -- never trusts
  -- p_event_id alone.
  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true
      AND lower(trim(coalesce(e.status, ''))) NOT IN (
        'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ves.vendor_id, ves.status_type, ves.message, ves.expires_at, ves.is_active
  FROM public.vendor_event_status AS ves
  JOIN public.event_vendors AS ev
    ON ev.event_id = ves.event_id AND ev.vendor_id = ves.vendor_id
  JOIN public.vendors AS v ON v.id = ves.vendor_id
  WHERE ves.event_id = p_event_id
    AND ev.is_visible_to_members IS NOT FALSE
    AND v.is_active = true;
END;
$function$;

ALTER FUNCTION public.resolve_attendee_visible_vendor_notices(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_attendee_visible_vendor_notices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_attendee_visible_vendor_notices(uuid) TO anon, authenticated;

COMMIT;
