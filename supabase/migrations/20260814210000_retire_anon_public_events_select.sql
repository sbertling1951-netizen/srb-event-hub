-- Public Event Read Surface Split -- retirement of the broad anon
-- "Public read events" SELECT surface, to the extent proven safe.
--
-- Consumer proof performed before this migration (LEM, 2026-08-14):
--
--   Application layer: every non-admin, non-service-role TypeScript
--   consumer of public.events that could run as anon or authenticated
--   (EventBanner.tsx, app/locations/page.tsx, lib/getActiveEvent.ts,
--   components/shell/adapters/MemberShellAdapter.tsx,
--   lib/server/workspaceContextResolver.ts) has been migrated to one of
--   the four governed, SECURITY DEFINER Event read RPCs
--   (get_public_discoverable_events, get_event_continuity_context,
--   get_current_active_event, get_tenant_owned_event_ids), none of which
--   depend on the caller's own table-level grant. The two service-role
--   API routes (app/api/vendor/workspace/summary/route.ts,
--   app/api/member/identity-claim/evaluate/route.ts) use
--   getSupabaseAdminClient() and are unaffected by any anon/authenticated
--   grant change.
--
--   Database layer, verified live against the linked project:
--     * No SECURITY INVOKER function reachable by anon or authenticated
--       references public.events except two BEFORE-INSERT trigger
--       functions on vendor_event_applications/vendor_event_dispositions
--       (set_vendor_event_application_tenant_id,
--       prepare_vendor_event_disposition,
--       20260814090000_create_vendor_admission_lifecycle_foundation.sql).
--       Both tables have INSERT revoked from anon and authenticated
--       (20260814100000_harden_vendor_admission_lifecycle_table_grants.sql)
--       -- the only INSERT path is through the SECURITY DEFINER vendor
--       admission RPCs (20260814130000), whose elevated execution context
--       already covers any trigger fired during that INSERT. Neither
--       trigger function depends on the original caller's own SELECT
--       grant on public.events.
--     * No RLS policy on any other table references "events" in its
--       USING/WITH CHECK expression (checked via pg_policies).
--     * No view or materialized view in schema public selects from
--       events and is directly readable by anon or authenticated.
--
-- What is NOT retired here, and why: Admin pages (app/admin/**, e.g.
-- app/admin/events/page.tsx, app/admin/attendees/page.tsx) read
-- public.events directly through the same browser client used by every
-- other consumer -- an anon-key client bearing the signed-in user's own
-- session, which PostgREST/RLS evaluates as `authenticated`, not as any
-- service-role or admin-specific database role. public.events carries no
-- other SELECT policy broad enough to cover what these Admin flows need
-- today: "Admins can view allowed events" is scoped to
-- admin_event_access, a real but strictly narrower predicate that the
-- Events RLS/Grant-Drift Reconciliation audit
-- (20260813140000_reconcile_events_rls_grant_drift.sql, item 2) already
-- found insufficient to substitute for the broad policy without risking
-- real Admin breakage, and left that narrowing as an explicit, separate,
-- unresolved decision. This task's own boundary ("Do not disturb Admin
-- authority or service-role behavior") forbids resolving that here.
-- Retirement is therefore scoped to exactly what the consumer proof
-- above covers: anon's direct SELECT capability, which now has zero
-- proven consumer of any kind. authenticated's SELECT capability is
-- preserved, unnarrowed, because Admin still directly depends on it.
--
-- Mechanics: "Public read events" (anon, authenticated; USING (true)) is
-- dropped and replaced by a policy with the identical predicate (true)
-- but scoped to authenticated only -- not a row-level change for the
-- role that keeps access, only a role-scope narrowing. The renamed policy
-- avoids the now-inaccurate word "Public". anon's raw SELECT table grant
-- is also revoked, matching this repository's established grant-hardening
-- pattern of removing capability alongside the policy that made it
-- reachable (20260813140000 §5, 20260814100000, et al.).
--
-- Not touched: "Admins can update events", "Admins can view allowed
-- events" (both authenticated-only, Admin authority, out of scope per
-- this task's own boundary), any other public.events policy or grant,
-- and all four governed Event read RPCs (SECURITY DEFINER, independent of
-- this table-level change by design).

BEGIN;

DROP POLICY IF EXISTS "Public read events" ON public.events;

CREATE POLICY "Authenticated read events"
ON public.events
FOR SELECT
TO authenticated
USING (true);

REVOKE SELECT ON TABLE public.events FROM anon;

COMMIT;
