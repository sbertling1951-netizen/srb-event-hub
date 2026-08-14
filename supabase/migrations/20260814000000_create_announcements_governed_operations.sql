-- Announcements Governed Mutation Security Repair.
--
-- Confirmed defect (LEM Announcements Mutation Audit, 2026-08-13):
-- public.announcements had zero mutation RPCs -- the admin UI wrote
-- directly to the table via the browser Supabase client -- and the only
-- RLS policy permitting INSERT/UPDATE/DELETE was "allow all
-- announcements" (cmd=ALL, roles={public}, qual=true, with_check=true),
-- combined with anon/authenticated/service_role all holding raw
-- INSERT/UPDATE/DELETE/TRUNCATE table grants. The client-side
-- `can_manage_announcements` check (AdminRouteGuard) is a UI render
-- gate only and enforces nothing at the database. Net effect: any
-- request reaching PostgREST for this table -- authenticated or not --
-- could mutate any announcement for any Event, entirely bypassing both
-- the legacy admin_permissions flag and the canonical per-Event
-- Authority system.
--
-- This migration closes that gap using the exact pattern already
-- established for Agenda (20260811280000+): a small SECURITY DEFINER
-- RPC choke point per verb, gated by the canonical
-- has_event_task_authority('event.announcements.manage', event_id) --
-- already registered in admin_task_registry
-- (20260811170000_create_scoped_task_authority_foundation.sql) with the
-- same platform_inherits/tenant_inherits/event_assignment_grantable
-- flags as event.agenda.manage -- followed immediately by the Stage 3A
-- Lifecycle guard, public.assert_event_lifecycle_mutable(event_id)
-- (20260813170000). Authority is established first and is completely
-- unmodified; Lifecycle is layered on after, exactly as in every other
-- Stage 3A-gated domain. No second Authority system is introduced.
--
-- Toggling published/pinned reuses update_event_announcement -- the
-- same UPDATE the browser already issued for those actions, just
-- server-side and governed now -- rather than adding two more
-- single-field RPCs. This is the smallest coherent surface that
-- replaces all five existing browser writes (create, edit, toggle
-- published, toggle pinned, delete) without inventing new behavior.
--
-- All four existing read paths (app/announcements/page.tsx,
-- app/member/announcements/page.tsx, components/AnnouncementBanner.tsx,
-- lib/experienceContext/providers/announcementsProvider.ts) are
-- untouched: this migration drops only the one ALL-command policy that
-- permitted mutation; the three existing SELECT policies ("Members can
-- view published announcements", "Public read announcements", "public
-- read announcements" -- all open to anon and/or authenticated with no
-- narrower predicate than what those four consumers already rely on)
-- are not touched, so read access is unchanged.

BEGIN;

-- ============================================================
-- Governed mutation RPCs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_event_announcement(
  p_event_id uuid,
  p_title text,
  p_body text,
  p_priority text DEFAULT 'normal',
  p_is_pinned boolean DEFAULT false,
  p_is_published boolean DEFAULT true,
  p_expire_at timestamptz DEFAULT NULL
)
RETURNS public.announcements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.announcements%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.announcements.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  IF NOT EXISTS (SELECT 1 FROM public.events AS e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  INSERT INTO public.announcements(
    event_id, title, body, priority, is_pinned, is_published, expire_at
  ) VALUES (
    p_event_id, btrim(p_title), btrim(p_body), coalesce(p_priority, 'normal'),
    coalesce(p_is_pinned, false), coalesce(p_is_published, true), p_expire_at
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_event_announcement(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_priority text DEFAULT 'normal',
  p_is_pinned boolean DEFAULT false,
  p_is_published boolean DEFAULT true,
  p_expire_at timestamptz DEFAULT NULL
)
RETURNS public.announcements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_row public.announcements%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Event scope is derived from the existing row, never accepted as a
  -- parameter -- structurally prevents moving an announcement across
  -- Events, matching update_event_agenda_item's precedent.
  SELECT a.event_id INTO v_event_id FROM public.announcements AS a WHERE a.id = p_announcement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement not found';
  END IF;

  IF NOT public.has_event_task_authority('event.announcements.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'malformed_row';
  END IF;

  UPDATE public.announcements AS a
  SET title = btrim(p_title), body = btrim(p_body), priority = coalesce(p_priority, 'normal'),
      is_pinned = coalesce(p_is_pinned, false), is_published = coalesce(p_is_published, true),
      expire_at = p_expire_at, updated_at = now()
  WHERE a.id = p_announcement_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_event_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT a.event_id INTO v_event_id FROM public.announcements AS a WHERE a.id = p_announcement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement not found';
  END IF;

  IF NOT public.has_event_task_authority('event.announcements.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  DELETE FROM public.announcements AS a WHERE a.id = p_announcement_id;
END;
$$;

ALTER FUNCTION public.create_event_announcement(uuid, text, text, text, boolean, boolean, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.update_event_announcement(uuid, text, text, text, boolean, boolean, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.delete_event_announcement(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_event_announcement(uuid, text, text, text, boolean, boolean, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_event_announcement(uuid, text, text, text, boolean, boolean, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.update_event_announcement(uuid, text, text, text, boolean, boolean, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_event_announcement(uuid, text, text, text, boolean, boolean, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_event_announcement(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_event_announcement(uuid) TO authenticated;

-- ============================================================
-- Close the direct-write surface. The three existing SELECT policies
-- are not touched by this migration -- read access is unchanged.
--
-- service_role is included in this REVOKE alongside anon/authenticated
-- (LEM Announcements Service-Role Boundary Check, 2026-08-13): grepping
-- every server/backend use of the service-role Supabase client
-- (lib/server/supabaseAdmin.ts and its callers) finds no read or write
-- of public.announcements anywhere in the repository -- the one
-- "announcements" hit under lib/server/ (adminAuthz.ts) is an unrelated
-- admin_permissions boolean-flag key, not a table access. Live ACL
-- confirms service_role's existing INSERT/UPDATE/DELETE/TRUNCATE on
-- this table is an explicit direct grant on the table itself
-- (relacl: service_role=arwdDxtm/postgres), not inherited through role
-- membership (service_role belongs to no other role) and not a
-- default-privilege artifact -- so this REVOKE fully and permanently
-- closes it, with nothing left to silently restore it. service_role's
-- rolbypassrls=true is a separate control (RLS-bypass, evaluated only
-- if a statement is attempted at all) and does not grant or imply any
-- object-level table privilege on its own -- it does not substitute for
-- this REVOKE, and this REVOKE does not touch it. service_role has no
-- required Announcements mutation path; least privilege closes that
-- object-level mutation surface.
-- ============================================================

DROP POLICY IF EXISTS "allow all announcements" ON public.announcements;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.announcements
FROM anon, authenticated, service_role;

COMMIT;
