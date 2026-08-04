-- Admin authority is governed through authenticated, server-side management
-- paths. Browser roles must not create or alter admin_users directly.
--
-- Governed migration-history exception: these four named policies predate
-- this repository's migration history -- no migration here ever creates
-- them, so each was established directly in the linked production database
-- before migration-based tracking began (the same pattern already repaired
-- in 20260731120100_secure_events_rls.sql,
-- 20260731120200_create_tenant_hostname_mappings.sql, and
-- 20260801120600_close_member_checkin_direct_write_bypasses.sql). Two of
-- these ("Admins can update themselves", "Admins can update admins") had no
-- WITH CHECK clause narrower than their USING clause, so a caller matching
-- USING could rewrite any column of their own (or, for the second policy,
-- any) admin_users row -- including privilege_group and is_super_admin --
-- a client-controlled self-elevation path this migration exists to close,
-- per the "Administrators cannot elevate ... their own Authority through a
-- client-controlled direct-table write" requirement. An unconditional DROP
-- POLICY only succeeds where that pre-existing object happens to be
-- present; on a fresh replay, where none of these policies exist, the same
-- statements fail. The fix generalizes the same intent -- "these named
-- policies must not exist afterward" -- so it succeeds whether or not each
-- policy was already present, while still guaranteeing the same end state
-- either way: no authenticated self-service or super-admin-only direct
-- INSERT/UPDATE policy remains on admin_users. This migration touches only
-- policies scoped to anon/authenticated and the anon/authenticated table
-- grant; it never touched service_role, so the governed, server-side
-- management pathway (app/api/admins/manage/route.ts, using the
-- service-role client) is structurally unaffected by this change either
-- way. Because this migration's version is already recorded as applied in
-- the linked production database, this change affects only fresh-replay
-- behavior; it does not and cannot cause the migration to run again there.

DROP POLICY IF EXISTS "Admins can update themselves" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can update admins" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can insert admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow insert for admins" ON public.admin_users;

REVOKE INSERT, UPDATE ON TABLE public.admin_users FROM anon, authenticated;
