-- Governed write repair, continuing 20260807120000's read repair.
--
-- Investigation before this migration was written:
--
--   1. submit_my_vendor_service_request(p_tenant_id, p_event_id, p_vendor_id,
--      ...) did NOT accept an event code or registration identifier. It
--      unconditionally required auth.uid() IS NOT NULL and resolved
--      ownership through resolve_auth_person_link(auth.uid()) ->
--      attendees.person_id. There was no path for a verified event-code
--      member at all.
--   2. set_my_vendor_service_request_status(p_tenant_id, p_request_id,
--      p_next_status) had the identical shape: auth.uid()-only, ownership
--      proven through resolve_auth_person_link(...) -> person_id.
--   3. Both RPCs therefore depended exclusively on auth.uid(). Neither is
--      reachable by a member who entered through the supported event-code
--      path and never established a Supabase Auth session.
--   4. The API route was not the only layer at fault: even if the route
--      stopped requiring a bearer token, both RPCs would still
--      RAISE EXCEPTION the moment auth.uid() is NULL. The write boundary
--      itself had to change.
--   5. Cancellation ownership was proven by person_id (via
--      resolve_auth_person_link), not by the attendee_id + event_id pair
--      the new governed read (get_my_vendor_service_requests,
--      20260807120000) uses. This migration unifies both functions onto
--      the same resolver and the same attendee_id-based ownership already
--      established by the read.
--
-- Governing decision (per authorized task): a member verified through the
-- supported event-code/registration-identifier path may submit and cancel
-- their own vendor-service requests without a Supabase Auth account. Proof
-- must come from the same shared resolver already used by the read and by
-- get_my_attendee_record/get_my_household_members --
-- resolve_temporary_or_authenticated_attendee(...) -- never a parallel
-- verifier, never restored direct table access.
--
-- Person attribution (auth.uid() -> resolve_auth_person_link) is preserved
-- exactly as before for a genuinely authenticated caller; it becomes
-- optional rather than required. A verified event-code caller proceeds
-- with person_id left NULL -- unresolved Participation evidence, the same
-- posture already governed elsewhere in this project (e.g.
-- 20260805160000_align_admin_participant_addition_with_capacity.sql),
-- never fabricated identity.

-- ---------------------------------------------------------------------------
-- 1. vendor_service_request_audit: attendee-level attribution becomes the
--    baseline for every actor (always available, from the same resolver
--    used to authorize the action); Person/auth attribution remains
--    recorded whenever the caller is genuinely authenticated, but can no
--    longer be required, since a verified event-code caller has neither.
--    No read policy exists on this table (deny-all, written only by these
--    two SECURITY DEFINER functions), and no application code reads it, so
--    relaxing these two columns changes nothing for any existing reader.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vendor_service_request_audit
  ADD COLUMN actor_attendee_id uuid REFERENCES public.attendees(id);

ALTER TABLE public.vendor_service_request_audit
  ALTER COLUMN actor_person_id DROP NOT NULL;

ALTER TABLE public.vendor_service_request_audit
  ALTER COLUMN actor_auth_user_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. submit_my_vendor_service_request: adds two trailing, optional
--    parameters. Postgres identifies a function by its full argument-type
--    list, so this is a different signature -- the old one is explicitly
--    revoked and dropped (no CASCADE, confirming nothing else depends on
--    it) before the new one is created, exactly as
--    20260805160000_align_admin_participant_addition_with_capacity.sql
--    already established for this project.
-- ---------------------------------------------------------------------------

DO $drop_old_submit$
DECLARE
  v_old_signature regprocedure;
BEGIN
  v_old_signature := to_regprocedure(
    'public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text)'
  );

  IF v_old_signature IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM authenticated, PUBLIC',
      v_old_signature
    );
    EXECUTE format('DROP FUNCTION %s', v_old_signature);
    RAISE NOTICE 'Dropped old-signature public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text x8).';
  ELSE
    RAISE NOTICE 'Old-signature public.submit_my_vendor_service_request(...) not present; nothing to drop.';
  END IF;
END;
$drop_old_submit$;

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
  p_requester_phone text DEFAULT NULL,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
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
AS $function$
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
  IF p_tenant_id IS NULL
    OR p_event_id IS NULL
    OR p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  -- Fail closed on ambiguous, absent, or invalid registration evidence, for
  -- both the authenticated and the temporary/event-code branch -- the same
  -- shared resolver the governed read already uses.
  v_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_attendee_id IS NULL THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  -- Person attribution is recorded only when the caller is genuinely
  -- authenticated. It is never required to proceed.
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS e
    WHERE e.id = p_event_id
      AND e.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Vendor request submission verification failed.';
  END IF;

  -- The resolver already re-verified attendee/event eligibility
  -- (is_active, visible_to_members) before returning v_attendee_id; this
  -- read only derives display data, it does not re-authorize anything.
  SELECT
    array_to_string(ARRAY[
      a.coach_manufacturer,
      a.coach_model,
      CASE
        WHEN nullif(btrim(coalesce(a.coach_length, '')), '') IS NOT NULL
        THEN btrim(a.coach_length) || ' ft'
      END
    ], ' ')
    INTO v_coach_info
  FROM public.attendees AS a
  WHERE a.id = v_attendee_id
    AND a.event_id = p_event_id;

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
    actor_attendee_id,
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
    v_attendee_id,
    v_person_id,
    v_uid
  );

  RETURN QUERY
  SELECT v_new_id, v_new_event_id, v_new_vendor_id, v_new_status, v_new_created_at;
END;
$function$;

ALTER FUNCTION public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_my_vendor_service_request(uuid, uuid, uuid, uuid, text, text, integer, text, text, text, text, text, text, text)
TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. set_my_vendor_service_request_status: adds a required p_event_id
--    (needed to call the shared resolver) and two trailing optional
--    event-code parameters. Same drop-then-create treatment as above.
-- ---------------------------------------------------------------------------

DO $drop_old_status$
DECLARE
  v_old_signature regprocedure;
BEGIN
  v_old_signature := to_regprocedure(
    'public.set_my_vendor_service_request_status(uuid, uuid, text)'
  );

  IF v_old_signature IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM authenticated, PUBLIC',
      v_old_signature
    );
    EXECUTE format('DROP FUNCTION %s', v_old_signature);
    RAISE NOTICE 'Dropped old-signature public.set_my_vendor_service_request_status(uuid, uuid, text).';
  ELSE
    RAISE NOTICE 'Old-signature public.set_my_vendor_service_request_status(...) not present; nothing to drop.';
  END IF;
END;
$drop_old_status$;

CREATE FUNCTION public.set_my_vendor_service_request_status(
  p_tenant_id uuid,
  p_request_id uuid,
  p_next_status text,
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  request_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_attendee_id uuid;
  v_current_status text;
  v_event_id uuid;
  v_vendor_id uuid;
  v_action text;
  v_updated_id uuid;
  v_updated_status text;
BEGIN
  IF p_tenant_id IS NULL
    OR p_request_id IS NULL
    OR p_event_id IS NULL
    OR p_next_status NOT IN ('cancelled', 'new') THEN
    RAISE EXCEPTION 'Vendor request status change verification failed.';
  END IF;

  v_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_attendee_id IS NULL THEN
    RAISE EXCEPTION 'Vendor request status change verification failed.';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';
  END IF;

  -- Ownership is proven by the resolved attendee AND the resolved event
  -- together -- a request belonging to a different registration, or to a
  -- different event than the caller currently verified, is indistinguishable
  -- from "not found." This is the same attendee_id + event_id pair
  -- get_my_vendor_service_requests (20260807120000) already uses.
  SELECT vsr.request_status, vsr.event_id, vsr.vendor_id
    INTO v_current_status, v_event_id, v_vendor_id
  FROM public.vendor_service_requests AS vsr
  WHERE vsr.id = p_request_id
    AND vsr.attendee_id = v_attendee_id
    AND vsr.event_id = p_event_id
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
    AND vsr.attendee_id = v_attendee_id
    AND vsr.event_id = p_event_id
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
    actor_attendee_id,
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
    v_attendee_id,
    v_person_id,
    v_uid
  );

  RETURN QUERY
  SELECT v_updated_id, v_updated_status;
END;
$function$;

ALTER FUNCTION public.set_my_vendor_service_request_status(uuid, uuid, text, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_my_vendor_service_request_status(uuid, uuid, text, uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_my_vendor_service_request_status(uuid, uuid, text, uuid, text, text)
TO anon, authenticated;
