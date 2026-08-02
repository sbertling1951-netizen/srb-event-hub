-- Shared, read-only classification of an exact auth_user_id -> Person link.
-- Both resolve_member_account() and resolve_vendor_person_identity(...)
-- independently implemented this same fail-closed-on-ambiguity lookup; this
-- function is the one place it now lives. It performs no writes, creates no
-- Person, searches no identifiers/attendees/vendor contacts, writes no
-- audit record, and grants no relationship or authority -- it only answers
-- "does this exact auth user already have exactly one active linked
-- Person." Trusted, postgres-owned SECURITY DEFINER callers may invoke it
-- because they share its owner; it is not directly executable by any
-- browser or service role.
CREATE FUNCTION public.resolve_auth_person_link(
  p_auth_user_id uuid
)
RETURNS TABLE(
  status text,
  person_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_link_count integer;
  v_valid_count integer;
  v_person_id uuid;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN QUERY SELECT 'invalid_or_ambiguous'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE paa.status = 'active'
        AND p.status = 'active'
    )
  INTO v_link_count, v_valid_count
  FROM public.person_auth_accounts AS paa
  JOIN public.people AS p
    ON p.id = paa.person_id
  WHERE paa.auth_user_id = p_auth_user_id;

  IF v_link_count = 0 THEN
    RETURN QUERY SELECT 'no_link'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_link_count = 1 AND v_valid_count = 1 THEN
    SELECT paa.person_id
      INTO v_person_id
    FROM public.person_auth_accounts AS paa
    JOIN public.people AS p
      ON p.id = paa.person_id
    WHERE paa.auth_user_id = p_auth_user_id
      AND paa.status = 'active'
      AND p.status = 'active'
    LIMIT 1;

    RETURN QUERY SELECT 'resolved'::text, v_person_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'invalid_or_ambiguous'::text, NULL::uuid;
END;
$$;

ALTER FUNCTION public.resolve_auth_person_link(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_auth_person_link(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_auth_person_link(uuid)
FROM anon;
REVOKE ALL ON FUNCTION public.resolve_auth_person_link(uuid)
FROM authenticated;
REVOKE ALL ON FUNCTION public.resolve_auth_person_link(uuid)
FROM service_role;

-- Member resolution: identical signature, grants, return shape, filters,
-- and caller behavior. Only the inline ambiguity/validity lookup is
-- replaced with a call to the shared primitive; the DISTINCT-count-among-
-- active-rows approach this previously used and the shared primitive's
-- total-row-count approach are equivalent for every state the schema can
-- actually hold, since person_auth_accounts.auth_user_id is already
-- uniquely constrained -- at most one row can ever exist per auth user.
CREATE OR REPLACE FUNCTION public.resolve_member_account()
 RETURNS TABLE(attendee_id uuid, entry_id text, event_id uuid, email text, pilot_first text, pilot_last text, copilot_first text, copilot_last text, has_arrived boolean, event_name text, venue_name text, location text, start_date date, end_date date, lat numeric, lng numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_uid uuid;
    v_person_id uuid;
    v_link_status text;
BEGIN
    v_uid := auth.uid();

    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    ------------------------------------------------------------------
    -- Fail closed on ambiguous auth links. Never pick one of several
    -- distinct linked people via ORDER BY / LIMIT 1. Multiple active
    -- rows are only acceptable if they all resolve to the same
    -- person_id -- delegated to the shared, governed primitive.
    ------------------------------------------------------------------

    SELECT r.status, r.person_id
      INTO v_link_status, v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS r;

    IF v_link_status IS DISTINCT FROM 'resolved' THEN
        -- Covers both no_link and invalid_or_ambiguous. No distinction is
        -- surfaced to the caller, exactly as before.
        RETURN;
    END IF;

    ------------------------------------------------------------------
    -- Return only registrations belonging to this person, using the
    -- same event eligibility rules as verify_member_event_login (no
    -- attendees-level filter; event must be visible_to_members and
    -- active). No other person's data is reachable from this function,
    -- regardless of input, because v_person_id is derived entirely
    -- server-side from auth.uid() with ambiguity failed closed above.
    ------------------------------------------------------------------

    RETURN QUERY
    SELECT
        a.id,
        a.entry_id,
        a.event_id,
        a.email,
        a.pilot_first,
        a.pilot_last,
        a.copilot_first,
        a.copilot_last,
        a.has_arrived,
        e.name,
        e.venue_name,
        e.location,
        e.start_date,
        e.end_date,
        e.lat,
        e.lng
    FROM public.attendees a
    JOIN public.events e
      ON e.id = a.event_id
    WHERE a.person_id = v_person_id
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true
    ORDER BY e.start_date DESC NULLS LAST;

END;
$function$;

-- Vendor resolution: identical signature, grants, and every outcome
-- (resolved_existing / created_new / needs_confirmation / ambiguous /
-- invalid_existing_link / error), including the full candidate search,
-- evidence classification, creation, audit, and unique_violation
-- concurrency recovery. Only the two occurrences of the exact-link lookup
-- (the initial check, and the post-unique_violation recovery check) are
-- replaced with calls to the shared primitive; both already relied on the
-- same person_auth_accounts.auth_user_id uniqueness this primitive relies
-- on, and both already executed inline within this function's own
-- transaction, so calling the primitive here changes no transaction or
-- race behavior.
--
-- The exact_auth_link_row_count audit field previously reflected
-- v_auth_link_count at the point invalid_existing_link is raised from the
-- top-level check. Because person_auth_accounts.auth_user_id is uniquely
-- constrained, that branch (a row exists, but is not exactly one valid
-- active link) is only ever reachable with exactly one total row, so the
-- literal value recorded there is unchanged.
CREATE OR REPLACE FUNCTION public.resolve_vendor_person_identity(
  p_request_context text,
  p_auth_user_id uuid,
  p_verified_auth_email text DEFAULT NULL::text,
  p_verified_auth_phone text DEFAULT NULL::text,
  p_invitation_access_id uuid DEFAULT NULL::uuid,
  p_display_first_name text DEFAULT NULL::text,
  p_display_last_name text DEFAULT NULL::text
)
RETURNS TABLE(outcome text, person_id uuid, audit_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
DECLARE
  v_normalized_email text;
  v_normalized_phone text;
  v_link_status text;
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

  SELECT r.status, r.person_id
    INTO v_link_status, v_existing_person_id
  FROM public.resolve_auth_person_link(p_auth_user_id) AS r;

  IF v_link_status = 'resolved' THEN
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

  IF v_link_status = 'invalid_or_ambiguous' THEN
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
      jsonb_build_object('exact_auth_link_row_count', 1)
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
        SELECT r.status, r.person_id
          INTO v_link_status, v_existing_person_id
        FROM public.resolve_auth_person_link(p_auth_user_id) AS r;

        IF v_link_status = 'resolved' THEN
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
$function$;
