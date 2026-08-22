-- Nearby Category Identity Reconciliation (Stage A).
--
-- 1. Extends the already-written, already-committed, but never-applied
--    20260821000000_fix_groveries_category_typo.sql merge pattern to also
--    fold public.place_categories code='groceries' (plural, backfilled
--    from historical free text) into the same canonical code='grocery'
--    row (id bc9974b0-024c-4ce6-b41d-036d3a03a5c1) that migration already
--    designates as the survivor for 'groveries'. Live evidence: both
--    'groceries' and 'groveries' were created by the SAME one-time
--    deterministic backfill in
--    20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql,
--    at the identical timestamp, from historical nearby_master.category
--    free text -- neither was a deliberate design decision distinct from
--    'grocery' (the one hand-curated starter row, sort_order 20, vs. the
--    generic backfill sort_order 200 both duplicates share).
-- 2. Corrects the one remaining "Groveries" free-text occurrence in each
--    of nearby_master.category and event_nearby_places.category (the
--    actual spelling error). 20260821000000 explicitly does not touch
--    these columns by design; this migration is the one that does.
--    "Groceries" (a legitimate plural, not a typo) is deliberately left
--    as display text -- only its *identity* (category_id) is reconciled,
--    not its wording.
-- 3. Adds public.event_nearby_places.category_id (nullable, FK to
--    place_categories) -- mirrors nearby_master.category_id's own
--    existing nullability exactly: the admin Event Place form's category
--    field is a free-text Input with no catalog constraint at all, so a
--    value with no matching catalog identity is a legitimate, expected
--    state, not an error to paper over with an invented category or a
--    NOT NULL this migration's own backfill would then be unable to
--    guarantee for every future row.
-- 4. Deterministically backfills event_nearby_places.category_id using
--    the identical normalization 20260811120000 used for
--    nearby_master.category_id, run only after (1)+(2) above so every
--    live free-text value maps unambiguously to exactly one canonical
--    code. Verified offline before writing this migration: every
--    distinct category text value in both nearby_master and
--    event_nearby_places (30 distinct values) normalizes to a real
--    public.place_categories.code with no ambiguity -- see the
--    accompanying report for the exact evidence.
--
-- Explicitly NOT in this migration (Stage A boundary): no rename RPC, no
-- category-picker UI redesign, no member-facing behavior change, no
-- synchronization trigger, no new authority/grant, no removal of the
-- legacy free-text columns.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fold 'groceries' into the canonical 'grocery' survivor. Same guarded,
--    idempotent shape as 20260821000000_fix_groveries_category_typo.sql
--    (safe to re-run; a no-op once already applied).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  groceries_id uuid;
  grocery_id uuid;
BEGIN
  SELECT id INTO groceries_id FROM public.place_categories WHERE code = 'groceries';
  SELECT id INTO grocery_id FROM public.place_categories WHERE code = 'grocery';

  IF groceries_id IS NULL THEN
    RETURN;
  END IF;

  IF grocery_id IS NULL THEN
    RAISE EXCEPTION 'reconcile_nearby_category_identity: place_categories.code=grocery not found -- cannot merge groceries into it';
  END IF;

  UPDATE public.nearby_master
  SET category_id = grocery_id
  WHERE category_id = groceries_id;

  DELETE FROM public.tenant_category_overrides AS groceries_row
  WHERE groceries_row.category_id = groceries_id
    AND EXISTS (
      SELECT 1 FROM public.tenant_category_overrides AS grocery_row
      WHERE grocery_row.tenant_id = groceries_row.tenant_id
        AND grocery_row.category_id = grocery_id
    );

  UPDATE public.tenant_category_overrides
  SET category_id = grocery_id
  WHERE category_id = groceries_id;

  DELETE FROM public.tenant_type_category_defaults AS groceries_row
  WHERE groceries_row.category_id = groceries_id
    AND EXISTS (
      SELECT 1 FROM public.tenant_type_category_defaults AS grocery_row
      WHERE grocery_row.tenant_type_id = groceries_row.tenant_type_id
        AND grocery_row.category_id = grocery_id
    );

  UPDATE public.tenant_type_category_defaults
  SET category_id = grocery_id
  WHERE category_id = groceries_id;

  DELETE FROM public.place_categories WHERE id = groceries_id;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Correct the one remaining legacy free-text misspelling. Idempotent
--    (a no-op once no row says 'Groveries'). Deliberately does not touch
--    'Groceries' -- see header point 2.
-- ---------------------------------------------------------------------------

UPDATE public.nearby_master SET category = 'Grocery' WHERE category = 'Groveries';
UPDATE public.event_nearby_places SET category = 'Grocery' WHERE category = 'Groveries';

-- ---------------------------------------------------------------------------
-- 3. public.event_nearby_places.category_id -- nullable, mirrors
--    nearby_master.category_id's own nullability (see header point 3).
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_nearby_places
  ADD COLUMN category_id uuid REFERENCES public.place_categories(id);

CREATE INDEX event_nearby_places_category_id_idx
  ON public.event_nearby_places (category_id) WHERE category_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Deterministic backfill -- identical normalization to
--    20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql's
--    own nearby_master.category_id backfill, so a value that matched
--    there matches here too. Runs after (1)+(2) so 'Groveries'/'Groceries'
--    text both correctly resolve to the canonical 'grocery' row.
-- ---------------------------------------------------------------------------

UPDATE public.event_nearby_places AS enp
SET category_id = pc.id
FROM public.place_categories AS pc
WHERE enp.category_id IS NULL
  AND enp.category IS NOT NULL
  AND btrim(enp.category) <> ''
  AND pc.code = btrim(
    lower(regexp_replace(btrim(enp.category), '[^a-zA-Z0-9]+', '_', 'g')),
    '_'
  );

COMMIT;
