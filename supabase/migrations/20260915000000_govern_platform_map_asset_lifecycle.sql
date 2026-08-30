-- Stage 6B: Platform Map asset authority + governed lifecycle.
--
-- WHAT WAS WRONG (pre-existing, on main):
--   public.master_maps (INSERT/UPDATE) and public.master_map_sites
--   (INSERT/UPDATE/DELETE) RLS gated on a single GLOBAL role test --
--     admin_users.is_active
--     AND privilege_group IN ('super_admin','event_admin','content_admin')
--   -- with NO tenant, event, or platform-authority scope. privilege_group
--   is one column on the admin_users row, not a per-tenant/per-event grant
--   (admin_users has no tenant_id). Consequence: any active global
--   event_admin or content_admin could create, rename, re-image, archive,
--   restore, or (via master_map_sites DELETE) gut a SHARED PLATFORM map
--   asset that every tenant's Coach Map / Parking / Locations views read.
--   The Master Maps UI hid this behind can_manage_master_maps (a
--   Super-Admin-only preset), but AdminRouteGuard + a client hasPermission
--   check are not an authority boundary.
--
--   The Master Maps pages also performed direct, ungoverned browser writes
--   for the whole map lifecycle (create / edit / marker CRUD / archive /
--   restore / publish) with no locking and no stale-write protection, and
--   two of them (list "Restore", editor "Save updated map") reassigned
--   Event -> shared-map references with an UNFILTERED
--   `UPDATE event_map_settings SET selected_master_map_id = ...`, bypassing
--   Stage 6A's governed, event-scoped, compare-and-swap assignment path.
--
-- GOVERNING MODEL (Stage 6B, approved):
--   1. master_maps / master_map_sites are GLOBAL PLATFORM assets. There is
--      no tenant-scoped map concept (master_maps has no tenant_id).
--      Canonical mutation authority = public.has_platform_admin_authority
--      (auth.uid()) -- the same primitive 20260811160000 / 20260811260000
--      used for area_groups, nearby_master_places, master_map_locations,
--      user_roles. Database authority is canonical; UI permissions are not
--      an authority boundary.
--   2. Every platform-map mutation goes through a governed SECURITY DEFINER
--      RPC owned by postgres. The RLS retarget below is the
--      defense-in-depth "direct table mutation is denied" boundary.
--   3. Lifecycle is draft -> edit -> publish/promote, and archive / retire
--      / restore -- never uncontrolled mutation of a published canonical
--      asset, and never hard delete. is_read_only is enforced inside the
--      RPCs (legal transitions only), not left advisory.
--   4. archive_master_map / restore_master_map are ASSET lifecycle only and
--      do NOT touch Event assignments. publish_master_map is the single
--      atomic operation that supersedes a published version AND migrates
--      the Events that referenced it -- deterministically, all-or-nothing.
--   5. Concurrency: master_maps gains `revision integer NOT NULL DEFAULT 0`.
--      Every governed mutation locks the map row FOR UPDATE, checks
--      revision = p_expected_revision (raising stale_master_map), then sets
--      revision = revision + 1, updated_at = now(). The field is reliable
--      by construction: after this migration the RLS forbids direct writes
--      and the RPCs are the sole mutation path. (Tradeoff: +1 column, no
--      new table, no trigger -- reported in the Stage 6B closeout.)
--
-- STAGE 6A IS PRESERVED. This migration guard-checks -- and does not alter
-- -- the three event_map_settings policies and
-- admin_save_event_assignments_guarded from 20260913000000.
--   event.definition.manage is seeded platform_inherits = TRUE
--   (20260811170000), so a platform administrator inherently satisfies
--   has_event_task_authority('event.definition.manage', <any event>) via
--   resolve_task_authority's 'platform' branch. publish_master_map's Event
--   reassignment is therefore authorized UNIFORMLY for every affected
--   Event -- it cannot partially apply -- and this migration verifies that
--   semantic explicitly rather than adding a redundant per-Event check.
--
-- OUT OF SCOPE (unchanged): parking_sites, record_site_placement,
-- materialize_event_parking_site, Parking Admin, Stage 6C, the public
-- master-map SELECT breadth, Nearby, tenant map concepts, map-scale
-- behavior.
--
-- copy_master_map_to_event(uuid,uuid): confirmed zero callers repo-wide;
-- SECURITY INVOKER; still EXECUTE-granted to authenticated + service_role.
-- It writes parking_sites, so its BODY is Stage 6C territory and is left
-- byte-unchanged, but leaving a dead authenticated command on this exact
-- authority surface is not acceptable -- Stage 6B REVOKEs its
-- authenticated EXECUTE (PUBLIC/anon were already revoked by
-- 20260814020000). service_role EXECUTE is deliberately NOT touched:
-- service_role is already a privileged backend role with direct database
-- capability, so revoking one SECURITY INVOKER function does not
-- materially strengthen the browser/user authority boundary, and could
-- break an out-of-repo operational caller that a repo grep cannot prove
-- absent. The function object is retained for replay/history compatibility.
--
-- RUNTIME: verified. Fresh from-zero replay of the full chain (npm run
-- db:verify-replay) applies this migration with no errors, and the linked
-- BEGIN..ROLLBACK fixture
-- (supabase/integration-tests/20260915000000_platform_map_asset_lifecycle_rollback.sql)
-- was executed against that disposable local database. Production database
-- and production migration ledger were NOT changed by this migration file.

BEGIN;

-- ============================================================
-- 0. Guard checks -- fail closed if the world is not what Stage 6B expects.
-- ============================================================
DO $guard$
DECLARE
  v_authenticated oid;
BEGIN
  SELECT oid INTO v_authenticated FROM pg_roles WHERE rolname = 'authenticated';
  IF v_authenticated IS NULL THEN
    RAISE EXCEPTION 'Stage 6B aborted: authenticated role is absent';
  END IF;

  IF to_regprocedure('public.has_platform_admin_authority(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6B aborted: has_platform_admin_authority(uuid) is absent';
  END IF;

  IF to_regprocedure('public.has_event_task_authority(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6B aborted: has_event_task_authority(text,uuid) is absent';
  END IF;

  -- Stage 6A must be intact and event.definition.manage must inherit to platform.
  IF to_regprocedure('public.admin_save_event_assignments_guarded(uuid,uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6B aborted: Stage 6A admin_save_event_assignments_guarded is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_task_registry
    WHERE task_key = 'event.definition.manage'
      AND scope = 'event' AND is_active IS TRUE AND platform_inherits IS TRUE
  ) THEN
    RAISE EXCEPTION 'Stage 6B aborted: event.definition.manage is not an active platform-inheriting Event task';
  END IF;
  IF (
    SELECT count(*) FROM pg_policy
    WHERE polrelid = 'public.event_map_settings'::regclass
      AND polname IN (
        'Event definition admins can view event map settings',
        'Event definition admins can insert event map settings',
        'Event definition admins can update event map settings'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Stage 6B aborted: Stage 6A event_map_settings policies are absent or renamed';
  END IF;

  -- RLS must be enabled on the two platform-map tables.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'master_maps' AND c.relrowsecurity IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'master_map_sites' AND c.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'Stage 6B aborted: RLS is not enabled on master_maps / master_map_sites';
  END IF;

  -- The exact legacy policies this migration replaces must be present.
  IF (
    SELECT count(*) FROM pg_policy
    WHERE polrelid = 'public.master_maps'::regclass
      AND polname IN ('Admins can insert master maps', 'Admins can update master maps')
  ) <> 2 THEN
    RAISE EXCEPTION 'Stage 6B aborted: legacy master_maps write policies are absent or renamed';
  END IF;
  IF (
    SELECT count(*) FROM pg_policy
    WHERE polrelid = 'public.master_map_sites'::regclass
      AND polname IN (
        'Admins can insert master map sites',
        'Admins can update master map sites',
        'Admins can delete master map sites'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Stage 6B aborted: legacy master_map_sites write policies are absent or renamed';
  END IF;

  -- The per-group uniqueness invariants publish_master_map relies on.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'master_maps_one_draft_per_group')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'master_maps_one_published_per_group') THEN
    RAISE EXCEPTION 'Stage 6B aborted: master_maps per-group uniqueness indexes are absent';
  END IF;

  IF to_regprocedure('public.copy_master_map_to_event(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Stage 6B aborted: copy_master_map_to_event(uuid,uuid) is absent (expected for the EXECUTE revoke)';
  END IF;
END;
$guard$;

-- ============================================================
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

COMMIT;
