-- Fix a latent PL/pgSQL name collision in
-- public.list_nearby_area_lists_for_event_application (created in
-- 20260825000000_create_governed_nearby_area_lists.sql).
--
-- The function's RETURNS TABLE(... id uuid, ... tenant_id uuid, ...) makes
-- `id` and `tenant_id` implicit OUT variables for the whole body. The Event
-- lookup then referenced those column names unqualified:
--
--     SELECT tenant_id INTO v_event_tenant_id
--     FROM public.events
--     WHERE id = p_event_id;
--
-- so `tenant_id` (and `id`) are ambiguous between the OUT variable and
-- public.events. Under the default plpgsql.variable_conflict = error this
-- raises "column reference \"tenant_id\" is ambiguous" at runtime -- but
-- only AFTER the authority and lifecycle guards pass, so an unauthenticated
-- caller never reaches it. The result: the "Apply Reusable Area List"
-- loader has errored for every authorized admin, on every Event, since
-- 2026-08-25 (confirmed: nearby_area_list_application_audit and
-- nearby_area_list_command_audit are both empty).
--
-- The ONLY change here is qualifying that one lookup with an explicit
-- alias (public.events AS e -> e.tenant_id / e.id). Signature, SECURITY
-- DEFINER, search_path, authority behavior (has_event_task_authority
-- 'event.nearby.manage'), lifecycle assertion, every eligibility rule, the
-- RETURN QUERY, owner, and grants are all byte-for-byte unchanged.
-- #variable_conflict is deliberately NOT used -- explicit qualification is
-- sufficient and matches the alias-qualified style of every other query in
-- these RPCs.

CREATE OR REPLACE FUNCTION public.list_nearby_area_lists_for_event_application(
  p_event_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  scope text,
  tenant_id uuid,
  uncategorized_member_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_tenant_id uuid;
BEGIN
  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'Nearby Area List application requires event.nearby.manage authority.';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  SELECT e.tenant_id INTO v_event_tenant_id
  FROM public.events AS e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found.', p_event_id;
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.name,
    al.description,
    al.scope,
    al.tenant_id,
    count(*) FILTER (WHERE nm.category_id IS NULL)::integer
  FROM public.nearby_area_lists AS al
  JOIN public.nearby_area_list_members AS m
    ON m.area_list_id = al.id
   AND m.is_active
  JOIN public.nearby_master AS nm
    ON nm.id = m.nearby_master_id
   AND nm.status = 'active'
   AND nm.review_status = 'approved'
  WHERE al.is_active
    AND (
      al.scope = 'shared_public'
      OR (al.scope = 'tenant_specific' AND al.tenant_id = v_event_tenant_id)
    )
  GROUP BY al.id
  ORDER BY al.scope, al.name;
END;
$function$;

-- Re-assert the exact owner and grant posture 20260825000000 established
-- (CREATE OR REPLACE preserves these, but re-stating keeps the migration
-- self-contained and idempotent).
ALTER FUNCTION public.list_nearby_area_lists_for_event_application(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_nearby_area_lists_for_event_application(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_nearby_area_lists_for_event_application(uuid) TO authenticated;
