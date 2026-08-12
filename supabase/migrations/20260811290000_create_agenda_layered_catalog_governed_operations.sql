-- Governed responsibility/operation layer on top of the Agenda layered
-- catalog foundation (20260811280000). Additive only: does not touch the
-- legacy agenda_templates/agenda_template_items/agenda_template_sets/
-- agenda_template_categories tables, their is_current_admin() policies,
-- events.assigned_agenda_template_id, existing agenda_items content, or
-- the current Agenda admin UI. This migration only adds new columns to
-- the (currently empty) foundation tables, two new tables, and a set of
-- SECURITY DEFINER RPCs; the legacy UI keeps working unmodified until a
-- separate future cutover CMD.
BEGIN;

-- ============================================================
-- Stage 2: canonical task registry additions
-- ============================================================

INSERT INTO public.admin_task_registry
  (task_key, scope, task_kind, description, platform_inherits, tenant_inherits, event_assignment_grantable, is_active)
VALUES
  ('platform.agenda_templates.manage', 'platform', 'mutation',
   'Manage Platform-owned reusable Agenda templates.', true, false, false, true),
  ('tenant.agenda_templates.manage', 'tenant', 'mutation',
   'Manage Tenant-owned reusable Agenda templates.', true, true, false, true);

-- ============================================================
-- Stage 4: Event agenda version / concurrency foundation
-- ============================================================

CREATE TABLE public.event_agenda_state (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.event_agenda_state (event_id, version)
SELECT e.id, 0 FROM public.events AS e
ON CONFLICT (event_id) DO NOTHING;

ALTER TABLE public.event_agenda_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_agenda_state FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Stage 5: immutable Agenda command ledger
-- ============================================================

CREATE TABLE public.agenda_command_ledger (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN (
    'root_created', 'revision_created', 'revision_published', 'revision_superseded',
    'root_archived', 'template_duplicated', 'template_promoted',
    'event_agenda_saved_as_template', 'template_applied', 'agenda_replaced',
    'revision_content_edited'
  )),
  actor_auth_user_id uuid NOT NULL,
  resolved_authority_branch text NOT NULL CHECK (resolved_authority_branch IN ('platform', 'tenant', 'event', 'compound')),
  task_key text REFERENCES public.admin_task_registry(task_key),
  tenant_id uuid REFERENCES public.tenants(id),
  event_id uuid REFERENCES public.events(id),
  template_root_id uuid REFERENCES public.agenda_template_roots(id),
  revision_id uuid REFERENCES public.agenda_template_revisions(id),
  application_id uuid REFERENCES public.agenda_template_applications(id),
  idempotency_key uuid,
  request_fingerprint text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  before_state jsonb,
  after_state jsonb,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'failed')),
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agenda_command_ledger_actor_action_idempotency_idx
  ON public.agenda_command_ledger (actor_auth_user_id, action, idempotency_key);

CREATE OR REPLACE FUNCTION public._agenda_command_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'agenda command ledger entries are immutable';
  RETURN NULL;
END;
$$;

CREATE TRIGGER agenda_command_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.agenda_command_ledger
  FOR EACH ROW EXECUTE FUNCTION public._agenda_command_ledger_immutable();

ALTER TABLE public.agenda_command_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_command_ledger FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._agenda_command_ledger_immutable() FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Stage 13: draft optimistic concurrency + Stage 12/16 idempotency plumbing
-- ============================================================

ALTER TABLE public.agenda_template_revisions
  ADD COLUMN draft_version integer NOT NULL DEFAULT 0;

ALTER TABLE public.agenda_template_applications
  ADD COLUMN request_fingerprint text;

-- ============================================================
-- Internal helper: shared ledger writer (Stage 5)
-- ============================================================

CREATE OR REPLACE FUNCTION public._agenda_ledger_log(
  p_action text, p_actor uuid, p_branch text, p_task_key text,
  p_tenant_id uuid, p_event_id uuid, p_template_root_id uuid, p_revision_id uuid,
  p_application_id uuid, p_idempotency_key uuid, p_request_fingerprint text,
  p_correlation_id uuid, p_before_state jsonb, p_after_state jsonb, p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_command_id uuid;
BEGIN
  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, tenant_id, event_id,
    template_root_id, revision_id, application_id, idempotency_key, request_fingerprint,
    correlation_id, before_state, after_state, outcome, reason
  ) VALUES (
    p_action, p_actor, p_branch, p_task_key, p_tenant_id, p_event_id,
    p_template_root_id, p_revision_id, p_application_id, p_idempotency_key, p_request_fingerprint,
    p_correlation_id, p_before_state, p_after_state, 'success', p_reason
  ) RETURNING command_id INTO v_command_id;
  RETURN v_command_id;
END;
$$;

REVOKE ALL ON FUNCTION public._agenda_ledger_log(
  text, uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Stage 3: scope-native catalog authority resolvers
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_platform_agenda_template_authority()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_task_registry AS r
    WHERE r.task_key = 'platform.agenda_templates.manage' AND r.is_active
  ) THEN
    RETURN false;
  END IF;

  RETURN public.has_platform_admin_authority(v_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_agenda_template_authority(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_task_registry AS r
    WHERE r.task_key = 'tenant.agenda_templates.manage' AND r.is_active
  ) THEN
    RETURN false;
  END IF;

  RETURN public.has_tenant_admin_authority(v_actor, p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.has_platform_agenda_template_authority() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_platform_agenda_template_authority() TO authenticated;
REVOKE ALL ON FUNCTION public.has_tenant_agenda_template_authority(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_tenant_agenda_template_authority(uuid) TO authenticated;

-- ============================================================
-- Internal helper: authorize + lock + version-check a draft revision
-- Stage 13. Bumps draft_version and returns root context.
-- ============================================================

CREATE OR REPLACE FUNCTION public._agenda_authorize_draft_mutation(
  p_revision_id uuid, p_expected_draft_version integer
)
RETURNS TABLE(template_root_id uuid, scope text, tenant_id uuid, new_draft_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_revision public.agenda_template_revisions%ROWTYPE;
  v_root public.agenda_template_roots%ROWTYPE;
BEGIN
  SELECT rev.* INTO v_revision
  FROM public.agenda_template_revisions AS rev
  WHERE rev.id = p_revision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision not found';
  END IF;

  IF v_revision.revision_status <> 'draft' THEN
    RAISE EXCEPTION 'revision is not draft';
  END IF;

  IF v_revision.draft_version <> p_expected_draft_version THEN
    RAISE EXCEPTION 'stale_draft_version';
  END IF;

  SELECT r.* INTO v_root FROM public.agenda_template_roots AS r WHERE r.id = v_revision.template_root_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template root not found';
  END IF;

  IF v_root.scope = 'platform' THEN
    IF NOT public.has_platform_agenda_template_authority() THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  ELSE
    IF NOT public.has_tenant_agenda_template_authority(v_root.tenant_id) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  UPDATE public.agenda_template_revisions AS rev
  SET draft_version = rev.draft_version + 1
  WHERE rev.id = p_revision_id;

  RETURN QUERY SELECT v_root.id, v_root.scope, v_root.tenant_id, v_revision.draft_version + 1;
END;
$$;

REVOKE ALL ON FUNCTION public._agenda_authorize_draft_mutation(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Stage 7: root/revision authoring RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_agenda_template_root(
  p_scope text, p_tenant_id uuid, p_title text, p_description text,
  p_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_root_id uuid;
  v_fingerprint text;
  v_prior record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_scope NOT IN ('platform', 'tenant') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  IF p_scope = 'platform' THEN
    IF p_tenant_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_scope';
    END IF;
    IF NOT public.has_platform_agenda_template_authority() THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  ELSE
    IF p_tenant_id IS NULL THEN
      RAISE EXCEPTION 'invalid_scope';
    END IF;
    IF NOT public.has_tenant_agenda_template_authority(p_tenant_id) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  v_fingerprint := md5(coalesce(p_scope, '') || '|' || coalesce(p_tenant_id::text, '') || '|' || coalesce(p_title, '') || '|' || coalesce(p_description, ''));

  SELECT l.template_root_id, l.request_fingerprint INTO v_prior
  FROM public.agenda_command_ledger AS l
  WHERE l.action = 'root_created' AND l.actor_auth_user_id = v_actor AND l.idempotency_key = p_idempotency_key
  ORDER BY l.occurred_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_prior.request_fingerprint = v_fingerprint THEN
      RETURN v_prior.template_root_id;
    ELSE
      RAISE EXCEPTION 'duplicate_idempotency_key_conflict';
    END IF;
  END IF;

  INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, created_by_auth_user_id)
  VALUES (p_scope, p_tenant_id, p_title, p_description, v_actor)
  RETURNING id INTO v_root_id;

  PERFORM public._agenda_ledger_log(
    'root_created', v_actor, p_scope, CASE WHEN p_scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    p_tenant_id, NULL, v_root_id, NULL, NULL, p_idempotency_key, v_fingerprint,
    gen_random_uuid(), NULL, jsonb_build_object('title', p_title, 'scope', p_scope), NULL
  );

  RETURN v_root_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_agenda_template_revision(p_template_root_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.agenda_template_roots%ROWTYPE;
  v_next integer;
  v_revision_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT r.* INTO v_root FROM public.agenda_template_roots AS r WHERE r.id = p_template_root_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template root not found';
  END IF;

  IF v_root.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'archived_template';
  END IF;

  IF v_root.scope = 'platform' THEN
    IF NOT public.has_platform_agenda_template_authority() THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  ELSE
    IF NOT public.has_tenant_agenda_template_authority(v_root.tenant_id) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_template_root_id::text));

  SELECT coalesce(max(rev.revision_number), 0) + 1 INTO v_next
  FROM public.agenda_template_revisions AS rev
  WHERE rev.template_root_id = p_template_root_id;

  INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
  VALUES (p_template_root_id, v_next, 'draft', v_actor)
  RETURNING id INTO v_revision_id;

  PERFORM public._agenda_ledger_log(
    'revision_created', v_actor, v_root.scope,
    CASE WHEN v_root.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_root.tenant_id, NULL, p_template_root_id, v_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('revision_number', v_next), NULL
  );

  RETURN v_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_agenda_template_revision_section(
  p_revision_id uuid, p_expected_draft_version integer, p_title text, p_description text, p_sort_order integer
)
RETURNS TABLE(new_id uuid, new_draft_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ctx record;
  v_section_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_ctx FROM public._agenda_authorize_draft_mutation(p_revision_id, p_expected_draft_version);

  INSERT INTO public.agenda_template_revision_sections(revision_id, title, description, sort_order, created_by_auth_user_id)
  VALUES (p_revision_id, p_title, p_description, p_sort_order, v_actor)
  RETURNING id INTO v_section_id;

  PERFORM public._agenda_ledger_log(
    'revision_content_edited', v_actor, v_ctx.scope,
    CASE WHEN v_ctx.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_ctx.tenant_id, NULL, v_ctx.template_root_id, p_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('op', 'add_section', 'section_id', v_section_id), NULL
  );

  RETURN QUERY SELECT v_section_id, v_ctx.new_draft_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_agenda_template_revision_section(
  p_section_id uuid, p_expected_draft_version integer, p_title text, p_description text, p_sort_order integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision_id uuid;
  v_ctx record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT s.revision_id INTO v_revision_id FROM public.agenda_template_revision_sections AS s WHERE s.id = p_section_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'section not found';
  END IF;

  SELECT * INTO v_ctx FROM public._agenda_authorize_draft_mutation(v_revision_id, p_expected_draft_version);

  UPDATE public.agenda_template_revision_sections AS s
  SET title = p_title, description = p_description, sort_order = p_sort_order
  WHERE s.id = p_section_id;

  PERFORM public._agenda_ledger_log(
    'revision_content_edited', v_actor, v_ctx.scope,
    CASE WHEN v_ctx.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_ctx.tenant_id, NULL, v_ctx.template_root_id, v_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('op', 'edit_section', 'section_id', p_section_id), NULL
  );

  RETURN v_ctx.new_draft_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_agenda_template_revision_section(
  p_section_id uuid, p_expected_draft_version integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision_id uuid;
  v_ctx record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT s.revision_id INTO v_revision_id FROM public.agenda_template_revision_sections AS s WHERE s.id = p_section_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'section not found';
  END IF;

  SELECT * INTO v_ctx FROM public._agenda_authorize_draft_mutation(v_revision_id, p_expected_draft_version);

  DELETE FROM public.agenda_template_revision_sections AS s WHERE s.id = p_section_id;

  PERFORM public._agenda_ledger_log(
    'revision_content_edited', v_actor, v_ctx.scope,
    CASE WHEN v_ctx.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_ctx.tenant_id, NULL, v_ctx.template_root_id, v_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('op', 'remove_section', 'section_id', p_section_id), NULL
  );

  RETURN v_ctx.new_draft_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_agenda_template_revision_item(
  p_revision_id uuid, p_expected_draft_version integer, p_section_id uuid,
  p_title text, p_description text, p_location text, p_speaker text, p_category text, p_color text,
  p_agenda_day_offset integer, p_start_time time, p_end_time time, p_is_all_day boolean,
  p_is_published boolean, p_sort_order integer, p_external_id text
)
RETURNS TABLE(new_id uuid, new_draft_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ctx record;
  v_item_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_ctx FROM public._agenda_authorize_draft_mutation(p_revision_id, p_expected_draft_version);

  INSERT INTO public.agenda_template_revision_items(
    revision_id, section_id, title, description, location, speaker, category, color,
    agenda_day_offset, start_time, end_time, is_all_day, is_published, sort_order, external_id, created_by_auth_user_id
  ) VALUES (
    p_revision_id, p_section_id, p_title, p_description, p_location, p_speaker, p_category, p_color,
    p_agenda_day_offset, p_start_time, p_end_time, coalesce(p_is_all_day, false), coalesce(p_is_published, true),
    coalesce(p_sort_order, 0), p_external_id, v_actor
  ) RETURNING id INTO v_item_id;

  PERFORM public._agenda_ledger_log(
    'revision_content_edited', v_actor, v_ctx.scope,
    CASE WHEN v_ctx.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_ctx.tenant_id, NULL, v_ctx.template_root_id, p_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('op', 'add_item', 'item_id', v_item_id), NULL
  );

  RETURN QUERY SELECT v_item_id, v_ctx.new_draft_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_agenda_template_revision_item(
  p_item_id uuid, p_expected_draft_version integer,
  p_section_id uuid, p_title text, p_description text, p_location text, p_speaker text, p_category text, p_color text,
  p_agenda_day_offset integer, p_start_time time, p_end_time time, p_is_all_day boolean,
  p_is_published boolean, p_sort_order integer, p_external_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision_id uuid;
  v_ctx record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT it.revision_id INTO v_revision_id FROM public.agenda_template_revision_items AS it WHERE it.id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found';
  END IF;

  SELECT * INTO v_ctx FROM public._agenda_authorize_draft_mutation(v_revision_id, p_expected_draft_version);

  UPDATE public.agenda_template_revision_items AS it
  SET section_id = p_section_id, title = p_title, description = p_description, location = p_location,
      speaker = p_speaker, category = p_category, color = p_color, agenda_day_offset = p_agenda_day_offset,
      start_time = p_start_time, end_time = p_end_time, is_all_day = coalesce(p_is_all_day, false),
      is_published = coalesce(p_is_published, true), sort_order = coalesce(p_sort_order, 0), external_id = p_external_id
  WHERE it.id = p_item_id;

  PERFORM public._agenda_ledger_log(
    'revision_content_edited', v_actor, v_ctx.scope,
    CASE WHEN v_ctx.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_ctx.tenant_id, NULL, v_ctx.template_root_id, v_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('op', 'edit_item', 'item_id', p_item_id), NULL
  );

  RETURN v_ctx.new_draft_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_agenda_template_revision_item(
  p_item_id uuid, p_expected_draft_version integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision_id uuid;
  v_ctx record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT it.revision_id INTO v_revision_id FROM public.agenda_template_revision_items AS it WHERE it.id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found';
  END IF;

  SELECT * INTO v_ctx FROM public._agenda_authorize_draft_mutation(v_revision_id, p_expected_draft_version);

  DELETE FROM public.agenda_template_revision_items AS it WHERE it.id = p_item_id;

  PERFORM public._agenda_ledger_log(
    'revision_content_edited', v_actor, v_ctx.scope,
    CASE WHEN v_ctx.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_ctx.tenant_id, NULL, v_ctx.template_root_id, v_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('op', 'remove_item', 'item_id', p_item_id), NULL
  );

  RETURN v_ctx.new_draft_version;
END;
$$;

-- ============================================================
-- Stage 7: publish / archive
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_agenda_template_revision(
  p_revision_id uuid, p_publication_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision public.agenda_template_revisions%ROWTYPE;
  v_root public.agenda_template_roots%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT r.* INTO v_root
  FROM public.agenda_template_revisions AS rev
  JOIN public.agenda_template_roots AS r ON r.id = rev.template_root_id
  WHERE rev.id = p_revision_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision not found';
  END IF;

  IF v_root.scope = 'platform' THEN
    IF NOT public.has_platform_agenda_template_authority() THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  ELSE
    IF NOT public.has_tenant_agenda_template_authority(v_root.tenant_id) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  SELECT rev.* INTO v_revision FROM public.agenda_template_revisions AS rev WHERE rev.id = p_revision_id FOR UPDATE;

  IF v_revision.revision_status <> 'draft' THEN
    RAISE EXCEPTION 'invalid_state';
  END IF;

  UPDATE public.agenda_template_revisions AS rev
  SET revision_status = 'superseded'
  WHERE rev.template_root_id = v_root.id AND rev.revision_status = 'published';

  IF FOUND THEN
    PERFORM public._agenda_ledger_log(
      'revision_superseded', v_actor, v_root.scope,
      CASE WHEN v_root.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
      v_root.tenant_id, NULL, v_root.id, NULL, NULL, NULL, NULL,
      gen_random_uuid(), NULL, NULL, NULL
    );
  END IF;

  UPDATE public.agenda_template_revisions AS rev
  SET revision_status = 'published', published_at = now(), publication_note = p_publication_note
  WHERE rev.id = p_revision_id;

  PERFORM public._agenda_ledger_log(
    'revision_published', v_actor, v_root.scope,
    CASE WHEN v_root.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_root.tenant_id, NULL, v_root.id, p_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), NULL, jsonb_build_object('revision_number', v_revision.revision_number), NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_agenda_template_root(
  p_template_root_id uuid, p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.agenda_template_roots%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT r.* INTO v_root FROM public.agenda_template_roots AS r WHERE r.id = p_template_root_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template root not found';
  END IF;

  IF v_root.scope = 'platform' THEN
    IF NOT public.has_platform_agenda_template_authority() THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  ELSE
    IF NOT public.has_tenant_agenda_template_authority(v_root.tenant_id) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  UPDATE public.agenda_template_roots AS r
  SET lifecycle_status = 'archived'
  WHERE r.id = p_template_root_id;

  PERFORM public._agenda_ledger_log(
    'root_archived', v_actor, v_root.scope,
    CASE WHEN v_root.scope = 'platform' THEN 'platform.agenda_templates.manage' ELSE 'tenant.agenda_templates.manage' END,
    v_root.tenant_id, NULL, p_template_root_id, NULL, NULL, NULL, NULL,
    gen_random_uuid(), NULL, NULL, p_reason
  );
END;
$$;

-- ============================================================
-- Internal helper: copy all sections/items from a published source
-- revision into a fresh draft target revision. Shared by duplicate and
-- promote (Stage 8). Never writes to the source revision.
-- ============================================================

CREATE OR REPLACE FUNCTION public._agenda_template_copy_revision_content(
  p_source_revision_id uuid, p_target_revision_id uuid, p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_section public.agenda_template_revision_sections%ROWTYPE;
  v_new_section_id uuid;
BEGIN
  FOR v_section IN
    SELECT s.* FROM public.agenda_template_revision_sections AS s
    WHERE s.revision_id = p_source_revision_id
    ORDER BY s.sort_order
  LOOP
    INSERT INTO public.agenda_template_revision_sections(revision_id, title, description, sort_order, created_by_auth_user_id)
    VALUES (p_target_revision_id, v_section.title, v_section.description, v_section.sort_order, p_actor)
    RETURNING id INTO v_new_section_id;

    INSERT INTO public.agenda_template_revision_items(
      revision_id, section_id, title, description, location, speaker, category, color,
      agenda_day_offset, start_time, end_time, is_all_day, is_published, sort_order, external_id, created_by_auth_user_id
    )
    SELECT p_target_revision_id, v_new_section_id, it.title, it.description, it.location, it.speaker, it.category, it.color,
           it.agenda_day_offset, it.start_time, it.end_time, it.is_all_day, it.is_published, it.sort_order, it.external_id, p_actor
    FROM public.agenda_template_revision_items AS it
    WHERE it.revision_id = p_source_revision_id AND it.section_id = v_section.id;
  END LOOP;

  INSERT INTO public.agenda_template_revision_items(
    revision_id, section_id, title, description, location, speaker, category, color,
    agenda_day_offset, start_time, end_time, is_all_day, is_published, sort_order, external_id, created_by_auth_user_id
  )
  SELECT p_target_revision_id, NULL, it.title, it.description, it.location, it.speaker, it.category, it.color,
         it.agenda_day_offset, it.start_time, it.end_time, it.is_all_day, it.is_published, it.sort_order, it.external_id, p_actor
  FROM public.agenda_template_revision_items AS it
  WHERE it.revision_id = p_source_revision_id AND it.section_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._agenda_template_copy_revision_content(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Stage 8: duplicate / promote
-- Design decision: both require a published source revision (the
-- CMD states this explicitly for Platform->Tenant; applied uniformly
-- here to Tenant->Tenant as the safest explicit reading, since
-- duplicating unpublished/unreviewed draft content across an
-- ownership boundary is not requested and would be unsafe).
-- ============================================================

CREATE OR REPLACE FUNCTION public.duplicate_agenda_template(
  p_source_revision_id uuid, p_target_scope text, p_target_tenant_id uuid, p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source_revision public.agenda_template_revisions%ROWTYPE;
  v_source_root public.agenda_template_roots%ROWTYPE;
  v_new_root_id uuid;
  v_new_revision_id uuid;
  v_derivation_type text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_target_scope NOT IN ('platform', 'tenant') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  SELECT rev.* INTO v_source_revision FROM public.agenda_template_revisions AS rev WHERE rev.id = p_source_revision_id;
  IF NOT FOUND OR v_source_revision.revision_status <> 'published' THEN
    RAISE EXCEPTION 'unpublished_revision';
  END IF;

  SELECT r.* INTO v_source_root FROM public.agenda_template_roots AS r WHERE r.id = v_source_revision.template_root_id;

  IF p_target_scope = 'platform' THEN
    RAISE EXCEPTION 'invalid_derivation';
  END IF;

  IF v_source_root.scope = 'platform' THEN
    v_derivation_type := 'platform_to_tenant_duplicate';
  ELSIF v_source_root.scope = 'tenant' AND v_source_root.tenant_id = p_target_tenant_id THEN
    v_derivation_type := 'tenant_to_tenant_duplicate';
  ELSE
    RAISE EXCEPTION 'cross_tenant_apply';
  END IF;

  IF NOT public.has_tenant_agenda_template_authority(p_target_tenant_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, created_by_auth_user_id)
  VALUES ('tenant', p_target_tenant_id, v_source_root.title, v_source_root.description, v_actor)
  RETURNING id INTO v_new_root_id;

  INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
  VALUES (v_new_root_id, 1, 'draft', v_actor)
  RETURNING id INTO v_new_revision_id;

  PERFORM public._agenda_template_copy_revision_content(p_source_revision_id, v_new_revision_id, v_actor);

  INSERT INTO public.agenda_template_derivations(
    derived_template_root_id, derived_revision_id, source_template_root_id, source_revision_id,
    derivation_type, actor_auth_user_id, reason
  ) VALUES (
    v_new_root_id, v_new_revision_id, v_source_root.id, p_source_revision_id,
    v_derivation_type, v_actor, p_reason
  );

  PERFORM public._agenda_ledger_log(
    'template_duplicated', v_actor, 'tenant', 'tenant.agenda_templates.manage',
    p_target_tenant_id, NULL, v_new_root_id, v_new_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), jsonb_build_object('source_revision_id', p_source_revision_id), jsonb_build_object('new_root_id', v_new_root_id), p_reason
  );

  RETURN v_new_root_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_agenda_template_to_platform(
  p_source_revision_id uuid, p_reason text DEFAULT NULL, p_review_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source_revision public.agenda_template_revisions%ROWTYPE;
  v_source_root public.agenda_template_roots%ROWTYPE;
  v_new_root_id uuid;
  v_new_revision_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_platform_agenda_template_authority() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT rev.* INTO v_source_revision FROM public.agenda_template_revisions AS rev WHERE rev.id = p_source_revision_id;
  IF NOT FOUND OR v_source_revision.revision_status <> 'published' THEN
    RAISE EXCEPTION 'unpublished_revision';
  END IF;

  SELECT r.* INTO v_source_root FROM public.agenda_template_roots AS r WHERE r.id = v_source_revision.template_root_id;

  IF v_source_root.scope <> 'tenant' THEN
    RAISE EXCEPTION 'invalid_derivation';
  END IF;

  -- Ownership is not transferred: a new Platform root/revision is
  -- created; the original Tenant root is only ever read here.
  INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, created_by_auth_user_id)
  VALUES ('platform', NULL, v_source_root.title, v_source_root.description, v_actor)
  RETURNING id INTO v_new_root_id;

  INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
  VALUES (v_new_root_id, 1, 'draft', v_actor)
  RETURNING id INTO v_new_revision_id;

  PERFORM public._agenda_template_copy_revision_content(p_source_revision_id, v_new_revision_id, v_actor);

  INSERT INTO public.agenda_template_derivations(
    derived_template_root_id, derived_revision_id, source_template_root_id, source_revision_id,
    derivation_type, actor_auth_user_id, reason, review_reference
  ) VALUES (
    v_new_root_id, v_new_revision_id, v_source_root.id, p_source_revision_id,
    'tenant_to_platform_promotion', v_actor, p_reason, p_review_reference
  );

  PERFORM public._agenda_ledger_log(
    'template_promoted', v_actor, 'platform', 'platform.agenda_templates.manage',
    NULL, NULL, v_new_root_id, v_new_revision_id, NULL, NULL, NULL,
    gen_random_uuid(), jsonb_build_object('source_root_id', v_source_root.id, 'source_revision_id', p_source_revision_id),
    jsonb_build_object('new_root_id', v_new_root_id), p_reason
  );

  RETURN v_new_root_id;
END;
$$;

-- ============================================================
-- Stage 9: save Event agenda as Tenant template
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_event_agenda_as_tenant_template(
  p_event_id uuid, p_title text, p_description text, p_publish boolean DEFAULT false,
  p_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_item_count integer;
  v_new_root_id uuid;
  v_new_revision_id uuid;
  v_fingerprint text;
  v_prior record;
  v_category text;
  v_new_section_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized_event_agenda';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id FROM public.events AS e WHERE e.id = p_event_id;
  IF NOT FOUND OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  IF NOT public.has_tenant_agenda_template_authority(v_tenant_id) THEN
    RAISE EXCEPTION 'unauthorized_tenant_template';
  END IF;

  PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.event_agenda_state(event_id, version) VALUES (p_event_id, 0)
    ON CONFLICT (event_id) DO NOTHING;
    PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  END IF;

  v_fingerprint := md5(p_event_id::text || '|' || coalesce(p_title, '') || '|' || coalesce(p_description, '') || '|' || coalesce(p_publish::text, ''));

  SELECT l.template_root_id, l.request_fingerprint INTO v_prior
  FROM public.agenda_command_ledger AS l
  WHERE l.action = 'event_agenda_saved_as_template' AND l.actor_auth_user_id = v_actor AND l.idempotency_key = p_idempotency_key
  ORDER BY l.occurred_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_prior.request_fingerprint = v_fingerprint THEN
      RETURN v_prior.template_root_id;
    ELSE
      RAISE EXCEPTION 'duplicate_idempotency_key_conflict';
    END IF;
  END IF;

  SELECT count(*) INTO v_item_count FROM public.agenda_items AS ai WHERE ai.event_id = p_event_id;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'empty_source_agenda';
  END IF;

  INSERT INTO public.agenda_template_roots(scope, tenant_id, title, description, created_by_auth_user_id)
  VALUES ('tenant', v_tenant_id, p_title, p_description, v_actor)
  RETURNING id INTO v_new_root_id;

  INSERT INTO public.agenda_template_revisions(template_root_id, revision_number, revision_status, created_by_auth_user_id)
  VALUES (v_new_root_id, 1, 'draft', v_actor)
  RETURNING id INTO v_new_revision_id;

  FOR v_category IN
    SELECT DISTINCT ai.category FROM public.agenda_items AS ai
    WHERE ai.event_id = p_event_id AND ai.category IS NOT NULL
  LOOP
    INSERT INTO public.agenda_template_revision_sections(revision_id, title, sort_order, created_by_auth_user_id)
    VALUES (v_new_revision_id, v_category, 0, v_actor)
    RETURNING id INTO v_new_section_id;

    INSERT INTO public.agenda_template_revision_items(
      revision_id, section_id, title, description, location, speaker, category, color,
      start_time, end_time, is_published, sort_order, external_id, created_by_auth_user_id
    )
    SELECT v_new_revision_id, v_new_section_id, ai.title, ai.description, ai.location, ai.speaker, ai.category, ai.color,
           ai.start_time, ai.end_time, coalesce(ai.is_published, true), coalesce(ai.sort_order, 0), ai.external_id, v_actor
    FROM public.agenda_items AS ai
    WHERE ai.event_id = p_event_id AND ai.category = v_category;
  END LOOP;

  INSERT INTO public.agenda_template_revision_items(
    revision_id, section_id, title, description, location, speaker, category, color,
    start_time, end_time, is_published, sort_order, external_id, created_by_auth_user_id
  )
  SELECT v_new_revision_id, NULL, ai.title, ai.description, ai.location, ai.speaker, ai.category, ai.color,
         ai.start_time, ai.end_time, coalesce(ai.is_published, true), coalesce(ai.sort_order, 0), ai.external_id, v_actor
  FROM public.agenda_items AS ai
  WHERE ai.event_id = p_event_id AND ai.category IS NULL;

  INSERT INTO public.agenda_template_derivations(
    derived_template_root_id, derived_revision_id, source_event_id, derivation_type, actor_auth_user_id, reason
  ) VALUES (
    v_new_root_id, v_new_revision_id, p_event_id, 'event_agenda_to_tenant_template', v_actor, NULL
  );

  PERFORM public._agenda_ledger_log(
    'event_agenda_saved_as_template', v_actor, 'compound', 'tenant.agenda_templates.manage',
    v_tenant_id, p_event_id, v_new_root_id, v_new_revision_id, NULL, p_idempotency_key, v_fingerprint,
    gen_random_uuid(), NULL, jsonb_build_object('new_root_id', v_new_root_id, 'item_count', v_item_count), NULL
  );

  IF p_publish THEN
    PERFORM public.publish_agenda_template_revision(v_new_revision_id, 'published on save-as-template');
  END IF;

  RETURN v_new_root_id;
END;
$$;

-- ============================================================
-- Internal helper: bulk-copy a published revision's items into an
-- Event's agenda_items, converting day_offset -> absolute agenda_date
-- from the Event's start_date. Shared by apply and replace (Stage 10/11).
-- ============================================================

CREATE OR REPLACE FUNCTION public._agenda_apply_copy_items(
  p_event_id uuid, p_application_id uuid, p_source_revision_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_start_date date;
  v_copied integer;
BEGIN
  SELECT e.start_date INTO v_event_start_date FROM public.events AS e WHERE e.id = p_event_id;

  INSERT INTO public.agenda_items(
    event_id, title, description, location, category, color, agenda_date, start_time, end_time,
    sort_order, is_published, speaker, external_id, source,
    template_application_id, source_template_revision_id, source_template_item_id
  )
  SELECT
    p_event_id, it.title, it.description, it.location, it.category, it.color,
    CASE WHEN it.agenda_day_offset IS NULL OR v_event_start_date IS NULL THEN NULL
         ELSE v_event_start_date + (it.agenda_day_offset * interval '1 day') END,
    coalesce(it.start_time, '00:00:00'::time), it.end_time,
    it.sort_order, it.is_published, it.speaker, it.external_id, 'template',
    p_application_id, p_source_revision_id, it.id
  FROM public.agenda_template_revision_items AS it
  WHERE it.revision_id = p_source_revision_id;

  GET DIAGNOSTICS v_copied = ROW_COUNT;
  RETURN v_copied;
END;
$$;

REVOKE ALL ON FUNCTION public._agenda_apply_copy_items(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Internal helper: validate a source revision is applicable to an
-- Event (published, active root, Platform or same-Tenant scope).
-- Shared by apply and replace.
-- ============================================================

CREATE OR REPLACE FUNCTION public._agenda_validate_applicable_source(
  p_source_revision_id uuid, p_event_tenant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_revision public.agenda_template_revisions%ROWTYPE;
  v_root public.agenda_template_roots%ROWTYPE;
BEGIN
  SELECT rev.* INTO v_revision FROM public.agenda_template_revisions AS rev WHERE rev.id = p_source_revision_id;
  IF NOT FOUND OR v_revision.revision_status <> 'published' THEN
    RAISE EXCEPTION 'unpublished_revision';
  END IF;

  SELECT r.* INTO v_root FROM public.agenda_template_roots AS r WHERE r.id = v_revision.template_root_id;
  IF v_root.lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'archived_template';
  END IF;

  IF v_root.scope = 'tenant' AND v_root.tenant_id IS DISTINCT FROM p_event_tenant_id THEN
    RAISE EXCEPTION 'cross_tenant_apply';
  END IF;

  IF v_root.scope NOT IN ('platform', 'tenant') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._agenda_validate_applicable_source(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Stage 10: apply template to Event (pure additive copy -- never
-- touches existing agenda_items rows; see report for the explicit
-- apply-vs-replace distinction this migration adopts).
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_agenda_template_to_event(
  p_event_id uuid, p_source_revision_id uuid, p_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_version_before integer;
  v_fingerprint text;
  v_existing public.agenda_template_applications%ROWTYPE;
  v_application_id uuid;
  v_copied_count integer;
  v_expected_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id FROM public.events AS e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  PERFORM public._agenda_validate_applicable_source(p_source_revision_id, v_tenant_id);

  v_fingerprint := md5(p_event_id::text || '|' || p_source_revision_id::text || '|apply');

  SELECT a.* INTO v_existing
  FROM public.agenda_template_applications AS a
  WHERE a.event_id = p_event_id AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint = v_fingerprint THEN
      RETURN v_existing.id;
    ELSE
      RAISE EXCEPTION 'duplicate_idempotency_key_conflict';
    END IF;
  END IF;

  PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.event_agenda_state(event_id, version) VALUES (p_event_id, 0)
    ON CONFLICT (event_id) DO NOTHING;
    PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  END IF;

  SELECT s.version INTO v_version_before FROM public.event_agenda_state AS s WHERE s.event_id = p_event_id;

  SELECT count(*) INTO v_expected_count FROM public.agenda_template_revision_items AS it WHERE it.revision_id = p_source_revision_id;

  INSERT INTO public.agenda_template_applications(
    event_id, source_template_root_id, source_revision_id, operation, actor_auth_user_id,
    idempotency_key, copied_item_count, replaced_item_count, outcome_status,
    event_agenda_version_before, event_agenda_version_after, request_fingerprint
  )
  SELECT p_event_id, rev.template_root_id, p_source_revision_id, 'apply', v_actor,
         p_idempotency_key, v_expected_count, 0, 'applied',
         v_version_before, v_version_before + 1, v_fingerprint
  FROM public.agenda_template_revisions AS rev WHERE rev.id = p_source_revision_id
  RETURNING id INTO v_application_id;

  v_copied_count := public._agenda_apply_copy_items(p_event_id, v_application_id, p_source_revision_id);

  UPDATE public.event_agenda_state AS s
  SET version = v_version_before + 1, updated_at = now()
  WHERE s.event_id = p_event_id;

  PERFORM public._agenda_ledger_log(
    'template_applied', v_actor, 'event', 'event.agenda.manage',
    v_tenant_id, p_event_id, NULL, p_source_revision_id, v_application_id, p_idempotency_key, v_fingerprint,
    gen_random_uuid(), jsonb_build_object('version_before', v_version_before),
    jsonb_build_object('version_after', v_version_before + 1, 'copied_item_count', v_copied_count), NULL
  );

  RETURN v_application_id;
END;
$$;

-- ============================================================
-- Stage 11: replace Event agenda from template
-- ============================================================

CREATE OR REPLACE FUNCTION public.replace_agenda_from_template(
  p_event_id uuid, p_source_revision_id uuid, p_expected_agenda_version integer,
  p_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_version_before integer;
  v_fingerprint text;
  v_existing public.agenda_template_applications%ROWTYPE;
  v_application_id uuid;
  v_copied_count integer;
  v_deleted_count integer;
  v_expected_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id FROM public.events AS e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  PERFORM public._agenda_validate_applicable_source(p_source_revision_id, v_tenant_id);

  v_fingerprint := md5(p_event_id::text || '|' || p_source_revision_id::text || '|replace|' || p_expected_agenda_version::text);

  SELECT a.* INTO v_existing
  FROM public.agenda_template_applications AS a
  WHERE a.event_id = p_event_id AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint = v_fingerprint THEN
      RETURN v_existing.id;
    ELSE
      RAISE EXCEPTION 'duplicate_idempotency_key_conflict';
    END IF;
  END IF;

  PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.event_agenda_state(event_id, version) VALUES (p_event_id, 0)
    ON CONFLICT (event_id) DO NOTHING;
    PERFORM 1 FROM public.event_agenda_state WHERE event_id = p_event_id FOR UPDATE;
  END IF;

  SELECT s.version INTO v_version_before FROM public.event_agenda_state AS s WHERE s.event_id = p_event_id;

  IF v_version_before <> p_expected_agenda_version THEN
    RAISE EXCEPTION 'stale_agenda_version';
  END IF;

  SELECT count(*) INTO v_expected_count FROM public.agenda_template_revision_items AS it WHERE it.revision_id = p_source_revision_id;

  -- applications rows are immutable by trigger (no UPDATE possible after
  -- insert), so replaced_item_count must be known before the row is
  -- written -- computed here from the Event's current agenda, before
  -- the delete below removes those rows.
  SELECT count(*) INTO v_deleted_count FROM public.agenda_items AS ai WHERE ai.event_id = p_event_id;

  INSERT INTO public.agenda_template_applications(
    event_id, source_template_root_id, source_revision_id, operation, actor_auth_user_id,
    idempotency_key, copied_item_count, replaced_item_count, outcome_status,
    event_agenda_version_before, event_agenda_version_after, request_fingerprint
  )
  SELECT p_event_id, rev.template_root_id, p_source_revision_id, 'replace', v_actor,
         p_idempotency_key, v_expected_count, v_deleted_count, 'applied',
         v_version_before, v_version_before + 1, v_fingerprint
  FROM public.agenda_template_revisions AS rev WHERE rev.id = p_source_revision_id
  RETURNING id INTO v_application_id;

  DELETE FROM public.agenda_items AS ai WHERE ai.event_id = p_event_id;

  v_copied_count := public._agenda_apply_copy_items(p_event_id, v_application_id, p_source_revision_id);

  UPDATE public.event_agenda_state AS s
  SET version = v_version_before + 1, updated_at = now()
  WHERE s.event_id = p_event_id;

  PERFORM public._agenda_ledger_log(
    'agenda_replaced', v_actor, 'event', 'event.agenda.manage',
    v_tenant_id, p_event_id, NULL, p_source_revision_id, v_application_id, p_idempotency_key, v_fingerprint,
    gen_random_uuid(), jsonb_build_object('version_before', v_version_before, 'deleted_item_count', v_deleted_count),
    jsonb_build_object('version_after', v_version_before + 1, 'copied_item_count', v_copied_count), NULL
  );

  RETURN v_application_id;
END;
$$;

-- ============================================================
-- Stage 6: governed read surfaces
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_available_agenda_templates(p_event_id uuid)
RETURNS TABLE(
  source_scope text, template_root_id uuid, revision_id uuid, revision_number integer,
  title text, description text, revision_status text, tenant_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT (public.has_event_task_authority('event.agenda.view', p_event_id)
          OR public.has_event_task_authority('event.agenda.manage', p_event_id)) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT e.tenant_id INTO v_tenant_id FROM public.events AS e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wrong_event';
  END IF;

  RETURN QUERY
  SELECT r.scope, r.id, rev.id, rev.revision_number, r.title, r.description, rev.revision_status, r.tenant_id
  FROM public.agenda_template_roots AS r
  JOIN public.agenda_template_revisions AS rev ON rev.template_root_id = r.id AND rev.revision_status = 'published'
  WHERE r.lifecycle_status = 'active'
    AND (r.scope = 'platform' OR (r.scope = 'tenant' AND r.tenant_id = v_tenant_id))
  ORDER BY r.scope, r.title;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_agenda_template_application_history(p_event_id uuid)
RETURNS TABLE(
  application_id uuid, operation text, source_template_root_id uuid, source_revision_id uuid,
  applied_at timestamptz, actor_auth_user_id uuid, copied_item_count integer, replaced_item_count integer,
  outcome_status text, correlation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.agenda.view', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT a.id, a.operation, a.source_template_root_id, a.source_revision_id, a.applied_at,
         a.actor_auth_user_id, a.copied_item_count, a.replaced_item_count, a.outcome_status, a.correlation_id
  FROM public.agenda_template_applications AS a
  WHERE a.event_id = p_event_id
  ORDER BY a.applied_at DESC;
END;
$$;

-- ============================================================
-- Stage 14: EXECUTE ACL -- authenticated-only for every caller-facing
-- RPC; internal helpers already revoked from everyone above.
-- ============================================================

REVOKE ALL ON FUNCTION public.create_agenda_template_root(text, uuid, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_agenda_template_root(text, uuid, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_agenda_template_revision(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_agenda_template_revision(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.add_agenda_template_revision_section(uuid, integer, text, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_agenda_template_revision_section(uuid, integer, text, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.edit_agenda_template_revision_section(uuid, integer, text, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.edit_agenda_template_revision_section(uuid, integer, text, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_agenda_template_revision_section(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.remove_agenda_template_revision_section(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.add_agenda_template_revision_item(
  uuid, integer, uuid, text, text, text, text, text, text, integer, time, time, boolean, boolean, integer, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_agenda_template_revision_item(
  uuid, integer, uuid, text, text, text, text, text, text, integer, time, time, boolean, boolean, integer, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.edit_agenda_template_revision_item(
  uuid, integer, uuid, text, text, text, text, text, text, integer, time, time, boolean, boolean, integer, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.edit_agenda_template_revision_item(
  uuid, integer, uuid, text, text, text, text, text, text, integer, time, time, boolean, boolean, integer, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_agenda_template_revision_item(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.remove_agenda_template_revision_item(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.publish_agenda_template_revision(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.publish_agenda_template_revision(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_agenda_template_root(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.archive_agenda_template_root(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.duplicate_agenda_template(uuid, text, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.duplicate_agenda_template(uuid, text, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.promote_agenda_template_to_platform(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.promote_agenda_template_to_platform(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.save_event_agenda_as_tenant_template(uuid, text, text, boolean, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_event_agenda_as_tenant_template(uuid, text, text, boolean, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_agenda_template_to_event(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.apply_agenda_template_to_event(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.replace_agenda_from_template(uuid, uuid, integer, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.replace_agenda_from_template(uuid, uuid, integer, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_available_agenda_templates(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_available_agenda_templates(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.read_agenda_template_application_history(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.read_agenda_template_application_history(uuid) TO authenticated;

COMMIT;
