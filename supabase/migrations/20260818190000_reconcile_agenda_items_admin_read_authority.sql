-- agenda_items admin READ-authority reconciliation.
--
-- Candidate #2 of the Admin authority/governance prioritization pass
-- (same series as 20260818150000, 20260818180000). agenda_items was
-- never brought into the canonical task-authority model when
-- event.agenda.view / event.agenda.manage were registered
-- (20260811170000) and adopted by every governed agenda RPC
-- (20260811290000, 20260811310000, 20260811320000, 20260811350000,
-- 20260813170000) and by the Admin Agenda page's own client-side gate.
--
-- Live-database evidence (this workstream, verified against the linked
-- project via `supabase db query --linked`):
--
--   * RLS is enabled on public.agenda_items (relrowsecurity=true), with
--     three live SELECT policies:
--       1. "Admins can view agenda items" (TO authenticated) --
--          EXISTS admin_users au WHERE au.user_id=auth.uid() AND
--          au.is_active AND au.privilege_group IN ('super_admin',
--          'event_admin','content_admin','read_only') -- no event_id or
--          Tenant predicate at all.
--       2. "SA or event admins can view agenda items" (TO authenticated)
--          -- is_super_admin=true (email match) OR an unscoped
--          admin_event_access join on the row's own event_id (any
--          role/profile, not permission-specific).
--       3. "Members can view published agenda items" (TO anon,
--          authenticated) -- is_published=true. Untouched below: a
--          distinct, already-correctly-scoped member/public read path.
--   * event.agenda.view and event.agenda.manage are registered
--     (platform_inherits=true, tenant_inherits=true,
--     event_assignment_grantable=true, 20260811170000) and are the exact
--     capabilities app/admin/agenda/page.tsx already requires client-side
--     before it will even issue this table's only Admin-side direct read:
--     it calls checkAdminEventTaskAuthority("event.agenda.view", eventId),
--     falling back to "event.agenda.manage", and returns early with no
--     query at all if neither resolves allowed. No other Admin surface
--     reads this table directly -- repository-wide grep confirms the only
--     three callers of `.from("agenda_items")` anywhere in app/ or lib/
--     are this page, app/member/agenda/page.tsx, and
--     lib/experienceContext/providers/agendaProvider.ts (the latter two
--     both filtered to .eq("is_published", true), served by policy 3).
--   * Live access-delta comparison of the current active admin roster
--     (2 super_admin, 8 event_admin, 1 checkin; zero active
--     content_admin/read_only) against 6 live Events: the unscoped
--     predicate (policy 1) allows 60 (admin, event) pairs; the canonical
--     resolver has_event_task_authority('event.agenda.view', event_id)
--     allows 23. All 37 pairs that would be lost are admin/event
--     combinations where that admin holds zero admin_event_access row
--     for that Event at all -- verified separately that every
--     (admin, event) pair where the admin *does* hold an assignment
--     already carries the materialized event.agenda.view grant (100% of
--     11 such pairs). Zero pairs are gained. This mirrors the exact
--     shape already reconciled on attendees/attendee_household_members/
--     attendee_activities: an admin assigned to one Event could read
--     every other Event's data through this table, including Events with
--     no assignment of any kind.
--   * Dropping policy 2 outright is not a full-subsumption case like the
--     attendees precedent (20260818150000): its unscoped
--     admin_event_access join, unlike policy 1's privilege_group list,
--     covers the 'checkin' and 'parking' profiles too. Live evidence: one
--     active checkin-profile admin (charlcbfl@gmail.com) holds an
--     admin_event_access row (role='checkin') for one Event and so
--     currently qualifies under policy 2 for that Event, but not under
--     policy 1. However, the checkin profile bundle
--     (admin_event_profile_tasks) grants neither event.agenda.view nor
--     event.agenda.manage, and this table's only Admin-side reader
--     (app/admin/agenda/page.tsx) already refuses to issue the read for
--     that same admin today, client-side, before this policy is ever
--     reached -- both required checks fail for a checkin profile. This
--     removes a real but already-unreachable grant, not a capability any
--     live caller exercises.
--
-- Fix, modeled on the attendees/household-members read-authority
-- precedent (20260818150000):
--   1. Drop "SA or event admins can view agenda items" outright -- no
--      replacement; not a legitimate, reachable access path today.
--   2. Reconcile "Admins can view agenda items" to
--      has_event_task_authority('event.agenda.view', event_id).
--   3. "Members can view published agenda items" is not referenced.
--
-- No ACL (GRANT/REVOKE) change: anon's table-level SELECT grant remains
-- necessary for policy 3 (a real, distinct anon consumer, unlike
-- attendee_activities where anon had zero legitimate consumer);
-- authenticated's SELECT grant is unaffected by a policy-predicate swap.
-- Agenda mutation authority (already event.agenda.manage via the
-- governed RPCs) and every governed RPC are untouched.

BEGIN;

DROP POLICY IF EXISTS "SA or event admins can view agenda items" ON public.agenda_items;

DROP POLICY IF EXISTS "Admins can view agenda items" ON public.agenda_items;
CREATE POLICY "Admins can view agenda items"
  ON public.agenda_items
  FOR SELECT
  TO authenticated
  USING (public.has_event_task_authority('event.agenda.view', event_id));

COMMIT;
