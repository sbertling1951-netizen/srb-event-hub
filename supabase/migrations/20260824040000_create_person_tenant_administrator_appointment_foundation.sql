-- Tenant T8: governed Person-backed Tenant Administrator appointment foundation.
--
-- This is a parallel, non-authoritative durable affiliation and history model.
-- public.admin_tenant_access remains the sole live Tenant-Admin authority source
-- until a separately accepted, parity-proven authority cutover.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE TABLE public.person_tenant_administrator_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  appointment_basis text NOT NULL DEFAULT 'platform_appointment'
    CHECK (appointment_basis = 'platform_appointment'),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT person_tenant_administrator_appointments_unique
    UNIQUE (person_id, tenant_id),
  CONSTRAINT person_tenant_administrator_appointments_lifecycle_check CHECK (
    (is_active = true AND revoked_at IS NULL)
    OR (is_active = false AND revoked_at IS NOT NULL)
  )
);

ALTER TABLE public.person_tenant_administrator_appointments OWNER TO postgres;

CREATE INDEX person_tenant_administrator_appointments_tenant_active_idx
  ON public.person_tenant_administrator_appointments (tenant_id, person_id)
  WHERE is_active = true;

CREATE INDEX person_tenant_administrator_appointments_person_idx
  ON public.person_tenant_administrator_appointments (person_id, tenant_id);

ALTER TABLE public.person_tenant_administrator_appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_tenant_administrator_appointments
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.person_tenant_administrator_appointment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES public.person_tenant_administrator_appointments(id)
    ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'appointed',
    'revoked',
    'reactivated',
    'unchanged'
  )),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_admin_user_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_tenant_administrator_appointment_audit_unchanged_check CHECK (
    appointment_id IS NOT NULL OR action = 'unchanged'
  )
);

ALTER TABLE public.person_tenant_administrator_appointment_audit OWNER TO postgres;

CREATE INDEX person_tenant_administrator_appointment_audit_tenant_idx
  ON public.person_tenant_administrator_appointment_audit (tenant_id, occurred_at DESC);

CREATE INDEX person_tenant_administrator_appointment_audit_appointment_idx
  ON public.person_tenant_administrator_appointment_audit (appointment_id, occurred_at DESC)
  WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_person_tenant_administrator_appointment_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'person_tenant_administrator_appointment_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_person_tenant_administrator_appointment_audit_mutation()
  OWNER TO postgres;

DROP TRIGGER IF EXISTS prevent_person_tenant_administrator_appointment_audit_mutation_trigger
  ON public.person_tenant_administrator_appointment_audit;

CREATE TRIGGER prevent_person_tenant_administrator_appointment_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.person_tenant_administrator_appointment_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_person_tenant_administrator_appointment_audit_mutation();

ALTER TABLE public.person_tenant_administrator_appointment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_tenant_administrator_appointment_audit
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_person_tenant_administrator_appointment(
  p_person_id uuid,
  p_tenant_id uuid,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_canonical_identity_count integer;
  v_before public.person_tenant_administrator_appointments%ROWTYPE;
  v_after public.person_tenant_administrator_appointments%ROWTYPE;
  v_action text;
  v_reason text;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'Person id is required.';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required.';
  END IF;

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'Appointment active status is required.';
  END IF;

  v_reason := nullif(btrim(p_reason), '');
  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Appointment reason must be 500 characters or fewer.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenants AS t
    WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  -- This is the exact canonical account -> Person eligibility chain. It
  -- deliberately does not use email, names, memberships, legacy assignment,
  -- or a copied Person id on admin_users. Any missing or non-singleton chain
  -- fails closed before an appointment can be created or transitioned.
  SELECT count(*)
    INTO v_canonical_identity_count
  FROM public.people AS p
  JOIN public.person_auth_accounts AS paa
    ON paa.person_id = p.id
   AND paa.status = 'active'
   AND paa.is_primary = true
  JOIN auth.users AS u ON u.id = paa.auth_user_id
  JOIN public.admin_users AS au
    ON au.user_id = u.id
   AND au.is_active = true
  WHERE p.id = p_person_id
    AND p.status = 'active';

  IF v_canonical_identity_count <> 1 THEN
    RAISE EXCEPTION 'Person does not have exactly one active canonical Administrator identity.';
  END IF;

  SELECT *
    INTO v_before
  FROM public.person_tenant_administrator_appointments AS ptaa
  WHERE ptaa.person_id = p_person_id
    AND ptaa.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND AND p_is_active THEN
    INSERT INTO public.person_tenant_administrator_appointments (
      person_id,
      tenant_id,
      is_active,
      appointment_basis
    ) VALUES (
      p_person_id,
      p_tenant_id,
      true,
      'platform_appointment'
    )
    RETURNING * INTO v_after;
    v_action := 'appointed';
  ELSIF NOT FOUND THEN
    v_action := 'unchanged';
  ELSIF v_before.is_active = p_is_active THEN
    v_after := v_before;
    v_action := 'unchanged';
  ELSIF p_is_active THEN
    UPDATE public.person_tenant_administrator_appointments
       SET is_active = true,
           activated_at = now(),
           revoked_at = NULL
     WHERE id = v_before.id
     RETURNING * INTO v_after;
    v_action := 'reactivated';
  ELSE
    UPDATE public.person_tenant_administrator_appointments
       SET is_active = false,
           revoked_at = now()
     WHERE id = v_before.id
     RETURNING * INTO v_after;
    v_action := 'revoked';
  END IF;

  INSERT INTO public.person_tenant_administrator_appointment_audit (
    appointment_id,
    person_id,
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    reason,
    before_state,
    after_state
  ) VALUES (
    v_after.id,
    p_person_id,
    p_tenant_id,
    v_action,
    auth.uid(),
    v_actor_admin_user_id,
    v_reason,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    CASE WHEN v_after.id IS NULL THEN NULL ELSE to_jsonb(v_after) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_person_tenant_administrator_appointments_for_administration(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  person_id uuid,
  tenant_id uuid,
  is_active boolean,
  appointment_basis text,
  created_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  IF p_tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    ptaa.id,
    ptaa.person_id,
    ptaa.tenant_id,
    ptaa.is_active,
    ptaa.appointment_basis,
    ptaa.created_at,
    ptaa.activated_at,
    ptaa.revoked_at
  FROM public.person_tenant_administrator_appointments AS ptaa
  WHERE p_tenant_id IS NULL OR ptaa.tenant_id = p_tenant_id
  ORDER BY ptaa.tenant_id, ptaa.person_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(
  p_tenant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  appointment_id uuid,
  person_id uuid,
  tenant_id uuid,
  action text,
  actor_auth_user_id uuid,
  actor_admin_user_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  IF p_tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    ptaaa.id,
    ptaaa.appointment_id,
    ptaaa.person_id,
    ptaaa.tenant_id,
    ptaaa.action,
    ptaaa.actor_auth_user_id,
    ptaaa.actor_admin_user_id,
    ptaaa.reason,
    ptaaa.before_state,
    ptaaa.after_state,
    ptaaa.occurred_at
  FROM public.person_tenant_administrator_appointment_audit AS ptaaa
  WHERE p_tenant_id IS NULL OR ptaaa.tenant_id = p_tenant_id
  ORDER BY ptaaa.occurred_at DESC, ptaaa.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$function$;

ALTER FUNCTION public.set_person_tenant_administrator_appointment(uuid, uuid, boolean, text)
  OWNER TO postgres;
ALTER FUNCTION public.list_person_tenant_administrator_appointments_for_administration(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(uuid, integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_person_tenant_administrator_appointment(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_person_tenant_administrator_appointments_for_administration(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_person_tenant_administrator_appointment(uuid, uuid, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_person_tenant_administrator_appointments_for_administration(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_person_tenant_administrator_appointment_audit_for_administration(uuid, integer)
  TO authenticated;

COMMENT ON TABLE public.person_tenant_administrator_appointments IS
  'T8 parallel Person x Tenant Administrator affiliation. It grants no live authority until a separately accepted cutover.';
COMMENT ON TABLE public.person_tenant_administrator_appointment_audit IS
  'Immutable lifecycle evidence for the parallel T8 appointment substrate.';

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
