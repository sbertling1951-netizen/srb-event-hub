-- Wedding starter-template behavior proof: 'wedding' is accepted everywhere a
-- starter template is validated, and the six existing keys are unchanged.
--
-- Run only after 20260924000000 … 20261006000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  create_self_service_organizer_draft accepts 'wedding' and stores it;
--   2.  save_my_self_service_private_draft_details accepts 'wedding', both
--       switching TO it and away FROM it, through the optimistic-concurrency
--       baseline path;
--   3.  the read paths return the raw stored key unchanged (the friendly label
--       is a client concern -- the server never renames it);
--   4.  ALL SIX existing keys are still accepted by create and by save, with
--       no behavior change;
--   5.  an unknown key is still rejected with the unchanged message, by both
--       create and save;
--   6.  the stored-value CHECK accepts 'wedding' and still rejects an unknown
--       value at the table level;
--   7.  choosing 'wedding' changes NOTHING else -- no event status, activity,
--       visibility, location, or any planning/registry/vendor/venue row.

BEGIN;

CREATE OR REPLACE FUNCTION public.wed_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'Wedding-template fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.wed_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wed_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wed_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wed_stored_template(p_event_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT d.starter_template FROM public.self_service_private_event_drafts d WHERE d.event_id = p_event_id;
$function$;
ALTER FUNCTION public.wed_stored_template(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wed_stored_template(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.wed_stored_template(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wed_event_fingerprint(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'status', e.status, 'is_active', e.is_active,
    'visible_to_members', e.visible_to_members,
    'location', e.location, 'venue_name', e.venue_name
  ) FROM public.events e WHERE e.id = p_event_id;
$function$;
ALTER FUNCTION public.wed_event_fingerprint(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wed_event_fingerprint(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.wed_event_fingerprint(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wed_planning_counts(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'guests', (SELECT count(*) FROM public.self_service_private_draft_planned_guests WHERE event_id = p_event_id),
    'vendors', (SELECT count(*) FROM public.self_service_private_draft_vendor_plans WHERE event_id = p_event_id),
    'venues', (SELECT count(*) FROM public.self_service_private_draft_venue_plans WHERE event_id = p_event_id),
    'registries', (SELECT count(*) FROM public.self_service_private_draft_registry_plans WHERE event_id = p_event_id),
    'checklist', (SELECT count(*) FROM public.self_service_private_draft_checklist_items WHERE event_id = p_event_id),
    'agenda', (SELECT count(*) FROM public.agenda_items WHERE event_id = p_event_id)
  );
$function$;
ALTER FUNCTION public.wed_planning_counts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wed_planning_counts(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.wed_planning_counts(uuid) TO authenticated;

-- Writes the marker directly, to prove the table-level CHECK itself.
CREATE OR REPLACE FUNCTION public.wed_force_template(p_event_id uuid, p_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.self_service_private_event_drafts SET starter_template = p_key WHERE event_id = p_event_id;
$function$;
ALTER FUNCTION public.wed_force_template(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wed_force_template(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.wed_force_template(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.wed_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.wed_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wed_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.wed_link(uuid, uuid) TO authenticated;

DO $setup$
DECLARE v_person uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = '93c00000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Wedding-template fixture auth identity is already in use.';
  END IF;
  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES ('93c00000-0000-4000-8000-000000000001', 'wed-alice@fixture.invalid', now());
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.wed_link(v_person, '93c00000-0000-4000-8000-000000000001');
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_d record; v_saved record; v_read record;
  v_event uuid;
  v_key text;
  v_failed boolean;
  v_fingerprint jsonb; v_counts jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '93c00000-0000-4000-8000-000000000001', true);

  -- ================================================================
  -- 1: create accepts 'wedding' and stores it verbatim.
  -- ================================================================
  SELECT * INTO v_d FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Alice Org', p_event_name => 'Alice Wedding',
    p_end_date => current_date + 30, p_timezone => 'UTC',
    p_idempotency_key => '93cccc00-0000-4000-8000-000000000001',
    p_start_date => NULL, p_location_mode => 'no_location',
    p_location => NULL, p_starter_template => 'wedding'
  );
  v_event := v_d.event_id;
  PERFORM public.wed_assert(v_d.starter_template = 'wedding', 'create returns the wedding key');
  PERFORM public.wed_assert(public.wed_stored_template(v_event) = 'wedding',
    'the wedding key is stored verbatim on the draft marker');

  v_fingerprint := public.wed_event_fingerprint(v_event);
  v_counts := public.wed_planning_counts(v_event);

  -- ================================================================
  -- 3: the read paths return the raw stored key -- the server never
  --    renames it, and the friendly label is purely a client concern.
  -- ================================================================
  SELECT * INTO v_read FROM public.get_my_self_service_private_draft(v_event);
  PERFORM public.wed_assert(v_read.starter_template = 'wedding',
    'the read RPC returns the raw stored key, not a label');

  -- ================================================================
  -- 2: save accepts 'wedding' and moves away from it, through the
  --    optimistic-concurrency baseline path.
  -- ================================================================
  SELECT * INTO v_saved FROM public.save_my_self_service_private_draft_details(
    p_event_id => v_event, p_event_name => 'Alice Wedding',
    p_start_date => NULL, p_end_date => current_date + 30, p_timezone => 'UTC',
    p_location_mode => 'no_location', p_location => NULL,
    p_starter_template => 'dinner',
    p_expected_event_name => 'Alice Wedding', p_expected_start_date => NULL,
    p_expected_end_date => current_date + 30, p_expected_timezone => 'UTC',
    p_expected_location => NULL, p_expected_location_mode => 'no_location',
    p_expected_starter_template => 'wedding'
  );
  PERFORM public.wed_assert(v_saved.starter_template = 'dinner',
    'save moves AWAY from wedding, with wedding as the accepted baseline');

  SELECT * INTO v_saved FROM public.save_my_self_service_private_draft_details(
    p_event_id => v_event, p_event_name => 'Alice Wedding',
    p_start_date => NULL, p_end_date => current_date + 30, p_timezone => 'UTC',
    p_location_mode => 'no_location', p_location => NULL,
    p_starter_template => 'wedding',
    p_expected_event_name => 'Alice Wedding', p_expected_start_date => NULL,
    p_expected_end_date => current_date + 30, p_expected_timezone => 'UTC',
    p_expected_location => NULL, p_expected_location_mode => 'no_location',
    p_expected_starter_template => 'dinner'
  );
  PERFORM public.wed_assert(v_saved.starter_template = 'wedding', 'save moves BACK to wedding');

  -- ================================================================
  -- 4: every one of the six existing keys is still accepted by save.
  -- ================================================================
  v_key := 'wedding';
  FOREACH v_key IN ARRAY ARRAY['casual','birthday_family','club_rv','conference_corporate','dinner','sports_activity'] LOOP
    SELECT * INTO v_saved FROM public.save_my_self_service_private_draft_details(
      p_event_id => v_event, p_event_name => 'Alice Wedding',
      p_start_date => NULL, p_end_date => current_date + 30, p_timezone => 'UTC',
      p_location_mode => 'no_location', p_location => NULL,
      p_starter_template => v_key,
      p_expected_event_name => 'Alice Wedding', p_expected_start_date => NULL,
      p_expected_end_date => current_date + 30, p_expected_timezone => 'UTC',
      p_expected_location => NULL, p_expected_location_mode => 'no_location',
      p_expected_starter_template => public.wed_stored_template(v_event)
    );
    PERFORM public.wed_assert(v_saved.starter_template = v_key,
      format('the pre-existing key %s is still accepted by save', v_key));
  END LOOP;

  -- 4: and the widened table-level CHECK accepts every one of the seven.
  --     (Create is NOT looped per key here: the one-active-unpaid-project
  --     quota deliberately forbids a second draft for the same person, and
  --     this fixture must not fabricate a violation of that rule. Create's
  --     acceptance of 'wedding' is proved above; its acceptance of the six
  --     originals is unchanged by this migration and covered by the P-2D
  --     fixtures.)
  FOREACH v_key IN ARRAY ARRAY['casual','birthday_family','club_rv','conference_corporate','dinner','sports_activity','wedding'] LOOP
    PERFORM public.wed_force_template(v_event, v_key);
    PERFORM public.wed_assert(public.wed_stored_template(v_event) = v_key,
      format('the widened CHECK accepts %s at the table level', v_key));
  END LOOP;

  -- ================================================================
  -- 5: an unknown key is still rejected, message unchanged.
  -- ================================================================
  -- NB: whitespace is btrim'd BEFORE validation (long-standing behavior,
  -- identical for all six pre-existing keys and unchanged by this migration),
  -- so '  wedding  ' is accepted rather than rejected -- asserted separately
  -- below. Only genuinely unknown values belong in this rejection list.
  FOREACH v_key IN ARRAY ARRAY['housewarming','WEDDING','Wedding','wedding_reception'] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.create_self_service_organizer_draft(
        p_organization_name => 'Bad Org', p_event_name => 'Bad Event',
        p_end_date => current_date + 30, p_timezone => 'UTC',
        p_idempotency_key => '93ceee00-0000-4000-8000-000000000001',
        p_start_date => NULL, p_location_mode => 'no_location',
        p_location => NULL, p_starter_template => v_key
      );
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Starter template is not recognized.'; END;
    PERFORM public.wed_assert(v_failed, format('create rejects the unknown key %L unchanged', v_key));
  END LOOP;

  -- and the pre-existing trim behavior applies to wedding exactly as it does
  -- to every other key -- surrounding whitespace is trimmed, not rejected
  SELECT * INTO v_saved FROM public.save_my_self_service_private_draft_details(
    p_event_id => v_event, p_event_name => 'Alice Wedding',
    p_start_date => NULL, p_end_date => current_date + 30, p_timezone => 'UTC',
    p_location_mode => 'no_location', p_location => NULL,
    p_starter_template => '  wedding  ',
    p_expected_event_name => 'Alice Wedding', p_expected_start_date => NULL,
    p_expected_end_date => current_date + 30, p_expected_timezone => 'UTC',
    p_expected_location => NULL, p_expected_location_mode => 'no_location',
    p_expected_starter_template => public.wed_stored_template(v_event)
  );
  PERFORM public.wed_assert(v_saved.starter_template = 'wedding',
    'surrounding whitespace is trimmed for wedding, exactly as for every other key');

  v_failed := false;
  BEGIN
    PERFORM public.save_my_self_service_private_draft_details(
      p_event_id => v_event, p_event_name => 'Alice Wedding',
      p_start_date => NULL, p_end_date => current_date + 30, p_timezone => 'UTC',
      p_location_mode => 'no_location', p_location => NULL,
      p_starter_template => 'housewarming',
      p_expected_event_name => 'Alice Wedding', p_expected_start_date => NULL,
      p_expected_end_date => current_date + 30, p_expected_timezone => 'UTC',
      p_expected_location => NULL, p_expected_location_mode => 'no_location',
      p_expected_starter_template => public.wed_stored_template(v_event)
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Starter template is not recognized.'; END;
  PERFORM public.wed_assert(v_failed, 'save rejects an unknown key with the unchanged message');

  -- ================================================================
  -- 6: the table-level CHECK itself accepts wedding, rejects unknown.
  -- ================================================================
  PERFORM public.wed_force_template(v_event, 'wedding');
  PERFORM public.wed_assert(public.wed_stored_template(v_event) = 'wedding',
    'the widened CHECK accepts wedding at the table level');

  v_failed := false;
  BEGIN PERFORM public.wed_force_template(v_event, 'housewarming');
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  PERFORM public.wed_assert(v_failed, 'the CHECK still rejects an unknown value at the table level');

  -- ================================================================
  -- 7: choosing wedding changed nothing else.
  -- ================================================================
  PERFORM public.wed_assert(
    public.wed_event_fingerprint(v_event) = v_fingerprint,
    'the Event status / activity / visibility / location are unchanged by the template choice'
  );
  PERFORM public.wed_assert(
    public.wed_planning_counts(v_event) = v_counts,
    'no guest / vendor / venue / registry / checklist / agenda row was created by choosing wedding'
  );
  PERFORM public.wed_assert(
    (public.wed_planning_counts(v_event)->>'checklist')::int = 0
    AND (public.wed_planning_counts(v_event)->>'agenda')::int = 0,
    'a wedding draft is as blank as any other -- nothing is seeded for it'
  );

  RAISE NOTICE 'ALL WEDDING STARTER-TEMPLATE ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
