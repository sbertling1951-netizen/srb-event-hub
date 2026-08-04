-- WR-02 Stage 2 of the approved Server Authentication Boundary -> Person
-- Resolution implementation sequence: closes the previously-open gap where
-- submit_member_checkin performed no Tenant verification at all. Any
-- authenticated Person with an Attendee record for the target Event could
-- check in regardless of which Tenant's website the request came through,
-- because the function never consulted Event -> Tenant ownership.
--
-- This migration does not, on its own, make that gap reachable -- today's
-- production data is single-Tenant (FCOC). It closes it ahead of any second
-- Tenant existing, consistent with the governed Workspace boundary in
-- ADR-012 and EPICENTRAX_DOMAIN_MODEL.md: a request made through a given
-- Tenant's website must never be able to mutate another Tenant's data, even
-- for an otherwise-authorized Person.
--
-- The trusted Tenant ID is resolved server-side, from the real Host header
-- of the incoming request, by lib/server/tenantResolver.ts
-- (resolveTenantFromHeaders) -- never from a client-asserted value. The new
-- app/api/member/checkin route performs that resolution and is now the only
-- caller of this function; the browser no longer calls it directly.
--
-- Defense-in-depth: this function does not trust the server's Tenant
-- resolution as sufficient authority on its own. It independently
-- re-derives the target Event's actual Tenant ownership from public.events
-- and refuses to proceed on any mismatch, exactly as ADR-012 requires for
-- every governed boundary -- the database never merely accepts a caller's
-- claim about Tenant context.
--
-- The prior seven-argument signature is dropped, not left in place beside
-- the new one: it performed no Tenant check and must not remain reachable
-- as a parallel, less-governed path. It has exactly one caller in this
-- repository (app/member/checkin/page.tsx), which this change updates to
-- call the new server route instead of this function directly. The
-- unauthenticated ("temporary") event-code branch's own verification logic
-- is otherwise unchanged byte-for-byte.

DROP FUNCTION IF EXISTS public.submit_member_checkin(
  uuid, uuid, boolean, boolean, text, text, text
);

CREATE FUNCTION public.submit_member_checkin(
  p_event_id uuid,
  p_expected_attendee_id uuid,
  p_has_arrived boolean,
  p_share_with_attendees boolean,
  p_assigned_site text,
  p_tenant_id uuid,
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
    OR p_share_with_attendees IS NULL
    OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  -- Independent Tenant re-verification. p_tenant_id is a value the caller
  -- supplies, but this check gives it no authority by itself: it only
  -- succeeds when the Event this call targets is actually, currently owned
  -- by that Tenant in public.events. A caller cannot widen its own access
  -- by asserting a different Tenant ID -- it can only ever narrow the same
  -- Event/Person/Attendee checks already enforced below to Events that
  -- Tenant genuinely owns.
  SELECT count(*)
    INTO v_match_count
  FROM public.events AS e
  WHERE e.id = p_event_id
    AND e.tenant_id = p_tenant_id;

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    v_authorization_basis := 'authenticated';

    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';

    IF v_person_id IS NULL THEN
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

ALTER FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
TO anon, authenticated;
