-- Vendors INSERT Authority -- Emergency Containment.
--
-- Confirmed defect (LEM Vendor Policy & Authority Reconciliation, Stage 1
-- Read-Only Audit, 2026-08-14): the tracked vendors_insert_policy (created
-- by 20260727120300_vendor_person_specific_access_foundation.sql) carries
-- no authority branch at all -- its WITH CHECK is only
-- length(trim(coalesce(business_name, name, ''))) > 0. Proven live in a
-- rolled-back transaction as part of that audit: an ordinary authenticated
-- caller with zero admin_users row and zero vendor_org_access row
-- successfully inserted a row into public.vendors. Any logged-in Supabase
-- user can create arbitrary global vendor-catalog entries today.
--
-- This is a narrow, forward-only containment repair, not the broader
-- authority reconciliation identified by that same audit. It deliberately
-- does not introduce a new authority model: is_active_admin(auth.uid()) is
-- known to be broader than the eventual desired can_manage_vendors
-- authority (which also needs to admit event_admin, per live
-- admin_privilege_group_permissions rows, and is not yet reproducible in
-- SQL -- reconciling it prematurely here would risk creating a third,
-- inconsistent permission system while trying to eliminate two). It is,
-- however, existing, already-deployed semantics (already the admin branch
-- of this same table's vendors_update_policy and vendors_select_policy)
-- and is sufficient to close the current ordinary-authenticated-user
-- vulnerability without prematurely designing that helper.
--
-- This migration replaces only vendors_insert_policy, following the
-- project's repair-forward convention (the already-applied July migration
-- that first created it is not edited). It does not touch
-- vendors_update_policy, vendors_select_policy, the undocumented "Admins
-- can manage vendors" or "Members can view active vendors" policies, any
-- grant, any helper function, /admin/vendors, /admin/imports, or vendor
-- self-registration -- register_vendor_self remains structurally
-- unaffected regardless, because its INSERT INTO public.vendors runs
-- inside a postgres-owned SECURITY DEFINER function, independent of any
-- RLS policy on the table. No new SQL helper is created here.

BEGIN;

DROP POLICY IF EXISTS vendors_insert_policy ON public.vendors;
CREATE POLICY vendors_insert_policy
  ON public.vendors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_admin(auth.uid())
    AND length(trim(coalesce(business_name, name, ''))) > 0
  );

COMMIT;
