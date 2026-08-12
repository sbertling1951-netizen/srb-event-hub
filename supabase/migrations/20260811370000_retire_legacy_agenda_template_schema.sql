-- Agenda Legacy Template Retirement Stage 3C: controlled forward
-- retirement of the superseded legacy Agenda template schema, now that
-- Stage 3B has faithfully preserved all meaningful reusable content
-- (canonical catalog) and historical evidence (raw snapshot +
-- agenda_legacy_preservation_record) for it.
--
-- Every precondition below is asserted BEFORE any destructive statement
-- runs (not interleaved), so a failed assertion aborts the whole
-- transaction before anything is touched -- this is the STOP behavior
-- required by this stage's own governing CMD. Every DROP is explicit and
-- individually named; no CASCADE is used anywhere. Tables are dropped in
-- proven dependency order (children before parents), so no FK-cascade is
-- ever needed. Per-table triggers/policies/indexes disappear
-- automatically with their owning table -- this is not a cross-table
-- CASCADE, it is Postgres's normal object-ownership cleanup.
--
-- Does NOT touch: agenda_categories, any canonical Agenda catalog table,
-- agenda_legacy_preservation_record, agenda_template_applications,
-- agenda_template_derivations, agenda_command_ledger, agenda_items,
-- event_agenda_state, or any authority/task-registry object.
BEGIN;

DO $$
DECLARE
  v_count integer;
  v_other_fk_count integer;
BEGIN
  -- Step A precondition: exactly the expected historical association is
  -- present and preserved before the Event column/FK is touched.
  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_legacy_preservation_record
    WHERE preservation_kind = 'event_association' AND legacy_source_table = 'events'
      AND legacy_source_id = '53136dfb-b039-40b1-9adf-dcb4d648ea87'
      AND legacy_related_id = 'd3fd38e7-76a3-45e3-8ea0-afacc4d55430'
  ) THEN
    RAISE EXCEPTION 'STOP: expected historical Event association preservation record missing';
  END IF;

  SELECT count(*) INTO v_count FROM public.events WHERE assigned_agenda_template_id IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STOP: expected exactly 1 Event with non-null assigned_agenda_template_id, found %', v_count;
  END IF;

  -- Step B precondition: agenda_template_items row count and full
  -- preservation-mapping coverage.
  SELECT count(*) INTO v_count FROM public.agenda_template_items;
  IF v_count <> 12 THEN
    RAISE EXCEPTION 'STOP: expected agenda_template_items = 12, found %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agenda_template_items ati
    WHERE NOT EXISTS (
      SELECT 1 FROM public.agenda_legacy_preservation_record r
      WHERE r.legacy_source_table = 'agenda_template_items' AND r.legacy_source_id = ati.id
        AND r.preservation_kind = 'template_item'
    )
  ) THEN
    RAISE EXCEPTION 'STOP: at least one agenda_template_items row has no preservation mapping';
  END IF;

  -- Step C precondition: agenda_template_categories row count and zero
  -- item references (checked now, before agenda_template_items is
  -- dropped below -- this is the real, meaningful check; by the time
  -- Step C's own DROP runs, agenda_template_items no longer exists at
  -- all, so re-checking then would be vacuous).
  SELECT count(*) INTO v_count FROM public.agenda_template_categories;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'STOP: expected agenda_template_categories = 5, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.agenda_template_items WHERE template_category_id IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STOP: expected zero agenda_template_items rows referencing a category, found %', v_count;
  END IF;

  -- Step D precondition: agenda_template_sets row count.
  SELECT count(*) INTO v_count FROM public.agenda_template_sets;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'STOP: expected agenda_template_sets = 2, found %', v_count;
  END IF;

  -- Step E precondition: agenda_templates row count and zero other FKs
  -- besides the one events FK being dropped in Step A.
  SELECT count(*) INTO v_count FROM public.agenda_templates;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'STOP: expected agenda_templates = 2, found %', v_count;
  END IF;

  SELECT count(*) INTO v_other_fk_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.contype = 'f' AND c.confrelid = 'public.agenda_templates'::regclass
    AND c.conname <> 'events_assigned_agenda_template_id_fkey';
  IF v_other_fk_count <> 0 THEN
    RAISE EXCEPTION 'STOP: unexpected additional FK(s) referencing agenda_templates: %', v_other_fk_count;
  END IF;

  -- Canonical preservation gate: re-confirmed immediately before any
  -- destructive statement runs.
  SELECT count(*) INTO v_count FROM public.agenda_template_roots;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'STOP: expected 3 canonical roots, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.agenda_template_revisions;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'STOP: expected 3 canonical revisions, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.agenda_template_revision_items;
  IF v_count <> 12 THEN
    RAISE EXCEPTION 'STOP: expected 12 canonical revision items, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.agenda_legacy_preservation_record;
  IF v_count <> 17 THEN
    RAISE EXCEPTION 'STOP: expected 17 preservation records, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.agenda_template_applications;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STOP: expected zero agenda_template_applications rows (no fabricated application), found %', v_count;
  END IF;
END;
$$;

-- ============================================================
-- Step A: remove the Event legacy pointer. Explicit FK drop, then
-- explicit column drop -- the one historical value is not merely
-- nulled, since it is already durably preserved in the raw snapshot and
-- agenda_legacy_preservation_record.
-- ============================================================

ALTER TABLE public.events DROP CONSTRAINT events_assigned_agenda_template_id_fkey;
ALTER TABLE public.events DROP COLUMN assigned_agenda_template_id;

-- ============================================================
-- Step B: agenda_template_items (children first)
-- ============================================================

DROP TABLE public.agenda_template_items;

-- ============================================================
-- Step C: agenda_template_categories
-- ============================================================

DROP TABLE public.agenda_template_categories;

-- ============================================================
-- Step D: agenda_template_sets
-- ============================================================

DROP TABLE public.agenda_template_sets;

-- ============================================================
-- Step E: agenda_templates (parent last)
-- ============================================================

DROP TABLE public.agenda_templates;

COMMIT;
