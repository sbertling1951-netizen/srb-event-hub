-- Governed operational audit for administrator-driven paid-capacity
-- increases.
--
-- Scope note: EpicentraX is not an accounting application. This migration
-- does not record or audit payments, receipts, card transactions, cash
-- handling, or financial reconciliation -- how a Tenant collected payment is
-- the Tenant's own business process, outside EpicentraX's scope. The
-- governed fact preserved here is narrower and purely operational: an
-- authorized Event Administrator intentionally increased an attendee's paid
-- participant capacity, confirmed that the increase was authorized by the
-- Tenant, and optionally left a note.
--
-- Background: attendees.participant_capacity represents paid participant
-- slots (established by CSV import or an Event Administrator). The admin
-- attendee editor (app/admin/attendees/page.tsx) is the only UI write path
-- for this field, via a single generic `attendees` UPDATE/INSERT alongside
-- many unrelated fields, followed by a separate, non-atomic
-- syncHouseholdMembers(...) call. That sequence carried no requirement to
-- confirm an increase was authorized, and a partial failure between the two
-- calls could raise the roster without a matching capacity/audit record, or
-- vice versa.
--
-- Production evidence (read-only inspection of the linked database):
-- `public.attendees` RLS policy "SA or event admins can update attendees"
-- grants `authenticated` row-level UPDATE with no column restriction, and
-- `authenticated` holds a table-level UPDATE grant. RLS is row-scoped, not
-- column-scoped, so no RLS policy alone can restrict which columns an
-- otherwise-authorized admin may change. A direct
-- `UPDATE attendees SET participant_capacity = ...` therefore remains
-- possible through the ordinary REST table endpoint no matter what any
-- application page sends. This migration closes that specific bypass with a
-- narrowly scoped trigger (see part 2 below) rather than attempting to
-- express column-level restriction through RLS.
--
-- This migration adds:
--   1. A narrow, purpose-built operational-audit table -- no payment
--      method, amount, or transaction fields.
--   2. A trigger on public.attendees that rejects any UPDATE raising
--      participant_capacity unless it was issued from inside the governed
--      RPC below, closing the direct-REST bypass described above.
--   3. A single SECURITY DEFINER RPC,
--      record_participant_capacity_increase(...), that is the only governed
--      way to raise an existing attendee's participant_capacity. It
--      supports two explicit, mutually exclusive modes, selected by the
--      caller via p_participant_role (never inferred from which fields
--      happen to be populated):
--        - Slot only (p_participant_role IS NULL): raise
--          participant_capacity and write the audit record. No household
--          row is created or modified. The existing attendee can later use
--          + Add Participant to fill the open slot themselves.
--        - Slot and participant (p_participant_role = 'copilot' or
--          'additional'): raise participant_capacity, write the audit
--          record, AND create/update exactly the one named household row
--          for that role, all in the same transaction. This avoids
--          requiring a later invitation for a participant the administrator
--          already knows.
--      In both modes, the caller is re-authenticated and re-authorized
--      server-side, and everything performed by the call commits or rolls
--      back together.
--
-- Deliberately out of scope, matching the governing task's own boundary: new
-- attendee creation (INSERT) is not gated -- a brand-new row has no prior
-- capacity to protect -- and capacity decreases are not gated, since only
-- increases require confirmation. Person, Participation, Relationship, and
-- Authority are not touched. No email or mobile number is required to add a
-- participant here -- the existing household-member workflow never required
-- one, and this migration does not add a new requirement.
--
-- Governed identity decision (this task): no existing resolver accepts a
-- brand-new admin-entered attendee_household_members row with no
-- auth_user_id -- resolve_vendor_person_identity is vendor-context- and
-- auth_user_id-locked, and every write to person_role_instances comes only
-- from a one-time historical backfill or a verification-challenge-gated
-- member self-claim pipeline, neither reachable here. Per explicit product
-- decision, this RPC therefore preserves the admin-entered participant as
-- unresolved Participation evidence on attendee_household_members -- no
-- Person is created, selected, or connected; attendees.person_id (Pilot
-- only) and person_role_instances are never written; no
-- attendee_household_members.person_id column exists or is added; identity
-- is never inferred from name, email, or phone. This mirrors the existing
-- save_participant_identity pathway, which resolves no Person for any
-- household member either. Non-resolution here is intentional and governed
-- for this task, not an implementation defect -- it remains in place until a
-- future, separately accepted general participant-resolution architecture
-- is designed and implemented.

CREATE TABLE public.participant_capacity_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  previous_capacity integer,
  new_capacity integer NOT NULL,
  quantity_added integer GENERATED ALWAYS AS (
    new_capacity - coalesce(previous_capacity, 0)
  ) STORED,
  actor_admin_user_id uuid NOT NULL REFERENCES public.admin_users(id),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  note text,
  CONSTRAINT participant_capacity_adjustments_is_increase_check CHECK (
    new_capacity > coalesce(previous_capacity, 0)
  )
);

CREATE INDEX participant_capacity_adjustments_attendee_id_idx
  ON public.participant_capacity_adjustments (attendee_id, created_at DESC);

ALTER TABLE public.participant_capacity_adjustments OWNER TO postgres;

ALTER TABLE public.participant_capacity_adjustments ENABLE ROW LEVEL SECURITY;

-- Deny-all at the table level, matching this schema's established pattern
-- for governed audit/evidence tables (e.g. household_member_identity_audit,
-- vendor_service_request_audit). The only write path is the
-- SECURITY DEFINER function below, which runs as the table owner and is
-- unaffected by RLS.
REVOKE ALL ON TABLE public.participant_capacity_adjustments FROM PUBLIC;
REVOKE ALL ON TABLE public.participant_capacity_adjustments FROM anon;
REVOKE ALL ON TABLE public.participant_capacity_adjustments FROM authenticated;
REVOKE ALL ON TABLE public.participant_capacity_adjustments FROM service_role;

-- ---------------------------------------------------------------------------
-- Part 2 (created before the RPC that authorizes through it): trigger that
-- rejects any UPDATE raising attendees.participant_capacity unless a
-- transaction-local flag has been set by the governed RPC below.
--
-- Why this is not bypassable from a client: `epicentrax.capacity_increase_authorized`
-- is set only via `set_config(..., true)` (transaction-local) inside the
-- SECURITY DEFINER function body, in the same transaction as the UPDATE it
-- authorizes -- it resets automatically at transaction end and is never
-- persisted, sent to, or settable by a client. `set_config`/`current_setting`
-- live in pg_catalog, which PostgREST's RPC endpoint never exposes (only
-- functions in the configured, application `public` schema are callable as
-- `/rest/v1/rpc/...`), so a client cannot invoke them directly either. This
-- leaves exactly one way to raise participant_capacity: through the RPC.
-- Decreases, and all other column updates, are unaffected -- the trigger
-- only inspects this one column's direction of change.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.enforce_participant_capacity_increase_via_rpc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
BEGIN
  IF coalesce(NEW.participant_capacity, 0) > coalesce(OLD.participant_capacity, 0) THEN
    IF current_setting('epicentrax.capacity_increase_authorized', true)
      IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION
        'participant_capacity increases must go through public.record_participant_capacity_increase(...).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_participant_capacity_increase_via_rpc()
  OWNER TO postgres;

CREATE TRIGGER attendees_enforce_capacity_increase_via_rpc
  BEFORE UPDATE ON public.attendees
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_participant_capacity_increase_via_rpc();

-- ---------------------------------------------------------------------------
-- The sole governed pathway that may raise an existing attendee's
-- participant_capacity, in one of two explicit modes selected by
-- p_participant_role (see the migration header comment). Everything below
-- runs in the one implicit transaction of this function call: any failure
-- (authorization, validation, or the household write in slot-and-participant
-- mode) rolls back the capacity change and the audit insert along with it.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.record_participant_capacity_increase(
  p_attendee_id uuid,
  p_new_capacity integer,
  p_confirmed boolean,
  p_note text DEFAULT NULL,
  -- Explicit mode selector. NULL = slot only. 'copilot' or 'additional' =
  -- slot and participant, targeting exactly that one household role. Never
  -- inferred from which of the fields below happen to be populated.
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

  -- 5. Require explicit confirmation that the Tenant authorized this
  --    increase. EpicentraX does not ask how, or verify payment -- only
  --    that an Event Administrator affirms the increase is authorized.
  IF p_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION
      'Confirmation that this capacity increase was authorized by the Tenant is required.';
  END IF;

  -- 5b. Validate the explicit mode selector and reject any request that
  --     does not clearly identify exactly one participant, or exactly none.
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
  --    oversight -- see migration header). The row is preserved as
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
  uuid, integer, boolean, text, text, text, text, text, text, text, text, text, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, boolean, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, boolean, text, text, text, text, text, text, text, text, text, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, boolean, text, text, text, text, text, text, text, text, text, text, text
) FROM service_role;

GRANT EXECUTE ON FUNCTION public.record_participant_capacity_increase(
  uuid, integer, boolean, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
