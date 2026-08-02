CREATE TABLE public.person_resolution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_context text NOT NULL CHECK (
    request_context IN ('vendor_self_registration', 'vendor_invitation_activation')
  ),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  invitation_access_id uuid,
  outcome text NOT NULL CHECK (
    outcome IN (
      'resolved_existing',
      'created_new',
      'needs_confirmation',
      'ambiguous',
      'invalid_existing_link',
      'error'
    )
  ),
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  canonical_person_candidate_count integer NOT NULL CHECK (
    canonical_person_candidate_count >= 0
  ),
  unbridged_attendee_candidate_count integer NOT NULL CHECK (
    unbridged_attendee_candidate_count >= 0
  ),
  unlinked_vendor_contact_candidate_count integer NOT NULL CHECK (
    unlinked_vendor_contact_candidate_count >= 0
  ),
  evidence_status_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  creation_basis text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.person_resolution_audit
  OWNER TO postgres;

CREATE INDEX person_resolution_audit_auth_user_id_created_at_idx
  ON public.person_resolution_audit (auth_user_id, created_at DESC);

CREATE INDEX person_resolution_audit_invitation_access_id_idx
  ON public.person_resolution_audit (invitation_access_id)
  WHERE invitation_access_id IS NOT NULL;

ALTER TABLE public.person_resolution_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.person_resolution_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.person_resolution_audit FROM anon;
REVOKE ALL ON TABLE public.person_resolution_audit FROM authenticated;
REVOKE ALL ON TABLE public.person_resolution_audit FROM service_role;

CREATE FUNCTION public.resolve_vendor_person_identity(
  p_request_context text,
  p_auth_user_id uuid,
  p_verified_auth_email text DEFAULT NULL,
  p_verified_auth_phone text DEFAULT NULL,
  p_invitation_access_id uuid DEFAULT NULL,
  p_display_first_name text DEFAULT NULL,
  p_display_last_name text DEFAULT NULL
)
RETURNS TABLE(
  outcome text,
  person_id uuid,
  audit_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_normalized_email text;
  v_normalized_phone text;
  v_auth_link_count integer;
  v_valid_auth_person_count integer;
  v_existing_person_id uuid;
  v_invitation_count integer;
  v_person_candidate_count integer;
  v_attendee_candidate_count integer;
  v_vendor_contact_candidate_count integer;
  v_candidate_category_count integer;
  v_disputed_identifier_count integer;
  v_retired_identifier_count integer;
  v_audit_id uuid;
  v_created_person_id uuid;
  v_outcome text;
  v_creation_basis text;
BEGIN
  IF p_request_context NOT IN (
    'vendor_self_registration',
    'vendor_invitation_activation'
  ) OR p_auth_user_id IS NULL THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_normalized_email := nullif(lower(btrim(p_verified_auth_email)), '');
  v_normalized_phone := regexp_replace(
    coalesce(p_verified_auth_phone, ''),
    '[^0-9]',
    '',
    'g'
  );

  IF length(v_normalized_phone) = 11
    AND left(v_normalized_phone, 1) = '1' THEN
    v_normalized_phone := substring(v_normalized_phone FROM 2);
  END IF;

  v_normalized_phone := nullif(v_normalized_phone, '');

  SELECT
    count(*),
    count(*) FILTER (
      WHERE paa.status = 'active'
        AND p.status = 'active'
    ),
    min(paa.person_id) FILTER (
      WHERE paa.status = 'active'
        AND p.status = 'active'
    )
  INTO v_auth_link_count, v_valid_auth_person_count, v_existing_person_id
  FROM public.person_auth_accounts AS paa
  JOIN public.people AS p
    ON p.id = paa.person_id
  WHERE paa.auth_user_id = p_auth_user_id;

  IF v_auth_link_count > 0 THEN
    IF v_auth_link_count = 1 AND v_valid_auth_person_count = 1 THEN
      INSERT INTO public.person_resolution_audit (
        request_context,
        auth_user_id,
        invitation_access_id,
        outcome,
        person_id,
        canonical_person_candidate_count,
        unbridged_attendee_candidate_count,
        unlinked_vendor_contact_candidate_count,
        evidence_status_summary,
        creation_basis
      )
      VALUES (
        p_request_context,
        p_auth_user_id,
        p_invitation_access_id,
        'resolved_existing',
        v_existing_person_id,
        0,
        0,
        0,
        jsonb_build_object('exact_auth_link', 'active'),
        'exact_active_auth_link'
      )
      RETURNING id INTO v_audit_id;

      RETURN QUERY SELECT 'resolved_existing'::text, v_existing_person_id, v_audit_id;
      RETURN;
    END IF;

    INSERT INTO public.person_resolution_audit (
      request_context,
      auth_user_id,
      invitation_access_id,
      outcome,
      canonical_person_candidate_count,
      unbridged_attendee_candidate_count,
      unlinked_vendor_contact_candidate_count,
      evidence_status_summary
    )
    VALUES (
      p_request_context,
      p_auth_user_id,
      p_invitation_access_id,
      'invalid_existing_link',
      0,
      0,
      0,
      jsonb_build_object('exact_auth_link_row_count', v_auth_link_count)
    )
    RETURNING id INTO v_audit_id;

    RETURN QUERY SELECT 'invalid_existing_link'::text, NULL::uuid, v_audit_id;
    RETURN;
  END IF;

  IF p_invitation_access_id IS NOT NULL THEN
    SELECT count(*)
      INTO v_invitation_count
    FROM public.vendor_org_access AS voa
    WHERE voa.id = p_invitation_access_id
      AND voa.auth_user_id = p_auth_user_id
      AND voa.status = 'pending';

    IF v_invitation_count <> 1 THEN
      INSERT INTO public.person_resolution_audit (
        request_context,
        auth_user_id,
        invitation_access_id,
        outcome,
        canonical_person_candidate_count,
        unbridged_attendee_candidate_count,
        unlinked_vendor_contact_candidate_count,
        evidence_status_summary
      )
      VALUES (
        p_request_context,
        p_auth_user_id,
        p_invitation_access_id,
        'invalid_existing_link',
        0,
        0,
        0,
        jsonb_build_object('invitation_context', 'invalid_or_not_pending')
      )
      RETURNING id INTO v_audit_id;

      RETURN QUERY SELECT 'invalid_existing_link'::text, NULL::uuid, v_audit_id;
      RETURN;
    END IF;
  END IF;

  SELECT count(*)
    INTO v_person_candidate_count
  FROM public.people AS p
  WHERE p.status = 'active'
    AND (
      EXISTS (
        SELECT 1
        FROM public.person_identifiers AS pi
        WHERE pi.person_id = p.id
          AND pi.is_current = true
          AND pi.verification_status IN (
            'unverified',
            'observed',
            'user_confirmed',
            'system_verified'
          )
          AND (
            (v_normalized_email IS NOT NULL
              AND pi.identifier_type = 'email'
              AND pi.normalized_value = v_normalized_email)
            OR (v_normalized_phone IS NOT NULL
              AND pi.identifier_type = 'phone'
              AND pi.normalized_value = v_normalized_phone)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.vendor_contacts AS vc
        WHERE vc.person_id = p.id
          AND vc.status = 'active'
          AND (
            (v_normalized_email IS NOT NULL
              AND lower(btrim(coalesce(vc.email, ''))) = v_normalized_email)
            OR (v_normalized_phone IS NOT NULL
              AND CASE
                WHEN length(regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone)
          )
      )
    );

  SELECT
    count(*) FILTER (WHERE pi.verification_status = 'disputed'),
    count(*) FILTER (WHERE pi.verification_status = 'retired')
  INTO v_disputed_identifier_count, v_retired_identifier_count
  FROM public.person_identifiers AS pi
  WHERE (
    (v_normalized_email IS NOT NULL
      AND pi.identifier_type = 'email'
      AND pi.normalized_value = v_normalized_email)
    OR (v_normalized_phone IS NOT NULL
      AND pi.identifier_type = 'phone'
      AND pi.normalized_value = v_normalized_phone)
  );

  SELECT count(DISTINCT a.id)
    INTO v_attendee_candidate_count
  FROM public.attendees AS a
  WHERE a.person_id IS NULL
    AND coalesce(a.is_active, true) = true
    AND (
      (v_normalized_email IS NOT NULL AND (
        lower(btrim(coalesce(a.email, ''))) = v_normalized_email
        OR lower(btrim(coalesce(a.copilot_email, ''))) = v_normalized_email
      ))
      OR (v_normalized_phone IS NOT NULL AND (
        CASE
          WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')
        END = v_normalized_phone
        OR CASE
          WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')
        END = v_normalized_phone
        OR CASE
          WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')
        END = v_normalized_phone
        OR CASE
          WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')
        END = v_normalized_phone
      ))
    );

  SELECT count(DISTINCT vc.id)
    INTO v_vendor_contact_candidate_count
  FROM public.vendor_contacts AS vc
  WHERE vc.status = 'active'
    AND vc.person_id IS NULL
    AND (
      (v_normalized_email IS NOT NULL
        AND lower(btrim(coalesce(vc.email, ''))) = v_normalized_email)
      OR (v_normalized_phone IS NOT NULL
        AND CASE
          WHEN length(regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(vc.mobile_phone, ''), '[^0-9]', '', 'g')
        END = v_normalized_phone)
    );

  v_candidate_category_count :=
    (CASE WHEN v_person_candidate_count > 0 THEN 1 ELSE 0 END)
    + (CASE WHEN v_attendee_candidate_count > 0 THEN 1 ELSE 0 END)
    + (CASE WHEN v_vendor_contact_candidate_count > 0 THEN 1 ELSE 0 END);

  IF v_disputed_identifier_count > 0 THEN
    v_outcome := 'ambiguous';
  ELSIF v_person_candidate_count = 0
    AND v_attendee_candidate_count = 0
    AND v_vendor_contact_candidate_count = 0 THEN
    BEGIN
      INSERT INTO public.people (
        display_first_name,
        display_last_name,
        status
      )
      VALUES (
        nullif(btrim(p_display_first_name), ''),
        nullif(btrim(p_display_last_name), ''),
        'active'
      )
      RETURNING id INTO v_created_person_id;

      INSERT INTO public.person_auth_accounts (
        person_id,
        auth_user_id,
        status,
        is_primary,
        verified_at
      )
      VALUES (
        v_created_person_id,
        p_auth_user_id,
        'active',
        true,
        now()
      );

      v_outcome := 'created_new';
      v_creation_basis := 'no_prior_identity_evidence_found';
    EXCEPTION
      WHEN unique_violation THEN
        SELECT
          count(*),
          count(*) FILTER (
            WHERE paa.status = 'active'
              AND p.status = 'active'
          ),
          min(paa.person_id) FILTER (
            WHERE paa.status = 'active'
              AND p.status = 'active'
          )
        INTO v_auth_link_count, v_valid_auth_person_count, v_existing_person_id
        FROM public.person_auth_accounts AS paa
        JOIN public.people AS p
          ON p.id = paa.person_id
        WHERE paa.auth_user_id = p_auth_user_id;

        IF v_auth_link_count = 1 AND v_valid_auth_person_count = 1 THEN
          v_created_person_id := v_existing_person_id;
          v_outcome := 'resolved_existing';
          v_creation_basis := 'concurrent_exact_active_auth_link';
        ELSE
          v_outcome := 'invalid_existing_link';
        END IF;
    END;
  ELSIF v_person_candidate_count = 1
    AND v_attendee_candidate_count = 0
    AND v_vendor_contact_candidate_count = 0
    AND v_candidate_category_count = 1 THEN
    v_outcome := 'needs_confirmation';
  ELSIF v_person_candidate_count = 0
    AND v_attendee_candidate_count = 1
    AND v_vendor_contact_candidate_count = 0
    AND v_candidate_category_count = 1 THEN
    v_outcome := 'needs_confirmation';
  ELSIF v_person_candidate_count = 0
    AND v_attendee_candidate_count = 0
    AND v_vendor_contact_candidate_count = 1
    AND v_candidate_category_count = 1 THEN
    v_outcome := 'needs_confirmation';
  ELSE
    v_outcome := 'ambiguous';
  END IF;

  INSERT INTO public.person_resolution_audit (
    request_context,
    auth_user_id,
    invitation_access_id,
    outcome,
    person_id,
    canonical_person_candidate_count,
    unbridged_attendee_candidate_count,
    unlinked_vendor_contact_candidate_count,
    evidence_status_summary,
    creation_basis
  )
  VALUES (
    p_request_context,
    p_auth_user_id,
    p_invitation_access_id,
    v_outcome,
    CASE WHEN v_outcome IN ('resolved_existing', 'created_new') THEN v_created_person_id END,
    v_person_candidate_count,
    v_attendee_candidate_count,
    v_vendor_contact_candidate_count,
    jsonb_build_object(
      'current_identifier_candidate_statuses', jsonb_build_array(
        'unverified',
        'observed',
        'user_confirmed',
        'system_verified'
      ),
      'matching_disputed_identifier_count', v_disputed_identifier_count,
      'matching_retired_identifier_count', v_retired_identifier_count,
      'invitation_context', CASE
        WHEN p_invitation_access_id IS NULL THEN 'not_supplied'
        ELSE 'pending_bound_without_explicit_person_provenance'
      END
    ),
    v_creation_basis
  )
  RETURNING id INTO v_audit_id;

  RETURN QUERY
  SELECT
    v_outcome,
    CASE WHEN v_outcome IN ('resolved_existing', 'created_new') THEN v_created_person_id END,
    v_audit_id;
END;
$$;

ALTER FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
FROM anon;
REVOKE ALL ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
TO service_role;
