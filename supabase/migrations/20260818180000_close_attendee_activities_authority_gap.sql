-- Close the attendee_activities authority gap: unauthenticated PII
-- exposure + unscoped Admin mutation/read predicates.
--
-- Identified during an Admin authority/governance prioritization pass
-- following the record_participant_capacity_increase reconciliation
-- (20260818170000). attendee_activities was never brought into the
-- canonical task-authority model when its sibling tables (attendees,
-- attendee_household_members) were reconciled in 20260818140000/150000.
--
-- Live evidence (this workstream):
--
--   * RLS is enabled on public.attendee_activities
--     (relrowsecurity=true), but the SELECT policy "public read
--     attendee_activities" has qual=true for roles {anon,authenticated},
--     and anon independently holds the table-level SELECT grant.
--     Proven live: an unauthenticated HTTP HEAD request to
--     /rest/v1/attendee_activities using only the public apikey header
--     (no session, no bearer token) returned HTTP 200 with
--     content-range: 0-56/57 -- 57 rows, each including a plaintext
--     attendee_email column, fully readable with zero authentication.
--   * Repository-wide grep confirms zero legitimate anon or member-
--     facing consumer of this table: the only two callers anywhere in
--     app/ or lib/ are app/admin/imports/page.tsx (writes: deletes
--     superseded activity rows for re-imported entry_ids, then inserts
--     the fresh rows, both scoped client-side to the selected import
--     Event) and app/admin/reports/page.tsx (reads, for report
--     aggregation). No public/member page reads or needs this table.
--   * The two Admin policies ("Admins can manage attendee activities",
--     FOR ALL; "Admins can view attendee activities", SELECT) both use
--     unscoped privilege_group IN (...) predicates with no event_id
--     check at all -- confirmed live via pg_policies. Live coverage gap
--     proving this is exploitable beyond theory: public.events holds 6
--     rows, but public.admin_event_access covers only 4 distinct
--     event_id values -- an event_admin assigned to exactly one Event
--     can today mutate/read attendee_activities for every other Event,
--     including the 2 Events with zero Admin assignments of any kind.
--   * event.attendees.manage / event.attendees.view are already
--     registered task-registry capabilities (20260811170000) and are
--     the exact capabilities this same attendee-roster/import data was
--     reconciled to on the sibling attendees and
--     attendee_household_members tables (20260818140000, 20260818150000).
--     attendee_activities is attendee-roster/import data by content
--     (attendee_email, activity_name, quantity, price, raw_name,
--     source_column_prefix) and by its only writer (the Imports admin
--     page) -- the same domain, the same owning module (Attendees, per
--     EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md Module 2: "Roster CRUD...
--     importing a roster file").
--
-- Fix, modeled directly on the already-proven cutover pattern
-- (20260818140000 for the mutation split, 20260818150000 for the view
-- swap, and the prior "RESOLVED -- Public Event Read Surface Split"
-- precedent for retiring an anon-open policy with no legitimate anon
-- consumer):
--   1. Drop the anon-open "public read attendee_activities" policy
--      outright -- no governed RPC replacement is added, because no
--      legitimate anon or non-admin consumer exists to replace.
--   2. Reconcile the Admin SELECT policy to
--      has_event_task_authority('event.attendees.view', event_id).
--   3. Split the Admin FOR ALL policy into INSERT/UPDATE/DELETE policies
--      using has_event_task_authority('event.attendees.manage',
--      event_id), WITH CHECK on both INSERT and UPDATE.
--   4. Revoke anon's SELECT/INSERT/UPDATE/DELETE table-level grants --
--      zero legitimate anon consumer, matching the "attendees" anon
--      grant closure already done in 20260818140000.
--
-- authenticated's own INSERT/UPDATE/DELETE grants are left untouched:
-- unlike attendee_household_members, no governed SECURITY DEFINER RPC
-- wraps attendee_activities writes -- the direct table write from
-- app/admin/imports/page.tsx is the live, intended production path, so
-- closing authenticated's write grant would break that page. The fix
-- here is entirely in which predicate gates that already-necessary
-- direct write, not in closing the write path itself.

BEGIN;

DROP POLICY IF EXISTS "public read attendee_activities" ON public.attendee_activities;

DROP POLICY IF EXISTS "Admins can view attendee activities" ON public.attendee_activities;
CREATE POLICY "Admins can view attendee activities"
  ON public.attendee_activities
  FOR SELECT
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.view', event_id));

DROP POLICY IF EXISTS "Admins can manage attendee activities" ON public.attendee_activities;

CREATE POLICY "Admins can insert attendee activities"
  ON public.attendee_activities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_event_task_authority('event.attendees.manage', event_id));

CREATE POLICY "Admins can update attendee activities"
  ON public.attendee_activities
  FOR UPDATE
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.manage', event_id))
  WITH CHECK (public.has_event_task_authority('event.attendees.manage', event_id));

CREATE POLICY "Admins can delete attendee activities"
  ON public.attendee_activities
  FOR DELETE
  TO authenticated
  USING (public.has_event_task_authority('event.attendees.manage', event_id));

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendee_activities FROM anon;

COMMIT;
