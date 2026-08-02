-- A valid, locked Vendor invitation may establish a new independently
-- represented Person when history cannot be safely attributed. Candidate
-- evidence remains auditable; it is never selected as identity proof.
CREATE OR REPLACE FUNCTION public.resolve_vendor_person_identity(
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
  v_total_candidate_count integer;
  v_disputed_identifier_count integer;
  v_retired_identifier_count integer;
  v_person_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_attendee_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_vendor_contact_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_disputed_identifier_ids uuid[] := ARRAY[]::uuid[];
  v_identity_uncertainty_classifications jsonb := '[]'::jsonb;
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

  SELECT coalesce(array_agg(p.id ORDER BY p.id), ARRAY[]::uuid[])
    INTO v_person_candidate_ids
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

  SELECT coalesce(array_agg(DISTINCT pi.id ORDER BY pi.id), ARRAY[]::uuid[])
  INTO v_disputed_identifier_ids
  FROM public.person_identifiers AS pi
  WHERE pi.verification_status = 'disputed'
    AND (
      (v_normalized_email IS NOT NULL
        AND pi.identifier_type = 'email'
        AND pi.normalized_value = v_normalized_email)
      OR (v_normalized_phone IS NOT NULL
        AND pi.identifier_type = 'phone'
        AND pi.normalized_value = v_normalized_phone)
    );

  SELECT count(*)
    INTO v_retired_identifier_count
  FROM public.person_identifiers AS pi
  WHERE pi.verification_status = 'retired'
    AND (
      (v_normalized_email IS NOT NULL
        AND pi.identifier_type = 'email'
        AND pi.normalized_value = v_normalized_email)
      OR (v_normalized_phone IS NOT NULL
        AND pi.identifier_type = 'phone'
        AND pi.normalized_value = v_normalized_phone)
    );

  SELECT coalesce(array_agg(DISTINCT a.id ORDER BY a.id), ARRAY[]::uuid[])
    INTO v_attendee_candidate_ids
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

  SELECT coalesce(array_agg(DISTINCT vc.id ORDER BY vc.id), ARRAY[]::uuid[])
    INTO v_vendor_contact_candidate_ids
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

  v_person_candidate_count := cardinality(v_person_candidate_ids);
  v_attendee_candidate_count := cardinality(v_attendee_candidate_ids);
  v_vendor_contact_candidate_count := cardinality(v_vendor_contact_candidate_ids);
  v_disputed_identifier_count := cardinality(v_disputed_identifier_ids);
  v_total_candidate_count := v_person_candidate_count
    + v_attendee_candidate_count
    + v_vendor_contact_candidate_count;
  v_candidate_category_count :=
    (CASE WHEN v_person_candidate_count > 0 THEN 1 ELSE 0 END)
    + (CASE WHEN v_attendee_candidate_count > 0 THEN 1 ELSE 0 END)
    + (CASE WHEN v_vendor_contact_candidate_count > 0 THEN 1 ELSE 0 END);

  IF v_disputed_identifier_count > 0 THEN
    v_identity_uncertainty_classifications := v_identity_uncertainty_classifications
      || jsonb_build_array('disputed_identifier_evidence');
  END IF;

  IF v_total_candidate_count = 0 AND v_disputed_identifier_count = 0 THEN
    v_identity_uncertainty_classifications := v_identity_uncertainty_classifications
      || jsonb_build_array('no_prior_identity_evidence_found');
    v_creation_basis := 'no_prior_identity_evidence_found';
  ELSIF v_total_candidate_count = 1 THEN
    v_identity_uncertainty_classifications := v_identity_uncertainty_classifications
      || jsonb_build_array('one_plausible_candidate');
    v_creation_basis := CASE
      WHEN v_disputed_identifier_count > 0 THEN 'disputed_identifier_evidence'
      ELSE 'one_plausible_candidate'
    END;
  ELSE
    v_identity_uncertainty_classifications := v_identity_uncertainty_classifications
      || jsonb_build_array('multiple_plausible_candidates');
    v_creation_basis := CASE
      WHEN v_disputed_identifier_count > 0 THEN 'disputed_identifier_evidence'
      ELSE 'multiple_plausible_candidates'
    END;
  END IF;

  IF p_request_context = 'vendor_invitation_activation'
    OR (
      v_disputed_identifier_count = 0
      AND v_person_candidate_count = 0
      AND v_attendee_candidate_count = 0
      AND v_vendor_contact_candidate_count = 0
    ) THEN
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
          v_creation_basis := 'concurrent_exact_active_auth_link_after_' || v_creation_basis;
        ELSE
          v_outcome := 'invalid_existing_link';
        END IF;
    END;
  ELSIF v_disputed_identifier_count > 0 THEN
    v_outcome := 'ambiguous';
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
      'identity_uncertainty_classifications', v_identity_uncertainty_classifications,
      'candidate_set', jsonb_build_object(
        'canonical_person_ids', to_jsonb(v_person_candidate_ids),
        'unbridged_attendee_source_ids', to_jsonb(v_attendee_candidate_ids),
        'unlinked_vendor_contact_ids', to_jsonb(v_vendor_contact_candidate_ids),
        'disputed_person_identifier_ids', to_jsonb(v_disputed_identifier_ids),
        'canonical_person_candidate_count', v_person_candidate_count,
        'unbridged_attendee_candidate_count', v_attendee_candidate_count,
        'unlinked_vendor_contact_candidate_count', v_vendor_contact_candidate_count
      ),
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

-- Only the trusted SECURITY DEFINER activation function may invoke this
-- resolver. It runs as postgres and remains able to call the owned function.
REVOKE ALL ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
FROM anon;
REVOKE ALL ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
FROM authenticated;
REVOKE ALL ON FUNCTION public.resolve_vendor_person_identity(text, uuid, text, text, uuid, text, text)
FROM service_role;
