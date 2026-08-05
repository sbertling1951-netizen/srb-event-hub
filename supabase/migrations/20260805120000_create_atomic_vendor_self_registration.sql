-- Replace the live, ungoverned vendor self-registration Person-resolution
-- path (lib/server/personIdentity.ts's resolveOrCreatePersonForAuthUser --
-- a raw upsert with no evidence search, no ambiguity classification, and no
-- audit trail) with one atomic, postgres-owned SECURITY DEFINER RPC that
-- reuses the existing private governed resolver, public.resolve_vendor_
-- person_identity, exactly once -- mirroring the pattern already proven by
-- public.activate_vendor_invitation
-- (20260801120300_create_atomic_vendor_invitation_activation.sql) for the
-- sibling invitation-activation context.
--
-- resolve_vendor_person_identity is REVOKE ALL FROM PUBLIC, anon,
-- authenticated, service_role -- only its owner, postgres, may call it, and
-- only from inside another postgres-owned SECURITY DEFINER function
-- (verified empirically this session: a service-role session attempting to
-- call it directly receives "permission denied for function
-- resolve_vendor_person_identity"). This migration adds the missing trusted
-- door into that resolver for the self-registration context; it does not
-- change the resolver itself.
--
-- Concurrency: a transaction-scoped advisory lock, keyed deterministically
-- to p_auth_user_id via hashtextextended, serializes concurrent
-- self-registration attempts for the same authenticated user. No row exists
-- to lock via SELECT ... FOR UPDATE on a first-time registration, so an
-- advisory lock is used instead -- released automatically at COMMIT or
-- ROLLBACK, with no table and no persistent lock record. This lock is
-- acquired only here; it is not taken by activate_vendor_invitation or any
-- other pathway, so it never blocks this Person from separately receiving
-- governed access to another vendor organization through invitation or any
-- other accepted mechanism.
--
-- No unique index is added to vendor_org_access. The "at most one active
-- vendor org via self-registration" rule enforced below is this operation's
-- own idempotency behavior, not a platform-wide invariant -- a Person may
-- legitimately hold active access to more than one vendor organization
-- through separately governed pathways (e.g. invitation), and this
-- migration must not, and does not, prevent that.

CREATE FUNCTION public.register_vendor_self(
  p_auth_user_id uuid,
  p_business_name text,
  p_verified_auth_email text DEFAULT NULL,
  p_verified_auth_phone text DEFAULT NULL,
  p_display_first_name text DEFAULT NULL,
  p_display_last_name text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_business_description text DEFAULT NULL,
  p_preferred_contact_method text DEFAULT 'email'
)
RETURNS TABLE(
  outcome text,
  vendor_id uuid,
  vendor_name text,
  access_id uuid,
  person_id uuid,
  resolution_audit_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_existing_vendor_id uuid;
  v_existing_access_id uuid;
  v_resolution_outcome text;
  v_person_id uuid;
  v_resolution_audit_id uuid;
  v_vendor_id uuid;
  v_vendor_name text;
  v_contact_id uuid;
  v_access_id uuid;
  v_normalized_business_name text;
  v_normalized_preferred_method text;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_normalized_business_name := nullif(btrim(p_business_name), '');
  IF v_normalized_business_name IS NULL THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- Transaction-scoped advisory lock derived from the complete UUID value.
  -- hashtextextended(text, seed) returns a 64-bit hash suitable for
  -- pg_advisory_xact_lock(bigint), with negligible collision risk for this
  -- purpose; a rare collision only causes two unrelated auth users to
  -- briefly serialize against each other, never an incorrect outcome.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text, 0));

  -- Idempotency check, inside the lock, pathway-agnostic: matches any
  -- currently active access this Person holds however it was created, and
  -- never creates a second vendor organization through self-registration.
  SELECT voa.vendor_id, voa.id
    INTO v_existing_vendor_id, v_existing_access_id
  FROM public.vendor_org_access AS voa
  WHERE voa.auth_user_id = p_auth_user_id
    AND voa.status = 'active'
  ORDER BY voa.created_at ASC
  LIMIT 1;

  IF v_existing_vendor_id IS NOT NULL THEN
    SELECT v.business_name
      INTO v_vendor_name
    FROM public.vendors AS v
    WHERE v.id = v_existing_vendor_id;

    RETURN QUERY
    SELECT
      'already_registered'::text,
      v_existing_vendor_id,
      v_vendor_name,
      v_existing_access_id,
      NULL::uuid,
      NULL::uuid;
    RETURN;
  END IF;

  -- Reuse the deployed governed resolver exactly once. This function and
  -- the resolver execute in one PostgreSQL transaction, so any later
  -- exception rolls back Person creation/linking and its resolution audit
  -- together with the vendor/contact/access writes below. Verified auth
  -- email/phone are the only identity evidence passed here; submitted
  -- contact email/phone are never passed to this call.
  SELECT
    resolution.outcome,
    resolution.person_id,
    resolution.audit_id
    INTO v_resolution_outcome, v_person_id, v_resolution_audit_id
  FROM public.resolve_vendor_person_identity(
    'vendor_self_registration',
    p_auth_user_id,
    p_verified_auth_email,
    p_verified_auth_phone,
    NULL,
    p_display_first_name,
    p_display_last_name
  ) AS resolution;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Governed Vendor Person resolution returned no result for self-registration';
  END IF;

  IF v_resolution_outcome IN ('needs_confirmation', 'ambiguous', 'invalid_existing_link') THEN
    RETURN QUERY
    SELECT
      v_resolution_outcome,
      NULL::uuid,
      NULL::text,
      NULL::uuid,
      NULL::uuid,
      v_resolution_audit_id;
    RETURN;
  END IF;

  IF v_resolution_outcome NOT IN ('resolved_existing', 'created_new')
    OR v_person_id IS NULL THEN
    RETURN QUERY
    SELECT 'error'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, v_resolution_audit_id;
    RETURN;
  END IF;

  v_normalized_preferred_method := CASE
    WHEN p_preferred_contact_method IN ('email', 'phone', 'text') THEN p_preferred_contact_method
    ELSE 'email'
  END;

  -- Vendor/contact/access writes use only the contact-info parameters below
  -- -- never p_verified_auth_email / p_verified_auth_phone, which were
  -- already consumed exclusively by resolve_vendor_person_identity above.
  INSERT INTO public.vendors (
    business_name,
    name,
    contact_name,
    email,
    phone,
    website,
    business_description,
    preferred_contact_method,
    is_active
  )
  VALUES (
    v_normalized_business_name,
    v_normalized_business_name,
    nullif(btrim(coalesce(p_contact_name, '')), ''),
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_contact_phone, '')), ''),
    nullif(btrim(coalesce(p_website, '')), ''),
    nullif(btrim(coalesce(p_business_description, '')), ''),
    v_normalized_preferred_method,
    true
  )
  RETURNING id, business_name INTO v_vendor_id, v_vendor_name;

  INSERT INTO public.vendor_contacts (
    vendor_id,
    person_id,
    first_name,
    last_name,
    email,
    mobile_phone,
    role_title,
    is_primary,
    status
  )
  VALUES (
    v_vendor_id,
    v_person_id,
    p_display_first_name,
    p_display_last_name,
    nullif(btrim(coalesce(p_contact_email, '')), ''),
    nullif(btrim(coalesce(p_contact_phone, '')), ''),
    'Owner',
    true,
    'active'
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO public.vendor_org_access (
    vendor_id,
    vendor_contact_id,
    person_id,
    auth_user_id,
    invitation_email,
    access_role,
    status,
    invited_at,
    accepted_at
  )
  VALUES (
    v_vendor_id,
    v_contact_id,
    v_person_id,
    p_auth_user_id,
    coalesce(
      p_verified_auth_email,
      nullif(btrim(coalesce(p_contact_email, '')), ''),
      ''
    ),
    'vendor_admin',
    'active',
    now(),
    now()
  )
  RETURNING id INTO v_access_id;

  RETURN QUERY
  SELECT
    'registered'::text,
    v_vendor_id,
    v_vendor_name,
    v_access_id,
    v_person_id,
    v_resolution_audit_id;
END;
$$;

ALTER FUNCTION public.register_vendor_self(uuid, text, text, text, text, text, text, text, text, text, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.register_vendor_self(uuid, text, text, text, text, text, text, text, text, text, text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_vendor_self(uuid, text, text, text, text, text, text, text, text, text, text, text)
FROM anon;
REVOKE ALL ON FUNCTION public.register_vendor_self(uuid, text, text, text, text, text, text, text, text, text, text, text)
FROM authenticated;

GRANT EXECUTE ON FUNCTION public.register_vendor_self(uuid, text, text, text, text, text, text, text, text, text, text, text)
TO service_role;
