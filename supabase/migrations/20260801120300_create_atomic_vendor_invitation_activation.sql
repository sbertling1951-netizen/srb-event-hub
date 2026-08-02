-- Atomically resolve Person identity and activate exactly one pending Vendor
-- invitation. This is service-only; browser callers cannot execute it.
CREATE FUNCTION public.activate_vendor_invitation(
  p_auth_user_id uuid,
  p_verified_auth_email text DEFAULT NULL,
  p_verified_auth_phone text DEFAULT NULL,
  p_display_first_name text DEFAULT NULL,
  p_display_last_name text DEFAULT NULL
)
RETURNS TABLE(
  outcome text,
  person_id uuid,
  resolution_audit_id uuid,
  activated_access_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_pending_row record;
  v_pending_count integer := 0;
  v_access_id uuid;
  v_vendor_id uuid;
  v_vendor_contact_id uuid;
  v_contact_person_id uuid;
  v_resolution_outcome text;
  v_person_id uuid;
  v_resolution_audit_id uuid;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- Lock every currently pending row before deciding whether activation is
  -- unambiguous. Ordering is solely for stable lock acquisition, never row
  -- selection: the function activates only when this count is exactly one.
  FOR v_pending_row IN
    SELECT
      voa.id,
      voa.vendor_id,
      voa.vendor_contact_id
    FROM public.vendor_org_access AS voa
    WHERE voa.auth_user_id = p_auth_user_id
      AND voa.status = 'pending'
    ORDER BY voa.id
    FOR UPDATE
  LOOP
    v_pending_count := v_pending_count + 1;
    v_access_id := v_pending_row.id;
    v_vendor_id := v_pending_row.vendor_id;
    v_vendor_contact_id := v_pending_row.vendor_contact_id;
  END LOOP;

  IF v_pending_count = 0 THEN
    RETURN QUERY SELECT 'no_pending_invitation'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF v_pending_count <> 1 THEN
    RETURN QUERY SELECT 'ambiguous'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- The composite FK on vendor_org_access guarantees this contact belongs to
  -- the locked Vendor. Lock it before resolution so its Person link cannot
  -- change during this activation. A pre-existing link is not invitation
  -- provenance and is not overwritten by this primitive.
  SELECT vc.person_id
    INTO v_contact_person_id
  FROM public.vendor_contacts AS vc
  WHERE vc.id = v_vendor_contact_id
    AND vc.vendor_id = v_vendor_id
  FOR UPDATE;

  IF NOT FOUND OR v_contact_person_id IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid_existing_link'::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- Reuse the deployed governed resolver exactly once. The outer function and
  -- this call execute in one PostgreSQL transaction, so any later exception
  -- rolls back Person creation/linking and its resolution audit together with
  -- the contact and access writes below.
  SELECT
    resolution.outcome,
    resolution.person_id,
    resolution.audit_id
  INTO v_resolution_outcome, v_person_id, v_resolution_audit_id
  FROM public.resolve_vendor_person_identity(
    'vendor_invitation_activation',
    p_auth_user_id,
    p_verified_auth_email,
    p_verified_auth_phone,
    v_access_id,
    p_display_first_name,
    p_display_last_name
  ) AS resolution;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Governed Vendor Person resolution returned no result for the locked invitation';
  END IF;

  IF v_resolution_outcome = 'needs_confirmation'
    OR v_resolution_outcome = 'ambiguous'
    OR v_resolution_outcome = 'invalid_existing_link' THEN
    RETURN QUERY
    SELECT v_resolution_outcome, NULL::uuid, v_resolution_audit_id, NULL::uuid;
    RETURN;
  END IF;

  IF v_resolution_outcome NOT IN ('resolved_existing', 'created_new')
    OR v_person_id IS NULL THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, v_resolution_audit_id, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.vendor_contacts
  SET person_id = v_person_id
  WHERE id = v_vendor_contact_id
    AND vendor_id = v_vendor_id
    AND person_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Locked Vendor contact could not be linked during invitation activation';
  END IF;

  UPDATE public.vendor_org_access
  SET
    status = 'active',
    accepted_at = now(),
    person_id = v_person_id
  WHERE id = v_access_id
    AND auth_user_id = p_auth_user_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Locked pending Vendor invitation could not be activated';
  END IF;

  RETURN QUERY
  SELECT
    CASE v_resolution_outcome
      WHEN 'resolved_existing' THEN 'activated_existing_person'
      WHEN 'created_new' THEN 'activated_new_person'
    END,
    v_person_id,
    v_resolution_audit_id,
    v_access_id;
END;
$$;

ALTER FUNCTION public.activate_vendor_invitation(uuid, text, text, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.activate_vendor_invitation(uuid, text, text, text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_vendor_invitation(uuid, text, text, text, text)
FROM anon;
REVOKE ALL ON FUNCTION public.activate_vendor_invitation(uuid, text, text, text, text)
FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_vendor_invitation(uuid, text, text, text, text)
TO service_role;
