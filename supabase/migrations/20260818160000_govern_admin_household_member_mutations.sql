-- Admin household-member mutation governance + audit trail.
--
-- Follow-up to the Household-Member Admin Audit-Trail Design workstream
-- and its Implementation Blueprint. Closes the deferred gap explicitly
-- called out in 20260818140000's header: Admin changes to
-- attendee_household_members had no audit trail equivalent to
-- household_member_identity_audit's existing member-side coverage.
--
-- Design decisions (settled by the blueprint, not re-litigated here):
--   * New table, not a reuse of household_member_identity_audit --
--     that table's action CHECK forbids 'delete' and its
--     authorization_basis CHECK is hard-coded to 'authenticated_person'
--     (member self-service only); loosening either would blur a table
--     whose whole meaning is governed member identity provenance.
--     actor_person_id NOT NULL is also structurally wrong for an Admin
--     actor: admin_users has no person_id column at all -- Admin is an
--     authority role, not a Person-participation role.
--   * Shape instead mirrors this codebase's own governed-admin-command
--     audit precedent -- event_photo_command_audit (20260811390000) and
--     agenda_category_command_audit (20260811380000): actor_auth_user_id
--     only, no authorization_basis column (the RPC's single hard-coded
--     task-authority check is the entire authorization story), no FK on
--     the subject/attendee/event id columns (bare uuid NOT NULL, so a
--     delete-audit row outlives the row it documents), immutable via a
--     BEFORE UPDATE OR DELETE trigger, deny-all RLS/REVOKE with the
--     SECURITY DEFINER RPC as the only write path.
--   * record_participant_capacity_increase's authorization basis
--     (is_event_scoped_admin, not event.attendees.manage) is
--     deliberately NOT reconciled here -- that is a second,
--     independent authority-policy question with its own access-delta
--     analysis, left to a separate follow-up workstream. This migration
--     only adds the audit write to that function; its authorization
--     check is untouched.
--
-- Deploy-safety note: the direct-write closure (Part 4) must ship in
-- the same release as the app/admin/attendees/page.tsx cutover to
-- manage_attendee_household_member -- applying this migration ahead of
-- that client change would RLS-deny in-flight Admin saves.

BEGIN;

-- ============================================================
-- Part 1: audit table.
-- ============================================================

CREATE TABLE public.attendee_household_member_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_member_id uuid NOT NULL,
  attendee_id uuid NOT NULL,
  event_id uuid NOT NULL,
  person_role text NOT NULL CHECK (person_role IN ('pilot', 'copilot', 'additional')),
  actor_auth_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendee_household_member_command_audit_attendee_idx
  ON public.attendee_household_member_command_audit (attendee_id, occurred_at DESC);
CREATE INDEX attendee_household_member_command_audit_event_idx
  ON public.attendee_household_member_command_audit (event_id, occurred_at DESC);

ALTER TABLE public.attendee_household_member_command_audit OWNER TO postgres;

COMMENT ON TABLE public.attendee_household_member_command_audit IS
  'Immutable provenance for governed Admin mutations of attendee_household_members, written only by manage_attendee_household_member and record_participant_capacity_increase. household_member_id/attendee_id/event_id are not FK-enforced so a deleted row''s audit history survives it.';

CREATE OR REPLACE FUNCTION public.prevent_attendee_household_member_command_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'attendee_household_member_command_audit is immutable';
END;
$$;

CREATE TRIGGER prevent_attendee_household_member_command_audit_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.attendee_household_member_command_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_attendee_household_member_command_audit_mutation();

ALTER TABLE public.attendee_household_member_command_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.attendee_household_member_command_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.attendee_household_member_command_audit FROM anon;
REVOKE ALL ON TABLE public.attendee_household_member_command_audit FROM authenticated;
REVOKE ALL ON TABLE public.attendee_household_member_command_audit FROM service_role;

-- ============================================================
-- Part 2: governed mutation RPC. Replaces the three inline
-- upsert/delete calls in app/admin/attendees/page.tsx's
-- syncHouseholdMembers() with one atomic, audited command. Event is
-- always derived server-side from the attendee row -- never accepted
-- as a client parameter -- which eliminates the cross-Event-mismatch
-- class of bug outright rather than validating a client-supplied
-- value. action (created vs. updated) is likewise resolved from a
-- server-side existence check, never trusted from the client.
-- ============================================================

CREATE FUNCTION public.manage_attendee_household_member(
  p_attendee_id uuid,
  p_person_role text,
  p_delete boolean,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_nickname text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_cell_phone text DEFAULT NULL
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

  -- Lock and capture current state. FOR UPDATE also serializes
  -- concurrent Admin edits to the same role row, mirroring
  -- record_participant_capacity_increase's own row-locking pattern.
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

  v_display_name := coalesce(
    nullif(btrim(p_nickname), ''),
    nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), '')
  );

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
  ON CONFLICT (attendee_id, person_role) DO UPDATE SET
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

ALTER FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.manage_attendee_household_member(uuid, text, boolean, text, text, text, text, text) TO authenticated;

-- ============================================================
-- Part 3: record_participant_capacity_increase -- add the audit write
-- to the same Admin audit surface, atomically, in both of its existing
-- household-member insert branches. Signature, parameters, and every
-- existing behavior (including its is_event_scoped_admin authorization
-- check) are unchanged -- see migration header. This is a straight
-- CREATE OR REPLACE of the live 20260805160000 body plus two new audit
-- inserts.
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

  -- 3. Validate the Event exists (implied by the FK above) and re-derive
  --    Event-scoped admin authority fresh -- never trusted from the client.
  --    This is the entire authorization condition for this RPC: no further
  --    confirmation, accounting status, or payment attestation is required.
  --    NOTE: is_event_scoped_admin, not event.attendees.manage -- this
  --    divergence is intentionally left unreconciled by this migration;
  --    see header.
  IF NOT public.is_event_scoped_admin(v_auth_user_id, v_event_id) THEN
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
  --    p_participant_role selected, and audit it atomically on the new
  --    Admin household-member audit surface. Slot-only mode
  --    (p_participant_role IS NULL) never reaches either branch below, so
  --    it never touches attendee_household_members at all. This function
  --    never deletes a household row, and never touches the Pilot row,
  --    which the existing generic save path continues to own.
  --
  --    No Person resolution occurs here (governed decision, not an
  --    oversight -- see 20260805150000's header). The row is preserved as
  --    unresolved Participation evidence, exactly like save_participant_identity:
  --    no person_id is written to attendees or attendee_household_members,
  --    person_role_instances is not touched, and identity is never inferred
  --    from the name/email/phone supplied.
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
    ON CONFLICT (attendee_id, person_role) DO UPDATE SET
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
    v_additional_display_name := coalesce(
      nullif(btrim(p_additional_nickname), ''),
      nullif(
        btrim(concat_ws(' ', p_additional_first_name, p_additional_last_name)),
        ''
      )
    );

    SELECT * INTO v_before_household
    FROM public.attendee_household_members
    WHERE attendee_id = p_attendee_id AND person_role = 'additional';

    INSERT INTO public.attendee_household_members (
      event_id, attendee_id, person_role, first_name, last_name, nickname,
      display_name, email, cell_phone, participant_status
    )
    VALUES (
      v_event_id, p_attendee_id, 'additional',
      nullif(btrim(p_additional_first_name), ''),
      nullif(btrim(p_additional_last_name), ''),
      nullif(btrim(p_additional_nickname), ''), v_additional_display_name,
      nullif(btrim(p_additional_email), ''),
      nullif(btrim(p_additional_cell_phone), ''), 'identified'
    )
    ON CONFLICT (attendee_id, person_role) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      nickname = excluded.nickname,
      display_name = excluded.display_name,
      email = excluded.email,
      cell_phone = excluded.cell_phone,
      participant_status = 'identified'
    RETURNING * INTO v_after_household;

    INSERT INTO public.attendee_household_member_command_audit (
      household_member_id, attendee_id, event_id, person_role,
      actor_auth_user_id, action, before_state, after_state
    )
    VALUES (
      v_after_household.id, p_attendee_id, v_event_id, 'additional',
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
  END IF;

  -- 9. Validate the requested final roster/capacity state: the new capacity
  --    must cover the roster this same transaction leaves in place. A
  --    violation rolls back the capacity increase, the audit records, and
  --    any household upsert performed above -- all or nothing.
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
-- Part 4: direct-write closure. Admin routine mutation now goes
-- exclusively through manage_attendee_household_member (and, for the
-- capacity-increase path, record_participant_capacity_increase), both
-- SECURITY DEFINER and both bypassing RLS via table-owner privilege --
-- matching this codebase's established closure pattern (event_photos,
-- agenda_items/agenda_categories). Done last, after the RPC exists and
-- is grantable, so there is no window where Admin has neither the old
-- direct-write path nor the new RPC path.
--
-- "Admins can view household members" (SELECT, event.attendees.view,
-- from 20260818150000) is untouched -- no member-facing policy exists
-- on this table at all (verified: the full policy history for
-- attendee_household_members is exactly the SELECT policy plus the
-- three admin mutation policies dropped below), so nothing member-
-- facing is at risk. Member-side SECURITY DEFINER functions
-- (save_participant_identity, update_participant_email,
-- finalize_member_identity_activation, submit_member_checkin,
-- increment_attendee_login) never evaluate table RLS or grants at all,
-- so this closure cannot affect them.
-- ============================================================

DROP POLICY IF EXISTS "admin insert household members" ON public.attendee_household_members;
DROP POLICY IF EXISTS "admin update household members" ON public.attendee_household_members;
DROP POLICY IF EXISTS "admin delete household members" ON public.attendee_household_members;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.attendee_household_members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.attendee_household_members FROM service_role;

COMMIT;
