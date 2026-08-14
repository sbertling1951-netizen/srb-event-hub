-- Vendor Catalog Authority -- Canonical Reconciliation.
--
-- Prior stages: the RLS-Governed PATCH Cutover (20260814000000-area work),
-- Vendors Grant Hardening (20260814060000), and the Vendor Catalog INSERT
-- Authority Emergency Containment (20260814070000) closed the arbitrary-
-- authenticated-user INSERT hole using is_active_admin(auth.uid()) as a
-- deliberately interim boundary -- known broader than the application's
-- actual can_manage_vendors semantics, but sufficient to stop the
-- immediate bleeding without inventing authority prematurely.
--
-- The follow-up Permission Semantics Audit (read-only, 2026-08-14) then
-- proved can_manage_vendors's exact application semantics by tracing both
-- lib/getCurrentAdminAccess.ts (client) and lib/server/adminAuthz.ts
-- (server), byte-comparing their hardcoded presets (identical), and
-- confirming via the live admin_privilege_group_permissions_unique
-- constraint that both implementations are provably equivalent, not just
-- observed-equivalent:
--
--   * super_admin: always true, unconditionally -- the application's
--     isSuperAdmin check short-circuits before any override lookup, so an
--     explicit false override row for super_admin (none exists live
--     today) would have no effect either.
--   * event_admin: true by hardcoded default; an explicit
--     admin_privilege_group_permissions row for (event_admin,
--     can_manage_vendors) with is_enabled=false would revoke it; absence
--     of a row means the true default stands.
--   * every other privilege_group (checkin, parking, content_admin,
--     read_only, any unrecognized/null group, which the application
--     coalesces to read_only): false by hardcoded default; an explicit
--     is_enabled=true row would grant it.
--
-- This migration introduces has_vendor_catalog_admin_authority(uuid), a
-- narrowly-scoped SQL helper reproducing exactly that logic for exactly
-- this one permission key. It deliberately does not encode the full
-- ~17-key x 6-group TypeScript preset matrix -- only the single boolean
-- default (true for event_admin, false for every other non-super_admin
-- group) that can_manage_vendors specifically resolves to, plus a live
-- read of the one relevant override row when one exists. It is
-- SECURITY DEFINER: admin_privilege_group_permissions carries exactly one
-- live policy ("Admins can manage privilege permissions", FOR ALL,
-- restricted to privilege_group='super_admin' only) -- an invoker-rights
-- function called by a non-super-admin event_admin or checkin admin would
-- have that table's own override row hidden from it by RLS, silently
-- breaking the override-lookup semantics this helper exists to
-- reproduce. SECURITY DEFINER (owned by postgres, confirmed live to carry
-- rolbypassrls-equivalent table ownership exemption from that table's
-- RLS) is therefore a correctness requirement here, not a style choice,
-- confirmed by direct inspection of admin_privilege_group_permissions'
-- live policy before writing this function.
--
-- Atomic policy reconciliation (same transaction, per the proven
-- permissive-policy OR-bypass finding: leaving the undocumented "Admins
-- can manage vendors" ALL policy in place would silently bypass any
-- narrower replacement on vendors_insert_policy/vendors_update_policy,
-- exactly as proven live during the emergency containment's admin+empty-
-- name test):
--
--   * DROP the undocumented, untracked "Admins can manage vendors" ALL
--     policy outright. It was already fully redundant with
--     vendors_update_policy/vendors_select_policy's own admin branch for
--     UPDATE/SELECT, contributed nothing to INSERT (vendors_insert_policy
--     is the binding check there), and was the sole source of DELETE
--     authority for an operation proven to have zero live consumers
--     across two separate audits. Not captured, not narrowed in place --
--     removed, since its authority is fully subsumed by the reconciled
--     tracked policies below and no DELETE policy is being added.
--   * vendors_insert_policy: replace the interim
--     is_active_admin(auth.uid()) branch (20260814070000) with
--     has_vendor_catalog_admin_authority(auth.uid()), AND'd with the
--     unchanged non-empty business/name check.
--   * vendors_update_policy: replace only the admin OR-branch with
--     has_vendor_catalog_admin_authority(auth.uid()); the vendor-self-
--     management branch (active vendor_org_access, access_role=
--     'vendor_admin') is preserved verbatim, unchanged, in both USING and
--     WITH CHECK.
--   * vendors_select_policy: replace only its is_active_admin(auth.uid())
--     branch the same way; its own-vendor_org_access and event_vendors-
--     visibility branches are preserved verbatim. This does narrow what a
--     checkin/parking/content_admin/read_only-privilege_group admin can
--     see through /admin/vendors, /admin/imports, and
--     /admin/vendor-requests (their embedded SELECT queries will now
--     return only vendor_org_access-linked or event-visible rows for such
--     an admin, not the full catalog) -- a real, foreseeable, and
--     intended consequence of aligning SELECT with the same authority
--     boundary as INSERT/UPDATE, not an accidental one; it does not
--     change any non-admin (member, vendor-contact) branch, which is
--     preserved unchanged.
--
-- Explicitly not touched in this migration: "Members can view active
-- vendors" (left completely unchanged, per its own separate, still-open
-- governance question about public vendor-discovery intent); any DELETE
-- policy (none existed for vendors_insert_policy/vendors_update_policy's
-- family beyond the now-removed ALL policy, and none is added here);
-- table-level grants on public.vendors (unchanged from
-- 20260814060000_harden_vendors_table_grants.sql -- only a function
-- EXECUTE grant, not a table grant, is added here); vendor self-
-- registration (register_vendor_self remains a postgres-owned SECURITY
-- DEFINER RPC, structurally independent of every policy touched here);
-- and the still-open application-layer gaps on /admin/vendors and
-- /admin/imports (no permission check on the former, the wrong permission
-- key on the latter) -- the database now protects against both
-- regardless, but the UI repair is separate, deliberately deferred work.

BEGIN;

-- ============================================================
-- Narrow authority helper for the global vendor catalog only.
-- Reproduces can_manage_vendors's exact application semantics for this
-- one permission key -- see header for the full derivation.
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_vendor_catalog_admin_authority(_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_privilege_group text;
  v_override boolean;
BEGIN
  IF _uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT coalesce(au.privilege_group, 'read_only') INTO v_privilege_group
  FROM public.admin_users AS au
  WHERE au.user_id = _uid
    AND au.is_active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Matches the application's isSuperAdmin bypass exactly: unconditional,
  -- evaluated before any override lookup.
  IF v_privilege_group = 'super_admin' THEN
    RETURN true;
  END IF;

  SELECT agpp.is_enabled INTO v_override
  FROM public.admin_privilege_group_permissions AS agpp
  WHERE agpp.privilege_group = v_privilege_group
    AND agpp.permission_key = 'can_manage_vendors';

  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- No override row: fall back to the one hardcoded default this helper
  -- reproduces for this one key -- true for event_admin only.
  RETURN v_privilege_group = 'event_admin';
END;
$$;

REVOKE ALL ON FUNCTION public.has_vendor_catalog_admin_authority(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_vendor_catalog_admin_authority(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_vendor_catalog_admin_authority(uuid) TO authenticated;

-- ============================================================
-- Remove the undocumented, untracked ALL policy that would otherwise
-- permissive-OR-bypass every narrower replacement below.
-- ============================================================

DROP POLICY IF EXISTS "Admins can manage vendors" ON public.vendors;

-- ============================================================
-- vendors_insert_policy: canonical catalog authority replaces the interim
-- is_active_admin(auth.uid()) branch from 20260814070000. Non-empty-name
-- check unchanged.
-- ============================================================

DROP POLICY IF EXISTS vendors_insert_policy ON public.vendors;
CREATE POLICY vendors_insert_policy
  ON public.vendors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_vendor_catalog_admin_authority(auth.uid())
    AND length(trim(coalesce(business_name, name, ''))) > 0
  );

-- ============================================================
-- vendors_update_policy: canonical catalog authority OR the unchanged
-- vendor-self-management branch (active vendor_org_access,
-- access_role='vendor_admin').
-- ============================================================

DROP POLICY IF EXISTS vendors_update_policy ON public.vendors;
CREATE POLICY vendors_update_policy
  ON public.vendors
  FOR UPDATE
  TO authenticated
  USING (
    public.has_vendor_catalog_admin_authority(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  )
  WITH CHECK (
    public.has_vendor_catalog_admin_authority(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  );

-- ============================================================
-- vendors_select_policy: canonical catalog authority replaces the
-- is_active_admin(auth.uid()) branch; own-vendor_org_access and
-- event_vendors-visibility branches unchanged.
-- ============================================================

DROP POLICY IF EXISTS vendors_select_policy ON public.vendors;
CREATE POLICY vendors_select_policy
  ON public.vendors
  FOR SELECT
  TO authenticated
  USING (
    public.has_vendor_catalog_admin_authority(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_vendors ev
      WHERE ev.vendor_id = vendors.id
        AND ev.is_visible_to_members IS NOT FALSE
    )
  );

COMMIT;
