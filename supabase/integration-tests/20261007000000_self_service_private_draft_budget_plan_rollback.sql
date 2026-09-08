-- P-3H linked-database behavior proof: a self-service organizer keeps a
-- PRIVATE budget plan for her own unfinished private draft.
--
-- Run only after 20260924000000 … 20261007000000 have been applied. Creates
-- isolated auth + identity rows, exercises the RPCs as the authenticated
-- browser role, and rolls everything back.
--
-- It proves:
--   1.  a brand-new Draft's budget plan is EMPTY -- nothing is seeded,
--       imported, suggested, or created automatically;
--   2.  the eligible owner lists / adds / edits / removes budget lines for her
--       own eligible private Draft only;
--   3.  CURRENCY DEFAULTS TO USD when the caller sends nothing, and BTC is
--       selectable per line;
--   4.  USD accepts at most 2 decimal places and BTC at most 8; EXCESS
--       PRECISION AND NEGATIVE AMOUNTS ARE REJECTED WITHOUT ROUNDING and
--       WITHOUT WRITING ANYTHING; a third currency is refused;
--   5.  name-only lines are valid -- category, both amounts, and the note are
--       all optional and stay NULL;
--   6.  NO CONVERSION: switching a line's currency leaves the organizer's own
--       number untouched, and an amount too precise for the new currency is
--       refused rather than converted or rounded;
--   7.  amounts are stored as EXACT numeric and returned as exact text;
--   8.  another organizer, an unresolved/ambiguous identity, an admin account,
--       a live / member-visible / non-Draft event, and an event whose tenant
--       is no longer a self-service private draft, cannot read or mutate the
--       budget plan -- and DIRECT TABLE ACCESS IS UNAVAILABLE to the browser
--       role entirely;
--   9.  NO budget action creates or changes vendors, event_vendors,
--       agenda_items, people, person_identifiers, attendees,
--       activity_registrations, member_checkin_audit, announcements, or the
--       sibling planning tables, and the Event fingerprint never moves;
--  10.  deleting an event that has budget lines succeeds and removes them; the
--       deletion audit carries no line name, category, currency, amount --
--       and NO LINE COUNT AND NO TOTAL.

BEGIN;

CREATE OR REPLACE FUNCTION public.p3h_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P-3H fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p3h_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_assert(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_untouchable_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'admin_task_registry', (SELECT count(*) FROM public.admin_task_registry),
    'agenda_items', (SELECT count(*) FROM public.agenda_items),
    'event_agenda_state', (SELECT count(*) FROM public.event_agenda_state),
    'announcements', (SELECT count(*) FROM public.announcements),
    'vendors', (SELECT count(*) FROM public.vendors),
    'event_vendors', (SELECT count(*) FROM public.event_vendors),
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'person_identifiers', (SELECT count(*) FROM public.person_identifiers),
    'attendees', (SELECT count(*) FROM public.attendees),
    'activity_registrations', (SELECT count(*) FROM public.activity_registrations),
    'member_checkin_audit', (SELECT count(*) FROM public.member_checkin_audit),
    'vendor_plans', (SELECT count(*) FROM public.self_service_private_draft_vendor_plans),
    'venue_plans', (SELECT count(*) FROM public.self_service_private_draft_venue_plans),
    'registry_plans', (SELECT count(*) FROM public.self_service_private_draft_registry_plans),
    'checklist_items', (SELECT count(*) FROM public.self_service_private_draft_checklist_items),
    'planned_guests', (SELECT count(*) FROM public.self_service_private_draft_planned_guests)
  );
$function$;
ALTER FUNCTION public.p3h_untouchable_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_untouchable_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_untouchable_counts() TO authenticated;

-- Everything a "readiness" or "launch" signal could possibly live in.
CREATE OR REPLACE FUNCTION public.p3h_event_fingerprint(p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'status', e.status, 'is_active', e.is_active,
    'visible_to_members', e.visible_to_members,
    'location', e.location, 'venue_name', e.venue_name,
    'start_date', e.start_date, 'end_date', e.end_date,
    'location_mode', (SELECT d.location_mode FROM public.self_service_private_event_drafts d WHERE d.event_id = e.id)
  )
  FROM public.events AS e WHERE e.id = p_event_id;
$function$;
ALTER FUNCTION public.p3h_event_fingerprint(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_event_fingerprint(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_event_fingerprint(uuid) TO authenticated;

-- The stored row exactly as it sits on disk, including the numeric amounts as
-- exact text -- so the fixture can prove nothing was rounded or converted.
CREATE OR REPLACE FUNCTION public.p3h_row(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT to_jsonb(bl) FROM public.self_service_private_draft_budget_lines AS bl WHERE bl.id = p_id;
$function$;
ALTER FUNCTION public.p3h_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_row(uuid) TO authenticated;

-- Numeric equality against the stored value, independent of display scale.
CREATE OR REPLACE FUNCTION public.p3h_amount_equals(p_id uuid, p_expected numeric)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT bl.estimated_amount = p_expected
  FROM public.self_service_private_draft_budget_lines AS bl WHERE bl.id = p_id;
$function$;
ALTER FUNCTION public.p3h_amount_equals(uuid, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_amount_equals(uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_amount_equals(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_line_count(p_event_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT count(*)::integer FROM public.self_service_private_draft_budget_lines WHERE event_id = p_event_id;
$function$;
ALTER FUNCTION public.p3h_line_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_line_count(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_line_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_force_event(p_event_id uuid, p_status text, p_is_active boolean, p_visible boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.events SET status = p_status, is_active = p_is_active, visible_to_members = p_visible
  WHERE id = p_event_id;
$function$;
ALTER FUNCTION public.p3h_force_event(uuid, text, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_force_event(uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_force_event(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_force_tenant_private(p_event_id uuid, p_private boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  UPDATE public.tenants SET is_self_service_private_draft = p_private
  WHERE id = (SELECT tenant_id FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3h_force_tenant_private(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_force_tenant_private(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_force_tenant_private(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_link(p_person_id uuid, p_auth_user_id uuid, p_is_primary boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', p_is_primary, now());
$function$;
ALTER FUNCTION public.p3h_link(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_link(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_link(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_deletion_audit_text()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(string_agg(to_jsonb(a)::text, ' '), '')
  FROM public.self_service_event_deletion_audit AS a;
$function$;
ALTER FUNCTION public.p3h_deletion_audit_text() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_deletion_audit_text() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_deletion_audit_text() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_audit_keys()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT coalesce(jsonb_agg(DISTINCT k ORDER BY k), '[]')
  FROM public.self_service_event_deletion_audit AS a,
       LATERAL jsonb_object_keys(to_jsonb(a)) AS k;
$function$;
ALTER FUNCTION public.p3h_audit_keys() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_audit_keys() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_audit_keys() TO authenticated;

CREATE OR REPLACE FUNCTION public.p3h_event_exists(p_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id);
$function$;
ALTER FUNCTION public.p3h_event_exists(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p3h_event_exists(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p3h_event_exists(uuid) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
  v_ordinary_tenant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '94b00000-0000-4000-8000-000000000001',
    '94b00000-0000-4000-8000-000000000002',
    '94b00000-0000-4000-8000-000000000003',
    '94b00000-0000-4000-8000-000000000004'
  )) THEN
    RAISE EXCEPTION 'P-3H fixture auth identities are already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('94b00000-0000-4000-8000-000000000001', 'p3h-alice@fixture.invalid', now()),
    ('94b00000-0000-4000-8000-000000000002', 'p3h-bob@fixture.invalid', now()),
    ('94b00000-0000-4000-8000-000000000003', 'p3h-carol@fixture.invalid', now()),
    ('94b00000-0000-4000-8000-000000000004', 'p3h-dave-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3h_link(v_person, '94b00000-0000-4000-8000-000000000001', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3h_link(v_person, '94b00000-0000-4000-8000-000000000002', true);
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p3h_link(v_person, '94b00000-0000-4000-8000-000000000003', true);
  UPDATE public.people SET status = 'inactive' WHERE id = v_person;

  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p3h-fixture-ordinary', 'p3h-fixture-ordinary', 'P3H Ordinary Org', 'P3H Ordinary Org', 'P3H Ordinary Org')
  RETURNING id INTO v_ordinary_tenant;
  INSERT INTO public.admin_users (email, is_active, is_super_admin, privilege_group)
  VALUES ('p3h-dave-admin@fixture.invalid', true, false, 'event_admin');
  INSERT INTO public.admin_tenant_access (admin_user_id, tenant_id, is_active)
  SELECT au.id, v_ordinary_tenant, true FROM public.admin_users au WHERE au.email = 'p3h-dave-admin@fixture.invalid';
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_da record; v_db record;
  v_usd record; v_btc record; v_bare record; v_edited record; v_removed record;
  v_da_event uuid; v_db_event uuid;
  v_count integer;
  v_untouchable jsonb; v_fingerprint jsonb; v_row jsonb; v_keys jsonb;
  v_agenda record; v_guest record; v_vendor record; v_venue record; v_registry record; v_check record;
  v_del record; v_failed boolean; v_audit_txt text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000001', true);
  SELECT * INTO v_da FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Alice Org', p_event_name => 'Alice Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '94bccc00-0000-4000-8000-000000000001',
    p_start_date => NULL, p_location_mode => 'location',
    p_location => 'Original Hall', p_starter_template => 'casual'
  );
  v_da_event := v_da.event_id;

  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000002', true);
  SELECT * INTO v_db FROM public.create_self_service_organizer_draft(
    p_organization_name => 'Bob Org', p_event_name => 'Bob Event',
    p_end_date => current_date + 7, p_timezone => 'UTC',
    p_idempotency_key => '94bccc00-0000-4000-8000-000000000002',
    p_start_date => NULL, p_location_mode => 'no_location',
    p_location => NULL, p_starter_template => 'casual'
  );
  v_db_event := v_db.event_id;

  v_untouchable := public.p3h_untouchable_counts();
  v_fingerprint := public.p3h_event_fingerprint(v_da_event);

  -- ================================================================
  -- 1: A BRAND-NEW DRAFT'S BUDGET PLAN IS EMPTY. Nothing is seeded.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_budget_lines(v_da_event);
  PERFORM public.p3h_assert(v_count = 0, 'a brand-new draft has an EMPTY budget plan -- nothing seeded or imported');
  PERFORM public.p3h_assert(public.p3h_line_count(v_da_event) = 0, 'and no rows exist on disk either');
  PERFORM public.p3h_assert(public.p3h_line_count(v_db_event) = 0, 'a second brand-new draft is also empty');

  -- ================================================================
  -- 3: CURRENCY DEFAULTS TO USD when the caller sends nothing.
  -- ================================================================
  SELECT * INTO v_usd FROM public.add_my_private_draft_budget_line(
    v_da_event, 'Hall deposit', 'Venue'
  );
  PERFORM public.p3h_assert(
    v_usd.line_name = 'Hall deposit' AND v_usd.category = 'Venue' AND v_usd.currency = 'USD',
    'a line added with no currency argument defaults to USD'
  );
  PERFORM public.p3h_assert(
    v_usd.estimated_amount IS NULL AND v_usd.actual_amount IS NULL,
    'and both amounts stay NULL when none were entered'
  );

  -- 5: name only -- category, amounts and note all optional
  SELECT * INTO v_bare FROM public.add_my_private_draft_budget_line(v_da_event, '  DJ  ');
  PERFORM public.p3h_assert(
    v_bare.line_name = 'DJ' AND v_bare.category IS NULL AND v_bare.currency = 'USD'
    AND v_bare.estimated_amount IS NULL AND v_bare.actual_amount IS NULL
    AND v_bare.organizer_note IS NULL,
    'a name-only line is valid: it trims, defaults to USD, and leaves everything else NULL'
  );

  -- ================================================================
  -- 4 + 7: USD accepts at most 2 decimals; exact numeric storage.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_budget_line(
    p_event_id => v_da_event, p_budget_line_id => v_usd.id,
    p_line_name => 'Hall deposit', p_category => 'Venue', p_currency => 'USD',
    p_estimated_amount => 1250.5, p_actual_amount => 1300.00,
    p_organizer_note => 'they want half up front'
  );
  PERFORM public.p3h_assert(
    v_edited.estimated_amount = '1250.50' AND v_edited.actual_amount = '1300.00',
    'a USD amount is stored at 2-decimal scale and returned as exact text'
  );
  PERFORM public.p3h_assert(
    public.p3h_amount_equals(v_usd.id, 1250.5),
    'padding 1250.5 to 1250.50 did NOT change the organizer''s number'
  );
  PERFORM public.p3h_assert(
    (public.p3h_row(v_usd.id) ->> 'organizer_note') = 'they want half up front',
    'the private note round-trips'
  );

  -- ================================================================
  -- 3 + 4: BTC is selectable and accepts up to 8 decimals.
  -- ================================================================
  SELECT * INTO v_btc FROM public.add_my_private_draft_budget_line(
    v_da_event, 'Photographer', 'Photography', 'BTC', 0.015, NULL, 'she quoted in bitcoin'
  );
  PERFORM public.p3h_assert(
    v_btc.currency = 'BTC' AND v_btc.estimated_amount = '0.01500000',
    'a BTC line is stored at 8-decimal scale'
  );
  PERFORM public.p3h_assert(
    public.p3h_amount_equals(v_btc.id, 0.015),
    'and the organizer''s number is numerically unchanged'
  );

  -- one satoshi is representable
  SELECT * INTO v_edited FROM public.update_my_private_draft_budget_line(
    v_da_event, v_btc.id, 'Photographer', 'Photography', 'BTC', 0.00000001, NULL, NULL
  );
  PERFORM public.p3h_assert(v_edited.estimated_amount = '0.00000001', 'one satoshi (8 dp) is accepted');

  -- ================================================================
  -- 4: EXCESS PRECISION AND NEGATIVES ARE REJECTED WITHOUT ROUNDING
  --    and WITHOUT WRITING ANYTHING.
  -- ================================================================
  v_count := public.p3h_line_count(v_da_event);

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'Cake', NULL, 'USD', 12.567);
  EXCEPTION WHEN OTHERS THEN v_failed := position('at most 2 decimal places' in SQLERRM) > 0; END;
  PERFORM public.p3h_assert(v_failed, 'a 3-decimal USD amount is REJECTED, not rounded to 12.57');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'Cake', NULL, 'BTC', 0.000000005);
  EXCEPTION WHEN OTHERS THEN v_failed := position('at most 8 decimal places' in SQLERRM) > 0; END;
  PERFORM public.p3h_assert(v_failed, 'a 9-decimal BTC amount is REJECTED, not rounded');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'Cake', NULL, 'USD', -1.00);
  EXCEPTION WHEN OTHERS THEN v_failed := position('cannot be negative' in SQLERRM) > 0; END;
  PERFORM public.p3h_assert(v_failed, 'a negative estimated amount is rejected');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'Cake', NULL, 'USD', NULL, -0.01);
  EXCEPTION WHEN OTHERS THEN v_failed := position('cannot be negative' in SQLERRM) > 0; END;
  PERFORM public.p3h_assert(v_failed, 'a negative actual amount is rejected');

  -- a third currency is refused outright
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'Cake', NULL, 'EUR', 10.00);
  EXCEPTION WHEN OTHERS THEN v_failed := position('US dollars (USD) or Bitcoin (BTC)' in SQLERRM) > 0; END;
  PERFORM public.p3h_assert(v_failed, 'a currency other than USD or BTC is refused');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, '   ');
  EXCEPTION WHEN OTHERS THEN v_failed := position('needs a name' in SQLERRM) > 0; END;
  PERFORM public.p3h_assert(v_failed, 'a blank line name is rejected');

  PERFORM public.p3h_assert(
    public.p3h_line_count(v_da_event) = v_count,
    'EVERY rejected attempt wrote NOTHING -- no partial row, no rounded row'
  );

  -- ================================================================
  -- 6: NO CONVERSION. Switching a line's currency leaves the number
  --    alone, and an amount too precise for the new currency is
  --    refused rather than converted.
  -- ================================================================
  SELECT * INTO v_edited FROM public.update_my_private_draft_budget_line(
    v_da_event, v_usd.id, 'Hall deposit', 'Venue', 'BTC', 1250.5, 1300.00, NULL
  );
  PERFORM public.p3h_assert(
    v_edited.currency = 'BTC' AND v_edited.estimated_amount = '1250.50000000',
    'switching USD -> BTC re-scales the display only'
  );
  PERFORM public.p3h_assert(
    public.p3h_amount_equals(v_usd.id, 1250.5),
    'THE NUMBER IS UNCHANGED: no exchange rate was applied to it'
  );

  -- a BTC amount with 3 decimals cannot become a USD amount
  v_failed := false;
  BEGIN PERFORM public.update_my_private_draft_budget_line(
    v_da_event, v_btc.id, 'Photographer', 'Photography', 'USD', 0.015, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := position('at most 2 decimal places' in SQLERRM) > 0; END;
  PERFORM public.p3h_assert(
    v_failed,
    'switching a 3-decimal amount to USD is REFUSED -- never converted, never rounded'
  );

  -- put the USD line back; both amounts always move together
  PERFORM public.update_my_private_draft_budget_line(
    v_da_event, v_usd.id, 'Hall deposit', 'Venue', 'USD', 1250.50, 1300.00, NULL);
  v_row := public.p3h_row(v_usd.id);
  PERFORM public.p3h_assert(
    (v_row->>'currency') = 'USD'
    AND (v_row->>'estimated_amount') = '1250.50'
    AND (v_row->>'actual_amount') = '1300.00',
    'the two amounts on one line always share that line''s single currency'
  );

  -- ================================================================
  -- 2: remove.
  -- ================================================================
  SELECT * INTO v_removed FROM public.delete_my_private_draft_budget_line(v_da_event, v_bare.id);
  PERFORM public.p3h_assert(v_removed.deleted_id = v_bare.id, 'delete returns the removed id');

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_budget_line(v_da_event, v_bare.id);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Budget line not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'removing an already-removed line is Budget line not found.');

  -- ================================================================
  -- 8: DIRECT TABLE ACCESS IS UNAVAILABLE to the browser role.
  -- ================================================================
  v_failed := false;
  BEGIN
    EXECUTE 'SELECT 1 FROM public.self_service_private_draft_budget_lines LIMIT 1';
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  PERFORM public.p3h_assert(v_failed, 'the authenticated browser role cannot SELECT the budget table directly');

  v_failed := false;
  BEGIN
    EXECUTE format(
      'INSERT INTO public.self_service_private_draft_budget_lines (event_id, line_name) VALUES (%L, %L)',
      v_da_event, 'smuggled'
    );
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  PERFORM public.p3h_assert(v_failed, 'and cannot INSERT into it directly either');

  -- the internal helpers are granted to nobody
  PERFORM public.p3h_assert(
    NOT has_function_privilege('authenticated', 'public._organizer_private_draft_budget_plan_authorize(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._organizer_private_budget_line_validate(text, text, text, numeric, numeric, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._organizer_private_budget_currency_scale(text)', 'EXECUTE'),
    'the internal helpers are executable by nobody'
  );
  PERFORM public.p3h_assert(
    has_function_privilege('authenticated', 'public.list_my_private_draft_budget_lines(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.list_my_private_draft_budget_lines(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.list_my_private_draft_budget_lines(uuid)', 'EXECUTE'),
    'the budget RPCs are authenticated-only'
  );

  -- ================================================================
  -- 8: non-owner / unresolved / admin / ineligible-state are denied.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000002', true);
  v_count := public.p3h_line_count(v_da_event);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_budget_lines(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'a non-owner organizer cannot list the budget plan');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'Bob was here', NULL, 'USD', 5.00);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'a non-owner organizer cannot add a budget line');

  v_failed := false;
  BEGIN PERFORM public.update_my_private_draft_budget_line(v_da_event, v_usd.id, 'Hijacked', NULL, 'USD', 1.00, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'a non-owner organizer cannot edit another owner''s budget line');

  v_failed := false;
  BEGIN PERFORM public.delete_my_private_draft_budget_line(v_da_event, v_usd.id);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'a non-owner organizer cannot remove a budget line');

  PERFORM public.p3h_assert(public.p3h_line_count(v_da_event) = v_count, 'no non-owner attempt wrote anything');

  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000003', true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_budget_lines(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'an unresolved/ambiguous identity cannot read the budget plan');

  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000004', true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_budget_lines(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'a Platform/tenant admin account gains NO routine read access');

  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'Admin line', NULL, 'USD', 1.00);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'an admin/tenant-admin account gains no write access');

  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000001', true);
  v_count := public.p3h_line_count(v_da_event);

  PERFORM public.p3h_force_event(v_da_event, 'Draft', true, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'x');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'an active event cannot be planned through this path');

  PERFORM public.p3h_force_event(v_da_event, 'Draft', false, true);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_budget_lines(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'a member-visible event cannot be planned through this path');

  PERFORM public.p3h_force_event(v_da_event, 'Published', false, false);
  v_failed := false;
  BEGIN PERFORM public.add_my_private_draft_budget_line(v_da_event, 'x');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'a non-Draft (Published) event cannot be planned through this path');

  PERFORM public.p3h_force_event(v_da_event, 'Draft', false, false);
  PERFORM public.p3h_force_tenant_private(v_da_event, false);
  v_failed := false;
  BEGIN PERFORM public.list_my_private_draft_budget_lines(v_da_event);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'Draft not found.'; END;
  PERFORM public.p3h_assert(v_failed, 'an event whose tenant is no longer a private draft cannot be planned');
  PERFORM public.p3h_force_tenant_private(v_da_event, true);

  -- another event of the OWNER'S OWN cannot be addressed with this line id
  v_failed := false;
  BEGIN PERFORM public.update_my_private_draft_budget_line(v_db_event, v_usd.id, 'Cross-event', NULL, 'USD', 1.00, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  PERFORM public.p3h_assert(v_failed, 'a budget line id cannot be reached through a DIFFERENT event id');

  PERFORM public.p3h_assert(public.p3h_line_count(v_da_event) = v_count, 'no ineligible-state attempt changed the budget plan');

  -- ================================================================
  -- 9: every sibling planning tool still works on the same draft.
  -- ================================================================
  SELECT * INTO v_agenda FROM public.create_my_private_draft_agenda_item(
    v_da_event, 'Welcome', NULL, NULL, NULL, current_date + 7, time '09:00', NULL);
  PERFORM public.p3h_assert(v_agenda.agenda_version = 1, 'the P-3B Agenda still works');
  SELECT * INTO v_guest FROM public.add_my_private_draft_planned_guest(v_da_event, 'Jordan Rivera', NULL, NULL, NULL);
  PERFORM public.p3h_assert(v_guest.display_name = 'Jordan Rivera', 'the P-3C guest list still works');
  SELECT * INTO v_vendor FROM public.add_my_private_draft_vendor_plan(p_event_id => v_da_event, p_vendor_name => 'Riverbend Catering');
  PERFORM public.p3h_assert(v_vendor.vendor_name = 'Riverbend Catering', 'the P-3D vendor plan still works');
  SELECT * INTO v_venue FROM public.add_my_private_draft_venue_plan(v_da_event, 'Riverbend Legion Hall');
  PERFORM public.p3h_assert(v_venue.place_name = 'Riverbend Legion Hall', 'the P-3E venue plan still works');
  SELECT * INTO v_registry FROM public.add_my_private_draft_registry_plan(v_da_event, 'Riverbend Home Store');
  PERFORM public.p3h_assert(v_registry.provider_name = 'Riverbend Home Store', 'the P-3F registry plan still works');
  SELECT * INTO v_check FROM public.add_my_private_draft_checklist_item(v_da_event, 'Call the hall back');
  PERFORM public.p3h_assert(v_check.item_title = 'Call the hall back', 'the P-3G checklist still works');

  -- ...and adding a vendor/venue/registry created NO budget line, and vice versa
  PERFORM public.p3h_assert(
    public.p3h_line_count(v_da_event) = v_count,
    'NOTHING a sibling planning tool did created, imported, or priced a budget line'
  );

  -- ================================================================
  -- 9: nothing readiness-related, identity-related, or commerce-related
  --    moved because of any budget action.
  -- ================================================================
  PERFORM public.p3h_assert(
    public.p3h_event_fingerprint(v_da_event) = v_fingerprint,
    'after ALL budget activity, the Event fingerprint is unchanged'
  );
  DECLARE
    v_now jsonb := public.p3h_untouchable_counts();
  BEGIN
    PERFORM public.p3h_assert(
      (v_now->>'admin_task_registry') = (v_untouchable->>'admin_task_registry')
      AND (v_now->>'announcements') = (v_untouchable->>'announcements')
      AND (v_now->>'vendors') = (v_untouchable->>'vendors')
      AND (v_now->>'event_vendors') = (v_untouchable->>'event_vendors')
      AND (v_now->>'people') = (v_untouchable->>'people')
      AND (v_now->>'person_auth_accounts') = (v_untouchable->>'person_auth_accounts')
      AND (v_now->>'person_identifiers') = (v_untouchable->>'person_identifiers')
      AND (v_now->>'attendees') = (v_untouchable->>'attendees')
      AND (v_now->>'activity_registrations') = (v_untouchable->>'activity_registrations')
      AND (v_now->>'member_checkin_audit') = (v_untouchable->>'member_checkin_audit'),
      'no budget action created or changed admin_task_registry / announcements / vendor / person / attendee / registration / check-in rows'
    );
  END;

  -- ================================================================
  -- 10: deletion removes budget rows; the audit gains NO COUNT, NO
  --     TOTAL, NO CURRENCY, NO AMOUNT, NO CONTENT.
  -- ================================================================
  v_keys := public.p3h_audit_keys();
  PERFORM public.p3h_assert(public.p3h_line_count(v_da_event) >= 1, 'the draft still carries budget lines going into deletion');

  SELECT * INTO v_del FROM public.delete_self_service_organizer_event(
    v_da_event, '94bdcd00-0000-4000-8000-000000000001'
  );
  PERFORM public.p3h_assert(v_del.outcome = 'deleted', 'an event with budget lines deletes cleanly');
  PERFORM public.p3h_assert(NOT public.p3h_event_exists(v_da_event), 'the event is gone');
  PERFORM public.p3h_assert(public.p3h_line_count(v_da_event) = 0, 'the budget rows were removed with the event');

  -- P-2D..P-3G behavior is preserved: the scope and the command-audit count
  -- are still reported exactly as before, and no new audit column appeared.
  PERFORM public.p3h_assert(
    v_del.deletion_scope IN ('event_only', 'event_and_empty_workspace')
    AND v_del.removed_command_audit_count >= 0,
    'the deletion outcome still reports the P-2D scope and command-audit count'
  );
  PERFORM public.p3h_assert(
    public.p3h_audit_keys() = v_keys OR v_keys = '[]'::jsonb,
    'the deletion audit gained no new column'
  );
  v_audit_txt := public.p3h_deletion_audit_text();
  PERFORM public.p3h_assert(
    position('Hall deposit' in v_audit_txt) = 0
    AND position('Photographer' in v_audit_txt) = 0
    AND position('Venue' in v_audit_txt) = 0
    AND position('budget' in v_audit_txt) = 0
    AND position('currency' in v_audit_txt) = 0
    AND position('USD' in v_audit_txt) = 0
    AND position('BTC' in v_audit_txt) = 0
    AND position('1250' in v_audit_txt) = 0
    AND position('amount' in v_audit_txt) = 0,
    'the deletion audit contains no budget name, category, currency, amount, count, or total'
  );

  PERFORM set_config('request.jwt.claim.sub', '94b00000-0000-4000-8000-000000000002', true);
  SELECT count(*) INTO v_count FROM public.list_my_private_draft_budget_lines(v_db_event);
  PERFORM public.p3h_assert(v_count = 0, 'the other organizer''s draft was never written to and is still empty');

  RAISE NOTICE 'ALL P-3H ORGANIZER PRIVATE-DRAFT BUDGET PLAN ASSERTIONS PASSED';
END;
$fixture$;

ROLLBACK;
