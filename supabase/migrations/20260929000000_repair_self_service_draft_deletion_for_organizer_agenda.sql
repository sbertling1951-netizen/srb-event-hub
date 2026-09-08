-- P-2D/P-3B compatibility repair: the governed self-service private-draft
-- deletion must still succeed after the owner has used the P-3B organizer
-- Agenda.
--
-- Problem: delete_self_service_organizer_event (20260926000000) deliberately
-- scans every events(id) child table and fails closed on unexpected dependent
-- data.  The P-3B organizer Agenda (20260928000000) legitimately creates
-- private-draft children -- agenda_items, event_agenda_state, and
-- organizer-branch rows in the immutable agenda_command_ledger -- so a draft
-- with Agenda content can no longer be deleted.
--
-- Smallest safe repair, in one new migration:
--   1. delete_self_service_organizer_event, for an ALREADY-authorized eligible
--      private Draft only, transactionally removes THIS Event's organizer
--      Agenda ledger rows, agenda items and agenda-version state BEFORE the
--      existing fail-closed dependency scan and Event delete.  Every other
--      unexpected event child still fails closed; nothing is broadly cascaded.
--   2. the agenda_command_ledger immutability trigger gains ONE narrowly
--      scoped DELETE exception (spelled out below).  All ordinary UPDATE/DELETE
--      -- and every admin/tenant/event/platform ledger row -- stay immutable.
--
-- The organizer is granted NO Event task authority (no 'event.agenda.manage').
-- No admin Agenda RPC, Agenda RLS, organizer Agenda create/edit/delete
-- authorization, attendee/identity/payment/launch behavior, or the minimal
-- self-service deletion audit changes.  The deletion audit still records only
-- the non-content fact of deletion -- no Agenda titles, descriptions,
-- locations, or any event content.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Narrowly-scoped DELETE exception on the shared agenda command-ledger
--    immutability trigger.
--
--    A DELETE is permitted ONLY when ALL of these hold:
--      * TG_OP = 'DELETE' (UPDATE is never permitted);
--      * the self-service governed-deletion transaction marker is 'on'
--        (set only by delete_self_service_organizer_event);
--      * a companion marker names the exact Event id being deleted, and this
--        row's event_id matches it;
--      * the row is an organizer-branch P-3B Agenda action
--        (resolved_authority_branch = 'organizer',
--         action IN organizer_private_agenda_item_{created,updated,deleted});
--      * the row has NO admin task key (task_key IS NULL);
--      * that Event is STILL the eligible hidden, inactive, non-member-visible
--        self-service private Draft (re-checked here, not trusted).
--
--    Any admin/tenant/event/platform ledger row, any row with a task key, any
--    row for a different Event, any ungoverned DELETE, and every UPDATE remain
--    rejected exactly as before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._agenda_command_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.self_service_governed_deletion', true) = 'on'
     AND OLD.event_id IS NOT NULL
     AND OLD.event_id::text
         = current_setting('app.self_service_governed_deletion_event_id', true)
     AND OLD.resolved_authority_branch = 'organizer'
     AND OLD.task_key IS NULL
     AND OLD.action IN (
       'organizer_private_agenda_item_created',
       'organizer_private_agenda_item_updated',
       'organizer_private_agenda_item_deleted'
     )
     AND EXISTS (
       SELECT 1
       FROM public.self_service_private_event_drafts AS d
       JOIN public.self_service_organizer_appointments AS oa
         ON oa.id = d.organizer_appointment_id
       JOIN public.tenants AS t ON t.id = oa.tenant_id
       JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
       WHERE d.event_id = OLD.event_id
         AND oa.is_active = true
         AND t.is_active = true
         AND t.is_self_service_private_draft = true
         AND e.status = 'Draft'
         AND e.is_active = false
         AND e.visible_to_members = false
     )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'agenda command ledger entries are immutable';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. delete_self_service_organizer_event: restated verbatim from
--    20260926000000 with ONLY these changes --
--      * the governed-deletion markers (existing 'on' marker + a new
--        event-id companion marker) are set immediately after authorization,
--        and both are cleared at the end;
--      * a P-3B organizer-Agenda cleanup block runs right after -- and BEFORE
--        the fail-closed dependency scan -- removing THIS Event's organizer
--        Agenda ledger rows, agenda items, and agenda-version state;
--      * the minimal deletion-audit insert and scope computation move up so
--        the audit is still the first write.
--    Every other line, including the fail-closed dependency scan and the
--    existing empty-workspace teardown, is unchanged.
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
