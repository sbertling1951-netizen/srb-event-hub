-- Stage 6B: Platform Map asset authority + governed lifecycle -- linked proof.
--
-- Installs the exact Stage 6B parity block inside one outer transaction,
-- exercises the governed RPCs + the RLS/grant retarget against real
-- fixture data, and rolls everything back. Proves: platform authority is
-- required and inherited task authority is verified (not re-checked
-- redundantly); event_admin / content_admin / plain authenticated are
-- refused directly and through every RPC; the draft->publish->archive->
-- restore lifecycle is coherent; published/read-only is enforced; marker
-- changes are atomic; publish_master_map migrates Event references
-- deterministically and all-or-nothing; hard delete is unavailable; the
-- Stage 6A event_map_settings policies and admin_save_event_assignments_
-- guarded are untouched; copy_master_map_to_event EXECUTE is closed.
--
-- Executed once against a disposable local database (npm run
-- db:verify-replay stack) during Stage 6B implementation; NOT run against
-- production.

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Concurrency field. Reliable by construction once the RLS retarget and
--    RPCs below are the sole mutation path.
-- ---------------------------------------------------------------------------
ALTER TABLE public.master_maps
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2a. Grant hardening -- no browser-reachable role performs a direct
--     INSERT/UPDATE/DELETE on these tables any more; the governed RPCs
--     (SECURITY DEFINER, owner postgres) are the only mutation path.
--     SELECT / REFERENCES / TRIGGER are retained (the admin UI and the
--     public map surfaces read both tables). REVOKE of an absent privilege
--     is a no-op, so this is safe whether or not production's ambient grant
--     state matches -- same posture as 20260814020000.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.master_maps FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.master_map_sites FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2b. RLS retarget -- defense-in-depth. If a direct-mutation grant is ever
--     re-introduced out of band, the policy still requires platform
--     authority instead of the legacy global privilege_group. SELECT /
--     public-read policies are deliberately untouched. The legacy policy
--     names are asserted present by the guard block above; the drops here
--     use IF EXISTS so this whole block is idempotent (safe to replay and
--     safe to install standalone in the linked fixture).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can insert master maps" ON public.master_maps;
DROP POLICY IF EXISTS "Platform admins can insert master maps" ON public.master_maps;
CREATE POLICY "Platform admins can insert master maps"
  ON public.master_maps
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY IF EXISTS "Admins can update master maps" ON public.master_maps;
DROP POLICY IF EXISTS "Platform admins can update master maps" ON public.master_maps;
CREATE POLICY "Platform admins can update master maps"
  ON public.master_maps
  FOR UPDATE
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert master map sites" ON public.master_map_sites;
DROP POLICY IF EXISTS "Platform admins can insert master map sites" ON public.master_map_sites;
CREATE POLICY "Platform admins can insert master map sites"
  ON public.master_map_sites
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY IF EXISTS "Admins can update master map sites" ON public.master_map_sites;
DROP POLICY IF EXISTS "Platform admins can update master map sites" ON public.master_map_sites;
CREATE POLICY "Platform admins can update master map sites"
  ON public.master_map_sites
  FOR UPDATE
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()))
  WITH CHECK (public.has_platform_admin_authority(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete master map sites" ON public.master_map_sites;
DROP POLICY IF EXISTS "Platform admins can delete master map sites" ON public.master_map_sites;
CREATE POLICY "Platform admins can delete master map sites"
  ON public.master_map_sites
  FOR DELETE
  TO authenticated
  USING (public.has_platform_admin_authority(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Internal helper: assert platform authority + return a FOR UPDATE-locked
--    master_maps row at an expected revision. REVOKE-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_platform_map_authority_and_lock(
  p_map_id uuid,
  p_expected_revision integer
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.master_maps%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Platform map management requires authenticated authority.';
  END IF;
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Platform map management requires System Administrator authority.';
  END IF;
  IF p_map_id IS NULL THEN
    RAISE EXCEPTION 'A master map identity is required.';
  END IF;

  SELECT * INTO v_row FROM public.master_maps WHERE id = p_map_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Master map % not found.', p_map_id;
  END IF;

  IF p_expected_revision IS NULL OR v_row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale_master_map';
  END IF;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. create_master_map -- new draft. Image metadata is set afterward by
--    set_master_map_image once the storage upload succeeds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_master_map(
  p_name text,
  p_park_name text DEFAULT NULL,
  p_location text DEFAULT NULL
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_name text := nullif(btrim(p_name), '');
  v_row public.master_maps%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Platform map management requires authenticated authority.';
  END IF;
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Platform map management requires System Administrator authority.';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A master map name is required.';
  END IF;

  INSERT INTO public.master_maps (name, park_name, location, status, is_read_only, site_count, revision)
  VALUES (v_name, nullif(btrim(p_park_name), ''), nullif(btrim(p_location), ''), 'draft', false, 0, 0)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. create_master_map_draft_from -- a new editable draft/version copied
--    from an existing map (published, archived, or another draft's source).
--    Copies markers atomically. The master_maps_one_draft_per_group partial
--    unique index enforces "one draft per group"; a collision surfaces as
--    master_map_draft_exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_master_map_draft_from(
  p_source_map_id uuid
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_source public.master_maps%ROWTYPE;
  v_draft public.master_maps%ROWTYPE;
  v_group text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Platform map management requires authenticated authority.';
  END IF;
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Platform map management requires System Administrator authority.';
  END IF;

  SELECT * INTO v_source FROM public.master_maps WHERE id = p_source_map_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source master map % not found.', p_source_map_id;
  END IF;

  v_group := coalesce(v_source.map_group, nullif(btrim(v_source.park_name), ''));

  BEGIN
    INSERT INTO public.master_maps (
      name, park_name, location, map_group, map_image_path, map_image_url,
      status, is_read_only, site_count, area_group_id, revision
    ) VALUES (
      regexp_replace(v_source.name, '\s+Draft$', '', 'i') || ' Draft',
      v_source.park_name, v_source.location, v_group, NULL, v_source.map_image_url,
      'draft', false, v_source.site_count, v_source.area_group_id, 0
    )
    RETURNING * INTO v_draft;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'master_map_draft_exists';
  END;

  INSERT INTO public.master_map_sites (master_map_id, site_number, display_label, map_x, map_y)
  SELECT v_draft.id, s.site_number, s.display_label, s.map_x, s.map_y
  FROM public.master_map_sites AS s
  WHERE s.master_map_id = v_source.id;

  UPDATE public.master_maps
  SET site_count = (SELECT count(*) FROM public.master_map_sites WHERE master_map_id = v_draft.id)
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;

  RETURN v_draft;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. update_master_map_details -- name / park / location / derived map_group.
--    Draft only. revision compare-and-swap.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_master_map_details(
  p_map_id uuid,
  p_expected_revision integer,
  p_name text,
  p_park_name text DEFAULT NULL,
  p_location text DEFAULT NULL
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.master_maps%ROWTYPE;
  v_name text := nullif(btrim(p_name), '');
BEGIN
  v_row := public.assert_platform_map_authority_and_lock(p_map_id, p_expected_revision);

  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'master_map_not_draft';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A master map name is required.';
  END IF;

  UPDATE public.master_maps
  SET name = v_name,
      park_name = nullif(btrim(p_park_name), ''),
      location = nullif(btrim(p_location), ''),
      map_group = coalesce(v_row.map_group, nullif(btrim(p_park_name), '')),
      revision = v_row.revision + 1,
      updated_at = now()
  WHERE id = p_map_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. set_master_map_image -- image path / url metadata. Draft only
--    (a published, read-only canonical asset is not re-imaged in place --
--    the path is Edit -> draft -> replace image -> publish).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_master_map_image(
  p_map_id uuid,
  p_expected_revision integer,
  p_map_image_path text,
  p_map_image_url text
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.master_maps%ROWTYPE;
BEGIN
  v_row := public.assert_platform_map_authority_and_lock(p_map_id, p_expected_revision);

  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'master_map_not_draft';
  END IF;

  UPDATE public.master_maps
  SET map_image_path = nullif(btrim(p_map_image_path), ''),
      map_image_url = nullif(btrim(p_map_image_url), ''),
      revision = v_row.revision + 1,
      updated_at = now()
  WHERE id = p_map_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. apply_master_map_marker_changes -- ONE atomic marker-set mutation:
--    adds + updates + deletes, all inside this function's transaction.
--    A failure rolls the whole delta back; a half-written marker set is
--    impossible. Draft only; bumps the parent map's revision so a marker
--    edit conflicts with a concurrent metadata edit.
--
--    p_adds     : [{site_number, display_label, map_x, map_y}, ...]
--    p_updates  : [{id, site_number, display_label, map_x, map_y}, ...]
--                 (null fields in an update row are left unchanged)
--    p_delete_ids: uuid[]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_master_map_marker_changes(
  p_map_id uuid,
  p_expected_revision integer,
  p_adds jsonb DEFAULT '[]'::jsonb,
  p_updates jsonb DEFAULT '[]'::jsonb,
  p_delete_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.master_maps%ROWTYPE;
BEGIN
  v_row := public.assert_platform_map_authority_and_lock(p_map_id, p_expected_revision);

  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'master_map_not_draft';
  END IF;

  IF coalesce(array_length(p_delete_ids, 1), 0) > 0 THEN
    DELETE FROM public.master_map_sites
    WHERE master_map_id = p_map_id
      AND id = ANY (p_delete_ids);
  END IF;

  IF jsonb_typeof(p_updates) = 'array' AND jsonb_array_length(p_updates) > 0 THEN
    UPDATE public.master_map_sites AS s
    SET site_number = coalesce(nullif(btrim(u.site_number), ''), s.site_number),
        display_label = coalesce(nullif(btrim(u.display_label), ''), s.display_label),
        map_x = coalesce(u.map_x, s.map_x),
        map_y = coalesce(u.map_y, s.map_y)
    FROM jsonb_to_recordset(p_updates)
      AS u(id uuid, site_number text, display_label text, map_x numeric, map_y numeric)
    WHERE s.id = u.id
      AND s.master_map_id = p_map_id;
  END IF;

  IF jsonb_typeof(p_adds) = 'array' AND jsonb_array_length(p_adds) > 0 THEN
    INSERT INTO public.master_map_sites (master_map_id, site_number, display_label, map_x, map_y)
    SELECT p_map_id,
           nullif(btrim(a.site_number), ''),
           coalesce(nullif(btrim(a.display_label), ''), nullif(btrim(a.site_number), '')),
           a.map_x, a.map_y
    FROM jsonb_to_recordset(p_adds)
      AS a(site_number text, display_label text, map_x numeric, map_y numeric)
    WHERE nullif(btrim(a.site_number), '') IS NOT NULL;
  END IF;

  UPDATE public.master_maps
  SET site_count = (SELECT count(*) FROM public.master_map_sites WHERE master_map_id = p_map_id),
      revision = v_row.revision + 1,
      updated_at = now()
  WHERE id = p_map_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. archive_master_map -- A: retire a platform asset. Draft or published
--    -> archived + is_read_only. Does NOT touch Event assignments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_master_map(
  p_map_id uuid,
  p_expected_revision integer
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.master_maps%ROWTYPE;
BEGIN
  v_row := public.assert_platform_map_authority_and_lock(p_map_id, p_expected_revision);

  IF v_row.status = 'archived' THEN
    RETURN v_row;  -- idempotent
  END IF;

  UPDATE public.master_maps
  SET status = 'archived',
      is_read_only = true,
      revision = v_row.revision + 1,
      updated_at = now()
  WHERE id = p_map_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. restore_master_map -- B: bring a retired asset back as an editable
--     DRAFT. Deliberately does NOT republish it and does NOT migrate Event
--     assignments -- that is publish_master_map's job. If the group already
--     holds a draft, master_map_draft_exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_master_map(
  p_map_id uuid,
  p_expected_revision integer
)
RETURNS public.master_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.master_maps%ROWTYPE;
BEGIN
  v_row := public.assert_platform_map_authority_and_lock(p_map_id, p_expected_revision);

  IF v_row.status <> 'archived' THEN
    RAISE EXCEPTION 'master_map_not_archived';
  END IF;

  BEGIN
    UPDATE public.master_maps
    SET status = 'draft',
        is_read_only = false,
        revision = v_row.revision + 1,
        updated_at = now()
    WHERE id = p_map_id
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'master_map_draft_exists';
  END;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. publish_master_map -- C: promote a draft to the canonical published
--     version and migrate the Events that referenced the superseded one.
--     ONE atomic contract:
--       * platform authority (which inherits event.definition.manage for
--         EVERY Event -- verified by the guard block above -- so the Event
--         reassignment below is authorized uniformly and cannot partially
--         apply);
--       * lock the draft and (if any) the superseded published map
--         FOR UPDATE, lowest id first, at their expected revisions;
--       * the superseded map must be the current 'published' map in the
--         same map_group (p_expected_superseded_map_id = NULL means "there
--         is no current published map for this group");
--       * archive superseded -> published (draft) -> reassign
--         event_map_settings, all in this transaction. The per-group
--         partial unique indexes make the two status writes safe in this
--         order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_master_map(
  p_draft_map_id uuid,
  p_expected_draft_revision integer,
  p_expected_superseded_map_id uuid,
  p_expected_superseded_revision integer DEFAULT NULL
)
RETURNS TABLE(published_map_id uuid, superseded_map_id uuid, events_reassigned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_draft public.master_maps%ROWTYPE;
  v_superseded public.master_maps%ROWTYPE;
  v_current_published_id uuid;
  v_reassigned integer := 0;
  v_first uuid;
  v_second uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Platform map management requires authenticated authority.';
  END IF;
  IF NOT public.has_platform_admin_authority(v_actor) THEN
    RAISE EXCEPTION 'Platform map management requires System Administrator authority.';
  END IF;
  IF p_draft_map_id IS NULL THEN
    RAISE EXCEPTION 'A draft master map identity is required.';
  END IF;
  IF p_expected_superseded_map_id IS NOT NULL AND p_expected_superseded_map_id = p_draft_map_id THEN
    RAISE EXCEPTION 'The draft and the superseded map cannot be the same map.';
  END IF;

  -- Deterministic lock order.
  IF p_expected_superseded_map_id IS NULL OR p_draft_map_id < p_expected_superseded_map_id THEN
    v_first := p_draft_map_id; v_second := p_expected_superseded_map_id;
  ELSE
    v_first := p_expected_superseded_map_id; v_second := p_draft_map_id;
  END IF;

  PERFORM 1 FROM public.master_maps WHERE id = v_first FOR UPDATE;
  IF v_second IS NOT NULL THEN
    PERFORM 1 FROM public.master_maps WHERE id = v_second FOR UPDATE;
  END IF;

  SELECT * INTO v_draft FROM public.master_maps WHERE id = p_draft_map_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft master map % not found.', p_draft_map_id;
  END IF;
  IF v_draft.status <> 'draft' THEN
    RAISE EXCEPTION 'master_map_not_draft';
  END IF;
  IF p_expected_draft_revision IS NULL OR v_draft.revision IS DISTINCT FROM p_expected_draft_revision THEN
    RAISE EXCEPTION 'stale_master_map';
  END IF;

  -- Resolve the CURRENT published map for this group and confirm it matches
  -- the caller's expectation exactly.
  SELECT id INTO v_current_published_id
  FROM public.master_maps
  WHERE status = 'published'
    AND map_group IS NOT DISTINCT FROM v_draft.map_group;

  IF coalesce(v_current_published_id::text, '') IS DISTINCT FROM coalesce(p_expected_superseded_map_id::text, '') THEN
    RAISE EXCEPTION 'stale_master_map_publish_target';
  END IF;

  IF p_expected_superseded_map_id IS NOT NULL THEN
    SELECT * INTO v_superseded FROM public.master_maps WHERE id = p_expected_superseded_map_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Superseded master map % not found.', p_expected_superseded_map_id;
    END IF;
    IF v_superseded.status <> 'published' THEN
      RAISE EXCEPTION 'stale_master_map_publish_target';
    END IF;
    IF p_expected_superseded_revision IS NOT NULL
       AND v_superseded.revision IS DISTINCT FROM p_expected_superseded_revision THEN
      RAISE EXCEPTION 'stale_master_map';
    END IF;

    UPDATE public.master_maps
    SET status = 'archived',
        is_read_only = true,
        revision = revision + 1,
        updated_at = now()
    WHERE id = v_superseded.id;
  END IF;

  UPDATE public.master_maps
  SET name = regexp_replace(v_draft.name, '\s+Draft$', '', 'i'),
      status = 'published',
      is_read_only = true,
      site_count = (SELECT count(*) FROM public.master_map_sites WHERE master_map_id = v_draft.id),
      revision = v_draft.revision + 1,
      updated_at = now()
  WHERE id = v_draft.id;

  IF p_expected_superseded_map_id IS NOT NULL THEN
    WITH moved AS (
      UPDATE public.event_map_settings
      SET selected_master_map_id = v_draft.id,
          updated_at = now()
      WHERE selected_master_map_id = p_expected_superseded_map_id
      RETURNING 1
    )
    SELECT count(*) INTO v_reassigned FROM moved;
  END IF;

  published_map_id := v_draft.id;
  superseded_map_id := p_expected_superseded_map_id;
  events_reassigned := v_reassigned;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Ownership + ACL. Internal helper stays REVOKE-only; the browser RPCs
--     keep "authenticated EXECUTE, nothing else" -- authority is decided
--     inside each body.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.assert_platform_map_authority_and_lock(uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.create_master_map(text, text, text) OWNER TO postgres;
ALTER FUNCTION public.create_master_map_draft_from(uuid) OWNER TO postgres;
ALTER FUNCTION public.update_master_map_details(uuid, integer, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.set_master_map_image(uuid, integer, text, text) OWNER TO postgres;
ALTER FUNCTION public.apply_master_map_marker_changes(uuid, integer, jsonb, jsonb, uuid[]) OWNER TO postgres;
ALTER FUNCTION public.archive_master_map(uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.restore_master_map(uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.publish_master_map(uuid, integer, uuid, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_platform_map_authority_and_lock(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_master_map(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_master_map_draft_from(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_master_map_details(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_master_map_image(uuid, integer, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_master_map_marker_changes(uuid, integer, jsonb, jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.archive_master_map(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_master_map(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_master_map(uuid, integer, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_master_map(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_master_map_draft_from(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_master_map_details(uuid, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_master_map_image(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_master_map_marker_changes(uuid, integer, jsonb, jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_master_map(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_master_map(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_master_map(uuid, integer, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Legacy copy_master_map_to_event -- close the dead AUTHENTICATED
--     EXECUTE on this exact authority surface (PUBLIC/anon were already
--     revoked by 20260814020000). service_role EXECUTE is intentionally
--     left in place: it is an already-privileged backend role and an
--     out-of-repo operational caller cannot be proven absent. The function
--     object is retained (SECURITY INVOKER, owner postgres) for replay /
--     history compatibility; its parking_sites-writing body is Stage 6C.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.copy_master_map_to_event(uuid, uuid) FROM authenticated;

-- ============================================================
-- PARITY END

-- ============================================================
-- Fixture assertion helper
-- ============================================================
CREATE FUNCTION public.stage6b_fixture_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $fn$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Stage 6B fixture assertion failed: %', p_message;
  END IF;
END;
$fn$;
ALTER FUNCTION public.stage6b_fixture_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stage6b_fixture_assert(boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.stage6b_fixture_assert(boolean, text) TO authenticated;

DO $setup$
BEGIN
  PERFORM public.stage6b_fixture_assert(
    NOT EXISTS (SELECT 1 FROM public.master_maps WHERE name LIKE 'S6B FX%'),
    'fixture map names must be unused before setup'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('6b000000-0000-4000-8000-000000000001', 's6b-platform@fixture.invalid'),
    ('6b000000-0000-4000-8000-000000000002', 's6b-event-admin@fixture.invalid'),
    ('6b000000-0000-4000-8000-000000000003', 's6b-content-admin@fixture.invalid'),
    ('6b000000-0000-4000-8000-000000000004', 's6b-plain@fixture.invalid');

  INSERT INTO public.admin_users (id, email, display_name, is_active, is_super_admin, user_id, privilege_group) VALUES
    ('6ba00000-0000-4000-8000-000000000001', 's6b-platform@fixture.invalid', 'S6B Platform', true, true,  '6b000000-0000-4000-8000-000000000001', 'super_admin'),
    ('6ba00000-0000-4000-8000-000000000002', 's6b-event-admin@fixture.invalid', 'S6B Event Admin', true, false, '6b000000-0000-4000-8000-000000000002', 'event_admin'),
    ('6ba00000-0000-4000-8000-000000000003', 's6b-content-admin@fixture.invalid', 'S6B Content Admin', true, false, '6b000000-0000-4000-8000-000000000003', 'content_admin'),
    ('6ba00000-0000-4000-8000-000000000004', 's6b-plain@fixture.invalid', 'S6B Plain', true, false, '6b000000-0000-4000-8000-000000000004', 'read_only');

  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title, is_active)
    VALUES ('6b700000-0000-4000-8000-000000000001', 'S6B-FX', 's6b-fx', 'S6B Fixture Tenant', 'S6B', 'S6B', true);
  INSERT INTO public.events (id, tenant_id, name, location, start_date, end_date, timezone, lifecycle_state, status, visible_to_members, is_active)
    VALUES ('6be00000-0000-4000-8000-000000000001', '6b700000-0000-4000-8000-000000000001', 'S6B Fixture Event', 'loc', current_date, current_date + 5, 'UTC', 'operational', 'Draft', false, false);
END;
$setup$;

DO $exercise$
DECLARE
  v_draft public.master_maps%ROWTYPE;
  v_pub public.master_maps%ROWTYPE;
  v_draft2 uuid;
  v_draft2_rev integer;
  v_row record;
  v_failed boolean;
  v_count integer;
BEGIN
  -- =========================================================================
  -- Platform administrator: full governed lifecycle.
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', '6b000000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_draft FROM public.create_master_map('S6B FX Alpha', 'S6B FX Park', 'City');
  PERFORM public.stage6b_fixture_assert(
    v_draft.status = 'draft' AND v_draft.is_read_only = false AND v_draft.revision = 0,
    'create_master_map yields a draft at revision 0'
  );

  SELECT * INTO v_draft FROM public.update_master_map_details(v_draft.id, 0, 'S6B FX Alpha', 'S6B FX Park', 'City2');
  PERFORM public.stage6b_fixture_assert(v_draft.revision = 1 AND v_draft.map_group = 'S6B FX Park',
    'update_master_map_details bumps revision and derives map_group');

  SELECT * INTO v_draft FROM public.set_master_map_image(v_draft.id, 1, 'a/base.png', 'https://x/base.png');
  PERFORM public.stage6b_fixture_assert(v_draft.map_image_url = 'https://x/base.png' AND v_draft.revision = 2,
    'set_master_map_image bumps revision');

  -- stale revision rejected
  v_failed := false;
  BEGIN PERFORM public.update_master_map_details(v_draft.id, 0, 'x'); EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'stale_master_map'; END;
  PERFORM public.stage6b_fixture_assert(v_failed, 'a stale expected_revision raises stale_master_map');

  -- atomic marker changes
  SELECT * INTO v_draft FROM public.apply_master_map_marker_changes(
    v_draft.id, 2,
    '[{"site_number":"A1","map_x":1,"map_y":2},{"site_number":"A2","map_x":3,"map_y":4},{"site_number":"A3","map_x":5,"map_y":6}]'::jsonb);
  PERFORM public.stage6b_fixture_assert(v_draft.site_count = 3 AND v_draft.revision = 3,
    'marker add is atomic and maintains site_count + revision');

  SELECT * INTO v_draft FROM public.apply_master_map_marker_changes(
    v_draft.id, 3,
    '[{"site_number":"A4","map_x":7,"map_y":8}]'::jsonb,
    (SELECT jsonb_build_array(jsonb_build_object('id', id, 'map_x', 99)) FROM public.master_map_sites WHERE master_map_id = v_draft.id AND site_number = 'A1'),
    ARRAY(SELECT id FROM public.master_map_sites WHERE master_map_id = v_draft.id AND site_number = 'A3'));
  SELECT count(*) INTO v_count FROM public.master_map_sites WHERE master_map_id = v_draft.id;
  PERFORM public.stage6b_fixture_assert(
    v_count = 3
      AND EXISTS (SELECT 1 FROM public.master_map_sites WHERE master_map_id = v_draft.id AND site_number = 'A1' AND map_x = 99 AND map_y = 2)
      AND NOT EXISTS (SELECT 1 FROM public.master_map_sites WHERE master_map_id = v_draft.id AND site_number = 'A3')
      AND EXISTS (SELECT 1 FROM public.master_map_sites WHERE master_map_id = v_draft.id AND site_number = 'A4'),
    'apply_master_map_marker_changes applies add + partial update + delete atomically in one call'
  );

  -- publish with no superseded
  SELECT * INTO v_row FROM public.publish_master_map(v_draft.id, 4, NULL, NULL);
  PERFORM public.stage6b_fixture_assert(v_row.events_reassigned = 0 AND v_row.superseded_map_id IS NULL,
    'publish with no current published map reassigns no Events');
  SELECT * INTO v_pub FROM public.master_maps WHERE id = v_draft.id;
  PERFORM public.stage6b_fixture_assert(v_pub.status = 'published' AND v_pub.is_read_only = true,
    'a published map is read-only');

  -- a published map is not directly editable through any RPC
  v_failed := false;
  BEGIN PERFORM public.update_master_map_details(v_pub.id, v_pub.revision, 'nope'); EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'master_map_not_draft'; END;
  PERFORM public.stage6b_fixture_assert(v_failed, 'update_master_map_details refuses a published map (master_map_not_draft)');
  v_failed := false;
  BEGIN PERFORM public.set_master_map_image(v_pub.id, v_pub.revision, 'p', 'u'); EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'master_map_not_draft'; END;
  PERFORM public.stage6b_fixture_assert(v_failed, 'set_master_map_image refuses a published map');
  v_failed := false;
  BEGIN PERFORM public.apply_master_map_marker_changes(v_pub.id, v_pub.revision, '[{"site_number":"Z"}]'::jsonb); EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'master_map_not_draft'; END;
  PERFORM public.stage6b_fixture_assert(v_failed, 'apply_master_map_marker_changes refuses a published map');

  -- an Event now references the published map
  INSERT INTO public.event_map_settings (event_id, selected_master_map_id)
    VALUES ('6be00000-0000-4000-8000-000000000001', v_pub.id);

  -- draft a replacement, then publish/promote -> supersede + reassign the Event
  SELECT id, revision INTO v_draft2, v_draft2_rev FROM public.create_master_map_draft_from(v_pub.id);
  PERFORM public.stage6b_fixture_assert(
    (SELECT status FROM public.master_maps WHERE id = v_draft2) = 'draft'
      AND (SELECT count(*) FROM public.master_map_sites WHERE master_map_id = v_draft2) = 3,
    'create_master_map_draft_from copies the marker set into a new draft'
  );

  SELECT * INTO v_row FROM public.publish_master_map(v_draft2, v_draft2_rev, v_pub.id, NULL);
  PERFORM public.stage6b_fixture_assert(
    v_row.published_map_id = v_draft2 AND v_row.superseded_map_id = v_pub.id AND v_row.events_reassigned = 1,
    'publish_master_map supersedes the prior published version and reassigns exactly the referencing Events'
  );
  PERFORM public.stage6b_fixture_assert(
    (SELECT status FROM public.master_maps WHERE id = v_pub.id) = 'archived'
      AND (SELECT status FROM public.master_maps WHERE id = v_draft2) = 'published'
      AND (SELECT selected_master_map_id FROM public.event_map_settings WHERE event_id = '6be00000-0000-4000-8000-000000000001') = v_draft2,
    'promotion is coherent: superseded archived, replacement published, Event repointed -- all in one transaction'
  );

  -- a mismatched superseded expectation is rejected (no partial promotion)
  SELECT id, revision INTO v_draft2, v_draft2_rev FROM public.create_master_map_draft_from(v_draft2);
  v_failed := false;
  BEGIN
    PERFORM public.publish_master_map(v_draft2, v_draft2_rev, '6b000000-0000-4000-8000-000000000001'::uuid, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'stale_master_map_publish_target'; END;
  PERFORM public.stage6b_fixture_assert(v_failed, 'publish_master_map rejects a wrong superseded-map expectation');
  PERFORM public.stage6b_fixture_assert(
    (SELECT status FROM public.master_maps WHERE id = v_draft2) = 'draft',
    'a rejected publish leaves the draft untouched (no partial promotion)'
  );

  -- archive + restore are asset-lifecycle only -- no Event effect
  PERFORM public.archive_master_map(v_draft2, (SELECT revision FROM public.master_maps WHERE id = v_draft2));
  PERFORM public.stage6b_fixture_assert(
    (SELECT status FROM public.master_maps WHERE id = v_draft2) = 'archived'
      AND (SELECT is_read_only FROM public.master_maps WHERE id = v_draft2) = true,
    'archive_master_map retires the asset'
  );
  PERFORM public.restore_master_map(v_draft2, (SELECT revision FROM public.master_maps WHERE id = v_draft2));
  PERFORM public.stage6b_fixture_assert(
    (SELECT status FROM public.master_maps WHERE id = v_draft2) = 'draft'
      AND (SELECT is_read_only FROM public.master_maps WHERE id = v_draft2) = false,
    'restore_master_map brings the asset back as an editable draft'
  );
  PERFORM public.stage6b_fixture_assert(
    (SELECT selected_master_map_id FROM public.event_map_settings WHERE event_id = '6be00000-0000-4000-8000-000000000001') = v_row.published_map_id,
    'archive/restore never migrate Event assignments'
  );

  -- =========================================================================
  -- Non-platform admins: refused directly and through every RPC.
  -- =========================================================================
  FOR v_row IN
    SELECT unnest(ARRAY[
      '6b000000-0000-4000-8000-000000000002',
      '6b000000-0000-4000-8000-000000000003',
      '6b000000-0000-4000-8000-000000000004'
    ]) AS sub, unnest(ARRAY['event_admin', 'content_admin', 'plain authenticated']) AS label
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_row.sub, true);

    v_failed := false;
    BEGIN PERFORM public.create_master_map('S6B FX Hack'); EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Platform map management requires System Administrator authority.'; END;
    PERFORM public.stage6b_fixture_assert(v_failed, v_row.label || ' cannot create_master_map');

    v_failed := false;
    BEGIN PERFORM public.archive_master_map(v_draft2, 0); EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Platform map management requires System Administrator authority.'; END;
    PERFORM public.stage6b_fixture_assert(v_failed, v_row.label || ' cannot archive_master_map');

    v_failed := false;
    BEGIN PERFORM public.apply_master_map_marker_changes(v_draft2, 0, '[{"site_number":"X"}]'::jsonb); EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Platform map management requires System Administrator authority.'; END;
    PERFORM public.stage6b_fixture_assert(v_failed, v_row.label || ' cannot apply_master_map_marker_changes');

    v_failed := false;
    BEGIN PERFORM public.publish_master_map(v_draft2, 0, NULL, NULL); EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'Platform map management requires System Administrator authority.'; END;
    PERFORM public.stage6b_fixture_assert(v_failed, v_row.label || ' cannot publish_master_map');
  END LOOP;

  -- =========================================================================
  -- Direct table mutation boundary. On this disposable replay database the
  -- browser roles hold NO table grants on master_maps / master_map_sites at
  -- all (the reconstructed baseline never captured the ambient production
  -- grants -- see docs/DATABASE_HISTORY.md), so a role-switched direct-write
  -- probe here would pass for the wrong reason. Instead the migration
  -- artifacts are asserted directly: the grant revoke and the retargeted
  -- RLS predicate. On production the REVOKE removes the real
  -- INSERT/UPDATE/DELETE grants; the retargeted policy is the standing
  -- boundary if a grant is ever re-introduced.
  -- =========================================================================
  PERFORM public.stage6b_fixture_assert(
    has_table_privilege('authenticated', 'public.master_maps', 'INSERT') = false
      AND has_table_privilege('authenticated', 'public.master_maps', 'UPDATE') = false
      AND has_table_privilege('authenticated', 'public.master_maps', 'DELETE') = false
      AND has_table_privilege('authenticated', 'public.master_map_sites', 'INSERT') = false
      AND has_table_privilege('authenticated', 'public.master_map_sites', 'UPDATE') = false
      AND has_table_privilege('authenticated', 'public.master_map_sites', 'DELETE') = false
      AND has_table_privilege('anon', 'public.master_maps', 'INSERT') = false,
    'no browser role retains a direct INSERT/UPDATE/DELETE grant on the platform-map tables'
  );

  PERFORM public.stage6b_fixture_assert(
    NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polrelid IN ('public.master_maps'::regclass, 'public.master_map_sites'::regclass)
        AND polname LIKE 'Admins can %'
        AND polcmd <> 'r'
    ),
    'the legacy global privilege_group write policies are gone'
  );

  PERFORM public.stage6b_fixture_assert(
    (SELECT count(*) FROM pg_policy
       WHERE polrelid IN ('public.master_maps'::regclass, 'public.master_map_sites'::regclass)
         AND polname LIKE 'Platform admins can %'
         AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ~ 'has_platform_admin_authority') = 5,
    'the five retargeted write policies require has_platform_admin_authority'
  );

  PERFORM public.stage6b_fixture_assert(
    EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.master_maps'::regclass
              AND polname = 'public read master_maps' AND polcmd = 'r')
      AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.master_map_sites'::regclass
              AND polname = 'public read master_map_sites' AND polcmd = 'r'),
    'the public / admin SELECT policies are deliberately untouched'
  );

  -- =========================================================================
  -- Stage 6A is untouched; hard delete is unavailable; copy is closed.
  -- =========================================================================
  PERFORM public.stage6b_fixture_assert(
    (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.event_map_settings'::regclass
       AND polname LIKE 'Event definition admins can % event map settings') = 3
      AND to_regprocedure('public.admin_save_event_assignments_guarded(uuid,uuid,uuid,uuid,uuid)') IS NOT NULL,
    'Stage 6A event_map_settings policies and admin_save_event_assignments_guarded are intact'
  );
  PERFORM public.stage6b_fixture_assert(
    NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.master_maps'::regclass AND polcmd = 'd'),
    'no DELETE policy exists on master_maps -- hard delete remains unavailable'
  );
  PERFORM public.stage6b_fixture_assert(
    has_function_privilege('authenticated', 'public.copy_master_map_to_event(uuid,uuid)', 'EXECUTE') = false
      AND has_function_privilege('anon', 'public.copy_master_map_to_event(uuid,uuid)', 'EXECUTE') = false,
    'copy_master_map_to_event EXECUTE is closed for authenticated and anon'
  );
END;
$exercise$;

ROLLBACK;

-- Only FIXTURE objects are checked. The Stage 6B functions / policies /
-- grants are the migration's own -- whether they are present after ROLLBACK
-- (migration already applied) or absent (migration not yet applied) is a
-- property of the migration, not fixture residue.
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM public.master_maps WHERE name LIKE 'S6B FX%')
     OR EXISTS (SELECT 1 FROM public.tenants WHERE organization_code = 'S6B-FX')
     OR EXISTS (SELECT 1 FROM public.admin_users WHERE email LIKE 's6b-%@fixture.invalid')
     OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 's6b-%@fixture.invalid')
     OR to_regprocedure('public.stage6b_fixture_assert(boolean,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Stage 6B rollback left fixture residue';
  END IF;
END;
$post$;
