-- ADR-006 §3.2 Initial-Establishment / Current Active Event contract.
--
-- Classification audit (LEM, 2026-08-14) found app/locations/page.tsx and
-- lib/getActiveEvent.ts's active-event fallback branch share a third,
-- genuinely distinct read shape from the two Stage 1 contracts: neither
-- public discovery (get_public_discoverable_events) nor known-context
-- continuity (get_event_continuity_context) fits, because neither
-- consumer has a known Event id, and ADR-006 §3.2 explicitly names this
-- exact getActiveEvent.ts fallback an "initial-establishment default
-- only" -- a Tenant-operational-status bootstrap ("what Event is running
-- right now"), not a member-visibility/self-service concept. §4
-- separately treats "active events only" filtering as presentation logic
-- distinct from context resolution. Per that evidence, this RPC
-- preserves the existing is_active-only predicate unchanged -- it does
-- NOT add visible_to_members or the member-discovery status denylist,
-- and it must not, since that would silently narrow a bootstrap default
-- ADR-006 treats as a different concept entirely from member discovery.
--
-- Column projection is the union of both consumers' actual selects
-- (locations.tsx: id,name,location,map_image_url,master_map_id,
-- locations_map_open_scale; getActiveEvent.ts fallback: id,name,location,
-- start_date,end_date,map_image_url,master_map_id) -- evidence-based, not
-- a superset of every events column.
--
-- No ORDER BY or LIMIT is applied inside this function, matching both
-- consumers' current queries exactly: neither specifies an explicit
-- order today, only .limit(1) chained by the caller, so which row wins
-- among multiple is_active=true Events is already unspecified/
-- Postgres-default-order behavior -- preserved bit-for-bit rather than
-- "fixed" by imposing a new order here. Callers continue to chain
-- .limit(1).maybeSingle() via PostgREST exactly as they already do
-- against get_public_discoverable_events's .limit(25).
--
-- components/layout/EventBanner.tsx is deliberately NOT covered by this
-- RPC. It shares the is_active=true bootstrap shape but additionally
-- filters is_master_map = false and orders by start_date desc -- both
-- absent from locations.tsx/getActiveEvent.ts's own queries. Classification
-- audit evidence: is_master_map appears nowhere else in this repository
-- (no other consumer, no migration ever sets it true, no ADR references
-- it) and its exclusion predicate has existed since EventBanner's first
-- tracked commit (80d30cf, 2026-04-23) with no rationale recorded --
-- original, deliberate-looking component behavior, but not confirmed
-- still meaningful against current data, and folding it into this shared
-- RPC would either silently narrow locations.tsx/getActiveEvent.ts (if
-- added) or silently widen EventBanner (if omitted and EventBanner were
-- migrated anyway). Left as an open decision; EventBanner is not
-- migrated and this RPC is not shaped to fit it.
--
-- SECURITY DEFINER / search_path / ACL pattern matches the two Stage 1
-- functions exactly, for the same reason: once the broad table policy is
-- eventually retired, anon/authenticated will hold no direct SELECT on
-- events, and only a SECURITY DEFINER function can keep answering this
-- bootstrap query.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_active_event()
RETURNS TABLE(
    id uuid,
    name text,
    location text,
    start_date date,
    end_date date,
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
      e.location,
      e.start_date,
      e.end_date,
      e.map_image_url,
      e.master_map_id,
      e.locations_map_open_scale
  FROM public.events e
  WHERE e.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_active_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_active_event() TO anon, authenticated;

-- Applied up front this time (Stage 1 needed a separate follow-up
-- migration, 20260814170000, to discover and close this same gap):
-- Supabase's schema-level default privileges for service_role would
-- otherwise grant it EXECUTE on this new function too, even though no
-- service_role consumer exists for it.
REVOKE EXECUTE ON FUNCTION public.get_current_active_event() FROM service_role;

COMMIT;
