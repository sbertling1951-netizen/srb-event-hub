-- Tenant-scoped, target-addressed, snapshot Evaluations rebuild.
--
-- Replaces 20260618_add_evaluations.sql (hardcoded question UUIDs captured
-- into client code, no tenant scoping, drifted/unused config tables,
-- anonymously-SELECTable config, event-only) with configuration-as-data:
--
--   template  ──►  assignment (target_type, target_id)  ──►  responses
--
--   * A tenant OWNS mutable evaluation templates (questions + choices).
--   * An ASSIGNMENT attaches a template to a governed TARGET and takes an
--     IMMUTABLE per-assignment SNAPSHOT of the template. V1 target types:
--       - 'event'       -> the overall Event Evaluation (one per event)
--       - 'agenda_item' -> a Presentation / session evaluation (optional
--                          per agenda item; the same template may be
--                          assigned to many agenda items, each with its
--                          own independent snapshot)
--     target_type is an open text domain guarded by a CHECK so future
--     targets extend without an engine redesign.
--   * Members answer against the assignment snapshot; responses bind to
--     assignment_question_id and carry target_type + target_id, so editing
--     a reusable template later never rewrites the meaning of answers
--     already submitted for any target. Once any response exists the
--     assignment is frozen.
--   * Presenter/vendor/session context is NOT duplicated into the
--     evaluation: agenda-item reporting joins public.agenda_items live.
--   * Every access path is a SECURITY DEFINER RPC. All eight tables are
--     RLS-enabled with ZERO policies and no role grant.
--
-- The prior Amana26 evaluation data (event_evaluations /
-- event_evaluation_answers) is deliberately DROPPED -- no backward-compat
-- or data-migration step. Member identity reuses
-- resolve_temporary_or_authenticated_attendee (Account + Temporary Event
-- Access). Admin reporting reuses event.reports.view. One new tenant task
-- key is registered: tenant.evaluations.manage. No identity/session
-- primitive, legacy-domain transfer, participant schema, or applied
-- migration is touched.

BEGIN;

-- ── Fail-closed drift guard ────────────────────────────────────────────
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'must run as the migration owner (postgres)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_task_registry
    WHERE task_key = 'event.reports.view' AND is_active
  ) THEN
    RAISE EXCEPTION 'expected task event.reports.view to exist for evaluation reporting authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resolve_temporary_or_authenticated_attendee'
  ) THEN
    RAISE EXCEPTION 'expected resolve_temporary_or_authenticated_attendee to exist as the member identity gate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'agenda_items' AND relnamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'expected public.agenda_items for the agenda_item evaluation target';
  END IF;
END
$guard$;

-- ── Retire the original evaluation schema (approved data loss) ──────────
DROP TABLE IF EXISTS
  public.event_evaluation_answers,
  public.event_evaluations,
  public.evaluation_choices,
  public.evaluation_questions,
  public.evaluation_templates
  CASCADE;

-- ── Shared updated_at trigger fn ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_evaluation_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
ALTER FUNCTION public.set_evaluation_row_updated_at() OWNER TO postgres;

-- =====================================================================
-- Template layer -- tenant-owned, freely mutable configuration
-- =====================================================================
CREATE TABLE public.tenant_evaluation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 200),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_evaluation_templates_tenant_idx
  ON public.tenant_evaluation_templates (tenant_id, is_active);
CREATE TRIGGER tenant_evaluation_templates_updated_at
  BEFORE UPDATE ON public.tenant_evaluation_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_evaluation_row_updated_at();

CREATE TABLE public.tenant_evaluation_template_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.tenant_evaluation_templates(id) ON DELETE CASCADE,
  prompt text NOT NULL CHECK (btrim(prompt) <> '' AND char_length(prompt) <= 500),
  question_type text NOT NULL CHECK (question_type IN
    ('single_choice','multi_select','yes_no','rating','free_text')),
  is_required boolean NOT NULL DEFAULT false,
  allow_comment boolean NOT NULL DEFAULT false,
  position integer NOT NULL CHECK (position >= 0),
  rating_min integer NOT NULL DEFAULT 1,
  rating_max integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rating_min >= 0 AND rating_max > rating_min AND rating_max <= 100)
);
CREATE INDEX tenant_evaluation_template_questions_template_idx
  ON public.tenant_evaluation_template_questions (template_id, position);
CREATE TRIGGER tenant_evaluation_template_questions_updated_at
  BEFORE UPDATE ON public.tenant_evaluation_template_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_evaluation_row_updated_at();

CREATE TABLE public.tenant_evaluation_template_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.tenant_evaluation_template_questions(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (btrim(label) <> '' AND char_length(label) <= 200),
  position integer NOT NULL CHECK (position >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_evaluation_template_choices_question_idx
  ON public.tenant_evaluation_template_choices (question_id, position);

-- =====================================================================
-- Assignment layer -- template attached to a governed target + snapshot
-- =====================================================================
CREATE TABLE public.evaluation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('event','agenda_item')),
  target_id uuid NOT NULL,
  source_template_id uuid REFERENCES public.tenant_evaluation_templates(id) ON DELETE SET NULL,
  source_template_name text NOT NULL,
  snapshotted_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id)
);
CREATE INDEX evaluation_assignments_event_idx
  ON public.evaluation_assignments (event_id, target_type);

CREATE TABLE public.evaluation_assignment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.evaluation_assignments(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  question_type text NOT NULL CHECK (question_type IN
    ('single_choice','multi_select','yes_no','rating','free_text')),
  is_required boolean NOT NULL,
  allow_comment boolean NOT NULL,
  position integer NOT NULL,
  rating_min integer NOT NULL DEFAULT 1,
  rating_max integer NOT NULL DEFAULT 5
);
CREATE INDEX evaluation_assignment_questions_assignment_idx
  ON public.evaluation_assignment_questions (assignment_id, position);

CREATE TABLE public.evaluation_assignment_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_question_id uuid NOT NULL REFERENCES public.evaluation_assignment_questions(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL
);
CREATE INDEX evaluation_assignment_choices_question_idx
  ON public.evaluation_assignment_choices (assignment_question_id, position);

-- =====================================================================
-- Responses -- bind to the assignment snapshot; carry the target identity
-- =====================================================================
CREATE TABLE public.evaluation_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.evaluation_assignments(id) ON DELETE RESTRICT,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  is_complete boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, attendee_id)
);
CREATE INDEX evaluation_responses_target_idx
  ON public.evaluation_responses (target_type, target_id);
CREATE INDEX evaluation_responses_event_idx
  ON public.evaluation_responses (event_id);
CREATE TRIGGER evaluation_responses_updated_at
  BEFORE UPDATE ON public.evaluation_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_evaluation_row_updated_at();

CREATE TABLE public.evaluation_response_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES public.evaluation_responses(id) ON DELETE CASCADE,
  assignment_question_id uuid NOT NULL REFERENCES public.evaluation_assignment_questions(id) ON DELETE RESTRICT,
  answer_text text,
  selected_labels text[] NOT NULL DEFAULT '{}',
  rating_value integer,
  comment_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, assignment_question_id)
);
CREATE INDEX evaluation_response_answers_question_idx
  ON public.evaluation_response_answers (assignment_question_id);
CREATE TRIGGER evaluation_response_answers_updated_at
  BEFORE UPDATE ON public.evaluation_response_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_evaluation_row_updated_at();

-- ── RLS: deny-all on every table; RPC-only ─────────────────────────────
ALTER TABLE public.tenant_evaluation_templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_evaluation_template_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_evaluation_template_choices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_assignments                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_assignment_questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_assignment_choices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_responses                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_response_answers            ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.tenant_evaluation_templates,
  public.tenant_evaluation_template_questions,
  public.tenant_evaluation_template_choices,
  public.evaluation_assignments,
  public.evaluation_assignment_questions,
  public.evaluation_assignment_choices,
  public.evaluation_responses,
  public.evaluation_response_answers
  FROM PUBLIC, anon, authenticated, service_role;

-- ── New tenant-scoped task ─────────────────────────────────────────────
INSERT INTO public.admin_task_registry
  (task_key, scope, task_kind, description, platform_inherits, tenant_inherits, event_assignment_grantable)
VALUES
  ('tenant.evaluations.manage', 'tenant', 'governance',
   'Manage tenant evaluation templates and Event / agenda-item evaluation assignments.',
   true, true, false)
ON CONFLICT (task_key) DO NOTHING;

-- =====================================================================
-- Canonical default template definition (the initial seven questions).
-- Fresh replay and every tenant derive their default from THIS function --
-- no UUID is ever copied from production, and no FCOC/Freightliner wording
-- is embedded ("More Freightliner Topics" is deliberately dropped; tenants
-- add their own manufacturer topic through the builder).
-- =====================================================================
CREATE OR REPLACE FUNCTION public._evaluation_default_template_definition()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'name', 'Default Event Evaluation',
    'description', 'Starter evaluation. Edit the wording, add or remove questions, and configure choices for your event.',
    'questions', jsonb_build_array(
      jsonb_build_object(
        'prompt', 'What was your overall impression of this event?',
        'question_type', 'single_choice', 'is_required', true, 'allow_comment', true,
        'choices', jsonb_build_array('Excellent','Very Good','Good','Fair','Poor')),
      jsonb_build_object(
        'prompt', 'What parts of the event provided the most value?',
        'question_type', 'multi_select', 'is_required', true, 'allow_comment', true,
        'choices', jsonb_build_array('Technical Seminars','Social Activities','Friendships & Camaraderie',
          'Vendor Displays','Coach Tours','Local Tours','Entertainment','Meals','Other')),
      jsonb_build_object(
        'prompt', 'Where did we miss the mark?',
        'question_type', 'multi_select', 'is_required', false, 'allow_comment', true,
        'choices', jsonb_build_array('Registration','Check-In','Parking','Communications','Agenda',
          'Venue','Activities','Technology/App','Meals','Other')),
      jsonb_build_object(
        'prompt', 'What would you like to see at future events?',
        'question_type', 'multi_select', 'is_required', false, 'allow_comment', true,
        'choices', jsonb_build_array('More Technical Content','More Social Activities','More Vendor Participation',
          'More Coach Tours','More Local Tours','More Entertainment','More Free Time','Other')),
      jsonb_build_object(
        'prompt', 'What was your favorite memory from this event?',
        'question_type', 'free_text', 'is_required', false, 'allow_comment', false,
        'choices', jsonb_build_array()),
      jsonb_build_object(
        'prompt', 'Anything else you would like us to know?',
        'question_type', 'free_text', 'is_required', false, 'allow_comment', false,
        'choices', jsonb_build_array()),
      jsonb_build_object(
        'prompt', 'How likely are you to attend another event?',
        'question_type', 'single_choice', 'is_required', true, 'allow_comment', true,
        'choices', jsonb_build_array('Definitely','Likely','Maybe','Unlikely','No'))
    )
  );
$$;
ALTER FUNCTION public._evaluation_default_template_definition() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_default_template_definition() FROM PUBLIC, anon, authenticated, service_role;

-- A neutral starter template for presentation / agenda-item evaluations.
CREATE OR REPLACE FUNCTION public._evaluation_default_presentation_definition()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'name', 'Default Presentation Evaluation',
    'description', 'Starter evaluation for a seminar, session, or vendor presentation. Edit freely.',
    'questions', jsonb_build_array(
      jsonb_build_object(
        'prompt', 'How would you rate this presentation overall?',
        'question_type', 'rating', 'is_required', true, 'allow_comment', true, 'choices', jsonb_build_array()),
      jsonb_build_object(
        'prompt', 'Was the content relevant and useful to you?',
        'question_type', 'yes_no', 'is_required', true, 'allow_comment', true, 'choices', jsonb_build_array()),
      jsonb_build_object(
        'prompt', 'What did you find most valuable?',
        'question_type', 'free_text', 'is_required', false, 'allow_comment', false, 'choices', jsonb_build_array()),
      jsonb_build_object(
        'prompt', 'What could be improved?',
        'question_type', 'free_text', 'is_required', false, 'allow_comment', false, 'choices', jsonb_build_array())
    )
  );
$$;
ALTER FUNCTION public._evaluation_default_presentation_definition() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_default_presentation_definition() FROM PUBLIC, anon, authenticated, service_role;

-- =====================================================================
-- Internal gates
-- =====================================================================
CREATE OR REPLACE FUNCTION public._evaluation_assert_config_authority(p_event_id uuid)
RETURNS TABLE(tenant_id uuid, actor_admin_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  SELECT e.tenant_id INTO tenant_id FROM public.events e WHERE e.id = p_event_id;
  IF tenant_id IS NULL THEN
    RAISE EXCEPTION 'event or tenant not found';
  END IF;
  IF NOT public.has_event_task_authority('tenant.evaluations.manage', p_event_id) THEN
    RAISE EXCEPTION 'caller lacks tenant evaluation management authority';
  END IF;
  SELECT au.id INTO actor_admin_user_id
  FROM public.admin_users au WHERE au.user_id = auth.uid() AND au.is_active;
  RETURN NEXT;
END
$$;
ALTER FUNCTION public._evaluation_assert_config_authority(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_assert_config_authority(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._evaluation_assert_template_in_tenant(p_event_id uuid, p_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_tenant uuid; v_tpl_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public._evaluation_assert_config_authority(p_event_id);
  SELECT tenant_id INTO v_tpl_tenant FROM public.tenant_evaluation_templates WHERE id = p_template_id;
  IF v_tpl_tenant IS NULL OR v_tpl_tenant <> v_tenant THEN
    RAISE EXCEPTION 'template does not belong to this Event''s tenant';
  END IF;
  RETURN v_tenant;
END
$$;
ALTER FUNCTION public._evaluation_assert_template_in_tenant(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_assert_template_in_tenant(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Validate (target_type, target_id) for the given Event; RAISE on mismatch.
CREATE OR REPLACE FUNCTION public._evaluation_assert_target(p_event_id uuid, p_target_type text, p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_agenda_event uuid;
BEGIN
  IF p_target_type = 'event' THEN
    IF p_target_id <> p_event_id THEN
      RAISE EXCEPTION 'event target_id must equal the Event id';
    END IF;
  ELSIF p_target_type = 'agenda_item' THEN
    SELECT event_id INTO v_agenda_event FROM public.agenda_items WHERE id = p_target_id;
    IF v_agenda_event IS NULL OR v_agenda_event <> p_event_id THEN
      RAISE EXCEPTION 'agenda item does not belong to this Event';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported target_type %', p_target_type;
  END IF;
END
$$;
ALTER FUNCTION public._evaluation_assert_target(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_assert_target(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._evaluation_template_json(p_template_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'name', t.name, 'description', t.description, 'is_active', t.is_active,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'question_type', q.question_type,
        'is_required', q.is_required, 'allow_comment', q.allow_comment, 'position', q.position,
        'rating_min', q.rating_min, 'rating_max', q.rating_max, 'is_active', q.is_active,
        'choices', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'position', c.position)
                           ORDER BY c.position)
          FROM public.tenant_evaluation_template_choices c
          WHERE c.question_id = q.id AND c.is_active
        ), '[]'::jsonb)
      ) ORDER BY q.position)
      FROM public.tenant_evaluation_template_questions q
      WHERE q.template_id = t.id AND q.is_active
    ), '[]'::jsonb)
  )
  FROM public.tenant_evaluation_templates t
  WHERE t.id = p_template_id;
$$;
ALTER FUNCTION public._evaluation_template_json(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_template_json(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._evaluation_assignment_form_json(p_assignment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'assignment_id', a.id,
    'target_type', a.target_type,
    'target_id', a.target_id,
    'source_template_name', a.source_template_name,
    'snapshotted_at', a.snapshotted_at,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'question_type', q.question_type,
        'is_required', q.is_required, 'allow_comment', q.allow_comment, 'position', q.position,
        'rating_min', q.rating_min, 'rating_max', q.rating_max,
        'choices', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'position', c.position)
                           ORDER BY c.position)
          FROM public.evaluation_assignment_choices c
          WHERE c.assignment_question_id = q.id
        ), '[]'::jsonb)
      ) ORDER BY q.position)
      FROM public.evaluation_assignment_questions q
      WHERE q.assignment_id = a.id
    ), '[]'::jsonb)
  )
  FROM public.evaluation_assignments a
  WHERE a.id = p_assignment_id;
$$;
ALTER FUNCTION public._evaluation_assignment_form_json(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_assignment_form_json(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Live agenda-item context for reporting (never duplicated into the eval).
CREATE OR REPLACE FUNCTION public._evaluation_target_context_json(p_target_type text, p_target_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE
    WHEN p_target_type = 'agenda_item' THEN (
      SELECT jsonb_build_object(
        'agenda_item_id', ai.id, 'title', ai.title, 'location', ai.location,
        'presenter', ai.speaker, 'category', ai.category, 'agenda_date', ai.agenda_date,
        'start_time', ai.start_time, 'end_time', ai.end_time, 'event_id', ai.event_id)
      FROM public.agenda_items ai WHERE ai.id = p_target_id)
    WHEN p_target_type = 'event' THEN (
      SELECT jsonb_build_object('event_id', e.id, 'event_name', e.name)
      FROM public.events e WHERE e.id = p_target_id)
    ELSE NULL
  END;
$$;
ALTER FUNCTION public._evaluation_target_context_json(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_target_context_json(text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The SINGLE authority for "does this response currently satisfy every
-- required question". Returns the '; '-joined prompts of required
-- assignment-snapshot questions that lack a valid answer, or NULL when
-- the response is complete. Both submit_evaluation and save_evaluation_
-- answer use it -- there is exactly one definition of a valid required
-- answer, and it is evaluated against the immutable assignment snapshot
-- (never the mutable template).
CREATE OR REPLACE FUNCTION public._evaluation_missing_required(
  p_assignment_id uuid,
  p_response_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT string_agg(q.prompt, '; ' ORDER BY q.position)
  FROM public.evaluation_assignment_questions q
  WHERE q.assignment_id = p_assignment_id
    AND q.is_required
    AND NOT EXISTS (
      SELECT 1
      FROM public.evaluation_response_answers a
      WHERE a.response_id = p_response_id
        AND a.assignment_question_id = q.id
        -- A stored answer only counts if it is well-formed. Every branch
        -- is NULL-safe -- never NOT IN, which returns UNKNOWN and would
        -- let ARRAY[NULL] / a stray non-choice / a duplicate satisfy a
        -- required question. If the CASE evaluates to NULL/UNKNOWN the row
        -- does not match, the question stays "missing", and the response
        -- cannot be is_complete (fail-closed).
        AND CASE q.question_type
          WHEN 'free_text' THEN
            a.answer_text IS NOT NULL AND btrim(a.answer_text) <> ''
          WHEN 'rating' THEN
            a.rating_value IS NOT NULL
            AND a.rating_value BETWEEN q.rating_min AND q.rating_max
          WHEN 'yes_no' THEN
            array_length(a.selected_labels, 1) = 1
            AND a.selected_labels[1] IS NOT NULL
            AND a.selected_labels[1] IN ('Yes','No')
          WHEN 'single_choice' THEN
            array_length(a.selected_labels, 1) = 1
            AND a.selected_labels[1] IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.evaluation_assignment_choices c
              WHERE c.assignment_question_id = q.id
                AND c.label = a.selected_labels[1])
          WHEN 'multi_select' THEN
            array_length(a.selected_labels, 1) >= 1
            AND NOT EXISTS (
              SELECT 1 FROM unnest(a.selected_labels) AS u(l) WHERE u.l IS NULL)
            AND (SELECT count(*) FROM unnest(a.selected_labels))
              = (SELECT count(DISTINCT u.l) FROM unnest(a.selected_labels) AS u(l))
            AND NOT EXISTS (
              SELECT 1 FROM unnest(a.selected_labels) AS u(l)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.evaluation_assignment_choices c
                WHERE c.assignment_question_id = q.id AND c.label = u.l))
          ELSE false
        END
    );
$$;
ALTER FUNCTION public._evaluation_missing_required(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._evaluation_missing_required(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- =====================================================================
-- MEMBER RPCs -- identity via resolve_temporary_or_authenticated_attendee
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_evaluation(
  p_event_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_attendee uuid;
  v_assignment_id uuid;
  v_response_id uuid;
  v_response_complete boolean;
  v_response_submitted timestamptz;
  v_has_response boolean := false;
  v_is_admin boolean := public.is_event_scoped_admin(auth.uid(), p_event_id);
  v_answers jsonb := '[]'::jsonb;
BEGIN
  IF p_target_type NOT IN ('event','agenda_item') THEN
    RAISE EXCEPTION 'unsupported target_type %', p_target_type;
  END IF;

  v_attendee := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier);
  IF v_attendee IS NULL AND NOT v_is_admin THEN
    RETURN jsonb_build_object('configured', false, 'authorized', false);
  END IF;

  PERFORM public._evaluation_assert_target(p_event_id, p_target_type, p_target_id);

  SELECT id INTO v_assignment_id FROM public.evaluation_assignments
  WHERE target_type = p_target_type AND target_id = p_target_id;
  IF v_assignment_id IS NULL THEN
    RETURN jsonb_build_object('configured', false, 'authorized', true);
  END IF;

  IF v_attendee IS NOT NULL THEN
    SELECT id, is_complete, submitted_at
      INTO v_response_id, v_response_complete, v_response_submitted
    FROM public.evaluation_responses
    WHERE assignment_id = v_assignment_id AND attendee_id = v_attendee;
    IF FOUND THEN
      v_has_response := true;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'assignment_question_id', a.assignment_question_id,
        'answer_text', a.answer_text,
        'selected_labels', to_jsonb(a.selected_labels),
        'rating_value', a.rating_value,
        'comment_text', a.comment_text)), '[]'::jsonb) INTO v_answers
      FROM public.evaluation_response_answers a
      WHERE a.response_id = v_response_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'configured', true,
    'authorized', true,
    'preview_only', (v_attendee IS NULL AND v_is_admin),
    'target_context', public._evaluation_target_context_json(p_target_type, p_target_id),
    'form', public._evaluation_assignment_form_json(v_assignment_id),
    'response', CASE WHEN NOT v_has_response THEN NULL ELSE jsonb_build_object(
      'id', v_response_id, 'is_complete', v_response_complete,
      'submitted_at', v_response_submitted, 'answers', v_answers) END
  );
END
$$;
ALTER FUNCTION public.get_evaluation(uuid, text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_evaluation(uuid, text, uuid, text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_evaluation(uuid, text, uuid, text, text) TO anon, authenticated;

-- Which agenda items in this Event have an evaluation the member can open.
CREATE OR REPLACE FUNCTION public.list_member_agenda_evaluations(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_attendee uuid;
BEGIN
  v_attendee := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier);
  IF v_attendee IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'agenda_item_id', a.target_id,
      'title', ai.title,
      'presenter', ai.speaker,
      'has_response', r.id IS NOT NULL,
      'is_complete', COALESCE(r.is_complete, false)
    ) ORDER BY ai.agenda_date NULLS LAST, ai.start_time, ai.title)
    FROM public.evaluation_assignments a
    JOIN public.agenda_items ai ON ai.id = a.target_id AND ai.event_id = p_event_id
    LEFT JOIN public.evaluation_responses r
      ON r.assignment_id = a.id AND r.attendee_id = v_attendee
    WHERE a.event_id = p_event_id AND a.target_type = 'agenda_item'
  ), '[]'::jsonb);
END
$$;
ALTER FUNCTION public.list_member_agenda_evaluations(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_member_agenda_evaluations(uuid, text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.list_member_agenda_evaluations(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_evaluation_answer(
  p_event_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_event_code text,
  p_registration_identifier text,
  p_assignment_question_id uuid,
  p_answer_text text DEFAULT NULL,
  p_selected_labels text[] DEFAULT NULL,
  p_rating_value integer DEFAULT NULL,
  p_comment_text text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_attendee uuid;
  v_assignment_id uuid;
  v_q record;
  v_response_id uuid;
  v_was_complete boolean := false;
  v_missing text;
  v_now_complete boolean;
  v_downgraded boolean := false;
  v_labels text[] := COALESCE(p_selected_labels, '{}');
  v_bad text;
BEGIN
  IF p_target_type NOT IN ('event','agenda_item') THEN
    RAISE EXCEPTION 'unsupported target_type %', p_target_type;
  END IF;

  v_attendee := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier);
  IF v_attendee IS NULL THEN
    RAISE EXCEPTION 'not an authorized attendee for this event';
  END IF;

  PERFORM public._evaluation_assert_target(p_event_id, p_target_type, p_target_id);

  SELECT id INTO v_assignment_id FROM public.evaluation_assignments
  WHERE target_type = p_target_type AND target_id = p_target_id;
  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'this target has no evaluation assigned';
  END IF;

  SELECT * INTO v_q FROM public.evaluation_assignment_questions
  WHERE id = p_assignment_question_id AND assignment_id = v_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'question does not belong to this evaluation';
  END IF;

  IF v_q.question_type IN ('single_choice','multi_select','yes_no') THEN
    -- Malformed-array hardening (write-time). NULL-safe throughout: never
    -- rely on NOT IN, which evaluates UNKNOWN and lets NULL / bad labels
    -- slip past. An empty array is "no selection" (a valid clear), not
    -- malformed -- these guards only fire on arrays that carry content.
    IF EXISTS (SELECT 1 FROM unnest(v_labels) AS u(l) WHERE u.l IS NULL) THEN
      RAISE EXCEPTION 'selected_labels must not contain a NULL element';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_labels) AS u(l) WHERE btrim(u.l) = '') THEN
      RAISE EXCEPTION 'selected_labels must not contain a blank element';
    END IF;
    IF (SELECT count(*) FROM unnest(v_labels)) <>
       (SELECT count(DISTINCT u.l) FROM unnest(v_labels) AS u(l)) THEN
      RAISE EXCEPTION 'selected_labels must not contain duplicate values';
    END IF;

    IF v_q.question_type = 'single_choice' AND array_length(v_labels, 1) > 1 THEN
      RAISE EXCEPTION 'single_choice accepts at most one selection';
    END IF;
    IF v_q.question_type = 'yes_no' THEN
      IF array_length(v_labels, 1) > 1 THEN
        RAISE EXCEPTION 'yes_no accepts at most one selection';
      END IF;
      IF array_length(v_labels, 1) = 1 AND v_labels[1] NOT IN ('Yes','No') THEN
        RAISE EXCEPTION 'yes_no accepts only Yes or No';
      END IF;
    END IF;
    IF v_q.question_type IN ('single_choice','multi_select') THEN
      -- NULL-safe unknown-choice check: NOT EXISTS with an explicit
      -- label equality against the frozen assignment choices.
      SELECT string_agg(u.l, ', ') INTO v_bad
      FROM unnest(v_labels) AS u(l)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.evaluation_assignment_choices c
        WHERE c.assignment_question_id = v_q.id AND c.label = u.l
      );
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'unknown choice(s): %', v_bad;
      END IF;
    END IF;
    p_answer_text := NULL; p_rating_value := NULL;
  ELSIF v_q.question_type = 'rating' THEN
    IF p_rating_value IS NOT NULL AND (p_rating_value < v_q.rating_min OR p_rating_value > v_q.rating_max) THEN
      RAISE EXCEPTION 'rating out of range %..%', v_q.rating_min, v_q.rating_max;
    END IF;
    v_labels := '{}'; p_answer_text := NULL;
  ELSE
    v_labels := '{}'; p_rating_value := NULL;
  END IF;

  IF p_comment_text IS NOT NULL AND btrim(p_comment_text) <> '' AND NOT v_q.allow_comment THEN
    RAISE EXCEPTION 'this question does not accept a comment';
  END IF;

  INSERT INTO public.evaluation_responses
    (assignment_id, target_type, target_id, event_id, attendee_id)
  VALUES (v_assignment_id, p_target_type, p_target_id, p_event_id, v_attendee)
  ON CONFLICT (assignment_id, attendee_id) DO UPDATE SET updated_at = now()
  RETURNING id, is_complete INTO v_response_id, v_was_complete;

  INSERT INTO public.evaluation_response_answers
    (response_id, assignment_question_id, answer_text, selected_labels, rating_value, comment_text)
  VALUES (v_response_id, v_q.id, NULLIF(btrim(COALESCE(p_answer_text,'')),''), v_labels, p_rating_value,
          NULLIF(btrim(COALESCE(p_comment_text,'')),''))
  ON CONFLICT (response_id, assignment_question_id) DO UPDATE SET
    answer_text = EXCLUDED.answer_text,
    selected_labels = EXCLUDED.selected_labels,
    rating_value = EXCLUDED.rating_value,
    comment_text = EXCLUDED.comment_text,
    updated_at = now();

  -- Completion invariant (server-authoritative): a response is is_complete
  -- ONLY while every required snapshot question still has a valid answer.
  -- An edit that breaks that immediately downgrades the response so it
  -- leaves admin reporting at once. submitted_at is preserved as the
  -- first-submission stamp. Autosave NEVER re-completes a response -- only
  -- submit_evaluation can set is_complete back to true.
  v_missing := public._evaluation_missing_required(v_assignment_id, v_response_id);
  IF v_was_complete AND v_missing IS NOT NULL THEN
    UPDATE public.evaluation_responses
    SET is_complete = false, updated_at = now()
    WHERE id = v_response_id;
    v_downgraded := true;
  END IF;
  v_now_complete := v_was_complete AND NOT v_downgraded;

  RETURN jsonb_build_object(
    'ok', true,
    'response_id', v_response_id,
    'is_complete', v_now_complete,
    'downgraded', v_downgraded,
    'missing_required', v_missing
  );
END
$$;
ALTER FUNCTION public.save_evaluation_answer(uuid, text, uuid, text, text, uuid, text, text[], integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_evaluation_answer(uuid, text, uuid, text, text, uuid, text, text[], integer, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.save_evaluation_answer(uuid, text, uuid, text, text, uuid, text, text[], integer, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_evaluation(
  p_event_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_attendee uuid;
  v_assignment_id uuid;
  v_response_id uuid;
  v_was_complete boolean;
  v_missing text;
BEGIN
  v_attendee := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier);
  IF v_attendee IS NULL THEN
    RAISE EXCEPTION 'not an authorized attendee for this event';
  END IF;

  SELECT id INTO v_assignment_id FROM public.evaluation_assignments
  WHERE target_type = p_target_type AND target_id = p_target_id AND event_id = p_event_id;
  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'this target has no evaluation assigned';
  END IF;

  SELECT id, is_complete INTO v_response_id, v_was_complete
  FROM public.evaluation_responses
  WHERE assignment_id = v_assignment_id AND attendee_id = v_attendee;
  IF v_response_id IS NULL THEN
    RAISE EXCEPTION 'no evaluation in progress';
  END IF;

  -- Same single completeness rule as save_evaluation_answer.
  v_missing := public._evaluation_missing_required(v_assignment_id, v_response_id);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'required question(s) unanswered: %', v_missing;
  END IF;

  -- Update semantics: a member may revise and re-submit. The original
  -- submitted_at is preserved; the assignment snapshot is untouched.
  UPDATE public.evaluation_responses
  SET is_complete = true, submitted_at = COALESCE(submitted_at, now()), updated_at = now()
  WHERE id = v_response_id;

  RETURN jsonb_build_object('ok', true, 'updated', v_was_complete);
END
$$;
ALTER FUNCTION public.submit_evaluation(uuid, text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_evaluation(uuid, text, uuid, text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.submit_evaluation(uuid, text, uuid, text, text) TO anon, authenticated;

-- =====================================================================
-- ADMIN REPORT RPCs -- gate: event.reports.view
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_event_evaluation_assignments(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NOT public.has_event_task_authority('event.reports.view', p_event_id) THEN
    RAISE EXCEPTION 'caller lacks Event report authority';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'assignment_id', a.id,
      'target_type', a.target_type,
      'target_id', a.target_id,
      'source_template_name', a.source_template_name,
      'target_context', public._evaluation_target_context_json(a.target_type, a.target_id),
      'started', (SELECT count(*) FROM public.evaluation_responses r WHERE r.assignment_id = a.id),
      'completed', (SELECT count(*) FROM public.evaluation_responses r WHERE r.assignment_id = a.id AND r.is_complete)
    ) ORDER BY (a.target_type <> 'event'), a.snapshotted_at)
    FROM public.evaluation_assignments a
    WHERE a.event_id = p_event_id
  ), '[]'::jsonb);
END
$$;
ALTER FUNCTION public.list_event_evaluation_assignments(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_event_evaluation_assignments(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_evaluation_assignments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_evaluation_report(
  p_event_id uuid,
  p_target_type text,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_assignment_id uuid;
  v_started integer := 0;
  v_completed integer := 0;
  v_last timestamptz;
  v_questions jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_event_task_authority('event.reports.view', p_event_id) THEN
    RAISE EXCEPTION 'caller lacks Event report authority';
  END IF;

  SELECT id INTO v_assignment_id FROM public.evaluation_assignments
  WHERE target_type = p_target_type AND target_id = p_target_id AND event_id = p_event_id;
  IF v_assignment_id IS NULL THEN
    RETURN jsonb_build_object('configured', false,
      'target_context', public._evaluation_target_context_json(p_target_type, p_target_id));
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_complete), max(submitted_at)
    INTO v_started, v_completed, v_last
  FROM public.evaluation_responses WHERE assignment_id = v_assignment_id;

  -- POLICY: admin reporting counts ONLY submitted (is_complete) responses.
  -- Autosaved drafts are private member work-in-progress. Every aggregate
  -- below joins through evaluation_responses r WHERE r.is_complete, so an
  -- unsubmitted answer contributes to nothing an admin sees.
  SELECT COALESCE(jsonb_agg(qrow ORDER BY (qrow->>'position')::int), '[]'::jsonb) INTO v_questions
  FROM (
    SELECT jsonb_build_object(
      'assignment_question_id', q.id,
      'prompt', q.prompt,
      'question_type', q.question_type,
      'position', q.position,
      'allow_comment', q.allow_comment,
      'answered_count', (
        SELECT count(*)
        FROM public.evaluation_response_answers a
        JOIN public.evaluation_responses r ON r.id = a.response_id AND r.is_complete
        WHERE a.assignment_question_id = q.id
          AND ((a.answer_text IS NOT NULL AND btrim(a.answer_text) <> '')
               OR array_length(a.selected_labels,1) >= 1
               OR a.rating_value IS NOT NULL)),
      'choice_breakdown', CASE WHEN q.question_type IN ('single_choice','multi_select','yes_no') THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('label', lbl, 'count', cnt) ORDER BY ord, lbl), '[]'::jsonb)
        FROM (
          SELECT l.lbl, count(*) AS cnt, COALESCE(min(fc.position), 999999) AS ord
          FROM public.evaluation_response_answers a
          JOIN public.evaluation_responses r ON r.id = a.response_id AND r.is_complete
          CROSS JOIN LATERAL unnest(a.selected_labels) AS l(lbl)
          LEFT JOIN public.evaluation_assignment_choices fc
                 ON fc.assignment_question_id = q.id AND fc.label = l.lbl
          WHERE a.assignment_question_id = q.id
          GROUP BY l.lbl
        ) g
      ) ELSE NULL END,
      'rating_summary', CASE WHEN q.question_type = 'rating' THEN (
        SELECT jsonb_build_object(
          'average', round(avg(a.rating_value)::numeric, 2),
          'count', count(a.rating_value),
          'histogram', COALESCE((
            SELECT jsonb_object_agg(rv::text, c) FROM (
              SELECT a2.rating_value AS rv, count(*) AS c
              FROM public.evaluation_response_answers a2
              JOIN public.evaluation_responses r2 ON r2.id = a2.response_id AND r2.is_complete
              WHERE a2.assignment_question_id = q.id AND a2.rating_value IS NOT NULL
              GROUP BY a2.rating_value
            ) h), '{}'::jsonb))
        FROM public.evaluation_response_answers a
        JOIN public.evaluation_responses r ON r.id = a.response_id AND r.is_complete
        WHERE a.assignment_question_id = q.id AND a.rating_value IS NOT NULL
      ) ELSE NULL END,
      'free_text', CASE WHEN q.question_type = 'free_text' THEN (
        SELECT COALESCE(jsonb_agg(a.answer_text ORDER BY a.updated_at DESC), '[]'::jsonb)
        FROM public.evaluation_response_answers a
        JOIN public.evaluation_responses r ON r.id = a.response_id AND r.is_complete
        WHERE a.assignment_question_id = q.id AND a.answer_text IS NOT NULL AND btrim(a.answer_text) <> ''
      ) ELSE NULL END,
      'comments', CASE WHEN q.allow_comment THEN (
        SELECT COALESCE(jsonb_agg(a.comment_text ORDER BY a.updated_at DESC), '[]'::jsonb)
        FROM public.evaluation_response_answers a
        JOIN public.evaluation_responses r ON r.id = a.response_id AND r.is_complete
        WHERE a.assignment_question_id = q.id AND a.comment_text IS NOT NULL AND btrim(a.comment_text) <> ''
      ) ELSE '[]'::jsonb END
    ) AS qrow
    FROM public.evaluation_assignment_questions q
    WHERE q.assignment_id = v_assignment_id
  ) s;

  RETURN jsonb_build_object(
    'configured', true,
    'target_type', p_target_type,
    'target_id', p_target_id,
    'target_context', public._evaluation_target_context_json(p_target_type, p_target_id),
    'source_template_name', (SELECT source_template_name FROM public.evaluation_assignments WHERE id = v_assignment_id),
    'started', v_started,
    'completed', v_completed,
    'respondents', v_completed,
    'last_submission', v_last,
    'questions', v_questions
  );
END
$$;
ALTER FUNCTION public.get_evaluation_report(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_evaluation_report(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_evaluation_report(uuid, text, uuid) TO authenticated;

-- =====================================================================
-- ADMIN CONFIG RPCs -- gate: tenant.evaluations.manage
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_event_evaluation_config(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public._evaluation_assert_config_authority(p_event_id);

  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'templates', COALESCE((
      SELECT jsonb_agg(public._evaluation_template_json(t.id) ORDER BY t.created_at)
      FROM public.tenant_evaluation_templates t WHERE t.tenant_id = v_tenant
    ), '[]'::jsonb),
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'assignment_id', a.id, 'target_type', a.target_type, 'target_id', a.target_id,
        'source_template_id', a.source_template_id, 'source_template_name', a.source_template_name,
        'target_context', public._evaluation_target_context_json(a.target_type, a.target_id),
        'frozen', EXISTS (SELECT 1 FROM public.evaluation_responses r WHERE r.assignment_id = a.id),
        'response_count', (SELECT count(*) FROM public.evaluation_responses r WHERE r.assignment_id = a.id))
        ORDER BY (a.target_type <> 'event'), a.snapshotted_at)
      FROM public.evaluation_assignments a WHERE a.event_id = p_event_id
    ), '[]'::jsonb),
    'agenda_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ai.id, 'title', ai.title, 'presenter', ai.speaker,
        'agenda_date', ai.agenda_date, 'start_time', ai.start_time)
        ORDER BY ai.agenda_date NULLS LAST, ai.start_time, ai.title)
      FROM public.agenda_items ai WHERE ai.event_id = p_event_id
    ), '[]'::jsonb)
  );
END
$$;
ALTER FUNCTION public.list_event_evaluation_config(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_event_evaluation_config(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_evaluation_config(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_evaluation_template(
  p_event_id uuid,
  p_name text DEFAULT NULL,
  p_seed_default boolean DEFAULT true,
  p_seed_kind text DEFAULT 'event'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_template_id uuid;
  v_def jsonb;
  v_q jsonb;
  v_qid uuid;
  v_pos integer := 0;
  v_cpos integer;
  v_choice text;
BEGIN
  SELECT tenant_id, actor_admin_user_id INTO v_tenant, v_actor
  FROM public._evaluation_assert_config_authority(p_event_id);

  v_def := CASE WHEN p_seed_kind = 'presentation'
                THEN public._evaluation_default_presentation_definition()
                ELSE public._evaluation_default_template_definition() END;

  INSERT INTO public.tenant_evaluation_templates (tenant_id, name, description, created_by_admin_user_id)
  VALUES (
    v_tenant,
    COALESCE(NULLIF(btrim(COALESCE(p_name,'')), ''), v_def->>'name'),
    CASE WHEN p_seed_default THEN v_def->>'description' ELSE NULL END,
    v_actor
  )
  RETURNING id INTO v_template_id;

  IF p_seed_default THEN
    FOR v_q IN SELECT value FROM jsonb_array_elements(v_def->'questions') LOOP
      INSERT INTO public.tenant_evaluation_template_questions
        (template_id, prompt, question_type, is_required, allow_comment, position)
      VALUES (v_template_id, v_q->>'prompt', v_q->>'question_type',
              (v_q->>'is_required')::boolean, (v_q->>'allow_comment')::boolean, v_pos)
      RETURNING id INTO v_qid;
      v_pos := v_pos + 1;
      v_cpos := 0;
      FOR v_choice IN SELECT value FROM jsonb_array_elements_text(v_q->'choices') LOOP
        INSERT INTO public.tenant_evaluation_template_choices (question_id, label, position)
        VALUES (v_qid, v_choice, v_cpos);
        v_cpos := v_cpos + 1;
      END LOOP;
    END LOOP;
  END IF;

  RETURN v_template_id;
END
$$;
ALTER FUNCTION public.create_evaluation_template(uuid, text, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_evaluation_template(uuid, text, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_evaluation_template(uuid, text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_evaluation_template(
  p_event_id uuid,
  p_template_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  PERFORM public._evaluation_assert_template_in_tenant(p_event_id, p_template_id);
  UPDATE public.tenant_evaluation_templates
  SET name = COALESCE(NULLIF(btrim(COALESCE(p_name,'')), ''), name),
      description = COALESCE(p_description, description),
      is_active = COALESCE(p_is_active, is_active)
  WHERE id = p_template_id;
END
$$;
ALTER FUNCTION public.update_evaluation_template(uuid, uuid, text, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_evaluation_template(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_evaluation_template(uuid, uuid, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_evaluation_template_question(
  p_event_id uuid,
  p_template_id uuid,
  p_question_id uuid,
  p_prompt text,
  p_question_type text,
  p_is_required boolean,
  p_allow_comment boolean,
  p_rating_min integer DEFAULT 1,
  p_rating_max integer DEFAULT 5,
  p_choice_labels text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_qid uuid := p_question_id;
  v_pos integer;
  v_label text;
  v_cpos integer := 0;
  v_labels text[] := COALESCE(p_choice_labels, '{}');
BEGIN
  PERFORM public._evaluation_assert_template_in_tenant(p_event_id, p_template_id);

  IF p_question_type NOT IN ('single_choice','multi_select','yes_no','rating','free_text') THEN
    RAISE EXCEPTION 'invalid question_type %', p_question_type;
  END IF;

  IF v_qid IS NULL THEN
    SELECT COALESCE(max(position) + 1, 0) INTO v_pos
    FROM public.tenant_evaluation_template_questions WHERE template_id = p_template_id;
    INSERT INTO public.tenant_evaluation_template_questions
      (template_id, prompt, question_type, is_required, allow_comment, position, rating_min, rating_max)
    VALUES (p_template_id, p_prompt, p_question_type, p_is_required, p_allow_comment, v_pos,
            p_rating_min, p_rating_max)
    RETURNING id INTO v_qid;
  ELSE
    UPDATE public.tenant_evaluation_template_questions
    SET prompt = p_prompt, question_type = p_question_type, is_required = p_is_required,
        allow_comment = p_allow_comment, rating_min = p_rating_min, rating_max = p_rating_max
    WHERE id = v_qid AND template_id = p_template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'question not found in template';
    END IF;
  END IF;

  IF p_question_type IN ('single_choice','multi_select') THEN
    DELETE FROM public.tenant_evaluation_template_choices WHERE question_id = v_qid;
    FOREACH v_label IN ARRAY v_labels LOOP
      IF btrim(v_label) <> '' THEN
        INSERT INTO public.tenant_evaluation_template_choices (question_id, label, position)
        VALUES (v_qid, btrim(v_label), v_cpos);
        v_cpos := v_cpos + 1;
      END IF;
    END LOOP;
    IF v_cpos = 0 THEN
      RAISE EXCEPTION 'choice-based questions need at least one choice';
    END IF;
  ELSE
    DELETE FROM public.tenant_evaluation_template_choices WHERE question_id = v_qid;
  END IF;

  RETURN v_qid;
END
$$;
ALTER FUNCTION public.upsert_evaluation_template_question(uuid, uuid, uuid, text, text, boolean, boolean, integer, integer, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.upsert_evaluation_template_question(uuid, uuid, uuid, text, text, boolean, boolean, integer, integer, text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_evaluation_template_question(uuid, uuid, uuid, text, text, boolean, boolean, integer, integer, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_evaluation_template_question(
  p_event_id uuid,
  p_question_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_template uuid;
BEGIN
  SELECT template_id INTO v_template
  FROM public.tenant_evaluation_template_questions WHERE id = p_question_id;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'question not found';
  END IF;
  PERFORM public._evaluation_assert_template_in_tenant(p_event_id, v_template);

  DELETE FROM public.tenant_evaluation_template_questions WHERE id = p_question_id;

  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY position) - 1 AS new_pos
    FROM public.tenant_evaluation_template_questions WHERE template_id = v_template
  )
  UPDATE public.tenant_evaluation_template_questions q
  SET position = o.new_pos
  FROM ordered o WHERE o.id = q.id AND q.position <> o.new_pos;
END
$$;
ALTER FUNCTION public.delete_evaluation_template_question(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_evaluation_template_question(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_evaluation_template_question(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reorder_evaluation_template_questions(
  p_event_id uuid,
  p_template_id uuid,
  p_ordered_question_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_total integer;
  v_supplied integer := COALESCE(array_length(p_ordered_question_ids, 1), 0);
  v_distinct integer;
BEGIN
  PERFORM public._evaluation_assert_template_in_tenant(p_event_id, p_template_id);

  SELECT count(*) INTO v_total
  FROM public.tenant_evaluation_template_questions WHERE template_id = p_template_id;

  SELECT count(DISTINCT x) INTO v_distinct FROM unnest(p_ordered_question_ids) x;

  -- The submitted array must be an exact permutation of the template's
  -- questions: no duplicates, none missing, none extra, none foreign.
  IF v_distinct <> v_supplied THEN
    RAISE EXCEPTION 'reorder list contains a duplicate question id';
  END IF;
  IF v_supplied <> v_total THEN
    RAISE EXCEPTION 'reorder list must contain every question exactly once (expected %, got %)',
      v_total, v_supplied;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_ordered_question_ids) x
    LEFT JOIN public.tenant_evaluation_template_questions q
      ON q.id = x AND q.template_id = p_template_id
    WHERE q.id IS NULL
  ) THEN
    RAISE EXCEPTION 'reorder list contains a question not in this template';
  END IF;

  UPDATE public.tenant_evaluation_template_questions q
  SET position = o.ord - 1
  FROM (SELECT x AS id, ord
        FROM unnest(p_ordered_question_ids) WITH ORDINALITY t(x, ord)) o
  WHERE o.id = q.id;
END
$$;
ALTER FUNCTION public.reorder_evaluation_template_questions(uuid, uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reorder_evaluation_template_questions(uuid, uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_evaluation_template_questions(uuid, uuid, uuid[]) TO authenticated;

-- Assign / re-snapshot / unassign a template for a governed target.
CREATE OR REPLACE FUNCTION public.assign_evaluation(
  p_event_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_template_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_assignment_id uuid;
  v_tpl record;
  v_q record;
  v_new_qid uuid;
BEGIN
  SELECT tenant_id, actor_admin_user_id INTO v_tenant, v_actor
  FROM public._evaluation_assert_config_authority(p_event_id);
  PERFORM public._evaluation_assert_target(p_event_id, p_target_type, p_target_id);

  SELECT id INTO v_assignment_id FROM public.evaluation_assignments
  WHERE target_type = p_target_type AND target_id = p_target_id;

  IF v_assignment_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.evaluation_responses WHERE assignment_id = v_assignment_id) THEN
      RAISE EXCEPTION 'evaluation_assignment_frozen: responses already exist for this target';
    END IF;
    DELETE FROM public.evaluation_assignments WHERE id = v_assignment_id; -- cascades questions/choices
    v_assignment_id := NULL;
  END IF;

  IF p_template_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'assigned', false);
  END IF;

  PERFORM public._evaluation_assert_template_in_tenant(p_event_id, p_template_id);
  SELECT * INTO v_tpl FROM public.tenant_evaluation_templates WHERE id = p_template_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_evaluation_template_questions
    WHERE template_id = p_template_id AND is_active
  ) THEN
    RAISE EXCEPTION 'template has no active questions to publish';
  END IF;

  INSERT INTO public.evaluation_assignments
    (tenant_id, event_id, target_type, target_id, source_template_id, source_template_name,
     snapshotted_by_admin_user_id)
  VALUES (v_tenant, p_event_id, p_target_type, p_target_id, p_template_id, v_tpl.name, v_actor)
  RETURNING id INTO v_assignment_id;

  FOR v_q IN
    SELECT * FROM public.tenant_evaluation_template_questions
    WHERE template_id = p_template_id AND is_active ORDER BY position
  LOOP
    INSERT INTO public.evaluation_assignment_questions
      (assignment_id, prompt, question_type, is_required, allow_comment, position, rating_min, rating_max)
    VALUES (v_assignment_id, v_q.prompt, v_q.question_type, v_q.is_required, v_q.allow_comment,
            v_q.position, v_q.rating_min, v_q.rating_max)
    RETURNING id INTO v_new_qid;

    INSERT INTO public.evaluation_assignment_choices (assignment_question_id, label, position)
    SELECT v_new_qid, c.label, c.position
    FROM public.tenant_evaluation_template_choices c
    WHERE c.question_id = v_q.id AND c.is_active
    ORDER BY c.position;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'assigned', true, 'assignment_id', v_assignment_id);
END
$$;
ALTER FUNCTION public.assign_evaluation(uuid, text, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_evaluation(uuid, text, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assign_evaluation(uuid, text, uuid, uuid) TO authenticated;

COMMIT;
