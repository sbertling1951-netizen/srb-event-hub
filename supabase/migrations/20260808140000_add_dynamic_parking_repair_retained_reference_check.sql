-- Governed Production Repair Plan §9 condition 2 hardening.
--
-- This additive revision replaces only duplicate-retirement revalidation.
-- It discovers every current foreign key whose referenced relation is
-- public.parking_sites from pg_constraint, including future tables without a
-- manually maintained table-name list. The explicit site_placement_history
-- check remains because governed placement history may retain a site through
-- historical columns that are not represented by an ordinary foreign key.
-- Any catalog/probe failure is an exclusion, never a retirement.

CREATE OR REPLACE FUNCTION public._repair_revalidate_duplicate_retirement(
  p_parking_site_id uuid,
  p_survivor_parking_site_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_row public.parking_sites%ROWTYPE;
  v_survivor public.parking_sites%ROWTYPE;
  v_fk record;
  v_fk_reference_exists boolean;
BEGIN
  -- Lock both rows, in stable identifier order, to serialize against any
  -- concurrent repair activity touching either row.
  IF p_parking_site_id < p_survivor_parking_site_id THEN
    SELECT * INTO v_row FROM public.parking_sites WHERE id = p_parking_site_id FOR UPDATE;
    SELECT * INTO v_survivor FROM public.parking_sites WHERE id = p_survivor_parking_site_id FOR UPDATE;
  ELSE
    SELECT * INTO v_survivor FROM public.parking_sites WHERE id = p_survivor_parking_site_id FOR UPDATE;
    SELECT * INTO v_row FROM public.parking_sites WHERE id = p_parking_site_id FOR UPDATE;
  END IF;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('passed', false, 'reason', 'row_no_longer_exists');
  END IF;

  IF v_survivor IS NULL THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'survivor_no_longer_exists',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Condition 1: vacant.
  IF v_row.assigned_attendee_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'no_longer_vacant',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Condition 2a: every current ordinary foreign-key reference to
  -- parking_sites. The catalog supplies both sides of each key, so this
  -- handles single- and multi-column foreign keys without knowing child
  -- table or column names in advance.
  BEGIN
    FOR v_fk IN
      SELECT
        child_ns.nspname AS child_schema,
        child_rel.relname AS child_table,
        con.conname AS constraint_name,
        string_agg(
          format('child.%I IS NOT DISTINCT FROM parent.%I', child_att.attname, parent_att.attname),
          ' AND ' ORDER BY child_key.ordinality
        ) AS join_predicate
      FROM pg_constraint AS con
      JOIN pg_class AS child_rel ON child_rel.oid = con.conrelid
      JOIN pg_namespace AS child_ns ON child_ns.oid = child_rel.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS child_key(attnum, ordinality) ON true
      JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
        ON parent_key.ordinality = child_key.ordinality
      JOIN pg_attribute AS child_att
        ON child_att.attrelid = con.conrelid AND child_att.attnum = child_key.attnum
      JOIN pg_attribute AS parent_att
        ON parent_att.attrelid = con.confrelid AND parent_att.attnum = parent_key.attnum
      WHERE con.contype = 'f'
        AND con.confrelid = 'public.parking_sites'::regclass
      GROUP BY child_ns.nspname, child_rel.relname, con.conname
    LOOP
      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM %I.%I AS child
           JOIN public.parking_sites AS parent ON %s
           WHERE parent.id = $1
         )',
        v_fk.child_schema,
        v_fk.child_table,
        v_fk.join_predicate
      )
      INTO v_fk_reference_exists
      USING v_row.id;

      IF v_fk_reference_exists THEN
        RETURN jsonb_build_object(
          'passed', false,
          'reason', 'foreign_key_reference_exists',
          'retained_reference', jsonb_build_object(
            'kind', 'foreign_key',
            'schema', v_fk.child_schema,
            'table', v_fk.child_table,
            'constraint', v_fk.constraint_name
          ),
          'current_state', to_jsonb(v_row)
        );
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'passed', false,
      'reason', 'retained_reference_check_unproven',
      'retained_reference_check_error', SQLERRM,
      'current_state', to_jsonb(v_row)
    );
  END;

  -- Condition 2b: governed history remains an explicit backstop. It may
  -- retain placement-site identity through historical columns even if a
  -- future history design deliberately avoids ordinary FKs.
  BEGIN
    IF to_regclass('public.site_placement_history') IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.site_placement_history
        WHERE previous_site_id = v_row.id OR resulting_site_id = v_row.id
      ) THEN
        RETURN jsonb_build_object(
          'passed', false,
          'reason', 'governed_retained_reference_exists',
          'retained_reference', jsonb_build_object(
            'kind', 'governed_history',
            'table', 'public.site_placement_history'
          ),
          'current_state', to_jsonb(v_row)
        );
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'passed', false,
      'reason', 'retained_reference_check_unproven',
      'retained_reference_check_error', SQLERRM,
      'current_state', to_jsonb(v_row)
    );
  END;

  -- Condition 3: identical to survivor in every Inventory Equivalence Field.
  IF NOT (
    v_row.site_number IS NOT DISTINCT FROM v_survivor.site_number
    AND v_row.display_label IS NOT DISTINCT FROM v_survivor.display_label
    AND v_row.map_x IS NOT DISTINCT FROM v_survivor.map_x
    AND v_row.map_y IS NOT DISTINCT FROM v_survivor.map_y
    AND v_row.map_image_url IS NOT DISTINCT FROM v_survivor.map_image_url
  ) THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'no_longer_physically_equivalent',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Identity equivalence (Repair Plan §8): both master_site_id null, or
  -- identical non-null. The Deterministic Survivor Rule is never applied
  -- to an Identity Conflict.
  IF NOT (
    (v_row.master_site_id IS NULL AND v_survivor.master_site_id IS NULL)
    OR (v_row.master_site_id IS NOT NULL
        AND v_survivor.master_site_id IS NOT NULL
        AND v_row.master_site_id = v_survivor.master_site_id)
  ) THEN
    RETURN jsonb_build_object(
      'passed', false, 'reason', 'no_longer_identity_equivalent',
      'current_state', to_jsonb(v_row)
    );
  END IF;

  -- Condition 4: survivor preserved, unmodified, in its own right.
  RETURN jsonb_build_object(
    'passed', true,
    'current_state', to_jsonb(v_row),
    'survivor_state', to_jsonb(v_survivor)
  );
END;
$$;

ALTER FUNCTION public._repair_revalidate_duplicate_retirement(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public._repair_revalidate_duplicate_retirement(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._repair_revalidate_duplicate_retirement(uuid, uuid) IS
  'Revalidates Repair Plan §9 duplicate retirement conditions. Foreign-key references to parking_sites are discovered from pg_constraint; site_placement_history remains an explicit governed-record backstop; uncertainty excludes retirement.';
