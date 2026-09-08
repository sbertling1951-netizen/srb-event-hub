-- P-3C: an owner-only PRIVATE guest-planning list for a self-service
-- organizer's own unfinished private draft.
--
-- This is PLANNING DATA ONLY. A planned guest is NOT an invitation, a
-- registration, an attendee, a membership, an identity, an account, or any
-- kind of access grant. The required lifecycle boundary is:
--
--   private planned guest
--     -> (later) governed invitation
--     -> (later) accepted registration / identity resolution
--     -> operational attendee
--
-- P-3C implements ONLY the first stage.
--
-- What this migration does NOT do:
--   * it never writes people, person_identifiers, person_auth_accounts,
--     person_role_instances, person_event_participations, attendees,
--     households, registrations, capacity, check-in, parking, notifications,
--     email, invitations, or any public/member visibility;
--   * it never queries or matches an existing EpicentraX person/account from a
--     planned guest's email, phone, or name;
--   * it grants NO Event task authority and touches NO admin attendee RPC,
--     admin route guard, admin UI, or identity system;
--   * it adds NO command ledger and puts NO guest PII into any deletion audit,
--     URL, log, or user-visible error.
--
-- Authorization is the exact self-service organizer-owner rule already used by
-- get_my_self_service_private_draft / delete_self_service_organizer_event /
-- save_my_self_service_private_draft_details /
-- _organizer_private_draft_agenda_authorize: authenticated + verified email,
-- resolved verified organizer ownership of the exact event, active
-- self-service organizer appointment, self-service private tenant, event
-- status Draft, event inactive, event not member-visible.
--
-- The records are event-owned. The existing governed
-- delete_self_service_organizer_event path removes them cleanly BEFORE its
-- universal fail-closed child-FK dependency scan, so a future event deletion
-- never fails merely because the planner used this list.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The narrowly-scoped private-draft planned-guest table.
--    Event-owned (ON DELETE RESTRICT, exactly like the agenda substrate and
--    the draft marker -- the governed deletion path removes children
--    explicitly and the fail-closed scan catches anything unexpected).
--    RLS on + all browser grants revoked: the table is reachable ONLY through
--    the tightly-governed organizer RPCs below (postgres-owned, SECURITY
--    DEFINER), never directly by anon / authenticated / service_role.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_private_draft_planned_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  -- Planning fields only. display_name is required; email / phone /
  -- organizer_note are optional. These are free-text notes the organizer
  -- typed; they are never matched against any existing person or account.
  display_name text NOT NULL
    CHECK (btrim(display_name) <> '' AND length(display_name) <= 200),
  email text
    CHECK (email IS NULL OR (btrim(email) <> '' AND length(email) <= 320)),
  phone text
    CHECK (phone IS NULL OR (btrim(phone) <> '' AND length(phone) <= 50)),
  organizer_note text
    CHECK (organizer_note IS NULL OR (btrim(organizer_note) <> '' AND length(organizer_note) <= 2000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.self_service_private_draft_planned_guests OWNER TO postgres;

CREATE INDEX self_service_private_draft_planned_guests_event_idx
  ON public.self_service_private_draft_planned_guests (event_id, created_at, id);

ALTER TABLE public.self_service_private_draft_planned_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_private_draft_planned_guests
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Internal helper: authorize the caller as the canonical owner of ONE
--    eligible private-draft Event's guest list. Raises 'Draft not found.' for
--    every miss (missing / non-owned / non-private / live / member-visible /
--    non-Draft), non-enumerating. Never calls has_event_task_authority and
--    never reads tenant/admin authority. Byte-for-byte the same owner rule as
--    _organizer_private_draft_agenda_authorize (20260928000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_draft_guest_authorize(p_event_id uuid)
RETURNS TABLE(organizer_appointment_id uuid, organizer_person_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_appt uuid;
  v_appt_person uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Editing a guest list requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Editing a guest list requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT oa.id, oa.person_id
    INTO v_appt, v_appt_person
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  WHERE d.event_id = p_event_id
    AND oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_actor)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  LIMIT 1;

  IF v_appt IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  RETURN QUERY SELECT v_appt, v_appt_person;
END;
$function$;

ALTER FUNCTION public._organizer_private_draft_guest_authorize(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_draft_guest_authorize(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared input validation for one planned guest. display_name is REQUIRED;
-- email / phone / organizer_note are optional. Length-only checks -- the
-- values are private planning notes and are never format-matched against any
-- existing identity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_planned_guest_validate(
  p_display_name text, p_email text, p_phone text, p_organizer_note text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_display_name IS NULL OR btrim(p_display_name) = '' OR length(btrim(p_display_name)) > 200 THEN
    RAISE EXCEPTION 'A planned guest needs a display name of 200 characters or fewer.';
  END IF;
  IF p_email IS NOT NULL AND length(p_email) > 320 THEN
    RAISE EXCEPTION 'A planned guest email must be 320 characters or fewer.';
  END IF;
  IF p_phone IS NOT NULL AND length(p_phone) > 50 THEN
    RAISE EXCEPTION 'A planned guest phone must be 50 characters or fewer.';
  END IF;
  IF p_organizer_note IS NOT NULL AND length(p_organizer_note) > 2000 THEN
    RAISE EXCEPTION 'A planned guest note must be 2000 characters or fewer.';
  END IF;
END;
$function$;

ALTER FUNCTION public._organizer_private_planned_guest_validate(text, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_planned_guest_validate(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Read: the caller's own private-draft planned guest list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_private_draft_planned_guests(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  display_name text,
  email text,
  phone text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_guest_authorize(p_event_id);

  RETURN QUERY
  SELECT g.id, g.display_name, g.email, g.phone, g.organizer_note,
         g.created_at, g.updated_at
  FROM public.self_service_private_draft_planned_guests AS g
  WHERE g.event_id = p_event_id
  ORDER BY g.created_at, g.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Add one planned guest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_my_private_draft_planned_guest(
  p_event_id uuid,
  p_display_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_organizer_note text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  display_name text,
  email text,
  phone text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_display_name text := btrim(p_display_name);
  v_email text := nullif(btrim(p_email), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_note text := nullif(btrim(p_organizer_note), '');
  v_row public.self_service_private_draft_planned_guests%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_guest_authorize(p_event_id);
  PERFORM public._organizer_private_planned_guest_validate(
    v_display_name, v_email, v_phone, v_note
  );

  INSERT INTO public.self_service_private_draft_planned_guests(
    event_id, display_name, email, phone, organizer_note
  ) VALUES (
    p_event_id, v_display_name, v_email, v_phone, v_note
  ) RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.display_name, v_row.email, v_row.phone, v_row.organizer_note,
    v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Edit one planned guest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_private_draft_planned_guest(
  p_event_id uuid,
  p_guest_id uuid,
  p_display_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_organizer_note text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  display_name text,
  email text,
  phone text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_display_name text := btrim(p_display_name);
  v_email text := nullif(btrim(p_email), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_note text := nullif(btrim(p_organizer_note), '');
  v_row public.self_service_private_draft_planned_guests%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_guest_authorize(p_event_id);
  PERFORM public._organizer_private_planned_guest_validate(
    v_display_name, v_email, v_phone, v_note
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_planned_guests AS g
    WHERE g.id = p_guest_id AND g.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Planned guest not found.';
  END IF;

  UPDATE public.self_service_private_draft_planned_guests AS g
  SET display_name = v_display_name,
      email = v_email,
      phone = v_phone,
      organizer_note = v_note,
      updated_at = now()
  WHERE g.id = p_guest_id AND g.event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.display_name, v_row.email, v_row.phone, v_row.organizer_note,
    v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Remove one planned guest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_private_draft_planned_guest(
  p_event_id uuid,
  p_guest_id uuid
)
RETURNS TABLE(deleted_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_guest_authorize(p_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_planned_guests AS g
    WHERE g.id = p_guest_id AND g.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Planned guest not found.';
  END IF;

  DELETE FROM public.self_service_private_draft_planned_guests AS g
  WHERE g.id = p_guest_id AND g.event_id = p_event_id;

  RETURN QUERY SELECT p_guest_id;
END;
$function$;

ALTER FUNCTION public.list_my_private_draft_planned_guests(uuid) OWNER TO postgres;
ALTER FUNCTION public.add_my_private_draft_planned_guest(uuid, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.update_my_private_draft_planned_guest(uuid, uuid, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.delete_my_private_draft_planned_guest(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_my_private_draft_planned_guests(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.add_my_private_draft_planned_guest(uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_my_private_draft_planned_guest(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_my_private_draft_planned_guest(uuid, uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_my_private_draft_planned_guests(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_my_private_draft_planned_guest(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_private_draft_planned_guest(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_private_draft_planned_guest(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. P-2D compatibility: the governed self-service private-draft deletion must
--    still succeed after the owner has used this P-3C guest list.
--
--    delete_self_service_organizer_event is restated verbatim from
--    20260929000000 with ONLY one added block: for an ALREADY-authorized
--    eligible private Draft, THIS Event's planned-guest rows are removed
--    transactionally right after the P-3B Agenda cleanup and BEFORE the
--    existing fail-closed dependency scan. The planned-guest table has no
--    immutability trigger, so no ledger exception or governed-deletion marker
--    is involved. Every other line -- the auth gate, the governed-deletion
--    markers, the Agenda cleanup, the fail-closed dependency scan, the
--    empty-workspace teardown, the minimal non-content deletion audit -- is
--    unchanged. CREATE OR REPLACE preserves the existing postgres ownership
--    and authenticated-only EXECUTE ACL (same approach as 20260929000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_self_service_organizer_event(
  p_event_id uuid,
  p_idempotency_key uuid
)
RETURNS TABLE(
  outcome text,
  deleted_event_id uuid,
  deleted_tenant_id uuid,
  deletion_scope text,
  removed_command_audit_count integer,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_existing public.self_service_event_deletion_audit%ROWTYPE;
  v_appointment_id uuid;
  v_appointment_person_id uuid;
  v_tenant_id uuid;
  v_scope text;
  v_other_events integer;
  v_removed_cmd_audit integer;
  v_dep record;
  v_dep_count bigint;
  v_audit public.self_service_event_deletion_audit%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires a verified account email.';
  END IF;

  IF p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An event and an idempotency key are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_event_deletion:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_deletion_target:' || p_event_id::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.self_service_event_deletion_audit AS a
  WHERE a.actor_auth_user_id = v_actor
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.deleted_event_id <> p_event_id THEN
      RAISE EXCEPTION 'Idempotency key was already used to delete a different event.';
    END IF;
    RETURN QUERY SELECT
      'deleted'::text, v_existing.deleted_event_id, v_existing.deleted_tenant_id,
      v_existing.deletion_scope, v_existing.removed_command_audit_count,
      v_existing.occurred_at;
    RETURN;
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT oa.id, oa.person_id, oa.tenant_id
    INTO v_appointment_id, v_appointment_person_id, v_tenant_id
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  WHERE d.event_id = p_event_id
    AND oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_actor)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Was this the last event in its private tenant?  If so, the empty private
  -- workspace goes too.
  SELECT count(*)::integer
    INTO v_other_events
  FROM public.events AS se
  WHERE se.tenant_id = v_tenant_id
    AND se.id <> p_event_id;

  v_scope := CASE WHEN v_other_events = 0
    THEN 'event_and_empty_workspace'
    ELSE 'event_only'
  END;

  SELECT count(*)::integer
    INTO v_removed_cmd_audit
  FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  -- Minimal, non-content deletion fact FIRST.
  INSERT INTO public.self_service_event_deletion_audit (
    organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,
    deletion_scope, removed_command_audit_count, idempotency_key
  ) VALUES (
    v_appointment_person_id, v_actor, p_event_id,
    CASE WHEN v_scope = 'event_and_empty_workspace' THEN v_tenant_id ELSE NULL END,
    v_scope, v_removed_cmd_audit, p_idempotency_key
  ) RETURNING * INTO v_audit;

  -- Open the governed DELETE window for this transaction only: the existing
  -- 'on' marker (immutable onboarding-command / tenant-lifecycle audit
  -- exception) plus a companion marker naming the exact Event id (the
  -- organizer-Agenda ledger exception below verifies BOTH).
  PERFORM set_config('app.self_service_governed_deletion', 'on', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', p_event_id::text, true);

  -- P-3B organizer-Agenda cleanup: THIS Event's known private-draft Agenda
  -- children, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Only this Event's organizer-branch P-3B Agenda ledger rows are removed;
  -- any non-organizer ledger row is left for the scan to fail closed on.
  DELETE FROM public.agenda_command_ledger AS acl
  WHERE acl.event_id = p_event_id
    AND acl.resolved_authority_branch = 'organizer'
    AND acl.task_key IS NULL
    AND acl.action IN (
      'organizer_private_agenda_item_created',
      'organizer_private_agenda_item_updated',
      'organizer_private_agenda_item_deleted'
    );

  DELETE FROM public.agenda_items AS ai
  WHERE ai.event_id = p_event_id;

  DELETE FROM public.event_agenda_state AS eas
  WHERE eas.event_id = p_event_id;

  -- P-3C organizer private guest-list cleanup: THIS Event's planned-guest
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no identity, attendee, or invitation rows exist to
  -- remove, and the deletion audit records only the non-content fact of
  -- deletion (no guest names, emails, phones, or notes).
  DELETE FROM public.self_service_private_draft_planned_guests AS plg
  WHERE plg.event_id = p_event_id;

  -- Complete dependency coverage: after the known private-draft children above,
  -- a hidden Draft self-service event must have no rows in ANY other events(id)
  -- child table.  If that is ever untrue, fail closed with zero partial
  -- deletion -- this whole function is one transaction.  The draft marker and
  -- onboarding command audit for THIS event are the expected children and are
  -- excluded.
  FOR v_dep IN
    SELECT (con.conrelid::regclass)::text AS child_table,
           att.attname AS child_col
    FROM pg_constraint AS con
    JOIN pg_attribute AS att
      ON att.attrelid = con.conrelid
     AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.events'::regclass
      AND con.conrelid NOT IN (
        'public.self_service_private_event_drafts'::regclass,
        'public.self_service_onboarding_command_audit'::regclass
      )
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE %I = $1',
      v_dep.child_table, v_dep.child_col
    ) INTO v_dep_count USING p_event_id;
    IF v_dep_count > 0 THEN
      RAISE EXCEPTION
        'Unfinished event % has unexpected dependent data in %; deletion aborted.',
        p_event_id, v_dep.child_table;
    END IF;
  END LOOP;

  -- Children first: onboarding command audit -> draft marker -> event.
  DELETE FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  DELETE FROM public.self_service_private_event_drafts AS d
  WHERE d.event_id = p_event_id;

  DELETE FROM public.events AS e
  WHERE e.id = p_event_id;

  IF v_scope = 'event_and_empty_workspace' THEN
    DELETE FROM public.self_service_tenant_lifecycle_audit AS la
    WHERE la.tenant_id = v_tenant_id;

    DELETE FROM public.self_service_organizer_appointments AS oa
    WHERE oa.id = v_appointment_id;

    DELETE FROM public.tenants AS t
    WHERE t.id = v_tenant_id;
  END IF;

  -- Close the governed DELETE window immediately: it must not outlive this
  -- operation even within a longer-lived transaction.  (An error before here
  -- aborts the whole transaction, rolling both markers back regardless.)
  PERFORM set_config('app.self_service_governed_deletion', 'off', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', '', true);

  RETURN QUERY SELECT
    'deleted'::text, v_audit.deleted_event_id, v_audit.deleted_tenant_id,
    v_audit.deletion_scope, v_audit.removed_command_audit_count, v_audit.occurred_at;
END;
$function$;

COMMIT;
