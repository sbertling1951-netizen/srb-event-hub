-- Establishes the canonical Event -> Tenant ownership relationship.
--
-- One-time legacy backfill authority: the business owner explicitly confirmed
-- that all six legacy events were created and operated by the Freightliner
-- Chassis Owners Club and belong to canonical tenant
-- 16c39847-ce1d-43c3-b9bc-75f33e16d711 (FCOC). That backfill has already been
-- applied to the linked production database under this migration version;
-- this file will never re-run there.
--
-- Governed migration-history exception: the DO block below was amended after
-- the original version was found to fail on a fresh migration replay, where
-- no legacy Event population and no seeded Tenant exist yet. The original
-- version hardcoded both the exact FCOC Tenant UUID and an exact count of 6
-- Events, so it could only ever succeed by replaying the specific state
-- production already had at the time it first ran. The amendment generalizes
-- the same backfill intent -- "resolve the one unambiguous active Tenant and
-- backfill only unowned Events onto it" -- so it also succeeds on a fresh
-- database (whether empty or already seeded with a single Tenant), while
-- still failing closed on every ambiguous or invalid state. It performs no
-- new inserts and chooses no Tenant when more than one candidate exists.
--
-- The resolved active Tenant is the only Tenant this historical migration
-- recognizes as a legitimate owner of the Events it handles. An Event
-- already owned by that same Tenant is preserved unchanged. An Event owned
-- by any other Tenant fails the migration closed, even when that other
-- Tenant is itself a valid, existing row -- a valid foreign-key reference
-- establishes only that the referenced Tenant exists, not that mixed
-- ownership is legitimate here. Because this migration's version is already
-- recorded as applied in the linked production database, amending this file
-- changes only fresh-replay behavior; it does not and cannot cause the
-- migration to run again there.

ALTER TABLE public.events
  ADD COLUMN tenant_id uuid;

ALTER TABLE public.events
  ADD CONSTRAINT events_tenant_id_fkey
  FOREIGN KEY (tenant_id)
  REFERENCES public.tenants(id);

DO $migration$
DECLARE
  canonical_tenant_id uuid;
  active_tenant_count bigint;
  event_count bigint;
  invalid_tenant_count bigint;
  foreign_tenant_count bigint;
  foreign_tenant_ids uuid[];
  null_tenant_count bigint;
  rows_backfilled bigint;
  unresolved_count bigint;
BEGIN
  -- Resolve the single active Tenant unambiguously. This migration performs
  -- a one-time historical backfill onto unowned Events; it must never guess
  -- among multiple Tenants and must not proceed without exactly one active
  -- candidate.
  SELECT count(*)
    INTO active_tenant_count
  FROM public.tenants
  WHERE is_active = true;

  IF active_tenant_count <> 1 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill requires exactly one active canonical Tenant, found %. Resolve the ambiguous or missing Tenant state before this migration can proceed.',
      active_tenant_count;
  END IF;

  SELECT id
    INTO canonical_tenant_id
  FROM public.tenants
  WHERE is_active = true;

  -- All validation happens before any mutation below. Any Event that
  -- already carries a non-NULL tenant_id must reference a real Tenant row.
  -- This is a corrupted state, not an ambiguity this migration may resolve
  -- by guessing; fail closed.
  SELECT count(*)
    INTO invalid_tenant_count
  FROM public.events AS e
  WHERE e.tenant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.tenants AS t WHERE t.id = e.tenant_id
    );

  IF invalid_tenant_count <> 0 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill found % event(s) whose tenant_id does not reference an existing Tenant. Refusing to proceed.',
      invalid_tenant_count;
  END IF;

  -- The resolved active Tenant is the only legitimate owner this migration
  -- recognizes. An Event already owned by any other Tenant -- even a valid,
  -- existing one -- fails the migration closed rather than being preserved
  -- as if mixed ownership were acceptable. This also covers more than one
  -- distinct non-canonical Tenant being represented across Events.
  SELECT count(*), array_agg(DISTINCT e.tenant_id)
    INTO foreign_tenant_count, foreign_tenant_ids
  FROM public.events AS e
  WHERE e.tenant_id IS NOT NULL
    AND e.tenant_id <> canonical_tenant_id;

  IF foreign_tenant_count <> 0 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill found % event(s) owned by Tenant(s) % other than the resolved canonical Tenant %. Refusing to proceed.',
      foreign_tenant_count,
      foreign_tenant_ids,
      canonical_tenant_id;
  END IF;

  SELECT count(*)
    INTO event_count
  FROM public.events;

  IF event_count = 0 THEN
    -- A fresh or genuinely Event-less database. There is nothing to
    -- backfill, and no Event may be invented to satisfy this migration.
    RAISE NOTICE
      'Event tenant ownership backfill: events table is empty; nothing to backfill.';
  ELSE
    SELECT count(*) FILTER (WHERE e.tenant_id IS NULL)
      INTO null_tenant_count
    FROM public.events AS e;

    -- Every Event has already been proven, above, to be either NULL or
    -- already owned by the resolved canonical Tenant. Only the NULL ones
    -- are backfilled; any already carrying the canonical Tenant are left
    -- untouched by this WHERE clause.
    UPDATE public.events AS e
    SET tenant_id = canonical_tenant_id
    WHERE e.tenant_id IS NULL;

    GET DIAGNOSTICS rows_backfilled = ROW_COUNT;

    IF rows_backfilled <> null_tenant_count THEN
      RAISE EXCEPTION
        'Event tenant ownership backfill expected to update % previously-unowned event(s), updated %.',
        null_tenant_count,
        rows_backfilled;
    END IF;

    RAISE NOTICE
      'Event tenant ownership backfill: % previously-unowned event(s) backfilled onto Tenant %.',
      rows_backfilled,
      canonical_tenant_id;
  END IF;

  -- Final verification regardless of path taken above: every Event must now
  -- reference exactly the resolved canonical Tenant, with no exceptions.
  SELECT count(*)
    INTO unresolved_count
  FROM public.events AS e
  WHERE e.tenant_id IS DISTINCT FROM canonical_tenant_id;

  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION
      'Event tenant ownership backfill left % event(s) without the resolved canonical Tenant''s ownership.',
      unresolved_count;
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
