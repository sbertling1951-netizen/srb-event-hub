-- Executable local-database behaviour proof for
-- 20260920000000_converge_registration_canonical_person_identity.sql
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 \
--        -f supabase/integration-tests/20260920000000_registration_identity_convergence_behavior.sql
--
-- One transaction, ROLLED BACK. Creates and destroys its own tenants /
-- events / auth users / people / attendees; never touches real data.
-- Every check is an ASSERT; the closing NOTICE only prints if all passed.
--
-- Matrix:
--   B  registration created AFTER activation  -> automatic bridge -> My Events
--   C  many post-activation registrations     -> all bridge
--   D  brand-new synthetic person/account     -> not tied to today's accounts
--   E  post-activation import (table INSERT)   -> automatic bridge
--   F  identity-bearing UPDATE                 -> becomes matchable -> bridge
--   G  insufficient / unmatched evidence       -> NO guess, NO PRI/PEP, NO issue
--   H  attendees.person_id already another person -> NO overwrite + durable IDENTITY_CONFLICT
--   I  pilot + copilot: each human links only their own supported roles
--   J  cross-tenant same-name                  -> controlled-destination wins
--   K  idempotency                             -> repeat = no duplicates
--   L  historical gap + reconcile_my_member_registrations() -> repaired
--   M  pre-linked registrations                -> stable, no churn
--   N  LAKELAND27 acceptance
--   O  injected unexpected engine failure -> registration survives, ZERO partial
--      identity state, durable ENGINE_ERROR row, repeat deduped
--   O2 DOUBLE failure (engine + issue recorder) -> registration survives, ZERO
--      partial identity state, NO durable row, ONE bounded RAISE WARNING,
--      clean recovery after the faults are removed
--   P  attendee-first shared household email  -> POLICY 1: named person links,
--      other-named role does not, order-independent
--   Q  household-first / staged-complete equivalent -> same final canonical state
--   R  import-order (attendee then household in one governed insert set) -> same
--   S  later edit re-points evidence at a different activated person ->
--      existing lifecycle PRI NOT re-pointed + durable IDENTITY_CONFLICT
--   T  +1 / ten-digit phone forms are equivalent for matching, conflict, recovery
--   plus: inactive/merged exclusions, security/grants, issue-surface RLS

BEGIN;

-- ===========================================================================
-- Fixture
-- ===========================================================================
DO $fx$
DECLARE
  v_tenant_a uuid := gen_random_uuid();
  v_tenant_b uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('c.tenant_a', v_tenant_a::text, false);
  PERFORM set_config('c.tenant_b', v_tenant_b::text, false);

  INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title, is_active)
  VALUES (v_tenant_a, 'CA', 'ca', 'Conv A', 'Conv A', 'Conv A Hub', true),
         (v_tenant_b, 'CB', 'cb', 'Conv B', 'Conv B', 'Conv B Hub', true);
END
$fx$;

-- Helper: stage a registration WITHOUT firing the trigger (models a row
-- written before the trigger existed / by a bypassing path).
-- Used by tests that need the engine to run once against a complete state.

-- ===========================================================================
-- TEST B / N -- registration created AFTER activation converges automatically
-- ===========================================================================
DO $b$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event_old uuid := gen_random_uuid();
  v_event_lakeland uuid := gen_random_uuid();
  v_att_old uuid := gen_random_uuid();
  v_att_new uuid := gen_random_uuid();
  v_my_events uuid[];
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'pat.flyer@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Pat', 'Flyer', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');

  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status, start_date, end_date)
  VALUES (v_event_old, 'Pre-Activation Event', v_tenant, true, true, 'Active', current_date - 30, current_date - 25),
         (v_event_lakeland, 'Lakeland27', v_tenant, true, true, 'Active', current_date + 300, current_date + 305);

  -- pre-linked at activation time (models finalize's output)
  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);
  INSERT INTO public.attendees (id, event_id, person_id, pilot_first, pilot_last, email,
                                is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att_old, v_event_old, v_person, 'Pat', 'Flyer', 'pat.flyer@example.test',
          true, 'registered', false, 0);
  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);
  INSERT INTO public.person_role_instances
    (person_id, tenant_id, event_id, attendee_id, identity_role, source_table, source_record_id,
     attribution_method, evidence_source, source_role_instance_key)
  VALUES (v_person, NULL, v_event_old, v_att_old, 'PILOT', 'public.attendees', v_att_old,
          'automatic_backfill', 'fixture', 'attendee_pilot:'||v_att_old);
  PERFORM public.establish_person_event_participation_from_role_instance(
    (SELECT id FROM public.person_role_instances WHERE source_role_instance_key = 'attendee_pilot:'||v_att_old), NULL);

  -- brand-new event, registration created AFTER activation, no manual step
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email,
                                is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att_new, v_event_lakeland, 'Pat', 'Flyer', 'pat.flyer@example.test',
          true, 'registered', false, 0);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_new) = v_person,
    'B: new post-activation attendee.person_id not set by trigger';
  ASSERT EXISTS (SELECT 1 FROM public.person_role_instances
                 WHERE source_role_instance_key = 'attendee_pilot:'||v_att_new
                   AND person_id = v_person
                   AND attribution_method = 'registration_lifecycle_convergence'),
    'B: PRI not created for post-activation registration';
  ASSERT EXISTS (SELECT 1 FROM public.person_event_participations
                 WHERE person_id = v_person AND event_id = v_event_lakeland
                   AND participation_state = 'eligible'),
    'B: PEP not established for post-activation registration';

  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  SELECT array_agg(event_id) INTO v_my_events FROM public.resolve_member_account();
  PERFORM set_config('request.jwt.claim.sub', '', false);

  ASSERT v_event_lakeland = ANY(v_my_events),
    'N: LAKELAND27 acceptance FAILED -- brand-new post-activation event absent from resolve_member_account';
  ASSERT v_event_old = ANY(v_my_events),
    'N: pre-existing linked event regressed out of resolve_member_account';

  RAISE NOTICE 'TEST B / N: PASS';
END
$b$;

-- ===========================================================================
-- TEST C -- many post-activation registrations all converge
-- ===========================================================================
DO $c$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_e1 uuid := gen_random_uuid();
  v_e2 uuid := gen_random_uuid();
  v_e3 uuid := gen_random_uuid();
  v_seen integer;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'many.events@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Many', 'Events', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');

  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_e1, 'C-One', v_tenant, true, true, 'Active'),
         (v_e2, 'C-Two', v_tenant, true, true, 'Active'),
         (v_e3, 'C-Three', v_tenant, true, true, 'Active');

  INSERT INTO public.attendees (event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_e1, 'Many', 'Events', 'many.events@example.test', true, 'registered', false, 0),
         (v_e2, 'Many', 'Events', 'many.events@example.test', true, 'registered', false, 0),
         (v_e3, 'Many', 'Events', 'many.events@example.test', true, 'registered', false, 0);

  SELECT count(*) INTO v_seen
  FROM public.person_event_participations
  WHERE person_id = v_person AND participation_state = 'eligible'
    AND event_id IN (v_e1, v_e2, v_e3);
  ASSERT v_seen = 3, 'C: expected 3 eligible participations, got '||v_seen;
  RAISE NOTICE 'TEST C: PASS';
END
$c$;

-- ===========================================================================
-- TEST D -- brand-new synthetic person; fix not tied to any prior account
-- ===========================================================================
DO $d$
DECLARE
  v_tenant uuid := current_setting('c.tenant_b')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'future.user@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Future', 'User', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'D-Future-Event', v_tenant, true, true, 'Active');
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Future', 'User', 'future.user@example.test', true, 'registered', false, 0);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person, 'D: not linked';
  ASSERT EXISTS (SELECT 1 FROM public.person_event_participations
                 WHERE person_id = v_person AND event_id = v_event AND participation_state = 'eligible'),
    'D: no participation';
  RAISE NOTICE 'TEST D: PASS';
END
$d$;

-- ===========================================================================
-- TEST E -- post-activation "import" (plain table INSERT) converges
-- ===========================================================================
DO $e$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'import.flyer@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Import', 'Flyer', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'E-Import-Event', v_tenant, true, true, 'Active');

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status,
                                share_with_attendees, login_count, source_type, data_status)
  VALUES (v_att, v_event, 'Import', 'Flyer', 'import.flyer@example.test', true, 'registered',
          false, 0, 'import', 'pending');

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person, 'E: import row not linked';
  ASSERT EXISTS (SELECT 1 FROM public.person_event_participations
                 WHERE person_id = v_person AND event_id = v_event AND participation_state = 'eligible'),
    'E: import row no participation';
  RAISE NOTICE 'TEST E: PASS';
END
$e$;

-- ===========================================================================
-- TEST F -- identity-bearing UPDATE converges on the correcting write
-- ===========================================================================
DO $f$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'correct.address@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Corrected', 'Later', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'F-Correction-Event', v_tenant, true, true, 'Active');

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status,
                                share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Corrected', 'Later', 'typo@example.test', true, 'registered', false, 0);
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) IS NULL, 'F: linked prematurely on wrong email';

  UPDATE public.attendees SET email = 'correct.address@example.test' WHERE id = v_att;

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person, 'F: not linked after email correction';
  ASSERT EXISTS (SELECT 1 FROM public.person_event_participations
                 WHERE person_id = v_person AND event_id = v_event AND participation_state = 'eligible'),
    'F: no participation after correction';
  RAISE NOTICE 'TEST F: PASS';
END
$f$;

-- ===========================================================================
-- TEST G -- insufficient evidence: no guess, no PRI/PEP, and NO issue noise
-- ===========================================================================
DO $g$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att_name_only uuid := gen_random_uuid();
  v_att_email_only uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'g.person@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Gee', 'Person', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'G-Event', v_tenant, true, true, 'Active');

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att_name_only, v_event, 'Gee', 'Person', 'someone.else@example.test', true, 'registered', false, 0);
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att_email_only, v_event, 'Totally', 'Different', 'g.person@example.test', true, 'registered', false, 0);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_name_only) IS NULL, 'G: linked on name-only';
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_email_only) IS NULL, 'G: linked on email-only';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances
                     WHERE source_role_instance_key IN ('attendee_pilot:'||v_att_name_only, 'attendee_pilot:'||v_att_email_only)),
    'G: PRI created on insufficient evidence';
  ASSERT NOT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues
                     WHERE attendee_id IN (v_att_name_only, v_att_email_only)),
    'G: benign no-match generated issue noise';
  RAISE NOTICE 'TEST G: PASS';
END
$g$;

-- ===========================================================================
-- TEST H -- attendees.person_id already another person: NO overwrite +
--            durable IDENTITY_CONFLICT
-- ===========================================================================
DO $h$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid_a uuid := gen_random_uuid();
  v_person_a uuid := gen_random_uuid();
  v_person_b uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid_a, 'shared.h@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person_a, v_tenant, 'Aitch', 'Ay', 'active'),
         (v_person_b, v_tenant, 'Aitch', 'Bee', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person_a, v_uid_a, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'H-Event', v_tenant, true, true, 'Active');

  INSERT INTO public.attendees (id, event_id, person_id, pilot_first, pilot_last, email,
                                is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, v_person_b, 'Aitch', 'Ay', 'shared.h@example.test', true, 'registered', false, 0);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person_b,
    'H: attendees.person_id was overwritten';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances
                     WHERE source_role_instance_key = 'attendee_pilot:'||v_att AND person_id = v_person_a),
    'H: PRI created for the evidence person despite conflict';
  ASSERT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues
                 WHERE attendee_id = v_att AND issue_type = 'IDENTITY_CONFLICT' AND status = 'open'
                   AND evidence_person_id = v_person_a AND conflicting_person_id = v_person_b),
    'H: durable IDENTITY_CONFLICT row missing';
  RAISE NOTICE 'TEST H: PASS';
END
$h$;

-- ===========================================================================
-- TEST I -- pilot + copilot: each human links only their own supported roles
-- ===========================================================================
DO $i$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid_pilot uuid := gen_random_uuid();
  v_uid_copilot uuid := gen_random_uuid();
  v_person_pilot uuid := gen_random_uuid();
  v_person_copilot uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid_pilot, 'ivy.pilot@example.test', now(), 'authenticated', 'authenticated'),
         (v_uid_copilot, 'ike.copilot@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person_pilot, v_tenant, 'Ivy', 'Pilot', 'active'),
         (v_person_copilot, v_tenant, 'Ike', 'Copilot', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person_pilot, v_uid_pilot, 'active'),
         (v_person_copilot, v_uid_copilot, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'I-Event', v_tenant, true, true, 'Active');

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email,
                                copilot_first, copilot_last, copilot_email,
                                is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Ivy', 'Pilot', 'ivy.pilot@example.test',
          'Ike', 'Copilot', 'ike.copilot@example.test',
          true, 'registered', false, 0);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person_pilot,
    'I: attendees.person_id is not the pilot';
  ASSERT EXISTS (SELECT 1 FROM public.person_role_instances
                 WHERE source_role_instance_key = 'attendee_pilot:'||v_att AND person_id = v_person_pilot),
    'I: pilot PRI missing';
  ASSERT EXISTS (SELECT 1 FROM public.person_role_instances
                 WHERE source_role_instance_key = 'attendee_copilot:'||v_att
                   AND person_id = v_person_copilot AND identity_role = 'COPILOT'),
    'I: copilot PRI missing / wrong person';
  ASSERT EXISTS (SELECT 1 FROM public.person_event_participations
                 WHERE person_id = v_person_copilot AND event_id = v_event AND participation_state='eligible'),
    'I: copilot participation missing';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances
                     WHERE source_role_instance_key = 'attendee_pilot:'||v_att AND person_id = v_person_copilot),
    'I: copilot claimed the pilot role';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances
                     WHERE source_role_instance_key = 'attendee_copilot:'||v_att AND person_id = v_person_pilot),
    'I: pilot claimed the copilot role';
  RAISE NOTICE 'TEST I: PASS';
END
$i$;

-- ===========================================================================
-- TEST J -- cross-tenant same-name: controlled destination disambiguates
-- ===========================================================================
DO $j$
DECLARE
  v_tenant_a uuid := current_setting('c.tenant_a')::uuid;
  v_tenant_b uuid := current_setting('c.tenant_b')::uuid;
  v_uid_a uuid := gen_random_uuid();
  v_uid_b uuid := gen_random_uuid();
  v_person_a uuid := gen_random_uuid();
  v_person_b uuid := gen_random_uuid();
  v_event_b uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid_a, 'sam.a@example.test', now(), 'authenticated', 'authenticated'),
         (v_uid_b, 'sam.b@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person_a, v_tenant_a, 'Sam', 'Smith', 'active'),
         (v_person_b, v_tenant_b, 'Sam', 'Smith', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person_a, v_uid_a, 'active'), (v_person_b, v_uid_b, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event_b, 'J-Tenant-B-Event', v_tenant_b, true, true, 'Active');

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event_b, 'Sam', 'Smith', 'sam.b@example.test', true, 'registered', false, 0);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person_b, 'J: linked to the wrong Sam Smith';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances
                     WHERE source_role_instance_key = 'attendee_pilot:'||v_att AND person_id = v_person_a),
    'J: cross-tenant person A wrongly linked';
  RAISE NOTICE 'TEST J: PASS';
END
$j$;

-- ===========================================================================
-- TEST K -- idempotency
-- ===========================================================================
DO $k$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
  v_pri integer;
  v_pep integer;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'kay.once@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Kay', 'Once', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'K-Event', v_tenant, true, true, 'Active');
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Kay', 'Once', 'kay.once@example.test', true, 'registered', false, 0);

  PERFORM public.reconcile_attendee_registration_identity(v_att, NULL);
  PERFORM public.reconcile_attendee_registration_identity(v_att, NULL);
  PERFORM public.reconcile_attendee_registration_identity(v_att, v_uid);

  SELECT count(*) INTO v_pri FROM public.person_role_instances WHERE source_role_instance_key = 'attendee_pilot:'||v_att;
  SELECT count(*) INTO v_pep FROM public.person_event_participations WHERE person_id = v_person AND event_id = v_event;
  ASSERT v_pri = 1, 'K: duplicate PRI ('||v_pri||')';
  ASSERT v_pep = 1, 'K: duplicate PEP ('||v_pep||')';
  RAISE NOTICE 'TEST K: PASS';
END
$k$;

-- ===========================================================================
-- TEST L -- historical gap repaired by the member recovery RPC
-- ===========================================================================
DO $l$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
  v_result jsonb;
  v_my_events uuid[];
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'ella.legacy@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Ella', 'Legacy', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'L-Legacy-Event', v_tenant, true, true, 'Active');

  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Ella', 'Legacy', 'ella.legacy@example.test', true, 'registered', false, 0);
  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) IS NULL, 'L: fixture not actually unlinked';

  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
  v_result := public.reconcile_my_member_registrations();
  SELECT array_agg(event_id) INTO v_my_events FROM public.resolve_member_account();
  PERFORM set_config('request.jwt.claim.sub', '', false);

  ASSERT (v_result ->> 'ok') = 'true', 'L: recovery RPC not ok: '||coalesce(v_result::text,'null');
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person, 'L: not linked after recovery';
  ASSERT v_event = ANY(v_my_events), 'L: legacy event still absent from My Events after recovery';
  RAISE NOTICE 'TEST L: PASS';
END
$l$;

-- ===========================================================================
-- TEST M -- pre-linked registrations stay stable
-- ===========================================================================
DO $m$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
  v_pri_before integer; v_pri_after integer;
  v_pep_before integer; v_pep_after integer;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'stable.member@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Stable', 'Member', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'M-Event', v_tenant, true, true, 'Active');

  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);
  INSERT INTO public.attendees (id, event_id, person_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, v_person, 'Stable', 'Member', 'stable.member@example.test', true, 'registered', false, 0);
  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);
  INSERT INTO public.person_role_instances
    (person_id, tenant_id, event_id, attendee_id, identity_role, source_table, source_record_id,
     attribution_method, evidence_source, source_role_instance_key)
  VALUES (v_person, NULL, v_event, v_att, 'PILOT', 'public.attendees', v_att,
          'automatic_backfill', 'fixture', 'attendee_pilot:'||v_att);
  PERFORM public.establish_person_event_participation_from_role_instance(
    (SELECT id FROM public.person_role_instances WHERE source_role_instance_key='attendee_pilot:'||v_att), NULL);

  SELECT count(*) INTO v_pri_before FROM public.person_role_instances WHERE attendee_id = v_att;
  SELECT count(*) INTO v_pep_before FROM public.person_event_participations WHERE person_id = v_person AND event_id = v_event;

  PERFORM public.reconcile_attendee_registration_identity(v_att, NULL);
  UPDATE public.attendees SET email = 'stable.member@example.test' WHERE id = v_att;

  SELECT count(*) INTO v_pri_after FROM public.person_role_instances WHERE attendee_id = v_att;
  SELECT count(*) INTO v_pep_after FROM public.person_event_participations WHERE person_id = v_person AND event_id = v_event;

  ASSERT v_pri_before = v_pri_after AND v_pri_after = 1, 'M: PRI count changed';
  ASSERT v_pep_before = v_pep_after AND v_pep_after = 1, 'M: PEP count changed';
  ASSERT (SELECT attribution_method FROM public.person_role_instances WHERE source_role_instance_key='attendee_pilot:'||v_att)
         = 'automatic_backfill', 'M: existing PRI attribution was rewritten';
  RAISE NOTICE 'TEST M: PASS';
END
$m$;

-- ===========================================================================
-- TEST inactive/merged exclusions
-- ===========================================================================
DO $excl$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid_inactive uuid := gen_random_uuid();
  v_uid_merged uuid := gen_random_uuid();
  v_person_inactive uuid := gen_random_uuid();
  v_person_merged uuid := gen_random_uuid();
  v_person_survivor uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att_i uuid := gen_random_uuid();
  v_att_m uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid_inactive, 'inactive.p@example.test', now(), 'authenticated', 'authenticated'),
         (v_uid_merged, 'merged.p@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person_survivor, v_tenant, 'Sur', 'Vivor', 'active');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person_inactive, v_tenant, 'In', 'Active', 'inactive');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status, merged_into_person_id)
  VALUES (v_person_merged, v_tenant, 'Mer', 'Ged', 'merged', v_person_survivor);
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person_inactive, v_uid_inactive, 'active'),
         (v_person_merged, v_uid_merged, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'EXCL-Event', v_tenant, true, true, 'Active');

  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att_i, v_event, 'In', 'Active', 'inactive.p@example.test', true, 'registered', false, 0),
         (v_att_m, v_event, 'Mer', 'Ged', 'merged.p@example.test', true, 'registered', false, 0);

  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_i) IS NULL, 'EXCL: inactive person linked';
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_m) IS NULL, 'EXCL: merged person linked';
  RAISE NOTICE 'TEST EXCL (inactive/merged): PASS';
END
$excl$;

-- ===========================================================================
-- TEST O -- injected unexpected engine failure (Doug blocker 1)
--   A real, uncooperative failure: a BEFORE INSERT trigger on
--   person_event_participations that raises. The engine has by then inserted
--   a PRI and set attendees.person_id -- ALL of which must roll back. The
--   registration row survives. A durable ENGINE_ERROR row is written. A
--   second failure bumps occurrence_count instead of flooding.
-- ===========================================================================
DO $o$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
  v_summary jsonb;
  v_occ integer;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'olly.fail@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Olly', 'Fail', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'O-Event', v_tenant, true, true, 'Active');

  -- stage the attendee without the trigger (so we control when the engine runs)
  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Olly', 'Fail', 'olly.fail@example.test', true, 'registered', false, 0);
  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);

  -- inject an unexpected failure downstream of the PRI insert + person_id set
  CREATE FUNCTION pg_temp.o_boom() RETURNS trigger LANGUAGE plpgsql AS
    $boom$ BEGIN RAISE EXCEPTION 'injected downstream failure' USING ERRCODE='XX000'; END $boom$;
  CREATE TRIGGER o_boom_trg BEFORE INSERT ON public.person_event_participations
    FOR EACH ROW EXECUTE FUNCTION pg_temp.o_boom();

  v_summary := public.reconcile_attendee_registration_identity(v_att, NULL);
  ASSERT (v_summary ->> 'ok') = 'false' AND (v_summary ->> 'reason') = 'engine_error',
    'O: engine did not report engine_error: '||coalesce(v_summary::text,'null');

  -- run again to prove dedupe
  PERFORM public.reconcile_attendee_registration_identity(v_att, NULL);

  DROP TRIGGER o_boom_trg ON public.person_event_participations;

  -- registration itself survived
  ASSERT EXISTS (SELECT 1 FROM public.attendees WHERE id = v_att), 'O: attendee row vanished';
  -- ZERO partial identity state
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) IS NULL,
    'O: attendees.person_id left set after rollback';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances WHERE attendee_id = v_att),
    'O: partial PRI survived the failure';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_event_participations WHERE person_id = v_person AND event_id = v_event),
    'O: partial PEP survived the failure';
  -- durable, deduped issue with SQLSTATE captured
  SELECT occurrence_count INTO v_occ
  FROM public.registration_identity_convergence_issues
  WHERE attendee_id = v_att AND issue_type = 'ENGINE_ERROR' AND status = 'open';
  ASSERT v_occ = 2, 'O: expected occurrence_count=2 (deduped), got '||coalesce(v_occ::text,'NULL');
  ASSERT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues
                 WHERE attendee_id = v_att AND issue_type = 'ENGINE_ERROR'
                   AND sqlstate IS NOT NULL AND detail IS NOT NULL),
    'O: SQLSTATE / detail not captured';
  RAISE NOTICE 'TEST O: PASS';
END
$o$;

-- ===========================================================================
-- TEST O2 -- DOUBLE FAILURE: engine fails AND the issue recorder fails.
--   Both faults are injected with real local-only triggers:
--     * BEFORE INSERT on person_event_participations -> engine sub-block fails
--     * BEFORE INSERT on registration_identity_convergence_issues -> the
--       durable ENGINE_ERROR persistence fails too
--   The recorder must NOT re-raise, must emit ONE bounded RAISE WARNING, and
--   the registration must still survive with zero partial identity state and
--   zero durable issue row (persistence was deliberately broken).
--
--   The WARNING is verified by the shell runner, which captures psql
--   stderr around the \echo window markers below and asserts the bounded
--   line is present and PII-free. (PostgreSQL offers no in-SQL warning
--   interception; this is the strongest executable local mechanism.)
-- ===========================================================================
\echo '===O2-WARNING-WINDOW-START==='
DO $o2$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
  v_summary jsonb;
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'olly2.doublefail@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Ollytwo', 'Doublefail', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'O2-Event', v_tenant, true, true, 'Active');

  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Ollytwo', 'Doublefail', 'olly2.doublefail@example.test', true, 'registered', false, 0);
  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);

  -- FAULT A: engine sub-block failure (downstream of PRI insert + person_id set)
  CREATE FUNCTION pg_temp.o2_engine_boom() RETURNS trigger LANGUAGE plpgsql AS
    $b$ BEGIN RAISE EXCEPTION 'injected engine failure' USING ERRCODE='XX000'; END $b$;
  CREATE TRIGGER o2_engine_boom_trg BEFORE INSERT ON public.person_event_participations
    FOR EACH ROW EXECUTE FUNCTION pg_temp.o2_engine_boom();

  -- FAULT B: durable issue persistence failure
  CREATE FUNCTION pg_temp.o2_issue_boom() RETURNS trigger LANGUAGE plpgsql AS
    $b$ BEGIN RAISE EXCEPTION 'injected issue-recorder failure' USING ERRCODE='XX000'; END $b$;
  CREATE TRIGGER o2_issue_boom_trg BEFORE INSERT ON public.registration_identity_convergence_issues
    FOR EACH ROW EXECUTE FUNCTION pg_temp.o2_issue_boom();

  -- the real reconciliation path; the recorder fallback must emit a WARNING
  v_summary := public.reconcile_attendee_registration_identity(v_att, NULL);
  ASSERT (v_summary ->> 'ok') = 'false' AND (v_summary ->> 'reason') = 'engine_error',
    'O2: engine did not report engine_error under double failure';

  DROP TRIGGER o2_engine_boom_trg ON public.person_event_participations;
  DROP TRIGGER o2_issue_boom_trg ON public.registration_identity_convergence_issues;

  -- (1) registration survived
  ASSERT EXISTS (SELECT 1 FROM public.attendees WHERE id = v_att), 'O2: attendee row vanished';
  -- (2)(3)(4) zero partial identity state
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) IS NULL, 'O2: person_id left set';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances WHERE attendee_id = v_att), 'O2: partial PRI survived';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_event_participations WHERE person_id = v_person AND event_id = v_event),
    'O2: partial PEP survived';
  -- (5) NO durable issue row (persistence was deliberately broken)
  ASSERT NOT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues WHERE attendee_id = v_att),
    'O2: an issue row persisted despite the injected recorder failure';

  -- (10) recovery after removing both faults: a later reconcile runs normally
  PERFORM public.reconcile_attendee_registration_identity(v_att, NULL);
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person,
    'O2: reconcile did not converge after the injected faults were removed';
  ASSERT EXISTS (SELECT 1 FROM public.person_event_participations
                 WHERE person_id = v_person AND event_id = v_event AND participation_state = 'eligible'),
    'O2: participation not established on the clean retry';
  ASSERT NOT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues WHERE attendee_id = v_att),
    'O2: a stale issue row appeared after successful recovery';

  RAISE NOTICE 'TEST O2: PASS (state effects). WARNING verified by the shell runner from the window above.';
END
$o2$;
\echo '===O2-WARNING-WINDOW-END==='

-- ===========================================================================
-- TEST P / Q / R -- shared household email, ORDER INDEPENDENCE (Doug blocker 2)
--   POLICY 1: a confirmed account destination + exact name match links that
--   person; a differently-named role sharing the destination does not. The
--   outcome for equivalent final state is identical regardless of write
--   order.
-- ===========================================================================
DO $pqr$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid;
  v_person uuid;
  v_ev_p uuid := gen_random_uuid();
  v_ev_q uuid := gen_random_uuid();
  v_ev_r uuid := gen_random_uuid();
  v_att_p uuid := gen_random_uuid();
  v_att_q uuid := gen_random_uuid();
  v_att_r uuid := gen_random_uuid();
BEGIN
  v_uid := gen_random_uuid(); v_person := gen_random_uuid();
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid, 'hank.family@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Hank', 'Household', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status) VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status) VALUES
    (v_ev_p, 'P-Event', v_tenant, true, true, 'Active'),
    (v_ev_q, 'Q-Event', v_tenant, true, true, 'Active'),
    (v_ev_r, 'R-Event', v_tenant, true, true, 'Active');

  -- P: ATTENDEE FIRST, household member (different name, same email) added later
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att_p, v_ev_p, 'Hank', 'Household', 'hank.family@example.test', true, 'registered', false, 0);
  INSERT INTO public.attendee_household_members (event_id, attendee_id, person_role, first_name, last_name, email)
  VALUES (v_ev_p, v_att_p, 'additional', 'Wilma', 'Household', 'hank.family@example.test');

  -- Q: HOUSEHOLD FIRST (staged, guard suppressed), then reconcile once against the complete state
  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att_q, v_ev_q, 'Hank', 'Household', 'hank.family@example.test', true, 'registered', false, 0);
  INSERT INTO public.attendee_household_members (event_id, attendee_id, person_role, first_name, last_name, email)
  VALUES (v_ev_q, v_att_q, 'additional', 'Wilma', 'Household', 'hank.family@example.test');
  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);
  PERFORM public.reconcile_attendee_registration_identity(v_att_q, NULL);

  -- R: IMPORT-ORDER -- attendee + household written as one staged set then reconciled once
  PERFORM set_config('epicentrax.identity_convergence_active', 'true', true);
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status,
                                share_with_attendees, login_count, source_type)
  VALUES (v_att_r, v_ev_r, 'Hank', 'Household', 'hank.family@example.test', true, 'registered', false, 0, 'import');
  INSERT INTO public.attendee_household_members (event_id, attendee_id, person_role, first_name, last_name, email)
  VALUES (v_ev_r, v_att_r, 'additional', 'Wilma', 'Household', 'hank.family@example.test');
  PERFORM set_config('epicentrax.identity_convergence_active', 'false', true);
  PERFORM public.reconcile_attendee_registration_identity(v_att_r, NULL);

  -- EVERY order: pilot Hank linked; Wilma (different name) not linked; no conflict issue
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_p) = v_person, 'P: attendee-first pilot not linked';
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_q) = v_person, 'Q: household-first pilot not linked';
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att_r) = v_person, 'R: import-order pilot not linked';

  ASSERT (SELECT count(*) FROM public.person_role_instances
          WHERE attendee_id IN (v_att_p, v_att_q, v_att_r) AND identity_role = 'PILOT') = 3,
    'PQR: exactly one PILOT PRI per registration expected';
  ASSERT NOT EXISTS (SELECT 1 FROM public.person_role_instances
                     WHERE attendee_id IN (v_att_p, v_att_q, v_att_r) AND identity_role = 'HOUSEHOLD_MEMBER'),
    'PQR: a differently-named household role was linked';
  ASSERT NOT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues
                     WHERE attendee_id IN (v_att_p, v_att_q, v_att_r)),
    'PQR: shared household email raised an issue under POLICY 1';

  RAISE NOTICE 'TEST P / Q / R (order independence): PASS';
END
$pqr$;

-- ===========================================================================
-- TEST S -- a LATER edit re-points a role's evidence at a DIFFERENT activated
--   person than its existing lifecycle PRI. The PRI is NOT re-pointed; a
--   durable IDENTITY_CONFLICT is raised (the registration does not stay
--   silently "safe").
-- ===========================================================================
DO $s$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid_1 uuid := gen_random_uuid();
  v_uid_2 uuid := gen_random_uuid();
  v_person_1 uuid := gen_random_uuid();
  v_person_2 uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_att uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, aud, role)
  VALUES (v_uid_1, 's.one@example.test', now(), 'authenticated', 'authenticated'),
         (v_uid_2, 's.two@example.test', now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person_1, v_tenant, 'Ess', 'One', 'active'),
         (v_person_2, v_tenant, 'Ess', 'Two', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status)
  VALUES (v_person_1, v_uid_1, 'active'), (v_person_2, v_uid_2, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status)
  VALUES (v_event, 'S-Event', v_tenant, true, true, 'Active');

  -- initial: resolves cleanly to person 1, lifecycle PRI created
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, email, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_att, v_event, 'Ess', 'One', 's.one@example.test', true, 'registered', false, 0);
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person_1, 'S: initial link failed';

  -- later edit: the identifying fields now match person 2 instead
  UPDATE public.attendees SET pilot_last = 'Two', email = 's.two@example.test' WHERE id = v_att;

  ASSERT (SELECT person_id FROM public.person_role_instances WHERE source_role_instance_key = 'attendee_pilot:'||v_att)
         = v_person_1,
    'S: existing lifecycle PRI was re-pointed to the new evidence person';
  ASSERT (SELECT person_id FROM public.attendees WHERE id = v_att) = v_person_1,
    'S: attendees.person_id was re-pointed';
  ASSERT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues
                 WHERE attendee_id = v_att AND issue_type = 'IDENTITY_CONFLICT' AND status = 'open'
                   AND evidence_person_id = v_person_2 AND conflicting_person_id = v_person_1),
    'S: durable IDENTITY_CONFLICT not raised by the later edit';
  RAISE NOTICE 'TEST S: PASS';
END
$s$;

-- ===========================================================================
-- TEST T -- +1 / ten-digit phone forms are equivalent everywhere
-- ===========================================================================
DO $t$
DECLARE
  v_tenant uuid := current_setting('c.tenant_a')::uuid;
  v_uid uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_ev1 uuid := gen_random_uuid();
  v_ev2 uuid := gen_random_uuid();
  v_ev3 uuid := gen_random_uuid();
  v_ev4 uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_a4 uuid := gen_random_uuid();
BEGIN
  -- account's confirmed phone stored WITH +1
  INSERT INTO auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at, aud, role)
  VALUES (v_uid, 'tee.phone@example.test', '+15551234567', now(), now(), 'authenticated', 'authenticated');
  INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
  VALUES (v_person, v_tenant, 'Tee', 'Phone', 'active');
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status) VALUES (v_person, v_uid, 'active');
  INSERT INTO public.events (id, name, tenant_id, is_active, visible_to_members, status) VALUES
    (v_ev1, 'T1', v_tenant, true, true, 'Active'), (v_ev2, 'T2', v_tenant, true, true, 'Active'),
    (v_ev3, 'T3', v_tenant, true, true, 'Active'), (v_ev4, 'T4', v_tenant, true, true, 'Active');

  -- registrations carrying the SAME number in four surface forms; NO email,
  -- so the phone is the only evidence and must match on all four.
  INSERT INTO public.attendees (id, event_id, pilot_first, pilot_last, cell_phone, is_active, registration_status, share_with_attendees, login_count)
  VALUES (v_a1, v_ev1, 'Tee', 'Phone', '5551234567',        true, 'registered', false, 0),
         (v_a2, v_ev2, 'Tee', 'Phone', '+1 555 123 4567',   true, 'registered', false, 0),
         (v_a3, v_ev3, 'Tee', 'Phone', '+1 (555) 123-4567', true, 'registered', false, 0),
         (v_a4, v_ev4, 'Tee', 'Phone', '1-555-123-4567',    true, 'registered', false, 0);

  ASSERT (SELECT count(*) FROM public.attendees WHERE id IN (v_a1,v_a2,v_a3,v_a4) AND person_id = v_person) = 4,
    'T: candidate matching differs across +1 / ten-digit phone forms';

  -- shared-identifier / conflict detection parity: an existing PRI for a
  -- DIFFERENT person + a later phone edit in another surface form still
  -- detects the conflict.
  DECLARE
    v_uid2 uuid := gen_random_uuid();
    v_person2 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at, aud, role)
    VALUES (v_uid2, 'tee2@example.test', '+15559998888', now(), now(), 'authenticated', 'authenticated');
    INSERT INTO public.people (id, tenant_id, display_first_name, display_last_name, status)
    VALUES (v_person2, v_tenant, 'Tee', 'Two', 'active');
    INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status) VALUES (v_person2, v_uid2, 'active');
    -- v_a1 is linked to v_person via phone. Now edit its identity to Tee Two
    -- using a DIFFERENT surface form of person2's number.
    UPDATE public.attendees SET pilot_last = 'Two', cell_phone = '(555) 999-8888' WHERE id = v_a1;
    ASSERT EXISTS (SELECT 1 FROM public.registration_identity_convergence_issues
                   WHERE attendee_id = v_a1 AND issue_type = 'IDENTITY_CONFLICT' AND status='open'
                     AND evidence_person_id = v_person2),
      'T: conflict detection differs across phone surface forms';
  END;

  RAISE NOTICE 'TEST T (phone normalization equivalence): PASS';
END
$t$;

-- ===========================================================================
-- SECURITY / GRANTS / RLS
-- ===========================================================================
DO $sec$
BEGIN
  ASSERT (SELECT proowner::regrole::text FROM pg_proc WHERE proname='reconcile_attendee_registration_identity') = 'postgres',
    'SEC: engine not owned by postgres';
  ASSERT NOT has_function_privilege('authenticated', 'public.reconcile_attendee_registration_identity(uuid, uuid)', 'EXECUTE'),
    'SEC: engine executable by authenticated';
  ASSERT NOT has_function_privilege('anon', 'public.reconcile_attendee_registration_identity(uuid, uuid)', 'EXECUTE'),
    'SEC: engine executable by anon';
  ASSERT NOT has_function_privilege('authenticated', 'public._identity_convergence_resolve_role(text, text, text, text)', 'EXECUTE'),
    'SEC: resolver executable by authenticated';
  ASSERT NOT has_function_privilege('authenticated', 'public._identity_convergence_norm_phone(text)', 'EXECUTE'),
    'SEC: normalizer executable by authenticated';
  ASSERT has_function_privilege('authenticated', 'public.reconcile_my_member_registrations()', 'EXECUTE'),
    'SEC: member recovery RPC NOT executable by authenticated';
  ASSERT has_function_privilege('authenticated', 'public.list_registration_identity_convergence_issues(uuid, text)', 'EXECUTE'),
    'SEC: operator read RPC NOT executable by authenticated';
  ASSERT NOT has_function_privilege('anon', 'public.list_registration_identity_convergence_issues(uuid, text)', 'EXECUTE'),
    'SEC: operator read RPC executable by anon';

  -- issue table: RLS on, no policies, no direct app-role privileges
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.registration_identity_convergence_issues'::regclass),
    'SEC: issue table RLS not enabled';
  ASSERT (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='registration_identity_convergence_issues') = 0,
    'SEC: issue table has policies';
  ASSERT NOT has_table_privilege('authenticated', 'public.registration_identity_convergence_issues', 'SELECT'),
    'SEC: issue table directly selectable by authenticated';
  ASSERT NOT has_table_privilege('anon', 'public.registration_identity_convergence_issues', 'INSERT'),
    'SEC: issue table directly writable by anon';
  RAISE NOTICE 'TEST SECURITY/GRANTS/RLS: PASS';
END
$sec$;

DO $done$ BEGIN RAISE NOTICE 'ALL REGISTRATION IDENTITY CONVERGENCE ASSERTIONS PASSED'; END $done$;

ROLLBACK;
