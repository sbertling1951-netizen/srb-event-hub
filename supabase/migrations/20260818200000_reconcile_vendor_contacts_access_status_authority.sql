-- Vendor Contacts / Vendor Org Access / Vendor Event Status -- Admin
-- Authority Reconciliation.
--
-- Candidate #3 of the Admin authority/governance prioritization pass (same
-- series as 20260818150000, 20260818180000, 20260818190000). All three
-- tables' Admin OR-branch still reads public.is_active_admin(auth.uid()) --
-- true for ANY active admin_users row regardless of privilege_group,
-- admin_event_access assignment, or admin_tenant_access grant -- the exact
-- unscoped-predicate defect already reconciled table-by-table across this
-- series.
--
-- AUDIT-FIRST: these three tables do NOT share one authority boundary.
--
--   * vendor_contacts (vendor_id only, no event_id/tenant_id column at
--     all) and vendor_org_access (vendor_id, vendor_contact_id,
--     auth_user_id, person_id; invited_for_event_id is nullable
--     provenance metadata on a *pending-invitation* row, not a scope --
--     an accepted vendor_org_access row's authority governs the vendor
--     org's access as a whole, across every Event it is later admitted
--     to) are structurally identical in shape to public.vendors itself:
--     vendor-catalog-owned data with no Tenant/Event column to scope
--     against. public.vendors' own Admin branch was already reconciled to
--     public.has_my_vendor_catalog_admin_authority() (20260814080000,
--     20260818110000/120000) -- the self-scoped wrapper around
--     public.has_vendor_catalog_admin_authority(uuid), which reproduces
--     the application's exact legacy can_manage_vendors semantics
--     (super_admin unconditional, event_admin default-true, every other
--     privilege_group default-false, per-group override table). Cross-
--     Tenant/cross-Event breadth for an event_admin here is INTENTIONAL,
--     proven so by that helper's own migration history, and is the
--     already-accepted shared Vendor Catalog boundary -- not a new
--     defect introduced or widened by this migration. These two tables
--     are reconciled onto that exact same helper: the identical boundary
--     already governing the vendor row each of their own vendor_id
--     foreign keys.
--   * vendor_event_status (vendor_id AND event_id, both NOT NULL) is
--     genuinely Event-scoped admission/status data -- structurally
--     identical in shape to vendor_service_requests (event_id NOT NULL
--     FK), already reconciled onto public.has_event_task_authority(
--     'event.vendors.manage', event_id) in 20260818130000, and to
--     event_vendors' own SELECT policy, already live on
--     'event.vendors.view'. 'event.vendors.manage' /
--     'event.vendors.view' are both already registered, active task keys
--     (platform_inherits=true, tenant_inherits=true,
--     event_assignment_grantable=true; 20260811170000), so no new
--     capability, role, or Tenant policy decision is invented here. This
--     table's Admin branch has never had a read/write task-key split
--     (all four commands share one is_active_admin predicate today), so
--     -- mirroring the vendor_service_requests precedent's own reasoning
--     for the identical "no separate view-only mode" shape -- SELECT is
--     reconciled onto 'event.vendors.manage' too, the same key used for
--     INSERT/UPDATE/DELETE, rather than inventing a view/manage split no
--     caller requires.
--
-- Neither replacement is invented here: both
-- has_my_vendor_catalog_admin_authority() and has_event_task_authority
-- already exist, are already live, and already govern the structurally
-- identical sibling tables (vendors; vendor_service_requests/
-- event_vendors) each of these three tables' own vendor_id/event_id FK
-- points at. This is architecture option A (vendor_contacts,
-- vendor_org_access) plus option B (vendor_event_status) from the audit
-- brief, not option D -- no missing abstraction, no new role/Tenant
-- policy decision required.
--
-- CALLER MATRIX (repository-wide grep, before any edit):
--
--   * app/api/admin/vendors/invitations/route.ts -- the only Admin
--     surface touching vendor_contacts/vendor_org_access directly --
--     uses getSupabaseAdminClient() (service-role, RLS-bypassing) and is
--     gated entirely by adminHasPermission(admin, "can_manage_vendors")
--     at the application layer, the same preset
--     has_vendor_catalog_admin_authority reproduces. Unaffected by this
--     migration; its own guard is already equivalent to the RLS
--     predicate being installed here.
--   * app/api/vendor/session/route.ts, lib/server/vendorAccess.ts
--     (resolveVendorAccessFromCookies, shared by every vendor workspace
--     route), app/api/vendor/workspace/contacts/route.ts,
--     app/api/vendor/workspace/notices/route.ts,
--     app/api/vendor/workspace/summary/route.ts -- all vendor self-
--     service, all service-role, all scoped at the application layer by
--     the caller's own resolved vendor_org_access row(s). None reads or
--     writes these tables through RLS; none is affected by this
--     migration.
--   * app/member/page.tsx, app/member/vendor-signup/page.tsx -- browser-
--     side (RLS-bound) SELECT of vendor_event_status only, filtered to
--     event_id + vendor_ids already drawn from a visible event_vendors
--     row. Served by this table's unchanged is_visible_to_members branch,
--     never the Admin branch. Unaffected.
--   * No admin/ page or route (app/admin/**) references vendor_contacts,
--     vendor_org_access, or vendor_event_status at all -- confirmed by
--     repository-wide grep. The is_active_admin branch on all three
--     tables is, today, unexercised by any known live caller; this
--     migration closes a live database-level authorization-oracle gap
--     with zero behavioral change to any current application code path.
--
-- LIVE-DATABASE ACCESS-DELTA (verified against the linked project via
-- `supabase db query --linked`, 2026-08-18): current active admin roster
-- is 2 super_admin, 8 event_admin, 1 checkin; 1 Tenant, 6 Events, zero
-- admin_tenant_access rows (no Tenant Admin exists today).
--
--   * vendor_contacts / vendor_org_access (catalog-wide, not
--     per-row-scoped): is_active_admin allows all 11 active admins.
--     has_vendor_catalog_admin_authority (via the self-scoped wrapper)
--     allows 10 -- 2 super_admin (unconditional) + 8 event_admin (no
--     admin_privilege_group_permissions override row exists for
--     can_manage_vendors on any other group, live-verified). The single
--     admin lost is the one active checkin-privilege-group admin -- an
--     intended narrowing, identical in kind to the one already accepted
--     and documented for public.vendors itself in 20260814080000.
--   * vendor_event_status (event_id-scoped): is_active_admin allows all
--     11 x 6 = 66 (admin, Event) pairs unconditionally, with zero regard
--     for any admin_event_access assignment.
--     has_event_task_authority('event.vendors.manage', event_id) allows
--     23 -- 12 from the 2 super_admin (platform_inherits, every Event) +
--     11 from the 8 event_admin, each carrying an already-materialized
--     event.vendors.manage grant for every Event they hold an
--     admin_event_access row for (live-verified: 11 of 11 such rows
--     already carry the grant, 0 gained) + 0 from the checkin admin
--     (their one admin_event_access row carries no event.vendors.manage
--     or event.vendors.view grant, live-verified -- the checkin profile
--     bundle does not include vendor task authority, mirroring the
--     agenda_items precedent). All 43 lost pairs are (admin, Event)
--     combinations with no admin_event_access assignment for that
--     specific Event at all -- an Event Admin scoped to one Event
--     currently has full SELECT/INSERT/UPDATE/DELETE on every other
--     Event's vendor_event_status rows through this table, the same
--     shape already reconciled on attendees/household_members/
--     attendee_activities/agenda_items.
--
-- Fix: on every policy below, only the is_active_admin(auth.uid()) OR-
-- branch is replaced (with has_my_vendor_catalog_admin_authority() for
-- vendor_contacts/vendor_org_access, has_event_task_authority(
-- 'event.vendors.manage', event_id) for vendor_event_status). Every other
-- branch -- the vendor-self-management EXISTS(vendor_org_access ...)
-- branch on every policy, and the event_vendors/is_visible_to_members
-- branch on vendor_event_status_select_policy -- is preserved byte-for-
-- byte, unchanged.

BEGIN;

-- ============================================================
-- vendor_contacts: catalog-wide Admin authority. Self-management branch
-- (active vendor_org_access, access_role restriction where the live
-- policy already had one) preserved verbatim.
-- ============================================================

DROP POLICY IF EXISTS vendor_contacts_insert_policy ON public.vendor_contacts;
CREATE POLICY vendor_contacts_insert_policy
  ON public.vendor_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_my_vendor_catalog_admin_authority()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  );

DROP POLICY IF EXISTS vendor_contacts_select_policy ON public.vendor_contacts;
CREATE POLICY vendor_contacts_select_policy
  ON public.vendor_contacts
  FOR SELECT
  TO authenticated
  USING (
    public.has_my_vendor_catalog_admin_authority()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

DROP POLICY IF EXISTS vendor_contacts_update_policy ON public.vendor_contacts;
CREATE POLICY vendor_contacts_update_policy
  ON public.vendor_contacts
  FOR UPDATE
  TO authenticated
  USING (
    public.has_my_vendor_catalog_admin_authority()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  )
  WITH CHECK (
    public.has_my_vendor_catalog_admin_authority()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  );

-- ============================================================
-- vendor_org_access: catalog-wide Admin authority. Self-access branches
-- (auth_user_id = auth.uid(), is_vendor_org_admin) preserved verbatim.
-- No self-service branch existed on the two admin-only write policies
-- before this migration; none is added now -- self-service acceptance of
-- a pending invitation is a separate, governed SECURITY DEFINER RPC path,
-- untouched here.
-- ============================================================

DROP POLICY IF EXISTS vendor_org_access_admin_insert_policy ON public.vendor_org_access;
CREATE POLICY vendor_org_access_admin_insert_policy
  ON public.vendor_org_access
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_my_vendor_catalog_admin_authority());

DROP POLICY IF EXISTS vendor_org_access_select_policy ON public.vendor_org_access;
CREATE POLICY vendor_org_access_select_policy
  ON public.vendor_org_access
  FOR SELECT
  TO authenticated
  USING (
    public.has_my_vendor_catalog_admin_authority()
    OR auth_user_id = auth.uid()
    OR public.is_vendor_org_admin(vendor_id, auth.uid())
  );

DROP POLICY IF EXISTS vendor_org_access_admin_update_policy ON public.vendor_org_access;
CREATE POLICY vendor_org_access_admin_update_policy
  ON public.vendor_org_access
  FOR UPDATE
  TO authenticated
  USING (public.has_my_vendor_catalog_admin_authority())
  WITH CHECK (public.has_my_vendor_catalog_admin_authority());

-- ============================================================
-- vendor_event_status: Event-scoped canonical task authority
-- ('event.vendors.manage', matching the table's own event_id on every
-- row -- never a caller-supplied or ambient value). Vendor self-service
-- branch (active vendor_org_access, no access_role restriction -- any
-- active org member may manage their own vendor's event status) and the
-- member-visibility branch on SELECT are preserved verbatim.
-- ============================================================

DROP POLICY IF EXISTS vendor_event_status_delete_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_delete_policy
  ON public.vendor_event_status
  FOR DELETE
  TO authenticated
  USING (
    public.has_event_task_authority('event.vendors.manage', event_id)
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

DROP POLICY IF EXISTS vendor_event_status_insert_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_insert_policy
  ON public.vendor_event_status
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_event_task_authority('event.vendors.manage', event_id)
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

DROP POLICY IF EXISTS vendor_event_status_select_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_select_policy
  ON public.vendor_event_status
  FOR SELECT
  TO authenticated
  USING (
    public.has_event_task_authority('event.vendors.manage', event_id)
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_vendors ev
      WHERE ev.vendor_id = vendor_event_status.vendor_id
        AND ev.event_id = vendor_event_status.event_id
        AND ev.is_visible_to_members IS NOT FALSE
    )
  );

DROP POLICY IF EXISTS vendor_event_status_update_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_update_policy
  ON public.vendor_event_status
  FOR UPDATE
  TO authenticated
  USING (
    public.has_event_task_authority('event.vendors.manage', event_id)
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  )
  WITH CHECK (
    public.has_event_task_authority('event.vendors.manage', event_id)
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

COMMIT;
