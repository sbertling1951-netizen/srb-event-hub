-- Agenda Categories Governance Stage 2: Platform Vocabulary Governed
-- Operations. Governs the mutation boundary of the live agenda_categories
-- table (Stage 1 finding: Platform-global curated suggestion vocabulary --
-- not Tenant-scoped, not Event-scoped, not a hard domain constraint, not
-- part of the retired legacy template system) without redesigning its
-- data model. The free-text relationship between agenda_categories,
-- agenda_items.category, and agenda_template_revision_items.category is
-- deliberately left untouched -- no FK is introduced anywhere below.
BEGIN;

-- ============================================================
-- 1. Task registry entry. Mirrors the two existing
-- platform-scope/mutation/platform_inherits-only tasks
-- (platform.maps.manage, platform.nearby_catalog.manage) added in
-- 20260811170000; identical shape, no new registry semantics invented.
-- ============================================================

INSERT INTO public.admin_task_registry
  (task_key, scope, task_kind, description, platform_inherits, tenant_inherits, event_assignment_grantable)
VALUES
  ('platform.agenda_vocabulary.manage', 'platform', 'mutation',
   'Manage the Platform-global Agenda category vocabulary (name, color, sort order, default, active) used to seed category/default-color suggestions on Admin Agenda items.',
   true, false, false);

-- ============================================================
-- 2. Default uniqueness -- simplest database-enforced invariant: a
-- partial unique index over the (constant, per included row) value
-- is_default = true. At most one row can have is_default = true at
-- any moment; this holds even under concurrent transactions because
-- the second committer's index entry collides with the first's.
-- ============================================================

CREATE UNIQUE INDEX agenda_categories_single_default_idx
  ON public.agenda_categories (is_default)
  WHERE is_default = true;

-- ============================================================
-- 3. Dedicated, small, immutable audit table. agenda_command_ledger
-- (20260811290000) is deliberately NOT reused: its action CHECK enum
-- and FK set (template_root_id/revision_id/application_id/event_id)
-- are Event/template-command-specific, and a category vocabulary edit
-- has none of those referents. admin_authority_audit (20260811170000)
-- is deliberately NOT reused either: its subject is authority
-- assignment/grant events on admin_event_access, not data CRUD. This
-- table follows the same immutability convention as both.
-- ============================================================

CREATE TABLE public.agenda_category_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  actor_auth_user_id uuid NOT NULL,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agenda_category_command_audit_category_idx
  ON public.agenda_category_command_audit (category_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_agenda_category_command_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'agenda_category_command_audit is immutable';
END;
$$;

CREATE TRIGGER prevent_agenda_category_command_audit_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.agenda_category_command_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_agenda_category_command_audit_mutation();

ALTER TABLE public.agenda_category_command_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_category_command_audit FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 4. Governed mutation RPCs. Authority check is
-- public.has_platform_admin_authority(auth.uid()) directly (not
-- resolve_task_authority, which requires a p_event_id and only
-- resolves Event-scoped tasks) -- this is the correct primitive for a
-- platform_inherits=true, event_assignment_grantable=false task with
-- no Event context, matching how resolve_task_authority itself
-- authorizes such tasks internally (line 127 of 20260811170000).
-- Actor identity is always auth.uid(); never accepted as a parameter.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_agenda_category(
  p_name text,
  p_color text,
  p_sort_order integer DEFAULT 100,
  p_is_default boolean DEFAULT false,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_is_default THEN
    UPDATE public.agenda_categories SET is_default = false WHERE is_default = true;
  END IF;

  BEGIN
    INSERT INTO public.agenda_categories (name, color, sort_order, is_default, is_active)
    VALUES (v_name, p_color, coalesce(p_sort_order, 100), coalesce(p_is_default, false), coalesce(p_is_active, true))
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'duplicate_category_name';
  END;

  INSERT INTO public.agenda_category_command_audit (category_id, action, actor_auth_user_id, after_state)
  VALUES (v_id, 'created', auth.uid(), jsonb_build_object(
    'name', v_name, 'color', p_color, 'sort_order', p_sort_order,
    'is_default', p_is_default, 'is_active', p_is_active
  ));

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_agenda_category(
  p_id uuid,
  p_name text,
  p_color text,
  p_sort_order integer,
  p_is_default boolean,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_before public.agenda_categories%ROWTYPE;
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_before FROM public.agenda_categories WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_is_default THEN
    UPDATE public.agenda_categories SET is_default = false WHERE is_default = true AND id <> p_id;
  END IF;

  BEGIN
    UPDATE public.agenda_categories
    SET name = v_name,
        color = p_color,
        sort_order = coalesce(p_sort_order, sort_order),
        is_default = coalesce(p_is_default, is_default),
        is_active = coalesce(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'duplicate_category_name';
  END;

  INSERT INTO public.agenda_category_command_audit (category_id, action, actor_auth_user_id, before_state, after_state)
  VALUES (p_id, 'updated', auth.uid(),
    jsonb_build_object('name', v_before.name, 'color', v_before.color, 'sort_order', v_before.sort_order, 'is_default', v_before.is_default, 'is_active', v_before.is_active),
    jsonb_build_object('name', v_name, 'color', p_color, 'sort_order', p_sort_order, 'is_default', p_is_default, 'is_active', p_is_active)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_agenda_category(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_before public.agenda_categories%ROWTYPE;
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_before FROM public.agenda_categories WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  -- Deliberately no cascade/rewrite of agenda_items.category or
  -- agenda_template_revision_items.category: both are free text with
  -- no FK to this table (Stage 1 finding), so historical rows keep
  -- whatever string they already have, unaffected by this delete.
  DELETE FROM public.agenda_categories WHERE id = p_id;

  INSERT INTO public.agenda_category_command_audit (category_id, action, actor_auth_user_id, before_state)
  VALUES (p_id, 'deleted', auth.uid(), jsonb_build_object(
    'name', v_before.name, 'color', v_before.color, 'sort_order', v_before.sort_order,
    'is_default', v_before.is_default, 'is_active', v_before.is_active
  ));
END;
$$;

ALTER FUNCTION public.create_agenda_category(text, text, integer, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.update_agenda_category(uuid, text, text, integer, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION public.delete_agenda_category(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_agenda_category(text, text, integer, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_agenda_category(uuid, text, text, integer, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_agenda_category(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_agenda_category(text, text, integer, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_agenda_category(uuid, text, text, integer, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_agenda_category(uuid) TO authenticated;

-- ============================================================
-- 5. Direct-write closure. Read stays direct (Stage 1: low-sensitivity,
-- intentionally public) -- only the two duplicate-but-harmless public
-- SELECT policies remain untouched. All three legacy privilege_group
-- mutation policies are dropped; INSERT/UPDATE/DELETE table privilege
-- is revoked from anon/authenticated/service_role, matching the exact
-- closure pattern used for agenda_items in 20260811330000. Governed
-- RPCs remain able to mutate because they run SECURITY DEFINER as the
-- table owner (postgres), which bypasses RLS via rolbypassrls.
-- ============================================================

DROP POLICY "Admins can insert agenda categories" ON public.agenda_categories;
DROP POLICY "Admins can update agenda categories" ON public.agenda_categories;
DROP POLICY "Admins can delete agenda categories" ON public.agenda_categories;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.agenda_categories FROM anon, authenticated, service_role;

COMMIT;
