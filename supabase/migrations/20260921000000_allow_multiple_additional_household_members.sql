-- Multiple named Additional Participants per registration.
--
-- CANONICAL MODEL (unchanged vocabulary):
--   attendee_household_members.person_role IN ('pilot','copilot','additional')
--     * 'pilot'      : exactly one per registration  (application invariant)
--     * 'copilot'    : zero or one per registration   (DB-enforced, below)
--     * 'additional' : zero to many per registration  (each an individual
--                       row, identified by attendee_household_members.id,
--                       ordered by sort_order)
--
-- The three-person ceiling came from ONE object: the blanket
-- attendee_household_members_attendee_role_unique UNIQUE (attendee_id,
-- person_role) (baseline 20260617000000, never altered). Every downstream
-- consumer -- person_role_instances (source_role_instance_key
-- 'household_member:<id>'), person_event_participations, the identity
-- convergence triggers, the two household audit tables, submit_member_checkin
-- (set-based), get_my_household_members, Admin Check-In, the attendee
-- locator, and save_participant_identity's own edit-by-id path -- already
-- key on the row id, not on (attendee_id, person_role). This migration only
-- lifts the constraint and teaches the two admin write RPCs to address a
-- specific 'additional' row.
--
-- Preserved verbatim: person_role vocabulary/CHECK, RLS (writes already go
-- only through the SECURITY DEFINER RPCs; 20260818140000/20260818160000
-- REVOKED direct authenticated INSERT/UPDATE/DELETE), event derivation,
-- event.attendees.manage authority, the immutable command-audit surface,
-- the AFTER INSERT/UPDATE identity-reconciliation triggers, the Pilot-only
-- attendees.person_id bridge, and record_participant_capacity_increase's
-- atomic "raise capacity + add exactly one participant, or roll back both"
-- behaviour.
--
-- No data backfill: every existing registration already holds at most one
-- row per role (the blanket constraint guaranteed it; the production
-- diagnosis in 20260901000000 confirmed rosters of exactly two), so the
-- partial unique index builds without conflict.

BEGIN;

-- ============================================================
-- Part 1: manage_attendee_household_member gains an optional
-- p_household_member_id. Signature changes (a ninth parameter,
-- defaulted), so DROP + CREATE, not CREATE OR REPLACE -- the
-- 20260805160000 precedent. The eight-argument call shape used
-- by the import commit RPC (20260822110000) and the admin
-- client still resolves against the nine-parameter function
-- (ninth defaults to NULL).
--
-- Behaviour:
--   * p_household_member_id set  -> target EXACTLY that row
--     (update or delete). Fail closed if the row does not belong
--     to p_attendee_id, or if its stored person_role does not
--     match p_person_role. This is the only way to edit or
--     delete one of several 'additional' participants.
--   * p_household_member_id null, role 'additional', not delete
--     -> always INSERT a brand-new participant row (never an
--     upsert). A delete of an 'additional' participant MUST
--     supply the row id.
--   * p_household_member_id null, role 'pilot'/'copilot'
--     -> the existing role-based singleton upsert/delete,
--     unchanged except the ON CONFLICT arbiter is now the
--     partial unique index.
-- ============================================================

DROP FUNCTION IF EXISTS public.manage_attendee_household_member(
  uuid, text, boolean, text, text, text, text, text
);

CREATE FUNCTION public.manage_attendee_household_member(
  p_attendee_id uuid,
  p_person_role text,
  p_delete boolean,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_nickname text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_cell_phone text DEFAULT NULL,
  p_household_member_id uuid DEFAULT NULL
)
RETURNS public.attendee_household_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_event_id uuid;
  v_before public.attendee_household_members%ROWTYPE;
  v_after public.attendee_household_members%ROWTYPE;
  v_display_name text;
  v_next_sort integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_attendee_id IS NULL THEN
    RAISE EXCEPTION 'missing_attendee_id';
  END IF;

  SELECT a.event_id INTO v_event_id FROM public.attendees AS a WHERE a.id = p_attendee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found';
  END IF;

  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_person_role NOT IN ('pilot', 'copilot', 'additional') THEN
    RAISE EXCEPTION 'invalid_person_role';
  END IF;

  v_display_name := coalesce(
    nullif(btrim(p_nickname), ''),
    nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), '')
  );

  -- --------------------------------------------------------
  -- Path A: an explicit row id -- edit or delete that one row.
  -- --------------------------------------------------------
  IF p_household_member_id IS NOT NULL THEN
    SELECT * INTO v_before
    FROM public.attendee_household_members
    WHERE id = p_household_member_id AND attendee_id = p_attendee_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'household_member_not_found';
    END IF;

    IF v_before.person_role IS DISTINCT FROM p_person_role THEN
      RAISE EXCEPTION 'household_member_role_mismatch';
    END IF;

    IF p_delete THEN
      DELETE FROM public.attendee_household_members WHERE id = v_before.id;

      INSERT INTO public.attendee_household_member_command_audit (
        household_member_id, attendee_id, event_id, person_role,
        actor_auth_user_id, action, before_state
      )
      VALUES (
        v_before.id, p_attendee_id, v_event_id, v_before.person_role,
        auth.uid(), 'deleted',
        jsonb_build_object(
          'person_role', v_before.person_role,
          'first_name', v_before.first_name,
          'last_name', v_before.last_name,
          'nickname', v_before.nickname,
          'display_name', v_before.display_name,
          'email', v_before.email,
          'cell_phone', v_before.cell_phone,
          'participant_status', v_before.participant_status
        )
      );

      RETURN NULL;
    END IF;

    UPDATE public.attendee_household_members SET
      first_name = nullif(btrim(p_first_name), ''),
      last_name = nullif(btrim(p_last_name), ''),
      nickname = nullif(btrim(p_nickname), ''),
      display_name = v_display_name,
      email = nullif(btrim(p_email), ''),
      cell_phone = nullif(btrim(p_cell_phone), ''),
      participant_status = 'identified'
    WHERE id = v_before.id
    RETURNING * INTO v_after;

    INSERT INTO public.attendee_household_member_command_audit (
      household_member_id, attendee_id, event_id, person_role,
      actor_auth_user_id, action, before_state, after_state
    )
    VALUES (
      v_after.id, p_attendee_id, v_event_id, v_after.person_role,
      auth.uid(), 'updated',
      jsonb_build_object(
        'person_role', v_before.person_role,
        'first_name', v_before.first_name,
        'last_name', v_before.last_name,
        'nickname', v_before.nickname,
        'display_name', v_before.display_name,
        'email', v_before.email,
        'cell_phone', v_before.cell_phone,
        'participant_status', v_before.participant_status
      ),
      jsonb_build_object(
        'person_role', v_after.person_role,
        'first_name', v_after.first_name,
        'last_name', v_after.last_name,
        'nickname', v_after.nickname,
        'display_name', v_after.display_name,
        'email', v_after.email,
        'cell_phone', v_after.cell_phone,
        'participant_status', v_after.participant_status
      )
    );

    RETURN v_after;
  END IF;

  -- --------------------------------------------------------
  -- Path B: 'additional' with no row id -> a brand-new row.
  -- A delete must name the row.
  -- --------------------------------------------------------
  IF p_person_role = 'additional' THEN
    IF p_delete THEN
      RAISE EXCEPTION 'household_member_id_required';
    END IF;

    SELECT coalesce(max(hm.sort_order), -1) + 1 INTO v_next_sort
    FROM public.attendee_household_members AS hm
    WHERE hm.attendee_id = p_attendee_id;

    INSERT INTO public.attendee_household_members (
      event_id, attendee_id, person_role, sort_order, first_name, last_name,
      nickname, display_name, email, cell_phone, participant_status
    )
    VALUES (
      v_event_id, p_attendee_id, 'additional', v_next_sort,
      nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''),
      nullif(btrim(p_nickname), ''), v_display_name,
      nullif(btrim(p_email), ''), nullif(btrim(p_cell_phone), ''), 'identified'
    )
    RETURNING * INTO v_after;

    INSERT INTO public.attendee_household_member_command_audit (
      household_member_id, attendee_id, event_id, person_role,
      actor_auth_user_id, action, before_state, after_state
    )
    VALUES (
      v_after.id, p_attendee_id, v_event_id, 'additional',
      auth.uid(), 'created', NULL,
      jsonb_build_object(
        'person_role', v_after.person_role,
        'first_name', v_after.first_name,
        'last_name', v_after.last_name,
        'nickname', v_after.nickname,
        'display_name', v_after.display_name,
        'email', v_after.email,
        'cell_phone', v_after.cell_phone,
        'participant_status', v_after.participant_status
      )
    );

    RETURN v_after;
  END IF;

  -- --------------------------------------------------------
  -- Path C: 'pilot' / 'copilot' with no row id -> role-based
  -- singleton upsert / delete (behaviour identical to the
  -- pre-migration function; only the ON CONFLICT arbiter is
  -- now the partial unique index).
  -- --------------------------------------------------------
  SELECT * INTO v_before
  FROM public.attendee_household_members
  WHERE attendee_id = p_attendee_id AND person_role = p_person_role
  FOR UPDATE;

  IF p_delete THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'household_member_not_found';
    END IF;

    DELETE FROM public.attendee_household_members
    WHERE attendee_id = p_attendee_id AND person_role = p_person_role;

    INSERT INTO public.attendee_household_member_command_audit (
      household_member_id, attendee_id, event_id, person_role,
      actor_auth_user_id, action, before_state
    )
    VALUES (
      v_before.id, p_attendee_id, v_event_id, p_person_role,
      auth.uid(), 'deleted',
      jsonb_build_object(
        'person_role', v_before.person_role,
        'first_name', v_before.first_name,
        'last_name', v_before.last_name,
        'nickname', v_before.nickname,
        'display_name', v_before.display_name,
        'email', v_before.email,
        'cell_phone', v_before.cell_phone,
        'participant_status', v_before.participant_status
      )
    );

    RETURN NULL;
  END IF;

  INSERT INTO public.attendee_household_members (
    event_id, attendee_id, person_role, first_name, last_name, nickname,
    display_name, email, cell_phone, participant_status
  )
  VALUES (
    v_event_id, p_attendee_id, p_person_role,
    nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''),
    nullif(btrim(p_nickname), ''), v_display_name,
    nullif(btrim(p_email), ''), nullif(btrim(p_cell_phone), ''), 'identified'
  )
  ON CONFLICT (attendee_id, person_role) WHERE person_role IN ('pilot', 'copilot')
  DO UPDATE SET
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    nickname = excluded.nickname,
    display_name = excluded.display_name,
    email = excluded.email,
    cell_phone = excluded.cell_phone,
    participant_status = 'identified'
  RETURNING * INTO v_after;

  INSERT INTO public.attendee_household_member_command_audit (
    household_member_id, attendee_id, event_id, person_role,
    actor_auth_user_id, action, before_state, after_state
  )
  VALUES (
    v_after.id, p_attendee_id, v_event_id, p_person_role,
    auth.uid(),
    CASE WHEN v_before.id IS NULL THEN 'created' ELSE 'updated' END,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE jsonb_build_object(
      'person_role', v_before.person_role,
      'first_name', v_before.first_name,
      'last_name', v_before.last_name,
      'nickname', v_before.nickname,
      'display_name', v_before.display_name,
      'email', v_before.email,
      'cell_phone', v_before.cell_phone,
      'participant_status', v_before.participant_status
    ) END,
    jsonb_build_object(
      'person_role', v_after.person_role,
      'first_name', v_after.first_name,
      'last_name', v_after.last_name,
      'nickname', v_after.nickname,
      'display_name', v_after.display_name,
      'email', v_after.email,
      'cell_phone', v_after.cell_phone,
      'participant_status', v_after.participant_status
    )
  );

  RETURN v_after;
END;
$$;

ALTER FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text, uuid) TO authenticated;

-- ============================================================
-- Part 2: record_participant_capacity_increase -- signature and
-- every existing behaviour unchanged (atomic raise + add exactly
-- one participant, or roll back both; is_event_scoped_admin
-- reconciled to event.attendees.manage in 20260818170000). The
-- only change: the 'additional' branch INSERTs a NEW participant
-- row (a capacity-increase-with-participant always adds a person)
-- instead of upserting the one 'additional' row, and the
-- 'copilot' branch's ON CONFLICT is arbitrated by the partial
-- unique index. Straight CREATE OR REPLACE of the live
-- 20260818170000 body with those two edits.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_participant_capacity_increase(
  p_attendee_id uuid,
  p_new_capacity integer,
  p_note text DEFAULT NULL,
  p_participant_role text DEFAULT NULL,
  p_copilot_first text DEFAULT NULL,
  p_copilot_last text DEFAULT NULL,
  p_copilot_nickname text DEFAULT NULL,
  p_copilot_email text DEFAULT NULL,
  p_additional_first_name text DEFAULT NULL,
  p_additional_last_name text DEFAULT NULL,
  p_additional_nickname text DEFAULT NULL,
  p_additional_email text DEFAULT NULL,
  p_additional_cell_phone text DEFAULT NULL
)
RETURNS public.attendees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_auth_user_id uuid;
  v_admin_id uuid;
  v_event_id uuid;
  v_previous_capacity integer;
  v_normalized_note text;
  v_copilot_supplied boolean;
  v_additional_supplied boolean;
  v_copilot_display_name text;
  v_additional_display_name text;
  v_additional_next_sort integer;
  v_roster_count integer;
  v_result public.attendees%ROWTYPE;
  v_before_household public.attendee_household_members%ROWTYPE;
  v_after_household public.attendee_household_members%ROWTYPE;
BEGIN
  -- 1. Validate the caller is authenticated.
  v_auth_user_id := auth.uid();

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Participant capacity adjustment authorization failed.';
  END IF;

  IF p_attendee_id IS NULL THEN
    RAISE EXCEPTION 'Participant capacity adjustment authorization failed.';
  END IF;

  -- 2. Validate the attendee exists and lock its row before deriving the
  --    old capacity, so concurrent increases serialize instead of racing.
  SELECT a.event_id, a.participant_capacity
    INTO v_event_id, v_previous_capacity
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant capacity adjustment authorization failed.';
  END IF;

  -- 3. Re-derive Event-scoped task authority fresh -- never trusted from
  --    the client. This is the entire authorization condition for this
  --    RPC. Reconciled by 20260818170000 from is_event_scoped_admin to the
  --    canonical event.attendees.manage task.
  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'Participant capacity adjustment authorization failed.';
  END IF;

  SELECT au.id INTO v_admin_id
  FROM public.admin_users AS au
  WHERE au.user_id = v_auth_user_id
    AND au.is_active = true;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Participant capacity adjustment authorization failed.';
  END IF;

  -- 4. Validate the requested capacity is actually an increase.
  IF p_new_capacity IS NULL OR p_new_capacity <= coalesce(v_previous_capacity, 0) THEN
    RAISE EXCEPTION 'New capacity must exceed the currently stored capacity.';
  END IF;

  -- 5. Validate the explicit mode selector and reject any request that
  --    does not clearly identify exactly one participant, or exactly none.
  v_copilot_supplied :=
    coalesce(btrim(p_copilot_first), '') <> ''
    OR coalesce(btrim(p_copilot_last), '') <> ''
    OR coalesce(btrim(p_copilot_email), '') <> '';

  v_additional_supplied :=
    coalesce(btrim(p_additional_first_name), '') <> ''
    OR coalesce(btrim(p_additional_last_name), '') <> ''
    OR coalesce(btrim(p_additional_email), '') <> ''
    OR coalesce(btrim(p_additional_cell_phone), '') <> '';

  IF p_participant_role IS NULL THEN
    -- Slot only. No household evidence may accompany this mode -- reject
    -- rather than silently ignore, so the mode is always explicit.
    IF v_copilot_supplied OR v_additional_supplied THEN
      RAISE EXCEPTION
        'Participant details were supplied without selecting "slot and participant" mode.';
    END IF;
  ELSIF p_participant_role = 'copilot' THEN
    IF NOT v_copilot_supplied THEN
      RAISE EXCEPTION
        'A Co-Pilot name is required to add a participant with this capacity increase.';
    END IF;
    IF v_additional_supplied THEN
      RAISE EXCEPTION
        'Only one participant role may be added with a single capacity increase.';
    END IF;
  ELSIF p_participant_role = 'additional' THEN
    IF NOT v_additional_supplied THEN
      RAISE EXCEPTION
        'An Additional Participant name is required to add a participant with this capacity increase.';
    END IF;
    IF v_copilot_supplied THEN
      RAISE EXCEPTION
        'Only one participant role may be added with a single capacity increase.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid participant role.';
  END IF;

  v_normalized_note := nullif(btrim(coalesce(p_note, '')), '');

  -- 6. Apply the capacity increase. The trigger-authorizing flag is set
  --    transaction-locally, immediately before the one UPDATE it covers.
  PERFORM set_config('epicentrax.capacity_increase_authorized', 'true', true);

  UPDATE public.attendees AS a
  SET participant_capacity = p_new_capacity
  WHERE a.id = p_attendee_id
  RETURNING a.* INTO v_result;

  -- 7. Write the operational audit record.
  INSERT INTO public.participant_capacity_adjustments (
    attendee_id,
    event_id,
    previous_capacity,
    new_capacity,
    actor_admin_user_id,
    actor_auth_user_id,
    note
  )
  VALUES (
    p_attendee_id,
    v_event_id,
    v_previous_capacity,
    p_new_capacity,
    v_admin_id,
    v_auth_user_id,
    v_normalized_note
  );

  -- 8. Slot-and-participant mode only: write exactly the one household row
  --    p_participant_role selected, and audit it atomically. Slot-only
  --    mode never reaches either branch. This function never deletes a
  --    household row and never touches the Pilot row. No Person resolution
  --    occurs here -- the row is preserved as unresolved Participation
  --    evidence, exactly like save_participant_identity.
  IF p_participant_role = 'copilot' THEN
    v_copilot_display_name := coalesce(
      nullif(btrim(p_copilot_nickname), ''),
      nullif(btrim(concat_ws(' ', p_copilot_first, p_copilot_last)), '')
    );

    SELECT * INTO v_before_household
    FROM public.attendee_household_members
    WHERE attendee_id = p_attendee_id AND person_role = 'copilot';

    INSERT INTO public.attendee_household_members (
      event_id, attendee_id, person_role, first_name, last_name, nickname,
      display_name, email, participant_status
    )
    VALUES (
      v_event_id, p_attendee_id, 'copilot',
      nullif(btrim(p_copilot_first), ''), nullif(btrim(p_copilot_last), ''),
      nullif(btrim(p_copilot_nickname), ''), v_copilot_display_name,
      nullif(btrim(p_copilot_email), ''), 'identified'
    )
    ON CONFLICT (attendee_id, person_role) WHERE person_role IN ('pilot', 'copilot')
    DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      nickname = excluded.nickname,
      display_name = excluded.display_name,
      email = excluded.email,
      participant_status = 'identified'
    RETURNING * INTO v_after_household;

    INSERT INTO public.attendee_household_member_command_audit (
      household_member_id, attendee_id, event_id, person_role,
      actor_auth_user_id, action, before_state, after_state
    )
    VALUES (
      v_after_household.id, p_attendee_id, v_event_id, 'copilot',
      v_auth_user_id,
      CASE WHEN v_before_household.id IS NULL THEN 'created' ELSE 'updated' END,
      CASE WHEN v_before_household.id IS NULL THEN NULL ELSE jsonb_build_object(
        'person_role', v_before_household.person_role,
        'first_name', v_before_household.first_name,
        'last_name', v_before_household.last_name,
        'nickname', v_before_household.nickname,
        'display_name', v_before_household.display_name,
        'email', v_before_household.email,
        'cell_phone', v_before_household.cell_phone,
        'participant_status', v_before_household.participant_status
      ) END,
      jsonb_build_object(
        'person_role', v_after_household.person_role,
        'first_name', v_after_household.first_name,
        'last_name', v_after_household.last_name,
        'nickname', v_after_household.nickname,
        'display_name', v_after_household.display_name,
        'email', v_after_household.email,
        'cell_phone', v_after_household.cell_phone,
        'participant_status', v_after_household.participant_status
      )
    );

  ELSIF p_participant_role = 'additional' THEN
    -- A capacity-increase-with-participant always adds a NEW named
    -- Additional Participant row. There may already be others; this never
    -- upserts an existing one.
    v_additional_display_name := coalesce(
      nullif(btrim(p_additional_nickname), ''),
      nullif(
        btrim(concat_ws(' ', p_additional_first_name, p_additional_last_name)),
        ''
      )
    );

    SELECT coalesce(max(hm.sort_order), -1) + 1 INTO v_additional_next_sort
    FROM public.attendee_household_members AS hm
    WHERE hm.attendee_id = p_attendee_id;

    INSERT INTO public.attendee_household_members (
      event_id, attendee_id, person_role, sort_order, first_name, last_name,
      nickname, display_name, email, cell_phone, participant_status
    )
    VALUES (
      v_event_id, p_attendee_id, 'additional', v_additional_next_sort,
      nullif(btrim(p_additional_first_name), ''),
      nullif(btrim(p_additional_last_name), ''),
      nullif(btrim(p_additional_nickname), ''), v_additional_display_name,
      nullif(btrim(p_additional_email), ''),
      nullif(btrim(p_additional_cell_phone), ''), 'identified'
    )
    RETURNING * INTO v_after_household;

    INSERT INTO public.attendee_household_member_command_audit (
      household_member_id, attendee_id, event_id, person_role,
      actor_auth_user_id, action, before_state, after_state
    )
    VALUES (
      v_after_household.id, p_attendee_id, v_event_id, 'additional',
      v_auth_user_id, 'created', NULL,
      jsonb_build_object(
        'person_role', v_after_household.person_role,
        'first_name', v_after_household.first_name,
        'last_name', v_after_household.last_name,
        'nickname', v_after_household.nickname,
        'display_name', v_after_household.display_name,
        'email', v_after_household.email,
        'cell_phone', v_after_household.cell_phone,
        'participant_status', v_after_household.participant_status
      )
    );
  END IF;

  -- 9. Validate the requested final roster/capacity state: the new capacity
  --    must cover the roster this same transaction leaves in place. A
  --    violation rolls back the capacity increase, the audit records, and
  --    any household write performed above -- all or nothing.
  SELECT count(*) INTO v_roster_count
  FROM public.attendee_household_members AS hm
  WHERE hm.attendee_id = p_attendee_id;

  IF v_roster_count > p_new_capacity THEN
    RAISE EXCEPTION
      'Requested capacity (%) is less than the resulting roster count (%).',
      p_new_capacity, v_roster_count;
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.record_participant_capacity_increase(
  uuid, integer, text, text, text, text, text, text, text, text, text, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, text, text, text, text, text, text, text, text, text, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, text, text, text, text, text, text, text, text, text, text, text
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;

-- ============================================================
-- Part 3: swap the blanket per-role uniqueness for a partial
-- unique index that keeps Pilot and Co-Pilot at 0..1 while
-- letting 'additional' be 0..N. Done AFTER the RPCs so the new
-- ON CONFLICT arbiter exists for every future call. No backfill:
-- existing rows already satisfy the partial predicate.
-- ============================================================

ALTER TABLE public.attendee_household_members
  DROP CONSTRAINT IF EXISTS attendee_household_members_attendee_role_unique;

CREATE UNIQUE INDEX IF NOT EXISTS attendee_household_members_singleton_role_uq
  ON public.attendee_household_members (attendee_id, person_role)
  WHERE person_role IN ('pilot', 'copilot');

COMMENT ON INDEX public.attendee_household_members_singleton_role_uq IS
  'Pilot and Co-Pilot are at most one per registration; person_role = ''additional'' is 0..N, each row individually identified by attendee_household_members.id and ordered by sort_order.';

COMMIT;
