-- resolve_effective_event_locations -- governed Locations read boundary for
-- /locations under Temporary Event Access.
--
-- Temporary Event Access /locations reconciliation (follow-up to d36ad11,
-- the Nearby reconciliation). Traced live before this migration:
--
-- ROOT CAUSE #1 (consumer bug, fixed in app/locations/page.tsx, no DB
-- change): /locations calls get_my_member_event_continuity_context
-- unconditionally whenever a local memberEvent context exists, exactly the
-- same defect already found and fixed for Nearby (d36ad11). That RPC
-- requires a real Supabase authenticated session (auth.uid()) to resolve a
-- Participation link and is not anon-executable -- Temporary Event Access
-- (Event code + registration email/phone, no Supabase session, stays anon)
-- gets a permission-denied error, surfaced as "The selected event is not
-- available." The corrected client now calls get_event_continuity_context
-- for that case instead -- an existing, already anon+authenticated
-- EXECUTE-granted RPC (20260815110000), explicitly designed as the "public
-- known-ID continuity" counterpart to Member Participation continuity (see
-- that migration's own header comment) and, until this change, wired up to
-- zero production consumers. It uses the exact same admission predicate
-- (visible_to_members = true AND is_active AND status not in a terminal
-- set) that verify_member_event_login itself already requires before a
-- Temporary Event Access login can succeed at all -- so every Event a
-- Temporary Event Access caller could legitimately hold in local context
-- already satisfies it. This introduces no new capability: the same
-- predicate already gates full public discovery
-- (get_public_discoverable_events_for_tenant), so this RPC's exposure for
-- Temporary Event Access is bounded by what is already anon-discoverable
-- today, never broader.
--
-- ROOT CAUSE #2 (this migration): once Event resolution succeeds, the page
-- reads public.event_locations directly via .from("event_locations") on
-- the anon Supabase client. Live audit (information_schema.role_table_
-- grants + pg_policy, verified against the linked project) found:
--
--   * anon holds the FULL, undifferentiated privilege set on
--     event_locations -- SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--     REFERENCES, TRIGGER -- identical to authenticated and service_role.
--   * "Anyone can read event_locations" is USING (true), TO public, with
--     no event_id predicate, no visible_to_members/is_active/status
--     predicate, and no is_hidden column exists on this table at all
--     (confirmed via information_schema.columns) -- so today, any anon
--     caller holding the table-level SELECT grant can already read every
--     Location row for every Event, including Events that are inactive,
--     archived, or otherwise not member-visible, without even needing to
--     know an Event id.
--   * "Event task admins can insert/update/delete event_locations" use
--     has_event_task_authority('event.locations.manage', event_id), which
--     resolves through auth.uid() -- already RLS-inert for anon (auth.uid()
--     is null), the exact same shape already reasoned through for
--     event_nearby_places in 79fe0a4. TRUNCATE is never subject to RLS at
--     all regardless of policy, matching the same latent gap 79fe0a4 closed
--     for attendees/attendee_household_members.
--
-- This is the same anon-grant-hygiene drift pattern already reconciled for
-- event_nearby_places (79fe0a4) and other tables, and it independently
-- violates the "no arbitrary-Event exposure by id alone" boundary this
-- workstream must hold -- worse, since no id is even required today. The
-- ONLY anon-reachable consumer of event_locations data, repository-wide
-- (exhaustive grep of every .from("event_locations") call), is
-- app/locations/page.tsx; the one other consumer, app/admin/locations/
-- page.tsx, runs under AdminRouteGuard as the `authenticated` role and is
-- unaffected by an anon-only REVOKE. public.master_maps and public.
-- event_map_settings, the other two tables /locations reads, are
-- deliberately NOT touched here: both are also read directly by
-- app/coach-map/public/page.tsx (a MemberRouteGuard-gated, Temporary-
-- Event-Access-reachable surface explicitly out of scope for this
-- workstream), so narrowing their anon grants risks breaking Coach Map,
-- which this workstream must not touch. That shared exposure is reported,
-- not remediated, here.
--
-- This migration closes the event_locations gap the same way 79fe0a4
-- closed it for event_nearby_places: a new governed, postgres-owned
-- SECURITY DEFINER RPC re-derives the same visible_to_members/is_active/
-- status predicate get_event_continuity_context already uses (so it never
-- exposes an Event this workstream's Event-resolution step would have
-- refused), returns only the same non-PII facility/location descriptive
-- columns the page already selects (id, event_id, name, category,
-- description, map_x, map_y, priority -- no is_hidden column exists to
-- preserve, there was never row-level Location visibility beyond the
-- Event-level gate now enforced here), and anon's raw table grant is
-- revoked -- the governed RPC becomes the only anon-reachable path, exactly
-- as resolve_effective_nearby_places already is for Nearby.
--
-- authenticated retains its existing event_locations grants untouched (the
-- Admin surface's own has_event_task_authority-gated RLS remains the
-- authority boundary for Admin management, unaffected by this migration).
-- service_role/postgres are unaffected. No RLS policy is touched or
-- broadened. No Person/Participation, Nearby, Coach Map, or other domain
-- table/function is touched.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_effective_event_locations(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  event_id uuid,
  name text,
  category text,
  description text,
  map_x numeric,
  map_y numeric,
  priority integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  -- Same admission predicate as get_event_continuity_context and
  -- verify_member_event_login's own Event-code gate -- never trusts
  -- p_event_id alone. An Event that fails this predicate returns zero
  -- Location rows, matching what get_event_continuity_context would
  -- already have refused during Event resolution.
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
  SELECT el.id, el.event_id, el.name, el.category, el.description, el.map_x, el.map_y, el.priority
  FROM public.event_locations AS el
  WHERE el.event_id = p_event_id
  ORDER BY el.priority ASC, el.name ASC;
END;
$function$;

ALTER FUNCTION public.resolve_effective_event_locations(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_effective_event_locations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_effective_event_locations(uuid) TO anon, authenticated;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.event_locations
FROM anon;

COMMIT;
