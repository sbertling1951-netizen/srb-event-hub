-- Administrative Authority Foundation.
-- Implements docs/architecture/EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md
-- (Accepted, v1.0) -- the previously audited and designed hierarchy:
--
--   Super Admin -> Tenant Admin -> Event Admin
--
-- Bounded implementation only: the three authority primitives and the
-- minimum durable Tenant-assignment substrate (public.admin_tenant_access)
-- they need. No general admin refactor. public.admin_event_access,
-- public.admin_event_permissions, and lib/getCurrentAdminAccess.ts are
-- untouched. public.is_event_scoped_admin's SIGNATURE is untouched (still
-- `(p_auth_user_id uuid, p_event_id uuid) RETURNS boolean`, still callable
-- from every existing site) but its body is redefined via
-- `CREATE OR REPLACE FUNCTION` (a new, additive migration statement -- the
-- historical migration that first created it, 20260805130000, is not
-- edited) to delegate to the new Event primitive, which is a strict
-- superset of its old logic (super_admin unconditional, or
-- admin_event_access match) plus the one new, intended branch (Tenant
-- Admin inheritance). Nothing that returned true before can return false
-- now.
--
-- ORDERING: timestamped 20260810110000 -- after the last applied
-- migration (20260809130000) and before both
-- 20260810120000_create_governed_venue_evidence_foundation.sql and
-- 20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql,
-- both of which are amended in this same change to consume
-- has_tenant_admin_authority defined here. All three remain unapplied; no
-- historical/applied migration is renamed or edited.

-- ---------------------------------------------------------------------------
-- 1. public.admin_tenant_access -- the durable Tenant Admin assignment
--    substrate. Explicitly the "previously accepted transitional design"
--    (Option B over the future Person-Tenant Relationship model, ADR-012):
--    admin_user_id-keyed, not person_id-keyed, mirroring
--    public.admin_event_access's existing shape rather than inventing a
--    new identity model. NOT a replacement for ADR-012's eventual model --
--    see the architecture doc for why.
--
--    One row per (admin_user_id, tenant_id) -- the UNIQUE constraint
--    itself is what "prevent duplicate active/equivalent Tenant
--    assignments" means here: there is structurally no way to insert a
--    second row for the same pair, active or not. Revoking sets
--    is_active = false (via the governed RPC below) rather than deleting,
--    preserving the assignment's history; re-granting flips it back
--    rather than inserting a duplicate.
--
--    No `role` column: unlike admin_event_access (which genuinely has
--    several distinct Event-level roles today), the accepted architecture
--    names exactly one Tenant-level administrative concept -- "Tenant
--    Admin." Adding a single-value enum column to represent a fact
--    already fully carried by the row's existence would be speculative
--    granularity the instruction explicitly says not to add.
-- ---------------------------------------------------------------------------

CREATE TABLE public.admin_tenant_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT admin_tenant_access_unique UNIQUE (admin_user_id, tenant_id)
);

ALTER TABLE public.admin_tenant_access OWNER TO postgres;

CREATE INDEX admin_tenant_access_admin_user_id_idx ON public.admin_tenant_access (admin_user_id);
CREATE INDEX admin_tenant_access_tenant_id_idx ON public.admin_tenant_access (tenant_id) WHERE is_active = true;

ALTER TABLE public.admin_tenant_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_tenant_access FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_tenant_access FROM anon;
REVOKE ALL ON TABLE public.admin_tenant_access FROM authenticated;
REVOKE ALL ON TABLE public.admin_tenant_access FROM service_role;

-- No SELECT grant at all, even to authenticated: this table is who holds
-- Tenant Admin authority, not Tenant-curated content -- a Tenant Admin has
-- no legitimate reason to browse the assignment table itself (they know
-- their own access without reading it back), and cross-Tenant visibility
-- of "who administers Tenant B" is exactly the kind of fact the hierarchy
-- exists to keep Tenant-isolated. Read access is Super Admin only, via a
-- governed RPC (public.list_tenant_admin_access below) rather than a
-- table policy, matching this table's "no direct table access at all"
-- posture more precisely than a permissive SELECT policy would.

-- ---------------------------------------------------------------------------
-- 2. public.has_platform_admin_authority -- centralizes the
--    `privilege_group = 'super_admin' AND is_active` predicate already
--    duplicated inline in public.is_event_scoped_admin (20260805130000)
--    and in the original, now-superseded venue_evidence migration
--    (20260810120000, amended below to call this instead). Identical
--    semantics to those inline checks -- no new meaning invented.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_platform_admin_authority(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = p_auth_user_id
      AND au.is_active = true
      AND au.privilege_group = 'super_admin'
  );
END;
$function$;

ALTER FUNCTION public.has_platform_admin_authority(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_platform_admin_authority(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_platform_admin_authority(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.has_tenant_admin_authority -- TRUE iff active Super Admin, OR
--    an active administrator with an explicit, active admin_tenant_access
--    row for the requested Tenant. NULL/invalid input fails closed to
--    false, never true. An administrator assigned only Tenant A can never
--    satisfy this for Tenant B: the EXISTS clause below matches
--    ata.tenant_id = p_tenant_id exactly, row by row -- there is no
--    fallback branch that would let a Tenant A grant leak into a Tenant B
--    check.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_tenant_admin_authority(
  p_auth_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_auth_user_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_platform_admin_authority(p_auth_user_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_tenant_access AS ata
    JOIN public.admin_users AS au ON au.id = ata.admin_user_id
    WHERE au.user_id = p_auth_user_id
      AND au.is_active = true
      AND ata.tenant_id = p_tenant_id
      AND ata.is_active = true
  );
END;
$function$;

ALTER FUNCTION public.has_tenant_admin_authority(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.has_event_admin_authority -- TRUE iff Super Admin, OR Tenant
--    Admin for the Event's OWN tenant_id (resolved at check time via
--    events.tenant_id -- never materialized into admin_event_access rows,
--    so a new Event under an existing Tenant Admin's tenant is correctly
--    covered the moment it exists, with no synchronization step), OR an
--    existing, unmodified admin_event_access match for that specific
--    Event. Strict superset of public.is_event_scoped_admin's prior
--    logic (see §5).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_event_admin_authority(
  p_auth_user_id uuid,
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_auth_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_platform_admin_authority(p_auth_user_id) THEN
    RETURN true;
  END IF;

  SELECT e.tenant_id INTO v_tenant_id FROM public.events AS e WHERE e.id = p_event_id;

  IF v_tenant_id IS NOT NULL AND public.has_tenant_admin_authority(p_auth_user_id, v_tenant_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    JOIN public.admin_event_access AS aea ON aea.admin_user_id = au.id
    WHERE au.user_id = p_auth_user_id
      AND au.is_active = true
      AND aea.event_id = p_event_id
  );
END;
$function$;

ALTER FUNCTION public.has_event_admin_authority(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_event_admin_authority(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_event_admin_authority(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.is_event_scoped_admin -- redefined (CREATE OR REPLACE, same
--    exact signature the historical 20260805130000 migration created) to
--    delegate to public.has_event_admin_authority. Every prior caller
--    (event_photos, event_evaluations, event_evaluation_answers,
--    record_participant_capacity_increase x2) keeps working unchanged --
--    the old body was exactly the Super-Admin-unconditional /
--    admin_event_access-match logic that is now the last two branches of
--    has_event_admin_authority, so every case that returned true before
--    still returns true. The only behavior change is additive: a Tenant
--    Admin for that Event's Tenant now also returns true, which is the
--    explicitly intended inheritance, not a side effect.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_event_scoped_admin(
  p_auth_user_id uuid,
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
BEGIN
  RETURN public.has_event_admin_authority(p_auth_user_id, p_event_id);
END;
$$;

ALTER FUNCTION public.is_event_scoped_admin(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_event_scoped_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_scoped_admin(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Governed grant/revoke + read RPCs for public.admin_tenant_access.
--    Without these the table would be entirely inert (no direct grant
--    exists, per §1) -- a Tenant Admin assignment could never actually be
--    created. Both Super Admin only; this stage does not ship an admin UI
--    for managing Tenant Admin assignments, only the callable primitive.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_tenant_admin_access(
  p_admin_user_id uuid,
  p_tenant_id uuid,
  p_is_active boolean,
  p_granted_by text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'set_tenant_admin_access: caller is not an active super_admin';
  END IF;

  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active, created_by)
  VALUES (p_admin_user_id, p_tenant_id, COALESCE(p_is_active, true), COALESCE(p_granted_by, auth.uid()::text))
  ON CONFLICT (admin_user_id, tenant_id)
  DO UPDATE SET is_active = EXCLUDED.is_active;
END;
$function$;

ALTER FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tenant_admin_access(p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, admin_user_id uuid, tenant_id uuid, is_active boolean,
  created_at timestamptz, created_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'list_tenant_admin_access: caller is not an active super_admin';
  END IF;

  RETURN QUERY
  SELECT ata.id, ata.admin_user_id, ata.tenant_id, ata.is_active, ata.created_at, ata.created_by
  FROM public.admin_tenant_access AS ata
  WHERE p_tenant_id IS NULL OR ata.tenant_id = p_tenant_id
  ORDER BY ata.created_at DESC;
END;
$function$;

ALTER FUNCTION public.list_tenant_admin_access(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_tenant_admin_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_access(uuid) TO authenticated;
