-- Canonical member attendee-identity bridge repair.
--
-- resolve_member_account() was migrated in
-- 20260817120000_establish_copilot_additional_participant_person_linkage.sql
-- off attendees.person_id (the Pilot-only registration-owner bridge) onto
-- the canonical, role-independent relationship:
--
--   Person -> eligible person_event_participations
--          -> applicable person_role_instances
--          -> attendee
--
-- resolve_temporary_or_authenticated_attendee()'s authenticated branch, and
-- submit_member_checkin()'s independent inline copy of the same check, were
-- never migrated alongside it and still gate on
-- `attendees.person_id = v_person_id` directly. Since attendees.person_id
-- is intentionally written only for the PILOT role (see identity rules in
-- CLAUDE.md / docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md and the
-- migration comment above), any Person whose role at a given Event is
-- COPILOT or HOUSEHOLD_MEMBER passes resolve_member_account() (Event
-- enumeration / login / My Events) but is then rejected by every
-- identity-scoped self-service RPC built on the stale check: My Check-In's
-- read (get_my_attendee_record), the check-in write
-- (submit_member_checkin), the household list, the attendee/household
-- locator, and the sharing-preferences write.
--
-- Production verification (read-only, against the linked project) confirmed
-- this divergence is real: a genuine HOUSEHOLD_MEMBER Person, distinct from
-- the attendee's Pilot, resolves correctly through
-- person_event_participations/person_role_instances but is rejected by the
-- live resolve_temporary_or_authenticated_attendee(). That verification also
-- found the one such row in production is additionally hidden by
-- events.is_active/visible_to_members -- this migration repairs the bridge
-- divergence only. events.is_active and visible_to_members policy,
-- ADR-006 Event-context semantics, MemberWorkspaceProvider/localStorage
-- architecture, admin-created attendee Person linkage, and the identity-
-- claim/OTP activation flow are unchanged.
--
-- REPAIR 1: resolve_temporary_or_authenticated_attendee()'s authenticated
-- branch now joins through person_event_participations/person_role_instances
-- exactly as resolve_member_account() does, scoped to the one requested
-- Event, instead of reading attendees.person_id as a universal Person slot.
-- attendees.person_id's PILOT-only meaning is untouched everywhere else
-- (finalize_member_identity_activation, get_unresolved_verified_destination_roles,
-- and every other reader/writer of that column are unmodified). The
-- temporary/event-code branch is byte-for-byte unchanged.
--
-- Ambiguity handling: exactly the same "count of distinct matches must be 1,
-- else fail closed (return NULL)" convention this function already applies
-- to its temporary branch (and previously applied to its own authenticated
-- branch) is preserved here with DISTINCT attendee ids -- not a new
-- uniqueness assumption. A Person who legitimately holds more than one role
-- instance pointing at the *same* attendee (the self-mirrored Pilot +
-- Household-Member pattern already present in production) still resolves to
-- exactly one attendee, because the match is deduplicated on attendee id.
--
-- REPAIR 2: submit_member_checkin's authenticated branch no longer maintains
-- its own inline copy of "does this Person correspond to this attendee" --
-- it now calls the one shared resolver above. Every other check-in rule
-- (Tenant re-verification, temporary/event-code branch, site-report
-- evidence write, Arrival/sharing update, audit insert, return shape) is
-- byte-for-byte unchanged.

CREATE OR REPLACE FUNCTION public.resolve_temporary_or_authenticated_attendee(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_verified_attendee_id uuid;
  v_match_count integer;
  v_match_ids uuid[];
  v_identifier_is_email boolean;
  v_normalized_email text;
  v_normalized_phone text;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.events AS e
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE e.id = p_event_id
      AND t.is_active = true
  ) THEN
    RETURN NULL;
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';

    IF v_person_id IS NULL THEN
      RETURN NULL;
    END IF;

    -- Canonical, role-independent Person x Event x Role relationship --
    -- the same join resolve_member_account() already uses. Never reads
    -- attendees.person_id here: that column remains the PILOT-only
    -- registration-owner bridge, not a universal Person slot. DISTINCT
    -- on attendee id guards against a Person who holds more than one
    -- role instance on the same attendee/event (e.g. a governed PILOT
    -- role instance alongside a mirrored HOUSEHOLD_MEMBER row for that
    -- same registration) surfacing as more than one match.
    SELECT count(DISTINCT a.id), array_agg(DISTINCT a.id)
      INTO v_match_count, v_match_ids
    FROM public.person_event_participations AS pep
    JOIN public.person_role_instances AS pri
      ON pri.person_id = pep.person_id
     AND pri.event_id = pep.event_id
    JOIN public.attendees AS a
      ON a.id = pri.attendee_id
    JOIN public.events AS e
      ON e.id = pep.event_id
    WHERE pep.person_id = v_person_id
      AND pep.event_id = p_event_id
      AND pep.participation_state = 'eligible'
      AND coalesce(a.is_active, true) = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true;

    IF v_match_count <> 1 THEN
      RETURN NULL;
    END IF;

    v_verified_attendee_id := v_match_ids[1];
  ELSE
    IF nullif(btrim(p_event_code), '') IS NULL
      OR nullif(btrim(p_registration_identifier), '') IS NULL THEN
      RETURN NULL;
    END IF;

    v_identifier_is_email := position('@' IN btrim(p_registration_identifier)) > 0;

    IF v_identifier_is_email THEN
      v_normalized_email := lower(btrim(p_registration_identifier));

      IF position('@' IN v_normalized_email) = 1
        OR position('@' IN v_normalized_email) = length(v_normalized_email) THEN
        RETURN NULL;
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
        RETURN NULL;
      END IF;
    END IF;

    WITH primary_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendees AS a
      JOIN public.events AS e ON e.id = a.event_id
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
      JOIN public.attendees AS a ON a.id = hm.attendee_id
      JOIN public.events AS e ON e.id = a.event_id
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
      RETURN NULL;
    END IF;

    v_verified_attendee_id := v_match_ids[1];
  END IF;

  RETURN v_verified_attendee_id;
END;
$function$;

ALTER FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_member_checkin(
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
  JOIN public.tenants AS t ON t.id = e.tenant_id
  WHERE e.id = p_event_id
    AND e.tenant_id = p_tenant_id
    AND t.is_active = true;

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

    -- Does this authenticated Person legitimately correspond to this
    -- attendee at this Event? This is no longer answered by an
    -- independent inline copy of that question -- it is delegated
    -- entirely to the one shared, canonical resolver
    -- (resolve_temporary_or_authenticated_attendee), which auth.uid()
    -- already routes back into this same authenticated branch. Nothing
    -- here re-derives or duplicates that check.
    v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
      p_event_id, NULL, NULL
    );

    IF v_verified_attendee_id IS NULL
      OR v_verified_attendee_id IS DISTINCT FROM p_expected_attendee_id THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;
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

  -- Member-reported site: non-authoritative evidence only (Site Assignment
  -- Governance Architecture §7; Site Placement Implementation Specification
  -- §3.1/§9.2). This never touches parking_sites or attendees.assigned_site
  -- -- it writes only the append-only member_site_reports evidence table,
  -- using the identity/Event/Tenant context already verified above. Blank
  -- input creates no report (the helper itself enforces this).
  PERFORM public._record_member_site_report(
    p_event_id,
    v_verified_attendee_id,
    p_assigned_site,
    v_authorization_basis,
    v_person_id,
    v_uid
  );

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

  -- Arrival-owned columns only. assigned_site is deliberately absent from
  -- this SET clause -- Member Check-In no longer writes canonical
  -- placement or its compatibility projection in any form.
  UPDATE public.attendees AS a
  SET has_arrived = p_has_arrived,
      share_with_attendees = p_share_with_attendees,
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
    -- assigned_site can never appear here -- this function no longer
    -- writes it, so previous and updated values are always identical.
    array_remove(ARRAY[
      CASE WHEN v_previous_has_arrived IS DISTINCT FROM v_updated_has_arrived THEN 'has_arrived' END,
      CASE WHEN v_previous_share_with_attendees IS DISTINCT FROM v_updated_share_with_attendees THEN 'share_with_attendees' END,
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
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  TO anon, authenticated;
