-- Repair legacy Stored Area template parent links.
--
-- WHAT WAS WRONG: 20260825010000 added the explicit
-- nearby_area_templates.nearby_area_id parent-identity column but never
-- backfilled it for pre-existing rows ("it never infers or backfills a
-- relationship for existing rows"). Every legacy template therefore still
-- has nearby_area_id IS NULL. Event Admin's "Selected Stored Nearby List"
-- picker (app/admin/events/page.tsx) saves the TEMPLATE's own id into
-- events.selected_nearby_area_id, but that column's FK
-- (events_selected_nearby_area_id_fkey) targets nearby_areas(id) -- a
-- different table. Every save fails
-- "violates foreign key constraint events_selected_nearby_area_id_fkey".
--
-- GOVERNING MODEL (approved): nearby_area_templates remains the browser
-- selection identity (per 20260825010000's own words); the FK, RLS, grants,
-- and ON DELETE RESTRICT on nearby_area_templates_nearby_area_id_fkey are
-- unchanged by this migration. This stage only backfills the missing
-- parent link, using exactly the same provenance create_stored_area
-- already uses for new rows (name/description copied verbatim, both
-- normalized via nullif(btrim(...), '')).
--
-- Two explicitly Pap-reviewed name collisions get an EXPLICIT mapping to
-- their existing, already-operational nearby_areas parent (confirmed by
-- separate read-only production evidence: both existing areas predate
-- their same-named template and already have real nearby_master rows;
-- one is actively selected by a live Event). No other collision is ever
-- auto-linked by name -- an unreviewed collision aborts the whole
-- migration instead.
--
-- The reconciliation logic is written as a plain (SECURITY INVOKER)
-- function, called once by this migration and dropped again at the end of
-- the same transaction: this is purely a vehicle for the one-time backfill
-- and for exercising each fail-closed path independently in the linked
-- rollback fixture (this repo's own nested BEGIN/EXCEPTION idiom, e.g.
-- 20260822120000's fixture, requires a callable function -- a bare
-- anonymous DO block cannot be caught from within another DO block). It
-- adds no persistent schema surface: it is dropped before COMMIT, and it
-- is never GRANTed to authenticated/anon/PUBLIC at any point.
--
-- FAIL-CLOSED, in order, before any write:
--   1. any null-parent template with a blank/whitespace-only name aborts;
--   2. duplicate normalized names among null-parent templates abort;
--   3. any null-parent template OTHER than the two approved names that
--      collides with an existing nearby_areas name aborts (never silently
--      auto-linked);
--   4. each approved name, if present among null-parent templates, must
--      resolve to EXACTLY ONE existing nearby_areas row with that same
--      normalized name -- zero or more than one aborts.
-- Only after every guard above passes does the function write anything.
-- A non-null nearby_area_id is never selected as a target by any query
-- below, so it can never be touched. Zero null-parent templates makes
-- every guard trivially pass and every write loop select zero rows -- a
-- harmless no-op.
--
-- OUT OF SCOPE, untouched by any statement below: events,
-- event_map_settings, parking_sites, nearby_master, nearby_master_places,
-- nearby_event, master_map_sites, every RLS policy, every grant, and the
-- pre-existing nearby_area_templates_nearby_area_id_fkey definition
-- itself (still ON DELETE RESTRICT, still REFERENCES nearby_areas(id)).

BEGIN;

-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE FUNCTION public.repair_legacy_stored_area_template_parent_links()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_blank_count integer;
  v_duplicate_count integer;
  v_unexpected_collision_count integer;
  v_approved_name text;
  v_approved_template_id uuid;
  v_approved_area_id uuid;
  v_approved_area_count integer;
  v_fresh_row record;
  v_new_area_id uuid;
BEGIN
  -- Guard 1: no null-parent template may have a blank/whitespace-only name.
  SELECT count(*) INTO v_blank_count
  FROM public.nearby_area_templates
  WHERE nearby_area_id IS NULL
    AND nullif(btrim(name), '') IS NULL;

  IF v_blank_count > 0 THEN
    RAISE EXCEPTION
      'stored_area_parent_link_repair_blank_name: % null-parent template(s) have a blank or whitespace-only name.',
      v_blank_count;
  END IF;

  -- Guard 2: no two null-parent templates may share a normalized name.
  SELECT count(*) INTO v_duplicate_count
  FROM (
    SELECT lower(btrim(name)) AS norm_name
    FROM public.nearby_area_templates
    WHERE nearby_area_id IS NULL
    GROUP BY lower(btrim(name))
    HAVING count(*) > 1
  ) AS duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION
      'stored_area_parent_link_repair_duplicate_name: % duplicate normalized name(s) among null-parent templates.',
      v_duplicate_count;
  END IF;

  -- Guard 3: any null-parent template OTHER than the two approved names
  -- that collides with an existing nearby_areas name aborts the whole
  -- run -- never auto-linked by name alone.
  SELECT count(*) INTO v_unexpected_collision_count
  FROM public.nearby_area_templates AS t
  WHERE t.nearby_area_id IS NULL
    AND lower(btrim(t.name)) NOT IN ('branson, mo', 'saint george, ut')
    AND EXISTS (
      SELECT 1 FROM public.nearby_areas AS a
      WHERE lower(btrim(a.name)) = lower(btrim(t.name))
    );

  IF v_unexpected_collision_count > 0 THEN
    RAISE EXCEPTION
      'stored_area_parent_link_repair_unexpected_collision: % null-parent template(s) collide with an existing nearby_areas name outside the two approved mappings.',
      v_unexpected_collision_count;
  END IF;

  -- Guard 4 + write: the two explicitly approved collision mappings.
  -- Each is resolved and validated independently; either is skipped
  -- entirely (not an error) if no null-parent template with that exact
  -- normalized name currently exists.
  FOREACH v_approved_name IN ARRAY ARRAY['branson, mo', 'saint george, ut']
  LOOP
    SELECT t.id INTO v_approved_template_id
    FROM public.nearby_area_templates AS t
    WHERE t.nearby_area_id IS NULL
      AND lower(btrim(t.name)) = v_approved_name;

    IF v_approved_template_id IS NULL THEN
      CONTINUE; -- nothing to reconcile for this name right now.
    END IF;

    SELECT count(*) INTO v_approved_area_count
    FROM public.nearby_areas AS a
    WHERE lower(btrim(a.name)) = v_approved_name;

    IF v_approved_area_count <> 1 THEN
      RAISE EXCEPTION
        'stored_area_parent_link_repair_approved_mapping_ambiguous: approved mapping for "%" expected exactly one existing nearby_areas match, found %.',
        v_approved_name, v_approved_area_count;
    END IF;

    SELECT a.id INTO v_approved_area_id
    FROM public.nearby_areas AS a
    WHERE lower(btrim(a.name)) = v_approved_name;

    UPDATE public.nearby_area_templates
    SET nearby_area_id = v_approved_area_id
    WHERE id = v_approved_template_id
      AND nearby_area_id IS NULL;

    v_approved_template_id := NULL;
    v_approved_area_id := NULL;
  END LOOP;

  -- Write: every remaining null-parent template (guard 3 already proved
  -- none of these collide with an existing nearby_areas name) gets a
  -- fresh parent, named/described exactly as create_stored_area normalizes
  -- a brand-new Stored Area.
  FOR v_fresh_row IN
    SELECT id, name, description
    FROM public.nearby_area_templates
    WHERE nearby_area_id IS NULL
  LOOP
    INSERT INTO public.nearby_areas (name, description)
    VALUES (
      nullif(btrim(v_fresh_row.name), ''),
      nullif(btrim(v_fresh_row.description), '')
    )
    RETURNING id INTO v_new_area_id;

    UPDATE public.nearby_area_templates
    SET nearby_area_id = v_new_area_id
    WHERE id = v_fresh_row.id
      AND nearby_area_id IS NULL;

    v_new_area_id := NULL;
  END LOOP;
END;
$function$;

-- PARITY END
-- ============================================================

REVOKE ALL ON FUNCTION public.repair_legacy_stored_area_template_parent_links() FROM PUBLIC;

SELECT public.repair_legacy_stored_area_template_parent_links();

DROP FUNCTION public.repair_legacy_stored_area_template_parent_links();

COMMIT;
