-- Repairs the matched_person_id fast path in finalize_member_identity_activation()
-- so it satisfies the settled Role-independent Person continuity invariant
-- (Domain Model v2.2) rather than only half of it.
--
-- Audit finding (traced against 20260817120000_establish_copilot_additional_participant_person_linkage.sql,
-- the current live definition -- that file itself is left untouched, this
-- is a forward repair):
--
--   IF v_attempt.matched_person_id IS NOT NULL THEN
--     v_person_id := v_attempt.matched_person_id;
--   ELSIF v_attempt.matched_component_id IS NOT NULL THEN
--     ... create/reuse Person, insert person_role_instances, write the
--         PILOT-only attendees.person_id bridge, establish
--         person_event_participations ...
--   ELSE
--     RETURN QUERY SELECT 'REJECTED' ...
--   END IF;
--
-- 1. Confirmed: the matched_person_id branch terminates before any
--    person_role_instances insert -- it does nothing but assign
--    v_person_id and fall through to the auth-account linking step below.
-- 2. Confirmed: it terminates before establish_person_event_participation_from_role_instance
--    is ever called.
-- 3. Confirmed: for a new Pilot registration reached via this branch,
--    attendees.person_id is left NULL -- no UPDATE touches it here.
-- 4. Confirmed: no other trigger, function, or scheduled job establishes
--    person_role_instances or person_event_participations as a side
--    effect of a person_auth_accounts write. The only triggers on
--    people/person_auth_accounts/person_role_instances/person_event_participations
--    anywhere in supabase/migrations are updated_at maintenance and the
--    append-only-evidence guard added in 20260815100000 -- none perform
--    linkage. establish_person_event_participation_from_role_instance is
--    only ever invoked from finalize_member_identity_activation's
--    matched_component_id branch, from the two one-time backfill DO
--    blocks (20260815100000, 20260817120000), and from nowhere else.
--    identity_claim_attempts.matched_person_id and matched_component_id
--    are mutually exclusive by CHECK constraint
--    (identity_claim_attempts_single_match_target), so no later branch of
--    the same finalize call ever performs the missing work either.
-- 5. Confirmed: the gap is role-independent -- the matched_person_id
--    branch does not inspect identity_role at all, so it is identically
--    incomplete regardless of whether the new registration would be
--    PILOT, COPILOT, or HOUSEHOLD_MEMBER.
--
-- Gap confirmed. Repair below.
--
-- Why a new discovery query is unavoidable (not a second linkage
-- algorithm): matched_component_id and matched_person_id are mutually
-- exclusive on identity_claim_attempts by design (single match target),
-- so a claim resolved via the canonical-Person path carries no
-- component_id and therefore no reference to which specific attendee or
-- household record the new registration is. get_unresolved_identity_component_roles
-- cannot be reused as-is because it has nothing to key on here.
-- get_unresolved_verified_destination_roles, added below, fills exactly
-- that one gap -- finding still-unresolved roles matching the destination
-- that was just cryptographically verified via OTP in *this* activation
-- (p_verified_channel/p_verified_destination_hash), restricted to name
-- variants already known for this exact Person (display name, or the
-- mirrored name on any role instance this Person already holds). That is
-- the same two-factor bar (a matching identifier alone is never
-- conclusive) every other attribution path in this schema already
-- requires, applied from the "Person already known" direction instead of
-- the "claimant unknown" direction. It creates no Person, resolves no
-- ambiguity, and performs no graph/component computation of its own.
--
-- Once the specific role rows are found, the actual linkage --
-- person_role_instances insert shape, the PILOT-only attendees.person_id
-- write and its ownership guard, and
-- establish_person_event_participation_from_role_instance -- is the exact
-- same algorithm already proven in 20260817120000's matched_component_id
-- branch, applied here to a differently-sourced role set. Nothing about
-- how a role instance is created, guarded, or turned into participation
-- changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_unresolved_verified_destination_roles(
  p_person_id uuid,
  p_channel text,
  p_destination_hash text
)
RETURNS TABLE(
  role_instance_key text,
  attendee_id uuid,
  event_id uuid,
  identity_role text,
  household_member_id uuid,
  source_table text,
  source_record_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH person_name_variants AS (
  SELECT DISTINCT
    lower(regexp_replace(trim(coalesce(p.display_first_name, '')), '\s+', ' ', 'g')) AS first_name,
    lower(regexp_replace(trim(coalesce(p.display_last_name, '')), '\s+', ' ', 'g')) AS last_name
  FROM public.people p
  WHERE p.id = p_person_id

  UNION

  SELECT DISTINCT
    lower(regexp_replace(trim(coalesce(a.pilot_first, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(a.pilot_last, '')), '\s+', ' ', 'g'))
  FROM public.person_role_instances pri
  JOIN public.attendees a ON a.id = pri.attendee_id
  WHERE pri.person_id = p_person_id
    AND pri.identity_role = 'PILOT'

  UNION

  SELECT DISTINCT
    lower(regexp_replace(trim(coalesce(a.copilot_first, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(a.copilot_last, '')), '\s+', ' ', 'g'))
  FROM public.person_role_instances pri
  JOIN public.attendees a ON a.id = pri.attendee_id
  WHERE pri.person_id = p_person_id
    AND pri.identity_role = 'COPILOT'

  UNION

  SELECT DISTINCT
    lower(regexp_replace(trim(coalesce(hm.first_name, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(hm.last_name, '')), '\s+', ' ', 'g'))
  FROM public.person_role_instances pri
  JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
  WHERE pri.person_id = p_person_id
    AND pri.identity_role = 'HOUSEHOLD_MEMBER'
),
candidate_roles AS (
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
    (
      p_channel = 'email'
      AND a.email IS NOT NULL
      AND md5(lower(trim(a.email))) = p_destination_hash
    ) OR (
      p_channel = 'sms'
      AND coalesce(a.cell_phone, a.primary_phone, a.phone) IS NOT NULL
      AND md5(
        CASE
          WHEN length(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g')
        END
      ) = p_destination_hash
    ) AS destination_matches
  FROM public.attendees a

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
    (
      p_channel = 'email'
      AND a.copilot_email IS NOT NULL
      AND md5(lower(trim(a.copilot_email))) = p_destination_hash
    ) OR (
      p_channel = 'sms'
      AND a.copilot_cell_phone IS NOT NULL
      AND md5(
        CASE
          WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')
        END
      ) = p_destination_hash
    )
  FROM public.attendees a
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
    (
      p_channel = 'email'
      AND hm.email IS NOT NULL
      AND md5(lower(trim(hm.email))) = p_destination_hash
    ) OR (
      p_channel = 'sms'
      AND hm.cell_phone IS NOT NULL
      AND md5(
        CASE
          WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
            AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
          THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
          ELSE regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')
        END
      ) = p_destination_hash
    )
  FROM public.attendee_household_members hm
)
SELECT
  cr.role_instance_key,
  cr.attendee_id,
  cr.event_id,
  cr.identity_role,
  cr.household_member_id,
  cr.source_table,
  cr.source_record_id
FROM candidate_roles cr
JOIN person_name_variants pnv
  ON pnv.first_name = cr.normalized_first_name
 AND pnv.last_name = cr.normalized_last_name
WHERE p_person_id IS NOT NULL
  AND p_channel IN ('email', 'sms')
  AND nullif(trim(coalesce(p_destination_hash, '')), '') IS NOT NULL
  AND cr.destination_matches
  AND cr.normalized_first_name IS NOT NULL
  AND cr.normalized_last_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.person_role_instances pri
    WHERE pri.source_role_instance_key = cr.role_instance_key
  );
$$;

REVOKE ALL ON FUNCTION public.get_unresolved_verified_destination_roles(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_unresolved_verified_destination_roles(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_unresolved_verified_destination_roles(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_unresolved_verified_destination_roles(uuid, text, text) TO service_role;

-- finalize_member_identity_activation(): the matched_person_id branch now
-- continues governed Event-role linkage for the exact destination that
-- was just verified, using the identical insert/guard/establish steps
-- already proven for the matched_component_id branch. Every other line
-- of this function (attempt validation, verification-consumed check, the
-- entire matched_component_id branch, auth-account linking, audit
-- writes, return shape) is byte-identical to the version created in
-- 20260817120000.
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

    -- Recognizing an existing Person is not sufficient by itself
    -- (Domain Model, Role-independent Person continuity). If the
    -- destination just cryptographically verified via OTP also matches
    -- a still-unresolved role instance whose name is already known for
    -- this Person, establish that Event's governed role/participation
    -- for the SAME Person now -- the exact linkage steps already proven
    -- below for the matched_component_id branch, sourced from this
    -- Person-scoped, verified-destination lookup instead of a discovered
    -- component. No Person is created or reconciled here.
    v_component_role_keys := ARRAY(
      SELECT vr.role_instance_key
      FROM public.get_unresolved_verified_destination_roles(
        v_person_id, p_verified_channel, p_verified_destination_hash
      ) vr
      WHERE vr.identity_role IN ('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER')
    );

    IF array_length(v_component_role_keys, 1) > 0 THEN
      IF EXISTS (
        SELECT 1
        FROM public.get_unresolved_verified_destination_roles(
          v_person_id, p_verified_channel, p_verified_destination_hash
        ) vr
        JOIN public.attendees a ON a.id = vr.attendee_id
        WHERE vr.identity_role = 'PILOT'
          AND a.person_id IS NOT NULL
          AND a.person_id <> v_person_id
      ) THEN
        RAISE EXCEPTION 'Stage8B ownership violation: verified-destination attendee already linked to another person';
      END IF;

      UPDATE public.attendees a
      SET person_id = v_person_id
      WHERE a.id IN (
        SELECT DISTINCT vr.attendee_id
        FROM public.get_unresolved_verified_destination_roles(
          v_person_id, p_verified_channel, p_verified_destination_hash
        ) vr
        WHERE vr.identity_role = 'PILOT'
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
        vr.event_id,
        vr.attendee_id,
        vr.identity_role,
        vr.household_member_id,
        vr.source_table,
        vr.source_record_id,
        'member_claim_verified',
        'stage8b_matched_person_verified_destination_linkage',
        '20260817130000_establish_matched_person_fast_path_role_linkage.sql',
        vr.role_instance_key
      FROM public.get_unresolved_verified_destination_roles(
        v_person_id, p_verified_channel, p_verified_destination_hash
      ) vr
      ON CONFLICT (source_role_instance_key) DO NOTHING;

      GET DIAGNOSTICS v_role_insert_count = ROW_COUNT;

      PERFORM public.establish_person_event_participation_from_role_instance(pri.id, p_auth_user_id)
      FROM public.person_role_instances pri
      WHERE pri.source_role_instance_key = ANY(v_component_role_keys);
    END IF;
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
-- No backfill in this migration -- deliberately.
--
-- Unlike the d9bf930/20260817120000 gap (role instances that already
-- existed but lacked participation), the matched_person_id branch never
-- created a role instance at all, so there is no orphaned row to adopt
-- here: this repair changes behavior only for finalize_member_identity_activation
-- calls from this point forward.
--
-- Whether any *historical* matched_person_id activation left a real
-- participant's Event registration unlinked cannot be established safely
-- as a byproduct of this migration: identity_claim_attempts stores only
-- a one-time destination hash tied to its own attempt, not a durable,
-- reusable record of a Person's verified identifiers, so reconstructing
-- "what this Person had already proven possession of" after the fact
-- would mean inferring evidence this schema does not keep, not replaying
-- it. Person-continuity rules require that inference to be governed, not
-- assumed. If historical repair is wanted, it is a separate,
-- explicitly-scoped reconciliation workstream (per AGENTS.md: identify
-- rather than silently expand this task) -- not attempted here.
-- ---------------------------------------------------------------------

COMMIT;
