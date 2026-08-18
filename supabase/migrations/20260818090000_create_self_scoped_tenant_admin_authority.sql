-- Self-Scoped Tenant Admin Authority -- Canonical Tenant Route-Authority
-- Foundation, Part A.
--
-- Context: G-03 Admin Task-Authority reconciliation identified three
-- Admin routes (/admin/events/new, /admin/nearby-settings,
-- /admin/vendors/access) that cannot correctly use Event-scoped
-- `event.*` task authority. Design review (Canonical Tenant-Scoped Admin
-- Route Authority Design) settled that Tenant Admin is currently a
-- single, undifferentiated administrative tier -- no `tenant.*` task
-- catalog is invented here or implied by this migration -- and that a
-- coarse route-level question is sufficient at the guard layer: "is the
-- current admin a Platform Admin, or an active Tenant Admin of at least
-- one Tenant?" Specific-Tenant operations remain, unchanged, gated by
-- the existing has_tenant_admin_authority(uid, tenant_id) primitive
-- against whichever Tenant a page's own selection resolves (already
-- proven in production by set_tenant_category_override /
-- set_tenant_place_relevance, 20260811120000). This migration adds only
-- the missing piece: a way for a non-Super-Admin to learn their own
-- coarse Tenant-Admin standing, which does not exist today.
--
-- public.admin_tenant_access carries NO table grant to anyone, including
-- `authenticated` (20260810110000): "a Tenant Admin has no legitimate
-- reason to browse the assignment table itself... cross-Tenant
-- visibility of 'who administers Tenant B' is exactly the kind of fact
-- the hierarchy exists to keep Tenant-isolated." The only existing reads
-- (list_tenant_admin_access) and writes (set_tenant_admin_access) of
-- that table are both explicitly Super-Admin-only. That leaves a real
-- gap this migration closes narrowly: even a Tenant Admin cannot
-- currently ask "am I one, anywhere" for themselves.
--
-- SECURITY REFINEMENT (explicitly directed): the obvious first draft --
-- an authenticated-callable has_any_tenant_admin_authority(p_auth_user_id
-- uuid) mirroring has_tenant_admin_authority's own two-argument shape --
-- is deliberately NOT what this migration ships. That shape would let
-- any authenticated caller pass an arbitrary uuid and learn a boolean
-- fact about a DIFFERENT admin's Tenant-Admin standing -- a real
-- authorization-oracle leak even though it reveals no Tenant IDs, and a
-- narrowing of the "Tenant Admin assignments are Super-Admin-only
-- readable" boundary that admin_tenant_access has held since its
-- creation. Instead, the new function is genuinely self-scoped: it takes
-- NO parameters at all and derives the caller exclusively from auth.uid()
-- inside the function body -- PostgREST/Supabase binds auth.uid() to the
-- JWT of the actual authenticated request; there is no argument through
-- which a client could substitute another user's identity. Arbitrary-
-- user probing is not merely discouraged here, it is structurally
-- impossible: the function signature has no uid parameter to supply one
-- through.
--
-- No internal uid-taking helper is introduced either. The function body
-- is a single EXISTS check plus a call to the already-existing,
-- already-governed has_platform_admin_authority(uid) (itself
-- Super-Admin-only-meaningful, safe to call with a uid derived from
-- auth.uid() the same way has_event_admin_authority already does) --
-- adding a second, non-client-exposed uid-taking wrapper around that
-- would be an unnecessary extra function for a body this short, not a
-- correctness requirement.
--
-- Reveals only a boolean. No Tenant ID, no admin_tenant_access row, no
-- other admin's identity is returned or inferable from this function's
-- result. admin_tenant_access itself, its existing RLS/grants, the
-- existing set_tenant_admin_access/list_tenant_admin_access RPCs, and
-- Tenant Admin assignment semantics are entirely untouched -- this
-- migration adds one new, additive, read-only, boolean-only function and
-- nothing else.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_any_tenant_admin_authority()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_platform_admin_authority(v_uid) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_tenant_access AS ata
    JOIN public.admin_users AS au ON au.id = ata.admin_user_id
    WHERE au.user_id = v_uid
      AND au.is_active = true
      AND ata.is_active = true
  );
END;
$$;

ALTER FUNCTION public.has_any_tenant_admin_authority() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.has_any_tenant_admin_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_any_tenant_admin_authority() FROM anon;
GRANT EXECUTE ON FUNCTION public.has_any_tenant_admin_authority() TO authenticated;

COMMIT;
