-- Vendor Admission Lifecycle -- Stage 3: Retire the legacy event_vendors
-- direct-write bypass.
--
-- Confirmed live (inspected before writing this migration, not assumed):
-- four RLS policies exist on public.event_vendors --
--
--   * "Admins can manage event vendors" (FOR ALL, is_active_admin(auth.
--     uid())) -- UNTRACKED, absent from every migration file. Same
--     out-of-band-policy drift pattern already found and removed on
--     public.vendors (20260814080000).
--   * event_vendors_admin_write_policy (FOR ALL, is_active_admin(auth.
--     uid())) -- tracked, created by 20260727120300_vendor_person_
--     specific_access_foundation.sql, never modified since.
--   * event_vendors_select_policy (SELECT, is_active_admin(auth.uid())
--     OR own vendor_org_access OR is_visible_to_members) -- tracked, same
--     origin migration.
--   * "Members can view visible event vendors" (SELECT, anon+
--     authenticated, is_visible_to_members = true) -- UNTRACKED, but a
--     read-only, non-mutation, member/public-discovery policy --
--     unrelated to admin mutation governance and explicitly preserved
--     unchanged in this migration.
--
-- Live grants (inspected before writing this migration): anon,
-- authenticated, and service_role each hold the full blanket ACL
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) -- the same
-- out-of-band default-privilege pattern already found and hardened on
-- public.vendors, the Evaluation tables, and the Map/Parking tables.
-- Direct-consumer inventory (repository-wide grep, performed before this
-- migration): service_role's only live use of public.event_vendors is a
-- SELECT in app/api/vendor/workspace/notices/route.ts and app/api/
-- vendor/workspace/summary/route.ts -- no service_role mutation exists
-- anywhere. authenticated's SELECT is required by event_vendors_select_
-- policy's three branches and by the member dashboard (app/member/
-- page.tsx). anon's SELECT is required by "Members can view visible
-- event vendors". No role has any legitimate INSERT/UPDATE/DELETE/
-- TRUNCATE consumer remaining after this migration: the last direct
-- writers (app/admin/vendors/page.tsx, app/admin/imports/page.tsx) are
-- replaced by the governed Stage 2 RPCs in this same Stage 3 delivery
-- (application-code changes, tracked separately from this migration).
--
-- This migration, in one transaction:
--
--   1. Drops "Admins can manage event vendors" outright (untracked,
--      fully redundant with event_vendors_admin_write_policy, removed
--      rather than captured -- same treatment as vendors' equivalent).
--   2. Drops event_vendors_admin_write_policy outright and does NOT
--      replace it with any direct-write policy, including one gated on
--      event.vendors.manage. Admission/rejection/revocation are
--      multi-row, disposition-generating, audit-carrying operations --
--      exactly the class of operation this repository already reserves
--      for governed SECURITY DEFINER RPCs (register_vendor_self,
--      submit_my_vendor_service_request, and now admit_vendor_for_event/
--      reject_vendor_event_candidacy/revoke_vendor_admission
--      themselves). A direct-write RLS policy, however narrowly
--      authorized, would let a client bypass the disposition/application
--      synchronization those RPCs exist to guarantee -- exactly the
--      failure mode Stage 3 exists to close. After this migration,
--      public.event_vendors carries zero INSERT/UPDATE/DELETE policy of
--      any kind; the four Stage 2 RPCs (SECURITY DEFINER, owned by
--      postgres) remain able to write it because RLS does not apply to
--      the table owner, exactly like register_vendor_self already writes
--      public.vendors today.
--   3. Replaces only the is_active_admin(auth.uid()) branch of
--      event_vendors_select_policy with public.has_event_task_authority(
--      'event.vendors.view', event_vendors.event_id) -- the canonical
--      EA/TA/SA-inheriting resolver. The other two branches (own
--      vendor_org_access, is_visible_to_members) are preserved verbatim.
--   4. Leaves "Members can view visible event vendors" completely
--      untouched -- a separate, legitimate member/public-discovery
--      product behavior, not part of admin mutation governance.
--
-- Grant hardening (same transaction): REVOKE INSERT, UPDATE, DELETE,
-- TRUNCATE from anon, authenticated, and service_role. SELECT is left
-- untouched for all three (each has a live, legitimate reader, listed
-- above). REFERENCES and TRIGGER are left untouched, matching the
-- established precedent on vendors/Evaluations/Map-Parking (DDL-only
-- privileges, out of this pass's scope) -- not re-applying the stricter
-- standard used for the brand-new Stage 1 lifecycle tables, since this
-- migration's explicit brief is INSERT/UPDATE/DELETE/TRUNCATE only.

BEGIN;

DROP POLICY IF EXISTS "Admins can manage event vendors" ON public.event_vendors;
DROP POLICY IF EXISTS event_vendors_admin_write_policy ON public.event_vendors;

DROP POLICY IF EXISTS event_vendors_select_policy ON public.event_vendors;
CREATE POLICY event_vendors_select_policy
  ON public.event_vendors
  FOR SELECT
  TO authenticated
  USING (
    public.has_event_task_authority('event.vendors.view', event_vendors.event_id)
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access AS voa
      WHERE voa.vendor_id = event_vendors.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
    OR (is_visible_to_members IS NOT FALSE)
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.event_vendors
FROM anon, authenticated, service_role;

COMMIT;
