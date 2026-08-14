-- Vendors Grant Hardening.
--
-- Confirmed defect (LEM Vendors Grant Consumer Audit, 2026-08-14):
-- public.vendors never received a table-level GRANT through any tracked
-- migration -- its current raw ACL was applied out-of-band, the same
-- drift pattern already reconciled for public.events,
-- public.admin_event_permissions, public.announcements, the five
-- Evaluation tables, and public.parking_sites/event_map_settings.
-- anon, authenticated, and service_role all hold an identical,
-- undifferentiated set (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER/MAINTAIN), independent of what any RLS policy or
-- any actual consumer requires.
--
-- Consumer audit (repository-wide, exhaustive grep of every
-- .from("vendors") call and every migration/RPC touching
-- public.vendors) found:
--
--   * authenticated SELECT/INSERT/UPDATE: required. Direct-table
--     consumers currently shipped: app/admin/imports/page.tsx
--     (loadVendors/createVendor/saveEditedVendor), app/admin/vendors/
--     page.tsx (list/create/update), app/member/vendor-signup/page.tsx
--     and app/member/page.tsx (embedded reads), app/admin/
--     vendor-requests/page.tsx (embedded read), and the vendor profile
--     PATCH route (app/api/vendor/workspace/profile/route.ts), which as
--     of the RLS-Governed PATCH Cutover mutates public.vendors through
--     an authenticated token-bound client so that
--     public.vendors_update_policy is the real, database-enforced
--     authority check. All left untouched here.
--
--   * authenticated DELETE/TRUNCATE: zero consumers found anywhere in
--     the repository. No UI or API path issues a DELETE against
--     public.vendors (every vendor-adjacent .delete() call targets
--     event_vendors, event_import_rows, or attendee_activities
--     instead). Removed.
--
--   * anon INSERT/UPDATE/DELETE/TRUNCATE: zero consumers, and no
--     permissive RLS policy on public.vendors grants anon any mutation
--     command in the first place -- these privileges were already
--     inert for INSERT/UPDATE/DELETE (RLS denies by default with no
--     applicable policy) and were the one live, ungated exposure for
--     TRUNCATE, which Postgres never subjects to RLS regardless of
--     policy. Removed.
--
--   * anon SELECT: left untouched. It is currently exercised only
--     through an undocumented live policy ("Members can view active
--     vendors", USING (is_active = true)) that predates and is not
--     present in any tracked migration -- no live anon-reachable
--     consumer of public.vendors was found in the current application
--     (every confirmed consumer sits behind AdminRouteGuard,
--     MemberRouteGuard, or a service-role backend route). Deciding
--     whether that policy's public/member vendor-directory intent is
--     still wanted is a governance question, not a grant-hygiene one --
--     it is deliberately deferred to the separate public-vendor-read-
--     policy governance review (alongside the other undocumented
--     policy, "Admins can manage vendors", and is_active_admin()
--     reconciliation), not decided by this migration.
--
--   * service_role SELECT: required. Direct-table read consumers
--     currently shipped: app/api/admin/vendors/invitations/route.ts,
--     app/api/vendor/workspace/profile/route.ts (GET only -- PATCH no
--     longer uses service_role, per the RLS-Governed PATCH Cutover),
--     app/api/vendor/workspace/summary/route.ts, and
--     app/api/email/send/route.ts. Left untouched.
--
--   * service_role INSERT/UPDATE/DELETE/TRUNCATE: zero direct-table
--     consumers. The one write that might appear to need service_role
--     INSERT -- vendor self-registration -- does not: register_vendor_
--     self (20260805120000_create_atomic_vendor_self_registration.sql)
--     is SECURITY DEFINER and owned by postgres, so its internal
--     INSERT INTO public.vendors runs with the function owner's
--     privileges, not the invoking role's table grants. service_role
--     only ever needs, and already separately holds, EXECUTE on that
--     RPC. service_role's rolbypassrls=true is a separate control from
--     table ACL privilege, confirmed live (a role attribute, not a
--     substitute for REVOKE) -- it is why service_role's grant matters
--     at all despite RLS being enabled on public.vendors: RLS never
--     applies to service_role, so the table grant was its only control,
--     and until this migration that control was fully open. Removed.
--
-- This migration removes only the unused mutation privileges named
-- above. It does not touch SELECT, REFERENCES, TRIGGER, or MAINTAIN --
-- matching the established hardening precedent (Evaluations,
-- Map/Parking), which limits itself to consumer-backed mutation
-- privileges and leaves the DDL-adjacent set alone. It does not touch
-- any RLS policy, any helper function, any RPC, any schema, or the
-- application; it adds no GRANT. No Lifecycle guard or Authority task
-- key is introduced -- out of scope for a grant-only pass.

BEGIN;

-- ============================================================
-- anon never had a legitimate mutation path on public.vendors: no
-- permissive RLS policy names anon for INSERT/UPDATE/DELETE, and
-- TRUNCATE is never RLS-governed at all. SELECT is deliberately left
-- untouched pending the separate public-vendor-read-policy governance
-- review (see header).
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendors
FROM anon;

-- ============================================================
-- authenticated's SELECT/INSERT/UPDATE are required by currently
-- shipped direct-table consumers (admin vendor library management, the
-- member vendor-signup/dashboard reads, and the RLS-governed vendor
-- profile PATCH) and are left untouched. DELETE/TRUNCATE have zero
-- consumers anywhere in the repository.
-- ============================================================

REVOKE DELETE, TRUNCATE
ON TABLE public.vendors
FROM authenticated;

-- ============================================================
-- service_role's SELECT is required by existing backend read
-- consumers (vendor invitations, workspace profile GET, workspace
-- summary, and the vendor-request notification email lookup) and is
-- left untouched. INSERT/UPDATE/DELETE/TRUNCATE have zero direct-table
-- consumers; vendor self-registration's write runs inside the
-- postgres-owned SECURITY DEFINER register_vendor_self RPC and is
-- structurally unaffected by this REVOKE. Because service_role carries
-- rolbypassrls=true, this table grant was its only control -- removing
-- it is what actually closes the door.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendors
FROM service_role;

COMMIT;
