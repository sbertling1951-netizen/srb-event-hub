-- Establishes the canonical Event -> Tenant ownership relationship.
--
-- One-time legacy backfill authority: the business owner explicitly confirmed
-- that all six legacy events were created and operated by the Freightliner
-- Chassis Owners Club and belong to canonical tenant
-- 16c39847-ce1d-43c3-b9bc-75f33e16d711 (FCOC).

ALTER TABLE public.events
  ADD COLUMN tenant_id uuid;

ALTER TABLE public.events
  ADD CONSTRAINT events_tenant_id_fkey
  FOREIGN KEY (tenant_id)
  REFERENCES public.tenants(id);

DO $migration$
DECLARE
  canonical_tenant_id CONSTANT uuid := '16c39847-ce1d-43c3-b9bc-75f33e16d711';
  canonical_tenant_count bigint;
  event_count bigint;
  null_tenant_count bigint;
  confirmed_tenant_count bigint;
  rows_backfilled bigint;
BEGIN
  SELECT count(*)
    INTO canonical_tenant_count
  FROM public.tenants
  WHERE id = canonical_tenant_id;

  IF canonical_tenant_count <> 1 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill requires exactly one canonical FCOC tenant %, found %',
      canonical_tenant_id,
      canonical_tenant_count;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE tenant_id IS NULL)
    INTO event_count, null_tenant_count
  FROM public.events;

  IF event_count <> 6 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill requires exactly 6 legacy events, found %',
      event_count;
  END IF;

  IF null_tenant_count <> event_count THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill requires every legacy event to have NULL tenant_id; found % non-NULL tenant_id values',
      event_count - null_tenant_count;
  END IF;

  UPDATE public.events
  SET tenant_id = canonical_tenant_id
  WHERE tenant_id IS NULL;

  GET DIAGNOSTICS rows_backfilled = ROW_COUNT;

  IF rows_backfilled <> 6 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill expected to update 6 events, updated %',
      rows_backfilled;
  END IF;

  SELECT count(*) FILTER (WHERE tenant_id IS NULL),
         count(*) FILTER (WHERE tenant_id = canonical_tenant_id)
    INTO null_tenant_count, confirmed_tenant_count
  FROM public.events;

  IF null_tenant_count <> 0 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill left % events without tenant ownership',
      null_tenant_count;
  END IF;

  IF confirmed_tenant_count <> 6 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill expected all 6 events to reference canonical FCOC tenant %, found %',
      canonical_tenant_id,
      confirmed_tenant_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events e
    LEFT JOIN public.tenants t ON t.id = e.tenant_id
    WHERE t.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill found an event without a valid tenant reference';
  END IF;
END;
$migration$;

ALTER TABLE public.events
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX events_tenant_id_idx
  ON public.events (tenant_id);

COMMENT ON COLUMN public.events.tenant_id IS
  'Canonical tenant ownership of this event. This is the single authoritative Event -> Tenant relationship.';

COMMENT ON CONSTRAINT events_tenant_id_fkey ON public.events IS
  'Enforces that every event owner is a canonical public.tenants record.';
