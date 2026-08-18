-- Self-Scoped Tenant Administration Read Surface -- Foundation.
--
-- Context: public.has_any_tenant_admin_authority() (20260818090000)
-- answers only the coarse boolean "does the caller hold Tenant Admin
-- authority for at least one Tenant, or Platform Admin authority" --
-- enough to gate a route (AdminRouteGuard's requiredTenantAuthority),
-- not enough to populate a Tenant selector. A page that lets the admin
-- choose WHICH Tenant they are working in (starting with the eventual
-- /admin/nearby-settings migration, not done by this migration) cannot
-- keep using an unfiltered `supabase.from("tenants").select(...)` --
-- every active Tenant, not just the caller's own -- without exposing
-- Tenant choices an ordinary Tenant Admin has no assignment to. This
-- migration adds the self-scoped list read that closes that gap.
--
-- Same self-scoping discipline as has_any_tenant_admin_authority: the
-- function takes NO parameters at all and derives the caller
-- exclusively from auth.uid() inside the function body. There is no
-- argument through which a client could request another admin's
-- assignments or an arbitrary Tenant.
--
-- public.admin_tenant_access still carries no table grant to anyone
-- (20260810110000) -- this migration does not change that. It adds one
-- new SECURITY DEFINER read that internally joins admin_tenant_access
-- and public.tenants (already openly SELECT-readable for active rows,
-- 20260721_enable_tenants_rls.sql) and returns only the minimum fields
-- a Tenant selector needs: tenant_id and display_name. No admin
-- identity, no assignment id/timestamps/created_by, no inactive or
-- other-Tenant row is ever returned.
--
-- Platform Admin behavior: rather than inventing a fake
-- admin_tenant_access assignment, a Platform Admin's call returns every
-- active Tenant directly from public.tenants -- the same data the
-- Nearby Settings page already reads today via its own unfiltered
-- query, just served through this governed function so one RPC covers
-- both roles and no page needs a separate Platform-only code path.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_my_tenant_admin_access()
RETURNS TABLE (
  tenant_id uuid,
  display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF public.has_platform_admin_authority(v_uid) THEN
    RETURN QUERY
    SELECT t.id, t.display_name
    FROM public.tenants AS t
    WHERE t.is_active = true
    ORDER BY t.display_name;

    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.id, t.display_name
  FROM public.admin_tenant_access AS ata
  JOIN public.admin_users AS au ON au.id = ata.admin_user_id
  JOIN public.tenants AS t ON t.id = ata.tenant_id
  WHERE au.user_id = v_uid
    AND au.is_active = true
    AND ata.is_active = true
    AND t.is_active = true
  ORDER BY t.display_name;
END;
$$;

ALTER FUNCTION public.list_my_tenant_admin_access() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_my_tenant_admin_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_tenant_admin_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_tenant_admin_access() TO authenticated;

-- Applied up front (matching 20260814200000's precedent): Supabase's
-- schema-level default privileges for service_role would otherwise grant
-- it EXECUTE on this new function too, even though no service_role
-- consumer exists or is intended -- service_role has no auth.uid() to
-- self-scope against in the first place.
REVOKE ALL ON FUNCTION public.list_my_tenant_admin_access() FROM service_role;

COMMIT;
