-- Stage 6A: Event-map selection is Event definition, not shared-map authority.
--
-- This migration replaces only the three inline administrative policies on
-- event_map_settings and the matching governed assignment-RPC check. It does
-- not alter master_maps, nearby_areas, public reads, grants, locking, or the
-- optimistic-concurrency contract.

BEGIN;

DO $$
DECLARE
  v_authenticated oid;
  v_anon oid;
BEGIN
  SELECT oid INTO v_authenticated FROM pg_roles WHERE rolname = 'authenticated';
  SELECT oid INTO v_anon FROM pg_roles WHERE rolname = 'anon';

  IF v_authenticated IS NULL OR v_anon IS NULL THEN
    RAISE EXCEPTION 'Stage 6A aborted: expected browser roles are absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_task_registry AS task
    WHERE task.task_key = 'event.definition.manage'
      AND task.scope = 'event'
      AND task.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Stage 6A aborted: event.definition.manage is not an active Event task';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'event_map_settings'
      AND relation.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'Stage 6A aborted: event_map_settings RLS is not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.event_map_settings'::regclass
      AND attribute.attname = 'event_id'
      AND attribute.attisdropped IS FALSE
  ) THEN
    RAISE EXCEPTION 'Stage 6A aborted: event_map_settings.event_id is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.event_map_settings'::regclass
      AND policy.polname = 'public read event_map_settings'
      AND policy.polcmd = 'r'
      AND policy.polpermissive IS TRUE
      AND policy.polroles @> ARRAY[v_anon, v_authenticated]
      AND policy.polroles <@ ARRAY[v_anon, v_authenticated]
      AND pg_get_expr(policy.polqual, policy.polrelid) = 'true'
  ) THEN
    RAISE EXCEPTION 'Stage 6A aborted: public event_map_settings read policy is absent or changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.event_map_settings'::regclass
      AND policy.polname = 'Admins can view event map settings'
      AND policy.polcmd = 'r'
      AND policy.polpermissive IS TRUE
      AND policy.polroles = ARRAY[v_authenticated]
      AND pg_get_expr(policy.polqual, policy.polrelid) ~ 'admin_users'
      AND pg_get_expr(policy.polqual, policy.polrelid) ~ 'is_active'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.event_map_settings'::regclass
      AND policy.polname = 'Admins can insert event map settings'
      AND policy.polcmd = 'a'
      AND policy.polpermissive IS TRUE
      AND policy.polroles = ARRAY[v_authenticated]
      AND pg_get_expr(policy.polwithcheck, policy.polrelid) ~ 'admin_users'
      AND pg_get_expr(policy.polwithcheck, policy.polrelid) ~ 'is_active'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.event_map_settings'::regclass
      AND policy.polname = 'Admins can update event map settings'
      AND policy.polcmd = 'w'
      AND policy.polpermissive IS TRUE
      AND policy.polroles = ARRAY[v_authenticated]
      AND pg_get_expr(policy.polqual, policy.polrelid) ~ 'admin_users'
      AND pg_get_expr(policy.polwithcheck, policy.polrelid) ~ 'admin_users'
  ) THEN
    RAISE EXCEPTION 'Stage 6A aborted: expected inline event_map_settings policy is absent or changed';
  END IF;

  IF to_regprocedure('public.admin_save_event_assignments_guarded(uuid,uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6A aborted: governed Event-assignment RPC is absent';
  END IF;
END;
$$;

DROP POLICY "Admins can view event map settings" ON public.event_map_settings;
CREATE POLICY "Event definition admins can view event map settings"
  ON public.event_map_settings
  FOR SELECT
  TO authenticated
  USING (public.has_event_task_authority('event.definition.manage', event_id));

DROP POLICY "Admins can insert event map settings" ON public.event_map_settings;
CREATE POLICY "Event definition admins can insert event map settings"
  ON public.event_map_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_event_task_authority('event.definition.manage', event_id));

DROP POLICY "Admins can update event map settings" ON public.event_map_settings;
CREATE POLICY "Event definition admins can update event map settings"
  ON public.event_map_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_event_task_authority('event.definition.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.definition.manage', event_id));

CREATE OR REPLACE FUNCTION public.admin_save_event_assignments_guarded(
  p_event_id uuid,
  p_master_map_id uuid,
  p_nearby_list_id uuid,
  p_expected_master_map_id uuid,
  p_expected_nearby_list_id uuid
)
RETURNS TABLE(persisted_master_map_id uuid, persisted_nearby_list_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current_nearby uuid;
  v_current_map uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.definition.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Lock the Event row; confirms it exists and serializes concurrent
  -- assignment saves for this Event against each other.
  SELECT e.selected_nearby_area_id INTO v_current_nearby
  FROM public.events AS e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Lock the map-settings row when present; its absence is the NULL
  -- (never-configured) Master Map baseline.
  SELECT ems.selected_master_map_id INTO v_current_map
  FROM public.event_map_settings AS ems
  WHERE ems.event_id = p_event_id
  FOR UPDATE;

  IF v_current_nearby IS DISTINCT FROM p_expected_nearby_list_id
     OR v_current_map IS DISTINCT FROM p_expected_master_map_id
  THEN
    RAISE EXCEPTION 'stale_event_assignments';
  END IF;

  UPDATE public.events AS e
  SET selected_nearby_area_id = p_nearby_list_id
  WHERE e.id = p_event_id;

  INSERT INTO public.event_map_settings (event_id, selected_master_map_id)
  VALUES (p_event_id, p_master_map_id)
  ON CONFLICT ON CONSTRAINT event_map_settings_event_id_key DO UPDATE
  SET selected_master_map_id = excluded.selected_master_map_id,
      updated_at = now();

  RETURN QUERY
  SELECT
    (SELECT ems.selected_master_map_id
       FROM public.event_map_settings AS ems
      WHERE ems.event_id = p_event_id),
    (SELECT e.selected_nearby_area_id
       FROM public.events AS e
      WHERE e.id = p_event_id);
END;
$$;

ALTER FUNCTION public.admin_save_event_assignments_guarded(uuid, uuid, uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_save_event_assignments_guarded(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_event_assignments_guarded(uuid, uuid, uuid, uuid, uuid) TO authenticated;

COMMIT;
