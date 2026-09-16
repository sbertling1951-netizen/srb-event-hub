-- Stage: Legacy Stored Area template parent-link repair -- linked proof.
--
-- Installs the exact parity block (the repair function) inside one outer
-- transaction, exercises it against local fixture rows only -- both the
-- successful reconciliation path and every fail-closed abort path -- then
-- rolls everything back. Executed once against a disposable local database
-- (npm run db:verify-replay stack); NOT run against production. No
-- production UUID or production data appears anywhere in this file.

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

CREATE FUNCTION public.stage_area_link_fixture_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'stage_area_link_fixture_assertion_failed: %', p_message;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Baseline row counts on every table this repair must never touch.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_events_count integer;
  v_map_settings_count integer;
  v_parking_count integer;
  v_master_count integer;
  v_master_sites_count integer;
BEGIN
  SELECT count(*) INTO v_events_count FROM public.events;
  SELECT count(*) INTO v_map_settings_count FROM public.event_map_settings;
  SELECT count(*) INTO v_parking_count FROM public.parking_sites;
  SELECT count(*) INTO v_master_count FROM public.nearby_master;
  SELECT count(*) INTO v_master_sites_count FROM public.master_map_sites;

  PERFORM set_config('stage_area_link.events_count', v_events_count::text, false);
  PERFORM set_config('stage_area_link.map_settings_count', v_map_settings_count::text, false);
  PERFORM set_config('stage_area_link.parking_count', v_parking_count::text, false);
  PERFORM set_config('stage_area_link.master_count', v_master_count::text, false);
  PERFORM set_config('stage_area_link.master_sites_count', v_master_sites_count::text, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- SCENARIO 1: successful reconciliation -- both approved mappings, one
-- fresh-parent template, and one already-linked template left untouched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branson_area_id uuid;
  v_stgeorge_area_id uuid;
  v_branson_template_id uuid;
  v_stgeorge_template_id uuid;
  v_fresh_template_id uuid;
  v_prelinked_area_id uuid;
  v_prelinked_template_id uuid;
  v_resolved uuid;
BEGIN
  INSERT INTO public.nearby_areas (name, description)
  VALUES ('Branson, MO', NULL)
  RETURNING id INTO v_branson_area_id;

  INSERT INTO public.nearby_areas (name, description)
  VALUES ('Saint George, UT', 'Existing operational area description.')
  RETURNING id INTO v_stgeorge_area_id;

  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('Branson, MO', 'Template search config for Branson.', NULL)
  RETURNING id INTO v_branson_template_id;

  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('Saint George, UT', 'Template search config for Saint George.', NULL)
  RETURNING id INTO v_stgeorge_template_id;

  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('Fixture Fresh Area One', 'A brand new stored area with no existing collision.', NULL)
  RETURNING id INTO v_fresh_template_id;

  INSERT INTO public.nearby_areas (name, description)
  VALUES ('Fixture Pre-Linked Area', 'Already linked before this repair ever ran.')
  RETURNING id INTO v_prelinked_area_id;

  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('Fixture Pre-Linked Template', 'Already has a valid parent.', v_prelinked_area_id)
  RETURNING id INTO v_prelinked_template_id;

  PERFORM public.repair_legacy_stored_area_template_parent_links();

  SELECT nearby_area_id INTO v_resolved FROM public.nearby_area_templates WHERE id = v_branson_template_id;
  PERFORM public.stage_area_link_fixture_assert(v_resolved = v_branson_area_id, 'Branson approved mapping must link to the existing Branson area');

  SELECT nearby_area_id INTO v_resolved FROM public.nearby_area_templates WHERE id = v_stgeorge_template_id;
  PERFORM public.stage_area_link_fixture_assert(v_resolved = v_stgeorge_area_id, 'Saint George approved mapping must link to the existing Saint George area');

  SELECT nearby_area_id INTO v_resolved FROM public.nearby_area_templates WHERE id = v_fresh_template_id;
  PERFORM public.stage_area_link_fixture_assert(v_resolved IS NOT NULL, 'non-colliding template must receive a fresh parent');
  PERFORM public.stage_area_link_fixture_assert(v_resolved <> v_branson_area_id AND v_resolved <> v_stgeorge_area_id, 'fresh parent must not be one of the approved-mapping areas');
  PERFORM public.stage_area_link_fixture_assert(
    (SELECT name FROM public.nearby_areas WHERE id = v_resolved) = 'Fixture Fresh Area One',
    'fresh parent name must be copied verbatim from the template'
  );
  PERFORM public.stage_area_link_fixture_assert(
    (SELECT description FROM public.nearby_areas WHERE id = v_resolved) = 'A brand new stored area with no existing collision.',
    'fresh parent description must be copied verbatim from the template'
  );

  SELECT nearby_area_id INTO v_resolved FROM public.nearby_area_templates WHERE id = v_prelinked_template_id;
  PERFORM public.stage_area_link_fixture_assert(v_resolved = v_prelinked_area_id, 'an already-linked template''s nearby_area_id must never change');
END;
$$;

SAVEPOINT after_successful_reconciliation;

-- ---------------------------------------------------------------------------
-- SCENARIO 2: duplicate normalized names among null-parent templates abort.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('Fixture Duplicate Area', 'first', NULL);
  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('  fixture duplicate area  ', 'second, same normalized name', NULL);

  BEGIN
    PERFORM public.repair_legacy_stored_area_template_parent_links();
    RAISE EXCEPTION 'duplicate-name run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_area_link_fixture_assert(
      SQLERRM LIKE 'stored_area_parent_link_repair_duplicate_name%',
      'expected the duplicate-name guard to fire'
    );
  END;
END;
$$;

ROLLBACK TO SAVEPOINT after_successful_reconciliation;

-- ---------------------------------------------------------------------------
-- SCENARIO 3: an unreviewed collision with an existing nearby_areas name
-- aborts -- never auto-linked by name alone.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.nearby_areas (name, description)
  VALUES ('Fixture Unreviewed Collision', 'pre-existing area, not an approved mapping');
  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('Fixture Unreviewed Collision', 'template with the same name', NULL);

  BEGIN
    PERFORM public.repair_legacy_stored_area_template_parent_links();
    RAISE EXCEPTION 'unreviewed-collision run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_area_link_fixture_assert(
      SQLERRM LIKE 'stored_area_parent_link_repair_unexpected_collision%',
      'expected the unexpected-collision guard to fire'
    );
  END;
END;
$$;

ROLLBACK TO SAVEPOINT after_successful_reconciliation;

-- ---------------------------------------------------------------------------
-- SCENARIO 4: a blank/whitespace-only null-parent template name aborts.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('   ', 'blank name', NULL);

  BEGIN
    PERFORM public.repair_legacy_stored_area_template_parent_links();
    RAISE EXCEPTION 'blank-name run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_area_link_fixture_assert(
      SQLERRM LIKE 'stored_area_parent_link_repair_blank_name%',
      'expected the blank-name guard to fire'
    );
  END;
END;
$$;

ROLLBACK TO SAVEPOINT after_successful_reconciliation;

-- ---------------------------------------------------------------------------
-- SCENARIO 5: an approved-name template with no matching existing area
-- (or more than one) aborts as ambiguous/missing, never silently created.
--
-- This savepoint restores the state as of right after Scenario 1 -- where
-- Branson's template is ALREADY linked to Branson's ALREADY-EXISTING area.
-- Rolling back to that savepoint does not undo Scenario 1, so the approved
-- parent is not absent by default here. This scenario therefore removes
-- Scenario 1's Branson template and area itself (ordering around the
-- ON DELETE RESTRICT fkey: template first, then its now-unreferenced
-- parent), proves the parent count is genuinely zero, and only then
-- inserts a fresh null-parent "Branson, MO" template and invokes the
-- repair -- a real missing-parent precondition, not an assumed one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branson_template_id uuid;
  v_branson_area_id uuid;
  v_area_count integer;
BEGIN
  SELECT id INTO v_branson_template_id
  FROM public.nearby_area_templates
  WHERE lower(btrim(name)) = 'branson, mo';

  SELECT id INTO v_branson_area_id
  FROM public.nearby_areas
  WHERE lower(btrim(name)) = 'branson, mo';

  PERFORM public.stage_area_link_fixture_assert(
    v_branson_template_id IS NOT NULL AND v_branson_area_id IS NOT NULL,
    'expected Scenario 1''s already-linked Branson template and area to still exist at this savepoint, before this scenario removes them'
  );

  DELETE FROM public.nearby_area_templates WHERE id = v_branson_template_id;
  DELETE FROM public.nearby_areas WHERE id = v_branson_area_id;

  SELECT count(*) INTO v_area_count
  FROM public.nearby_areas
  WHERE lower(btrim(name)) = 'branson, mo';

  PERFORM public.stage_area_link_fixture_assert(
    v_area_count = 0,
    'expected zero existing nearby_areas rows named Branson, MO immediately before the repair function runs'
  );

  INSERT INTO public.nearby_area_templates (name, description, nearby_area_id)
  VALUES ('Branson, MO', 'approved name, no existing parent this time', NULL);

  BEGIN
    PERFORM public.repair_legacy_stored_area_template_parent_links();
    RAISE EXCEPTION 'missing-approved-parent run should have aborted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.stage_area_link_fixture_assert(
      SQLERRM LIKE 'stored_area_parent_link_repair_approved_mapping_ambiguous%',
      'expected the approved-mapping guard to fire when the parent is missing'
    );
  END;
END;
$$;

ROLLBACK TO SAVEPOINT after_successful_reconciliation;

-- ---------------------------------------------------------------------------
-- SCENARIO 6: zero eligible (null-parent) rows is a harmless no-op.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  -- After Scenario 1's own run (still in effect at this savepoint), every
  -- template already has a non-null nearby_area_id.
  SELECT count(*) INTO v_before FROM public.nearby_area_templates WHERE nearby_area_id IS NULL;
  PERFORM public.stage_area_link_fixture_assert(v_before = 0, 'expected zero null-parent templates going into the no-op scenario');

  PERFORM public.repair_legacy_stored_area_template_parent_links();

  SELECT count(*) INTO v_after FROM public.nearby_area_templates WHERE nearby_area_id IS NULL;
  PERFORM public.stage_area_link_fixture_assert(v_after = 0, 'a zero-eligible-rows run must remain a harmless no-op');
END;
$$;

ROLLBACK TO SAVEPOINT after_successful_reconciliation;

-- ---------------------------------------------------------------------------
-- Final proof: no row was ever added to, removed from, or otherwise
-- touched on any out-of-scope table across the entire exercise above.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.stage_area_link_fixture_assert(
    (SELECT count(*) FROM public.events) = current_setting('stage_area_link.events_count')::integer,
    'events row count must be unchanged'
  );
  PERFORM public.stage_area_link_fixture_assert(
    (SELECT count(*) FROM public.event_map_settings) = current_setting('stage_area_link.map_settings_count')::integer,
    'event_map_settings row count must be unchanged'
  );
  PERFORM public.stage_area_link_fixture_assert(
    (SELECT count(*) FROM public.parking_sites) = current_setting('stage_area_link.parking_count')::integer,
    'parking_sites row count must be unchanged'
  );
  PERFORM public.stage_area_link_fixture_assert(
    (SELECT count(*) FROM public.nearby_master) = current_setting('stage_area_link.master_count')::integer,
    'nearby_master row count must be unchanged'
  );
  PERFORM public.stage_area_link_fixture_assert(
    (SELECT count(*) FROM public.master_map_sites) = current_setting('stage_area_link.master_sites_count')::integer,
    'master_map_sites row count must be unchanged'
  );
END;
$$;

ROLLBACK;
