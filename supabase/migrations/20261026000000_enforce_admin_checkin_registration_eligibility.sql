-- Admin Check-In registration eligibility, approved by Pap on 2026-09-23.
--
-- Defect: complete_admin_checkin established actor authority, Event scope and
-- Event lifecycle, then updated Arrival for any attendee id in the Event. It
-- never consulted registration eligibility, so a cancelled or inactive
-- registration could be checked in, and a cancellation committed after the
-- operator's page loaded was not rejected.
--
-- This migration replaces the function body only. Check-In still owns Arrival
-- and nothing else: the signature, return contract, ACLs, owner, security
-- configuration, authority basis (event.checkin.manage), Event-scope check,
-- lifecycle assertion and 'parked' preservation are carried forward unchanged.
--
-- Eligibility rule: the existing Admin operational-summary predicate
-- (20260817180000_create_event_operational_summary_read.sql), which is the
-- source of the Admin "active registrations" figure operators reconcile
-- against:
--     is_active IS TRUE AND registration_status IS DISTINCT FROM 'cancelled'
-- Non-cancelled statuses stay eligible deliberately. The Member roster's
-- stricter status allowlist governs a different surface and is not adopted here.
--
-- This migration performs no data repair: it contains no top-level DML and
-- rewrites no registration status, activity flag, cancellation metadata,
-- sharing preference, history row or prior arrival value. The function itself
-- necessarily retains its one governed UPDATE, which is the operation being
-- guarded.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_admin_checkin(
  p_attendee_id uuid,
  p_expected_event_id uuid,
  p_has_arrived boolean,
  p_share_with_attendees boolean
)
RETURNS TABLE(
  outcome text,
  event_id uuid,
  attendee_id uuid,
  share_with_attendees boolean,
  has_arrived boolean,
  arrival_status text,
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL OR p_attendee_id IS NULL OR p_expected_event_id IS NULL
     OR p_has_arrived IS NULL OR p_share_with_attendees IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT a.event_id INTO v_event_id
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found';
  END IF;

  -- Check-In owns Arrival. event.checkin.manage is the sole authorization
  -- basis for this operation -- event.parking.manage is deliberately not an
  -- alternate basis here: each module's task authority governs only its own
  -- operation (Site Assignment Governance Architecture §4.1). A user who
  -- holds both permissions still uses each module under its own authority.
  IF NOT public.has_event_task_authority('event.checkin.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  IF v_event_id <> p_expected_event_id THEN
    RAISE EXCEPTION 'event_scope_mismatch';
  END IF;

  -- Lifecycle. Authority is fully established above; evaluated after it,
  -- never before, matching every other gated domain (record_site_placement
  -- included). operational/post_event pass; archived raises
  -- 'event_archived'; an indeterminate Lifecycle raises
  -- 'event_lifecycle_indeterminate'.
  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  -- Registration eligibility is enforced *inside* the governed UPDATE, not by
  -- a preceding SELECT. A separate check could observe an eligible row and
  -- then mutate a row that a concurrent transaction cancelled in between.
  -- Here the predicate is evaluated against the row version the UPDATE itself
  -- locks: under READ COMMITTED, a writer that cancels and commits first makes
  -- this statement re-check the updated row, which then fails the predicate
  -- and matches nothing. So a cancellation committed before the mutation
  -- always prevents the mutation.
  --
  -- Rejection travels through the function's existing structured outcome
  -- channel rather than an exception, so the caller receives the stored state
  -- it must reconcile to. The attendee's existence was established above;
  -- matching nothing here therefore means ineligible, not missing.
  RETURN QUERY
  WITH applied AS (
    UPDATE public.attendees AS a
    SET share_with_attendees = p_share_with_attendees,
        has_arrived = p_has_arrived,
        arrival_status = CASE
          WHEN p_has_arrived AND a.arrival_status = 'parked' THEN 'parked'
          WHEN p_has_arrived THEN 'arrived'
          ELSE 'not_arrived'
        END
    WHERE a.id = p_attendee_id
      AND a.is_active IS TRUE
      AND a.registration_status IS DISTINCT FROM 'cancelled'
    RETURNING
      a.event_id, a.id, a.share_with_attendees, a.has_arrived, a.arrival_status
  )
  SELECT
    'applied'::text, ap.event_id, ap.id, ap.share_with_attendees,
    ap.has_arrived, ap.arrival_status, NULL::text
  FROM applied AS ap
  UNION ALL
  SELECT
    'rejected'::text, stored.event_id, stored.id, stored.share_with_attendees,
    stored.has_arrived, stored.arrival_status,
    'registration_not_current'::text
  FROM public.attendees AS stored
  WHERE stored.id = p_attendee_id
    AND NOT EXISTS (SELECT 1 FROM applied);
END;
$$;

ALTER FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_admin_checkin(uuid, uuid, boolean, boolean)
TO authenticated;

COMMIT;
