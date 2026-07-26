BEGIN;

DO $$
DECLARE
  v_constraint_name text;
  v_match_count integer;
BEGIN
  SELECT count(*)
  INTO v_match_count
  FROM pg_constraint c
  JOIN pg_class t
    ON t.oid = c.conrelid
  JOIN pg_namespace n
    ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'person_identifiers'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%source_type%'
    AND pg_get_constraintdef(c.oid) LIKE '%attendee_import%'
    AND pg_get_constraintdef(c.oid) LIKE '%attendee_record%'
    AND pg_get_constraintdef(c.oid) LIKE '%authentication%'
    AND pg_get_constraintdef(c.oid) LIKE '%member_confirmation%'
    AND pg_get_constraintdef(c.oid) LIKE '%administrator%'
    AND pg_get_constraintdef(c.oid) LIKE '%invitation%'
    AND pg_get_constraintdef(c.oid) LIKE '%legacy_system%'
    AND pg_get_constraintdef(c.oid) LIKE '%other%';

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'Unable to safely identify exactly one source_type CHECK constraint on public.person_identifiers. matched=%',
      v_match_count;
  END IF;

  SELECT c.conname
  INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t
    ON t.oid = c.conrelid
  JOIN pg_namespace n
    ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'person_identifiers'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%source_type%'
    AND pg_get_constraintdef(c.oid) LIKE '%attendee_import%'
    AND pg_get_constraintdef(c.oid) LIKE '%attendee_record%'
    AND pg_get_constraintdef(c.oid) LIKE '%authentication%'
    AND pg_get_constraintdef(c.oid) LIKE '%member_confirmation%'
    AND pg_get_constraintdef(c.oid) LIKE '%administrator%'
    AND pg_get_constraintdef(c.oid) LIKE '%invitation%'
    AND pg_get_constraintdef(c.oid) LIKE '%legacy_system%'
    AND pg_get_constraintdef(c.oid) LIKE '%other%'
  LIMIT 1;

  EXECUTE format(
    'ALTER TABLE public.person_identifiers DROP CONSTRAINT %I',
    v_constraint_name
  );
END
$$;

ALTER TABLE public.person_identifiers
  ADD CONSTRAINT person_identifiers_source_type_check CHECK (
    source_type IN (
      'attendee_import',
      'attendee_record',
      'attendee_household_member_record',
      'authentication',
      'member_confirmation',
      'administrator',
      'invitation',
      'legacy_system',
      'other'
    )
  );

COMMENT ON CONSTRAINT person_identifiers_source_type_check ON public.person_identifiers IS
  'source_type evidence provenance: attendee_record means observed on an attendees row; attendee_household_member_record means observed on an attendee_household_members row. These values describe historical evidence provenance only and do not designate current preferred contact information.';

COMMIT;
