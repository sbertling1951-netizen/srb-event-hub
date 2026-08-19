-- record_participant_capacity_increase authority reconciliation.
--
-- Follow-up to 20260818160000, whose header explicitly deferred this
-- exact question: "record_participant_capacity_increase's authorization
-- basis (is_event_scoped_admin, not event.attendees.manage) is
-- deliberately NOT reconciled here -- that is a second, independent
-- authority-policy question with its own access-delta analysis, left to
-- a separate follow-up workstream." This migration is that follow-up.
--
-- Owning capability. record_participant_capacity_increase raises
-- attendees.participant_capacity (an attendee record field) and, in
-- slot-and-participant mode, writes exactly one attendee_household_members
-- roster row. Per EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md's Attendees
-- module ("Roster CRUD; attendee-record editing" / "Attendee records" as
-- owned information), this is squarely Attendees-module mutation
-- authority -- the same event.attendees.manage capability 20260818140000
-- already reconciled public.attendees' and
-- public.attendee_household_members' RLS mutation policies to, and the
-- same capability 20260818160000's manage_attendee_household_member
-- already requires for the sibling household-member write path. No
-- other registered task (event.reports.export, event.vendors.manage,
-- etc.) fits either write this function performs.
--
-- Live-database evidence (this workstream) this migration depends on:
--
--   * public.is_event_scoped_admin(uid, event_id) delegates its entire
--     body to public.has_event_admin_authority(uid, event_id)
--     (confirmed live via pg_get_functiondef), which returns true for
--     Platform Admin, OR Tenant Admin for the Event's Tenant, OR the
--     mere EXISTENCE of any public.admin_event_access row for that
--     admin/event pair -- regardless of the row's role/profile column.
--     This is the theoretical divergence from
--     has_event_task_authority('event.attendees.manage', event_id),
--     which requires the caller's specific admin_event_access row to
--     carry a materialized event.attendees.manage grant (via Platform
--     inheritance, Tenant inheritance, or an explicit
--     admin_event_permissions row) -- a 'content', 'parking', or
--     'view_only' profile row would satisfy the former and not the
--     latter.
--   * Confirmed live that no such divergent row currently exists:
--     public.admin_event_access holds exactly 12 rows, all role IN
--     ('event_admin','checkin') -- zero 'content', 'parking', or
--     'view_only' rows. Zero active public.admin_tenant_access rows
--     exist (no Tenant Admin assignments today, so the tenant-inherits
--     branch is identical -- true/true -- for both predicates in any
--     case). 11 active admin_users, 2 of them super_admin (Platform
--     inheritance covers both predicates identically).
--   * Confirmed live that all 12 admin_event_access rows already carry a
--     materialized, is_enabled event.attendees.manage row in
--     admin_event_permissions (zero rows missing it) -- both the
--     event_admin bundle (all event-scope tasks except
--     validation_rules) and the checkin bundle (which explicitly
--     includes event.attendees.manage) provide it.
--   * Confirmed live that the only admin who has ever actually invoked
--     this RPC (public.participant_capacity_adjustments, one row) is a
--     super_admin -- already covered by Platform inheritance under
--     either predicate.
--   * Net result: zero access delta. Every admin who can call this RPC
--     today can still call it after this swap; no admin gains access
--     that could not already reach it via a governance path (Platform or
--     Tenant admin) this reconciliation does not touch.
--
-- Signature is unchanged (CREATE OR REPLACE against the live
-- 20260818160000 signature). Every other property -- row locking, the
-- increase-only check, the explicit participant_role mode validation,
-- the atomic participant_capacity_adjustments audit insert, the two
-- attendee_household_member_command_audit inserts added by 20260818160000,
-- and the final roster-vs-capacity validation -- is preserved exactly.
-- The sole change in this function's body is the authorization
-- predicate itself, from public.is_event_scoped_admin(v_auth_user_id,
-- v_event_id) to public.has_event_task_authority('event.attendees.manage',
-- v_event_id).

BEGIN;

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
  --    Event-scoped task authority fresh -- never trusted from the
  --    client. This is the entire authorization condition for this RPC:
  --    no further confirmation, accounting status, or payment
  --    attestation is required. Reconciled by 20260818170000 from
  --    is_event_scoped_admin to the canonical event.attendees.manage
  --    task -- the same capability this function's own household-member
  --    writes are governed under via manage_attendee_household_member
  --    (20260818160000) and public.attendees'/
  --    public.attendee_household_members' own RLS mutation policies
  --    (20260818140000). See migration header for the live access-delta
  --    evidence.
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
  --    p_participant_role selected, and audit it atomically on the Admin
  --    household-member audit surface. Slot-only mode (p_participant_role
  --    IS NULL) never reaches either branch below, so it never touches
  --    attendee_household_members at all. This function never deletes a
  --    household row, and never touches the Pilot row, which the existing
  --    generic save path continues to own.
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

COMMIT;
