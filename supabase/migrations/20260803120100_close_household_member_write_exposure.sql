-- Household-member identity data is Participation evidence, not authority.
-- Direct member mutations are retired in favor of the two governed functions
-- below. Authenticated table mutation privileges remain only because the
-- existing active-admin RLS policies use them for the admin attendee editor;
-- this does not establish Tenant- or Event-scoped admin authority.
--
-- Governed migration-history exception: these three named policies predate
-- this repository's migration history -- no migration here ever creates
-- them, so each was established directly in the linked production database
-- before migration-based tracking began (the same pattern already repaired
-- in 20260731120100_secure_events_rls.sql,
-- 20260731120200_create_tenant_hostname_mappings.sql,
-- 20260801120600_close_member_checkin_direct_write_bypasses.sql,
-- 20260801120900_close_admin_users_direct_write_bypass.sql, and
-- 20260803120000_close_unrestricted_anon_attendee_select.sql). Two of these
-- ("member insert household members", "member delete household members")
-- had no ownership restriction at all (WITH CHECK/USING (true)), letting
-- any authenticated caller insert or delete any household member row for
-- any attendee -- the exposure this migration exists to close. An
-- unconditional DROP POLICY only succeeds where that pre-existing object
-- happens to be present; on a fresh replay, where none of these policies
-- exist, the same statements fail. The fix generalizes the same intent --
-- "these named policies must not exist afterward" -- so it succeeds
-- whether or not each was already present, while still guaranteeing the
-- same end state either way: no unrestricted or self-service direct-table
-- INSERT/UPDATE/DELETE policy remains on attendee_household_members, and
-- the governed save_participant_identity RPC (SECURITY DEFINER, verifying
-- ownership through resolve_auth_person_link and recording provenance)
-- remains the sole member mutation pathway either way. Because this
-- migration's version is already recorded as applied in the linked
-- production database, this change affects only fresh-replay behavior; it
-- does not and cannot cause the migration to run again there.

DROP POLICY IF EXISTS "member insert household members"
ON public.attendee_household_members;

DROP POLICY IF EXISTS "member update household members"
ON public.attendee_household_members;

DROP POLICY IF EXISTS "member delete household members"
ON public.attendee_household_members;

REVOKE INSERT, UPDATE, DELETE
ON TABLE public.attendee_household_members
FROM anon;

CREATE POLICY "admin delete household members"
ON public.attendee_household_members
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
      AND admin_users.is_active = true
  )
);

CREATE TABLE public.household_member_identity_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  event_id uuid NOT NULL,
  attendee_id uuid NOT NULL,
  household_member_id uuid NOT NULL,
  actor_auth_user_id uuid NOT NULL,
  actor_person_id uuid NOT NULL,
  authorization_basis text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  previous_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  CONSTRAINT household_member_identity_audit_action_check CHECK (
    action IN ('insert', 'update')
  ),
  CONSTRAINT household_member_identity_audit_authorization_basis_check CHECK (
    authorization_basis = 'authenticated_person'
  ),
  CONSTRAINT household_member_identity_audit_changed_fields_check CHECK (
    changed_fields <@ ARRAY[
      'first_name', 'last_name', 'nickname', 'email', 'cell_phone'
    ]::text[]
  ),
  CONSTRAINT household_member_identity_audit_previous_values_check CHECK (
    jsonb_typeof(previous_values) = 'object'
    AND previous_values ?& ARRAY[
      'first_name', 'last_name', 'nickname', 'email', 'cell_phone'
    ]
    AND previous_values - ARRAY[
      'first_name', 'last_name', 'nickname', 'email', 'cell_phone'
    ] = '{}'::jsonb
  ),
  CONSTRAINT household_member_identity_audit_new_values_check CHECK (
    jsonb_typeof(new_values) = 'object'
    AND new_values ?& ARRAY[
      'first_name', 'last_name', 'nickname', 'email', 'cell_phone'
    ]
    AND new_values - ARRAY[
      'first_name', 'last_name', 'nickname', 'email', 'cell_phone'
    ] = '{}'::jsonb
  )
);

ALTER TABLE public.household_member_identity_audit OWNER TO postgres;

CREATE INDEX household_member_identity_audit_event_id_created_at_idx
  ON public.household_member_identity_audit (event_id, created_at DESC);

CREATE INDEX household_member_identity_audit_attendee_id_created_at_idx
  ON public.household_member_identity_audit (attendee_id, created_at DESC);

CREATE INDEX household_member_identity_audit_member_id_created_at_idx
  ON public.household_member_identity_audit (household_member_id, created_at DESC);

ALTER TABLE public.household_member_identity_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.household_member_identity_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.household_member_identity_audit FROM anon;
REVOKE ALL ON TABLE public.household_member_identity_audit FROM authenticated;
REVOKE ALL ON TABLE public.household_member_identity_audit FROM service_role;

COMMENT ON TABLE public.household_member_identity_audit IS
  'Private provenance for successful governed household-member identity mutations. It preserves only approved before-and-after participant identity fields and never stores credentials or tokens.';

COMMENT ON COLUMN public.household_member_identity_audit.event_id IS
  'Immutable Event provenance captured by the governed mutation; not a lifecycle-enforcing foreign key.';

COMMENT ON COLUMN public.household_member_identity_audit.attendee_id IS
  'Immutable governing attendee provenance captured by the governed mutation; not a lifecycle-enforcing foreign key.';

COMMENT ON COLUMN public.household_member_identity_audit.household_member_id IS
  'The operational household row affected by the governed mutation.';

CREATE OR REPLACE FUNCTION public.save_participant_identity(
  p_participant_id uuid DEFAULT NULL,
  p_attendee_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_person_role text DEFAULT NULL,
  p_sort_order integer DEFAULT 0,
  p_first_name text DEFAULT '',
  p_last_name text DEFAULT '',
  p_nickname text DEFAULT '',
  p_email text DEFAULT '',
  p_cell_phone text DEFAULT ''
)
RETURNS public.attendee_household_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_auth_user_id uuid;
  v_person_id uuid;
  v_link_status text;
  v_event_count integer;
  v_attendee_count integer;
  v_attendee_ids uuid[];
  v_attendee_id uuid;
  v_before public.attendee_household_members%ROWTYPE;
  v_result public.attendee_household_members%ROWTYPE;
  v_display_name text;
  v_changed_fields text[];
  v_previous_values jsonb;
  v_new_values jsonb;
BEGIN
  v_auth_user_id := auth.uid();

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Participant identity authorization failed.';
  END IF;

  SELECT resolution.status, resolution.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_auth_user_id) AS resolution;

  IF v_link_status IS DISTINCT FROM 'resolved' THEN
    RAISE EXCEPTION 'Participant identity authorization failed.';
  END IF;

  SELECT count(*) INTO v_event_count
  FROM public.events AS event_row
  WHERE event_row.id = p_event_id
    AND coalesce(event_row.is_active, true) = true
    AND coalesce(event_row.visible_to_members, true) = true;

  IF v_event_count <> 1 THEN
    RAISE EXCEPTION 'Participant identity authorization failed.';
  END IF;

  SELECT count(*), array_agg(candidate.id ORDER BY candidate.id)
    INTO v_attendee_count, v_attendee_ids
  FROM (
    SELECT attendee_row.id
    FROM public.attendees AS attendee_row
    WHERE attendee_row.person_id = v_person_id
      AND attendee_row.event_id = p_event_id
      AND coalesce(attendee_row.is_active, true) = true
    ORDER BY attendee_row.id
    LIMIT 2
  ) AS candidate;

  IF v_attendee_count <> 1 THEN
    RAISE EXCEPTION 'Participant identity authorization failed.';
  END IF;

  v_attendee_id := v_attendee_ids[1];

  v_display_name := coalesce(
    nullif(btrim(p_nickname), ''),
    nullif(btrim(concat_ws(' ', p_first_name, p_last_name)), '')
  );

  IF p_participant_id IS NULL THEN
    IF p_attendee_id IS DISTINCT FROM v_attendee_id
      OR p_event_id IS NULL
      OR p_person_role NOT IN ('pilot', 'copilot', 'additional') THEN
      RAISE EXCEPTION 'Participant identity authorization failed.';
    END IF;

    INSERT INTO public.attendee_household_members (
      event_id,
      attendee_id,
      person_role,
      sort_order,
      first_name,
      last_name,
      nickname,
      display_name,
      email,
      cell_phone,
      participant_status
    )
    VALUES (
      p_event_id,
      v_attendee_id,
      p_person_role,
      coalesce(p_sort_order, 0),
      p_first_name,
      p_last_name,
      p_nickname,
      v_display_name,
      nullif(p_email, ''),
      nullif(p_cell_phone, ''),
      'identified'
    )
    RETURNING * INTO v_result;

    v_previous_values := jsonb_build_object(
      'first_name', NULL,
      'last_name', NULL,
      'nickname', NULL,
      'email', NULL,
      'cell_phone', NULL
    );
    v_changed_fields := ARRAY[
      'first_name', 'last_name', 'nickname', 'email', 'cell_phone'
    ]::text[];
  ELSE
    SELECT * INTO v_before
    FROM public.attendee_household_members AS household_member
    WHERE household_member.id = p_participant_id
      AND household_member.attendee_id = v_attendee_id
      AND household_member.event_id = p_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Participant identity authorization failed.';
    END IF;

    UPDATE public.attendee_household_members AS household_member
    SET
      first_name = p_first_name,
      last_name = p_last_name,
      nickname = p_nickname,
      display_name = v_display_name,
      email = nullif(p_email, ''),
      cell_phone = nullif(p_cell_phone, '')
    WHERE household_member.id = v_before.id
    RETURNING * INTO v_result;

    v_previous_values := jsonb_build_object(
      'first_name', v_before.first_name,
      'last_name', v_before.last_name,
      'nickname', v_before.nickname,
      'email', v_before.email,
      'cell_phone', v_before.cell_phone
    );
    v_changed_fields := ARRAY(
      SELECT changed.field_name
      FROM (
        VALUES
          ('first_name', v_before.first_name, v_result.first_name),
          ('last_name', v_before.last_name, v_result.last_name),
          ('nickname', v_before.nickname, v_result.nickname),
          ('email', v_before.email, v_result.email),
          ('cell_phone', v_before.cell_phone, v_result.cell_phone)
      ) AS changed(field_name, previous_value, new_value)
      WHERE changed.previous_value IS DISTINCT FROM changed.new_value
    );
  END IF;

  v_new_values := jsonb_build_object(
    'first_name', v_result.first_name,
    'last_name', v_result.last_name,
    'nickname', v_result.nickname,
    'email', v_result.email,
    'cell_phone', v_result.cell_phone
  );

  INSERT INTO public.household_member_identity_audit (
    action,
    event_id,
    attendee_id,
    household_member_id,
    actor_auth_user_id,
    actor_person_id,
    authorization_basis,
    changed_fields,
    previous_values,
    new_values
  )
  VALUES (
    CASE WHEN p_participant_id IS NULL THEN 'insert' ELSE 'update' END,
    p_event_id,
    v_attendee_id,
    v_result.id,
    v_auth_user_id,
    v_person_id,
    'authenticated_person',
    v_changed_fields,
    v_previous_values,
    v_new_values
  );

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.save_participant_identity(
  uuid, uuid, uuid, text, integer, text, text, text, text, text
) OWNER TO postgres;

-- Revoke every existing overload before granting only the governed callable
-- signature. This removes browser execution from any retired signature while
-- preserving the one compatibility signature used by the member client.
DO $$
DECLARE
  function_signature regprocedure;
BEGIN
  FOR function_signature IN
    SELECT procedure.oid::regprocedure
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'save_participant_identity',
        'update_participant_email'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', function_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', function_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', function_signature);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_participant_identity(
  uuid, uuid, uuid, text, integer, text, text, text, text, text
) TO authenticated;
