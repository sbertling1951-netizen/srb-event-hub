CREATE TABLE public.member_checkin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid NOT NULL,
  attendee_id uuid NOT NULL,
  authorization_basis text NOT NULL,
  actor_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  actor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  previous_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  CONSTRAINT member_checkin_audit_authorization_basis_check CHECK (
    authorization_basis IN ('authenticated', 'temporary')
  ),
  CONSTRAINT member_checkin_audit_actor_context_check CHECK (
    (authorization_basis = 'authenticated'
      AND actor_person_id IS NOT NULL
      AND actor_auth_user_id IS NOT NULL)
    OR (authorization_basis = 'temporary'
      AND actor_person_id IS NULL
      AND actor_auth_user_id IS NULL)
  ),
  CONSTRAINT member_checkin_audit_changed_fields_check CHECK (
    changed_fields <@ ARRAY[
      'has_arrived',
      'share_with_attendees',
      'assigned_site',
      'arrival_status'
    ]::text[]
  ),
  CONSTRAINT member_checkin_audit_previous_values_check CHECK (
    jsonb_typeof(previous_values) = 'object'
    AND previous_values ?& ARRAY[
      'has_arrived',
      'share_with_attendees',
      'assigned_site',
      'arrival_status'
    ]
    AND previous_values - ARRAY[
      'has_arrived',
      'share_with_attendees',
      'assigned_site',
      'arrival_status'
    ] = '{}'::jsonb
  ),
  CONSTRAINT member_checkin_audit_new_values_check CHECK (
    jsonb_typeof(new_values) = 'object'
    AND new_values ?& ARRAY[
      'has_arrived',
      'share_with_attendees',
      'assigned_site',
      'arrival_status'
    ]
    AND new_values - ARRAY[
      'has_arrived',
      'share_with_attendees',
      'assigned_site',
      'arrival_status'
    ] = '{}'::jsonb
  )
);

ALTER TABLE public.member_checkin_audit
  OWNER TO postgres;

CREATE INDEX member_checkin_audit_event_id_occurred_at_idx
  ON public.member_checkin_audit (event_id, occurred_at DESC);

CREATE INDEX member_checkin_audit_attendee_id_occurred_at_idx
  ON public.member_checkin_audit (attendee_id, occurred_at DESC);

ALTER TABLE public.member_checkin_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.member_checkin_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.member_checkin_audit FROM anon;
REVOKE ALL ON TABLE public.member_checkin_audit FROM authenticated;
REVOKE ALL ON TABLE public.member_checkin_audit FROM service_role;

COMMENT ON TABLE public.member_checkin_audit IS
  'Governed provenance for successful member self-check-in submissions. It stores operational context and approved field changes only, never temporary credentials.';

COMMENT ON COLUMN public.member_checkin_audit.event_id IS
  'Immutable Event provenance reference captured by the governed check-in function; it is not a lifecycle-enforcing foreign key.';

COMMENT ON COLUMN public.member_checkin_audit.attendee_id IS
  'Immutable attendee provenance reference captured by the governed check-in function; it is not a lifecycle-enforcing foreign key.';

CREATE OR REPLACE FUNCTION public.submit_member_checkin(
  p_event_id uuid,
  p_expected_attendee_id uuid,
  p_has_arrived boolean,
  p_share_with_attendees boolean,
  p_assigned_site text,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  assigned_site text,
  share_with_attendees boolean,
  has_arrived boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_person_count integer;
  v_person_ids uuid[];
  v_verified_attendee_id uuid;
  v_match_count integer;
  v_match_ids uuid[];
  v_identifier_is_email boolean;
  v_normalized_email text;
  v_normalized_phone text;
  v_normalized_site text;
  v_selected_master_map_id uuid;
  v_master_site_id uuid;
  v_parking_site_id uuid;
  v_parking_assignee_id uuid;
  v_authorization_basis text;
  v_previous_has_arrived boolean;
  v_previous_share_with_attendees boolean;
  v_previous_assigned_site text;
  v_previous_arrival_status text;
  v_updated_id uuid;
  v_updated_assigned_site text;
  v_updated_share_with_attendees boolean;
  v_updated_has_arrived boolean;
  v_updated_arrival_status text;
BEGIN
  IF p_event_id IS NULL
    OR p_expected_attendee_id IS NULL
    OR p_has_arrived IS NULL
    OR p_share_with_attendees IS NULL THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    v_authorization_basis := 'authenticated';

    SELECT count(DISTINCT paa.person_id), array_agg(DISTINCT paa.person_id)
      INTO v_person_count, v_person_ids
    FROM public.person_auth_accounts AS paa
    WHERE paa.auth_user_id = v_uid
      AND paa.status = 'active';

    IF v_person_count <> 1 THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_person_id := v_person_ids[1];

    IF NOT EXISTS (
      SELECT 1
      FROM public.people AS p
      WHERE p.id = v_person_id
        AND p.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    SELECT count(*)
      INTO v_match_count
    FROM public.attendees AS a
    JOIN public.events AS e
      ON e.id = a.event_id
    WHERE a.id = p_expected_attendee_id
      AND a.person_id = v_person_id
      AND a.event_id = p_event_id
      AND coalesce(a.is_active, true) = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true;

    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_verified_attendee_id := p_expected_attendee_id;
  ELSE
    v_authorization_basis := 'temporary';

    IF nullif(btrim(p_event_code), '') IS NULL
      OR nullif(btrim(p_registration_identifier), '') IS NULL THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_identifier_is_email := position('@' IN btrim(p_registration_identifier)) > 0;

    IF v_identifier_is_email THEN
      v_normalized_email := lower(btrim(p_registration_identifier));

      IF position('@' IN v_normalized_email) = 1
        OR position('@' IN v_normalized_email) = length(v_normalized_email) THEN
        RAISE EXCEPTION 'Member check-in verification failed.';
      END IF;
    ELSE
      v_normalized_phone := regexp_replace(
        btrim(p_registration_identifier),
        '[^0-9]',
        '',
        'g'
      );

      IF length(v_normalized_phone) = 11
        AND left(v_normalized_phone, 1) = '1' THEN
        v_normalized_phone := substring(v_normalized_phone FROM 2);
      END IF;

      IF v_normalized_phone = '' THEN
        RAISE EXCEPTION 'Member check-in verification failed.';
      END IF;
    END IF;

    WITH primary_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendees AS a
      JOIN public.events AS e
        ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND (
              lower(btrim(coalesce(a.email, ''))) = v_normalized_email
              OR lower(btrim(coalesce(a.copilot_email, ''))) = v_normalized_email
            )
          )
          OR (
            NOT v_identifier_is_email
            AND (
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
            )
          )
        )
    ),
    household_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendee_household_members AS hm
      JOIN public.attendees AS a
        ON a.id = hm.attendee_id
      JOIN public.events AS e
        ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND lower(btrim(coalesce(hm.email, ''))) = v_normalized_email
          )
          OR (
            NOT v_identifier_is_email
            AND CASE
              WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
                AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
              THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
              ELSE regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')
            END = v_normalized_phone
          )
        )
    ),
    verified_matches AS (
      SELECT attendee_id FROM primary_matches
      UNION
      SELECT attendee_id FROM household_matches
    )
    SELECT count(*), array_agg(attendee_id)
      INTO v_match_count, v_match_ids
    FROM verified_matches;

    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_verified_attendee_id := v_match_ids[1];

    IF v_verified_attendee_id IS DISTINCT FROM p_expected_attendee_id THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;
  END IF;

  v_normalized_site := nullif(upper(btrim(p_assigned_site)), '');

  IF v_normalized_site IS NOT NULL THEN
    SELECT ems.selected_master_map_id
      INTO v_selected_master_map_id
    FROM public.event_map_settings AS ems
    WHERE ems.event_id = p_event_id
    FOR UPDATE;

    IF NOT FOUND OR v_selected_master_map_id IS NULL THEN
      RAISE EXCEPTION 'Member check-in site assignment failed.';
    END IF;

    SELECT mms.id
      INTO v_master_site_id
    FROM public.master_map_sites AS mms
    WHERE mms.master_map_id = v_selected_master_map_id
      AND mms.site_number = v_normalized_site;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Member check-in site assignment failed.';
    END IF;

    SELECT ps.id, ps.assigned_attendee_id
      INTO v_parking_site_id, v_parking_assignee_id
    FROM public.parking_sites AS ps
    WHERE ps.event_id = p_event_id
      AND ps.master_site_id = v_master_site_id
    FOR UPDATE;

    IF FOUND
      AND v_parking_assignee_id IS NOT NULL
      AND v_parking_assignee_id IS DISTINCT FROM v_verified_attendee_id THEN
      RAISE EXCEPTION 'Member check-in site assignment failed.';
    END IF;
  END IF;

  UPDATE public.parking_sites AS ps
  SET assigned_attendee_id = NULL
  WHERE ps.event_id = p_event_id
    AND ps.assigned_attendee_id = v_verified_attendee_id
    AND (
      v_normalized_site IS NULL
      OR ps.master_site_id IS DISTINCT FROM v_master_site_id
    );

  IF v_normalized_site IS NOT NULL THEN
    IF v_parking_site_id IS NULL THEN
      INSERT INTO public.parking_sites (
        event_id,
        master_site_id,
        assigned_attendee_id
      )
      VALUES (
        p_event_id,
        v_master_site_id,
        v_verified_attendee_id
      );
    ELSE
      UPDATE public.parking_sites AS ps
      SET assigned_attendee_id = v_verified_attendee_id
      WHERE ps.id = v_parking_site_id
        AND (
          ps.assigned_attendee_id IS NULL
          OR ps.assigned_attendee_id = v_verified_attendee_id
        );

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Member check-in site assignment failed.';
      END IF;
    END IF;
  END IF;

  SELECT
    a.has_arrived,
    a.share_with_attendees,
    a.assigned_site,
    a.arrival_status
  INTO
    v_previous_has_arrived,
    v_previous_share_with_attendees,
    v_previous_assigned_site,
    v_previous_arrival_status
  FROM public.attendees AS a
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  UPDATE public.attendees AS a
  SET has_arrived = p_has_arrived,
      share_with_attendees = p_share_with_attendees,
      assigned_site = v_normalized_site,
      arrival_status = CASE
        WHEN p_has_arrived THEN 'arrived'
        ELSE 'not_arrived'
      END
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id
  RETURNING
    a.id,
    a.assigned_site,
    a.share_with_attendees,
    a.has_arrived,
    a.arrival_status
  INTO
    v_updated_id,
    v_updated_assigned_site,
    v_updated_share_with_attendees,
    v_updated_has_arrived,
    v_updated_arrival_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  INSERT INTO public.member_checkin_audit (
    event_id,
    attendee_id,
    authorization_basis,
    actor_person_id,
    actor_auth_user_id,
    changed_fields,
    previous_values,
    new_values
  )
  VALUES (
    p_event_id,
    v_verified_attendee_id,
    v_authorization_basis,
    v_person_id,
    v_uid,
    array_remove(ARRAY[
      CASE WHEN v_previous_has_arrived IS DISTINCT FROM v_updated_has_arrived THEN 'has_arrived' END,
      CASE WHEN v_previous_share_with_attendees IS DISTINCT FROM v_updated_share_with_attendees THEN 'share_with_attendees' END,
      CASE WHEN v_previous_assigned_site IS DISTINCT FROM v_updated_assigned_site THEN 'assigned_site' END,
      CASE WHEN v_previous_arrival_status IS DISTINCT FROM v_updated_arrival_status THEN 'arrival_status' END
    ], NULL),
    jsonb_build_object(
      'has_arrived', v_previous_has_arrived,
      'share_with_attendees', v_previous_share_with_attendees,
      'assigned_site', v_previous_assigned_site,
      'arrival_status', v_previous_arrival_status
    ),
    jsonb_build_object(
      'has_arrived', v_updated_has_arrived,
      'share_with_attendees', v_updated_share_with_attendees,
      'assigned_site', v_updated_assigned_site,
      'arrival_status', v_updated_arrival_status
    )
  );

  RETURN QUERY
  SELECT
    v_updated_id,
    v_updated_assigned_site,
    v_updated_share_with_attendees,
    v_updated_has_arrived;
END;
$$;
