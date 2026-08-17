-- Role-independent Person continuity for Co-Pilot and Additional Participant
-- (Domain Model v2.2, "Role-independent Person continuity", 2026-08-17).
--
-- Closes six coupled gaps in the existing PILOT/HOUSEHOLD_MEMBER-only
-- activation path so a verified Co-Pilot or Additional Participant resolves
-- to the same canonical Person model as a Pilot, without ever writing to
-- attendees.person_id (Pilot-only per Domain Model Identity rules):
--
-- 1. person_role_instances could not represent COPILOT at all
--    (identity_role CHECK) and its source-uniqueness constraint collided
--    with PILOT whenever both were sourced from the same attendees row.
-- 2. get_unresolved_identity_component_roles() and the identical inline
--    copy inside evaluate_member_identity_claim() gated the entire
--    unresolved-role inventory on attendees.person_id IS NULL, so a
--    resolved Pilot suppressed discovery of that same registration's
--    still-unresolved Co-Pilot/Additional Participant roles.
-- 3. finalize_member_identity_activation() filtered person_role_instances
--    inserts to PILOT/HOUSEHOLD_MEMBER only, silently dropping COPILOT.
-- 4. Its attendees.person_id UPDATE (and the ownership-conflict guard
--    ahead of it) applied to every attendee_id in the matched component
--    regardless of role, so a Co-Pilot or Additional Participant
--    resolving first could stamp -- or be blocked by -- the Pilot-only
--    bridge column that does not belong to them.
-- 5. resolve_member_account() read event membership through
--    attendees.person_id, so a legitimately authenticated non-Pilot
--    participant could never resolve their own registrations.
-- 6. Newly created role instances never triggered
--    establish_person_event_participation_from_role_instance(); only the
--    one-time backfill in 20260815100000 had done so, for role instances
--    that existed at that moment.
--
-- Additional Participant already has a governed source record
-- (attendee_household_members, identity_role = HOUSEHOLD_MEMBER); this
-- migration does not change that shape. Co-Pilot evidence remains sourced
-- from the attendees row's own copilot_* columns, exactly as the existing
-- component-discovery query already computed it -- only its role tag,
-- constraint shape, and gating were wrong.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Let person_role_instances represent COPILOT, sourced from the same
--    attendees row as PILOT, without colliding with it.
-- ---------------------------------------------------------------------

ALTER TABLE public.person_role_instances
  DROP CONSTRAINT IF EXISTS person_role_instances_identity_role_check;

ALTER TABLE public.person_role_instances
  ADD CONSTRAINT person_role_instances_identity_role_check
  CHECK (identity_role IN ('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER'));

ALTER TABLE public.person_role_instances
  DROP CONSTRAINT IF EXISTS person_role_instances_role_source_consistency;

ALTER TABLE public.person_role_instances
  ADD CONSTRAINT person_role_instances_role_source_consistency CHECK (
    (identity_role IN ('PILOT', 'COPILOT')
      AND household_member_id IS NULL
      AND source_table = 'public.attendees'
      AND source_record_id = attendee_id)
    OR
    (identity_role = 'HOUSEHOLD_MEMBER'
      AND household_member_id IS NOT NULL
      AND source_table = 'public.attendee_household_members'
      AND source_record_id = household_member_id)
  );

-- PILOT and COPILOT both source from (public.attendees, attendee.id); the
-- prior two-column uniqueness made them mutually exclusive on the same
-- registration. Scoping uniqueness by identity_role as well is a strict
-- widening -- every row satisfying the old two-column constraint still
-- satisfies this one, so no existing data can violate it.
ALTER TABLE public.person_role_instances
  DROP CONSTRAINT IF EXISTS person_role_instances_source_unique;

ALTER TABLE public.person_role_instances
  ADD CONSTRAINT person_role_instances_source_unique
  UNIQUE (source_table, source_record_id, identity_role);

-- ---------------------------------------------------------------------
-- 2. Gate unresolved-role discovery per role, not per attendee. A role
--    is unresolved iff it has no person_role_instances row of its own --
--    an already-linked Pilot must never suppress its own registration's
--    still-unlinked Co-Pilot or Additional Participant roles.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_unresolved_identity_component_roles(
  p_component_id text
)
RETURNS TABLE(
  role_instance_key text,
  attendee_id uuid,
  event_id uuid,
  identity_role text,
  household_member_id uuid,
  source_table text,
  source_record_id uuid,
  normalized_first_name text,
  normalized_last_name text,
  normalized_email text,
  normalized_phone text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH RECURSIVE
unresolved_attendees AS (
  SELECT
    a.id,
    a.event_id,
    a.person_id,
    a.auth_user_id,
    a.pilot_first,
    a.pilot_last,
    a.email,
    a.cell_phone,
    a.primary_phone,
    a.phone,
    a.membership_number,
    a.state,
    a.copilot_first,
    a.copilot_last,
    a.copilot_email,
    a.copilot_cell_phone
  FROM public.attendees a
),
unresolved_role_inventory AS (
  SELECT
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    a.event_id,
    'PILOT'::text AS identity_role,
    NULL::uuid AS household_member_id,
    'public.attendees'::text AS source_table,
    a.id AS source_record_id,
    NULLIF(lower(regexp_replace(trim(coalesce(a.pilot_first, '')), '\s+', ' ', 'g')), '') AS normalized_first_name,
    NULLIF(lower(regexp_replace(trim(coalesce(a.pilot_last, '')), '\s+', ' ', 'g')), '') AS normalized_last_name,
    NULLIF(lower(trim(a.email)), '') AS normalized_email,
    NULLIF(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), '') AS normalized_phone,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_membership_number,
    NULLIF(upper(trim(a.state)), '') AS normalized_state,
    a.auth_user_id AS role_auth_user_id
  FROM unresolved_attendees a

  UNION ALL

  SELECT
    'attendee_copilot:' || a.id::text,
    a.id,
    a.event_id,
    'COPILOT'::text,
    NULL::uuid,
    'public.attendees'::text,
    a.id,
    NULLIF(lower(regexp_replace(trim(coalesce(a.copilot_first, '')), '\s+', ' ', 'g')), ''),
    NULLIF(lower(regexp_replace(trim(coalesce(a.copilot_last, '')), '\s+', ' ', 'g')), ''),
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULLIF(upper(trim(a.membership_number)), ''),
    NULLIF(upper(trim(a.state)), ''),
    NULL::uuid
  FROM unresolved_attendees a
  WHERE NULLIF(trim(concat_ws(' ', a.copilot_first, a.copilot_last)), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_email), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_cell_phone), '') IS NOT NULL

  UNION ALL

  SELECT
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.event_id,
    'HOUSEHOLD_MEMBER'::text,
    hm.id,
    'public.attendee_household_members'::text,
    hm.id,
    NULLIF(lower(regexp_replace(trim(coalesce(hm.first_name, '')), '\s+', ' ', 'g')), ''),
    NULLIF(lower(regexp_replace(trim(coalesce(hm.last_name, '')), '\s+', ' ', 'g')), ''),
    NULLIF(lower(trim(hm.email)), ''),
    NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULLIF(upper(trim(coalesce(a.membership_number, ''))), ''),
    NULLIF(upper(trim(coalesce(a.state, ''))), ''),
    hm.auth_user_id
  FROM public.attendee_household_members hm
  JOIN unresolved_attendees a ON a.id = hm.attendee_id
),
unresolved_conflicting_identifier_values AS (
  SELECT evidence_type, normalized_value
  FROM (
    SELECT 'auth_user_id'::text AS evidence_type, uri.role_auth_user_id::text AS normalized_value, uri.normalized_first_name, uri.normalized_last_name
    FROM unresolved_role_inventory uri
    WHERE uri.role_auth_user_id IS NOT NULL

    UNION ALL

    SELECT 'email', uri.normalized_email, uri.normalized_first_name, uri.normalized_last_name
    FROM unresolved_role_inventory uri
    WHERE uri.normalized_email IS NOT NULL

    UNION ALL

    SELECT 'phone', uri.normalized_phone, uri.normalized_first_name, uri.normalized_last_name
    FROM unresolved_role_inventory uri
    WHERE uri.normalized_phone IS NOT NULL
  ) evidence
  WHERE evidence.normalized_first_name IS NOT NULL
    AND evidence.normalized_last_name IS NOT NULL
  GROUP BY evidence_type, normalized_value
  HAVING count(DISTINCT evidence.normalized_first_name || '|' || evidence.normalized_last_name) > 1
),
unresolved_conflict_roles AS (
  SELECT DISTINCT uri.role_instance_key
  FROM unresolved_role_inventory uri
  JOIN unresolved_conflicting_identifier_values ucv
    ON (ucv.evidence_type = 'auth_user_id' AND ucv.normalized_value = uri.role_auth_user_id::text)
    OR (ucv.evidence_type = 'email' AND ucv.normalized_value = uri.normalized_email)
    OR (ucv.evidence_type = 'phone' AND ucv.normalized_value = uri.normalized_phone)
),
unresolved_pool AS (
  SELECT uri.*
  FROM unresolved_role_inventory uri
  LEFT JOIN unresolved_conflict_roles ucr ON ucr.role_instance_key = uri.role_instance_key
  WHERE ucr.role_instance_key IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.person_role_instances pri
      WHERE pri.source_role_instance_key = uri.role_instance_key
    )
),
unresolved_identifier_edges AS (
  SELECT a.role_instance_key AS left_role_key, b.role_instance_key AS right_role_key
  FROM unresolved_pool a
  JOIN unresolved_pool b
    ON a.role_instance_key < b.role_instance_key
   AND a.normalized_email IS NOT NULL
   AND a.normalized_email = b.normalized_email

  UNION ALL

  SELECT a.role_instance_key, b.role_instance_key
  FROM unresolved_pool a
  JOIN unresolved_pool b
    ON a.role_instance_key < b.role_instance_key
   AND a.normalized_phone IS NOT NULL
   AND a.normalized_phone = b.normalized_phone
),
unresolved_undirected_edges AS (
  SELECT left_role_key AS from_role, right_role_key AS to_role FROM unresolved_identifier_edges
  UNION ALL
  SELECT right_role_key, left_role_key FROM unresolved_identifier_edges
),
unresolved_reachable AS (
  SELECT role_instance_key AS seed_role, role_instance_key
  FROM unresolved_pool

  UNION

  SELECT ur.seed_role, uue.to_role
  FROM unresolved_reachable ur
  JOIN unresolved_undirected_edges uue ON uue.from_role = ur.role_instance_key
),
unresolved_component_assignment AS (
  SELECT role_instance_key, min(seed_role) AS component_id
  FROM unresolved_reachable
  GROUP BY role_instance_key
)
SELECT
  up.role_instance_key,
  up.attendee_id,
  up.event_id,
  up.identity_role,
  up.household_member_id,
  up.source_table,
  up.source_record_id,
  up.normalized_first_name,
  up.normalized_last_name,
  up.normalized_email,
  up.normalized_phone
FROM unresolved_pool up
JOIN unresolved_component_assignment uca
  ON uca.role_instance_key = up.role_instance_key
WHERE uca.component_id = p_component_id;
$$;

-- ---------------------------------------------------------------------
-- 3. evaluate_member_identity_claim() carries an inline copy of the same
--    unresolved-role discovery query (predates the shared function
--    above); apply the identical per-role gating fix there so component
--    discovery at evaluation time agrees with resolution at finalize
--    time. Everything else in this function is unchanged.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.evaluate_member_identity_claim(
  p_first_name text,
  p_last_name text,
  p_home_state text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_membership_number text DEFAULT NULL,
  p_event_ids uuid[] DEFAULT NULL,
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL,
  p_request_source text DEFAULT 'member_activation_api'
)
RETURNS TABLE(
  attempt_id uuid,
  public_attempt_token text,
  internal_result_classification text,
  public_result_classification text,
  candidate_count_classification text,
  matched_person_id uuid,
  matched_component_id text,
  review_reason text,
  status text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_first_name text;
  v_last_name text;
  v_home_state text;
  v_email text;
  v_phone text;
  v_membership_number text;
  v_event_ids uuid[];
  v_valid_event_ids uuid[];
  v_requested_event_count integer;
  v_selected_event_count integer;
  v_evidence_categories text[];
  v_strong_input_count integer;
  v_supporting_input_count integer;
  v_additional_evidence_count integer;
  v_internal_result text;
  v_public_result text;
  v_candidate_count_classification text;
  v_matched_person_id uuid;
  v_matched_component_id text;
  v_review_reason text;
  v_matched_event_count integer;
  v_attempt_id uuid;
  v_public_attempt_token text;
  v_expires_at timestamptz;
BEGIN
  v_first_name := lower(regexp_replace(trim(coalesce(p_first_name, '')), '\s+', ' ', 'g'));
  v_last_name := lower(regexp_replace(trim(coalesce(p_last_name, '')), '\s+', ' ', 'g'));
  v_home_state := upper(trim(coalesce(p_home_state, '')));
  v_email := lower(trim(coalesce(p_email, '')));
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_membership_number := upper(trim(coalesce(p_membership_number, '')));
  v_expires_at := now() + interval '30 minutes';
  v_public_attempt_token :=
    md5(gen_random_uuid()::text || clock_timestamp()::text)
    || md5(random()::text || gen_random_uuid()::text);

  IF length(v_phone) = 11 AND left(v_phone, 1) = '1' THEN
    v_phone := substring(v_phone from 2);
  END IF;

  IF v_home_state = '' THEN
    v_home_state := NULL;
  END IF;

  IF v_email = '' THEN
    v_email := NULL;
  END IF;

  IF v_phone = '' THEN
    v_phone := NULL;
  END IF;

  IF v_membership_number = '' THEN
    v_membership_number := NULL;
  END IF;

  SELECT coalesce(array_agg(DISTINCT event_id ORDER BY event_id), '{}'::uuid[])
  INTO v_event_ids
  FROM unnest(coalesce(p_event_ids, '{}'::uuid[])) AS event_id
  WHERE event_id IS NOT NULL;

  v_requested_event_count := coalesce(array_length(v_event_ids, 1), 0);

  SELECT coalesce(array_agg(e.id ORDER BY e.id), '{}'::uuid[])
  INTO v_valid_event_ids
  FROM public.events e
  WHERE e.id = ANY(v_event_ids)
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true
    AND lower(trim(coalesce(e.status, ''))) NOT IN (
      'inactive',
      'archived',
      'complete',
      'completed',
      'closed',
      'draft'
    );

  v_selected_event_count := coalesce(array_length(v_valid_event_ids, 1), 0);
  v_evidence_categories := array_remove(
    ARRAY[
      CASE WHEN v_email IS NOT NULL THEN 'email' END,
      CASE WHEN v_phone IS NOT NULL THEN 'phone' END,
      CASE WHEN v_membership_number IS NOT NULL THEN 'membership_number' END,
      CASE WHEN v_home_state IS NOT NULL THEN 'state' END,
      CASE WHEN v_selected_event_count > 0 THEN 'event_history' END
    ],
    NULL
  );
  v_strong_input_count :=
    CASE WHEN v_email IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN v_phone IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN v_membership_number IS NOT NULL THEN 1 ELSE 0 END;
  v_supporting_input_count :=
    CASE WHEN v_home_state IS NOT NULL THEN 1 ELSE 0 END
    + CASE WHEN v_selected_event_count > 0 THEN 1 ELSE 0 END;
  v_additional_evidence_count := coalesce(array_length(v_evidence_categories, 1), 0);

  IF v_first_name = '' OR v_last_name = '' THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'NAME_REQUIRED';
    v_matched_event_count := 0;
  ELSIF v_additional_evidence_count = 0 THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'ADDITIONAL_EVIDENCE_REQUIRED';
    v_matched_event_count := 0;
  ELSIF v_requested_event_count <> v_selected_event_count THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'INVALID_EVENT_SELECTION';
    v_matched_event_count := 0;
  ELSIF v_strong_input_count = 0 THEN
    v_internal_result := 'INELIGIBLE';
    v_public_result := 'UNABLE_TO_VERIFY';
    v_candidate_count_classification := 'INELIGIBLE';
    v_review_reason := 'STRONG_EVIDENCE_REQUIRED';
    v_matched_event_count := 0;
  ELSE
    WITH RECURSIVE
    stage5b_manifest_components AS (
      SELECT *
      FROM (
        VALUES
          ('attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829'::text),
          ('attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4'::text),
          ('attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505'::text),
          ('attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27'::text),
          ('attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70'::text),
          ('attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854'::text)
      ) AS manifest(component_id)
    ),
    person_name_variants AS (
      SELECT DISTINCT
        p.id AS person_id,
        lower(regexp_replace(trim(coalesce(p.display_first_name, '')), '\s+', ' ', 'g')) AS first_name,
        lower(regexp_replace(trim(coalesce(p.display_last_name, '')), '\s+', ' ', 'g')) AS last_name
      FROM public.people p
      WHERE p.status = 'active'
        AND p.merged_into_person_id IS NULL

      UNION ALL

      SELECT DISTINCT
        pri.person_id,
        lower(regexp_replace(trim(coalesce(a.pilot_first, '')), '\s+', ' ', 'g')),
        lower(regexp_replace(trim(coalesce(a.pilot_last, '')), '\s+', ' ', 'g'))
      FROM public.person_role_instances pri
      JOIN public.attendees a ON a.id = pri.attendee_id
      WHERE pri.identity_role = 'PILOT'

      UNION ALL

      SELECT DISTINCT
        pri.person_id,
        lower(regexp_replace(trim(coalesce(hm.first_name, '')), '\s+', ' ', 'g')),
        lower(regexp_replace(trim(coalesce(hm.last_name, '')), '\s+', ' ', 'g'))
      FROM public.person_role_instances pri
      JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
      WHERE pri.identity_role = 'HOUSEHOLD_MEMBER'
    ),
    canonical_candidates AS (
      SELECT DISTINCT pnv.person_id
      FROM person_name_variants pnv
      WHERE pnv.first_name = v_first_name
        AND pnv.last_name = v_last_name
    ),
    canonical_candidate_scores AS (
      SELECT
        'PERSON'::text AS candidate_kind,
        cc.person_id,
        NULL::text AS component_id,
        EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = cc.person_id
            AND pi.identifier_type = 'email'
            AND pi.normalized_value = v_email
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND (
              lower(trim(coalesce(a.email, ''))) = v_email
              OR lower(trim(coalesce(a.copilot_email, ''))) = v_email
            )
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
          WHERE pri.person_id = cc.person_id
            AND lower(trim(coalesce(hm.email, ''))) = v_email
        ) AS email_match,
        EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = cc.person_id
            AND pi.identifier_type = 'phone'
            AND pi.normalized_value = v_phone
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND (
              regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g') = v_phone
              OR regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') = v_phone
            )
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
          WHERE pri.person_id = cc.person_id
            AND regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') = v_phone
        ) AS phone_match,
        EXISTS (
          SELECT 1
          FROM public.person_identifiers pi
          WHERE pi.person_id = cc.person_id
            AND pi.identifier_type = 'membership_number'
            AND pi.normalized_value = v_membership_number
        ) OR EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND upper(trim(coalesce(a.membership_number, ''))) = v_membership_number
            AND upper(trim(coalesce(a.membership_number, ''))) NOT IN ('F123456', 'F999999', 'FM22222', 'FM2222222')
        ) AS membership_match,
        EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          JOIN public.attendees a ON a.id = pri.attendee_id
          WHERE pri.person_id = cc.person_id
            AND upper(trim(coalesce(a.state, ''))) = v_home_state
        ) AS state_match,
        (
          SELECT count(DISTINCT pri.event_id)::integer
          FROM public.person_role_instances pri
          WHERE pri.person_id = cc.person_id
            AND pri.event_id = ANY(v_valid_event_ids)
        ) AS event_match_count,
        EXISTS (
          SELECT 1
          FROM public.person_auth_accounts paa
          WHERE paa.person_id = cc.person_id
            AND paa.status = 'active'
        ) AS has_active_auth_account,
        false AS is_stage5b_component
      FROM canonical_candidates cc
    ),
    unresolved_attendees AS (
      SELECT
        a.id,
        a.event_id,
        a.person_id,
        a.auth_user_id,
        a.pilot_first,
        a.pilot_last,
        a.email,
        a.cell_phone,
        a.primary_phone,
        a.phone,
        a.membership_number,
        a.state,
        a.copilot_first,
        a.copilot_last,
        a.copilot_email,
        a.copilot_cell_phone
      FROM public.attendees a
    ),
    unresolved_role_inventory AS (
      SELECT
        'attendee_pilot:' || a.id::text AS role_instance_key,
        a.id AS attendee_id,
        a.event_id,
        NULLIF(lower(regexp_replace(trim(coalesce(a.pilot_first, '')), '\s+', ' ', 'g')), '') AS normalized_first_name,
        NULLIF(lower(regexp_replace(trim(coalesce(a.pilot_last, '')), '\s+', ' ', 'g')), '') AS normalized_last_name,
        NULLIF(lower(trim(a.email)), '') AS normalized_email,
        NULLIF(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), '') AS normalized_phone,
        NULLIF(upper(trim(a.membership_number)), '') AS normalized_membership_number,
        NULLIF(upper(trim(a.state)), '') AS normalized_state,
        a.auth_user_id AS role_auth_user_id
      FROM unresolved_attendees a

      UNION ALL

      SELECT
        'attendee_copilot:' || a.id::text,
        a.id,
        a.event_id,
        NULLIF(lower(regexp_replace(trim(coalesce(a.copilot_first, '')), '\s+', ' ', 'g')), ''),
        NULLIF(lower(regexp_replace(trim(coalesce(a.copilot_last, '')), '\s+', ' ', 'g')), ''),
        NULLIF(lower(trim(a.copilot_email)), ''),
        NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), ''),
        NULLIF(upper(trim(a.membership_number)), ''),
        NULLIF(upper(trim(a.state)), ''),
        NULL::uuid
      FROM unresolved_attendees a
      WHERE NULLIF(trim(concat_ws(' ', a.copilot_first, a.copilot_last)), '') IS NOT NULL
         OR NULLIF(trim(a.copilot_email), '') IS NOT NULL
         OR NULLIF(trim(a.copilot_cell_phone), '') IS NOT NULL

      UNION ALL

      SELECT
        'household_member:' || hm.id::text,
        hm.attendee_id,
        hm.event_id,
        NULLIF(lower(regexp_replace(trim(coalesce(hm.first_name, '')), '\s+', ' ', 'g')), ''),
        NULLIF(lower(regexp_replace(trim(coalesce(hm.last_name, '')), '\s+', ' ', 'g')), ''),
        NULLIF(lower(trim(hm.email)), ''),
        NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), ''),
        NULLIF(upper(trim(coalesce(a.membership_number, ''))), ''),
        NULLIF(upper(trim(coalesce(a.state, ''))), ''),
        hm.auth_user_id
      FROM public.attendee_household_members hm
      JOIN unresolved_attendees a ON a.id = hm.attendee_id
    ),
    unresolved_conflicting_identifier_values AS (
      SELECT evidence_type, normalized_value
      FROM (
        SELECT 'auth_user_id'::text AS evidence_type, uri.role_auth_user_id::text AS normalized_value, uri.normalized_first_name, uri.normalized_last_name
        FROM unresolved_role_inventory uri
        WHERE uri.role_auth_user_id IS NOT NULL

        UNION ALL

        SELECT 'email', uri.normalized_email, uri.normalized_first_name, uri.normalized_last_name
        FROM unresolved_role_inventory uri
        WHERE uri.normalized_email IS NOT NULL

        UNION ALL

        SELECT 'phone', uri.normalized_phone, uri.normalized_first_name, uri.normalized_last_name
        FROM unresolved_role_inventory uri
        WHERE uri.normalized_phone IS NOT NULL
      ) evidence
      WHERE evidence.normalized_first_name IS NOT NULL
        AND evidence.normalized_last_name IS NOT NULL
      GROUP BY evidence_type, normalized_value
      HAVING count(DISTINCT evidence.normalized_first_name || '|' || evidence.normalized_last_name) > 1
    ),
    unresolved_conflict_roles AS (
      SELECT DISTINCT uri.role_instance_key
      FROM unresolved_role_inventory uri
      JOIN unresolved_conflicting_identifier_values ucv
        ON (ucv.evidence_type = 'auth_user_id' AND ucv.normalized_value = uri.role_auth_user_id::text)
        OR (ucv.evidence_type = 'email' AND ucv.normalized_value = uri.normalized_email)
        OR (ucv.evidence_type = 'phone' AND ucv.normalized_value = uri.normalized_phone)
    ),
    unresolved_pool AS (
      SELECT uri.*
      FROM unresolved_role_inventory uri
      LEFT JOIN unresolved_conflict_roles ucr ON ucr.role_instance_key = uri.role_instance_key
      WHERE ucr.role_instance_key IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.person_role_instances pri
          WHERE pri.source_role_instance_key = uri.role_instance_key
        )
    ),
    unresolved_identifier_edges AS (
      SELECT a.role_instance_key AS left_role_key, b.role_instance_key AS right_role_key
      FROM unresolved_pool a
      JOIN unresolved_pool b
        ON a.role_instance_key < b.role_instance_key
       AND a.normalized_email IS NOT NULL
       AND a.normalized_email = b.normalized_email

      UNION ALL

      SELECT a.role_instance_key, b.role_instance_key
      FROM unresolved_pool a
      JOIN unresolved_pool b
        ON a.role_instance_key < b.role_instance_key
       AND a.normalized_phone IS NOT NULL
       AND a.normalized_phone = b.normalized_phone
    ),
    unresolved_undirected_edges AS (
      SELECT left_role_key AS from_role, right_role_key AS to_role FROM unresolved_identifier_edges
      UNION ALL
      SELECT right_role_key, left_role_key FROM unresolved_identifier_edges
    ),
    unresolved_reachable AS (
      SELECT role_instance_key AS seed_role, role_instance_key
      FROM unresolved_pool

      UNION

      SELECT ur.seed_role, uue.to_role
      FROM unresolved_reachable ur
      JOIN unresolved_undirected_edges uue ON uue.from_role = ur.role_instance_key
    ),
    unresolved_component_assignment AS (
      SELECT role_instance_key, min(seed_role) AS component_id
      FROM unresolved_reachable
      GROUP BY role_instance_key
    ),
    unresolved_component_candidates AS (
      SELECT DISTINCT uca.component_id
      FROM unresolved_component_assignment uca
      JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
      WHERE up.normalized_first_name = v_first_name
        AND up.normalized_last_name = v_last_name
    ),
    unresolved_candidate_scores AS (
      SELECT
        'UNRESOLVED_COMPONENT'::text AS candidate_kind,
        NULL::uuid AS person_id,
        ucc.component_id,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_email = v_email
        ) AS email_match,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_phone = v_phone
        ) AS phone_match,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_membership_number = v_membership_number
            AND up.normalized_membership_number NOT IN ('F123456', 'F999999', 'FM22222', 'FM2222222')
        ) AS membership_match,
        EXISTS (
          SELECT 1
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.normalized_state = v_home_state
        ) AS state_match,
        (
          SELECT count(DISTINCT up.event_id)::integer
          FROM unresolved_component_assignment uca
          JOIN unresolved_pool up ON up.role_instance_key = uca.role_instance_key
          WHERE uca.component_id = ucc.component_id
            AND up.event_id = ANY(v_valid_event_ids)
        ) AS event_match_count,
        false AS has_active_auth_account,
        EXISTS (
          SELECT 1
          FROM stage5b_manifest_components smc
          WHERE smc.component_id = ucc.component_id
        ) AS is_stage5b_component
      FROM unresolved_component_candidates ucc
    ),
    combined_candidate_scores AS (
      SELECT * FROM canonical_candidate_scores
      UNION ALL
      SELECT * FROM unresolved_candidate_scores
    ),
    matched_candidates AS (
      SELECT
        ccs.*,
        (CASE WHEN ccs.email_match THEN 1 ELSE 0 END
          + CASE WHEN ccs.phone_match THEN 1 ELSE 0 END
          + CASE WHEN ccs.membership_match THEN 1 ELSE 0 END) AS strong_match_count,
        (CASE WHEN ccs.state_match THEN 1 ELSE 0 END
          + CASE WHEN ccs.event_match_count > 0 THEN 1 ELSE 0 END
          + CASE WHEN ccs.has_active_auth_account THEN 1 ELSE 0 END) AS supporting_match_count
      FROM combined_candidate_scores ccs
      WHERE ccs.email_match
         OR ccs.phone_match
         OR ccs.membership_match
    ),
    candidate_summary AS (
      SELECT
        count(*)::integer AS candidate_count,
        count(*) FILTER (WHERE candidate_kind = 'PERSON')::integer AS person_candidate_count,
        count(*) FILTER (WHERE candidate_kind = 'UNRESOLVED_COMPONENT')::integer AS component_candidate_count,
        coalesce(max(event_match_count), 0)::integer AS max_event_match_count
      FROM matched_candidates
    ),
    selected_candidate AS (
      SELECT mc.*
      FROM matched_candidates mc
      CROSS JOIN candidate_summary cs
      WHERE cs.candidate_count = 1
      LIMIT 1
    )
    SELECT
      CASE
        WHEN cs.candidate_count = 0 THEN 'NO_EXISTING_MATCH'
        WHEN cs.candidate_count > 1 THEN 'ADMIN_REVIEW_REQUIRED'
        WHEN sc.membership_match AND (sc.email_match OR sc.phone_match OR sc.state_match OR sc.event_match_count > 0 OR sc.has_active_auth_account) THEN 'UNIQUE_CANDIDATE'
        WHEN (CASE WHEN sc.email_match THEN 1 ELSE 0 END + CASE WHEN sc.phone_match THEN 1 ELSE 0 END + CASE WHEN sc.membership_match THEN 1 ELSE 0 END) >= 2 THEN 'UNIQUE_CANDIDATE'
        WHEN (sc.email_match OR sc.phone_match OR sc.membership_match)
          AND (sc.state_match OR sc.event_match_count > 0 OR sc.has_active_auth_account)
        THEN 'UNIQUE_CANDIDATE'
        ELSE 'ADDITIONAL_EVIDENCE_REQUIRED'
      END AS internal_result,
      CASE
        WHEN cs.candidate_count = 0 THEN 'CREATE_NEW_ACCOUNT_AVAILABLE'
        WHEN cs.candidate_count > 1 THEN 'REVIEW_REQUIRED'
        ELSE 'CONTINUE_VERIFICATION'
      END AS public_result,
      CASE
        WHEN cs.candidate_count = 0 THEN 'NONE'
        WHEN cs.person_candidate_count = 1 AND cs.component_candidate_count = 0 THEN 'ONE_PERSON'
        WHEN cs.person_candidate_count = 0 AND cs.component_candidate_count = 1 THEN 'ONE_UNRESOLVED_COMPONENT'
        WHEN cs.person_candidate_count > 0 AND cs.component_candidate_count > 0 THEN 'MIXED'
        ELSE 'MULTIPLE'
      END AS candidate_count_classification,
      sc.person_id,
      sc.component_id,
      CASE
        WHEN cs.candidate_count = 0 THEN 'NO_MATCHING_HISTORICAL_EVIDENCE'
        WHEN cs.candidate_count > 1 THEN 'MULTIPLE_INTERNAL_CANDIDATES'
        WHEN sc.is_stage5b_component THEN 'STAGE5B_CLAIM_REQUIRED_COMPONENT'
        WHEN sc.has_active_auth_account THEN 'EXISTING_AUTH_RELATIONSHIP_PRESENT'
        WHEN sc.email_match OR sc.phone_match OR sc.membership_match THEN 'CLAIM_CANDIDATE_IDENTIFIED'
        ELSE 'ADDITIONAL_EVIDENCE_REQUIRED'
      END AS review_reason,
      coalesce(sc.event_match_count, 0)::integer AS matched_event_count
    INTO
      v_internal_result,
      v_public_result,
      v_candidate_count_classification,
      v_matched_person_id,
      v_matched_component_id,
      v_review_reason,
      v_matched_event_count
    FROM candidate_summary cs
    LEFT JOIN selected_candidate sc ON true;
  END IF;

  INSERT INTO public.identity_claim_attempts AS attempt (
    completed_at,
    public_attempt_token,
    status,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    evidence_categories,
    matched_person_id,
    matched_component_id,
    review_reason,
    requested_event_count,
    matched_event_count,
    first_name_hash,
    last_name_hash,
    email_hash,
    phone_hash,
    membership_number_hash,
    state_hash,
    request_ip_hash,
    user_agent_hash,
    request_metadata,
    expires_at
  )
  VALUES (
    now(),
    v_public_attempt_token,
    'completed',
    v_internal_result,
    v_public_result,
    v_candidate_count_classification,
    coalesce(v_evidence_categories, '{}'::text[]),
    v_matched_person_id,
    v_matched_component_id,
    v_review_reason,
    v_selected_event_count,
    coalesce(v_matched_event_count, 0),
    CASE WHEN v_first_name = '' THEN NULL ELSE md5(v_first_name) END,
    CASE WHEN v_last_name = '' THEN NULL ELSE md5(v_last_name) END,
    CASE WHEN v_email IS NULL THEN NULL ELSE md5(v_email) END,
    CASE WHEN v_phone IS NULL THEN NULL ELSE md5(v_phone) END,
    CASE WHEN v_membership_number IS NULL THEN NULL ELSE md5(v_membership_number) END,
    CASE WHEN v_home_state IS NULL THEN NULL ELSE md5(v_home_state) END,
    p_request_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'request_source', coalesce(nullif(trim(coalesce(p_request_source, '')), ''), 'member_activation_api'),
      'selected_event_count', v_selected_event_count,
      'strong_input_count', v_strong_input_count,
      'supporting_input_count', v_supporting_input_count
    ),
    v_expires_at
  )
  RETURNING
    attempt.id,
    attempt.public_attempt_token,
    attempt.internal_result_classification,
    attempt.public_result_classification,
    attempt.candidate_count_classification,
    attempt.matched_person_id,
    attempt.matched_component_id,
    attempt.review_reason,
    attempt.status,
    attempt.expires_at
  INTO
    attempt_id,
    public_attempt_token,
    internal_result_classification,
    public_result_classification,
    candidate_count_classification,
    matched_person_id,
    matched_component_id,
    review_reason,
    status,
    expires_at;

  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. finalize_member_identity_activation(): include COPILOT in the role
--    instances it creates; scope the attendees.person_id write (and the
--    ownership-conflict guard ahead of it) to PILOT roles only, since
--    that column is the Pilot-only bridge and a Co-Pilot/Additional
--    Participant resolving to a different Person than the attendee's
--    existing Pilot is not a conflict; and establish canonical
--    Person x Event participation for every role instance in the
--    resolved component, closing the gap where new linkage never
--    produced a participation row.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_member_identity_activation(
  p_attempt_token text,
  p_auth_user_id uuid,
  p_verified_channel text,
  p_verified_destination_hash text,
  p_request_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL,
  p_request_source text DEFAULT 'member_activation_api'
)
RETURNS TABLE(
  activation_status text,
  activated_person_id uuid,
  auth_link_created boolean,
  stage5b_component_resolved boolean,
  attendees_linked_count bigint,
  role_instances_created_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_attempt public.identity_claim_attempts%ROWTYPE;
  v_person_id uuid;
  v_existing_auth_link public.person_auth_accounts%ROWTYPE;
  v_any_primary_exists boolean;
  v_component_resolved public.identity_component_resolutions%ROWTYPE;
  v_linked_count bigint := 0;
  v_role_insert_count bigint := 0;
  v_component_resolution_performed boolean := false;
  v_display_first text;
  v_display_last text;
  v_component_role_keys text[];
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.identity_claim_attempts
  WHERE public_attempt_token = p_attempt_token
  LIMIT 1;

  IF v_attempt.id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_attempt.public_result_classification <> 'CONTINUE_VERIFICATION'
     OR v_attempt.status <> 'completed'
     OR v_attempt.expires_at < now()
  THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      'activation_finalize',
      'rejected',
      jsonb_build_object('reason', 'attempt_not_eligible'),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.identity_claim_verification_challenges c
    WHERE c.attempt_id = v_attempt.id
      AND c.channel = p_verified_channel
      AND c.destination_hash = p_verified_destination_hash
      AND c.status = 'consumed'
      AND c.consumed_at IS NOT NULL
    ORDER BY c.consumed_at DESC
    LIMIT 1
  ) THEN
    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      'activation_finalize',
      'rejected',
      jsonb_build_object('reason', 'verification_not_consumed'),
      p_request_ip_hash,
      p_user_agent_hash
    );

    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_attempt.matched_person_id IS NOT NULL THEN
    v_person_id := v_attempt.matched_person_id;
  ELSIF v_attempt.matched_component_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_attempt.matched_component_id));

    SELECT *
    INTO v_component_resolved
    FROM public.identity_component_resolutions icr
    WHERE icr.component_id = v_attempt.matched_component_id
    LIMIT 1
    FOR UPDATE;

    IF v_component_resolved.id IS NOT NULL THEN
      v_person_id := v_component_resolved.person_id;
    ELSE
      SELECT
        min(initcap(coalesce(g.normalized_first_name, 'member'))),
        min(initcap(coalesce(g.normalized_last_name, 'claim')))
      INTO v_display_first, v_display_last
      FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id) g
      WHERE g.normalized_first_name IS NOT NULL
        AND g.normalized_last_name IS NOT NULL;

      INSERT INTO public.people (
        display_first_name,
        display_last_name,
        preferred_name,
        status
      ) VALUES (
        coalesce(v_display_first, 'Member'),
        coalesce(v_display_last, 'Claim'),
        NULL,
        'active'
      )
      RETURNING id INTO v_person_id;

      INSERT INTO public.identity_component_resolutions (
        component_id,
        person_id,
        resolved_by_attempt_id,
        metadata
      ) VALUES (
        v_attempt.matched_component_id,
        v_person_id,
        v_attempt.id,
        jsonb_build_object('request_source', coalesce(nullif(trim(coalesce(p_request_source, '')), ''), 'member_activation_api'))
      );

      v_component_resolution_performed := true;
    END IF;

    -- Capture this component's full role set once, before any role
    -- instance for it is inserted below. get_unresolved_identity_component_roles
    -- excludes any role that already has a person_role_instances row, so
    -- a second call after the INSERT would silently omit the roles just
    -- linked -- this array is what makes the participation-establishment
    -- step below correct regardless of insert order.
    v_component_role_keys := ARRAY(
      SELECT cr.role_instance_key
      FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id) cr
      WHERE cr.identity_role IN ('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER')
    );

    WITH component_roles AS (
      SELECT *
      FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id)
    ),
    conflicting_attendees AS (
      -- attendees.person_id is the PILOT-only bridge. A different
      -- Person already owning it is only a genuine conflict for the
      -- PILOT role in this component; a Co-Pilot or Additional
      -- Participant resolving to a different Person than that
      -- attendee's Pilot is expected, not an ownership violation.
      SELECT DISTINCT a.id
      FROM component_roles cr
      JOIN public.attendees a ON a.id = cr.attendee_id
      WHERE cr.identity_role = 'PILOT'
        AND a.person_id IS NOT NULL
        AND a.person_id <> v_person_id
    )
    SELECT count(*)
    INTO v_linked_count
    FROM conflicting_attendees;

    IF v_linked_count > 0 THEN
      RAISE EXCEPTION 'Stage8B ownership violation: component attendees already linked to another person';
    END IF;

    UPDATE public.attendees a
    SET person_id = v_person_id
    WHERE a.id IN (
      SELECT DISTINCT cr.attendee_id
      FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id) cr
      WHERE cr.identity_role = 'PILOT'
    )
      AND a.person_id IS NULL;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;

    INSERT INTO public.person_role_instances (
      person_id,
      tenant_id,
      event_id,
      attendee_id,
      identity_role,
      household_member_id,
      source_table,
      source_record_id,
      attribution_method,
      evidence_source,
      source_manifest_version,
      source_role_instance_key
    )
    SELECT
      v_person_id,
      NULL,
      cr.event_id,
      cr.attendee_id,
      cr.identity_role,
      cr.household_member_id,
      cr.source_table,
      cr.source_record_id,
      'member_claim_verified',
      'stage8b_member_identity_activation',
      '20260727120200_stage8b_proof_of_possession_activation.sql',
      cr.role_instance_key
    FROM public.get_unresolved_identity_component_roles(v_attempt.matched_component_id) cr
    WHERE cr.identity_role IN ('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER')
    ON CONFLICT (source_role_instance_key) DO NOTHING;

    GET DIAGNOSTICS v_role_insert_count = ROW_COUNT;

    -- Every role instance belonging to this component -- freshly
    -- inserted above or already present from a prior activation -- must
    -- have a canonical Person x Event Participation row.
    -- establish_person_event_participation_from_role_instance is
    -- idempotent (ON CONFLICT DO NOTHING on both the participation row
    -- and its evidence row), so looping over the full captured set on
    -- every finalize call is safe.
    PERFORM public.establish_person_event_participation_from_role_instance(pri.id, p_auth_user_id)
    FROM public.person_role_instances pri
    WHERE pri.source_role_instance_key = ANY(v_component_role_keys);
  ELSE
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_person_id IS NULL THEN
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, false, false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing_auth_link
  FROM public.person_auth_accounts paa
  WHERE paa.auth_user_id = p_auth_user_id
  LIMIT 1
  FOR UPDATE;

  IF v_existing_auth_link.id IS NOT NULL AND v_existing_auth_link.person_id <> v_person_id THEN
    RAISE EXCEPTION 'Stage8B ownership violation: auth user already linked to a different canonical person';
  END IF;

  IF v_existing_auth_link.id IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.person_auth_accounts paa
      WHERE paa.person_id = v_person_id
        AND paa.status = 'active'
        AND paa.is_primary = true
    ) INTO v_any_primary_exists;

    INSERT INTO public.person_auth_accounts (
      person_id,
      auth_user_id,
      status,
      is_primary,
      linked_at,
      verified_at
    ) VALUES (
      v_person_id,
      p_auth_user_id,
      'active',
      NOT coalesce(v_any_primary_exists, false),
      now(),
      now()
    );

    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      person_id,
      component_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      v_person_id,
      v_attempt.matched_component_id,
      'auth_link_upsert',
      'ok',
      jsonb_build_object('created', true),
      p_request_ip_hash,
      p_user_agent_hash
    );

    auth_link_created := true;
  ELSE
    UPDATE public.person_auth_accounts
    SET
      status = 'active',
      verified_at = coalesce(verified_at, now()),
      retired_at = NULL,
      updated_at = now()
    WHERE id = v_existing_auth_link.id;

    INSERT INTO public.identity_activation_audit (
      attempt_id,
      auth_user_id,
      person_id,
      component_id,
      action,
      status,
      details,
      request_ip_hash,
      user_agent_hash
    ) VALUES (
      v_attempt.id,
      p_auth_user_id,
      v_person_id,
      v_attempt.matched_component_id,
      'auth_link_upsert',
      'ok',
      jsonb_build_object('created', false),
      p_request_ip_hash,
      p_user_agent_hash
    );

    auth_link_created := false;
  END IF;

  INSERT INTO public.identity_activation_audit (
    attempt_id,
    auth_user_id,
    person_id,
    component_id,
    action,
    status,
    details,
    request_ip_hash,
    user_agent_hash
  ) VALUES (
    v_attempt.id,
    p_auth_user_id,
    v_person_id,
    v_attempt.matched_component_id,
    'activation_finalize',
    'ok',
    jsonb_build_object(
      'stage5b_component_resolved', v_component_resolution_performed,
      'attendees_linked_count', v_linked_count,
      'role_instances_created_count', v_role_insert_count
    ),
    p_request_ip_hash,
    p_user_agent_hash
  );

  activation_status := 'ACTIVATED';
  activated_person_id := v_person_id;
  stage5b_component_resolved := v_component_resolution_performed;
  attendees_linked_count := v_linked_count;
  role_instances_created_count := v_role_insert_count;

  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. resolve_member_account(): determine event membership from canonical
--    Person x Event Participation (role-independent), not from the
--    Pilot-only attendees.person_id bridge. attendees/events remain the
--    display/session projection this function has always returned.
--    Signature and output shape are unchanged, so every existing caller
--    (memberAccountSession.ts, /member/login, /member/account) is
--    unaffected.
-- ---------------------------------------------------------------------

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
    -- Fail closed on ambiguous auth links, via the shared, governed
    -- primitive. Unchanged from the prior version of this function.
    ------------------------------------------------------------------

    SELECT r.status, r.person_id
      INTO v_link_status, v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS r;

    IF v_link_status IS DISTINCT FROM 'resolved' THEN
        RETURN;
    END IF;

    ------------------------------------------------------------------
    -- Canonical Person x Event Participation determines which Events
    -- this Person legitimately participates in -- role-independent, so
    -- a Pilot, Co-Pilot, or Additional Participant role instance all
    -- resolve identically. attendees.person_id is never read here: it
    -- is the Pilot-only registration-owner bridge, not a universal
    -- Person slot. The attendee row is joined only to keep this
    -- function's existing display/session projection unchanged. DISTINCT
    -- guards against a Person who holds more than one role instance on
    -- the same attendee/event (e.g. a governed PILOT role instance
    -- alongside a mirrored HOUSEHOLD_MEMBER row for that same
    -- registration) surfacing as duplicate rows.
    ------------------------------------------------------------------

    RETURN QUERY
    SELECT DISTINCT
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
    FROM public.person_event_participations pep
    JOIN public.person_role_instances pri
      ON pri.person_id = pep.person_id
     AND pri.event_id = pep.event_id
    JOIN public.attendees a ON a.id = pri.attendee_id
    JOIN public.events e ON e.id = pep.event_id
    WHERE pep.person_id = v_person_id
      AND pep.participation_state = 'eligible'
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true
    ORDER BY e.start_date DESC NULLS LAST;

END;
$function$;

-- ---------------------------------------------------------------------
-- 6. Backfill: any person_role_instances row created between the
--    one-time backfill in 20260815100000 and this migration (i.e. every
--    Stage 8B activation since finalize_member_identity_activation did
--    not itself establish participation) may still be missing its
--    canonical Person x Event Participation row. Close that gap the same
--    safe, deterministic way the original backfill did: derive strictly
--    from already-governed role instances, nothing else.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  FOR v_role_id IN
    SELECT pri.id
    FROM public.person_role_instances pri
    LEFT JOIN public.person_event_participations pep
      ON pep.person_id = pri.person_id
     AND pep.event_id = pri.event_id
    WHERE pep.id IS NULL
  LOOP
    PERFORM public.establish_person_event_participation_from_role_instance(v_role_id, NULL);
  END LOOP;
END;
$$;

COMMIT;
