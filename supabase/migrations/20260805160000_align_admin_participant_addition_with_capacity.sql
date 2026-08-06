-- Corrects the governed capacity-adjustment RPC to match the accepted
-- product rule, without amending the already-applied migration
-- 20260805150000_create_participant_capacity_adjustments.sql (committed and
-- applied to production; that migration is left byte-for-byte as it was
-- applied).
--
-- Accepted governing rule (supersedes 20260805150000's payment-confirmation
-- framing):
--   - An authorized Event/Tenant administrator adding a participant
--     authorizes the corresponding participant slot. EpicentraX does not
--     verify or record payment.
--   - Adding a participant beyond current capacity must atomically raise
--     capacity, write the adjustment audit, and create/update that one
--     roster row.
--   - Adding a participant into an already-open slot must not raise
--     capacity.
--   - Adding a slot only must raise capacity and leave the roster
--     unchanged.
--
-- What 20260805150000 actually deployed does not match this: it required an
-- explicit boolean "the Tenant authorized this" confirmation
-- (p_confirmed), framed around payment/accounting language the product no
-- longer uses, and depended on the admin client explicitly selecting a
-- "slot and participant" mode rather than the system detecting, from the
-- roster change itself, whether capacity needs to rise. This is also the
-- root cause of the reported defect: an administrator adding a Co-Pilot
-- through the plain Co-Pilot fields, without separately opting into that
-- mode and confirming, left participant_capacity unchanged while the
-- roster grew.
--
-- Function signature is changing (p_confirmed boolean is removed; no
-- parameter is added in its place), so CREATE OR REPLACE cannot be used --
-- Postgres identifies a function by name AND full argument-type list, so a
-- different parameter list is a different function, and CREATE OR REPLACE
-- against a new signature would leave the old one to be called with a
-- second, redundant overload. This migration therefore explicitly:
--   1. Revokes EXECUTE on the exact deployed (old) signature from
--      authenticated, closing the old callable surface first.
--   2. Drops the old-signature function (no CASCADE -- if any other
--      database object depends on it, DROP fails loudly and this migration
--      aborts rather than silently discarding a real dependency; nothing
--      in this schema is known to depend on it, confirmed by inspecting
--      every tracked migration for the function's name).
--   3. Creates the corrected function under the same name with the new,
--      final signature.
--   4. Re-establishes the same owner, SECURITY DEFINER posture,
--      search_path, and REVOKE/GRANT posture the original had (postgres
--      owner; deny-all except EXECUTE to authenticated).
--
-- Unchanged, and not recreated by this migration:
--   - public.participant_capacity_adjustments (table, indexes, RLS,
--     grants) -- its history is untouched; this migration performs no
--     INSERT/UPDATE/DELETE against it.
--   - public.enforce_participant_capacity_increase_via_rpc() and the
--     attendees_enforce_capacity_increase_via_rpc trigger -- the sole-path
--     enforcement mechanism (a transaction-local flag the RPC sets
--     immediately before its own UPDATE) does not reference the RPC's
--     argument list at all, so it requires no change and is left exactly
--     as 20260805150000 created it.
--
-- Corrected behavior of the new function:
--   - No p_confirmed parameter, and no confirmation/accounting-status
--     check of any kind. Valid, re-derived Event-scoped admin authority
--     (re-checked fresh against auth.uid() every call) is the entire
--     authorization condition -- the administrator's own authorized
--     action of calling this RPC is what authorizes the resulting
--     capacity.
--   - p_participant_role retains the same explicit-mode meaning: NULL for
--     slot-only, 'copilot'/'additional' to also atomically write that one
--     named household row. The caller (app/admin/attendees/page.tsx) now
--     derives this automatically from whether a new Co-Pilot/Additional
--     Participant is being added and whether the resulting roster would
--     exceed the currently stored capacity, rather than requiring the
--     administrator to separately opt into a mode.
--   - Every other governed property from 20260805150000 is preserved
--     unchanged: caller re-authentication, row locking with FOR UPDATE
--     (concurrency serialization), fresh Event-scoped admin re-derivation,
--     "must be a real increase" validation, "exactly one clearly
--     identified participant, or none" validation, the atomic
--     capacity+audit+roster write, the final roster-vs-capacity
--     validation that rolls back the whole call on violation, and no
--     Person/person_role_instances/person_id write of any kind.

DO $$
DECLARE
  v_old_oid oid;
BEGIN
  v_old_oid := to_regprocedure(
    'public.record_participant_capacity_increase(uuid, integer, boolean, text, text, text, text, text, text, text, text, text, text, text)'
  );

  IF v_old_oid IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM authenticated',
      v_old_oid::regprocedure
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC',
      v_old_oid::regprocedure
    );

    -- No CASCADE: if a real dependency exists, this fails loudly here
    -- rather than silently discarding it. Confirmed by inspecting every
    -- tracked migration that no other database object references this
    -- function by name; the only caller is the application client via
    -- supabase.rpc(...), which is not a database-level dependency.
    EXECUTE format('DROP FUNCTION %s', v_old_oid::regprocedure);

    RAISE NOTICE
      'Dropped old-signature public.record_participant_capacity_increase(uuid, integer, boolean, text x11).';
  ELSE
    RAISE NOTICE
      'Old-signature public.record_participant_capacity_increase(uuid, integer, boolean, text x11) not present -- nothing to drop.';
  END IF;
END;
$$;

CREATE FUNCTION public.record_participant_capacity_increase(
  p_attendee_id uuid,
  p_new_capacity integer,
  p_note text DEFAULT NULL,
  -- Explicit mode selector. NULL = slot only. 'copilot' or 'additional' =
  -- slot and participant, targeting exactly that one household role. Never
  -- inferred inside this function from which of the fields below happen
  -- to be populated -- the caller passes the role it already determined.
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
  --    p_participant_role selected. Slot-only mode (p_participant_role IS
  --    NULL) never reaches either branch below, so it never touches
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
      participant_status = 'identified';

  ELSIF p_participant_role = 'additional' THEN
    v_additional_display_name := coalesce(
      nullif(btrim(p_additional_nickname), ''),
      nullif(
        btrim(concat_ws(' ', p_additional_first_name, p_additional_last_name)),
        ''
      )
    );

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
      participant_status = 'identified';
  END IF;

  -- 9. Validate the requested final roster/capacity state: the new capacity
  --    must cover the roster this same transaction leaves in place. A
  --    violation rolls back the capacity increase, the audit record, and
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
