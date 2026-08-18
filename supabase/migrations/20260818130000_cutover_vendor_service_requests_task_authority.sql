-- Vendor Requests Backend Authority Reconciliation.
--
-- Problem: /admin/vendor-requests (app/admin/vendor-requests/page.tsx)
-- uses the semantically wrong requiredPermission="can_manage_events"
-- route gate, but the real, database-side gap is broader still:
-- vendor_service_requests_admin_all_policy authorizes every Admin action
-- (SELECT/INSERT/UPDATE/DELETE, via FOR ALL) with
-- public.is_active_admin(auth.uid()) alone -- any active admin, for any
-- Event's requests, with no Event or Tenant scoping of any kind. The same
-- broad predicate also appears as one OR-branch of
-- vendor_service_requests_authenticated_select_policy.
--
-- INVENTORY (repository-wide, before any edit):
--
--   Schema: vendor_service_requests.event_id is a real FK
--   (REFERENCES public.events(id) ON DELETE CASCADE, baseline). The only
--   live write path that sets it -- public.submit_my_vendor_service_request
--   (20260804160000) -- requires p_event_id NOT NULL and independently
--   re-verifies it against the caller's Tenant before insert; the Admin
--   page itself never inserts. There is no tenant_id column on this table
--   directly -- Tenant is always reached through events.tenant_id, exactly
--   as the canonical task resolver (resolve_task_authority) already does
--   for every other event.*-scoped table.
--
--   Admin actions (app/admin/vendor-requests/page.tsx, read in full):
--   list/view (SELECT ... WHERE event_id = <admin's current working
--   Event>, always single-Event), status change (UPDATE request_status
--   only, single row and bulk-by-vendor) -- covers new/contacted/
--   confirmed/completed/cancelled, i.e. every approve/reject/status
--   transition this page performs. No delete, no vendor
--   reassignment/linking, no notes/metadata edit exists in this file.
--   event.vendors.manage (event-scoped, mutation-kind, already
--   platform_inherits/tenant_inherits=true, already adopted for
--   /admin/vendors) is the correct capability for every one of these
--   actions -- there is no separate view-only mode to preserve.
--
--   Other consumers, all confirmed to bypass this table's RLS entirely or
--   never read/write it directly, so none are affected by this migration:
--     * app/api/email/send/route.ts -- service-role client
--       (SUPABASE_SERVICE_ROLE_KEY), plus its own, already Event-scoped
--       (row event_id, not ambient working Event) admin_event_access
--       check. Out of scope, unaffected.
--     * app/api/member/vendor-requests/route.ts -- calls only the three
--       governed SECURITY DEFINER RPCs (submit_my_vendor_service_request,
--       set_my_vendor_service_request_status,
--       get_my_vendor_service_requests); never a direct table read.
--     * app/api/vendor/workspace/requests/route.ts,
--       app/api/vendor/workspace/summary/route.ts -- service-role client,
--       vendor_org_access-based authorization.
--   None of these call the admin_all policy's is_active_admin branch or
--   depend on it in any way.
--
-- Fix, modeled directly on the already-proven cutover pattern used for
-- event_locations/event_nearby_places (20260811230000) and Print/Imports
-- (20260811240000/20260811250000): replace the single blanket FOR ALL
-- admin policy with per-command policies whose USING/WITH CHECK evaluate
-- public.has_event_task_authority('event.vendors.manage', event_id)
-- against each row's OWN event_id -- never the caller's current admin
-- working Event, and never a table-wide grant. WITH CHECK is supplied on
-- both INSERT and UPDATE so a caller cannot smuggle a different (and
-- differently-authorized) event_id into either operation; USING protects
-- which existing rows an UPDATE/DELETE may even reach. The same swap is
-- made to the admin branch of the existing combined SELECT policy; its
-- member self-service branch (is_my_vendor_service_request) is reproduced
-- verbatim and completely unchanged -- Vendor/self-service access is not
-- touched by this migration in any way.
--
-- Command coverage (INSERT/UPDATE/DELETE, SELECT) is preserved exactly as
-- the prior FOR ALL policy already granted -- this migration reconciles
-- the authority basis only, narrowing neither which commands an
-- authorized admin may perform nor widening who may perform them. A row
-- with a NULL event_id (not currently possible through any live write
-- path, per the inventory above) would fail has_event_task_authority's
-- own missing_input branch and become admin-inaccessible under every
-- policy here -- a fail-closed change, never fail-open.

BEGIN;

DROP POLICY IF EXISTS vendor_service_requests_admin_all_policy ON public.vendor_service_requests;

CREATE POLICY vendor_service_requests_admin_insert_policy
  ON public.vendor_service_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_event_task_authority('event.vendors.manage', event_id));

CREATE POLICY vendor_service_requests_admin_update_policy
  ON public.vendor_service_requests
  FOR UPDATE
  TO authenticated
  USING (public.has_event_task_authority('event.vendors.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.vendors.manage', event_id));

CREATE POLICY vendor_service_requests_admin_delete_policy
  ON public.vendor_service_requests
  FOR DELETE
  TO authenticated
  USING (public.has_event_task_authority('event.vendors.manage', event_id));

DROP POLICY IF EXISTS vendor_service_requests_authenticated_select_policy ON public.vendor_service_requests;
CREATE POLICY vendor_service_requests_authenticated_select_policy
  ON public.vendor_service_requests
  FOR SELECT
  TO authenticated
  USING (
    public.has_event_task_authority('event.vendors.manage', event_id)
    OR public.is_my_vendor_service_request(vendor_service_requests.id)
  );

COMMIT;
