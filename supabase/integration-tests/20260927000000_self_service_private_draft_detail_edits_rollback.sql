-- P-3A linked-database behavior proof: an organizer edits her own unfinished
-- private draft's setup details through save_my_self_service_private_draft_details.
--
-- Run only after 20260924000000 … 20260927000000 have been applied.  Creates
-- isolated auth + identity rows, exercises the RPC as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  the canonical owner updates every permitted field, and the events row
--       AND the draft-marker row change together;
--   2.  Event status / is_active / visible_to_members / event_code, and the
--       private tenant's organization name / code / flags, are all unchanged;
--   3.  each invalid input (blank name, bad timezone, location/mode mismatch,
--       over-long location, bad template, end-before-start) is rejected with
--       ZERO partial write;
--   4.  a stale caller baseline is rejected ('stale_draft_details') with ZERO
--       partial write;
--   5.  a non-owner, an unresolved/ambiguous identity, and an active /
--       visible / non-Draft event are all rejected 'Draft not found.' with no
--       write;
--   6.  P-2D capacity and P-2D deletion still behave exactly as before.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3a_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3A fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3a_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3a_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3a_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3a_event_snapshot(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'name', e.name, 'start_date', e.start_date, 'end_date', e.end_date,
    'timezone', e.timezone, 'location', e.location, 'status', e.status,
    'is_active', e.is_active, 'visible_to_members', e.visible_to_members,
    'event_code', e.event_code, 'tenant_id', e.tenant_id, 'created_at', e.created_at
  ) FROM public.events AS e WHERE e.id = p_event_id;
$function$;
ALTER FUNCTION public.p3a_event_snapshot(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3a_event_snapshot(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3a_event_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3a_draft_snapshot(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'location_mode', d.location_mode, 'starter_template', d.starter_template,
    'tenant_id', d.tenant_id, 'organizer_appointment_id', d.organizer_appointment_id
  ) FROM public.self_service_private_event_drafts AS d WHERE d.event_id = p_event_id;
$function$;
ALTER FUNCTION public.p3a_draft_snapshot(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3a_draft_snapshot(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3a_draft_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3a_tenant_snapshot(p_tenant_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'organization_name', t.organization_name, 'organization_code', t.organization_code,
    'display_name', t.display_name, 'app_title', t.app_title,
    'is_active', t.is_active, 'is_self_service_private_draft', t.is_self_service_private_draft
  ) FROM public.tenants AS t WHERE t.id = p_tenant_id;
$function$;
ALTER FUNCTION public.p3a_tenant_snapshot(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3a_tenant_snapshot(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3a_tenant_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3a_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3a_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3a_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3a_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3a_set_limit(p_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.self_service_default_active_event_limit() '
    'RETURNS integer LANGUAGE sql STABLE SET search_path TO ''pg_catalog'' '
    'AS $g$ SELECT %s $g$', p_limit::text
  );
END;
$function$;
ALTER FUNCTION public.p3a_set_limit(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3a_set_limit(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3a_set_limit(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3a_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3a_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3a_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3a_link(uuid, uuid, boolean) TO authenticated;

DO $setup$
DECLARE v_person uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '92e00000-0000-4000-8000-000000000001',
    '92e00000-0000-4000-8000-000000000002',
    '92e00000-0000-4000-8000-000000000003'
  )) THEN
    RAISE EXCEPTION 'P-3A fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('92e00000-0000-4000-8000-000000000001', 'p3a-alice@fixture.invalid', now()),
    ('92e00000-0000-4000-8000-000000000002', 'p3a-bob@fixture.invalid', now()),
    ('92e00000-0000-4000-8000-000000000003', 'p3a-carol@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3a_link(v_person, '92e00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3a_link(v_person, '92e00000-0000-4000-8000-000000000002', true);
  -- Carol -> inactive person -> invalid_or_ambiguous
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3a_link(v_person, '92e00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_d1 record;
  v_saved record;
  v_del record;
  v_event uuid;
  v_tenant uuid;
  v_ev_before jsonb;
  v_dr_before jsonb;
  v_tn_before jsonb;
  v_failed boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '92e00000-0000-4000-8000-000000000001', true);

  SELECT * INTO v_d1 FROM public.create_self_service_organizer_draft(
    'Alice Original', 'Alice Original Event', current_date + 7, 'UTC',
    '92eeee00-0000-4000-8000-000000000001', NULL, 'no_location', NULL, 'casual'
  );
  PERFORM public.p3a_assert(v_d1.outcome = 'created', 'seed draft created');
  v_event := v_d1.event_id;
  v_tenant := v_d1.tenant_id;

  v_tn_before := public.p3a_tenant_snapshot(v_tenant);
  v_ev_before := public.p3a_event_snapshot(v_event);

  -- ================================================================
  -- 1 + 2: the owner updates every permitted field; both tables move
  --        together; status/flags/code and tenant fields do not.
  -- ================================================================
  SELECT * INTO v_saved FROM public.save_my_self_service_private_draft_details(
    v_event,
    'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver',
    'location', 'City Hall', 'dinner',
    -- expected baseline (as originally created)
    'Alice Original Event', NULL, current_date + 7, 'UTC', NULL, 'no_location', 'casual'
  );

  PERFORM public.p3a_assert(
    v_saved.event_name = 'Alice Renamed Event'
    AND v_saved.start_date = current_date + 3
    AND v_saved.end_date = current_date + 10
    AND v_saved.timezone = 'America/Denver'
    AND v_saved.location = 'City Hall'
    AND v_saved.location_mode = 'location'
    AND v_saved.starter_template = 'dinner'
    AND v_saved.status = 'Draft'
    AND v_saved.is_active = false
    AND v_saved.visible_to_members = false
    AND v_saved.organization_name = (v_tn_before->>'organization_name'),
    'the save RPC returns the updated safe draft shape with every permitted field changed'
  );

  PERFORM public.p3a_assert(
    (public.p3a_event_snapshot(v_event)->>'name') = 'Alice Renamed Event'
    AND (public.p3a_event_snapshot(v_event)->>'timezone') = 'America/Denver'
    AND (public.p3a_event_snapshot(v_event)->>'location') = 'City Hall'
    AND (public.p3a_event_snapshot(v_event)->>'start_date') = (current_date + 3)::text
    AND (public.p3a_event_snapshot(v_event)->>'end_date') = (current_date + 10)::text,
    'the events row persisted every changed field'
  );
  PERFORM public.p3a_assert(
    (public.p3a_draft_snapshot(v_event)->>'location_mode') = 'location'
    AND (public.p3a_draft_snapshot(v_event)->>'starter_template') = 'dinner',
    'the draft-marker row persisted location_mode + starter_template together with the events row'
  );
  PERFORM public.p3a_assert(
    (public.p3a_event_snapshot(v_event)->>'status') = 'Draft'
    AND (public.p3a_event_snapshot(v_event)->>'is_active') = 'false'
    AND (public.p3a_event_snapshot(v_event)->>'visible_to_members') = 'false'
    AND (public.p3a_event_snapshot(v_event)->>'event_code') IS NOT DISTINCT FROM (v_ev_before->>'event_code')
    AND (public.p3a_event_snapshot(v_event)->>'tenant_id') = v_tenant::text,
    'status / active / visible / event_code / tenant_id on the event are untouched'
  );
  PERFORM public.p3a_assert(
    public.p3a_tenant_snapshot(v_tenant) = v_tn_before,
    'the private tenant''s organization name / code / display / flags are completely unchanged'
  );

  -- ================================================================
  -- 3: invalid inputs -> zero partial write.
  -- ================================================================
  v_ev_before := public.p3a_event_snapshot(v_event);
  v_dr_before := public.p3a_draft_snapshot(v_event);

  -- blank name
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, '   ', current_date + 3, current_date + 10, 'America/Denver',
      'location', 'City Hall', 'dinner',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event name is required and must be 200 characters or fewer.';
  END;
  PERFORM public.p3a_assert(v_failed, 'a blank name is rejected');

  -- bad timezone
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Alice Renamed Event', current_date + 3, current_date + 10, 'Nowhere/Nope',
      'location', 'City Hall', 'dinner',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'A valid IANA Event timezone is required.';
  END;
  PERFORM public.p3a_assert(v_failed, 'a bad timezone is rejected');

  -- location text with a non-location mode
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver',
      'online', 'City Hall', 'dinner',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Location text is allowed only when location mode is location.';
  END;
  PERFORM public.p3a_assert(v_failed, 'location text with a non-location mode is rejected');

  -- end before start
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Alice Renamed Event', current_date + 10, current_date + 3, 'America/Denver',
      'location', 'City Hall', 'dinner',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Event end date cannot be before start date.';
  END;
  PERFORM public.p3a_assert(v_failed, 'end-before-start is rejected');

  PERFORM public.p3a_assert(
    public.p3a_event_snapshot(v_event) = v_ev_before
    AND public.p3a_draft_snapshot(v_event) = v_dr_before,
    'every invalid input left BOTH tables byte-for-byte unchanged'
  );

  -- ================================================================
  -- 4: stale caller baseline -> zero partial write.
  -- ================================================================
  v_ev_before := public.p3a_event_snapshot(v_event);
  v_dr_before := public.p3a_draft_snapshot(v_event);
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Alice Stale Attempt', NULL, current_date + 12, 'UTC',
      'no_location', NULL, 'casual',
      -- WRONG expected name -> stale
      'Some Other Name', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'stale_draft_details';
  END;
  PERFORM public.p3a_assert(v_failed, 'a stale caller baseline is rejected with stale_draft_details');
  PERFORM public.p3a_assert(
    public.p3a_event_snapshot(v_event) = v_ev_before
    AND public.p3a_draft_snapshot(v_event) = v_dr_before,
    'the stale rejection wrote NEITHER table'
  );

  -- ================================================================
  -- 5: fail-closed -- non-owner, ambiguous identity, active/visible/non-Draft.
  -- ================================================================
  v_ev_before := public.p3a_event_snapshot(v_event);

  -- Bob (a different resolved Person)
  PERFORM set_config('request.jwt.claim.sub', '92e00000-0000-4000-8000-000000000002', true);
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Bob Was Here', NULL, current_date + 9, 'UTC', 'no_location', NULL, 'casual',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Draft not found.';
  END;
  PERFORM public.p3a_assert(v_failed, 'a non-owner save is rejected Draft not found.');

  -- Carol (invalid_or_ambiguous)
  PERFORM set_config('request.jwt.claim.sub', '92e00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Carol Was Here', NULL, current_date + 9, 'UTC', 'no_location', NULL, 'casual',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Draft not found.';
  END;
  PERFORM public.p3a_assert(v_failed, 'an unresolved/ambiguous identity save is rejected fail-closed');

  -- Back to Alice; make the event active / visible / non-Draft in turn.
  PERFORM set_config('request.jwt.claim.sub', '92e00000-0000-4000-8000-000000000001', true);

  PERFORM public.p3a_force_event(v_event, 'Draft', true, false);   -- active
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver',
      'location', 'City Hall', 'dinner',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Draft not found.';
  END;
  PERFORM public.p3a_assert(v_failed, 'an active event cannot be edited through this path');

  PERFORM public.p3a_force_event(v_event, 'Draft', false, true);   -- visible
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver',
      'location', 'City Hall', 'dinner',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Draft not found.';
  END;
  PERFORM public.p3a_assert(v_failed, 'a member-visible event cannot be edited through this path');

  PERFORM public.p3a_force_event(v_event, 'Published', false, false);  -- non-Draft
  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      v_event, 'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver',
      'location', 'City Hall', 'dinner',
      'Alice Renamed Event', current_date + 3, current_date + 10, 'America/Denver', 'City Hall', 'location', 'dinner'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'Draft not found.';
  END;
  PERFORM public.p3a_assert(v_failed, 'a non-Draft event cannot be edited through this path');

  -- restore to a real hidden Draft and confirm the fail-closed attempts wrote nothing to the editable fields
  PERFORM public.p3a_force_event(v_event, 'Draft', false, false);
  PERFORM public.p3a_assert(
    (public.p3a_event_snapshot(v_event)->>'name') = 'Alice Renamed Event'
    AND (public.p3a_event_snapshot(v_event)->>'timezone') = 'America/Denver',
    'none of the fail-closed attempts changed any editable field'
  );

  -- ================================================================
  -- 6: P-2D capacity + deletion still behave exactly as before.
  -- ================================================================
  v_failed := false;
  BEGIN
    PERFORM public.create_self_service_organizer_draft(
      'Alice Second', 'Alice Second Event', current_date + 5, 'UTC',
      '92eeee00-0000-4000-8000-000000000002', NULL, 'no_location', NULL, 'casual'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'You already have an active unfinished event. Finish or delete it before starting another.';
  END;
  PERFORM public.p3a_assert(v_failed, 'P-2D capacity of 1 still rejects a second active unfinished event');

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_event, '92edcd00-0000-4000-8000-000000000001'
  );
  PERFORM public.p3a_assert(
    v_del.outcome = 'deleted' AND v_del.deletion_scope = 'event_and_empty_workspace',
    'P-2D deletion still removes the edited draft and its now-empty workspace'
  );

  RAISE NOTICE 'ALL P-3A ORGANIZER EVENT-DETAIL EDIT ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
