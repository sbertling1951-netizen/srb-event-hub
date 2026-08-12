-- Phase 1 Agenda layered-catalog foundation. This is additive only: legacy
-- template data and policies remain authoritative for the current UI.
BEGIN;

CREATE TABLE public.agenda_template_roots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform', 'tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'archived')),
  created_by_auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_template_roots_scope_tenant_check CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  )
);

CREATE TABLE public.agenda_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_root_id uuid NOT NULL REFERENCES public.agenda_template_roots(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  revision_status text NOT NULL DEFAULT 'draft'
    CHECK (revision_status IN ('draft', 'published', 'superseded')),
  created_by_auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publication_note text,
  CONSTRAINT agenda_template_revisions_root_revision_unique UNIQUE (template_root_id, revision_number),
  CONSTRAINT agenda_template_revisions_id_root_unique UNIQUE (id, template_root_id),
  CONSTRAINT agenda_template_revisions_published_at_check CHECK (
    (revision_status = 'draft' AND published_at IS NULL)
    OR (revision_status IN ('published', 'superseded') AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX agenda_template_revisions_one_published_per_root
  ON public.agenda_template_revisions (template_root_id)
  WHERE revision_status = 'published';

CREATE TABLE public.agenda_template_revision_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES public.agenda_template_revisions(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_auth_user_id uuid NOT NULL,
  CONSTRAINT agenda_template_revision_sections_id_revision_unique UNIQUE (id, revision_id),
  CONSTRAINT agenda_template_revision_sections_revision_sort_unique UNIQUE (revision_id, sort_order)
);

CREATE TABLE public.agenda_template_revision_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES public.agenda_template_revisions(id) ON DELETE RESTRICT,
  section_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  location text,
  speaker text,
  category text,
  color text,
  agenda_day_offset integer,
  start_time time,
  end_time time,
  is_all_day boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_auth_user_id uuid NOT NULL,
  CONSTRAINT agenda_template_revision_items_id_revision_unique UNIQUE (id, revision_id),
  CONSTRAINT agenda_template_revision_items_section_revision_fkey
    FOREIGN KEY (section_id, revision_id)
    REFERENCES public.agenda_template_revision_sections(id, revision_id)
    ON DELETE RESTRICT,
  CONSTRAINT agenda_template_revision_items_time_check CHECK (
    end_time IS NULL OR start_time IS NULL OR end_time >= start_time
  )
);

CREATE INDEX agenda_template_revision_items_revision_sort_idx
  ON public.agenda_template_revision_items (revision_id, sort_order, id);

CREATE TABLE public.agenda_template_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_template_root_id uuid NOT NULL REFERENCES public.agenda_template_roots(id) ON DELETE RESTRICT,
  derived_revision_id uuid NOT NULL,
  source_template_root_id uuid REFERENCES public.agenda_template_roots(id) ON DELETE RESTRICT,
  source_revision_id uuid,
  source_event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  derivation_type text NOT NULL CHECK (derivation_type IN (
    'platform_to_tenant_duplicate',
    'tenant_to_tenant_duplicate',
    'tenant_to_platform_promotion',
    'event_agenda_to_tenant_template'
  )),
  actor_auth_user_id uuid NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  review_reference text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT agenda_template_derivations_derived_revision_root_fkey
    FOREIGN KEY (derived_revision_id, derived_template_root_id)
    REFERENCES public.agenda_template_revisions(id, template_root_id)
    ON DELETE RESTRICT,
  CONSTRAINT agenda_template_derivations_source_revision_root_fkey
    FOREIGN KEY (source_revision_id, source_template_root_id)
    REFERENCES public.agenda_template_revisions(id, template_root_id)
    ON DELETE RESTRICT,
  CONSTRAINT agenda_template_derivations_source_pair_check CHECK (
    (source_template_root_id IS NULL) = (source_revision_id IS NULL)
  ),
  CONSTRAINT agenda_template_derivations_event_source_check CHECK (
    (derivation_type = 'event_agenda_to_tenant_template' AND source_event_id IS NOT NULL
      AND source_template_root_id IS NULL AND source_revision_id IS NULL)
    OR (derivation_type <> 'event_agenda_to_tenant_template' AND source_event_id IS NULL
      AND source_template_root_id IS NOT NULL AND source_revision_id IS NOT NULL)
  )
);

CREATE TABLE public.agenda_template_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  source_template_root_id uuid NOT NULL REFERENCES public.agenda_template_roots(id) ON DELETE RESTRICT,
  source_revision_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('apply', 'replace')),
  actor_auth_user_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  copied_item_count integer NOT NULL DEFAULT 0 CHECK (copied_item_count >= 0),
  replaced_item_count integer NOT NULL DEFAULT 0 CHECK (replaced_item_count >= 0),
  outcome_status text NOT NULL DEFAULT 'applied' CHECK (outcome_status IN ('applied', 'failed')),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_agenda_version_before integer NOT NULL DEFAULT 0 CHECK (event_agenda_version_before >= 0),
  event_agenda_version_after integer CHECK (event_agenda_version_after >= 0),
  CONSTRAINT agenda_template_applications_source_revision_root_fkey
    FOREIGN KEY (source_revision_id, source_template_root_id)
    REFERENCES public.agenda_template_revisions(id, template_root_id)
    ON DELETE RESTRICT,
  CONSTRAINT agenda_template_applications_event_idempotency_unique UNIQUE (event_id, idempotency_key),
  CONSTRAINT agenda_template_applications_id_event_unique UNIQUE (id, event_id),
  CONSTRAINT agenda_template_applications_id_revision_unique UNIQUE (id, source_revision_id),
  CONSTRAINT agenda_template_applications_applied_version_check CHECK (
    outcome_status <> 'applied' OR event_agenda_version_after IS NOT NULL
  )
);

ALTER TABLE public.agenda_items
  ADD COLUMN template_application_id uuid,
  ADD COLUMN source_template_revision_id uuid,
  ADD COLUMN source_template_item_id uuid,
  ADD CONSTRAINT agenda_items_template_copy_provenance_check CHECK (
    (template_application_id IS NULL AND source_template_revision_id IS NULL AND source_template_item_id IS NULL)
    OR (template_application_id IS NOT NULL AND source_template_revision_id IS NOT NULL AND source_template_item_id IS NOT NULL)
  ),
  ADD CONSTRAINT agenda_items_template_application_event_fkey
    FOREIGN KEY (template_application_id, event_id)
    REFERENCES public.agenda_template_applications(id, event_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT agenda_items_template_application_revision_fkey
    FOREIGN KEY (template_application_id, source_template_revision_id)
    REFERENCES public.agenda_template_applications(id, source_revision_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT agenda_items_template_source_item_revision_fkey
    FOREIGN KEY (source_template_item_id, source_template_revision_id)
    REFERENCES public.agenda_template_revision_items(id, revision_id)
    ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public._agenda_template_root_scope_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF NEW.scope IS DISTINCT FROM OLD.scope OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'agenda template root scope and tenant ownership are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_revision_number_next()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.template_root_id::text));
  SELECT coalesce(max(r.revision_number), 0) + 1
    INTO v_next
    FROM public.agenda_template_revisions AS r
   WHERE r.template_root_id = NEW.template_root_id;
  IF NEW.revision_number <> v_next THEN
    RAISE EXCEPTION 'agenda template revision number must be the next value for its root';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_revision_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.revision_status <> 'draft' THEN
      RAISE EXCEPTION 'published or superseded agenda template revisions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.template_root_id IS DISTINCT FROM NEW.template_root_id
     OR OLD.revision_number IS DISTINCT FROM NEW.revision_number
     OR OLD.created_by_auth_user_id IS DISTINCT FROM NEW.created_by_auth_user_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'agenda template revision identity is immutable';
  END IF;

  IF OLD.revision_status = 'superseded' THEN
    RAISE EXCEPTION 'superseded agenda template revisions are immutable';
  END IF;

  IF OLD.revision_status = 'published' THEN
    IF NEW.revision_status = 'superseded'
       AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
       AND NEW.publication_note IS NOT DISTINCT FROM OLD.publication_note THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'published agenda template revisions are immutable except for supersession';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_section_revision_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  v_revision_id uuid;
  v_status text;
BEGIN
  v_revision_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.revision_id ELSE OLD.revision_id END;
  SELECT revision_status INTO v_status FROM public.agenda_template_revisions WHERE id = v_revision_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'agenda template revision content is immutable once published';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    SELECT revision_status INTO v_status FROM public.agenda_template_revisions WHERE id = NEW.revision_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'agenda template revision content can only move within draft revisions';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_item_revision_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  v_revision_id uuid;
  v_status text;
BEGIN
  v_revision_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.revision_id ELSE OLD.revision_id END;
  SELECT revision_status INTO v_status FROM public.agenda_template_revisions WHERE id = v_revision_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'agenda template revision content is immutable once published';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    SELECT revision_status INTO v_status FROM public.agenda_template_revisions WHERE id = NEW.revision_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'agenda template revision content can only move within draft revisions';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_derivation_valid()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  v_derived_scope text;
  v_derived_tenant uuid;
  v_source_scope text;
  v_source_tenant uuid;
BEGIN
  SELECT scope, tenant_id INTO v_derived_scope, v_derived_tenant
    FROM public.agenda_template_roots WHERE id = NEW.derived_template_root_id;
  IF NEW.derivation_type <> 'event_agenda_to_tenant_template' THEN
    SELECT scope, tenant_id INTO v_source_scope, v_source_tenant
      FROM public.agenda_template_roots WHERE id = NEW.source_template_root_id;
  END IF;

  IF (NEW.derivation_type = 'platform_to_tenant_duplicate'
      AND NOT (v_source_scope = 'platform' AND v_derived_scope = 'tenant'))
     OR (NEW.derivation_type = 'tenant_to_tenant_duplicate'
      AND NOT (v_source_scope = 'tenant' AND v_derived_scope = 'tenant' AND v_source_tenant = v_derived_tenant))
     OR (NEW.derivation_type = 'tenant_to_platform_promotion'
      AND NOT (v_source_scope = 'tenant' AND v_derived_scope = 'platform'))
     OR (NEW.derivation_type = 'event_agenda_to_tenant_template'
      AND NOT (v_derived_scope = 'tenant' AND NEW.source_event_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'agenda template derivation scope does not match derivation type';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_derivation_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'agenda template derivation provenance is immutable';
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_application_valid()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT revision_status INTO v_status
    FROM public.agenda_template_revisions
   WHERE id = NEW.source_revision_id
     AND template_root_id = NEW.source_template_root_id;
  IF v_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'agenda template application must reference an exact published revision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._agenda_template_application_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'agenda template application provenance is immutable';
  RETURN NULL;
END;
$$;

CREATE TRIGGER agenda_template_roots_scope_immutable
  BEFORE UPDATE ON public.agenda_template_roots
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_root_scope_immutable();

CREATE TRIGGER agenda_template_revisions_number_next
  BEFORE INSERT ON public.agenda_template_revisions
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_revision_number_next();

CREATE TRIGGER agenda_template_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.agenda_template_revisions
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_revision_immutable();

CREATE TRIGGER agenda_template_revision_sections_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.agenda_template_revision_sections
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_section_revision_draft();

CREATE TRIGGER agenda_template_revision_items_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.agenda_template_revision_items
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_item_revision_draft();

CREATE TRIGGER agenda_template_derivations_valid
  BEFORE INSERT ON public.agenda_template_derivations
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_derivation_valid();

CREATE TRIGGER agenda_template_derivations_immutable
  BEFORE UPDATE OR DELETE ON public.agenda_template_derivations
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_derivation_immutable();

CREATE TRIGGER agenda_template_applications_valid
  BEFORE INSERT ON public.agenda_template_applications
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_application_valid();

CREATE TRIGGER agenda_template_applications_immutable
  BEFORE UPDATE OR DELETE ON public.agenda_template_applications
  FOR EACH ROW EXECUTE FUNCTION public._agenda_template_application_immutable();

ALTER TABLE public.agenda_template_roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_template_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_template_revision_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_template_revision_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_template_derivations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_template_applications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agenda_template_roots,
                    public.agenda_template_revisions,
                    public.agenda_template_revision_sections,
                    public.agenda_template_revision_items,
                    public.agenda_template_derivations,
                    public.agenda_template_applications
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public._agenda_template_root_scope_immutable(),
                       public._agenda_template_revision_number_next(),
                       public._agenda_template_revision_immutable(),
                       public._agenda_template_section_revision_draft(),
                       public._agenda_template_item_revision_draft(),
                       public._agenda_template_derivation_valid(),
                       public._agenda_template_derivation_immutable(),
                       public._agenda_template_application_valid(),
                       public._agenda_template_application_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
