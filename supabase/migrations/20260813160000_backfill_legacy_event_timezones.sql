-- Legacy Event timezone backfill.
--
-- Lifecycle Foundation (20260813150000) requires a valid events.timezone
-- to produce a determinate effective Lifecycle state (LEM Event Timezone
-- Foundation and Stage 1 Unblock). Audit found 5 of 6 live Events with
-- timezone = NULL. This migration backfills exactly those 5, identified by
-- stable Event UUID (never by name), verified against each Event's own
-- stored venue/city/state/lat-lng evidence -- not assumed from geography
-- alone:
--
--   Amana Event & Annual Business Meeting (53136dfb-b039-40b1-9adf-dcb4d648ea87)
--     venue "Amana RV park & Event Center", 3850 C St, Amana, IA 52203,
--     lat/lng 41.8009819/-91.8704571 (Amana Colonies, Iowa Country) ->
--     America/Chicago.
--   Saint George (382a358b-7d2d-4390-a920-8013a70c560b)
--     location "Temple View RV Resort", lat/lng 37.0965/-113.5684 -- an
--     exact match to St. George, Utah's published coordinates. Utah has no
--     distinct IANA zone of its own; it shares America/Denver with the
--     rest of the Mountain-DST region -> America/Denver.
--   Branson (853f6934-8672-4219-ad59-520482098577)
--     location "499 Buena Vista Road, Branson, Missouri 65616, United
--     States", lat/lng 36.6437/-93.2185 (southwest Missouri) ->
--     America/Chicago.
--   Gulf Shores27 (9106b34a-b82b-4e7f-9d64-6325fc6ca705)
--     location "Gulf Shores RV Resort, 18717 Barefoot Wy, Gulf Shores, AL
--     36542" -- explicit city/state in the address text alone (no lat/lng
--     stored, none needed); Alabama is entirely Central Time ->
--     America/Chicago.
--   Amana27 (e0f01c83-cd82-43f4-a0a4-e4d3cb673459)
--     same venue as Amana Event & Annual Business Meeting above: "Amana RV
--     Park and Event Center-", 3850 C St, Amana, IA 52203, identical
--     lat/lng 41.8009819/-91.8704571 -> America/Chicago.
--
-- Camp Margaritaville (6bca5b21-2760-4f2e-80e3-e616fcbb35ab) already has
-- America/Chicago (Crystal Beach, TX, Texas Gulf Coast -- lat/lng
-- 29.4195382/-94.7050596, consistent) and is not touched by this migration
-- -- its WHERE clause guard (see below) would no-op it even if it were
-- accidentally included, but it is intentionally not listed at all.
--
-- No Tenant or Platform timezone fallback is introduced (a Tenant may
-- legitimately run Events across multiple timezones -- ADR-013 §7
-- correction). Only these 5 specific rows are touched, guarded by
-- `AND timezone IS NULL` so an already-populated value (however it got
-- there) is never overwritten, and identified by UUID so a future rename
-- of any of these Events cannot cause this migration to silently target
-- the wrong row on a fresh replay. No column other than timezone is
-- written. No generic fallback logic is added anywhere.
--
-- Self-validating: the DO block below raises and aborts this migration's
-- transaction if any of its own stated guarantees do not hold when
-- actually applied -- exactly 5 rows updated, zero remaining NULL
-- timezones, zero invalid IANA values, and Camp Margaritaville unchanged.

DO $$
DECLARE
  v_updated_count integer := 0;
  v_rows integer;
  v_missing_count integer;
  v_invalid_count integer;
  v_camp_margaritaville_timezone text;
BEGIN
  -- ============================================================
  -- FRESH / SHADOW-DATABASE REPLAY GUARD
  -- (added 2026-08-29, reproducible-database-history reconstruction) --
  -- the same fresh/shadow no-op concept later production-repair
  -- migrations (20260901000000, 20260902000000) already use.
  --
  -- BEHAVIOR-PRESERVING FOR THE HISTORICAL PRODUCTION PATH: on production
  -- all six referenced Events exist, so this guard falls through and the
  -- five UPDATEs plus the exact `v_updated_count = 5` assertion and the
  -- follow-on checks all run UNCHANGED.
  --
  -- On a genuinely fresh / shadow database none of the six historical
  -- Events (the five timezone targets plus Camp Margaritaville) exist --
  -- there is nothing to backfill and the original `v_updated_count <> 5`
  -- assertion (0 <> 5) would fail on an empty database. No Events are
  -- seeded; the migration no-ops.
  --
  -- FAIL-CLOSED ON PARTIAL STATE: the guard fires ONLY when NONE of the
  -- six referenced Events exist. If some but not all exist, the guard does
  -- not fire, the UPDATEs run, and the existing `v_updated_count <> 5`
  -- assertion exposes the mismatch exactly as before.
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id IN (
      '53136dfb-b039-40b1-9adf-dcb4d648ea87',
      '382a358b-7d2d-4390-a920-8013a70c560b',
      '853f6934-8672-4219-ad59-520482098577',
      '9106b34a-b82b-4e7f-9d64-6325fc6ca705',
      'e0f01c83-cd82-43f4-a0a4-e4d3cb673459',
      '6bca5b21-2760-4f2e-80e3-e616fcbb35ab'
    )
  ) THEN
    RAISE NOTICE 'legacy Event timezone backfill (20260813160000): replay-safe no-op -- none of the six targeted historical Events exist in this database (fresh/shadow).';
    RETURN;
  END IF;

  UPDATE public.events SET timezone = 'America/Chicago'
  WHERE id = '53136dfb-b039-40b1-9adf-dcb4d648ea87' AND timezone IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_updated_count := v_updated_count + v_rows;

  UPDATE public.events SET timezone = 'America/Denver'
  WHERE id = '382a358b-7d2d-4390-a920-8013a70c560b' AND timezone IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_updated_count := v_updated_count + v_rows;

  UPDATE public.events SET timezone = 'America/Chicago'
  WHERE id = '853f6934-8672-4219-ad59-520482098577' AND timezone IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_updated_count := v_updated_count + v_rows;

  UPDATE public.events SET timezone = 'America/Chicago'
  WHERE id = '9106b34a-b82b-4e7f-9d64-6325fc6ca705' AND timezone IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_updated_count := v_updated_count + v_rows;

  UPDATE public.events SET timezone = 'America/Chicago'
  WHERE id = 'e0f01c83-cd82-43f4-a0a4-e4d3cb673459' AND timezone IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_updated_count := v_updated_count + v_rows;

  IF v_updated_count <> 5 THEN
    RAISE EXCEPTION 'timezone backfill: expected to update exactly 5 rows, actually updated %', v_updated_count;
  END IF;

  SELECT count(*) INTO v_missing_count FROM public.events WHERE timezone IS NULL;
  IF v_missing_count <> 0 THEN
    RAISE EXCEPTION 'timezone backfill incomplete: % Event(s) still have NULL timezone', v_missing_count;
  END IF;

  SELECT count(*) INTO v_invalid_count
  FROM public.events e
  WHERE NOT EXISTS (SELECT 1 FROM pg_timezone_names tz WHERE tz.name = e.timezone);
  IF v_invalid_count <> 0 THEN
    RAISE EXCEPTION 'timezone backfill produced % invalid IANA timezone value(s)', v_invalid_count;
  END IF;

  SELECT timezone INTO v_camp_margaritaville_timezone
  FROM public.events WHERE id = '6bca5b21-2760-4f2e-80e3-e616fcbb35ab';
  IF v_camp_margaritaville_timezone IS DISTINCT FROM 'America/Chicago' THEN
    RAISE EXCEPTION 'Camp Margaritaville timezone changed unexpectedly: now %', v_camp_margaritaville_timezone;
  END IF;
END;
$$;
