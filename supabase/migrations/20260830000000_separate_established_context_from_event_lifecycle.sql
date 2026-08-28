-- Member Event Context Stage 1: canonical server-side context-validity
-- semantics.
--
-- ADR-006's governing invariant ("inactive is not invalid" -- lifecycle
-- status is not context validity) was already correctly implemented for
-- Admin. The Member-side investigation found it was not implemented at all
-- for the authenticated identity-resolution family: resolve_member_account,
-- resolve_temporary_or_authenticated_attendee, submit_member_checkin, and
-- verify_member_event_login all required events.is_active = true and
-- events.visible_to_members = true, with no distinction between:
--
--   1. Event discovery / new entry -- lifecycle and visibility may
--      legitimately gate this;
--   2. established Member Event-context / identity resolution -- an
--      already-legitimate Person x Event x Role relationship must survive
--      the Event later becoming inactive or hidden, per ADR-006;
--   3. operational permission for a specific feature -- a separate policy
--      question this migration does not decide.
--
-- Classification of every function this stage inspects:
--
--   resolve_member_account                        -- discovery/new-entry
--   verify_member_event_login                      -- discovery/new-entry
--   get_event_continuity_context                   -- discovery/new-entry
--                                                      (temporary/public
--                                                      continuity: no
--                                                      durable Person link
--                                                      exists, so "still
--                                                      current" and "still
--                                                      enterable" are the
--                                                      same question)
--   get_my_member_event_continuity_context         -- established-context
--                                                      resolution (already
--                                                      correct: it has never
--                                                      read events.is_active
--                                                      or visible_to_members
--                                                      -- Event existence via
--                                                      its JOIN, plus
--                                                      eligible participation
--                                                      plus Tenant authority,
--                                                      is already exactly the
--                                                      target model. No
--                                                      change.)
--   resolve_temporary_or_authenticated_attendee    -- MIXED: its
--                                                      authenticated branch
--                                                      is identity
--                                                      resolution within
--                                                      established context;
--                                                      its unauthenticated
--                                                      branch is Temporary
--                                                      Event Access, which
--                                                      holds no durable
--                                                      Person link and
--                                                      re-derives its
--                                                      authority from the
--                                                      event code + verified
--                                                      registration
--                                                      identifier on every
--                                                      call -- functionally
--                                                      equivalent to
--                                                      re-entering, not a
--                                                      persistent session.
--                                                      That branch keeps its
--                                                      existing entry-grade
--                                                      predicates unchanged.
--   submit_member_checkin                          -- operational
--                                                      mutation; already
--                                                      delegates its
--                                                      authenticated
--                                                      identity question
--                                                      entirely to
--                                                      resolve_temporary_or_authenticated_attendee
--                                                      (20260828000000), so
--                                                      it inherits this
--                                                      repair with no
--                                                      separate change. No
--                                                      documented operational
--                                                      rule independently
--                                                      closes check-in for
--                                                      an inactive/hidden
--                                                      Event today, and none
--                                                      is invented here.
--
-- The only code change in this migration: resolve_temporary_or_authenticated_attendee's
-- authenticated branch no longer requires
-- e.visible_to_members = true or coalesce(e.is_active, true) = true.
-- The Event's continued existence is still required (enforced by the JOIN
-- to public.events itself, exactly as get_my_member_event_continuity_context
-- already relies on its own JOIN rather than a separate flag). Every other
-- predicate is unchanged: pep.participation_state = 'eligible' (canonical
-- Person x Event participation -- the actual authorization/revocation
-- mechanism, per Participation Architecture), coalesce(a.is_active, true) =
-- true (the attendee/registration's own cancellation state -- a fact about
-- that specific registration, not the Event's presentation, and squarely
-- within "eligible participation is revoked/removed/no longer valid"), and
-- the existing count(DISTINCT a.id) <> 1 fail-closed ambiguity handling.
-- The unauthenticated (Temporary Event Access) branch is byte-for-byte
-- unchanged. resolve_member_account, verify_member_event_login,
-- get_event_continuity_context, and get_my_member_event_continuity_context
-- are not modified by this migration at all.
--
-- No table, RLS policy, grant, or function signature changes. No Event
-- lifecycle, events.status, or visible_to_members redesign. No change to
-- MemberRouteGuard, MemberWorkspaceProvider, localStorage/session
-- architecture, or workspaceContextResolver.ts's shadow-only status.

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

    -- Established-context identity resolution (Member Event Context Stage
    -- 1): once a Person legitimately holds an eligible Person x Event
    -- Participation and an applicable role instance, that relationship is
    -- not revoked merely because the Event later becomes inactive or
    -- hidden -- ADR-006, "inactive is not invalid." The Event's continued
    -- existence is enforced by the JOIN below (a deleted Event has no
    -- matching row), exactly as get_my_member_event_continuity_context
    -- already relies on its own JOIN. events.is_active and
    -- events.visible_to_members are deliberately not read here; they
    -- remain discovery/new-entry predicates on resolve_member_account,
    -- verify_member_event_login, and get_event_continuity_context, and an
    -- operational-policy question wherever a specific feature independently
    -- documents one -- never a substitute for genuine authorization/context
    -- revocation. coalesce(a.is_active, true) = true is retained: it is a
    -- fact about this specific attendee/registration's own cancellation
    -- state, not the Event's presentation, and is exactly the kind of
    -- "eligible participation is revoked/removed" signal that legitimately
    -- invalidates established context. DISTINCT on attendee id and the
    -- count <> 1 fail-closed check below are unchanged from
    -- 20260828000000.
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
      AND coalesce(a.is_active, true) = true;

    IF v_match_count <> 1 THEN
      RETURN NULL;
    END IF;

    v_verified_attendee_id := v_match_ids[1];
  ELSE
    -- Temporary Event Access: no durable Person link exists. Authority is
    -- re-derived, on every call, strictly from the event code and the
    -- verified registration email/phone -- functionally a fresh entry
    -- check each time, not a persisted session being revalidated. This
    -- branch is byte-for-byte unchanged from 20260828000000: its
    -- visible_to_members/is_active predicates are entry-grade security,
    -- not established-context policy, and are preserved unweakened.
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
