-- Closes a confirmed, live production exposure: public.event_photos,
-- public.event_evaluations, and public.event_evaluation_answers currently
-- carry RLS policies that are unconditional `USING (true)` / `WITH CHECK
-- (true)` (applied directly to production outside any migration file --
-- none of the policies dropped below exist in any prior migration). Any
-- authenticated member -- and for these three tables, even an unauthenticated
-- request -- can read, create, or modify any row for any attendee_id/event_id
-- today, entirely independent of what the member-facing pages do in the
-- browser.
--
-- This migration replaces those policies with ones that independently
-- resolve the caller's own governed identity and Event scope, reusing the
-- existing resolve_auth_person_link(uuid) primitive and the existing
-- attendees.person_id / attendees.event_id bridge -- the same governed
-- ownership chain already used throughout this project's other member
-- write boundaries. It does not touch resolve_auth_person_link itself.
--
-- resolve_auth_person_link is REVOKE ALL FROM PUBLIC, anon, authenticated,
-- service_role -- only callable from another postgres-owned SECURITY
-- DEFINER function. RLS policy USING/WITH CHECK clauses evaluate as the
-- querying role (authenticated), not as postgres, so they cannot call it
-- directly. The same is true for "is this admin scoped to this Event" --
-- no SQL-callable equivalent of the existing client-side canAccessEvent()
-- helper (lib/getCurrentAdminAccess.ts) exists today. This migration adds
-- exactly two narrow, single-purpose, RLS-callable helper functions for
-- these reasons -- not a second Person resolver, and not a duplicate of
-- canAccessEvent()'s logic, but the minimum SQL-callable door onto the same
-- already-governed facts, mirroring the is_my_vendor_service_request
-- pattern already established in this codebase
-- (20260804160000_create_governed_member_vendor_request_boundary.sql).

-- ---------------------------------------------------------------------------
-- 1. public.is_own_attendee
--
--    True only when the calling auth user resolves, through the existing
--    governed resolver, to exactly one Person, and that Person owns the
--    given attendee_id, and that attendee's own event_id matches the event
--    the caller is asserting -- so a mismatched attendee/event pairing
--    (not just attendee ownership alone) is required to pass. Returns
--    false, never an error, for a NULL caller (anon) or any unresolved/
--    ambiguous identity -- this function fails closed by construction.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.is_own_attendee(
  p_auth_user_id uuid,
  p_attendee_id uuid,
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_person_id uuid;
BEGIN
  IF p_auth_user_id IS NULL OR p_attendee_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT link.person_id
    INTO v_person_id
  FROM public.resolve_auth_person_link(p_auth_user_id) AS link
  WHERE link.status = 'resolved';

  IF v_person_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.attendees AS a
    WHERE a.id = p_attendee_id
      AND a.person_id = v_person_id
      AND a.event_id = p_event_id
  );
END;
$$;

ALTER FUNCTION public.is_own_attendee(uuid, uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_own_attendee(uuid, uuid, uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_own_attendee(uuid, uuid, uuid)
FROM anon;
REVOKE ALL ON FUNCTION public.is_own_attendee(uuid, uuid, uuid)
FROM service_role;

GRANT EXECUTE ON FUNCTION public.is_own_attendee(uuid, uuid, uuid)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.is_event_scoped_admin
--
--    Mirrors lib/getCurrentAdminAccess.ts's existing canAccessEvent()
--    exactly: true when the caller is an active admin_users row with
--    privilege_group = 'super_admin' (unconditionally, matching
--    canAccessEvent's own "isSuperAdmin short-circuits" behavior), or when
--    an admin_event_access row ties that admin to the given event_id. It
--    is not a new authority model -- it is the existing, already-accepted
--    admin/Event-scope rule made callable from an RLS policy, which reads
--    admin_users/admin_event_access as its SECURITY DEFINER owner
--    regardless of the caller's own grants on those tables.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.is_event_scoped_admin(
  p_auth_user_id uuid,
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_admin_id uuid;
  v_privilege_group text;
BEGIN
  IF p_auth_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT au.id, au.privilege_group
    INTO v_admin_id, v_privilege_group
  FROM public.admin_users AS au
  WHERE au.user_id = p_auth_user_id
    AND au.is_active = true;

  IF v_admin_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_privilege_group = 'super_admin' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_event_access AS aea
    WHERE aea.admin_user_id = v_admin_id
      AND aea.event_id = p_event_id
  );
END;
$$;

ALTER FUNCTION public.is_event_scoped_admin(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_event_scoped_admin(uuid, uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_event_scoped_admin(uuid, uuid)
FROM anon;
REVOKE ALL ON FUNCTION public.is_event_scoped_admin(uuid, uuid)
FROM service_role;

GRANT EXECUTE ON FUNCTION public.is_event_scoped_admin(uuid, uuid)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.event_photos
--
--    Preserves the existing, legitimate "approved Event gallery" behavior
--    (app/member/photos/page.tsx's shared gallery panel;
--    app/slideshow/view/page.tsx's unauthenticated kiosk display;
--    record_photo_display, untouched) for anon and authenticated alike,
--    scoped to photo_status = 'approved' -- previously unenforced by RLS at
--    all. Every other read/write narrows to the owning attendee or an
--    Event-scoped admin. None of these three tables ever received a
--    table-level GRANT in any tracked migration -- their current broad
--    production grants were applied out-of-band, outside migration
--    history. This migration is therefore the first to establish tracked
--    grants for them, sized exactly to the access matrix above: anon gets
--    SELECT only (the approved-gallery read); authenticated gets the full
--    set its policies already narrow by row.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.event_photos FROM PUBLIC;
REVOKE ALL ON TABLE public.event_photos FROM anon;
REVOKE ALL ON TABLE public.event_photos FROM authenticated;

GRANT SELECT ON TABLE public.event_photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_photos TO authenticated;

ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anonymous photo deletes" ON public.event_photos;
DROP POLICY IF EXISTS "Anonymous photo inserts" ON public.event_photos;
DROP POLICY IF EXISTS "Anonymous photo reads" ON public.event_photos;
DROP POLICY IF EXISTS "Authenticated photo inserts" ON public.event_photos;
DROP POLICY IF EXISTS "Authenticated photo updates" ON public.event_photos;

-- Split into two policies deliberately: RLS checks EXECUTE privilege on
-- every function a policy's USING clause references for the querying role
-- at plan time, regardless of short-circuiting -- a single combined policy
-- naming both anon and authenticated would require granting anon EXECUTE
-- on is_own_attendee/is_event_scoped_admin merely to reach the
-- photo_status branch, which is wrong in principle (anon has no identity
-- to own anything or administer anything) and was caught by this
-- migration's own local fresh-replay validation.
CREATE POLICY event_photos_public_select_policy
  ON public.event_photos
  FOR SELECT
  TO anon, authenticated
  USING (photo_status = 'approved');

CREATE POLICY event_photos_owner_or_admin_select_policy
  ON public.event_photos
  FOR SELECT
  TO authenticated
  USING (
    public.is_own_attendee(auth.uid(), attendee_id, event_id)
    OR public.is_event_scoped_admin(auth.uid(), event_id)
  );

CREATE POLICY event_photos_member_insert_policy
  ON public.event_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_own_attendee(auth.uid(), attendee_id, event_id)
    AND photo_status = 'pending'
    AND coalesce(is_featured, false) = false
    AND coalesce(featured_level, 0) = 0
  );

CREATE POLICY event_photos_admin_update_policy
  ON public.event_photos
  FOR UPDATE
  TO authenticated
  USING (public.is_event_scoped_admin(auth.uid(), event_id))
  WITH CHECK (public.is_event_scoped_admin(auth.uid(), event_id));

CREATE POLICY event_photos_member_delete_own_pending_policy
  ON public.event_photos
  FOR DELETE
  TO authenticated
  USING (
    public.is_own_attendee(auth.uid(), attendee_id, event_id)
    AND photo_status = 'pending'
  );

-- ---------------------------------------------------------------------------
-- 4. public.event_evaluations
--
--    No legitimate cross-attendee or anonymous use case was found for
--    evaluations (private feedback, not a shared gallery). anon is fully
--    revoked; every remaining operation resolves to the owning attendee or
--    an Event-scoped admin (admin read-only -- no admin write consumer
--    exists today). As with event_photos, no tracked migration ever
--    granted this table to any role; this migration establishes the
--    tracked grant now, to authenticated only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.event_evaluations FROM PUBLIC;
REVOKE ALL ON TABLE public.event_evaluations FROM anon;
REVOKE ALL ON TABLE public.event_evaluations FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.event_evaluations TO authenticated;

ALTER TABLE public.event_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event evaluations insert" ON public.event_evaluations;
DROP POLICY IF EXISTS "event evaluations select" ON public.event_evaluations;
DROP POLICY IF EXISTS "event evaluations update" ON public.event_evaluations;

CREATE POLICY event_evaluations_select_policy
  ON public.event_evaluations
  FOR SELECT
  TO authenticated
  USING (
    public.is_own_attendee(auth.uid(), attendee_id, event_id)
    OR public.is_event_scoped_admin(auth.uid(), event_id)
  );

CREATE POLICY event_evaluations_member_insert_policy
  ON public.event_evaluations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_own_attendee(auth.uid(), attendee_id, event_id));

CREATE POLICY event_evaluations_member_update_policy
  ON public.event_evaluations
  FOR UPDATE
  TO authenticated
  USING (public.is_own_attendee(auth.uid(), attendee_id, event_id))
  WITH CHECK (public.is_own_attendee(auth.uid(), attendee_id, event_id));

-- ---------------------------------------------------------------------------
-- 5. public.event_evaluation_answers
--
--    Carries no event_id/attendee_id of its own -- ownership is proven only
--    through its parent event_evaluations row, so every policy joins
--    through evaluation_id and applies the identical ownership predicate
--    used on the parent table itself (never a looser one), satisfying both
--    "answers must not be more permissive than their parent" and "answers
--    must be tied to a parent the caller is authorized to access."
--    Same as the two tables above, this migration establishes its first
--    tracked grant, to authenticated only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.event_evaluation_answers FROM PUBLIC;
REVOKE ALL ON TABLE public.event_evaluation_answers FROM anon;
REVOKE ALL ON TABLE public.event_evaluation_answers FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.event_evaluation_answers TO authenticated;

ALTER TABLE public.event_evaluation_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evaluation answers insert" ON public.event_evaluation_answers;
DROP POLICY IF EXISTS "evaluation answers select" ON public.event_evaluation_answers;
DROP POLICY IF EXISTS "evaluation answers update" ON public.event_evaluation_answers;

CREATE POLICY event_evaluation_answers_select_policy
  ON public.event_evaluation_answers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_evaluations AS ee
      WHERE ee.id = event_evaluation_answers.evaluation_id
        AND (
          public.is_own_attendee(auth.uid(), ee.attendee_id, ee.event_id)
          OR public.is_event_scoped_admin(auth.uid(), ee.event_id)
        )
    )
  );

CREATE POLICY event_evaluation_answers_member_insert_policy
  ON public.event_evaluation_answers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_evaluations AS ee
      WHERE ee.id = event_evaluation_answers.evaluation_id
        AND public.is_own_attendee(auth.uid(), ee.attendee_id, ee.event_id)
    )
  );

CREATE POLICY event_evaluation_answers_member_update_policy
  ON public.event_evaluation_answers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_evaluations AS ee
      WHERE ee.id = event_evaluation_answers.evaluation_id
        AND public.is_own_attendee(auth.uid(), ee.attendee_id, ee.event_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_evaluations AS ee
      WHERE ee.id = event_evaluation_answers.evaluation_id
        AND public.is_own_attendee(auth.uid(), ee.attendee_id, ee.event_id)
    )
  );
