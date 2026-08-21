-- Fix a data-entry typo in public.place_categories: "Groveries" (code
-- 'groveries') is a misspelling of the existing, correctly-seeded
-- "Grocery" (code 'grocery') category, not a distinct category. It was
-- never hand-authored -- 20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql's
-- deterministic backfill created it verbatim from a pre-existing
-- public.nearby_master.category free-text value that already contained
-- the typo, faithfully preserving whatever admins had typed historically.
-- Confirmed live on /admin/nearby-settings: both "Groceries" (correct,
-- seeded) and "Groveries" (this typo) appear as separate rows.
--
-- This corrects the DATA (an existing catalog row and any real
-- references to it), not the UI -- unrelated to and does not touch
-- app/admin/nearby/page.tsx's own free-text `category` column, which
-- this table's category_id column only supplements (see that migration's
-- own comment: "the legacy free-text `category` column is untouched").
--
-- Defensive/idempotent throughout (a no-op if 'groveries' does not
-- exist, matching the style of every migration in this project) and
-- guards the two per-tenant unique-constraint tables
-- (tenant_category_overrides, tenant_type_category_defaults) against a
-- merge collision: if a given tenant/tenant-type already has its own
-- row for 'grocery', the corresponding 'groveries' row is simply
-- dropped (the real 'grocery' choice already wins) rather than
-- reassigned into a duplicate that would violate the unique constraint.

BEGIN;

DO $$
DECLARE
  groveries_id uuid;
  grocery_id uuid;
BEGIN
  SELECT id INTO groveries_id FROM public.place_categories WHERE code = 'groveries';
  SELECT id INTO grocery_id FROM public.place_categories WHERE code = 'grocery';

  IF groveries_id IS NULL THEN
    RETURN;
  END IF;

  IF grocery_id IS NULL THEN
    RAISE EXCEPTION 'place_categories.code=grocery not found -- cannot merge groveries into it';
  END IF;

  -- nearby_master.category_id has no ON DELETE CASCADE from
  -- place_categories (plain REFERENCES), so any real place tagged with
  -- the typo'd category must be repointed before the row can be deleted.
  UPDATE public.nearby_master
  SET category_id = grocery_id
  WHERE category_id = groveries_id;

  -- Per-tenant override: drop the typo'd override wherever that same
  -- tenant already has its own 'grocery' override (avoids violating
  -- tenant_category_overrides_unique), then repoint everything else.
  DELETE FROM public.tenant_category_overrides AS groveries_row
  WHERE groveries_row.category_id = groveries_id
    AND EXISTS (
      SELECT 1 FROM public.tenant_category_overrides AS grocery_row
      WHERE grocery_row.tenant_id = groveries_row.tenant_id
        AND grocery_row.category_id = grocery_id
    );

  UPDATE public.tenant_category_overrides
  SET category_id = grocery_id
  WHERE category_id = groveries_id;

  -- Same merge-or-drop guard for the tenant-type default profile table
  -- (tenant_type_category_defaults_unique).
  DELETE FROM public.tenant_type_category_defaults AS groveries_row
  WHERE groveries_row.category_id = groveries_id
    AND EXISTS (
      SELECT 1 FROM public.tenant_type_category_defaults AS grocery_row
      WHERE grocery_row.tenant_type_id = groveries_row.tenant_type_id
        AND grocery_row.category_id = grocery_id
    );

  UPDATE public.tenant_type_category_defaults
  SET category_id = grocery_id
  WHERE category_id = groveries_id;

  DELETE FROM public.place_categories WHERE id = groveries_id;
END $$;

COMMIT;
