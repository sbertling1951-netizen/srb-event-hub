-- Attendees + Household Members canonical task-authority RLS cutover.
--
-- Follow-up to the Live Attendees / Household Member RLS Authority
-- Inspection workstream, whose live-database evidence (not static
-- inference) this migration depends on directly:
--
--   * public.attendees' admin INSERT/UPDATE/DELETE policies ("SA or event
--     admins can ... attendees") already inline Event-scoped logic --
--     is_super_admin=true OR an admin_event_access match on the row's own
--     event_id -- but call no named helper function at all; they predate
--     this project's shared authority-primitive convention.
--   * public.attendee_household_members' admin INSERT/UPDATE/DELETE
--     policies ("admin ... household members") are completely unscoped --
--     EXISTS(active admin), no Event/Tenant/task check of any kind.
--   * event.attendees.manage is registered (platform_inherits=true,
--     tenant_inherits=true), granted via the event_admin and checkin
--     profile bundles, and materialized today to exactly 12
--     admin_event_access rows -- the identical 12 that exist in total.
--   * Live comparison proved zero access delta for the current active
--     admin roster: all 11 active admins (2 super_admin, 9 non-super)
--     retain identical access; 0 active Tenant Admin assignments exist to
--     widen anything; is_super_admin=true is provably identical to
--     privilege_group='super_admin' for every active admin, so Platform
--     inheritance (has_platform_admin_authority) covers exactly the same
--     population the old is_super_admin=true branch did.
--   * attendee_household_members.event_id is NOT NULL, FK'd to
--     events(id), and verified live to equal its parent attendee's own
--     event_id for every existing row (zero divergence) -- the direct
--     row-level predicate is safe with no join-through-attendee_id
--     fallback required. attendees.event_id is nullable at the schema
--     level but has zero live NULL rows; a future NULL row would simply
--     fail closed (has_event_task_authority denies on missing_input),
--     never fail open.
--   * event.imports.manage (the route-level task /admin/imports already
--     uses) is granted only to the event_admin profile, which itself
--     always also grants event.attendees.manage -- confirmed live via
--     admin_event_permissions that zero assignments hold
--     event.imports.manage without also holding event.attendees.manage.
--     Imports' own direct attendees writes are therefore unaffected.
--
-- SELECT policies (Admins can view attendees / Admins can view household
-- members / SA or event admins can view attendees / Members can view own
-- attendee row) are deliberately NOT touched here -- per the governing
-- task, SELECT semantics (event.attendees.view vs .manage vs an
-- intentional read-broader-than-write posture) are a separate, undecided
-- design question; this migration's scope is mutation authority only.
--
-- Admin household-member audit-trail parity (matching
-- household_member_identity_audit's existing member-side coverage) is
-- explicitly deferred to a separate follow-up, not built here.
--
-- Member/self-service behavior is untouched: submit_member_checkin,
-- save_participant_identity, update_participant_email,
-- finalize_member_identity_activation, increment_attendee_login, and
-- record_participant_capacity_increase are all SECURITY DEFINER and
-- never evaluate these RLS policies at all -- confirmed live by scanning
-- every function body in the public schema for a direct write to either
-- table; none besides record_participant_capacity_increase (already
-- governed by has_event_admin_authority, unrelated to and unaffected by
-- this migration) exists outside those governed RPCs.

BEGIN;

-- ============================================================
-- public.attendees -- admin mutation policies swapped from inline
-- Event-scoped admin_event_access logic to the canonical task resolver.
-- Same three policy names preserved (still accurate descriptions);
-- WITH CHECK added identically to USING on UPDATE so a row cannot be
-- moved into an Event the caller lacks event.attendees.manage for.
-- ============================================================

DROP POLICY IF EXISTS "SA or event admins can insert attendees" ON public.attendees;
CREATE POLICY "SA or event admins can insert attendees"
  ON public.attendees
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_event_task_authority('event.attendees.manage', event_id));

DROP POLICY IF EXISTS "SA or event admins can update attendees" ON public.attendees;
CREATE POLICY "SA or event admins can update attendees"
  ON public.attendees
  FOR UPDATE
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.attendees.manage', event_id));

DROP POLICY IF EXISTS "SA or event admins can delete attendees" ON public.attendees;
CREATE POLICY "SA or event admins can delete attendees"
  ON public.attendees
  FOR DELETE
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.manage', event_id));

-- ============================================================
-- public.attendee_household_members -- admin mutation policies swapped
-- from the bare "any active admin" predicate to the same canonical,
-- Event-scoped task resolver, evaluated against the row's own event_id
-- (NOT NULL, verified always equal to its parent attendee's event_id).
-- Same three policy names preserved.
-- ============================================================

DROP POLICY IF EXISTS "admin insert household members" ON public.attendee_household_members;
CREATE POLICY "admin insert household members"
  ON public.attendee_household_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_event_task_authority('event.attendees.manage', event_id));

DROP POLICY IF EXISTS "admin update household members" ON public.attendee_household_members;
CREATE POLICY "admin update household members"
  ON public.attendee_household_members
  FOR UPDATE
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.attendees.manage', event_id));

DROP POLICY IF EXISTS "admin delete household members" ON public.attendee_household_members;
CREATE POLICY "admin delete household members"
  ON public.attendee_household_members
  FOR DELETE
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.manage', event_id));

-- ============================================================
-- ACL hardening: anon INSERT/DELETE on public.attendees. Live inspection
-- confirmed anon holds this table-level grant but is named in zero RLS
-- policies for either command on this table (every attendees policy is
-- TO authenticated only) -- with RLS enabled and no applicable
-- permissive policy, anon's grant is already unreachable in practice.
-- This closes the unminimized grant itself, provably independent of the
-- policy swap above: it cannot narrow anything anon could already do.
-- attendee_household_members already carries no INSERT/UPDATE/DELETE/
-- SELECT grant for anon and is left untouched. authenticated's and
-- service_role's grants on both tables are untouched -- both
-- /admin/attendees and /admin/imports write these tables directly as
-- authenticated and require them.
-- ============================================================

REVOKE INSERT, DELETE ON TABLE public.attendees FROM anon;

COMMIT;
