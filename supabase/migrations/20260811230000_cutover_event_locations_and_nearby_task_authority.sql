-- Cohort 1 Event-task RLS cutover: Locations + Nearby.
-- Public SELECT policies deliberately remain unchanged. Mutation authority is
-- resolved only through the canonical task resolver against each stored row's
-- event_id; no legacy admin fallback is retained.
BEGIN;

DROP POLICY "Admins can manage event_locations" ON public.event_locations;

CREATE POLICY "Event task admins can insert event_locations"
  ON public.event_locations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_event_task_authority('event.locations.manage', event_id));

CREATE POLICY "Event task admins can update event_locations"
  ON public.event_locations
  FOR UPDATE TO authenticated
  USING (public.has_event_task_authority('event.locations.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.locations.manage', event_id));

CREATE POLICY "Event task admins can delete event_locations"
  ON public.event_locations
  FOR DELETE TO authenticated
  USING (public.has_event_task_authority('event.locations.manage', event_id));

DROP POLICY "Admins can manage event_nearby_places" ON public.event_nearby_places;

CREATE POLICY "Event task admins can insert event_nearby_places"
  ON public.event_nearby_places
  FOR INSERT TO authenticated
  WITH CHECK (public.has_event_task_authority('event.nearby.manage', event_id));

CREATE POLICY "Event task admins can update event_nearby_places"
  ON public.event_nearby_places
  FOR UPDATE TO authenticated
  USING (public.has_event_task_authority('event.nearby.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.nearby.manage', event_id));

CREATE POLICY "Event task admins can delete event_nearby_places"
  ON public.event_nearby_places
  FOR DELETE TO authenticated
  USING (public.has_event_task_authority('event.nearby.manage', event_id));

COMMIT;
