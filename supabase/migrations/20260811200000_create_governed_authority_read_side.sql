-- Governed authority read-side repair. Adds the two read-only RPCs the
-- Admin/Event Staff management UI needs to view OTHER admins' Event
-- assignments and explicit task grants -- a capability the foundation
-- migration (20260811170000) deliberately did not provide, since every
-- resolver/capability function it defines is hard-locked to auth.uid()
-- (resolve_task_authority, has_event_task_authority,
-- list_effective_event_capabilities all reject a mismatched actor), and
-- admin_event_permissions/admin_task_registry/admin_event_profiles/
-- admin_event_profile_tasks/admin_authority_audit carry zero table grants
-- for any role. Neither gap is closed here by widening a grant or a
-- policy -- both new functions reuse the exact same
-- assert_event_authority_governor(p_event_id) gate every mutation RPC
-- already calls (Platform admin, or active Tenant admin for the Event's
-- own Tenant; RAISE EXCEPTION otherwise), so the read boundary and the
-- mutation boundary are the same governed predicate, not two.
--
-- No existing table grant, RLS policy, mutation RPC, or resolver function
-- is touched. Purely additive: two new SECURITY DEFINER functions.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_event_authority_assignments(p_event_id uuid)
RETURNS TABLE(
  assignment_id uuid,
  event_id uuid,
  tenant_id uuid,
  target_admin_user_id uuid,
  target_display_name text,
  target_email text,
  canonical_profile text,
  assignment_created_at timestamptz,
  explicit_grants jsonb,
  can_govern boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid;
BEGIN
  -- Same governor gate the mutation RPCs use: validates the Event exists,
  -- derives its Tenant, and fails closed (RAISE EXCEPTION) unless the
  -- caller is a Platform admin or an active Tenant admin for that Tenant.
  SELECT g.tenant_id, g.actor_admin_user_id INTO v_tenant, v_actor
  FROM public.assert_event_authority_governor(p_event_id) AS g;

  RETURN QUERY
  SELECT
    aea.id AS assignment_id,
    aea.event_id,
    v_tenant AS tenant_id,
    aea.admin_user_id AS target_admin_user_id,
    au.display_name AS target_display_name,
    au.email AS target_email,
    aea.role AS canonical_profile,
    aea.created_at AS assignment_created_at,
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object(
           'task_key', aep.permission_key,
           'granted_at', aep.granted_at,
           'grant_source', aep.grant_source,
           'source_profile_key', aep.source_profile_key,
           'granted_by_admin_user_id', aep.granted_by_admin_user_id
         )
         ORDER BY aep.permission_key
       )
       FROM public.admin_event_permissions AS aep
       WHERE aep.admin_event_access_id = aea.id
         AND aep.is_enabled),
      '[]'::jsonb
    ) AS explicit_grants,
    (au.user_id IS DISTINCT FROM auth.uid()) AS can_govern
  FROM public.admin_event_access AS aea
  JOIN public.admin_users AS au ON au.id = aea.admin_user_id
  WHERE aea.event_id = p_event_id
  ORDER BY aea.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_event_authority_profile_catalog(p_event_id uuid)
RETURNS TABLE(
  profile_key text,
  display_name text,
  description text,
  profile_default_task_keys text[],
  event_task_catalog jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_catalog jsonb;
BEGIN
  -- Same governor gate as above. The profile catalog itself is not
  -- Event-specific data, but read access to it is still bounded by proof
  -- of governance over the Event the caller is currently managing.
  SELECT g.tenant_id, g.actor_admin_user_id INTO v_tenant, v_actor
  FROM public.assert_event_authority_governor(p_event_id) AS g;

  SELECT jsonb_agg(
    jsonb_build_object(
      'task_key', r.task_key,
      'scope', r.scope,
      'task_kind', r.task_kind,
      'description', r.description
    )
    ORDER BY r.task_key
  ) INTO v_catalog
  FROM public.admin_task_registry AS r
  WHERE r.is_active
    AND r.scope = 'event'
    AND r.event_assignment_grantable;

  RETURN QUERY
  SELECT
    p.profile_key,
    p.display_name,
    p.description,
    COALESCE(
      (SELECT array_agg(pt.task_key ORDER BY pt.task_key)
       FROM public.admin_event_profile_tasks AS pt
       WHERE pt.profile_key = p.profile_key),
      ARRAY[]::text[]
    ) AS profile_default_task_keys,
    v_catalog AS event_task_catalog
  FROM public.admin_event_profiles AS p
  WHERE p.is_active
  ORDER BY p.profile_key;
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_authority_assignments(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_authority_assignments(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_event_authority_profile_catalog(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_authority_profile_catalog(uuid) TO authenticated;

COMMIT;
