-- Agenda Legacy Template Retirement Stage 3B: preserves the meaningful
-- legacy Agenda template content identified by Stage 3A as unique and
-- unmigrated, before any future retirement drop. Does NOT touch, alter,
-- or drop any legacy table/column -- purely additive: one new small
-- provenance table, plus canonical catalog rows representing the legacy
-- content faithfully.
--
-- SYSTEM_MIGRATION_ACTOR: agenda_template_roots/revisions/revision_items
-- all require a NOT NULL created_by_auth_user_id with no FK constraint
-- (verified against the live catalog before writing this migration).
-- Since this content was authored by nobody through the governed UI --
-- it is a historical system migration, not a human action -- a
-- documented, obviously-synthetic all-zero sentinel UUID is used rather
-- than attributing authorship to any real admin. Using a real admin's id
-- here would falsely imply that person created this content, which this
-- migration must not do.
BEGIN;

-- ============================================================
-- Preservation provenance table. Deliberately has NO actor column at
-- all -- this is pure system/migration metadata, not an authored
-- record, so there is no attribution field to misuse.
-- ============================================================

CREATE TABLE public.agenda_legacy_preservation_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preservation_kind text NOT NULL CHECK (preservation_kind IN ('template_root', 'template_item', 'event_association')),
  legacy_source_table text NOT NULL,
  legacy_source_id uuid NOT NULL,
  legacy_related_id uuid,
  canonical_template_root_id uuid REFERENCES public.agenda_template_roots(id),
  canonical_revision_id uuid REFERENCES public.agenda_template_revisions(id),
  canonical_revision_item_id uuid REFERENCES public.agenda_template_revision_items(id),
  note text,
  preserved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legacy_source_table, legacy_source_id, preservation_kind)
);

ALTER TABLE public.agenda_legacy_preservation_record ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_legacy_preservation_record FROM PUBLIC, anon, authenticated, service_role;
-- No policies: closed, matching every other canonical Agenda table's
-- default posture. Not a governed read surface in this stage.

-- ============================================================
-- Preservation body. Guarded per legacy source at the top level (root
-- creation), so re-running this migration is a no-op wherever a
-- preservation record already exists -- idempotent by construction, not
-- merely by convention.
-- ============================================================

DO $$
DECLARE
  v_system_actor uuid := '00000000-0000-0000-0000-000000000000';
  v_fcoc_tenant_id uuid := '16c39847-ce1d-43c3-b9bc-75f33e16d711';
  v_root_id uuid;
  v_revision_id uuid;
  v_item_id uuid;
BEGIN
  -- ============================================================
  -- Root A: "Standard FCOC Event Template" (legacy source:
  -- agenda_template_sets id a28bf6b7 -- there is no corresponding
  -- agenda_templates row, so this set is the sole legacy identity).
  -- Draft only: this content, despite being well-formed, was never
  -- reachable through any admin-facing template picker in the legacy
  -- app (agenda_templates has no row for it), so there is no evidence
  -- it was ever actually published/selectable for real use -- publishing
  -- it now would fabricate an approval that never happened.
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_legacy_preservation_record
    WHERE legacy_source_table = 'agenda_template_sets' AND legacy_source_id = 'a28bf6b7-f6e8-4b74-b610-41610d51def2'
      AND preservation_kind = 'template_root'
  ) THEN
    INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, lifecycle_status, created_by_auth_user_id)
    VALUES ('tenant', v_fcoc_tenant_id, 'Standard FCOC Event Template', 'Default categories and agenda structure for FCOC events', 'active', v_system_actor)
    RETURNING id INTO v_root_id;

    INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
    VALUES (v_root_id, 1, 'draft', v_system_actor)
    RETURNING id INTO v_revision_id;

    INSERT INTO public.agenda_legacy_preservation_record(
      preservation_kind, legacy_source_table, legacy_source_id, canonical_template_root_id, canonical_revision_id, note
    ) VALUES (
      'template_root', 'agenda_template_sets', 'a28bf6b7-f6e8-4b74-b610-41610d51def2', v_root_id, v_revision_id,
      'Preserved from legacy agenda_template_sets (no corresponding agenda_templates row existed -- this set was never reachable through the legacy admin template picker). Draft: no evidence of prior publication/selectability.'
    );

    -- 10 items, root level (section_id NULL): all 10 legacy rows have
    -- template_category_id IS NULL -- no section grouping is invented.
    -- day_offset copies directly (already relative); start/end_time cast
    -- from the legacy text "HH:MM" template fields.
    INSERT INTO public.agenda_template_revision_items(
      revision_id, section_id, title, description, location, speaker, category, color,
      agenda_day_offset, start_time, end_time, is_all_day, is_published, sort_order, external_id, created_by_auth_user_id
    ) VALUES
      (v_revision_id, NULL, 'Arrival / Check-In Opens', NULL, 'Main Office', NULL, NULL, NULL, 0, '13:00'::time, '17:00'::time, false, true, 1, NULL, v_system_actor),
      (v_revision_id, NULL, 'Welcome Gathering', NULL, 'Main Hall', NULL, NULL, NULL, 0, '18:00'::time, '19:00'::time, false, true, 2, NULL, v_system_actor),
      (v_revision_id, NULL, 'Dinner', NULL, 'Event Center', NULL, NULL, NULL, 0, '19:00'::time, '20:00'::time, false, true, 3, NULL, v_system_actor),
      (v_revision_id, NULL, 'Breakfast', NULL, 'Dining Area', NULL, NULL, NULL, 1, '08:00'::time, '09:00'::time, false, true, 4, NULL, v_system_actor),
      (v_revision_id, NULL, 'Morning Seminar', NULL, 'Seminar Room', NULL, NULL, NULL, 1, '09:30'::time, '11:00'::time, false, true, 5, NULL, v_system_actor),
      (v_revision_id, NULL, 'Lunch', NULL, 'Dining Area', NULL, NULL, NULL, 1, '12:00'::time, '13:00'::time, false, true, 6, NULL, v_system_actor),
      (v_revision_id, NULL, 'Afternoon Seminar', NULL, 'Seminar Room', NULL, NULL, NULL, 1, '13:30'::time, '15:00'::time, false, true, 7, NULL, v_system_actor),
      (v_revision_id, NULL, 'Social Hour', NULL, 'Clubhouse', NULL, NULL, NULL, 1, '17:00'::time, '18:00'::time, false, true, 8, NULL, v_system_actor),
      (v_revision_id, NULL, 'Dinner', NULL, 'Event Center', NULL, NULL, NULL, 1, '18:30'::time, '19:30'::time, false, true, 9, NULL, v_system_actor),
      (v_revision_id, NULL, 'Departure Breakfast', NULL, 'Dining Area', NULL, NULL, NULL, 2, '08:00'::time, '09:00'::time, false, true, 10, NULL, v_system_actor);

    -- Item-level traceability: map each legacy item id to its canonical
    -- counterpart. Matched by (title, sort_order) within this revision
    -- since both are unique within the freshly-inserted batch above.
    INSERT INTO public.agenda_legacy_preservation_record(preservation_kind, legacy_source_table, legacy_source_id, canonical_revision_item_id, note)
    SELECT 'template_item', 'agenda_template_items', legacy.id, ri.id, 'Preserved legacy item -> canonical revision item (Standard FCOC Event Template).'
    FROM (VALUES
      ('66c3b0c2-7d56-4697-b078-7c373f4f066d'::uuid, 'Arrival / Check-In Opens', 1),
      ('b3e80b7a-88af-4cbb-a5d0-8ec3475bf12f'::uuid, 'Welcome Gathering', 2),
      ('6b72b9db-512b-43d4-a55b-e532ffe60a8c'::uuid, 'Dinner', 3),
      ('337d56db-2c7a-4081-a026-2edc446d2e17'::uuid, 'Breakfast', 4),
      ('81566965-fa6a-4991-9ffa-033faabe4476'::uuid, 'Morning Seminar', 5),
      ('0ce7f20a-2f8b-4eec-9aa2-a4637ca850ac'::uuid, 'Lunch', 6),
      ('3d4ae526-4872-466d-adb3-4e72873acc15'::uuid, 'Afternoon Seminar', 7),
      ('a5439cee-ded8-46ff-a0d3-fab387c9abc9'::uuid, 'Social Hour', 8),
      ('85257c08-ae12-4073-bcc5-d7744b999419'::uuid, 'Dinner', 9),
      ('e1bd30f8-fdc9-424d-a89b-d410973837b9'::uuid, 'Departure Breakfast', 10)
    ) AS legacy(id, title, sort_order)
    JOIN public.agenda_template_revision_items AS ri
      ON ri.revision_id = v_revision_id AND ri.title = legacy.title AND ri.sort_order = legacy.sort_order;
  END IF;

  -- ============================================================
  -- Root B: "Default Rally Agenda" (legacy source: BOTH agenda_templates
  -- id d3fd38e7 AND agenda_template_sets id d3fd38e7 -- the two legacy
  -- rows share the same id and represent the same real, live-reachable
  -- template; both are recorded as sources for this one preserved root).
  -- Published: agenda_templates.status='active' AND
  -- agenda_template_sets.is_active=true converge, and this content was
  -- genuinely reachable through the legacy admin template picker.
  -- Both items share agenda_date 2026-07-01 (their only date), so
  -- relative to this template's own earliest date, both are day_offset 0.
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_legacy_preservation_record
    WHERE legacy_source_table = 'agenda_templates' AND legacy_source_id = 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430'
      AND preservation_kind = 'template_root'
  ) THEN
    INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, lifecycle_status, created_by_auth_user_id)
    VALUES ('tenant', v_fcoc_tenant_id, 'Default Rally Agenda', 'Starter agenda template for testing', 'active', v_system_actor)
    RETURNING id INTO v_root_id;

    INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
    VALUES (v_root_id, 1, 'draft', v_system_actor)
    RETURNING id INTO v_revision_id;

    INSERT INTO public.agenda_template_revision_items(
      revision_id, section_id, title, description, location, speaker, category, color,
      agenda_day_offset, start_time, end_time, is_all_day, is_published, sort_order, external_id, created_by_auth_user_id
    ) VALUES
      (v_revision_id, NULL, 'Welcome Session', 'Opening remarks and orientation', 'Main Hall', 'Host', 'General', '#dbeafe', 0, '09:00'::time, '10:00'::time, false, true, 1, NULL, v_system_actor),
      (v_revision_id, NULL, 'Technical Session', 'Chassis systems overview', 'Training Room', 'Tech Speaker', 'Training', '#dcfce7', 0, '10:30'::time, '11:30'::time, false, true, 2, NULL, v_system_actor);

    -- Now transition draft -> published (matches publish_agenda_template_revision's
    -- own allowed state transition; done inline here rather than calling
    -- the RPC, since the RPC requires a real caller identity via auth.uid()).
    UPDATE public.agenda_template_revisions
    SET revision_status = 'published', published_at = now(), publication_note = 'Preserved from legacy agenda_templates/agenda_template_sets (Stage 3B). Legacy status was active/is_active=true; content was reachable via the legacy admin template picker.'
    WHERE id = v_revision_id;

    INSERT INTO public.agenda_legacy_preservation_record(preservation_kind, legacy_source_table, legacy_source_id, canonical_template_root_id, canonical_revision_id, note) VALUES
      ('template_root', 'agenda_templates', 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430', v_root_id, v_revision_id, 'Preserved from legacy agenda_templates row "Default Rally Agenda" (status=active). Published: matches legacy reachability.'),
      ('template_root', 'agenda_template_sets', 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430', v_root_id, v_revision_id, 'Same legacy id as the agenda_templates row above (coincidental convergence, not a separate template) -- recorded as a second source for full traceability.');

    INSERT INTO public.agenda_legacy_preservation_record(preservation_kind, legacy_source_table, legacy_source_id, canonical_revision_item_id, note)
    SELECT 'template_item', 'agenda_template_items', legacy.id, ri.id, 'Preserved legacy item -> canonical revision item (Default Rally Agenda).'
    FROM (VALUES
      ('b0fbc929-50c5-4be4-bec4-94a6b13762d3'::uuid, 'Welcome Session', 1),
      ('b938bec4-b934-4ce1-a8a5-1b52b646f7ca'::uuid, 'Technical Session', 2)
    ) AS legacy(id, title, sort_order)
    JOIN public.agenda_template_revision_items AS ri
      ON ri.revision_id = v_revision_id AND ri.title = legacy.title AND ri.sort_order = legacy.sort_order;
  END IF;

  -- ============================================================
  -- Root C: "Basic Agenda" (legacy source: agenda_templates id
  -- 2b3e71a0). Zero legacy items reference this template id -- preserved
  -- faithfully as an empty template, not filled with invented content.
  -- Published: matches its own legacy status='active' (it was reachable
  -- via the picker, even though selecting it would have applied nothing).
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_legacy_preservation_record
    WHERE legacy_source_table = 'agenda_templates' AND legacy_source_id = '2b3e71a0-f027-46c7-98fe-cea4adeb1aca'
      AND preservation_kind = 'template_root'
  ) THEN
    INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, lifecycle_status, created_by_auth_user_id)
    VALUES ('tenant', v_fcoc_tenant_id, 'Basic Agenda', 'Template to follow for agenda setup. Modify as needed and save under event name.', 'active', v_system_actor)
    RETURNING id INTO v_root_id;

    INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
    VALUES (v_root_id, 1, 'draft', v_system_actor)
    RETURNING id INTO v_revision_id;

    UPDATE public.agenda_template_revisions
    SET revision_status = 'published', published_at = now(), publication_note = 'Preserved from legacy agenda_templates row "Basic Agenda" (status=active). Zero items in the legacy source -- preserved empty, not fabricated.'
    WHERE id = v_revision_id;

    INSERT INTO public.agenda_legacy_preservation_record(preservation_kind, legacy_source_table, legacy_source_id, canonical_template_root_id, canonical_revision_id, note) VALUES
      ('template_root', 'agenda_templates', '2b3e71a0-f027-46c7-98fe-cea4adeb1aca', v_root_id, v_revision_id, 'Preserved from legacy agenda_templates row "Basic Agenda". Zero legacy items referenced this template id (confirmed broken/empty save artifact per Stage 2A audit) -- preserved as an empty published revision, faithful to the legacy state.');
  END IF;

  -- ============================================================
  -- Historical Event association: events.assigned_agenda_template_id.
  -- Deliberately NOT an agenda_template_applications row -- Stage 3A
  -- found zero application-history rows for this Event, so there is no
  -- evidence an actual content application ever occurred. This records
  -- only the historical fact of the legacy pointer's existence.
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_legacy_preservation_record
    WHERE legacy_source_table = 'events' AND legacy_source_id = '53136dfb-b039-40b1-9adf-dcb4d648ea87'
      AND preservation_kind = 'event_association'
  ) THEN
    SELECT r.canonical_template_root_id INTO v_root_id FROM public.agenda_legacy_preservation_record r
    WHERE r.legacy_source_table = 'agenda_templates' AND r.legacy_source_id = 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430'
      AND r.preservation_kind = 'template_root';

    INSERT INTO public.agenda_legacy_preservation_record(
      preservation_kind, legacy_source_table, legacy_source_id, legacy_related_id, canonical_template_root_id, note
    ) VALUES (
      'event_association', 'events', '53136dfb-b039-40b1-9adf-dcb4d648ea87', 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430', v_root_id,
      'HISTORICAL SELECTION ONLY, NOT A PROVEN APPLICATION: Event 53136dfb-b039-40b1-9adf-dcb4d648ea87 ("Amana Event & Annual Business Meeting") had events.assigned_agenda_template_id = d3fd38e7-76a3-45e3-8ea0-afacc4d55430 ("Default Rally Agenda") in the legacy system. agenda_template_applications contains zero rows for this Event (verified Stage 3A and re-verified before this migration) -- there is no evidence this template''s content was ever actually copied into the Event''s agenda_items. This record preserves the historical fact of the legacy UI selection only; it must never be interpreted as, or upgraded into, a governed apply/replace application record.'
    );
  END IF;
END;
$$;

COMMIT;
