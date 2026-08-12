-- Photo/Media Authority Foundation Stage 2: Governed Photo Management &
-- Storage Security Repair. Implements the canonical Event-scoped
-- event.photos.manage authority established by Stage 1's audit, closes
-- the direct Admin event_photos UPDATE path, and repairs the live
-- event-photos storage.objects policies (which Stage 1 found were never
-- tracked by any migration and permitted unauthenticated arbitrary
-- upload/read/delete). Member upload/read/delete-own-pending and public
-- approved-photo viewing are deliberately left untouched -- both at the
-- event_photos RLS layer and, now, at the storage layer.
BEGIN;

-- ============================================================
-- 1. Task registry. event.photos.manage and event.photos.delete, same
-- shape as every other event-scope task (platform_inherits=true,
-- tenant_inherits=true, event_assignment_grantable=true). delete is
-- registered but deliberately left unassigned to any profile -- no
-- Admin delete UI or workflow exists yet (Stage 1 finding), and Part 3
-- of this stage explicitly forbids auto-granting it alongside manage.
-- ============================================================

INSERT INTO public.admin_task_registry
  (task_key, scope, task_kind, description, platform_inherits, tenant_inherits, event_assignment_grantable)
VALUES
  ('event.photos.manage', 'event', 'mutation',
   'Moderate and administer Event photos: approve/reject, admin caption, show-caption, featured level.',
   true, true, true),
  ('event.photos.delete', 'event', 'mutation',
   'Delete Event photo metadata. Unassigned pending a future explicit delete workflow.',
   true, true, true);

-- Profile mapping for event.photos.manage: today's legacy authority
-- (is_event_scoped_admin) grants photo access to ANY admin with an
-- Event assignment, regardless of profile -- but that is a side effect
-- of a coarse "has an access row" check, not a deliberate per-profile
-- decision, and view_only's own name/definition ("Read-only Event
-- default bundle") forecloses giving it any mutation task. Mapped here
-- only to the two profiles with direct structural/thematic evidence:
-- event_admin (whose own bundle definition in 20260811170000 is "every
-- event-scope task except validation_rules.manage" -- a wildcard this
-- INSERT extends by direct precedent) and content (already owns
-- agenda/announcements/locations/nearby -- the other public-facing,
-- member-visible Event content domains). checkin and parking are
-- narrowly-scoped operational bundles with no thematic connection to
-- photo moderation and are deliberately NOT granted this task, even
-- though legacy behavior today would have allowed it. This is a real,
-- intentional narrowing versus current behavior -- reported as such.
INSERT INTO public.admin_event_profile_tasks (profile_key, task_key) VALUES
  ('event_admin', 'event.photos.manage'),
  ('content', 'event.photos.manage');

-- ============================================================
-- 2. Dedicated immutable photo command audit. agenda_command_ledger and
-- admin_authority_audit are both semantically wrong hosts (Event/
-- template-command-specific and authority-grant-specific respectively,
-- per this project's established precedent) -- mirrors
-- agenda_category_command_audit's shape exactly. One generic
-- 'photo_updated' action is sufficient: every governed mutation this
-- stage supports is a single atomic multi-field UPDATE, not several
-- independent commands.
-- ============================================================

CREATE TABLE public.event_photo_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL,
  event_id uuid NOT NULL,
  actor_auth_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('photo_updated')),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_photo_command_audit_photo_idx
  ON public.event_photo_command_audit (photo_id, occurred_at DESC);
CREATE INDEX event_photo_command_audit_event_idx
  ON public.event_photo_command_audit (event_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_event_photo_command_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'event_photo_command_audit is immutable';
END;
$$;

CREATE TRIGGER prevent_event_photo_command_audit_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.event_photo_command_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_event_photo_command_audit_mutation();

ALTER TABLE public.event_photo_command_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_photo_command_audit FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 3. Governed mutation RPC. Signature extends Part 5's conceptual form
-- with p_member_caption: Stage 1 found Photo Library's existing (pre-
-- this-stage) direct-write behavior already lets an admin edit
-- member_caption, a capability Admin Photos never had a field for but
-- which this shared RPC must not silently drop for Photo Library.
-- Admin Photos passes the photo's own current member_caption straight
-- through unchanged (it has no UI for editing it), so this is schema
-- carry-through, not a new capability for either page.
-- ============================================================

CREATE OR REPLACE FUNCTION public.manage_event_photo(
  p_photo_id uuid,
  p_photo_status text,
  p_member_caption text,
  p_admin_caption text,
  p_show_caption boolean,
  p_featured_level integer
)
RETURNS public.event_photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_before public.event_photos%ROWTYPE;
  v_after public.event_photos%ROWTYPE;
  v_is_featured boolean;
BEGIN
  SELECT * INTO v_before FROM public.event_photos WHERE id = p_photo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found';
  END IF;

  v_event_id := v_before.event_id;

  IF NOT public.has_event_task_authority('event.photos.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_photo_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF p_featured_level IS NULL OR p_featured_level < 0 OR p_featured_level > 3 THEN
    RAISE EXCEPTION 'invalid_featured_level';
  END IF;

  v_is_featured := p_featured_level > 0;

  UPDATE public.event_photos
  SET
    photo_status = p_photo_status,
    member_caption = p_member_caption,
    admin_caption = p_admin_caption,
    show_caption = coalesce(p_show_caption, show_caption),
    featured_level = p_featured_level,
    is_featured = v_is_featured,
    updated_at = now()
  WHERE id = p_photo_id
  RETURNING * INTO v_after;

  INSERT INTO public.event_photo_command_audit
    (photo_id, event_id, actor_auth_user_id, action, before_state, after_state)
  VALUES (
    p_photo_id, v_event_id, auth.uid(), 'photo_updated',
    jsonb_build_object(
      'photo_status', v_before.photo_status, 'member_caption', v_before.member_caption,
      'admin_caption', v_before.admin_caption, 'show_caption', v_before.show_caption,
      'featured_level', v_before.featured_level, 'is_featured', v_before.is_featured
    ),
    jsonb_build_object(
      'photo_status', v_after.photo_status, 'member_caption', v_after.member_caption,
      'admin_caption', v_after.admin_caption, 'show_caption', v_after.show_caption,
      'featured_level', v_after.featured_level, 'is_featured', v_after.is_featured
    )
  );

  RETURN v_after;
END;
$$;

ALTER FUNCTION public.manage_event_photo(uuid, text, text, text, boolean, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manage_event_photo(uuid, text, text, text, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_event_photo(uuid, text, text, text, boolean, integer) TO authenticated;

-- ============================================================
-- 4. Direct metadata write closure. Member INSERT/DELETE/SELECT paths
-- are untouched (event_photos_member_insert_policy,
-- event_photos_member_delete_own_pending_policy, both SELECT policies).
-- Only the Admin UPDATE path closes -- Admin routine mutation now goes
-- exclusively through manage_event_photo, which bypasses RLS via
-- SECURITY DEFINER table-owner privilege, matching this codebase's
-- established closure pattern (agenda_items, agenda_categories).
-- ============================================================

DROP POLICY event_photos_admin_update_policy ON public.event_photos;
REVOKE UPDATE ON TABLE public.event_photos FROM authenticated, anon, service_role;

-- ============================================================
-- 5. Storage authorization helpers. Three narrow, single-purpose,
-- SECURITY DEFINER functions connecting a storage.objects path to its
-- event_photos row -- the same "minimum SQL-callable door onto already-
-- governed facts" pattern is_own_attendee/is_event_scoped_admin
-- established in 20260805130000, applied here to storage for the first
-- time. Split by role (anon-only vs authenticated-only) for the same
-- reason that migration split its own SELECT policies: a combined
-- policy naming both roles would force EXECUTE grants onto anon for
-- branches anon should never reach.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_approved_event_photo_object(p_object_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_photos
    WHERE storage_path = p_object_name AND photo_status = 'approved'
  );
$$;

-- Two-branch check, not just a metadata-row lookup. `storage.objects`
-- INSERT ... RETURNING (used by Supabase's own upload client under the
-- hood) requires the freshly-inserted row to also pass a SELECT policy
-- to be returned -- but real Member uploads write the storage object
-- BEFORE the corresponding event_photos row exists (app/member/photos/
-- page.tsx: storage.upload() runs first, the metadata insert follows).
-- Without the second branch, that ordering would make every real upload
-- fail its own read-back. The second branch reuses the exact same
-- path-derived ownership rule as can_upload_event_photo_object, so the
-- window where a caller can read their own object with no metadata row
-- yet is exactly as narrow as upload authority already is -- no broader
-- than that.
CREATE OR REPLACE FUNCTION public.can_authenticated_read_event_photo_object(
  p_auth_user_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_parts text[];
  v_event_id uuid;
  v_attendee_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.event_photos ep
    WHERE ep.storage_path = p_object_name
      AND (
        ep.photo_status = 'approved'
        OR public.is_own_attendee(p_auth_user_id, ep.attendee_id, ep.event_id)
        OR public.is_event_scoped_admin(p_auth_user_id, ep.event_id)
      )
  ) THEN
    RETURN true;
  END IF;

  v_parts := string_to_array(p_object_name, '/');
  IF array_length(v_parts, 1) IS NULL OR array_length(v_parts, 1) < 3 THEN
    RETURN false;
  END IF;

  BEGIN
    v_event_id := v_parts[1]::uuid;
    v_attendee_id := v_parts[2]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN public.is_own_attendee(p_auth_user_id, v_attendee_id, v_event_id);
END;
$$;

-- Parses the object path's first two segments as event_id/attendee_id
-- (the convention Member upload already writes:
-- `${eventId}/${attendeeId}/${uniqueId}.${ext}`) and requires them to
-- match a real is_own_attendee relationship -- so a caller cannot
-- upload under any Event/attendee pairing except their own, regardless
-- of what path string they submit. Malformed paths (wrong segment
-- count, non-uuid segments) fail closed rather than raising, so a
-- weird path is simply denied, not a policy-evaluation error.
CREATE OR REPLACE FUNCTION public.can_upload_event_photo_object(
  p_auth_user_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_parts text[];
  v_event_id uuid;
  v_attendee_id uuid;
BEGIN
  IF p_auth_user_id IS NULL OR p_object_name IS NULL THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(p_object_name, '/');
  IF array_length(v_parts, 1) IS NULL OR array_length(v_parts, 1) < 3 THEN
    RETURN false;
  END IF;

  BEGIN
    v_event_id := v_parts[1]::uuid;
    v_attendee_id := v_parts[2]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN public.is_own_attendee(p_auth_user_id, v_attendee_id, v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_delete_own_pending_event_photo_object(
  p_auth_user_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_photos ep
    WHERE ep.storage_path = p_object_name
      AND ep.photo_status = 'pending'
      AND public.is_own_attendee(p_auth_user_id, ep.attendee_id, ep.event_id)
  );
$$;

ALTER FUNCTION public.is_approved_event_photo_object(text) OWNER TO postgres;
ALTER FUNCTION public.can_authenticated_read_event_photo_object(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.can_upload_event_photo_object(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.can_delete_own_pending_event_photo_object(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_approved_event_photo_object(text) FROM PUBLIC, service_role;
REVOKE ALL ON FUNCTION public.can_authenticated_read_event_photo_object(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.can_upload_event_photo_object(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.can_delete_own_pending_event_photo_object(uuid, text) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.is_approved_event_photo_object(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_authenticated_read_event_photo_object(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_upload_event_photo_object(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_own_pending_event_photo_object(uuid, text) TO authenticated;

-- ============================================================
-- 6. Storage policy repair. Drops the six untracked, out-of-band
-- policies Stage 1 found scoped only to `bucket_id = 'event-photos'`
-- with no other constraint (verified by exact name below -- these
-- names are scoped to this bucket only and do not touch the separate,
-- distinctly-named policies for event-assets/vendor-assets/
-- master-map-images). No UPDATE policy existed before and none is
-- added now -- objects remain write-once/delete-only, unchanged.
-- Anonymous upload and anonymous delete are removed entirely: Stage 1
-- found no legitimate unauthenticated upload/delete workflow.
-- ============================================================

DROP POLICY "Anonymous upload event photos" ON storage.objects;
DROP POLICY "Authenticated users can upload event photos" ON storage.objects;
DROP POLICY "Anonymous delete event photos 1rdror8_0" ON storage.objects;
DROP POLICY "Anonymous delete event photos 1rdror8_1" ON storage.objects;
DROP POLICY "Anonymous view event photos 1rdror8_0" ON storage.objects;
DROP POLICY "Authenticated users can view their event photos" ON storage.objects;

CREATE POLICY event_photos_object_member_upload_policy
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'event-photos'
    AND public.can_upload_event_photo_object(auth.uid(), name)
  );

CREATE POLICY event_photos_object_public_approved_read_policy
  ON storage.objects
  FOR SELECT
  TO anon
  USING (
    bucket_id = 'event-photos'
    AND public.is_approved_event_photo_object(name)
  );

CREATE POLICY event_photos_object_authenticated_read_policy
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'event-photos'
    AND public.can_authenticated_read_event_photo_object(auth.uid(), name)
  );

CREATE POLICY event_photos_object_member_delete_pending_policy
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'event-photos'
    AND public.can_delete_own_pending_event_photo_object(auth.uid(), name)
  );

COMMIT;
