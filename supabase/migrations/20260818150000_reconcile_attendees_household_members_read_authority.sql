-- Attendees + Household Members admin READ-authority reconciliation.
--
-- Follow-up to 20260818140000 (mutation cutover to
-- event.attendees.manage), whose header explicitly deferred SELECT
-- semantics as "a separate, undecided design question." This migration
-- resolves that question: admin SELECT on both tables now runs through
-- event.attendees.view, the same canonical task resolver, rather than
-- inline privilege_group / is_super_admin logic.
--
-- Live-database evidence (Attendees Admin Read-Authority Reconciliation
-- workstream) this migration depends on:
--
--   * public.attendees carried two overlapping admin SELECT policies --
--     "Admins can view attendees" (privilege_group IN ('super_admin',
--     'event_admin','checkin','parking','content_admin','read_only'),
--     unscoped by Event) and "SA or event admins can view attendees"
--     (is_super_admin=true OR an admin_event_access match on the row's
--     own event_id) -- combined by permissive-OR semantics, so the
--     narrower Event-scoped policy was already fully subsumed by the
--     broader unscoped one and added nothing.
--   * public.attendee_household_members carried one admin SELECT policy,
--     "Admins can view household members", using the same unscoped
--     privilege_group predicate.
--   * "Members can view own attendee row" (member self-service,
--     email-match) is untouched -- a distinct authority path, not part
--     of admin read authority.
--   * event.attendees.view is registered (platform_inherits=true,
--     tenant_inherits=true, event_assignment_grantable=true) and granted
--     via the event_admin, checkin, and parking profile bundles (not
--     content or view_only).
--   * Live comparison of the current active admin roster against the
--     canonical resolver found zero access delta: the 11 active admins
--     satisfying the legacy broad privilege_group predicate (8
--     event_admin, 2 super_admin, 1 checkin) are exactly the 11 who
--     satisfy has_event_task_authority('event.attendees.view', event_id)
--     today (via Platform inheritance for super_admin, or an event_admin/
--     checkin profile's materialized event.attendees.view grant for the
--     rest). Zero admins would gain or lose read access from this swap
--     for the roster as it exists today.
--
-- This is a real narrowing of the authority *model*, not merely a
-- rename: the legacy "Admins can view attendees" predicate checked a
-- global admin_users.privilege_group flag with no Event relationship at
-- all, so any admin holding one of those six privilege_group values
-- could read every attendee row for every Event. The canonical resolver
-- is Event-scoped -- Platform/Tenant inheritance, or a per-Event task
-- grant -- so a future admin holding only an Event-scoped assignment
-- without event.attendees.view (e.g. a 'content' or 'view_only' profile)
-- will no longer incidentally see attendee data through this path. That
-- the roster today produces zero delta is what live evidence proved is
-- safe now; it is not evidence this shape can never diverge for a future
-- roster, which is exactly the intended, tightened behavior.
--
-- Mutation policies (already cut over in 20260818140000), member
-- self-service RPCs, and every non-admin read path (get_my_attendee_record,
-- get_event_public_roster, get_event_attendee_locator, and siblings) are
-- untouched. No ACL (GRANT/REVOKE) change is needed here: anon already
-- holds no SELECT grant on either table, and authenticated's SELECT grant
-- on attendee_household_members (added in 20260803120000) is unaffected
-- by a policy-predicate swap.

BEGIN;

-- ============================================================
-- public.attendees -- the two overlapping admin SELECT policies are
-- replaced by one canonical, Event-scoped policy. "SA or event admins
-- can view attendees" is dropped outright (fully subsumed, no
-- replacement); "Admins can view attendees" is redefined in place.
-- "Members can view own attendee row" is not referenced here.
-- ============================================================

DROP POLICY IF EXISTS "SA or event admins can view attendees" ON public.attendees;

DROP POLICY IF EXISTS "Admins can view attendees" ON public.attendees;
CREATE POLICY "Admins can view attendees"
  ON public.attendees
  FOR SELECT
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.view', event_id));

-- ============================================================
-- public.attendee_household_members -- the single admin SELECT policy is
-- redefined in place from the unscoped privilege_group predicate to the
-- same canonical, Event-scoped task resolver.
-- ============================================================

DROP POLICY IF EXISTS "Admins can view household members" ON public.attendee_household_members;
CREATE POLICY "Admins can view household members"
  ON public.attendee_household_members
  FOR SELECT
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.view', event_id));

COMMIT;
