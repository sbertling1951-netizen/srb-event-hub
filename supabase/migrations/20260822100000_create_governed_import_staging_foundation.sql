-- Governed Imports staging foundation -- Stage 1 of Attendee Import
-- Architecture Reconciliation.  This is intentionally additive: the legacy
-- event_import_rows path and app/admin/imports remain untouched until a later
-- attendee-domain commit stage replaces that workflow.
BEGIN;

CREATE TABLE public.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  import_type text NOT NULL CHECK (import_type IN ('attendee_roster', 'agenda', 'vendors', 'other')),
  source_filename text NULL,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  created_by_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'ready_for_review', 'finalized')),
  finalized_at timestamptz NULL,
  CHECK ((status = 'finalized') = (finalized_at IS NOT NULL)),
  UNIQUE (id, event_id)
);

CREATE INDEX import_runs_event_created_idx ON public.import_runs (event_id, created_at DESC);

CREATE TABLE public.import_run_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL,
  event_id uuid NOT NULL,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload) = 'object'),
  normalized_candidate jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(normalized_candidate) = 'object'),
  source_fingerprint text NOT NULL CHECK (btrim(source_fingerprint) <> ''),
  commit_idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  validation_state text NOT NULL DEFAULT 'pending' CHECK (validation_state IN ('pending', 'valid', 'invalid')),
  validation_details jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_details) = 'array'),
  review_state text NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed', 'needs_review', 'approved')),
  row_state text NOT NULL DEFAULT 'parsed' CHECK (row_state IN ('parsed', 'validation_failed', 'needs_review', 'approved', 'committed', 'commit_failed')),
  canonical_target_id uuid NULL,
  commit_state text NOT NULL DEFAULT 'not_started' CHECK (commit_state IN ('not_started', 'committed', 'failed')),
  commit_result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(commit_result) = 'object'),
  commit_error jsonb NULL CHECK (commit_error IS NULL OR jsonb_typeof(commit_error) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz NULL,
  CONSTRAINT import_run_rows_run_event_fkey
    FOREIGN KEY (import_run_id, event_id) REFERENCES public.import_runs (id, event_id) ON DELETE RESTRICT,
  CONSTRAINT import_run_rows_state_consistency CHECK (
    (row_state = 'parsed' AND validation_state = 'pending' AND review_state = 'unreviewed' AND commit_state = 'not_started') OR
    (row_state = 'validation_failed' AND validation_state = 'invalid' AND review_state = 'unreviewed' AND commit_state = 'not_started') OR
    (row_state = 'needs_review' AND validation_state = 'valid' AND review_state = 'needs_review' AND commit_state = 'not_started') OR
    (row_state = 'approved' AND validation_state = 'valid' AND review_state = 'approved' AND commit_state = 'not_started') OR
    (row_state = 'committed' AND validation_state = 'valid' AND review_state = 'approved' AND commit_state = 'committed' AND committed_at IS NOT NULL) OR
    (row_state = 'commit_failed' AND validation_state = 'valid' AND review_state = 'approved' AND commit_state = 'failed')
  ),
  UNIQUE (import_run_id, source_row_number),
  UNIQUE (import_run_id, source_fingerprint),
  UNIQUE (commit_idempotency_key)
);

CREATE INDEX import_run_rows_run_state_idx ON public.import_run_rows (import_run_id, row_state, source_row_number);
CREATE INDEX import_run_rows_event_idx ON public.import_run_rows (event_id, created_at DESC);

ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_run_rows ENABLE ROW LEVEL SECURITY;

-- Direct table access is deliberately unavailable.  Imports owns these
-- records, but only its governed operations may create or advance them.
REVOKE ALL ON TABLE public.import_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.import_run_rows FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_import_run_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.import_type IS DISTINCT FROM OLD.import_type
    OR NEW.source_filename IS DISTINCT FROM OLD.source_filename
    OR NEW.source_metadata IS DISTINCT FROM OLD.source_metadata
    OR NEW.created_by_auth_user_id IS DISTINCT FROM OLD.created_by_auth_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'import run source evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_runs_preserve_source_evidence
BEFORE UPDATE ON public.import_runs
FOR EACH ROW EXECUTE FUNCTION public.prevent_import_run_source_mutation();

CREATE OR REPLACE FUNCTION public.prevent_import_run_row_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NEW.import_run_id IS DISTINCT FROM OLD.import_run_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.source_row_number IS DISTINCT FROM OLD.source_row_number
    OR NEW.source_payload IS DISTINCT FROM OLD.source_payload
    OR NEW.normalized_candidate IS DISTINCT FROM OLD.normalized_candidate
    OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
    OR NEW.commit_idempotency_key IS DISTINCT FROM OLD.commit_idempotency_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'import row source evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_run_rows_preserve_source_evidence
BEFORE UPDATE ON public.import_run_rows
FOR EACH ROW EXECUTE FUNCTION public.prevent_import_run_row_source_mutation();

CREATE OR REPLACE FUNCTION public.create_import_run(
  p_event_id uuid,
  p_import_type text,
  p_source_filename text DEFAULT NULL,
  p_source_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.import_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL OR p_import_type IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', p_event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(p_event_id);
  INSERT INTO public.import_runs (event_id, import_type, source_filename, source_metadata, created_by_auth_user_id)
  VALUES (p_event_id, p_import_type, nullif(btrim(p_source_filename), ''), coalesce(p_source_metadata, '{}'::jsonb), auth.uid())
  RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_import_run_row(
  p_import_run_id uuid,
  p_source_row_number integer,
  p_source_payload jsonb,
  p_normalized_candidate jsonb,
  p_source_fingerprint text
)
RETURNS public.import_run_rows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_event_id uuid; v_row public.import_run_rows%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL OR p_source_row_number IS NULL
    OR p_source_payload IS NULL OR p_source_fingerprint IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;
  SELECT event_id INTO v_event_id FROM public.import_runs WHERE id = p_import_run_id AND status = 'staging' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_run_not_staging' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_event_id);
  INSERT INTO public.import_run_rows (import_run_id, event_id, source_row_number, source_payload, normalized_candidate, source_fingerprint)
  VALUES (p_import_run_id, v_event_id, p_source_row_number, p_source_payload, coalesce(p_normalized_candidate, '{}'::jsonb), p_source_fingerprint)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_import_run_row_review_state(
  p_import_run_row_id uuid,
  p_validation_state text,
  p_validation_details jsonb DEFAULT '[]'::jsonb,
  p_review_state text DEFAULT 'unreviewed'
)
RETURNS public.import_run_rows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_row public.import_run_rows%ROWTYPE; v_next_state text;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_row_id IS NULL OR p_validation_state IS NULL OR p_review_state IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  SELECT r.* INTO v_row FROM public.import_run_rows r JOIN public.import_runs run ON run.id = r.import_run_id
  WHERE r.id = p_import_run_row_id AND run.status IN ('staging', 'ready_for_review') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_row_not_mutable' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_row.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_row.event_id);
  IF p_validation_state = 'invalid' AND p_review_state = 'unreviewed' THEN v_next_state := 'validation_failed';
  ELSIF p_validation_state = 'valid' AND p_review_state = 'needs_review' THEN v_next_state := 'needs_review';
  ELSIF p_validation_state = 'valid' AND p_review_state = 'approved' THEN v_next_state := 'approved';
  ELSE RAISE EXCEPTION 'invalid_import_row_state_transition' USING ERRCODE = '22023'; END IF;
  UPDATE public.import_run_rows SET validation_state = p_validation_state, validation_details = coalesce(p_validation_details, '[]'::jsonb),
    review_state = p_review_state, row_state = v_next_state, updated_at = now() WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_import_run(p_import_run_id uuid)
RETURNS public.import_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id AND status IN ('staging', 'ready_for_review') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_run_not_finalizable' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.manage', v_run.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_run.event_id);
  IF EXISTS (SELECT 1 FROM public.import_run_rows WHERE import_run_id = v_run.id AND validation_state = 'pending') THEN RAISE EXCEPTION 'import_run_has_unvalidated_rows' USING ERRCODE = '22023'; END IF;
  UPDATE public.import_runs SET status = 'finalized', finalized_at = now() WHERE id = v_run.id RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_import_run_status(p_import_run_id uuid)
RETURNS TABLE (run public.import_runs, parsed_count bigint, validation_failed_count bigint, needs_review_count bigint, approved_count bigint, committed_count bigint, commit_failed_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_run public.import_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_import_run_id IS NULL THEN RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_run FROM public.import_runs WHERE id = p_import_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_run_not_found' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_event_task_authority('event.imports.view', v_run.event_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT v_run,
    count(*) FILTER (WHERE row_state = 'parsed'), count(*) FILTER (WHERE row_state = 'validation_failed'),
    count(*) FILTER (WHERE row_state = 'needs_review'), count(*) FILTER (WHERE row_state = 'approved'),
    count(*) FILTER (WHERE row_state = 'committed'), count(*) FILTER (WHERE row_state = 'commit_failed')
  FROM public.import_run_rows WHERE import_run_id = v_run.id;
END;
$$;

ALTER FUNCTION public.create_import_run(uuid, text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.stage_import_run_row(uuid, integer, jsonb, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.set_import_run_row_review_state(uuid, text, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.finalize_import_run(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_import_run_status(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_import_run(uuid, text, text, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.stage_import_run_row(uuid, integer, jsonb, jsonb, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_import_run_row_review_state(uuid, text, jsonb, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.finalize_import_run(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_import_run_status(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_import_run(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stage_import_run_row(uuid, integer, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_import_run_row_review_state(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_import_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_import_run_status(uuid) TO authenticated;

COMMIT;
