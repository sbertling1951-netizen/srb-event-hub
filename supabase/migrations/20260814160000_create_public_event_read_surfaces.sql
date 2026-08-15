-- Public Event Read Surface Split, Stage 1 (governed read contracts only).
--
-- Governing architecture: Public Event Read Surface Split audit (LEM,
-- 2026-08-14), building on the open design item recorded by
-- 20260813140000_reconcile_events_rls_grant_drift.sql (item 2) and
-- ADR-013 §2/§10 item 3.
--
-- This migration is purely additive: it creates two new, narrow,
-- SECURITY DEFINER read functions and grants EXECUTE on them. It does
-- not touch "Public read events", any other public.events RLS policy,
-- or any existing table grant. The broad USING (true) SELECT policy
-- remains unchanged and is the only reason these functions still work
-- for anon/authenticated today -- retiring it is explicitly deferred to
-- a later, separately authorized stage, once every direct consumer
-- identified by the audit has been migrated to one of these two
-- contracts. No consumer is migrated by this migration.
--
-- Two contracts, matching the audit's two proven consumer shapes:
--
--   1. Public Event Discovery (get_public_discoverable_events) -- for
--      flows with no established Event context yet (member login's
--      event picker, member activation's event picker, the member
--      events list). Row predicate is exactly this codebase's own
--      already-consolidated member-visibility rule
--      (lib/eventStatus.ts's isMemberVisibleEvent, itself ADR-013 §12
--      stage 5's consolidation of what were seven duplicated
--      implementations): visible_to_members = true, is_active is not
--      false, and status is not one of the known excluded keywords.
--      This is not a new rule -- it is the same rule already enforced
--      client-side by app/member/login/page.tsx and
--      app/member/activate/page.tsx, now enforced server-side instead.
--
--   2. Known-Context Event Continuity (get_event_continuity_context) --
--      for flows reading an Event the caller's session has already
--      established by id (public Coach Map, getActiveEvent's known-id
--      branch, member Nearby). Per ADR-006 §4's "inactive is not
--      invalid" Context invariant and the reconcile-drift migration's
--      own stated reasoning for app/coach-map/public/page.tsx, this
--      contract deliberately applies no visibility/lifecycle predicate
--      at all -- an already-established Event must remain readable
--      regardless of visible_to_members/is_active/status. It returns a
--      narrower column set than Discovery (no visibility columns, since
--      no continuity consumer reads or displays them).
--
-- Column selection for both functions is evidence-based, not the union
-- of every current .select() list -- see the audit's field-by-field
-- proof. In particular:
--   * event_code is included in neither contract. The only two flows
--     this repository treats as "login/activation" (member/login,
--     member/activate) never select or display event_code -- the
--     member types the code and it is verified server-side by the
--     already-existing verify_member_event_login RPC. Discovery must
--     let a caller ACCEPT a code, never RECEIVE one.
--   * registration_open and participant_capacity are included in
--     neither contract. app/member/events/page.tsx currently selects
--     both from the base table but renders neither -- no consumer has a
--     proven display or logic need. participant_capacity also has no
--     corresponding column-adding migration anywhere in this
--     repository's tracked history; that is a separate evidence gap,
--     not resolved here (see audit).
--   * visible_to_members/is_active/status are used as this function's
--     own WHERE predicate but are not themselves returned -- no
--     discovery consumer displays or re-filters on them, so returning
--     them would be exposure without a proven reader.
--
-- SECURITY DEFINER is required, not merely convenient: once the broad
-- table policy is eventually retired (a later stage), anon/authenticated
-- will hold no SELECT grant on public.events at all, and a SECURITY
-- INVOKER function would then return nothing for those roles. Running
-- as the function owner (postgres, matching this repository's existing
-- verify_member_event_login/resolve_member_account precedent) lets the
-- function itself remain the sole, narrow authority for both read
-- shapes independent of the caller's own table-level grant.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_discoverable_events()
RETURNS TABLE(
    id uuid,
    name text,
    venue_name text,
    location text,
    start_date date,
    end_date date,
    lat numeric,
    lng numeric,
    map_image_url text,
    master_map_id uuid,
    locations_map_open_scale numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
      e.id,
      e.name,
      e.venue_name,
      e.location,
      e.start_date,
      e.end_date,
      e.lat,
      e.lng,
      e.map_image_url,
      e.master_map_id,
      e.locations_map_open_scale
  FROM public.events e
  WHERE e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN (
      'inactive', 'archived', 'complete', 'completed', 'closed', 'draft'
    )
  ORDER BY e.start_date ASC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_discoverable_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_discoverable_events() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_event_continuity_context(p_event_id uuid)
RETURNS TABLE(
    id uuid,
    name text,
    venue_name text,
    location text,
    start_date date,
    end_date date,
    lat numeric,
    lng numeric,
    map_image_url text,
    master_map_id uuid,
    coach_map_open_scale numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
      e.id,
      e.name,
      e.venue_name,
      e.location,
      e.start_date,
      e.end_date,
      e.lat,
      e.lng,
      e.map_image_url,
      e.master_map_id,
      e.coach_map_open_scale
  FROM public.events e
  WHERE e.id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_continuity_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_continuity_context(uuid) TO anon, authenticated;

COMMIT;
