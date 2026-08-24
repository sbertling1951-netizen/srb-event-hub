-- Nearby Event/Tenant/Shared Scope Model -- Stage 3: unified Add/Edit
-- editor wiring plus retirement of the temporary
-- nearby_master_legacy_authenticated_write_bridge (Stage 2.5).
--
-- LIVE PREFLIGHT (fresh, not assumed from prior-stage notes):
--   * All 81 existing nearby_master rows have area_id IS NOT NULL and
--     scope = 'shared_public' (the column's own default), tenant_id and
--     contributed_by_tenant_id both NULL. Zero rows exist outside the
--     legacy Stored-Area bucket -- record_tenant_place has never been
--     called against production data. This is why the two Stored-Area
--     functions below exist as their own thing rather than routing
--     through update_nearby_master_place/retire_nearby_master_place:
--     those RPCs' shared_public branch is Super-Admin-only (Stage 1,
--     required again by this same Stage 3 for the real Shared model,
--     §7) -- routing legacy Stored-Area edits through them would strand
--     the 8 (of 11) active admin_users rows with privilege_group =
--     'event_admin' who use the Stored Area editor today via the
--     bridge. Stored Areas remain their own area_id-grouped bucket,
--     orthogonal to the Tenant/Shared reuse model, exactly as the
--     approved Stage 3 direction requires ("do not redesign... Stored
--     Areas").
--   * nearby_master.event_nearby_places_source_master_id_fkey is
--     ON DELETE NO ACTION (confirmed live) -- delete_stored_area_place
--     below inherits the exact same "blocked by an existing reference"
--     failure mode the raw .delete() it replaces already had. Not
--     changed here: no rows currently carry a populated
--     source_master_id (Stage 2.5 closeout), so this is a live
--     behavioral no-op today, not a new gap.
--   * has_tenant_admin_authority(uid, tenant_id) and
--     has_platform_admin_authority(uid) unchanged since Stage 0/1's own
--     reads of them (20260810110000).
--   * nearby_master's only remaining write-capable policy is the
--     Stage 2.5 bridge (nearby_master_legacy_authenticated_write_bridge,
--     TO authenticated, USING/WITH CHECK admin_users.privilege_group IN
--     ('super_admin','event_admin','content_admin')); the two new
--     functions below replicate that exact check inside plpgsql rather
--     than relying on it, which is what makes dropping the policy safe.

-- ---------------------------------------------------------------------------
-- 1. public.add_tenant_place_to_event -- the "This Tenant" Add
--    composition the unified editor needs. Composes two already-governed
--    operations (record_tenant_place, associate_nearby_master_place_
--    with_event) in one plpgsql body rather than two separate client
--    calls: a plpgsql function body is one transaction, so if the
--    association step raises, the place insert from the first step
--    rolls back automatically -- true atomicity, no orphaned "reusable"
--    place, no client-side rollback logic invented. Neither inner call's
--    own authority check is duplicated or reinterpreted here: this
--    function adds no authority logic of its own, it only sequences two
--    existing checks (has_tenant_admin_authority via record_tenant_place,
--    event.nearby.manage via associate_nearby_master_place_with_event).
--
-- "All Tenants" (Shared) Add deliberately does NOT use this function --
-- it calls record_tenant_place(p_scope := 'shared_public') alone, since
-- a pending_review candidate must never be associated with an Event
-- (Stage 2's own eligibility check already refuses that; this function
-- would only ever reach that same refusal for a Shared candidate, so
-- callers skip straight to the correct single-RPC path instead).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_tenant_place_to_event(
  p_event_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_category_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_location_code text DEFAULT NULL
)
RETURNS public.event_nearby_places
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_place_id uuid;
BEGIN
  v_place_id := public.record_tenant_place(
    p_scope := 'tenant_specific',
    p_name := p_name,
    p_tenant_id := p_tenant_id,
    p_category_id := p_category_id,
    p_category := p_category,
    p_address := p_address,
    p_phone := p_phone,
    p_website := p_website,
    p_lat := p_lat,
    p_lng := p_lng,
    p_notes := p_notes
  );

  RETURN public.associate_nearby_master_place_with_event(p_event_id, v_place_id);
END;
$function$;

ALTER FUNCTION public.add_tenant_place_to_event(
  uuid, uuid, text, uuid, text, text, text, text, numeric, numeric, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.add_tenant_place_to_event(
  uuid, uuid, text, uuid, text, text, text, text, numeric, numeric, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_tenant_place_to_event(
  uuid, uuid, text, uuid, text, text, text, text, numeric, numeric, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.upsert_stored_area_place -- governed replacement for the raw
--    nearby_master .insert()/.update() the Stored Area place editor
--    makes today (app/admin/nearby/page.tsx's saveStoredPlace, plus the
--    lat/lng-only writes in bulkGeocodeStoredPlaces and
--    reGeocodeStoredPlace, all of which pass the already-loaded full
--    record through unchanged except lat/lng -- no separate partial-
--    update RPC is needed for those two).
--
-- Authority is the exact admin_users check the bridge policy provided --
-- a mechanism change (table policy -> governed function), never an
-- authority change, which is what makes retiring that policy (below,
-- §4) safe. p_place_id NULL means insert (matching StoredPlaceForm's own
-- "id blank" convention); non-NULL means update, and the target row
-- must already have area_id IS NOT NULL -- refusing to touch a
-- Tenant/Shared-model row even if a caller somehow supplied such an id,
-- so this function can never become a side-door around
-- update_nearby_master_place's stricter authority.
--
-- Newly inserted rows get scope = 'shared_public' via the column's own
-- default (never set explicitly here) -- identical to every one of the
-- 81 existing Stored-Area rows; tenant_id/contributed_by_tenant_id stay
-- NULL, exactly as today.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_stored_area_place(
  p_place_id uuid,
  p_area_id uuid,
  p_name text,
  p_category_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_location_code text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
)
RETURNS public.nearby_master
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_authorized boolean;
  v_existing_area_id uuid;
  v_row public.nearby_master%ROWTYPE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = auth.uid()
      AND au.is_active = true
      AND au.privilege_group = ANY (ARRAY['super_admin', 'event_admin', 'content_admin'])
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'upsert_stored_area_place: caller is not authorized to manage stored area places';
  END IF;

  IF p_area_id IS NULL THEN
    RAISE EXCEPTION 'upsert_stored_area_place: area_id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.nearby_area_templates WHERE id = p_area_id) THEN
    RAISE EXCEPTION 'upsert_stored_area_place: stored area % not found', p_area_id;
  END IF;

  IF p_place_id IS NULL THEN
    INSERT INTO public.nearby_master (
      area_id, name, category, category_id, address, phone, link,
      description, location_code, lat, lng
    ) VALUES (
      p_area_id, p_name, p_category, p_category_id, p_address, p_phone, p_website,
      p_notes, p_location_code, p_lat, p_lng
    )
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  SELECT area_id INTO v_existing_area_id
  FROM public.nearby_master
  WHERE id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_stored_area_place: place % not found', p_place_id;
  END IF;

  IF v_existing_area_id IS NULL THEN
    RAISE EXCEPTION 'upsert_stored_area_place: place % is not a stored area place', p_place_id;
  END IF;

  UPDATE public.nearby_master
  SET
    area_id = p_area_id,
    name = p_name,
    category = p_category,
    category_id = p_category_id,
    address = p_address,
    phone = p_phone,
    link = p_website,
    description = p_notes,
    location_code = p_location_code,
    lat = p_lat,
    lng = p_lng
  WHERE id = p_place_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_stored_area_place(
  uuid, uuid, text, uuid, text, text, text, text, text, text, numeric, numeric
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.delete_stored_area_place -- governed replacement for the raw
--    nearby_master .delete() deleteStoredPlace makes today. Same
--    authority and area_id IS NOT NULL guard as §2; hard delete,
--    identical to today's behavior (Stored-Area places were never
--    reference-counted or archived, unlike retire_nearby_master_place's
--    Tenant/Shared rows -- not changed here).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_stored_area_place(p_place_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_authorized boolean;
  v_area_id uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = auth.uid()
      AND au.is_active = true
      AND au.privilege_group = ANY (ARRAY['super_admin', 'event_admin', 'content_admin'])
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'delete_stored_area_place: caller is not authorized to manage stored area places';
  END IF;

  SELECT area_id INTO v_area_id
  FROM public.nearby_master
  WHERE id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_stored_area_place: place % not found', p_place_id;
  END IF;

  IF v_area_id IS NULL THEN
    RAISE EXCEPTION 'delete_stored_area_place: place % is not a stored area place', p_place_id;
  END IF;

  DELETE FROM public.nearby_master WHERE id = p_place_id;
END;
$function$;

ALTER FUNCTION public.delete_stored_area_place(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_stored_area_place(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_stored_area_place(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Retire the Stage 2.5 temporary bridge. Safe now: §2/§3 above are
--    the only remaining writers the legacy Stored Area editor needs, and
--    every other nearby_master writer in this whole scope model
--    (record_tenant_place, update_nearby_master_place,
--    retire_nearby_master_place, review_shared_place, and §1 above) is
--    already SECURITY DEFINER, owned by postgres, and therefore never
--    depended on this policy at all. After this DROP, the only policy
--    left on nearby_master is nearby_master_authenticated_select_policy
--    (Stage 2.5) -- no authenticated or anon role retains any raw write
--    path to this table.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS nearby_master_legacy_authenticated_write_bridge ON public.nearby_master;
