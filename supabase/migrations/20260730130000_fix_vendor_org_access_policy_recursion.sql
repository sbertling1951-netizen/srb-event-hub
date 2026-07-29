-- ============================================================================
-- Fix: 42P17 infinite recursion in policy for relation "vendor_org_access"
--
-- PROVEN RECURSION CHAIN
-- ----------------------
-- The member dashboard reads public.event_vendors (app/member/page.tsx,
-- loadVendors). That read evaluates event_vendors_select_policy, created in
-- 20260727120300_vendor_person_specific_access_foundation.sql (lines 369-384),
-- whose USING clause contains:
--
--     EXISTS (
--       SELECT 1 FROM public.vendor_org_access voa
--       WHERE voa.vendor_id = event_vendors.vendor_id
--         AND voa.auth_user_id = auth.uid()
--         AND voa.status = 'active'
--     )
--
-- That subquery is itself subject to RLS on public.vendor_org_access, which
-- evaluates vendor_org_access_select_policy (same migration, lines 330-346).
-- That policy's USING clause selects from its OWN protected relation:
--
--     OR EXISTS (
--       SELECT 1 FROM public.vendor_org_access admin_access   <-- SELF
--       WHERE admin_access.vendor_id = vendor_org_access.vendor_id
--         AND admin_access.auth_user_id = auth.uid()
--         AND admin_access.status = 'active'
--         AND admin_access.access_role = 'vendor_admin'
--     )
--
-- Evaluating the policy therefore requires evaluating the same policy again,
-- which Postgres detects and aborts with 42P17. The loop is entered only when
-- the two cheaper OR branches (is_active_admin, auth_user_id = auth.uid())
-- are both false -- which is exactly the case for an ordinary authenticated
-- member, and why active admins never saw the failure.
--
-- vendor_org_access policies are defined in exactly one place
-- (20260727120300); no later migration overrides them.
--
-- FIX
-- ---
-- Replace only the self-referencing OR branch with a narrowly scoped
-- SECURITY DEFINER helper that answers exactly one question -- "is this
-- auth user an active vendor_admin of this vendor org?" -- and nothing else.
-- Because the helper executes as its owner (the role that owns
-- vendor_org_access), the SELECT inside it is not subject to
-- vendor_org_access_select_policy, so the policy expression no longer
-- re-enters itself. Semantics are preserved exactly: admin OR own row OR
-- vendor_admin-of-the-same-vendor.
--
-- Deliberately NOT changed: vendors_select_policy, event_vendors_select_policy,
-- vendor_contacts_* policies, and every INSERT/UPDATE/ALL policy. Those
-- reference vendor_org_access across tables (not themselves); once the
-- self-reference below is removed, their nested evaluation of
-- vendor_org_access_select_policy terminates normally. RLS remains enabled on
-- all four vendor tables and no new anon access is granted.
--
-- CAVEAT: this fix relies on the standard Postgres rule that a table owner is
-- exempt from that table's RLS. Do not add
-- "ALTER TABLE public.vendor_org_access FORCE ROW LEVEL SECURITY" -- doing so
-- would subject the helper's owner-context read to the policy again and
-- reintroduce 42P17.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Narrowly scoped, non-recursive authorization helper.
--
--    Returns a single boolean -- never rows, never vendor data -- so it
--    cannot be repurposed as a general-purpose reader of the protected
--    relation. No dynamic SQL. Explicit search_path. Fully schema-qualified.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_vendor_org_admin(
  _vendor_id uuid,
  _uid uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vendor_org_access voa
    WHERE voa.vendor_id = _vendor_id
      AND voa.auth_user_id = _uid
      AND voa.status = 'active'
      AND voa.access_role = 'vendor_admin'
  );
$$;

-- A NULL vendor id or NULL auth.uid() (anonymous caller) yields no matching
-- row and therefore false -- the function fails closed by construction.

REVOKE ALL ON FUNCTION public.is_vendor_org_admin(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_vendor_org_admin(uuid, uuid) FROM anon;

-- Only `authenticated` needs EXECUTE: the sole caller is
-- vendor_org_access_select_policy, which is declared TO authenticated.
GRANT EXECUTE ON FUNCTION public.is_vendor_org_admin(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Replace ONLY the recursive SELECT policy on vendor_org_access.
--
--    Same three access branches as before, same roles, same table, same
--    isolation guarantees -- the third branch is now delegated to the helper
--    above instead of querying vendor_org_access inline.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS vendor_org_access_select_policy ON public.vendor_org_access;
CREATE POLICY vendor_org_access_select_policy
  ON public.vendor_org_access
  FOR SELECT
  TO authenticated
  USING (
    -- Platform admins retain full visibility (unchanged).
    public.is_active_admin(auth.uid())
    -- A user may always see their own access row (unchanged).
    OR vendor_org_access.auth_user_id = auth.uid()
    -- A vendor_admin may see all access rows for their own vendor org only.
    -- Previously an inline self-subquery; now non-recursive.
    OR public.is_vendor_org_admin(vendor_org_access.vendor_id, auth.uid())
  );

COMMIT;
