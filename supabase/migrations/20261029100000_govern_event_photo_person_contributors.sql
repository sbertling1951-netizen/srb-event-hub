BEGIN;

ALTER TABLE public.event_photos
  ADD COLUMN IF NOT EXISTS contributor_person_id uuid
    REFERENCES public.people(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS event_photos_contributor_person_idx
  ON public.event_photos (contributor_person_id);

CREATE OR REPLACE FUNCTION public.resolve_event_photo_contributor(
  p_event_id uuid,
  p_attendee_id uuid
)
RETURNS TABLE(
  contributor_person_id uuid,
  photographer_name_snapshot text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_person_id uuid;
  v_match_count integer;
BEGIN
  IF p_event_id IS NULL OR p_attendee_id IS NULL OR auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT link.person_id
    INTO v_person_id
  FROM public.resolve_auth_person_link(auth.uid()) AS link
  WHERE link.status = 'resolved';

  IF v_person_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(DISTINCT a.id)
    INTO v_match_count
  FROM public.person_event_participations AS pep
  JOIN public.person_role_instances AS pri
    ON pri.person_id = pep.person_id
   AND pri.event_id = pep.event_id
  JOIN public.attendees AS a
    ON a.id = pri.attendee_id
   AND a.event_id = pep.event_id
  JOIN public.events AS e
    ON e.id = pep.event_id
  WHERE pep.person_id = v_person_id
    AND pep.event_id = p_event_id
    AND pep.participation_state = 'eligible'
    AND a.id = p_attendee_id
    AND coalesce(a.is_active, true) = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND NOT public.is_self_service_private_draft_event(e.id);

  IF v_match_count <> 1 THEN
    RETURN;
  END IF;

  contributor_person_id := v_person_id;
  SELECT nullif(btrim(concat_ws(' ', p.display_first_name, p.display_last_name)), '')
    INTO photographer_name_snapshot
  FROM public.people AS p
  WHERE p.id = v_person_id
    AND p.status = 'active'
    AND p.merged_into_person_id IS NULL;

  IF photographer_name_snapshot IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text;
    RETURN;
  END IF;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.resolve_event_photo_contributor(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_event_photo_contributor(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_event_photo_contributor(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.is_event_photo_contributor(
  p_auth_user_id uuid,
  p_contributor_person_id uuid,
  p_event_id uuid,
  p_attendee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_person_id uuid;
BEGIN
  IF p_auth_user_id IS NULL
    OR p_contributor_person_id IS NULL
    OR p_event_id IS NULL
    OR p_attendee_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT link.person_id
    INTO v_person_id
  FROM public.resolve_auth_person_link(p_auth_user_id) AS link
  WHERE link.status = 'resolved';

  IF v_person_id IS NULL OR v_person_id <> p_contributor_person_id THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.person_event_participations AS pep
    JOIN public.person_role_instances AS pri
      ON pri.person_id = pep.person_id
     AND pri.event_id = pep.event_id
    JOIN public.attendees AS a
      ON a.id = pri.attendee_id
     AND a.event_id = pep.event_id
    WHERE pep.person_id = p_contributor_person_id
      AND pep.event_id = p_event_id
      AND pep.participation_state = 'eligible'
      AND a.id = p_attendee_id
      AND coalesce(a.is_active, true) = true
      AND NOT public.is_self_service_private_draft_event(pep.event_id)
  );
END;
$$;

ALTER FUNCTION public.is_event_photo_contributor(uuid, uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_event_photo_contributor(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_event_photo_contributor(uuid, uuid, uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_event_photo_contributor_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_name text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.attendee_id IS DISTINCT FROM OLD.attendee_id
      OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.contributor_person_id IS DISTINCT FROM OLD.contributor_person_id
      OR NEW.photographer_name_snapshot IS DISTINCT FROM OLD.photographer_name_snapshot THEN
      RAISE EXCEPTION 'event photo contributor binding is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.contributor_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT nullif(btrim(concat_ws(' ', p.display_first_name, p.display_last_name)), '')
    INTO v_name
  FROM public.people AS p
  WHERE p.id = NEW.contributor_person_id
    AND p.status = 'active'
    AND p.merged_into_person_id IS NULL;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'event photo contributor is not an active canonical Person';
  END IF;

  NEW.photographer_name_snapshot := v_name;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.set_event_photo_contributor_snapshot() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_event_photo_contributor_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_event_photo_contributor_snapshot
  ON public.event_photos;
CREATE TRIGGER set_event_photo_contributor_snapshot
BEFORE INSERT OR UPDATE ON public.event_photos
FOR EACH ROW EXECUTE FUNCTION public.set_event_photo_contributor_snapshot();

DROP POLICY IF EXISTS event_photos_event_scoped_approved_select_policy
  ON public.event_photos;
CREATE POLICY event_photos_event_scoped_approved_select_policy
  ON public.event_photos
  FOR SELECT TO authenticated
  USING (
    photo_status = 'approved'
    AND public.is_canonical_event_photo_path(event_id, attendee_id, storage_path)
    AND NOT public.is_self_service_private_draft_event(event_id)
    AND (
      public.is_authenticated_attendee_of_event(auth.uid(), event_id)
      OR public.is_event_scoped_admin(auth.uid(), event_id)
    )
  );

DROP POLICY IF EXISTS event_photos_owner_or_admin_select_policy
  ON public.event_photos;
CREATE POLICY event_photos_owner_or_admin_select_policy
  ON public.event_photos
  FOR SELECT TO authenticated
  USING (
    public.is_canonical_event_photo_path(event_id, attendee_id, storage_path)
    AND NOT public.is_self_service_private_draft_event(event_id)
    AND (
      public.is_event_photo_contributor(
        auth.uid(), contributor_person_id, event_id, attendee_id
      )
      OR (
        contributor_person_id IS NULL
        AND public.is_own_attendee(auth.uid(), attendee_id, event_id)
      )
      OR public.is_event_scoped_admin(auth.uid(), event_id)
    )
  );

DROP POLICY IF EXISTS event_photos_member_insert_policy
  ON public.event_photos;
CREATE POLICY event_photos_member_insert_policy
  ON public.event_photos
  FOR INSERT TO authenticated
  WITH CHECK (false);

REVOKE INSERT ON TABLE public.event_photos FROM authenticated;

CREATE OR REPLACE FUNCTION public.finalize_event_photo_upload(
  p_event_id uuid,
  p_attendee_id uuid,
  p_storage_path text,
  p_member_caption text DEFAULT NULL
)
RETURNS TABLE(photo_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_auth_user_id uuid;
  v_contributor record;
  v_photo_id uuid;
BEGIN
  v_auth_user_id := auth.uid();

  IF v_auth_user_id IS NULL
    OR NOT public.is_canonical_event_photo_path(
      p_event_id, p_attendee_id, p_storage_path
    )
    OR public.is_self_service_private_draft_event(p_event_id)
  THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_contributor
  FROM public.resolve_event_photo_contributor(p_event_id, p_attendee_id)
  WHERE contributor_person_id IS NOT NULL;

  IF v_contributor.contributor_person_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('event-photos/' || p_storage_path, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS o
    WHERE o.bucket_id = 'event-photos'
      AND o.name = p_storage_path
      AND o.owner_id = v_auth_user_id::text
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_photos AS ep
    WHERE ep.storage_path = p_storage_path
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.event_photos (
    event_id,
    attendee_id,
    contributor_person_id,
    storage_path,
    photo_status,
    caption_status,
    member_caption,
    photographer_name_snapshot
  )
  VALUES (
    p_event_id,
    p_attendee_id,
    v_contributor.contributor_person_id,
    p_storage_path,
    'pending',
    'pending',
    nullif(btrim(p_member_caption), ''),
    v_contributor.photographer_name_snapshot
  )
  RETURNING id INTO v_photo_id;

  photo_id := v_photo_id;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.finalize_event_photo_upload(uuid, uuid, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_event_photo_upload(uuid, uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_event_photo_upload(uuid, uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.is_event_photo_owner(p_photo_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_photos AS ep
    WHERE ep.id = p_photo_id
      AND NOT public.is_self_service_private_draft_event(ep.event_id)
      AND (
        public.is_event_photo_contributor(
          auth.uid(), ep.contributor_person_id, ep.event_id, ep.attendee_id
        )
        OR (
          ep.contributor_person_id IS NULL
          AND public.is_own_attendee(auth.uid(), ep.attendee_id, ep.event_id)
        )
      )
  );
$$;

ALTER FUNCTION public.is_event_photo_owner(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_event_photo_owner(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_event_photo_owner(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.read_my_event_photo_uploads(
  p_event_id uuid,
  p_attendee_id uuid
)
RETURNS SETOF public.event_photos
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT ep.*
  FROM public.event_photos AS ep
  WHERE ep.event_id = p_event_id
    AND ep.attendee_id = p_attendee_id
    AND NOT public.is_self_service_private_draft_event(ep.event_id)
    AND public.is_canonical_event_photo_path(
      ep.event_id, ep.attendee_id, ep.storage_path
    )
    AND (
      public.is_event_photo_contributor(
        auth.uid(), ep.contributor_person_id, ep.event_id, ep.attendee_id
      )
      OR (
        ep.contributor_person_id IS NULL
        AND public.is_own_attendee(auth.uid(), ep.attendee_id, ep.event_id)
      )
    )
  ORDER BY ep.uploaded_at DESC;
$$;

ALTER FUNCTION public.read_my_event_photo_uploads(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_my_event_photo_uploads(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.read_my_event_photo_uploads(uuid, uuid)
  TO authenticated;

DROP POLICY IF EXISTS event_photos_member_delete_own_pending_policy
  ON public.event_photos;
CREATE POLICY event_photos_member_delete_own_pending_policy
  ON public.event_photos
  FOR DELETE TO authenticated
  USING (
    photo_status = 'pending'
    AND NOT public.is_self_service_private_draft_event(event_id)
    AND (
      public.is_event_photo_contributor(
        auth.uid(), contributor_person_id, event_id, attendee_id
      )
      OR (
        contributor_person_id IS NULL
        AND public.is_own_attendee(auth.uid(), attendee_id, event_id)
      )
    )
  );

CREATE OR REPLACE FUNCTION public.is_authenticated_attendee_of_event(
  p_auth_user_id uuid,
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_person_id uuid;
BEGIN
  IF p_auth_user_id IS NULL OR p_event_id IS NULL THEN
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
    FROM public.person_event_participations AS pep
    JOIN public.person_role_instances AS pri
      ON pri.person_id = pep.person_id
     AND pri.event_id = pep.event_id
    JOIN public.attendees AS a
      ON a.id = pri.attendee_id
     AND a.event_id = pep.event_id
    WHERE pep.person_id = v_person_id
      AND pep.event_id = p_event_id
      AND pep.participation_state = 'eligible'
      AND coalesce(a.is_active, true) = true
  );
END;
$$;

ALTER FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
  TO authenticated;

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
  v_contributor record;
BEGIN
  IF p_auth_user_id IS NULL OR p_object_name IS NULL THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(p_object_name, '/');
  IF array_length(v_parts, 1) IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_event_id := v_parts[1]::uuid;
    v_attendee_id := v_parts[2]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  SELECT * INTO v_contributor
  FROM public.resolve_event_photo_contributor(v_event_id, v_attendee_id)
  WHERE contributor_person_id IS NOT NULL;

  RETURN v_contributor.contributor_person_id IS NOT NULL
    AND public.is_canonical_event_photo_path(v_event_id, v_attendee_id, p_object_name)
    AND NOT public.is_self_service_private_draft_event(v_event_id)
    AND EXISTS (
      SELECT 1
      FROM public.person_auth_accounts AS paa
      WHERE paa.person_id = v_contributor.contributor_person_id
        AND paa.auth_user_id = p_auth_user_id
        AND paa.status = 'active'
    );
END;
$$;

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
  v_photo public.event_photos%ROWTYPE;
BEGIN
  SELECT ep.* INTO v_photo
  FROM public.event_photos AS ep
  WHERE ep.storage_path = p_object_name
    AND public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id, ep.storage_path)
    AND NOT public.is_self_service_private_draft_event(ep.event_id);

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN public.is_event_photo_contributor(
           p_auth_user_id, v_photo.contributor_person_id,
           v_photo.event_id, v_photo.attendee_id
         )
    OR (
      v_photo.contributor_person_id IS NULL
      AND public.is_own_attendee(
        p_auth_user_id, v_photo.attendee_id, v_photo.event_id
      )
    )
    OR public.is_event_scoped_admin(p_auth_user_id, v_photo.event_id);
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
    SELECT 1
    FROM public.event_photos AS ep
    WHERE ep.storage_path = p_object_name
      AND ep.photo_status = 'pending'
      AND public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id, ep.storage_path)
      AND NOT public.is_self_service_private_draft_event(ep.event_id)
      AND (
        public.is_event_photo_contributor(
          p_auth_user_id, ep.contributor_person_id, ep.event_id, ep.attendee_id
        )
        OR (
          ep.contributor_person_id IS NULL
          AND public.is_own_attendee(
            p_auth_user_id, ep.attendee_id, ep.event_id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_unfinalized_event_photo_object(
  p_auth_user_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('event-photos/' || p_object_name, 0)
  );

  IF p_object_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]+$' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM storage.objects AS o
    WHERE o.bucket_id = 'event-photos'
      AND o.name = p_object_name
      AND o.owner_id = p_auth_user_id::text
      AND public.is_canonical_event_photo_path(
        split_part(o.name, '/', 1)::uuid,
        split_part(o.name, '/', 2)::uuid,
        o.name
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_photos AS ep
        WHERE ep.storage_path = o.name
      )
  );
END;
$$;

ALTER FUNCTION public.can_delete_unfinalized_event_photo_object(uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_delete_unfinalized_event_photo_object(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_delete_unfinalized_event_photo_object(uuid, text)
  TO authenticated;

DROP POLICY IF EXISTS event_photos_object_member_delete_pending_policy
  ON storage.objects;
CREATE POLICY event_photos_object_member_delete_pending_policy
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-photos'
    AND (
      public.can_delete_own_pending_event_photo_object(auth.uid(), name)
      OR public.can_delete_unfinalized_event_photo_object(auth.uid(), name)
    )
  );

CREATE OR REPLACE FUNCTION public.read_event_photo_original_path(p_photo_id uuid)
RETURNS TABLE(storage_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT ep.storage_path
  FROM public.event_photos AS ep
  WHERE ep.id = p_photo_id
    AND ep.photo_status = 'approved'
    AND public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id, ep.storage_path)
    AND NOT public.is_self_service_private_draft_event(ep.event_id)
    AND (
      public.is_event_photo_contributor(
        auth.uid(), ep.contributor_person_id, ep.event_id, ep.attendee_id
      )
      OR (
        ep.contributor_person_id IS NULL
        AND public.is_own_attendee(auth.uid(), ep.attendee_id, ep.event_id)
      )
      OR public.is_event_scoped_admin(auth.uid(), ep.event_id)
    );
$$;

ALTER FUNCTION public.read_event_photo_original_path(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_event_photo_original_path(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.read_event_photo_original_path(uuid)
  TO authenticated;

COMMIT;
