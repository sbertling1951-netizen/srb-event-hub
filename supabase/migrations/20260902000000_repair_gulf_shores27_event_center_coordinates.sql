-- Governed one-time data repair: establish the canonical Event-center
-- coordinates for "Gulf Shores27" (event_code GS2027), which have never
-- persisted because of the coordinate-save regression fixed in the same
-- change set (app/admin/events/*, lib/eventCoordinates.ts). The Event's
-- `location` string ("Gulf Shores RV Resort, 18717 Barefoot Wy, Gulf Shores,
-- AL 36542") does not resolve in the Nominatim geocoder, so
-- resolveEventCoordinates always returned "unresolved" and the pre-fix save
-- path threw before writing anything.
--
-- Authoritative reference (externally verified):
--   Gulf Shores RV Resort, 18717 Barefoot Way, Gulf Shores, AL 36542
--   lat = 30.3090, lng = -87.7072
--
-- There is no coordinate-only governed RPC for an existing Event, and this
-- correction does not warrant inventing one. This migration is the narrowest
-- audited repair, in the same self-verifying, fail-closed style as
-- 20260901000000: it touches exactly one row, exactly two columns, only
-- when they are currently NULL, verifies the row still matches the reviewed
-- identity before writing, and confirms nothing else changed.
--
-- Not touched: events.tenant_id (ownership) and every other column; the
-- BEFORE UPDATE OF tenant_id trigger never fires (tenant_id is not in the
-- SET list); no other Event; no function/policy/grant/trigger.
--
-- Rerun safety: the `lat IS NULL AND lng IS NULL` guard means a second run
-- updates 0 rows; the block then takes its no-op branch if the reviewed row
-- already carries the target pair, and fails closed otherwise.

BEGIN;

DO $$
DECLARE
  c_event_id     constant uuid    := '9106b34a-b82b-4e7f-9d64-6325fc6ca705';
  c_event_code   constant text    := 'GS2027';
  c_event_name   constant text    := 'Gulf Shores27';
  c_tenant_id    constant uuid    := '16c39847-ce1d-43c3-b9bc-75f33e16d711';
  c_target_lat   constant numeric := 30.3090;
  c_target_lng   constant numeric := -87.7072;

  v_lat            numeric;
  v_lng            numeric;
  v_name           text;
  v_code           text;
  v_tenant         uuid;
  v_rows_updated   integer;
  v_others_before  text;
  v_others_after   text;
BEGIN
  -- (A) Load the reviewed row and confirm its identity.
  SELECT e.lat, e.lng, e.name, e.event_code, e.tenant_id
    INTO v_lat, v_lng, v_name, v_code, v_tenant
  FROM public.events AS e
  WHERE e.id = c_event_id;

  IF NOT FOUND THEN
    -- Fresh / shadow database without this production row: replay-safe no-op.
    RAISE NOTICE 'No-op: Event % is not present in this database.', c_event_id;
    RETURN;
  END IF;

  IF v_name IS DISTINCT FROM c_event_name
     OR v_code IS DISTINCT FROM c_event_code
     OR v_tenant IS DISTINCT FROM c_tenant_id THEN
    RAISE EXCEPTION
      'Fail-closed: Event % identity does not match the reviewed state (name=%, code=%, tenant=%). Re-review before running this migration.',
      c_event_id, v_name, v_code, v_tenant;
  END IF;

  -- (B) Rerun / already-applied recognition.
  IF v_lat IS NOT NULL OR v_lng IS NOT NULL THEN
    IF v_lat = c_target_lat AND v_lng = c_target_lng THEN
      RAISE NOTICE 'No-op: Gulf Shores27 already carries the reviewed coordinate pair (%, %).',
        c_target_lat, c_target_lng;
      RETURN;
    END IF;

    RAISE EXCEPTION
      'Fail-closed: Gulf Shores27 already has coordinates (%, %) that are not the reviewed NULL state and not the target. Re-review before running this migration.',
      v_lat, v_lng;
  END IF;

  -- (C) Fingerprint every OTHER event''s coordinates -- must be unchanged.
  SELECT md5(coalesce(string_agg(
           e.id::text || '=' || coalesce(e.lat::text, 'null') || ',' || coalesce(e.lng::text, 'null'),
           ';' ORDER BY e.id), ''))
    INTO v_others_before
  FROM public.events AS e
  WHERE e.id <> c_event_id;

  -- (D) The repair: two columns, one row, only while both are NULL.
  UPDATE public.events AS e
  SET lat = c_target_lat,
      lng = c_target_lng
  WHERE e.id = c_event_id
    AND e.lat IS NULL
    AND e.lng IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION 'Expected to update exactly 1 row, updated %.', v_rows_updated;
  END IF;

  -- (E) Confirm the target row, and only the target row.
  SELECT e.lat, e.lng, e.tenant_id
    INTO v_lat, v_lng, v_tenant
  FROM public.events AS e
  WHERE e.id = c_event_id;

  IF v_lat <> c_target_lat OR v_lng <> c_target_lng THEN
    RAISE EXCEPTION 'Post-repair: Gulf Shores27 coordinates are (%, %), expected (%, %).',
      v_lat, v_lng, c_target_lat, c_target_lng;
  END IF;

  IF v_tenant IS DISTINCT FROM c_tenant_id THEN
    RAISE EXCEPTION 'Post-repair: Gulf Shores27 tenant ownership changed.';
  END IF;

  SELECT md5(coalesce(string_agg(
           e.id::text || '=' || coalesce(e.lat::text, 'null') || ',' || coalesce(e.lng::text, 'null'),
           ';' ORDER BY e.id), ''))
    INTO v_others_after
  FROM public.events AS e
  WHERE e.id <> c_event_id;

  IF v_others_after IS DISTINCT FROM v_others_before THEN
    RAISE EXCEPTION 'Collateral change: another Event''s coordinates changed.';
  END IF;

  RAISE NOTICE
    'Repair complete and verified: Gulf Shores27 (%) lat/lng set to (%, %); no other Event changed.',
    c_event_id, c_target_lat, c_target_lng;
END;
$$;

COMMIT;
