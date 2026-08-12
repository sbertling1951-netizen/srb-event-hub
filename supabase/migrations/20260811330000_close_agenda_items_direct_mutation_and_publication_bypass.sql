-- Applied only after the governed Event Agenda CRUD/reorder/import RPCs
-- (20260811310000, repaired by 20260811320000) were validated by a
-- 47-scenario rollback-controlled suite. Closes the two live defects
-- re-confirmed at the start of this assignment:
--
-- 1. Mutation bypass: "Admins can insert/update/delete agenda items"
--    checked only a global admin_users.privilege_group membership, with
--    no admin_event_access scoping. Because Postgres OR's permissive
--    policies of the same command together, this made the newer,
--    properly Event-scoped "SA or event admins can update/delete agenda
--    items" policies moot -- any super_admin/event_admin/content_admin
--    could mutate ANY Event's agenda_items regardless of assignment.
-- 2. Publication bypass: "public read agenda_items" used USING (true),
--    OR'd with the correctly-scoped "Members can view published agenda
--    items" (is_published = true), making the restriction moot -- any
--    anon/authenticated client could read unpublished rows directly.
--
-- All 5 write policies are dropped -- no application-facing write policy
-- remains at all; every mutation now goes exclusively through the
-- SECURITY DEFINER governed RPCs, which bypass RLS via table-owner role
-- attribute (rolbypassrls), matching the established pattern for every
-- other governed table in this codebase.
--
-- Only the ONE offending SELECT policy (the literal USING (true)) is
-- removed. "Admins can view agenda items" and "SA or event admins can
-- view agenda items" are deliberately left in place: the current Admin
-- Agenda UI (app/admin/agenda/page.tsx) is explicitly out of scope for
-- this assignment and still depends on direct reads through those
-- policies to keep functioning until its own cutover CMD. "Members can
-- view published agenda items" already targets both anon and
-- authenticated with the correct is_published=true restriction, so
-- removing the USING(true) policy alone fully closes the publication
-- bypass without requiring Member/public reads to authenticate.
BEGIN;

DROP POLICY "public read agenda_items" ON public.agenda_items;

DROP POLICY "Admins can insert agenda items" ON public.agenda_items;
DROP POLICY "Admins can update agenda items" ON public.agenda_items;
DROP POLICY "Admins can delete agenda items" ON public.agenda_items;
DROP POLICY "SA or event admins can update agenda items" ON public.agenda_items;
DROP POLICY "SA or event admins can delete agenda items" ON public.agenda_items;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.agenda_items FROM anon, authenticated, service_role;

COMMIT;
