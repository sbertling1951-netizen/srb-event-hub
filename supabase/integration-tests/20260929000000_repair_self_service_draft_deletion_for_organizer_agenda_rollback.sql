-- P-2D/P-3B deletion-compatibility repair proof.
--
-- Run only after 20260924000000 … 20260929000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  an eligible owner deletes an otherwise-valid private Draft that has
--       organizer Agenda item(s), organizer Agenda ledger rows, and an
--       event_agenda_state row;
--   2.  after success: the Event + draft marker are gone; the Agenda items,
--       agenda state, and organizer Agenda ledger rows are gone; exactly one
--       new minimal self-service deletion-audit row remains, containing no
--       Agenda/event content;
--   3.  ordinary agenda_command_ledger UPDATE and DELETE remain rejected;
--   4.  a non-organizer (admin/event) ledger row cannot be removed through the
--       exception -- not by a wrong event-id marker, not by the governed
--       deletion, and its presence makes delete_self_service_organizer_event
--       fail closed on the dependency scan with ZERO partial deletion;
--   5.  an unexpected non-Agenda event child (announcements) and a
--       live/visible/non-Draft event still fail closed with no partial
--       deletion; an ineligible caller is rejected 'Event not found.';
--   6.  P-2D empty-draft deletion (no Agenda) still succeeds unchanged;
--   7.  P-3B organizer Agenda create/read/update/delete still work.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3r_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3R fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3r_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_agenda_facts(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'items', (SELECT count(*) FROM public.agenda_items WHERE event_id = p_event_id),
    'state', (SELECT count(*) FROM public.event_agenda_state WHERE event_id = p_event_id),
    'ledger_organizer', (
      SELECT count(*) FROM public.agenda_command_ledger
      WHERE event_id = p_event_id AND resolved_authority_branch = 'organizer'
    ),
    'ledger_non_organizer', (
      SELECT count(*) FROM public.agenda_command_ledger
      WHERE event_id = p_event_id AND resolved_authority_branch <> 'organizer'
    )
  );
$function$;
ALTER FUNCTION public.p3r_agenda_facts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_agenda_facts(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_agenda_facts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'events', (SELECT count(*) FROM public.events),
    'tenants', (SELECT count(*) FROM public.tenants),
    'drafts', (SELECT count(*) FROM public.self_service_private_event_drafts),
    'appointments', (SELECT count(*) FROM public.self_service_organizer_appointments),
    'deletion_audit', (SELECT count(*) FROM public.self_service_event_deletion_audit),
    'agenda_items', (SELECT count(*) FROM public.agenda_items),
    'agenda_ledger', (SELECT count(*) FROM public.agenda_command_ledger),
    'agenda_state', (SELECT count(*) FROM public.event_agenda_state)
  );
$function$;
ALTER FUNCTION public.p3r_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_deletion_audit_text()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(string_agg(to_jsonb(a)::text, ' '), '')
  FROM public.self_service_event_deletion_audit AS a;
$function$;
ALTER FUNCTION public.p3r_deletion_audit_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_deletion_audit_text() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_deletion_audit_text() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3r_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_set_limit(p_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.self_service_default_active_event_limit() '
    'RETURNS integer LANGUAGE sql STABLE SET search_path TO ''pg_catalog'' '
    'AS $g$ SELECT %s $g$', p_limit::text
  );
END;
$function$;
ALTER FUNCTION public.p3r_set_limit(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_set_limit(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_set_limit(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.p3r_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_link(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_add_dependency(p_event_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.announcements (event_id) VALUES (p_event_id);
$function$;
ALTER FUNCTION public.p3r_add_dependency(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_add_dependency(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_add_dependency(uuid) TO authenticated;

-- Inject a NON-organizer (event-branch, admin-task) ledger row for an event,
-- as the table owner (bypassing the immutability trigger's ordinary insert
-- path is fine -- the trigger is BEFORE UPDATE/DELETE only).
CREATE OR REPLACE FUNCTION public.p3r_add_admin_ledger_row(p_event_id uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,
    correlation_id, outcome
  ) VALUES (
    'event_agenda_item_created', p_actor, 'event', 'event.agenda.manage', p_event_id,
    gen_random_uuid(), 'success'
  ) RETURNING command_id INTO v_id;
  RETURN v_id;
END;
$function$;
ALTER FUNCTION public.p3r_add_admin_ledger_row(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_add_admin_ledger_row(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_add_admin_ledger_row(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_first_organizer_ledger_id(p_event_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT command_id FROM public.agenda_command_ledger
  WHERE event_id = p_event_id AND resolved_authority_branch = 'organizer'
  ORDER BY occurred_at, command_id LIMIT 1;
$function$;
ALTER FUNCTION public.p3r_first_organizer_ledger_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_first_organizer_ledger_id(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_first_organizer_ledger_id(uuid) TO authenticated;

-- Ordinary (ungoverned) UPDATE / DELETE of a ledger row -> must raise 'immutable'.
CREATE OR REPLACE FUNCTION public.p3r_try_ordinary_update_ledger(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  UPDATE public.agenda_command_ledger SET outcome = outcome WHERE command_id = p_id;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END;
$function$;
ALTER FUNCTION public.p3r_try_ordinary_update_ledger(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_try_ordinary_update_ledger(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_try_ordinary_update_ledger(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_try_ordinary_delete_ledger(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  DELETE FROM public.agenda_command_ledger WHERE command_id = p_id;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END;
$function$;
ALTER FUNCTION public.p3r_try_ordinary_delete_ledger(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_try_ordinary_delete_ledger(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_try_ordinary_delete_ledger(uuid) TO authenticated;

-- Attempt to delete a ledger row WITH both governed-deletion markers set
-- (simulating being inside delete_self_service_organizer_event) for a given
-- event-id marker -> returns SQLERRM or 'no error'. Markers are local + reset.
CREATE OR REPLACE FUNCTION public.p3r_try_governed_delete_ledger(p_id uuid, p_marker_event_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE v_result text;
BEGIN
  PERFORM set_config('app.self_service_governed_deletion', 'on', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', p_marker_event_id::text, true);
  BEGIN
    DELETE FROM public.agenda_command_ledger WHERE command_id = p_id;
    v_result := 'no error';
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLERRM;
  END;
  PERFORM set_config('app.self_service_governed_deletion', 'off', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', '', true);
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.p3r_try_governed_delete_ledger(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_try_governed_delete_ledger(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_try_governed_delete_ledger(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3r_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3r_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3r_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3r_event_exists(uuid) TO authenticated;

DO $setup$
DECLARE v_person uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '93000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000002'
  )) THEN
    RAISE EXCEPTION 'P-3R fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('93000000-0000-4000-8000-000000000001', 'p3r-alice@fixture.invalid', now()),
    ('93000000-0000-4000-8000-000000000002', 'p3r-bob@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3r_link(v_person, '93000000-0000-4000-8000-000000000001');
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3r_link(v_person, '93000000-0000-4000-8000-000000000002');
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_da record; v_db record; v_dc record; v_dd record; v_empty record;
  v_a1 record; v_a2 record; v_upd record;
  v_del record;
  v_before jsonb; v_after jsonb; v_facts jsonb;
  v_da_event uuid; v_db_event uuid; v_dc_event uuid; v_dd_event uuid; v_empty_event uuid;
  v_org_ledger_id uuid; v_admin_ledger_id uuid;
  v_audit_txt text;
  v_failed boolean;
BEGIN
  PERFORM public.p3r_set_limit(50);
  PERFORM set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);

  -- ================================================================
  -- 1 + 2 + 7: a draft WITH agenda content deletes cleanly.
  -- ================================================================
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    'Alice Org A', 'Alice Event A', current_date + 7, 'UTC',
    '93aaaa00-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  v_da_event := v_da.event_id;

  SELECT * INTO v_a1 FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Alice Opening Session', 'Kickoff', 'Room 1', 'Alice',
    current_date + 7, time '09:00', time '09:30'
  );
  SELECT * INTO v_a2 FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Alice Closing Session', NULL, NULL, NULL, current_date + 7, time '16:00', NULL
  );
  SELECT * INTO v_upd FROM public.update_my_private_draft_agenda_item(
    v_da_event, (v_a1.item->>'id')::uuid, 2, 'Alice Opening Session (revised)',
    NULL, NULL, NULL, current_date + 7, time '09:05', NULL
  );
  PERFORM public.p3r_assert(v_upd.agenda_version = 3, 'P-3B agenda RPCs still work: version reached 3');

  v_facts := public.p3r_agenda_facts(v_da_event);
  PERFORM public.p3r_assert(
    (v_facts->>'items')::int = 2
    AND (v_facts->>'state')::int = 1
    AND (v_facts->>'ledger_organizer')::int = 3
    AND (v_facts->>'ledger_non_organizer')::int = 0,
    'the draft has 2 agenda items, 1 agenda-state row, 3 organizer ledger rows'
  );

  v_before := public.p3r_counts();
  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_da_event, '93dede00-0000-4000-8000-000000000001'
  );
  v_after := public.p3r_counts();

  PERFORM public.p3r_assert(
    v_del.outcome = 'deleted' AND v_del.deletion_scope = 'event_and_empty_workspace',
    'a draft with agenda content deletes, workspace removed'
  );
  PERFORM public.p3r_assert(
    NOT public.p3r_event_exists(v_da_event),
    'the Event is gone'
  );
  v_facts := public.p3r_agenda_facts(v_da_event);
  PERFORM public.p3r_assert(
    (v_facts->>'items')::int = 0
    AND (v_facts->>'state')::int = 0
    AND (v_facts->>'ledger_organizer')::int = 0
    AND (v_facts->>'ledger_non_organizer')::int = 0,
    'agenda items, agenda state and organizer agenda ledger rows for the Event are all gone'
  );
  PERFORM public.p3r_assert(
    (v_after->>'events')::bigint = (v_before->>'events')::bigint - 1
    AND (v_after->>'drafts')::bigint = (v_before->>'drafts')::bigint - 1
    AND (v_after->>'appointments')::bigint = (v_before->>'appointments')::bigint - 1
    AND (v_after->>'tenants')::bigint = (v_before->>'tenants')::bigint - 1
    AND (v_after->>'deletion_audit')::bigint = (v_before->>'deletion_audit')::bigint + 1
    AND (v_after->>'agenda_items')::bigint = (v_before->>'agenda_items')::bigint - 2
    AND (v_after->>'agenda_state')::bigint = (v_before->>'agenda_state')::bigint - 1
    AND (v_after->>'agenda_ledger')::bigint = (v_before->>'agenda_ledger')::bigint - 3,
    'exactly one deletion-audit row added; every Agenda + draft row removed; nothing else'
  );
  v_audit_txt := public.p3r_deletion_audit_text();
  PERFORM public.p3r_assert(
    position('Alice Opening Session' in v_audit_txt) = 0
    AND position('Alice Closing Session' in v_audit_txt) = 0
    AND position('Kickoff' in v_audit_txt) = 0
    AND position('Room 1' in v_audit_txt) = 0
    AND position('Alice Org A' in v_audit_txt) = 0,
    'the deletion audit contains no agenda title / description / location / org-name content'
  );

  -- ================================================================
  -- 3: ordinary ledger UPDATE / DELETE still rejected.
  -- ================================================================
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    'Alice Org B', 'Alice Event B', current_date + 7, 'UTC',
    '93aaaa00-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
  );
  v_db_event := v_db.event_id;
  PERFORM public.create_my_private_draft_agenda_item(
    v_db_event, 'B item', NULL, NULL, NULL, NULL, time '10:00', NULL
  );
  v_org_ledger_id := public.p3r_first_organizer_ledger_id(v_db_event);

  PERFORM public.p3r_assert(
    public.p3r_try_ordinary_update_ledger(v_org_ledger_id) = 'agenda command ledger entries are immutable',
    'an ordinary UPDATE of an organizer agenda ledger row is still rejected'
  );
  PERFORM public.p3r_assert(
    public.p3r_try_ordinary_delete_ledger(v_org_ledger_id) = 'agenda command ledger entries are immutable',
    'an ordinary (ungoverned) DELETE of an organizer agenda ledger row is still rejected'
  );

  -- ================================================================
  -- 4: a non-organizer ledger row cannot be removed via the exception,
  --    and its presence fails the governed deletion closed.
  -- ================================================================
  v_admin_ledger_id := public.p3r_add_admin_ledger_row(
    v_db_event, '93000000-0000-4000-8000-000000000001'
  );

  PERFORM public.p3r_assert(
    public.p3r_try_governed_delete_ledger(v_admin_ledger_id, v_db_event)
      = 'agenda command ledger entries are immutable',
    'the governed exception refuses to delete an event-branch (admin task) ledger row'
  );
  PERFORM public.p3r_assert(
    public.p3r_try_governed_delete_ledger(v_org_ledger_id, gen_random_uuid())
      = 'agenda command ledger entries are immutable',
    'the governed exception refuses an organizer ledger row when the marker names a different Event'
  );

  v_before := public.p3r_counts();
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(
      v_db_event, '93dede00-0000-4000-8000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := position('unexpected dependent data in' in SQLERRM) > 0
                AND position('agenda_command_ledger' in SQLERRM) > 0;
  END;
  PERFORM public.p3r_assert(v_failed, 'a leftover non-organizer ledger row makes the governed deletion fail closed on the dependency scan');
  PERFORM public.p3r_assert(
    public.p3r_counts() = v_before AND public.p3r_event_exists(v_db_event),
    'the failed-closed deletion left the Event, draft and ALL agenda data intact (no partial deletion)'
  );

  -- ================================================================
  -- 5: unexpected non-Agenda child; live/visible/non-Draft; ineligible caller.
  -- ================================================================
  SELECT * INTO v_dc FROM public.create_self_service_organizer_draft(
    'Alice Org C', 'Alice Event C', current_date + 7, 'UTC',
    '93aaaa00-0000-4000-8000-000000000003', NULL, 'no_location', NULL, 'casual'
  );
  v_dc_event := v_dc.event_id;
  PERFORM public.create_my_private_draft_agenda_item(
    v_dc_event, 'C item', NULL, NULL, NULL, NULL, time '11:00', NULL
  );
  PERFORM public.p3r_add_dependency(v_dc_event);

  v_before := public.p3r_counts();
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(
      v_dc_event, '93dede00-0000-4000-8000-000000000003'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := position('unexpected dependent data in' in SQLERRM) > 0
                AND position('announcements' in SQLERRM) > 0;
  END;
  PERFORM public.p3r_assert(v_failed, 'an unexpected non-Agenda event child still fails the deletion closed');
  PERFORM public.p3r_assert(
    public.p3r_counts() = v_before AND public.p3r_event_exists(v_dc_event),
    'the unexpected-child rejection left the Event and its agenda intact'
  );

  SELECT * INTO v_dd FROM public.create_self_service_organizer_draft(
    'Alice Org D', 'Alice Event D', current_date + 7, 'UTC',
    '93aaaa00-0000-4000-8000-000000000004', NULL, 'no_location', NULL, 'casual'
  );
  v_dd_event := v_dd.event_id;
  PERFORM public.create_my_private_draft_agenda_item(
    v_dd_event, 'D item', NULL, NULL, NULL, NULL, time '12:00', NULL
  );

  PERFORM public.p3r_force_event(v_dd_event, 'Draft', true, false);
  v_before := public.p3r_counts();
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_dd_event, '93dede00-0000-4000-8000-000000000004');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Event not found.'; END;
  PERFORM public.p3r_assert(v_failed, 'an active event cannot be deleted through this path');
  PERFORM public.p3r_assert(public.p3r_counts() = v_before, 'the active-event rejection wrote nothing');
  PERFORM public.p3r_force_event(v_dd_event, 'Draft', false, false);

  -- ineligible caller (Bob)
  PERFORM set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
  v_before := public.p3r_counts();
  v_failed := false;
  BEGIN
    PERFORM public.delete_self_service_organizer_event(v_dd_event, '93dede00-0000-4000-8000-000000000005');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Event not found.'; END;
  PERFORM public.p3r_assert(v_failed, 'a non-owner deletion is rejected Event not found.');
  PERFORM public.p3r_assert(public.p3r_counts() = v_before, 'the non-owner rejection wrote nothing');

  -- ================================================================
  -- 6: P-2D empty-draft deletion (no Agenda) still works.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_empty FROM public.create_self_service_organizer_draft(
    'Alice Org E', 'Alice Event E', current_date + 7, 'UTC',
    '93aaaa00-0000-4000-8000-000000000005', NULL, 'no_location', NULL, 'casual'
  );
  v_empty_event := v_empty.event_id;
  v_before := public.p3r_counts();
  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_empty_event, '93dede00-0000-4000-8000-000000000006'
  );
  v_after := public.p3r_counts();
  PERFORM public.p3r_assert(
    v_del.outcome = 'deleted'
    AND v_del.deletion_scope = 'event_and_empty_workspace'
    AND v_del.removed_command_audit_count = 1
    AND NOT public.p3r_event_exists(v_empty_event)
    AND (v_after->>'deletion_audit')::bigint = (v_before->>'deletion_audit')::bigint + 1
    AND (v_after->>'agenda_items')::bigint = (v_before->>'agenda_items')::bigint
    AND (v_after->>'agenda_ledger')::bigint = (v_before->>'agenda_ledger')::bigint,
    'P-2D empty-draft deletion is unchanged -- no agenda rows touched'
  );

  RAISE NOTICE 'ALL P-2D/P-3B DELETION-COMPATIBILITY REPAIR ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
