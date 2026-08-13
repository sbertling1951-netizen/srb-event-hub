-- Events RLS / Grant Drift Reconciliation.
--
-- Reconciles six public.events RLS policies and a set of raw table grants
-- that were applied directly against the linked production database via
-- the Supabase SQL Editor, outside all tracked migration history --
-- confirmed by exhaustive search of every migration file (none reference
-- any of these policy names) and every architecture document. This is the
-- same class of drift already precedented and reconciled by
-- 20260811270000_close_admin_event_permissions_direct_access.sql for
-- public.admin_event_permissions; this migration applies the same pattern
-- to public.events.
--
-- Audit findings this migration acts on (LEM Events RLS / Grant Drift
-- Reconciliation Audit, 2026-08-13):
--
--   1. "Admins update events" (UPDATE, authenticated) is an exact-predicate
--      duplicate of "Admins can update events" -- dropped.
--   2. "public read events" (SELECT, anon+authenticated, USING (true)) is
--      an exact-predicate duplicate of "Public read events" (SELECT, anon,
--      USING (true)) plus authenticated -- both are dropped and replaced
--      by one consolidated policy with IDENTICAL effective access
--      (anon + authenticated, USING (true)). This migration does not
--      narrow the row condition: app/coach-map/public/page.tsx reads an
--      already-established workspace Event by id with no
--      visible_to_members/is_active filter at all, matching ADR-006's
--      "inactive is not invalid" Context invariant -- narrowing SELECT to
--      visible_to_members/is_active would risk breaking that continuity
--      for an Event an authorized member's session already points at.
--      Row-level narrowing (or converting public read to a governed RPC,
--      per the audit's Stage 5 alternative) remains an explicit open
--      decision, not resolved here.
--   3. "Admins can insert events" (INSERT, authenticated) used the legacy
--      pre-authority-foundation predicate
--      (admin_users.privilege_group IN ('super_admin','event_admin')),
--      unscoped by admin_event_access or tenant. The one and only UI path
--      that could reach it, app/admin/events/page.tsx's saveEvent(), calls
--      blockNewEventCreation() unconditionally before ever attempting an
--      insert (NEW_EVENT_CREATION_UNAVAILABLE) -- Event creation has no
--      live consumer today. Rather than widen scope by designing a new
--      create_event RPC as part of a drift-reconciliation migration, the
--      smallest safe change is to close direct INSERT entirely (drop
--      policy, revoke grant), matching current real behavior exactly. A
--      governed create_event RPC is future work once Event creation is
--      reintroduced as a reviewed feature.
--   4. "Admins can update events" is retargeted from the legacy
--      privilege_group predicate to the canonical
--      public.has_event_admin_authority(auth.uid(), id) primitive
--      (20260810110000_create_administrative_authority_foundation.sql).
--      This is a deliberate narrowing, not a no-op: an admin_users row
--      with privilege_group = 'event_admin' but no admin_event_access
--      grant to a given Event, and no admin_tenant_access grant to that
--      Event's tenant, loses the direct-write ability this predicate
--      previously and incorrectly gave it. This matches the accepted
--      Platform Admin -> Tenant Admin -> Event Admin hierarchy
--      (EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md)
--      and closes the mismatch the audit identified in its Stage 4.
--   5. "Admins can view allowed events" (SELECT, authenticated,
--      admin_event_access-scoped) is left untouched: it remains inert
--      today (superseded by the unconditional SELECT policy retained in
--      item 2) but is not incorrect, and is the existing foundation a
--      future SELECT-narrowing pass would build on.
--   6. Raw table ACL for anon/authenticated is reduced to exactly what a
--      live consumer uses: SELECT for both, UPDATE for authenticated only.
--      DELETE, TRUNCATE, REFERENCES, and TRIGGER were never mediated by
--      any policy (no DELETE policy exists; TRUNCATE and the DDL-adjacent
--      privileges are never RLS-gated at all) and have no live consumer --
--      revoked from both roles. INSERT is revoked from both to match
--      item 3. UPDATE is additionally revoked from anon (no permissive
--      UPDATE policy has ever targeted anon; this only removes an unused
--      raw privilege, not a reachable capability).
--
-- Not addressed by this migration (explicitly deferred, per the audit):
--   - Public/anon SELECT row-level or column-level narrowing (item 2).
--   - A governed create_event RPC (item 3).
--   - Tenant Admin inheritance for the SELECT side (item 5's policy has no
--     admin_tenant_access branch; it already didn't before this
--     migration -- not a regression introduced here).
--
-- ADR-013 §2's claim that "public.events has no Row Level Security policy
-- of any kind" predates this reconciliation and was already inaccurate to
-- what the audit found (RLS was already enabled with ungoverned policies
-- before this migration ran) -- ADR-013's text itself still needs a
-- correction pass to state that plainly; not done by this migration.

-- ---------------------------------------------------------------------------
-- 1. Drop exact-duplicate and superseded-by-consolidation policies.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins update events" ON public.events;
DROP POLICY IF EXISTS "public read events" ON public.events;
DROP POLICY IF EXISTS "Public read events" ON public.events;

-- ---------------------------------------------------------------------------
-- 2. Consolidated public SELECT policy. Same effective access as the two
--    policies just dropped (anon + authenticated, USING (true)) -- a pure
--    rename/merge, not a behavior change. See header item 2 for why the
--    row condition is not narrowed in this pass.
-- ---------------------------------------------------------------------------

CREATE POLICY "Public read events"
ON public.events
FOR SELECT
TO anon, authenticated
USING (true);

-- ---------------------------------------------------------------------------
-- 3. Close direct INSERT. See header item 3.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins can insert events" ON public.events;

-- ---------------------------------------------------------------------------
-- 4. Retarget UPDATE to the canonical authority primitive. See header
--    item 4. IF EXISTS on the DROP guards a fresh replay where production
--    (which already carries this exact policy under this exact name) is
--    the only place this migration's version is recorded as applied.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins can update events" ON public.events;

CREATE POLICY "Admins can update events"
ON public.events
FOR UPDATE
TO authenticated
USING (public.has_event_admin_authority(auth.uid(), id))
WITH CHECK (public.has_event_admin_authority(auth.uid(), id));

-- ---------------------------------------------------------------------------
-- 5. Raw table ACL: reduce anon/authenticated to exactly what a live
--    consumer uses. Matches the public.tenants precedent
--    (20260721_enable_tenants_rls.sql). REVOKE on a privilege already
--    absent is a no-op, not an error, so this is safe to run whether or
--    not production's grant state already matches.
-- ---------------------------------------------------------------------------

REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.events
FROM anon, authenticated;

REVOKE UPDATE ON TABLE public.events FROM anon;
