-- Vendor Requests Stage 1 -- Governed Member Request Boundary.
--
-- Replaces direct browser INSERT/UPDATE of public.vendor_service_requests
-- from the two member-facing pages (app/member/vendor-signup/page.tsx,
-- app/member/my-requests/page.tsx) with two narrow, governed, SECURITY
-- DEFINER RPCs reached only through a trusted server boundary
-- (app/api/member/vendor-requests/route.ts), following the exact pattern
-- already accepted and proven for member check-in (WR-02 Stage 2,
-- 20260804130000_require_tenant_verification_in_member_checkin.sql):
--
--   browser -> Next.js server boundary -> Tenant Resolver
--     -> authenticated token-bound Supabase client -> SECURITY DEFINER RPC
--     -> independent database verification.
--
-- Vendor-side response, Assignment enforcement, admin request-management,
-- and the read path are unchanged and out of scope. This migration closes
-- mutation exposure and narrows authenticated read access to the governed
-- owner or an active admin, while preserving the existing member/admin
-- application workflows.

-- ---------------------------------------------------------------------------
-- 1. Governed Person ownership on vendor_service_requests.
--
--    person_id is the new canonical owner reference: nullable, so existing
--    historical rows are preserved unchanged rather than fabricated. Every
--    request created through the new RPC below always has person_id set,
--    derived from auth.uid() via the existing governed resolver -- never
--    from a browser-supplied attendee id.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vendor_service_requests
  ADD COLUMN person_id uuid REFERENCES public.people(id);

CREATE INDEX vendor_service_requests_person_id_idx
  ON public.vendor_service_requests (person_id);

-- Conservative historical backfill: only where the request's own existing
-- attendee_id already resolves, through the attendee/person bridge already
-- established by this project's identity-resolution history, to exactly one
-- Person. This is a direct single-FK lookup, not a multi-source evidence
-- pairing -- there is no ambiguity to resolve, only a value to copy from an
-- already-governed fact. A request whose attendee_id is null, or whose
-- attendee has no resolved person_id, is left with person_id NULL: it
-- remains a fully intact, unmodified historical record, visible to admin
-- exactly as before, simply not yet self-service-cancellable by the member
-- until a separately governed reconciliation resolves it. No row's
-- requester-entered fields (name/email/phone/notes/etc.) are touched.
DO $backfill$
DECLARE
  v_matched_count bigint;
  v_unresolved_count bigint;
BEGIN
  UPDATE public.vendor_service_requests AS vsr
  SET person_id = a.person_id
  FROM public.attendees AS a
  WHERE a.id = vsr.attendee_id
    AND vsr.person_id IS NULL
    AND a.person_id IS NOT NULL;

  GET DIAGNOSTICS v_matched_count = ROW_COUNT;

  SELECT count(*)
    INTO v_unresolved_count
  FROM public.vendor_service_requests AS vsr
  WHERE vsr.person_id IS NULL;

  RAISE NOTICE
    'Vendor Service Request Person backfill: % row(s) backfilled from an already-resolved attendee_id; % row(s) remain unresolved (no attendee_id, or attendee not yet Person-linked) and are left intact for later review.',
    v_matched_count,
    v_unresolved_count;
END;
$backfill$;

-- ---------------------------------------------------------------------------
-- 2. public.vendor_service_request_audit
--
--    Append-only, mirroring the shape and posture already established by
--    public.member_checkin_audit
--    (20260801120700_add_member_checkin_provenance.sql): who acted, which
--    governed Person, which Account, what changed, and when. RLS enabled
--    with zero policies and no direct grants -- written only by the two
--    RPCs below, which execute as their owner and therefore reach it
--    without needing any broadened grant.
-- ---------------------------------------------------------------------------

CREATE TABLE public.vendor_service_request_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.vendor_service_requests(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  action text NOT NULL
    CHECK (action IN ('created', 'cancelled', 'restored')),
  previous_status text,
  new_status text NOT NULL,
  actor_person_id uuid NOT NULL REFERENCES public.people(id),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_service_request_audit_request_id_idx
  ON public.vendor_service_request_audit (request_id, created_at DESC);

ALTER TABLE public.vendor_service_request_audit OWNER TO postgres;

ALTER TABLE public.vendor_service_request_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vendor_service_request_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.vendor_service_request_audit FROM anon;
REVOKE ALL ON TABLE public.vendor_service_request_audit FROM authenticated;
REVOKE ALL ON TABLE public.vendor_service_request_audit FROM service_role;

-- ---------------------------------------------------------------------------
-- 3. Close direct member mutation on vendor_service_requests.
--
--    anon has no legitimate business with this table at all -- revoked
--    outright. authenticated is left with whatever base grant it already
--    has (needed for the admin workflow below), because Postgres grants
--    are role-wide and admin sessions authenticate as the same
--    `authenticated` role as ordinary members; the real admin/member
--    distinction is enforced by RLS, not by revoking the shared role's
--    base grant.
--
--    RLS is enabled with exactly two policies:
--      - an admin-scoped ALL policy, identical in shape to the
--        is_active_admin(auth.uid()) policies already governing every
--        other vendor table (e.g. event_vendors_admin_write_policy),
--        preserving the existing admin Vendor Requests workflow
--        (app/admin/vendor-requests/page.tsx) completely unchanged.
--      - an authenticated-only SELECT policy that preserves exactly
--        today's read exposure (no RLS previously existed, so nothing is
--        narrowed) while explicitly excluding anon -- read-path
--        consolidation is deferred, per the governing task's own
--        allowance, not attempted here.
--    No INSERT, UPDATE, or DELETE policy is granted to ordinary members:
--    their only mutation path is now the two SECURITY DEFINER RPCs below,
--    which run as the table owner and are unaffected by RLS.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.vendor_service_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.vendor_service_requests FROM anon;

ALTER TABLE public.vendor_service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_service_requests_admin_all_policy ON public.vendor_service_requests;
CREATE POLICY vendor_service_requests_admin_all_policy
  ON public.vendor_service_requests
  FOR ALL
  TO authenticated
  USING (public.is_active_admin(auth.uid()))
  WITH CHECK (public.is_active_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3a. public.is_my_vendor_service_request
--
--    A narrow, single-purpose ownership check dedicated to RLS use. RLS
--    policy USING clauses are evaluated as the querying role, so that role
--    needs EXECUTE on every function the clause references -- and
--    resolve_auth_person_link is deliberately not executable by
--    authenticated (20260801120800_create_shared_auth_person_link_resolver.sql).
--    This helper is the narrow, governed substitute: it is itself
--    SECURITY DEFINER, calls the protected resolver internally as its
--    owner (postgres) exactly as submit_my_vendor_service_request and
--    set_my_vendor_service_request_status already do, and exposes nothing
--    beyond a single boolean -- never the resolved Person id, never the
--    resolver's status, never any other request field. The protected
--    resolver itself remains exactly as locked down as before; only this
--    single-purpose helper becomes callable by authenticated.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.is_my_vendor_service_request(
  p_request_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_person_id uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL OR p_request_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT link.person_id
    INTO v_person_id
  FROM public.resolve_auth_person_link(v_uid) AS link
  WHERE link.status = 'resolved';

  IF v_person_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.vendor_service_requests AS vsr
    WHERE vsr.id = p_request_id
      AND vsr.person_id = v_person_id
  );
END;
$$;

ALTER FUNCTION public.is_my_vendor_service_request(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_my_vendor_service_request(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_my_vendor_service_request(uuid)
FROM anon;
REVOKE ALL ON FUNCTION public.is_my_vendor_service_request(uuid)
FROM service_role;

GRANT EXECUTE ON FUNCTION public.is_my_vendor_service_request(uuid)
TO authenticated;

DROP POLICY IF EXISTS vendor_service_requests_authenticated_select_policy ON public.vendor_service_requests;
CREATE POLICY vendor_service_requests_authenticated_select_policy
  ON public.vendor_service_requests
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR public.is_my_vendor_service_request(vendor_service_requests.id)
  );

-- ---------------------------------------------------------------------------
-- 4. public.submit_my_vendor_service_request
--
--    The browser supplies only operational selections (Event, Vendor
--    Organization, optional catalog service, and free-text request
--    detail/contact/site fields the member is already permitted to edit).
--    It never supplies a Person id, Tenant id, or attendee/ownership claim
--    -- every governed fact is independently derived or revalidated here:
--
--      1. auth.uid() must be present.
--      2. It must resolve, through the existing governed
--         resolve_auth_person_link primitive, to exactly one Person.
--      3. That Person must have a legitimate, currently eligible attendee
--         record for the selected Event (the same eligibility shape
--         already governed by submit_member_checkin's authenticated
--         branch) -- this is this codebase's existing Participation
--         evidence for a Person at an Event; no new Participation model is
--         introduced here.
--      4. The selected Event must belong to the server-resolved Tenant
--         (p_tenant_id, supplied only by the trusted route, never the
--         browser) -- re-verified here exactly as
--         submit_member_checkin already re-verifies it, never merely
--         accepted as a caller claim.
--      5. The selected Vendor Organization must participate in that Event
--         through event_vendors.
--      6. If a catalog service id is supplied, it must belong to that same
--         Vendor Organization.
--
--    coach_info is derived server-side from the resolved attendee's own
--    coach fields rather than trusted from the browser, since the
--    attendee record is already independently resolved at this point.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.submit_my_vendor_service_request(
  p_tenant_id uuid,
  p_event_id uuid,
  p_vendor_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_requested_service text DEFAULT NULL,
  p_request_notes text DEFAULT NULL,
  p_guest_count integer DEFAULT NULL,
  p_site_number text DEFAULT NULL,
  p_preferred_response_method text DEFAULT NULL,
  p_requester_name text DEFAULT NULL,
  p_requester_email text DEFAULT NULL,
  p_requester_phone text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  event_id uuid,
  vendor_id uuid,
  request_status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_attendee_id uuid;
  v_coach_info text;
  v_new_id uuid;
  v_new_event_id uuid;
  v_new_vendor_id uuid;
  v_new_status text;
  v_new_created_at timestamptz;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL
    OR p_tenant_id IS NULL
    OR p_event_id IS NULL
    OR p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  SELECT link.person_id
    INTO v_person_id
  FROM public.resolve_auth_person_link(v_uid) AS link
  WHERE link.status = 'resolved';

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS e
    WHERE e.id = p_event_id
      AND e.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  SELECT a.id,
    array_to_string(ARRAY[
      a.coach_manufacturer,
      a.coach_model,
      CASE
        WHEN nullif(btrim(coalesce(a.coach_length, '')), '') IS NOT NULL
        THEN btrim(a.coach_length) || ' ft'
      END
    ], ' ')
    INTO v_attendee_id, v_coach_info
  FROM public.attendees AS a
  JOIN public.events AS e
    ON e.id = a.event_id
  WHERE a.person_id = v_person_id
    AND a.event_id = p_event_id
    AND coalesce(a.is_active, true) = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;

  IF v_attendee_id IS NULL THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_vendors AS ev
    WHERE ev.vendor_id = p_vendor_id
      AND ev.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  IF p_service_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.vendor_services AS vs
      WHERE vs.id = p_service_id
        AND vs.vendor_id = p_vendor_id
    ) THEN
      RAISE EXCEPTION 'Vendor request submission verification failed.';
    END IF;
  END IF;

  INSERT INTO public.vendor_service_requests (
    event_id,
    vendor_id,
    service_id,
    attendee_id,
    person_id,
    requester_name,
    requester_email,
    requester_phone,
    site_number,
    coach_info,
    requested_service,
    request_notes,
    preferred_response_method,
    request_status,
    guest_count
  )
  VALUES (
    p_event_id,
    p_vendor_id,
    p_service_id,
    v_attendee_id,
    v_person_id,
    nullif(btrim(coalesce(p_requester_name, '')), ''),
    nullif(btrim(coalesce(p_requester_email, '')), ''),
    nullif(btrim(coalesce(p_requester_phone, '')), ''),
    nullif(btrim(coalesce(p_site_number, '')), ''),
    nullif(btrim(coalesce(v_coach_info, '')), ''),
    nullif(btrim(coalesce(p_requested_service, '')), ''),
    nullif(btrim(coalesce(p_request_notes, '')), ''),
    coalesce(nullif(btrim(coalesce(p_preferred_response_method, '')), ''), 'email'),
    'new',
    greatest(coalesce(p_guest_count, 1), 1)
  )
  RETURNING
    vendor_service_requests.id,
    vendor_service_requests.event_id,
    vendor_service_requests.vendor_id,
    vendor_service_requests.request_status,
    vendor_service_requests.created_at
  INTO
    v_new_id,
    v_new_event_id,
    v_new_vendor_id,
    v_new_status,
    v_new_created_at;

  INSERT INTO public.vendor_service_request_audit (
    request_id,
    event_id,
    vendor_id,
    action,
    previous_status,
    new_status,
    actor_person_id,
    actor_auth_user_id
  )
  VALUES (
    v_new_id,
    v_new_event_id,
    v_new_vendor_id,
    'created',
    NULL,
    v_new_status,
    v_person_id,
    v_uid
  );

  RETURN QUERY
  SELECT v_new_id, v_new_event_id, v_new_vendor_id, v_new_status, v_new_created_at;
END;
$$;

ALTER FUNCTION public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text)
FROM anon;

GRANT EXECUTE ON FUNCTION public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.set_my_vendor_service_request_status
--
--    Cancellation and restoration. Ownership is independently re-verified
--    from governed facts (person_id = the resolved Person), never trusted
--    from a browser-supplied request id alone or filtered only in the
--    client. A request owned by another Person, or belonging to another
--    Tenant/Event by construction of the ownership check itself, is
--    indistinguishable from "not found" -- this function never reveals
--    whether a request id exists versus belongs to someone else. Historical
--    timestamps and prior state are preserved in
--    vendor_service_request_audit; the request row itself is only ever
--    updated in place, never deleted.
--
--    Transitions mirror exactly what the two member pages already do
--    today (cancel from new/contacted/confirmed; restore only from
--    cancelled) -- no new status vocabulary is introduced.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.set_my_vendor_service_request_status(
  p_tenant_id uuid,
  p_request_id uuid,
  p_next_status text
)
RETURNS TABLE(
  id uuid,
  request_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_current_status text;
  v_event_id uuid;
  v_vendor_id uuid;
  v_action text;
  v_updated_id uuid;
  v_updated_status text;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL
    OR p_tenant_id IS NULL
    OR p_request_id IS NULL
    OR p_next_status NOT IN ('cancelled', 'new') THEN
    RAISE EXCEPTION 'Vendor request status change verification failed.';
  END IF;

  SELECT link.person_id
    INTO v_person_id
  FROM public.resolve_auth_person_link(v_uid) AS link
  WHERE link.status = 'resolved';

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'Vendor request status change verification failed.';
  END IF;

  SELECT vsr.request_status, vsr.event_id, vsr.vendor_id
    INTO v_current_status, v_event_id, v_vendor_id
  FROM public.vendor_service_requests AS vsr
  WHERE vsr.id = p_request_id
    AND vsr.person_id = v_person_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor request status change verification failed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS e
    WHERE e.id = v_event_id
      AND e.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Vendor request status change verification failed.';
  END IF;

  IF p_next_status = 'cancelled' THEN
    IF coalesce(v_current_status, 'new') NOT IN ('new', 'contacted', 'confirmed') THEN
      RAISE EXCEPTION 'Vendor request status change verification failed.';
    END IF;
    v_action := 'cancelled';
  ELSE
    IF v_current_status <> 'cancelled' THEN
      RAISE EXCEPTION 'Vendor request status change verification failed.';
    END IF;
    v_action := 'restored';
  END IF;

  UPDATE public.vendor_service_requests AS vsr
  SET request_status = p_next_status
  WHERE vsr.id = p_request_id
    AND vsr.person_id = v_person_id
  RETURNING vsr.id, vsr.request_status
  INTO v_updated_id, v_updated_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor request status change verification failed.';
  END IF;

  INSERT INTO public.vendor_service_request_audit (
    request_id,
    event_id,
    vendor_id,
    action,
    previous_status,
    new_status,
    actor_person_id,
    actor_auth_user_id
  )
  VALUES (
    v_updated_id,
    v_event_id,
    v_vendor_id,
    v_action,
    v_current_status,
    v_updated_status,
    v_person_id,
    v_uid
  );

  RETURN QUERY
  SELECT v_updated_id, v_updated_status;
END;
$$;

ALTER FUNCTION public.set_my_vendor_service_request_status(uuid, uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_my_vendor_service_request_status(uuid, uuid, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_vendor_service_request_status(uuid, uuid, text)
FROM anon;

GRANT EXECUTE ON FUNCTION public.set_my_vendor_service_request_status(uuid, uuid, text)
TO authenticated;
