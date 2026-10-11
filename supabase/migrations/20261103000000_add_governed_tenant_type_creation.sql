-- Platform-owned organization classifications. Creation grants no authority.
BEGIN;

CREATE TABLE public.tenant_type_creation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_type_id uuid NOT NULL REFERENCES public.tenant_types(id),
  actor_auth_user_id uuid NOT NULL,
  actor_admin_user_id uuid NOT NULL REFERENCES public.admin_users(id),
  code text NOT NULL,
  label text NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_type_creation_audit OWNER TO postgres;
ALTER TABLE public.tenant_type_creation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_type_creation_audit FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prevent_tenant_type_creation_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $$ BEGIN RAISE EXCEPTION 'Tenant type creation audit is immutable.'; END $$;
CREATE TRIGGER tenant_type_creation_audit_immutable
BEFORE UPDATE OR DELETE ON public.tenant_type_creation_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_type_creation_audit_mutation();
REVOKE ALL ON FUNCTION public.prevent_tenant_type_creation_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_tenant_type(p_code text, p_label text, p_reason text DEFAULT NULL)
RETURNS public.tenant_types
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid;
  v_code text := lower(btrim(COALESCE(p_code, '')));
  v_label text := btrim(COALESCE(p_label, ''));
  v_result public.tenant_types;
BEGIN
  v_actor := public._require_platform_admin_actor();
  IF v_code !~ '^[a-z][a-z0-9_]*$' OR length(v_code) > 64 THEN
    RAISE EXCEPTION 'Type code must start with a letter and contain only lowercase letters, numbers, and underscores (up to 64 characters).';
  END IF;
  IF v_label = '' OR length(v_label) > 100 THEN
    RAISE EXCEPTION 'Type name is required and must be no more than 100 characters.';
  END IF;
  IF length(COALESCE(p_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Reason must be no more than 1000 characters.';
  END IF;
  -- Serialize catalog creation so differently coded duplicate names cannot
  -- race. Existing catalog data and constraints remain unchanged.
  LOCK TABLE public.tenant_types IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.tenant_types WHERE code = v_code OR lower(btrim(label)) = lower(v_label)) THEN
    RAISE EXCEPTION 'A tenant type with this code or name already exists.';
  END IF;
  INSERT INTO public.tenant_types(code, label) VALUES (v_code, v_label) RETURNING * INTO v_result;
  INSERT INTO public.tenant_type_creation_audit(tenant_type_id, actor_auth_user_id, actor_admin_user_id, code, label, reason)
  VALUES (v_result.id, auth.uid(), v_actor, v_code, v_label, NULLIF(btrim(p_reason), ''));
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.create_tenant_type(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_tenant_type(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_type(text, text, text) TO authenticated;
COMMIT;
