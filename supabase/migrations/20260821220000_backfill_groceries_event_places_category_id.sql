-- Corrective follow-up to 20260821210000_reconcile_nearby_category_identity.sql.
--
-- That migration deliberately left "Groceries" (a legitimate plural, not a
-- typo) as unmodified free text in event_nearby_places.category, while
-- merging place_categories.code='groceries' into 'grocery' and deleting
-- the 'groceries' row. Its deterministic category_id backfill matches
-- free text against a LIVE catalog code via normalization -- but by the
-- time that backfill ran, the 'groceries' code no longer existed (it was
-- merged away in the same migration), so no live code could match
-- "Groceries" text, and the five real, live event_nearby_places rows
-- reading "Groceries" were left with category_id IS NULL.
--
-- Confirmed by live, read-only verification immediately after
-- 20260821210000 applied: exactly 5 event_nearby_places rows have
-- category_id IS NULL, and all 5 have category = 'Groceries' (case-
-- sensitive exact match against the one live spelling verified present).
-- No other row, and no other spelling, is affected.
--
-- This is not a new decision -- it is the mechanical completion of the
-- reconciliation 20260821210000 already made: "Groceries" free text
-- means the same canonical category as "Grocery" (that migration's own
-- record), so it resolves to the same id here, directly, since a
-- normalized-code join can no longer find a live 'groceries' row to join
-- through.

BEGIN;

UPDATE public.event_nearby_places
SET category_id = (SELECT id FROM public.place_categories WHERE code = 'grocery')
WHERE category_id IS NULL
  AND category = 'Groceries';

COMMIT;
