-- 20260811330000 revoked INSERT/UPDATE/DELETE on agenda_items from
-- anon/authenticated/service_role (the three verbs the governing
-- assignment named explicitly), but left TRUNCATE grantable -- a
-- privilege RLS cannot restrict at all (TRUNCATE is gated purely by
-- table ACL) and just as destructive as DELETE. Inconsistent with the
-- stated fail-closed principle ("Application callers must not be able
-- to mutate agenda_items directly"). Closing it for consistency.
BEGIN;

REVOKE TRUNCATE ON TABLE public.agenda_items FROM anon, authenticated, service_role;

COMMIT;
