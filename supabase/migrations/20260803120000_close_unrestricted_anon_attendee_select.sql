-- Security remediation: "Allow all select attendees" granted anon role
-- unrestricted SELECT (qual: true) on public.attendees, and
-- "public read attendee_household_members" did the same on
-- public.attendee_household_members. Together these exposed every
-- attendee's and household member's name, email, phone, membership
-- number, and coach details to any caller holding the public anon key,
-- independent of the application UI. This migration closes both policies
-- and their underlying grants, and replaces the legitimate read needs
-- they were covering with governed SECURITY DEFINER RPCs that return
-- only the minimum necessary fields, following the same pattern already
-- established by verify_member_event_login, resolve_member_account, and
-- submit_member_checkin.
--
-- Read needs covered:
--
--   1. A member's own attendee record and own household members
--      (self-service dashboard, participant lookup, vendor signup,
--      check-in, photo upload). Authenticated callers resolve to exactly
--      one Person the same way submit_member_checkin does. Temporary
--      (event-code) callers, who hold no server-verifiable session at
--      all, re-verify the event code plus the email or phone used at
--      registration on every call -- the same re-verification
--      submit_member_checkin already requires for writes, now required
--      for reads too. This resolution logic is shared by all
--      identity-scoped RPCs below through
--      resolve_temporary_or_authenticated_attendee, rather than repeated
--      per function.
--
--   2. The opted-in public roster shown on the attendee map and coach map
--      (other attendees who set share_with_attendees = true). This does
--      not require resolving the caller's identity at all -- it returns
--      only rows the occupant has already consented to share, and only a
--      minimal, non-identifying-beyond-consent field set (never email,
--      phone, or membership number).
--
--   3. The Attendee Locator's other-attendee contact details (email,
--      phone) and their household members. Unlike (2), this returns
--      genuinely identifying contact information, so it additionally
--      requires the caller to resolve their own attendee record first
--      and requires that record to itself have share_with_attendees =
--      true (the same mutual opt-in the application already enforced
--      client-side, now enforced server-side).
--
--   4. Admin reads of attendee_household_members, which the removed
--      public policy incidentally also permitted for authenticated
--      admin sessions. A dedicated admin-scoped policy replaces that,
--      matching the existing "Admins can view attendees" pattern.
--
-- Not addressed by this migration (separate findings, reported but not
-- fixed here): "member delete household members" permits any
-- authenticated caller to delete any household member row, and
-- save_participant_identity performs no ownership verification at all
-- and is EXECUTE-granted to anon/PUBLIC, permitting unauthenticated
-- creation or overwrite of any household member's identity. Both are
-- write-authorization defects, a different class of problem from the
-- open-read policies this migration closes.

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
  v_person_count integer;
  v_person_ids uuid[];
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

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT count(DISTINCT paa.person_id), array_agg(DISTINCT paa.person_id)
      INTO v_person_count, v_person_ids
    FROM public.person_auth_accounts AS paa
    WHERE paa.auth_user_id = v_uid
      AND paa.status = 'active';

    IF v_person_count <> 1 THEN
      RETURN NULL;
    END IF;

    v_person_id := v_person_ids[1];

    IF NOT EXISTS (
      SELECT 1
      FROM public.people AS p
      WHERE p.id = v_person_id
        AND p.status = 'active'
    ) THEN
      RETURN NULL;
    END IF;

    SELECT count(*), array_agg(a.id)
      INTO v_match_count, v_match_ids
    FROM public.attendees AS a
    JOIN public.events AS e
      ON e.id = a.event_id
    WHERE a.person_id = v_person_id
      AND a.event_id = p_event_id
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
      RETURN NULL;
    END IF;

    v_verified_attendee_id := v_match_ids[1];
  END IF;

  RETURN v_verified_attendee_id;
END;
$function$;

ALTER FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_temporary_or_authenticated_attendee(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_attendee_record(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  entry_id text,
  event_id uuid,
  email text,
  pilot_first text,
  pilot_last text,
  copilot_first text,
  copilot_last text,
  nickname text,
  primary_phone text,
  cell_phone text,
  coach_manufacturer text,
  coach_model text,
  coach_length text,
  assigned_site text,
  share_with_attendees boolean,
  has_arrived boolean,
  arrival_status text,
  participant_capacity integer,
  auth_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_verified_attendee_id uuid;
BEGIN
  v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_verified_attendee_id IS NULL THEN
    RETURN;
  END IF;

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
    a.nickname,
    a.primary_phone,
    a.cell_phone,
    a.coach_manufacturer,
    a.coach_model,
    a.coach_length,
    a.assigned_site,
    a.share_with_attendees,
    a.has_arrived,
    a.arrival_status,
    a.participant_capacity,
    a.auth_user_id
  FROM public.attendees AS a
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id;
END;
$function$;

ALTER FUNCTION public.get_my_attendee_record(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_attendee_record(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_attendee_record(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_household_members(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  attendee_id uuid,
  person_role text,
  first_name text,
  last_name text,
  nickname text,
  display_name text,
  age_text text,
  sort_order integer,
  raw_text text,
  email text,
  participant_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_verified_attendee_id uuid;
BEGIN
  v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_verified_attendee_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    hm.id,
    hm.attendee_id,
    hm.person_role,
    hm.first_name,
    hm.last_name,
    hm.nickname,
    hm.display_name,
    hm.age_text,
    hm.sort_order,
    hm.raw_text,
    hm.email,
    hm.participant_status
  FROM public.attendee_household_members AS hm
  WHERE hm.attendee_id = v_verified_attendee_id
  ORDER BY hm.sort_order ASC NULLS LAST;
END;
$function$;

ALTER FUNCTION public.get_my_household_members(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_household_members(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_household_members(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_event_public_roster(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  pilot_first text,
  pilot_last text,
  copilot_first text,
  copilot_last text,
  coach_make text,
  coach_manufacturer text,
  coach_model text,
  coach_length text,
  assigned_site text,
  share_with_attendees boolean,
  has_arrived boolean,
  arrival_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT
    a.id,
    a.pilot_first,
    a.pilot_last,
    a.copilot_first,
    a.copilot_last,
    a.coach_make,
    a.coach_manufacturer,
    a.coach_model,
    a.coach_length,
    a.assigned_site,
    a.share_with_attendees,
    a.has_arrived,
    a.arrival_status
  FROM public.attendees AS a
  JOIN public.events AS e
    ON e.id = a.event_id
  WHERE a.event_id = p_event_id
    AND a.share_with_attendees = true
    AND coalesce(a.is_active, true) = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
$function$;

ALTER FUNCTION public.get_event_public_roster(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_event_public_roster(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_public_roster(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_event_attendee_locator(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  entry_id text,
  pilot_first text,
  pilot_last text,
  copilot_first text,
  copilot_last text,
  email text,
  primary_phone text,
  cell_phone text,
  coach_make text,
  coach_manufacturer text,
  coach_model text,
  coach_length text,
  is_first_timer boolean,
  wants_to_volunteer boolean,
  handicap_parking boolean,
  assigned_site text,
  share_with_attendees boolean,
  has_arrived boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_caller_attendee_id uuid;
  v_caller_shares boolean;
BEGIN
  v_caller_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_caller_attendee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.share_with_attendees
    INTO v_caller_shares
  FROM public.attendees AS a
  WHERE a.id = v_caller_attendee_id;

  IF NOT coalesce(v_caller_shares, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.entry_id,
    a.pilot_first,
    a.pilot_last,
    a.copilot_first,
    a.copilot_last,
    a.email,
    a.primary_phone,
    a.cell_phone,
    a.coach_make,
    a.coach_manufacturer,
    a.coach_model,
    a.coach_length,
    a.is_first_timer,
    a.wants_to_volunteer,
    a.handicap_parking,
    a.assigned_site,
    a.share_with_attendees,
    a.has_arrived
  FROM public.attendees AS a
  JOIN public.events AS e
    ON e.id = a.event_id
  WHERE a.event_id = p_event_id
    AND a.share_with_attendees = true
    AND coalesce(a.is_active, true) = true
    AND coalesce(a.registration_status, '') IN ('active', 'registered')
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
END;
$function$;

ALTER FUNCTION public.get_event_attendee_locator(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_event_attendee_locator(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_attendee_locator(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_event_locator_household_members(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  attendee_id uuid,
  person_role text,
  first_name text,
  last_name text,
  nickname text,
  display_name text,
  age_text text,
  sort_order integer,
  raw_text text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_caller_attendee_id uuid;
  v_caller_shares boolean;
BEGIN
  v_caller_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_caller_attendee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.share_with_attendees
    INTO v_caller_shares
  FROM public.attendees AS a
  WHERE a.id = v_caller_attendee_id;

  IF NOT coalesce(v_caller_shares, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    hm.id,
    hm.attendee_id,
    hm.person_role,
    hm.first_name,
    hm.last_name,
    hm.nickname,
    hm.display_name,
    hm.age_text,
    hm.sort_order,
    hm.raw_text
  FROM public.attendee_household_members AS hm
  JOIN public.attendees AS a
    ON a.id = hm.attendee_id
  JOIN public.events AS e
    ON e.id = a.event_id
  WHERE a.event_id = p_event_id
    AND a.share_with_attendees = true
    AND coalesce(a.is_active, true) = true
    AND coalesce(a.registration_status, '') IN ('active', 'registered')
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
  ORDER BY hm.sort_order ASC NULLS LAST;
END;
$function$;

ALTER FUNCTION public.get_event_locator_household_members(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_event_locator_household_members(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_locator_household_members(uuid, text, text) TO anon, authenticated;

-- Close the unrestricted reads. Legitimate reads now go through the
-- governed RPCs above; no anon-role direct-table SELECT policy remains
-- on either table.
--
-- Governed migration-history exception: both named policies predate this
-- repository's migration history -- no migration here ever creates them,
-- so each was established directly in the linked production database
-- before migration-based tracking began (the same pattern already repaired
-- in 20260731120100_secure_events_rls.sql,
-- 20260731120200_create_tenant_hostname_mappings.sql,
-- 20260801120600_close_member_checkin_direct_write_bypasses.sql, and
-- 20260801120900_close_admin_users_direct_write_bypass.sql). Both granted
-- unrestricted `USING (true)` SELECT to anon (and, for the household-member
-- policy, authenticated too) -- confirmed against the linked production
-- schema snapshot. An unconditional DROP POLICY only succeeds where that
-- pre-existing object happens to be present; on a fresh replay, where
-- neither policy exists, the same statements fail. The fix generalizes the
-- same intent -- "these named policies must not exist afterward" -- so it
-- succeeds whether or not each was already present, while still
-- guaranteeing the same end state either way: no unrestricted anon or
-- authenticated direct-table SELECT policy remains on either table, and
-- the six governed RPCs above (all SECURITY DEFINER, table-owner
-- privilege) remain the only read pathway for member/public attendee and
-- household-member data either way. Because this migration's version is
-- already recorded as applied in the linked production database, this
-- change affects only fresh-replay behavior; it does not and cannot cause
-- the migration to run again there.
DROP POLICY IF EXISTS "Allow all select attendees" ON public.attendees;
REVOKE SELECT ON TABLE public.attendees FROM anon;

DROP POLICY IF EXISTS "public read attendee_household_members" ON public.attendee_household_members;
REVOKE SELECT ON TABLE public.attendee_household_members FROM anon;
GRANT SELECT ON TABLE public.attendee_household_members TO authenticated;

CREATE POLICY "Admins can view household members"
ON public.attendee_household_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = auth.uid()
      AND au.is_active = true
      AND au.privilege_group = ANY (ARRAY[
        'super_admin', 'event_admin', 'checkin', 'parking',
        'content_admin', 'read_only'
      ])
  )
);
