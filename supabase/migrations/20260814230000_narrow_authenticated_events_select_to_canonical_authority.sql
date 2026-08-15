-- Authenticated public.events SELECT hardening.
--
-- Preflight, verified live against the linked project before writing this
-- migration:
--
--   public.events currently carries three SELECT/UPDATE-relevant policies,
--   all `authenticated`-only (anon already has no SELECT grant, retired by
--   20260814210000):
--
--     1. "Authenticated read events" (SELECT, authenticated, USING (true))
--        -- the unconditional policy this migration narrows.
--     2. "Admins can view allowed events" (SELECT, authenticated), live
--        USING clause:
--          id IN (
--            SELECT aea.event_id
--            FROM admin_event_access aea
--            JOIN admin_users au ON au.id = aea.admin_user_id
--            WHERE au.user_id = auth.uid()
--          )
--        This predicate is CONFIRMED obsolete/inferior to the canonical
--        public.has_event_admin_authority(auth.uid(), id)
--        (20260810110000_create_administrative_authority_foundation.sql,
--        already governing "Admins can update events" on this same table):
--          - it has no `au.is_active` check, so a deactivated admin_users
--            row still matches -- a real gap the canonical function closes
--            (has_event_admin_authority requires au.is_active = true on
--            its own admin_event_access branch);
--          - it has no Super Admin branch (relies entirely on the
--            unconditional policy for Platform Admin access);
--          - it has no Tenant Admin inheritance branch.
--        Currently a no-op in practice (policy 1's USING (true) already
--        admits everything this narrower predicate would), but if left in
--        place alongside a narrowed policy 1 it becomes a live, strictly
--        weaker permissive SELECT path that bypasses the canonical
--        predicate (an inactive admin's grant, or any stale
--        admin_event_access row, would still read that Event) --
--        permissive policies are OR'd, so it must be dropped, not left.
--     3. "Admins can update events" (UPDATE, authenticated,
--        USING/WITH CHECK has_event_admin_authority(auth.uid(), id)) --
--        the canonical predicate already in production use. Untouched by
--        this migration.
--
--   Raw grants: authenticated has SELECT + UPDATE only (no INSERT/DELETE);
--   anon has no grant on public.events at all. Both already match the
--   target end state and are untouched.
--
--   Live application-code check (repo, HEAD e4698d9): every remaining
--   authenticated-role direct reader of public.events is an Admin page
--   (app/admin/**) that already self-gates client-side with
--   canAccessEvent() -- isSuperAdmin OR an admin_event_access match --
--   which is a strict subset of has_event_admin_authority's three
--   branches (Platform Admin, Tenant Admin inheritance, active
--   admin_event_access match). No Admin flow requires anything the
--   canonical predicate doesn't already grant, so no application code
--   changes are required by this migration.
--
-- Mechanics: drop "Admins can view allowed events" (superseded/inferior,
-- see above) and replace "Authenticated read events"'s USING (true) with
-- the canonical has_event_admin_authority(auth.uid(), id) predicate,
-- leaving exactly one authenticated SELECT policy on public.events, and
-- exactly one authority path (the same one UPDATE already uses). Not
-- touched: UPDATE policy, any grant, anon (already has none), any other
-- table, any RPC.

BEGIN;

DROP POLICY IF EXISTS "Admins can view allowed events" ON public.events;

DROP POLICY IF EXISTS "Authenticated read events" ON public.events;

CREATE POLICY "Authenticated read events"
ON public.events
FOR SELECT
TO authenticated
USING (public.has_event_admin_authority(auth.uid(), id));

COMMIT;
