-- Governed reusable Nearby Area Lists.
--
-- This additive stage creates reusable lists of existing canonical
-- nearby_master records. It deliberately does not reuse nearby_areas or
-- nearby_area_templates: those are legacy/search-configuration concepts,
-- not reusable governed place lists. Event application delegates every
-- selected source record to associate_nearby_master_place_with_event so
-- source_master_id, snapshot mapping, idempotency, authority, and Event
-- lifecycle remain owned by the already-governed canonical path.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE TABLE public.nearby_area_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  scope text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_by_auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nearby_area_lists_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT nearby_area_lists_scope_check CHECK (scope IN ('shared_public', 'tenant_specific')),
  CONSTRAINT nearby_area_lists_scope_tenant_check CHECK (
    (scope = 'shared_public' AND tenant_id IS NULL)
    OR (scope = 'tenant_specific' AND tenant_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX nearby_area_lists_shared_normalized_name_unique_idx
  ON public.nearby_area_lists (lower(btrim(name)))
  WHERE scope = 'shared_public';

CREATE UNIQUE INDEX nearby_area_lists_tenant_normalized_name_unique_idx
  ON public.nearby_area_lists (tenant_id, lower(btrim(name)))
  WHERE scope = 'tenant_specific';

CREATE INDEX nearby_area_lists_tenant_id_idx
  ON public.nearby_area_lists (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE public.nearby_area_list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_list_id uuid NOT NULL REFERENCES public.nearby_area_lists(id) ON DELETE RESTRICT,
  nearby_master_id uuid NOT NULL REFERENCES public.nearby_master(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_by_auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_auth_user_id uuid,
  updated_at timestamptz,
  CONSTRAINT nearby_area_list_members_unique_identity UNIQUE (area_list_id, nearby_master_id)
);

CREATE INDEX nearby_area_list_members_active_list_idx
  ON public.nearby_area_list_members (area_list_id, nearby_master_id)
  WHERE is_active;

CREATE TABLE public.nearby_master_provider_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nearby_master_id uuid NOT NULL REFERENCES public.nearby_master(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_place_id text NOT NULL,
  created_by_auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nearby_master_provider_identities_provider_check CHECK (provider = 'google_places'),
  CONSTRAINT nearby_master_provider_identities_place_id_not_blank CHECK (btrim(provider_place_id) <> ''),
  CONSTRAINT nearby_master_provider_identities_provider_place_unique UNIQUE (provider, provider_place_id),
  CONSTRAINT nearby_master_provider_identities_one_provider_per_master UNIQUE (nearby_master_id, provider)
);

CREATE TABLE public.nearby_area_list_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_list_id uuid NOT NULL REFERENCES public.nearby_area_lists(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'area_list_created',
    'area_list_updated',
    'area_list_retired',
    'member_added',
    'member_removed',
    'member_reactivated'
  )),
  actor_auth_user_id uuid NOT NULL,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nearby_area_list_command_audit_list_idx
  ON public.nearby_area_list_command_audit (area_list_id, occurred_at DESC);

CREATE TABLE public.nearby_area_list_application_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_list_id uuid NOT NULL REFERENCES public.nearby_area_lists(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  actor_auth_user_id uuid NOT NULL,
  selected_category_ids uuid[] NOT NULL,
  inserted_count integer NOT NULL CHECK (inserted_count >= 0),
  already_associated_count integer NOT NULL CHECK (already_associated_count >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nearby_area_list_application_audit_event_idx
  ON public.nearby_area_list_application_audit (event_id, occurred_at DESC);

CREATE TABLE public.nearby_master_provider_identity_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_identity_id uuid NOT NULL REFERENCES public.nearby_master_provider_identities(id) ON DELETE RESTRICT,
  nearby_master_id uuid NOT NULL REFERENCES public.nearby_master(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'provider_identity_linked'),
  actor_auth_user_id uuid NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nearby_master_provider_identity_audit_identity_idx
  ON public.nearby_master_provider_identity_audit (provider_identity_id, occurred_at DESC);

ALTER TABLE public.nearby_area_lists OWNER TO postgres;
ALTER TABLE public.nearby_area_list_members OWNER TO postgres;
ALTER TABLE public.nearby_master_provider_identities OWNER TO postgres;
ALTER TABLE public.nearby_area_list_command_audit OWNER TO postgres;
ALTER TABLE public.nearby_area_list_application_audit OWNER TO postgres;
ALTER TABLE public.nearby_master_provider_identity_audit OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.prevent_nearby_area_list_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'Nearby Area List audit evidence is immutable';
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_nearby_provider_identity_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'Nearby provider identity audit evidence is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_nearby_area_list_audit_mutation() OWNER TO postgres;
ALTER FUNCTION public.prevent_nearby_provider_identity_audit_mutation() OWNER TO postgres;

CREATE TRIGGER prevent_nearby_area_list_command_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.nearby_area_list_command_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_nearby_area_list_audit_mutation();

CREATE TRIGGER prevent_nearby_area_list_application_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.nearby_area_list_application_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_nearby_area_list_audit_mutation();

CREATE TRIGGER prevent_nearby_master_provider_identity_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.nearby_master_provider_identity_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_nearby_provider_identity_audit_mutation();

ALTER TABLE public.nearby_area_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nearby_area_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nearby_master_provider_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nearby_area_list_command_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nearby_area_list_application_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nearby_master_provider_identity_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nearby_area_lists FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.nearby_area_list_members FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.nearby_master_provider_identities FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.nearby_area_list_command_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.nearby_area_list_application_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.nearby_master_provider_identity_audit FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_nearby_area_list_management_authority(
  p_area_list_id uuid
)
RETURNS public.nearby_area_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_list public.nearby_area_lists%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nearby Area List management requires authenticated authority.';
  END IF;

  SELECT * INTO v_list
  FROM public.nearby_area_lists
  WHERE id = p_area_list_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nearby Area List % not found.', p_area_list_id;
  END IF;

  IF v_list.scope = 'shared_public' THEN
    IF NOT public.has_platform_admin_authority(auth.uid()) THEN
      RAISE EXCEPTION 'Shared Nearby Area List management requires Platform Administrator authority.';
    END IF;
  ELSIF v_list.scope = 'tenant_specific' THEN
    IF NOT public.has_tenant_admin_authority(auth.uid(), v_list.tenant_id) THEN
      RAISE EXCEPTION 'Tenant Nearby Area List management requires authority for its owning Tenant.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Nearby Area List % has an invalid scope.', p_area_list_id;
  END IF;

  RETURN v_list;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_nearby_area_list(
  p_scope text,
  p_tenant_id uuid,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS public.nearby_area_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_list public.nearby_area_lists%ROWTYPE;
  v_name text := nullif(btrim(p_name), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nearby Area List creation requires authenticated authority.';
  END IF;

  IF p_scope = 'shared_public' THEN
    IF p_tenant_id IS NOT NULL THEN
      RAISE EXCEPTION 'Shared Nearby Area Lists cannot have an owning Tenant.';
    END IF;
    IF NOT public.has_platform_admin_authority(v_actor) THEN
      RAISE EXCEPTION 'Shared Nearby Area List creation requires Platform Administrator authority.';
    END IF;
  ELSIF p_scope = 'tenant_specific' THEN
    IF p_tenant_id IS NULL THEN
      RAISE EXCEPTION 'Tenant Nearby Area Lists require an owning Tenant.';
    END IF;
    IF NOT public.has_tenant_admin_authority(v_actor, p_tenant_id) THEN
      RAISE EXCEPTION 'Tenant Nearby Area List creation requires authority for the owning Tenant.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Nearby Area List scope must be shared_public or tenant_specific.';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nearby Area List name is required.';
  END IF;

  INSERT INTO public.nearby_area_lists (
    name, description, scope, tenant_id, created_by_auth_user_id
  ) VALUES (
    v_name, nullif(btrim(p_description), ''), p_scope, p_tenant_id, v_actor
  )
  RETURNING * INTO v_list;

  INSERT INTO public.nearby_area_list_command_audit (
    area_list_id, action, actor_auth_user_id, after_state
  ) VALUES (
    v_list.id,
    'area_list_created',
    v_actor,
    jsonb_build_object(
      'id', v_list.id,
      'name', v_list.name,
      'description', v_list.description,
      'scope', v_list.scope,
      'tenant_id', v_list.tenant_id,
      'is_active', v_list.is_active
    )
  );

  RETURN v_list;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_nearby_area_list(
  p_area_list_id uuid,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS public.nearby_area_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.nearby_area_lists%ROWTYPE;
  v_after public.nearby_area_lists%ROWTYPE;
  v_name text := nullif(btrim(p_name), '');
BEGIN
  v_before := public.assert_nearby_area_list_management_authority(p_area_list_id);

  IF v_before.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Retired Nearby Area Lists cannot be edited.';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nearby Area List name is required.';
  END IF;

  UPDATE public.nearby_area_lists
  SET name = v_name,
      description = nullif(btrim(p_description), '')
  WHERE id = p_area_list_id
  RETURNING * INTO v_after;

  INSERT INTO public.nearby_area_list_command_audit (
    area_list_id, action, actor_auth_user_id, before_state, after_state
  ) VALUES (
    v_after.id,
    'area_list_updated',
    v_actor,
    jsonb_build_object('name', v_before.name, 'description', v_before.description),
    jsonb_build_object('name', v_after.name, 'description', v_after.description)
  );

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retire_nearby_area_list(
  p_area_list_id uuid
)
RETURNS public.nearby_area_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.nearby_area_lists%ROWTYPE;
  v_after public.nearby_area_lists%ROWTYPE;
BEGIN
  v_before := public.assert_nearby_area_list_management_authority(p_area_list_id);

  UPDATE public.nearby_area_lists
  SET is_active = false
  WHERE id = p_area_list_id
  RETURNING * INTO v_after;

  IF v_before.is_active THEN
    INSERT INTO public.nearby_area_list_command_audit (
      area_list_id, action, actor_auth_user_id, before_state, after_state
    ) VALUES (
      v_after.id,
      'area_list_retired',
      v_actor,
      jsonb_build_object('is_active', true),
      jsonb_build_object('is_active', false)
    );
  END IF;

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_nearby_area_list_membership(
  p_area_list_id uuid,
  p_nearby_master_id uuid,
  p_is_active boolean
)
RETURNS public.nearby_area_list_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_list public.nearby_area_lists%ROWTYPE;
  v_place public.nearby_master%ROWTYPE;
  v_before public.nearby_area_list_members%ROWTYPE;
  v_after public.nearby_area_list_members%ROWTYPE;
  v_action text;
BEGIN
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'Membership activity state is required';
  END IF;

  v_list := public.assert_nearby_area_list_management_authority(p_area_list_id);

  IF v_list.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Retired Nearby Area Lists cannot change membership.';
  END IF;

  SELECT * INTO v_place
  FROM public.nearby_master
  WHERE id = p_nearby_master_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical Nearby place % not found.', p_nearby_master_id;
  END IF;

  IF v_place.status <> 'active' OR v_place.review_status <> 'approved' THEN
    RAISE EXCEPTION 'Only active, approved canonical Nearby places may be added to an Area List.';
  END IF;

  IF v_list.scope = 'tenant_specific'
     AND (v_place.scope = 'tenant_specific' AND v_place.tenant_id IS DISTINCT FROM v_list.tenant_id) THEN
    RAISE EXCEPTION 'A Tenant Nearby Area List cannot include another Tenant''s canonical place.';
  END IF;

  IF v_list.scope = 'shared_public' AND v_place.scope <> 'shared_public' THEN
    RAISE EXCEPTION 'A Shared Nearby Area List can include only Shared canonical places.';
  END IF;

  SELECT * INTO v_before
  FROM public.nearby_area_list_members
  WHERE area_list_id = p_area_list_id
    AND nearby_master_id = p_nearby_master_id;

  IF NOT FOUND THEN
    IF p_is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'A Nearby Area List membership must be added before it can be removed.';
    END IF;

    INSERT INTO public.nearby_area_list_members (
      area_list_id, nearby_master_id, is_active, created_by_auth_user_id
    ) VALUES (
      p_area_list_id, p_nearby_master_id, true, v_actor
    )
    RETURNING * INTO v_after;
    v_action := 'member_added';
  ELSIF v_before.is_active IS DISTINCT FROM p_is_active THEN
    UPDATE public.nearby_area_list_members
    SET is_active = p_is_active,
        updated_by_auth_user_id = v_actor,
        updated_at = now()
    WHERE id = v_before.id
    RETURNING * INTO v_after;
    v_action := CASE WHEN p_is_active THEN 'member_reactivated' ELSE 'member_removed' END;
  ELSE
    v_after := v_before;
  END IF;

  IF v_action IS NOT NULL THEN
    INSERT INTO public.nearby_area_list_command_audit (
      area_list_id, action, actor_auth_user_id, before_state, after_state
    ) VALUES (
      p_area_list_id,
      v_action,
      v_actor,
      CASE WHEN v_before.id IS NULL THEN NULL ELSE jsonb_build_object(
        'nearby_master_id', v_before.nearby_master_id,
        'is_active', v_before.is_active
      ) END,
      jsonb_build_object(
        'nearby_master_id', v_after.nearby_master_id,
        'is_active', v_after.is_active
      )
    );
  END IF;

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_google_place_id_to_nearby_master(
  p_nearby_master_id uuid,
  p_google_place_id text
)
RETURNS public.nearby_master_provider_identities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_place public.nearby_master%ROWTYPE;
  v_identity public.nearby_master_provider_identities%ROWTYPE;
  v_google_place_id text := nullif(btrim(p_google_place_id), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Google Place ID linkage requires authenticated authority.';
  END IF;

  IF v_google_place_id IS NULL THEN
    RAISE EXCEPTION 'An exact Google Place ID is required.';
  END IF;

  SELECT * INTO v_place
  FROM public.nearby_master
  WHERE id = p_nearby_master_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical Nearby place % not found.', p_nearby_master_id;
  END IF;

  IF v_place.scope = 'shared_public' THEN
    IF NOT public.has_platform_admin_authority(v_actor) THEN
      RAISE EXCEPTION 'Shared Google Place ID linkage requires Platform Administrator authority.';
    END IF;
  ELSIF v_place.scope = 'tenant_specific' THEN
    IF NOT public.has_tenant_admin_authority(v_actor, v_place.tenant_id) THEN
      RAISE EXCEPTION 'Tenant Google Place ID linkage requires authority for the owning Tenant.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Canonical Nearby place % has an invalid scope.', p_nearby_master_id;
  END IF;

  SELECT * INTO v_identity
  FROM public.nearby_master_provider_identities
  WHERE provider = 'google_places'
    AND provider_place_id = v_google_place_id;

  IF FOUND THEN
    IF v_identity.nearby_master_id = p_nearby_master_id THEN
      RETURN v_identity;
    END IF;
    RAISE EXCEPTION 'This exact Google Place ID is already linked to another canonical Nearby place.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.nearby_master_provider_identities
    WHERE nearby_master_id = p_nearby_master_id
      AND provider = 'google_places'
  ) THEN
    RAISE EXCEPTION 'This canonical Nearby place already has a Google Place ID linkage.';
  END IF;

  INSERT INTO public.nearby_master_provider_identities (
    nearby_master_id, provider, provider_place_id, created_by_auth_user_id
  ) VALUES (
    p_nearby_master_id, 'google_places', v_google_place_id, v_actor
  )
  RETURNING * INTO v_identity;

  INSERT INTO public.nearby_master_provider_identity_audit (
    provider_identity_id, nearby_master_id, action, actor_auth_user_id, after_state
  ) VALUES (
    v_identity.id,
    v_identity.nearby_master_id,
    'provider_identity_linked',
    v_actor,
    jsonb_build_object(
      'provider', v_identity.provider,
      'provider_place_id', v_identity.provider_place_id
    )
  );

  RETURN v_identity;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_nearby_area_lists_for_administration(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  scope text,
  tenant_id uuid,
  is_active boolean,
  can_manage boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_platform boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nearby Area List administration requires authenticated authority.';
  END IF;

  v_platform := public.has_platform_admin_authority(v_actor);

  IF p_tenant_id IS NULL THEN
    IF NOT v_platform THEN
      RAISE EXCEPTION 'Select an authorized Tenant to view Nearby Area Lists.';
    END IF;

    RETURN QUERY
    SELECT al.id, al.name, al.description, al.scope, al.tenant_id, al.is_active, true
    FROM public.nearby_area_lists AS al
    WHERE al.scope = 'shared_public'
    ORDER BY al.name;
    RETURN;
  END IF;

  IF NOT public.has_tenant_admin_authority(v_actor, p_tenant_id) THEN
    RAISE EXCEPTION 'Nearby Area List administration requires authority for the selected Tenant.';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.name,
    al.description,
    al.scope,
    al.tenant_id,
    al.is_active,
    (v_platform OR al.scope = 'tenant_specific') AS can_manage
  FROM public.nearby_area_lists AS al
  WHERE al.scope = 'shared_public'
     OR (al.scope = 'tenant_specific' AND al.tenant_id = p_tenant_id)
  ORDER BY al.scope, al.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_nearby_area_list_members_for_administration(
  p_area_list_id uuid
)
RETURNS TABLE (
  membership_id uuid,
  nearby_master_id uuid,
  name text,
  category_id uuid,
  category_label text,
  is_active boolean,
  google_place_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_list public.nearby_area_lists%ROWTYPE;
BEGIN
  v_list := public.assert_nearby_area_list_management_authority(p_area_list_id);

  RETURN QUERY
  SELECT
    m.id,
    nm.id,
    nm.name,
    nm.category_id,
    pc.label,
    m.is_active,
    pi.provider_place_id
  FROM public.nearby_area_list_members AS m
  JOIN public.nearby_master AS nm ON nm.id = m.nearby_master_id
  LEFT JOIN public.place_categories AS pc ON pc.id = nm.category_id
  LEFT JOIN public.nearby_master_provider_identities AS pi
    ON pi.nearby_master_id = nm.id
   AND pi.provider = 'google_places'
  WHERE m.area_list_id = v_list.id
  ORDER BY m.is_active DESC, nm.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_nearby_master_places_for_area_list(
  p_area_list_id uuid
)
RETURNS TABLE (
  nearby_master_id uuid,
  name text,
  category_id uuid,
  category_label text,
  scope text,
  tenant_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_list public.nearby_area_lists%ROWTYPE;
BEGIN
  v_list := public.assert_nearby_area_list_management_authority(p_area_list_id);

  RETURN QUERY
  SELECT nm.id, nm.name, nm.category_id, pc.label, nm.scope, nm.tenant_id
  FROM public.nearby_master AS nm
  LEFT JOIN public.place_categories AS pc ON pc.id = nm.category_id
  WHERE nm.status = 'active'
    AND nm.review_status = 'approved'
    AND (
      (v_list.scope = 'shared_public' AND nm.scope = 'shared_public')
      OR (
        v_list.scope = 'tenant_specific'
        AND (nm.scope = 'shared_public' OR nm.tenant_id = v_list.tenant_id)
      )
    )
  ORDER BY nm.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_nearby_area_lists_for_event_application(
  p_event_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  scope text,
  tenant_id uuid,
  uncategorized_member_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_tenant_id uuid;
BEGIN
  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'Nearby Area List application requires event.nearby.manage authority.';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  SELECT tenant_id INTO v_event_tenant_id
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found.', p_event_id;
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.name,
    al.description,
    al.scope,
    al.tenant_id,
    count(*) FILTER (WHERE nm.category_id IS NULL)::integer
  FROM public.nearby_area_lists AS al
  JOIN public.nearby_area_list_members AS m
    ON m.area_list_id = al.id
   AND m.is_active
  JOIN public.nearby_master AS nm
    ON nm.id = m.nearby_master_id
   AND nm.status = 'active'
   AND nm.review_status = 'approved'
  WHERE al.is_active
    AND (
      al.scope = 'shared_public'
      OR (al.scope = 'tenant_specific' AND al.tenant_id = v_event_tenant_id)
    )
  GROUP BY al.id
  ORDER BY al.scope, al.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_nearby_area_list_event_application(
  p_event_id uuid,
  p_area_list_id uuid
)
RETURNS TABLE (
  category_id uuid,
  category_label text,
  member_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_tenant_id uuid;
  v_list public.nearby_area_lists%ROWTYPE;
BEGIN
  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'Nearby Area List application requires event.nearby.manage authority.';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  SELECT tenant_id INTO v_event_tenant_id FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found.', p_event_id;
  END IF;

  SELECT * INTO v_list FROM public.nearby_area_lists WHERE id = p_area_list_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Nearby Area List % not found.', p_area_list_id;
  END IF;

  IF v_list.scope = 'tenant_specific' AND v_list.tenant_id IS DISTINCT FROM v_event_tenant_id THEN
    RAISE EXCEPTION 'This Nearby Area List is not available to the Event Tenant.';
  END IF;

  RETURN QUERY
  SELECT nm.category_id, pc.label, count(*)::integer
  FROM public.nearby_area_list_members AS m
  JOIN public.nearby_master AS nm
    ON nm.id = m.nearby_master_id
   AND nm.status = 'active'
   AND nm.review_status = 'approved'
  JOIN public.place_categories AS pc
    ON pc.id = nm.category_id
   AND pc.is_active
  WHERE m.area_list_id = v_list.id
    AND m.is_active
  GROUP BY nm.category_id, pc.label
  ORDER BY pc.label;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_nearby_area_list_to_event(
  p_event_id uuid,
  p_area_list_id uuid,
  p_category_ids uuid[]
)
RETURNS TABLE (
  inserted_count integer,
  already_associated_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_event_tenant_id uuid;
  v_list public.nearby_area_lists%ROWTYPE;
  v_place_ids uuid[];
  v_selected_count integer;
  v_existing_count integer;
  v_place_id uuid;
BEGIN
  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'Nearby Area List application requires event.nearby.manage authority.';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  SELECT tenant_id INTO v_event_tenant_id
  FROM public.events
  WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found.', p_event_id;
  END IF;

  SELECT * INTO v_list
  FROM public.nearby_area_lists
  WHERE id = p_area_list_id
    AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Nearby Area List % not found.', p_area_list_id;
  END IF;

  IF v_list.scope = 'tenant_specific' AND v_list.tenant_id IS DISTINCT FROM v_event_tenant_id THEN
    RAISE EXCEPTION 'This Nearby Area List is not available to the Event Tenant.';
  END IF;

  IF coalesce(cardinality(p_category_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one canonical Nearby category to apply.';
  END IF;

  IF cardinality(p_category_ids) <> (
    SELECT count(DISTINCT category_id)::integer FROM unnest(p_category_ids) AS selected(category_id)
  ) THEN
    RAISE EXCEPTION 'Selected Nearby categories must be unique.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_category_ids) AS selected(category_id)
    LEFT JOIN public.place_categories AS pc
      ON pc.id = selected.category_id
     AND pc.is_active
    WHERE pc.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every selected Nearby category must be active and canonical.';
  END IF;

  SELECT coalesce(array_agg(nm.id ORDER BY nm.id), ARRAY[]::uuid[])
    INTO v_place_ids
  FROM public.nearby_area_list_members AS m
  JOIN public.nearby_master AS nm
    ON nm.id = m.nearby_master_id
   AND nm.status = 'active'
   AND nm.review_status = 'approved'
  WHERE m.area_list_id = v_list.id
    AND m.is_active
    AND nm.category_id = ANY (p_category_ids)
    AND (
      nm.scope = 'shared_public'
      OR (nm.scope = 'tenant_specific' AND nm.tenant_id = v_event_tenant_id)
    );

  v_selected_count := cardinality(v_place_ids);

  IF v_selected_count = 0 THEN
    RAISE EXCEPTION 'The Nearby Area List has no active, approved members in the selected categories.';
  END IF;

  IF (
    SELECT count(DISTINCT nm.category_id)::integer
    FROM public.nearby_area_list_members AS m
    JOIN public.nearby_master AS nm
      ON nm.id = m.nearby_master_id
     AND nm.status = 'active'
     AND nm.review_status = 'approved'
    WHERE m.area_list_id = v_list.id
      AND m.is_active
      AND nm.category_id = ANY (p_category_ids)
      AND (
        nm.scope = 'shared_public'
        OR (nm.scope = 'tenant_specific' AND nm.tenant_id = v_event_tenant_id)
      )
  ) <> cardinality(p_category_ids) THEN
    RAISE EXCEPTION 'The Nearby Area List does not represent every selected category with an active, approved canonical place.';
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.event_nearby_places
  WHERE event_id = p_event_id
    AND source_master_id = ANY (v_place_ids);

  FOREACH v_place_id IN ARRAY v_place_ids LOOP
    PERFORM public.associate_nearby_master_place_with_event(p_event_id, v_place_id);
  END LOOP;

  inserted_count := v_selected_count - v_existing_count;
  already_associated_count := v_existing_count;

  INSERT INTO public.nearby_area_list_application_audit (
    area_list_id,
    event_id,
    actor_auth_user_id,
    selected_category_ids,
    inserted_count,
    already_associated_count
  ) VALUES (
    v_list.id,
    p_event_id,
    v_actor,
    p_category_ids,
    inserted_count,
    already_associated_count
  );

  RETURN NEXT;
END;
$function$;

ALTER FUNCTION public.assert_nearby_area_list_management_authority(uuid) OWNER TO postgres;
ALTER FUNCTION public.create_nearby_area_list(text, uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.update_nearby_area_list(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.retire_nearby_area_list(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_nearby_area_list_membership(uuid, uuid, boolean) OWNER TO postgres;
ALTER FUNCTION public.link_google_place_id_to_nearby_master(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.list_nearby_area_lists_for_administration(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_nearby_area_list_members_for_administration(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_nearby_master_places_for_area_list(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_nearby_area_lists_for_event_application(uuid) OWNER TO postgres;
ALTER FUNCTION public.preview_nearby_area_list_event_application(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.apply_nearby_area_list_to_event(uuid, uuid, uuid[]) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_nearby_area_list_management_authority(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_nearby_area_list(text, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_nearby_area_list(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retire_nearby_area_list(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_nearby_area_list_membership(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.link_google_place_id_to_nearby_master(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_nearby_area_lists_for_administration(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_nearby_area_list_members_for_administration(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_nearby_master_places_for_area_list(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_nearby_area_lists_for_event_application(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_nearby_area_list_event_application(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_nearby_area_list_to_event(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_nearby_area_list(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_nearby_area_list(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retire_nearby_area_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_nearby_area_list_membership(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_google_place_id_to_nearby_master(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nearby_area_lists_for_administration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nearby_area_list_members_for_administration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nearby_master_places_for_area_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_nearby_area_lists_for_event_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_nearby_area_list_event_application(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_nearby_area_list_to_event(uuid, uuid, uuid[]) TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
