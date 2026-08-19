-- Announcements RLS -- close the unpublished-content leak.
--
-- Pre-UI security closeout, defect A (Temporary Event Access Remaining
-- Findings Reconciliation Audit, durable baseline 2a7c9ec). Live-proven
-- before this migration: a real is_published = false announcement row
-- was retrievable by anon via direct REST when the app's own
-- is_published=true filter was bypassed, even though every application
-- consumer (app/member/announcements/page.tsx) already applies that
-- filter client-side.
--
-- ROOT CAUSE: public.announcements carried SIX permissive SELECT
-- policies, OR-combined by RLS semantics, three of which are USING(true)
-- with no predicate at all:
--
--   * "Admins can view announcements"        (authenticated, admin_users-gated)      -- KEEP, legitimate Admin access.
--   * "Members can view published announcements" (authenticated+anon, is_published=true) -- KEEP, the one correct member/anon-facing policy.
--   * "Members can read announcements"        (authenticated, USING(true))            -- DROP, redundant/legacy bypass.
--   * "Public read announcements"             (anon, USING(true))                     -- DROP, redundant/legacy bypass.
--   * "public read announcements"             (authenticated+anon, USING(true))       -- DROP, redundant/legacy bypass, broadest of the three.
--
-- Because RLS policies are OR-combined, the three USING(true) policies
-- fully defeated "Members can view published announcements" for every
-- role they applied to -- not just anon: "Members can read announcements"
-- also gave every authenticated caller unconditional access to
-- unpublished rows, which is equally not the intended Member boundary
-- (is_published exists precisely to gate draft content from being
-- fetchable by any authenticated session, not only from anon).
--
-- No table-level GRANT is touched: anon and authenticated already hold
-- exactly SELECT,REFERENCES,TRIGGER (confirmed live, unchanged by this
-- migration) -- this defect was entirely in the RLS policy set, not the
-- grant.
--
-- Admin INSERT/UPDATE/DELETE policies ("Admins can insert/update/delete
-- announcements") are untouched. Admin management (app/admin/*) is
-- unaffected: it authenticates via admin_users, which every remaining
-- SELECT policy already accounts for independently of this change.

BEGIN;

DROP POLICY IF EXISTS "Members can read announcements" ON public.announcements;
DROP POLICY IF EXISTS "Public read announcements" ON public.announcements;
DROP POLICY IF EXISTS "public read announcements" ON public.announcements;

COMMIT;
