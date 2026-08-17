-- Admin Permission Mutation Governance (Stage 2 D6).
--
-- Confirmed defect: app/admin/permissions/page.tsx's toggle()/
-- undoLastChange()/applyPreset() each wrote a permission row via a direct
-- client-side .update()/.insert()/.upsert() call, then separately
-- attempted an admin_permission_audit insert wrapped in its own
-- try/catch that only console.error'd on failure. The permission change
-- was already durably committed by the time the audit insert ran or
-- failed -- a privileged authority mutation could succeed while leaving
-- no audit record, directly contradicting Constitution Article IV
-- ("every privileged action shall be auditable").
--
-- Smallest governed fix, matching this repository's established
-- SECURITY DEFINER RPC pattern (register_vendor_self,
-- admit_vendor_for_event, record_site_placement, etc.): one RPC that
-- writes the permission row and its audit row inside a single
-- transaction, so neither can durably succeed without the other. Every
-- direct-write call site (toggle, undo, preset apply) is repointed at
-- this one RPC in the accompanying page.tsx change -- not reimplemented
-- three more times.
--
-- Authority preserved exactly as-is, not redesigned: the RPC requires
-- the same can_manage_admins permission (super_admin implicitly
-- included) that AdminRouteGuard already requires to reach this page at
-- all (requiredPermission="can_manage_admins") and that hasPermission()
-- already computes client-side -- this makes that existing boundary
-- server-enforced and atomic with the write it gates, it does not
-- invent a new authority concept or grant.
--
-- Audit-noise guard: a call that would not actually change is_enabled
-- (e.g. a dependency-cascade write for a permission already in the
-- target state) upserts the row (a harmless no-op) but does not insert
-- an audit row -- computed here from the row FOR UPDATE has just locked
-- and read, not from a client-side "was it enabled before" guess that
-- could itself race.
--
-- Scope: admin_privilege_group_permissions and admin_permission_audit
-- only. admin_permission_presets (a named snapshot, not a live authority
-- grant) is untouched -- savePreset()/loadPresets() keep writing/reading
-- it directly, as before; only applyPreset()'s per-permission writes
-- against admin_privilege_group_permissions route through the new RPC.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_admin_privilege_group_permission(
  p_privilege_group text,
  p_permission_key text,
  p_is_enabled boolean,
  p_action_id uuid DEFAULT NULL
)
RETURNS TABLE (
  permission_id uuid,
  old_value boolean,
  new_value boolean,
  audited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_admin_id uuid;
  v_admin_email text;
  v_caller_privilege_group text;
  v_authorized boolean;
  v_existing_id uuid;
  v_old_value boolean;
  v_permission_id uuid;
  v_audited boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL
    OR p_privilege_group IS NULL
    OR p_permission_key IS NULL
    OR p_is_enabled IS NULL
  THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  SELECT au.id, au.email, au.privilege_group
    INTO v_admin_id, v_admin_email, v_caller_privilege_group
  FROM public.admin_users AS au
  WHERE au.user_id = v_uid AND au.is_active = true;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Identical semantic to hasPermission(admin, "can_manage_admins")
  -- (lib/getCurrentAdminAccess.ts): super_admin always authorized;
  -- otherwise the caller's own privilege_group must itself hold an
  -- enabled can_manage_admins grant.
  v_authorized := v_caller_privilege_group = 'super_admin' OR EXISTS (
    SELECT 1
    FROM public.admin_privilege_group_permissions AS agp
    WHERE agp.privilege_group = v_caller_privilege_group
      AND agp.permission_key = 'can_manage_admins'
      AND agp.is_enabled = true
  );

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'not_authorized: can_manage_admins required' USING ERRCODE = '42501';
  END IF;

  -- Lock the target row (if any) for the rest of this transaction so a
  -- concurrent mutation of the identical (privilege_group,
  -- permission_key) pair cannot read a stale old_value out from under
  -- this call.
  SELECT id, is_enabled INTO v_existing_id, v_old_value
  FROM public.admin_privilege_group_permissions
  WHERE privilege_group = p_privilege_group AND permission_key = p_permission_key
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.admin_privilege_group_permissions
      (privilege_group, permission_key, is_enabled)
    VALUES
      (p_privilege_group, p_permission_key, p_is_enabled)
    RETURNING id INTO v_permission_id;
    v_old_value := false;
  ELSE
    UPDATE public.admin_privilege_group_permissions
    SET is_enabled = p_is_enabled
    WHERE id = v_existing_id;
    v_permission_id := v_existing_id;
  END IF;

  IF v_old_value IS DISTINCT FROM p_is_enabled THEN
    INSERT INTO public.admin_permission_audit
      (admin_user_id, admin_email, privilege_group, permission_key, old_value, new_value, action_id)
    VALUES
      (v_admin_id, v_admin_email, p_privilege_group, p_permission_key, v_old_value, p_is_enabled, p_action_id);
    v_audited := true;
  END IF;

  RETURN QUERY SELECT v_permission_id, v_old_value, p_is_enabled, v_audited;
END;
$$;

ALTER FUNCTION public.set_admin_privilege_group_permission(text, text, boolean, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_admin_privilege_group_permission(text, text, boolean, uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_admin_privilege_group_permission(text, text, boolean, uuid)
FROM anon;
REVOKE ALL ON FUNCTION public.set_admin_privilege_group_permission(text, text, boolean, uuid)
FROM service_role;

GRANT EXECUTE ON FUNCTION public.set_admin_privilege_group_permission(text, text, boolean, uuid)
TO authenticated;

-- Close the direct-write bypass this RPC replaces. SELECT is completely
-- untouched on both tables -- app/admin/permissions/page.tsx's own
-- load()/undoLastChange() reads and lib/server/adminAuthz.ts's
-- service-role read both keep working exactly as before; only INSERT/
-- UPDATE/DELETE move behind the governed RPC above. No other table's
-- grants are touched by this migration.
REVOKE INSERT, UPDATE, DELETE
ON TABLE public.admin_privilege_group_permissions
FROM authenticated, anon, service_role;

REVOKE INSERT, UPDATE, DELETE
ON TABLE public.admin_permission_audit
FROM authenticated, anon, service_role;

COMMIT;
