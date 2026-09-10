-- P0 Event-Photo Read-Surface Repair -- linked-database behavior proof.
--
-- Run only after 20261010000000 has been applied. Creates isolated auth /
-- attendee / photo / presentation-session rows, exercises the repaired
-- surfaces as the authenticated (and, for slideshow, anonymous) browser
-- role, and rolls everything back. NOT executed as part of this
-- implementation task -- proof-of-shape only, per this repository's
-- established convention for behavioral fixtures.
--
-- Part D repairs (Dou's final adversarial review) applied in this revision,
-- so this fixture can genuinely run in a later isolated replay:
--   * every identity/attendee lookup performed AS authenticated now goes
--     through a SECURITY DEFINER fixture helper (p0_resolve_person_attendee)
--     instead of a raw SELECT against person_auth_accounts/people --
--     authenticated holds no direct grant on those identity tables (they are
--     governed-RPC-only, matching resolve_auth_person_link's own posture),
--     so the earlier raw reads would have returned nothing regardless of the
--     intended test outcome;
--   * every manual DELETE of a presentation_session_items row, a
--     presentation_sessions row, or an event_photo_command_audit row is
--     removed -- both the former and the latter carry a BEFORE UPDATE OR
--     DELETE immutability trigger (20260811420000, 20260811390000) that
--     unconditionally raises, so those deletes could never have succeeded;
--     this whole fixture is one transaction ending in ROLLBACK, which is
--     the actual cleanup;
--   * every fixture Event now sets end_date/timezone -- manage_event_photo
--     and every presentation-admin RPC call PERFORM
--     assert_event_lifecycle_mutable, which raises
--     'event_lifecycle_indeterminate' for an Event with no end_date/
--     timezone; without these fields the "ordinary Event admin succeeds"
--     positive controls would have failed for an unrelated reason, not
--     proven what they claimed to prove;
--   * INSERT-denial checks narrow their exception handler to SQLSTATE
--     '42501' (insufficient_privilege, Postgres's own code for a violated
--     RLS policy) instead of a bare WHEN OTHERS, so an unrelated failure
--     (a constraint violation, a typo, a schema drift) is never
--     misattributed to "authorization correctly denied this";
--   * canonical-path/traversal/aliasing assertions are exercised as direct
--     calls to the pure is_canonical_event_photo_path predicate wherever
--     possible, avoiding INSERT/exception-handling entirely for those
--     specific checks;
--   * this fixture creates real event_photos metadata rows and calls the
--     real RLS policies/PL/pgSQL authorization functions -- it proves
--     database-level row/authority outcomes. It does NOT create or read any
--     storage.objects row, fetch any signed URL, or exercise
--     lib/server/eventPhotoRendition.ts's actual byte-fetch path -- those
--     remain a separate runtime/API verification requirement, not something
--     this SQL-only fixture can honestly claim to prove.
--
-- It proves the accepted P0 matrix:
--   1. a contributor reads and pending-deletes her own photo;
--   2. a contributor's own approved photo: gallery-row view and
--      original-download authority (the object-read helper) both allowed;
--   3. a same-Event non-contributor attendee: gallery-row view of another
--      attendee's approved photo allowed; the object-read helper (i.e.
--      original-download authority) for that same photo denied;
--   4. a different-Event attendee, and an unrelated authenticated account
--      with no attendee row anywhere: row and object read both denied;
--   5. an Event administrator: row read, moderation, and object read all
--      allowed for her own ordinary Event;
--   6. the presentation-session slot resolver returns only the live
--      session's current/next approved photo, denies a non-'live' session,
--      and is unreachable except through the service_role grant;
--   7. read_public_presentation_session no longer returns a storage path
--      for any session, live or not;
--   8. none of the above touches people, person_auth_accounts, or any
--      self_service_organizer_appointments / admin authority table;
--   9. forged own-pending metadata (same-Event and other-Event aliasing) is
--      denied at INSERT and, for a row that predates the guard, by the
--      object-read helper;
--  10. exact canonical paths are accepted; extra-segment/traversal-shaped
--      and dot-segment paths are denied, as direct predicate calls;
--  11. a self-service private-Draft Event denies row read, object read,
--      member INSERT/upload/pending-delete, manage_event_photo moderation,
--      presentation-session read/state, and representative presentation-
--      admin RPCs (create_presentation_deck, start_presentation_session) --
--      even for a genuine Platform Administrator and even for a genuinely
--      matching simulated attendee -- while an ordinary (non-private-Draft)
--      Event's equivalent paths keep working exactly as before;
--  12. an inactive Tenant denies anonymous presentation delivery; unattended
--      timed polling still advances a live session; a photo rejected while
--      currently displayed clears from the next poll (content_type/
--      content_ref_id/duration, and the caption resolver, all null out);
--  13. the anonymous approval-existence probe (is_approved_event_photo_object)
--      no longer exists, and public.event_photos carries no anon grant.

BEGIN;

CREATE OR REPLACE FUNCTION public.p0_assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'P0 photo-read-surface fixture assertion failed: %', p_message;
  END IF;
END;
$function$;
ALTER FUNCTION public.p0_assert(boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p0_assert(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p0_assert(boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p0_can_read_row(p_photo_id uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.event_photos WHERE id = p_photo_id);
$function$;
ALTER FUNCTION public.p0_can_read_row(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p0_can_read_row(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p0_can_read_row(uuid) TO authenticated;

-- SECURITY INVOKER (like p0_can_read_row): runs as the caller, so this
-- genuinely exercises presentation_decks_admin_select_policy's own RLS,
-- not a bypassed/elevated read.
CREATE OR REPLACE FUNCTION public.p0_can_read_presentation_deck(p_deck_id uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path TO 'pg_catalog' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.presentation_decks WHERE id = p_deck_id);
$function$;
ALTER FUNCTION public.p0_can_read_presentation_deck(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p0_can_read_presentation_deck(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p0_can_read_presentation_deck(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.p0_untouchable_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT jsonb_build_object(
    'people', (SELECT count(*) FROM public.people),
    'person_auth_accounts', (SELECT count(*) FROM public.person_auth_accounts),
    'self_service_organizer_appointments', (SELECT count(*) FROM public.self_service_organizer_appointments),
    'admin_users', (SELECT count(*) FROM public.admin_users)
  );
$function$;
ALTER FUNCTION public.p0_untouchable_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p0_untouchable_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p0_untouchable_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.p0_link(p_person_id uuid, p_auth_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  INSERT INTO public.person_auth_accounts (person_id, auth_user_id, status, is_primary, verified_at)
  VALUES (p_person_id, p_auth_user_id, 'active', true, now());
$function$;
ALTER FUNCTION public.p0_link(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p0_link(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p0_link(uuid, uuid) TO authenticated;

-- Part D: identity/attendee resolution AS authenticated must go through a
-- governed, SECURITY DEFINER fixture helper -- authenticated holds no
-- direct SELECT grant/RLS visibility on person_auth_accounts or people
-- (governed-RPC-only, the same posture resolve_auth_person_link's own
-- REVOKE ALL establishes), so a raw multi-table SELECT run as authenticated
-- would return nothing regardless of the intended test outcome.
CREATE OR REPLACE FUNCTION public.p0_resolve_person_attendee(p_auth_user_id uuid, p_event_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
  SELECT a.id
  FROM public.person_auth_accounts AS paa
  JOIN public.people AS p ON p.id = paa.person_id
  JOIN public.attendees AS a ON a.person_id = p.id AND a.event_id = p_event_id
  WHERE paa.auth_user_id = p_auth_user_id;
$function$;
ALTER FUNCTION public.p0_resolve_person_attendee(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.p0_resolve_person_attendee(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.p0_resolve_person_attendee(uuid, uuid) TO authenticated;

DO $setup$
DECLARE
  v_person uuid;
  v_tenant_a uuid;
  v_tenant_b uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    '900e0000-0000-4000-8000-000000000001',
    '900e0000-0000-4000-8000-000000000002',
    '900e0000-0000-4000-8000-000000000003',
    '900e0000-0000-4000-8000-000000000004',
    '900e0000-0000-4000-8000-000000000005'
  )) THEN
    RAISE EXCEPTION 'P0 fixture auth identities are already in use.';
  END IF;

  -- 1: Ava, the contributor. 2: Ben, a same-Event non-contributor attendee.
  -- 3: Cleo, an attendee of a DIFFERENT Event only. 4: Dev, an authenticated
  -- account with NO attendee row anywhere. 5: Erin, an Event administrator
  -- scoped to Event A only.
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('900e0000-0000-4000-8000-000000000001', 'p0-ava@fixture.invalid', now()),
    ('900e0000-0000-4000-8000-000000000002', 'p0-ben@fixture.invalid', now()),
    ('900e0000-0000-4000-8000-000000000003', 'p0-cleo@fixture.invalid', now()),
    ('900e0000-0000-4000-8000-000000000004', 'p0-dev@fixture.invalid', now()),
    ('900e0000-0000-4000-8000-000000000005', 'p0-erin-admin@fixture.invalid', now());

  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p0_link(v_person, '900e0000-0000-4000-8000-000000000001');
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p0_link(v_person, '900e0000-0000-4000-8000-000000000002');
  INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_person;
  PERFORM public.p0_link(v_person, '900e0000-0000-4000-8000-000000000003');
  -- Dev deliberately gets no people/person_auth_accounts row at all.

  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p0-fixture-tenant-a', 'p0-fixture-tenant-a', 'P0 Tenant A', 'P0 Tenant A', 'P0 Tenant A')
  RETURNING id INTO v_tenant_a;
  INSERT INTO public.tenants (organization_code, slug, organization_name, display_name, app_title)
  VALUES ('p0-fixture-tenant-b', 'p0-fixture-tenant-b', 'P0 Tenant B', 'P0 Tenant B', 'P0 Tenant B')
  RETURNING id INTO v_tenant_b;

  -- user_id must be set here -- has_event_admin_authority's admin_users
  -- branch requires au.user_id = the caller's own auth uid; a row with a
  -- NULL user_id can never match any caller.
  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('p0-erin-admin@fixture.invalid', '900e0000-0000-4000-8000-000000000005', true, false, 'event_admin');

  PERFORM set_config('p0.tenant_a', v_tenant_a::text, true);
  PERFORM set_config('p0.tenant_b', v_tenant_b::text, true);
END;
$setup$;

SET LOCAL ROLE postgres;

DO $events$
DECLARE
  v_event_a uuid;
  v_event_b uuid;
  v_attendee_ava uuid;
  v_attendee_ben uuid;
  v_attendee_cleo uuid;
  v_admin_id uuid;
  v_admin_event_access_id uuid;
BEGIN
  -- end_date/timezone are required here: manage_event_photo and every
  -- presentation-admin RPC PERFORM assert_event_lifecycle_mutable, which
  -- raises 'event_lifecycle_indeterminate' for an Event with either field
  -- missing (event_effective_lifecycle_state's own documented behavior).
  -- Without them, this fixture's "ordinary Event admin succeeds" positive
  -- controls would fail for an unrelated reason, not prove what they claim.
  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('P0 Fixture Event A', current_setting('p0.tenant_a')::uuid, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_event_a;
  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('P0 Fixture Event B', current_setting('p0.tenant_b')::uuid, 'Active', true, true, current_date + 7, 'UTC')
  RETURNING id INTO v_event_b;

  SELECT p.id INTO v_attendee_ava FROM public.person_auth_accounts paa
    JOIN public.people p ON p.id = paa.person_id
    WHERE paa.auth_user_id = '900e0000-0000-4000-8000-000000000001';
  INSERT INTO public.attendees (event_id, person_id, pilot_first, pilot_last)
  VALUES (v_event_a, v_attendee_ava, 'Ava', 'Fixture') RETURNING id INTO v_attendee_ava;

  INSERT INTO public.attendees (event_id, person_id, pilot_first, pilot_last)
  SELECT v_event_a, p.id, 'Ben', 'Fixture' FROM public.person_auth_accounts paa
    JOIN public.people p ON p.id = paa.person_id
    WHERE paa.auth_user_id = '900e0000-0000-4000-8000-000000000002'
  RETURNING id INTO v_attendee_ben;

  INSERT INTO public.attendees (event_id, person_id, pilot_first, pilot_last)
  SELECT v_event_b, p.id, 'Cleo', 'Fixture' FROM public.person_auth_accounts paa
    JOIN public.people p ON p.id = paa.person_id
    WHERE paa.auth_user_id = '900e0000-0000-4000-8000-000000000003'
  RETURNING id INTO v_attendee_cleo;

  SELECT id INTO v_admin_id FROM public.admin_users WHERE email = 'p0-erin-admin@fixture.invalid';
  -- Runtime-replay correction: admin_event_access has no is_active column
  -- and never has (see 20260617000000_create_pre_20260618_public_baseline.sql)
  -- -- the row's existence IS the grant; there is no activation lifecycle to
  -- assert here, only the role.
  INSERT INTO public.admin_event_access (admin_user_id, event_id, role)
  VALUES (v_admin_id, v_event_a, 'event_admin')
  RETURNING id INTO v_admin_event_access_id;

  -- Runtime-replay correction: the canonical Event Task-Authority model
  -- (20260811170000) resolves an event-scoped task via an explicit,
  -- is_enabled public.admin_event_permissions row keyed off this exact
  -- admin_event_access_id -- resolve_task_authority's 'event_grant' branch
  -- (public.admin_event_permissions AS aep WHERE aep.admin_event_access_id =
  -- v_access AND aep.permission_key = p_task_key AND aep.is_enabled). An
  -- admin_event_access row alone, without a materialized permission row,
  -- grants nothing; in production these rows come from profile
  -- materialization (20260811220000) or the manual-grant RPC
  -- (grant_task_to_admin, 20260811170000), never from the access row's
  -- role column being read directly. Erin's role='event_admin' is
  -- real-world consistent with holding both tasks below (both are in the
  -- canonical event_admin profile template: event.photos.manage since
  -- 20260811390000, event.slideshow.manage since 20260811400000), so this
  -- mirrors grant_task_to_admin's own INSERT shape (grant_source='manual')
  -- rather than inventing a role or permission model. Limited to exactly
  -- the two tasks the fixture's positive controls (manage_event_photo,
  -- create_presentation_deck) actually require, on Event A only.
  INSERT INTO public.admin_event_permissions (admin_event_access_id, permission_key, grant_source)
  VALUES
    (v_admin_event_access_id, 'event.photos.manage', 'manual'),
    (v_admin_event_access_id, 'event.slideshow.manage', 'manual');

  PERFORM set_config('p0.event_a', v_event_a::text, true);
  PERFORM set_config('p0.event_b', v_event_b::text, true);
  PERFORM set_config('p0.attendee_ava', v_attendee_ava::text, true);
END;
$events$;

SET LOCAL ROLE authenticated;

DO $fixture$
DECLARE
  v_photo_ava uuid; -- Ava's own approved photo, Event A
  v_untouchable jsonb;
BEGIN
  v_untouchable := public.p0_untouchable_counts();

  -- ================================================================
  -- 1 & 2: Ava uploads (INSERT bypassed here -- upload path unchanged and
  -- out of this repair's scope; insert the row directly as postgres would
  -- have via manage_event_photo's approval step) and her own pending photo
  -- is readable/deletable exactly as before this migration (unchanged path,
  -- regression-only check via the row policy).
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000001', true);

  SET LOCAL ROLE postgres;
  INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
  VALUES (
    current_setting('p0.event_a')::uuid,
    current_setting('p0.attendee_ava')::uuid,
    current_setting('p0.event_a') || '/' || current_setting('p0.attendee_ava') || '/pending.jpg',
    'pending'
  ) RETURNING id INTO v_photo_ava;
  SET LOCAL ROLE authenticated;

  PERFORM public.p0_assert(
    public.p0_can_read_row(v_photo_ava),
    'a contributor reads her own pending photo row (owner_or_admin policy, unchanged)'
  );

  SET LOCAL ROLE postgres;
  UPDATE public.event_photos SET photo_status = 'approved' WHERE id = v_photo_ava;
  SET LOCAL ROLE authenticated;

  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000001', true);
  PERFORM public.p0_assert(
    public.p0_can_read_row(v_photo_ava),
    'a contributor reads her own now-approved photo row'
  );

  -- ================================================================
  -- 3: Ben (same Event, non-contributor) sees the row (gallery view) --
  --    this is the repaired positive case, not merely a regression check.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000002', true);
  PERFORM public.p0_assert(
    public.p0_can_read_row(v_photo_ava),
    'a same-Event non-contributor attendee CAN read an approved photo row (repaired gallery-view case)'
  );

  -- ================================================================
  -- 4: Cleo (different Event) and Dev (no attendee row anywhere) are denied
  --    the row entirely.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000003', true);
  PERFORM public.p0_assert(
    NOT public.p0_can_read_row(v_photo_ava),
    'a different-Event attendee cannot read another Event''s approved photo row'
  );

  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000004', true);
  PERFORM public.p0_assert(
    NOT public.p0_can_read_row(v_photo_ava),
    'an authenticated account with no attendee row anywhere cannot read the row'
  );

  -- ================================================================
  -- 5: Erin (Event A administrator) reads it.
  -- ================================================================
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000005', true);
  PERFORM public.p0_assert(
    public.p0_can_read_row(v_photo_ava),
    'an Event A administrator reads an Event A approved photo row'
  );

  -- ================================================================
  -- 6: no organizer/admin authority table changed.
  -- ================================================================
  PERFORM public.p0_assert(
    public.p0_untouchable_counts() = v_untouchable,
    'no organizer appointment or admin_users row was created by any of the above'
  );

  RAISE NOTICE 'ALL P0 EVENT-PHOTO ROW-LEVEL ASSERTIONS PASSED (storage.objects byte-level behavior is out of this SQL-only fixture''s scope -- see the header note)';
END;
$fixture$;

-- =============================================================================
-- Correction 1 (forged metadata-to-storage-path aliasing) and the strengthened
-- canonical-path grammar (Part B). Ben (Event A attendee, non-contributor) is
-- the attacker throughout the INSERT-denial checks.
-- =============================================================================

SET LOCAL ROLE authenticated;

DO $forgery$
DECLARE
  v_attendee_ben uuid;
  v_forged_predating_migration uuid;
  v_valid_own uuid;
  v_sqlstate text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000002', true);
  v_attendee_ben := public.p0_resolve_person_attendee(
    '900e0000-0000-4000-8000-000000000002', current_setting('p0.event_a')::uuid
  );
  PERFORM public.p0_assert(v_attendee_ben IS NOT NULL, 'Ben''s attendee row resolves via the governed fixture helper');

  -- ------------------------------------------------------------------
  -- Part B, direct-predicate checks -- no INSERT, no exception handling,
  -- no RLS involved: is_canonical_event_photo_path is a pure function.
  -- ------------------------------------------------------------------
  PERFORM public.p0_assert(
    public.is_canonical_event_photo_path(
      current_setting('p0.event_a')::uuid, v_attendee_ben,
      current_setting('p0.event_a') || '/' || v_attendee_ben || '/1699999999-abc123.jpg'
    ),
    'exact canonical path (event_id/attendee_id/filename, three segments) is accepted'
  );
  PERFORM public.p0_assert(
    NOT public.is_canonical_event_photo_path(
      current_setting('p0.event_a')::uuid, v_attendee_ben,
      current_setting('p0.event_a') || '/' || v_attendee_ben || '/../../../secret.jpg'
    ),
    'a traversal-shaped path (extra segments after two genuinely-matching leading segments) is denied'
  );
  PERFORM public.p0_assert(
    NOT public.is_canonical_event_photo_path(
      current_setting('p0.event_a')::uuid, v_attendee_ben,
      current_setting('p0.event_a') || '/' || v_attendee_ben || '/sub/file.jpg'
    ),
    'any extra path segment beyond exactly three is denied, even without literal dot-segments'
  );
  PERFORM public.p0_assert(
    NOT public.is_canonical_event_photo_path(
      current_setting('p0.event_a')::uuid, v_attendee_ben,
      current_setting('p0.event_a') || '/' || v_attendee_ben || '/..'
    ),
    'a bare ".." filename segment is denied'
  );
  PERFORM public.p0_assert(
    NOT public.is_canonical_event_photo_path(
      current_setting('p0.event_a')::uuid, v_attendee_ben,
      current_setting('p0.event_a') || '/' || v_attendee_ben || '/.'
    ),
    'a bare "." filename segment is denied'
  );

  -- ------------------------------------------------------------------
  -- Adversarial-review correction (Lun): the metadata-absent/path-derived
  -- FALLBACK branches of can_authenticated_read_event_photo_object and
  -- can_upload_event_photo_object previously reimplemented their own
  -- minimum-segment/prefix-only parsing, independent of
  -- is_canonical_event_photo_path -- so strengthening that predicate alone
  -- (proven immediately above) never actually closed the gap in these two
  -- specific functions. These calls exercise the FIXED functions
  -- themselves, against a storage_path that has NO corresponding
  -- event_photos row (v_fallback_path_no_row is never inserted anywhere in
  -- this fixture), which is exactly what forces
  -- can_authenticated_read_event_photo_object past its metadata-row EXISTS
  -- branch and into the fallback -- the same "upload window, no row yet"
  -- shape the real producer's own upload flow depends on.
  -- ------------------------------------------------------------------
  DECLARE
    v_fallback_path_no_row text := current_setting('p0.event_a') || '/' || v_attendee_ben || '/1700000000-xyz789.png';
    v_fallback_path_nested text := current_setting('p0.event_a') || '/' || v_attendee_ben || '/nested/file.jpg';
    v_fallback_path_traversal text := current_setting('p0.event_a') || '/' || v_attendee_ben || '/../../../secret.jpg';
    v_fallback_path_extra_segment text := current_setting('p0.event_a') || '/' || v_attendee_ben || '/file.jpg/extra';
  BEGIN
    -- Exact three-segment canonical path, legitimate attendee, no
    -- pre-existing row: both helpers must still authorize it -- this is
    -- the ordinary, unmodified upload-window behavior the fix must
    -- preserve, not merely a denial-only closure.
    PERFORM public.p0_assert(
      public.can_authenticated_read_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_no_row
      ),
      'can_authenticated_read_event_photo_object''s fallback branch still authorizes an exact canonical path with no metadata row yet (legitimate upload-window read)'
    );
    PERFORM public.p0_assert(
      public.can_upload_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_no_row
      ),
      'can_upload_event_photo_object still authorizes an exact canonical path for the legitimate attendee, with no event_photos row required to exist first'
    );

    -- Nested path (a real subdirectory-shaped 4th segment): denied by both.
    PERFORM public.p0_assert(
      NOT public.can_authenticated_read_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_nested
      ),
      'can_authenticated_read_event_photo_object''s fallback branch denies a nested (4-segment) path even though its first two segments genuinely match'
    );
    PERFORM public.p0_assert(
      NOT public.can_upload_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_nested
      ),
      'can_upload_event_photo_object denies a nested (4-segment) path even though its first two segments genuinely match'
    );

    -- Traversal-shaped path: denied by both -- this is the exact shape the
    -- confirmed finding describes (the old "at least 3 segments, first two
    -- match" fallback logic would have authorized this).
    PERFORM public.p0_assert(
      NOT public.can_authenticated_read_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_traversal
      ),
      'can_authenticated_read_event_photo_object''s fallback branch denies a traversal-shaped path'
    );
    PERFORM public.p0_assert(
      NOT public.can_upload_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_traversal
      ),
      'can_upload_event_photo_object denies a traversal-shaped path'
    );

    -- Extra-segment path (trailing garbage after a legitimate-looking
    -- filename): denied by both.
    PERFORM public.p0_assert(
      NOT public.can_authenticated_read_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_extra_segment
      ),
      'can_authenticated_read_event_photo_object''s fallback branch denies an extra-segment path'
    );
    PERFORM public.p0_assert(
      NOT public.can_upload_event_photo_object(
        '900e0000-0000-4000-8000-000000000002'::uuid, v_fallback_path_extra_segment
      ),
      'can_upload_event_photo_object denies an extra-segment path'
    );
  END;

  -- ------------------------------------------------------------------
  -- INSERT-time enforcement. Exception handling is narrowed to SQLSTATE
  -- 42501 (insufficient_privilege -- Postgres's own code for a violated
  -- RLS policy), so an unrelated failure is never misattributed to
  -- "authorization correctly denied this."
  -- ------------------------------------------------------------------
  v_sqlstate := NULL;
  BEGIN
    INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
    VALUES (
      current_setting('p0.event_a')::uuid,
      v_attendee_ben,
      current_setting('p0.event_a') || '/' || current_setting('p0.attendee_ava') || '/forged-same-event.jpg',
      'pending'
    );
  EXCEPTION WHEN OTHERS THEN v_sqlstate := SQLSTATE;
  END;
  PERFORM public.p0_assert(
    v_sqlstate = '42501',
    format('forged own-pending metadata pointing at another attendee''s same-Event path is rejected by RLS (42501), got SQLSTATE %L instead', v_sqlstate)
  );

  v_sqlstate := NULL;
  BEGIN
    INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
    VALUES (
      current_setting('p0.event_a')::uuid,
      v_attendee_ben,
      current_setting('p0.event_b') || '/00000000-0000-4000-8000-000000000099/forged-other-event.jpg',
      'pending'
    );
  EXCEPTION WHEN OTHERS THEN v_sqlstate := SQLSTATE;
  END;
  PERFORM public.p0_assert(
    v_sqlstate = '42501',
    format('forged own-pending metadata pointing at another Event''s path is rejected by RLS (42501), got SQLSTATE %L instead', v_sqlstate)
  );

  -- Valid canonical own path still succeeds.
  INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
  VALUES (
    current_setting('p0.event_a')::uuid,
    v_attendee_ben,
    current_setting('p0.event_a') || '/' || v_attendee_ben || '/valid-own.jpg',
    'pending'
  ) RETURNING id INTO v_valid_own;
  PERFORM public.p0_assert(
    public.can_authenticated_read_event_photo_object(
      '900e0000-0000-4000-8000-000000000002'::uuid,
      current_setting('p0.event_a') || '/' || v_attendee_ben || '/valid-own.jpg'
    ),
    'a valid canonical own path remains readable via the object-read helper'
  );

  -- Defense-in-depth (aliased-row denial): simulate a forged row that
  -- predates this migration (inserted directly as postgres, bypassing
  -- today's INSERT guard). Its own event_id/attendee_id columns genuinely
  -- belong to Ben, but its storage_path names a different attendee's
  -- object -- the object-read helper must deny it independent of INSERT
  -- enforcement.
  SET LOCAL ROLE postgres;
  INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
  VALUES (
    current_setting('p0.event_a')::uuid,
    v_attendee_ben,
    current_setting('p0.event_a') || '/' || current_setting('p0.attendee_ava') || '/forged-predating-migration.jpg',
    'pending'
  ) RETURNING id INTO v_forged_predating_migration;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000002', true);

  PERFORM public.p0_assert(
    NOT public.can_authenticated_read_event_photo_object(
      '900e0000-0000-4000-8000-000000000002'::uuid,
      current_setting('p0.event_a') || '/' || current_setting('p0.attendee_ava') || '/forged-predating-migration.jpg'
    ),
    'a pre-existing aliased row (attacker''s own event_id/attendee_id, another attendee''s real path) is denied by the object-read helper, not merely blocked at INSERT'
  );
END;
$forgery$;

-- =============================================================================
-- Correction 2 (slideshow lifecycle/tenant/revocation safeguards).
-- Builds one live presentation session against Event A with two approved
-- photo slides.
-- =============================================================================

SET LOCAL ROLE postgres;

DO $slideshow_setup$
DECLARE
  v_deck uuid;
  v_session uuid;
  v_photo_1 uuid;
  v_photo_2 uuid;
BEGIN
  INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
  VALUES (
    current_setting('p0.event_a')::uuid,
    current_setting('p0.attendee_ava')::uuid,
    current_setting('p0.event_a') || '/' || current_setting('p0.attendee_ava') || '/slide-1.jpg',
    'approved'
  ) RETURNING id INTO v_photo_1;
  INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
  VALUES (
    current_setting('p0.event_a')::uuid,
    current_setting('p0.attendee_ava')::uuid,
    current_setting('p0.event_a') || '/' || current_setting('p0.attendee_ava') || '/slide-2.jpg',
    'approved'
  ) RETURNING id INTO v_photo_2;

  INSERT INTO public.presentation_decks (event_id, name, selection_mode, created_by_auth_user_id)
  VALUES (current_setting('p0.event_a')::uuid, 'P0 Fixture Deck', 'all_approved', '900e0000-0000-4000-8000-000000000005')
  RETURNING id INTO v_deck;

  -- current_item_started_at set safely in the past with a short duration:
  -- the session is immediately "due" to advance the first time
  -- read_public_presentation_session (and therefore
  -- advance_presentation_session_if_due_internal) is called against it.
  INSERT INTO public.presentation_sessions
    (event_id, deck_id, status, playback_state, current_index, started_by_auth_user_id, current_item_started_at)
  VALUES (
    current_setting('p0.event_a')::uuid, v_deck, 'live', 'playing', 0,
    '900e0000-0000-4000-8000-000000000005', now() - interval '10 seconds'
  ) RETURNING id INTO v_session;

  INSERT INTO public.presentation_session_items (session_id, content_type, content_ref_id, sequence_number, duration_ms)
  VALUES
    (v_session, 'photo', v_photo_1, 0, 1000),
    (v_session, 'photo', v_photo_2, 1, 1000);

  PERFORM set_config('p0.session', v_session::text, true);
  PERFORM set_config('p0.deck_a', v_deck::text, true);
  PERFORM set_config('p0.photo_1', v_photo_1::text, true);
  PERFORM set_config('p0.photo_2', v_photo_2::text, true);
END;
$slideshow_setup$;

DO $slideshow$
DECLARE
  v_row record;
  v_slot record;
BEGIN
  -- Timed audience polling still advances: the first anonymous read, with
  -- current_item_started_at already 10s in the past against a 1000ms
  -- duration, must observe the session having already moved off index 0.
  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.read_public_presentation_session(current_setting('p0.session')::uuid);
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(v_row.session_active, 'the fixture session reads as active before any eligibility corner case is exercised');
  PERFORM public.p0_assert(v_row.sequence_number = 1, 'unattended timed polling advances current_index from 0 to 1 via advance_presentation_session_if_due_internal');
  PERFORM public.p0_assert(v_row.current_content_ref_id = current_setting('p0.photo_2')::uuid, 'the advanced current slot now names the second photo');
  PERFORM public.p0_assert(v_row.current_storage_path IS NULL AND v_row.next_storage_path IS NULL, 'no raw storage path is ever disclosed to the anonymous caller');

  -- Approved current content later rejected clears both image and caption:
  -- reject the NOW-current photo (photo_2, at index 1) and confirm every
  -- eligibility-gated surface stops serving it.
  UPDATE public.event_photos SET photo_status = 'rejected' WHERE id = current_setting('p0.photo_2')::uuid;

  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.read_public_presentation_session(current_setting('p0.session')::uuid);
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(v_row.session_active, 'the session itself remains live after a single item is rejected');
  PERFORM public.p0_assert(
    v_row.current_content_type IS NULL AND v_row.current_content_ref_id IS NULL AND v_row.current_duration_ms IS NULL,
    'read_public_presentation_session nulls content_type/content_ref_id/duration -- not just storage_path -- for a slot whose photo is no longer approved, so the viewer actually stops rendering it'
  );

  SET LOCAL ROLE service_role;
  SELECT * INTO v_slot FROM public._resolve_live_presentation_slot_path(current_setting('p0.session')::uuid, 'current');
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(v_slot IS NULL OR v_slot.storage_path IS NULL, 'the slot-path resolver returns nothing for a rejected current photo');

  SET LOCAL ROLE anon;
  SELECT * INTO v_slot FROM public.read_live_presentation_slot_caption(current_setting('p0.session')::uuid, 'current');
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(v_slot IS NULL, 'the caption resolver returns nothing for a rejected current photo, clearing any previously-shown caption on the next poll');

  -- Restore for the next section (un-reject, reset position and timing).
  UPDATE public.event_photos SET photo_status = 'approved' WHERE id = current_setting('p0.photo_2')::uuid;
  UPDATE public.presentation_sessions
  SET current_index = 0, current_item_started_at = now()
  WHERE id = current_setting('p0.session')::uuid;

  -- Inactive Tenant denies anonymous presentation asset/caption: deactivate
  -- Tenant A and confirm every anonymous/service-role surface goes dark,
  -- not merely the state poll.
  UPDATE public.tenants SET is_active = false WHERE id = current_setting('p0.tenant_a')::uuid;

  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.read_public_presentation_session(current_setting('p0.session')::uuid);
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(NOT v_row.session_active, 'an inactive Tenant denies read_public_presentation_session, not just an ended/unknown session');

  SET LOCAL ROLE service_role;
  SELECT * INTO v_slot FROM public._resolve_live_presentation_slot_path(current_setting('p0.session')::uuid, 'current');
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(v_slot IS NULL OR v_slot.storage_path IS NULL, 'an inactive Tenant denies the slot-path resolver used by the presentation-image route');

  SET LOCAL ROLE anon;
  SELECT * INTO v_slot FROM public.read_live_presentation_slot_caption(current_setting('p0.session')::uuid, 'current');
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(v_slot IS NULL, 'an inactive Tenant denies the caption resolver used by the presentation-caption route');

  UPDATE public.tenants SET is_active = true WHERE id = current_setting('p0.tenant_a')::uuid;
END;
$slideshow$;

-- =============================================================================
-- Correction 3 / Part A+C (self-service private-Draft photo AND slideshow-
-- administration isolation), even against genuine Platform authority.
-- =============================================================================

SET LOCAL ROLE postgres;

DO $private_draft$
DECLARE
  v_platform_admin_auth_id uuid := '900e0000-0000-4000-8000-000000000006';
  v_private_tenant uuid;
  v_private_event uuid;
  v_private_photo uuid;
  v_private_session uuid;
  v_private_deck uuid;
  v_row record;
  v_slot record;
  v_message text;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_platform_admin_auth_id) THEN
    RAISE EXCEPTION 'P0 fixture platform-admin identity is already in use.';
  END IF;

  INSERT INTO auth.users (id, email, email_confirmed_at)
  VALUES (v_platform_admin_auth_id, 'p0-gina-platform-admin@fixture.invalid', now());

  INSERT INTO public.admin_users (email, user_id, is_active, is_super_admin, privilege_group)
  VALUES ('p0-gina-platform-admin@fixture.invalid', v_platform_admin_auth_id, true, true, 'super_admin');

  INSERT INTO public.tenants
    (organization_code, slug, organization_name, display_name, app_title, is_active, is_self_service_private_draft)
  VALUES
    ('p0-fixture-private-draft', 'p0-fixture-private-draft', 'P0 Private Draft', 'P0 Private Draft', 'P0 Private Draft', true, true)
  RETURNING id INTO v_private_tenant;

  -- end_date/timezone set (P-2A itself requires a real scheduled end date
  -- and IANA time zone for a private draft) so a denial that happened to
  -- reach assert_event_lifecycle_mutable would still resolve determinately
  -- -- every denial below is expected to come from the private-Draft guard
  -- specifically, never from an unrelated lifecycle-indeterminate failure.
  INSERT INTO public.events (name, tenant_id, status, is_active, visible_to_members, end_date, timezone)
  VALUES ('P0 Fixture Private Draft Event', v_private_tenant, 'Draft', false, false, current_date + 7, 'UTC')
  RETURNING id INTO v_private_event;

  -- No attendee exists in a private Draft under the ordinary provisioning
  -- path -- this row exists only to prove the isolation boundary.
  INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
  VALUES (v_private_event, NULL, v_private_event || '/00000000-0000-4000-8000-000000000098/private.jpg', 'approved')
  RETURNING id INTO v_private_photo;

  INSERT INTO public.presentation_decks (event_id, name, selection_mode, created_by_auth_user_id)
  VALUES (v_private_event, 'P0 Fixture Private Deck', 'all_approved', v_platform_admin_auth_id)
  RETURNING id INTO v_private_deck;
  INSERT INTO public.presentation_sessions
    (event_id, deck_id, status, playback_state, current_index, started_by_auth_user_id)
  VALUES (v_private_event, v_private_deck, 'live', 'playing', 0, v_platform_admin_auth_id)
  RETURNING id INTO v_private_session;
  INSERT INTO public.presentation_session_items (session_id, content_type, content_ref_id, sequence_number, duration_ms)
  VALUES (v_private_session, 'photo', v_private_photo, 0, 8000);

  -- --- Platform Administrator: row read, object read, manage_event_photo,
  --     and representative presentation-admin RPCs, all denied. ----------
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_platform_admin_auth_id::text, true);

  PERFORM public.p0_assert(
    NOT public.p0_can_read_row(v_private_photo),
    'a genuine Platform Administrator cannot read a self-service private-Draft''s approved photo row'
  );
  PERFORM public.p0_assert(
    NOT public.can_authenticated_read_event_photo_object(
      v_platform_admin_auth_id,
      v_private_event || '/00000000-0000-4000-8000-000000000098/private.jpg'
    ),
    'a genuine Platform Administrator cannot read a self-service private-Draft''s approved photo object'
  );

  v_message := NULL;
  BEGIN
    PERFORM public.manage_event_photo(v_private_photo, 'approved', NULL, NULL, false, 0);
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  PERFORM public.p0_assert(
    v_message = 'unauthorized',
    format('a genuine Platform Administrator cannot moderate a self-service private-Draft''s photo via manage_event_photo, and the denial is the same non-enumerating ''unauthorized'' raised for an ordinary missing task grant (got %L)', v_message)
  );

  -- Part C: representative deck-CRUD and session-start RPCs.
  v_message := NULL;
  BEGIN
    PERFORM public.create_presentation_deck(v_private_event, 'Gina''s Deck', NULL, 8000, 'all_approved');
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  PERFORM public.p0_assert(
    v_message = 'unauthorized',
    format('a genuine Platform Administrator cannot create_presentation_deck for a self-service private-Draft Event (got %L)', v_message)
  );

  v_message := NULL;
  BEGIN
    PERFORM public.start_presentation_session(v_private_deck);
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  PERFORM public.p0_assert(
    v_message = 'unauthorized',
    format('a genuine Platform Administrator cannot start_presentation_session for a self-service private-Draft Event''s deck (got %L)', v_message)
  );

  -- The admin-read RLS policy itself: the private deck row already exists
  -- (inserted above as postgres); the Platform Administrator must not see
  -- it via presentation_decks_admin_select_policy.
  PERFORM public.p0_assert(
    NOT public.p0_can_read_presentation_deck(v_private_deck),
    'a genuine Platform Administrator cannot read a self-service private-Draft''s presentation_decks row via the admin-read RLS policy'
  );

  -- Anonymous slideshow surfaces, even though the Tenant IS active (private
  -- Drafts are activated Tenants -- only the explicit exclusion protects
  -- them, not the ordinary active-Tenant check alone).
  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.read_public_presentation_session(v_private_session);
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(NOT v_row.session_active, 'a private-Draft Tenant''s presentation session denies read_public_presentation_session even though the Tenant is active');

  SET LOCAL ROLE service_role;
  SELECT * INTO v_slot FROM public._resolve_live_presentation_slot_path(v_private_session, 'current');
  SET LOCAL ROLE postgres;
  PERFORM public.p0_assert(v_slot IS NULL OR v_slot.storage_path IS NULL, 'a private-Draft Tenant''s presentation session denies the slot-path resolver even though the Tenant is active');

  -- --- Complete boundary closure: must not rely on the absence of
  --     attendees. Simulate a genuinely matching attendee row for the
  --     private Draft, inserted directly as postgres. --------------------
  DECLARE
    v_shadow_auth_id uuid := '900e0000-0000-4000-8000-000000000007';
    v_shadow_person uuid;
    v_shadow_attendee uuid;
    v_shadow_pending_photo uuid;
    v_shadow_path text;
    v_shadow_sqlstate text;
  BEGIN
    INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (v_shadow_auth_id, 'p0-shadow-private-draft-attendee@fixture.invalid', now());
    INSERT INTO public.people (status) VALUES ('active') RETURNING id INTO v_shadow_person;
    PERFORM public.p0_link(v_shadow_person, v_shadow_auth_id);
    INSERT INTO public.attendees (event_id, person_id, pilot_first, pilot_last)
    VALUES (v_private_event, v_shadow_person, 'Shadow', 'Fixture')
    RETURNING id INTO v_shadow_attendee;
    v_shadow_path := v_private_event || '/' || v_shadow_attendee || '/shadow-upload.jpg';

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_shadow_auth_id::text, true);

    v_shadow_sqlstate := NULL;
    BEGIN
      INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
      VALUES (v_private_event, v_shadow_attendee, v_shadow_path, 'pending');
    EXCEPTION WHEN OTHERS THEN v_shadow_sqlstate := SQLSTATE;
    END;
    PERFORM public.p0_assert(
      v_shadow_sqlstate = '42501',
      format('member INSERT into a self-service private-Draft is denied (42501) even for a canonical own path with a genuinely matching attendee row (got %L)', v_shadow_sqlstate)
    );

    PERFORM public.p0_assert(
      NOT public.can_upload_event_photo_object(v_shadow_auth_id, v_shadow_path),
      'storage upload authority is denied for a self-service private-Draft''s canonical own path'
    );

    SET LOCAL ROLE postgres;
    INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
    VALUES (v_private_event, v_shadow_attendee, v_shadow_path, 'pending')
    RETURNING id INTO v_shadow_pending_photo;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_shadow_auth_id::text, true);

    PERFORM public.p0_assert(
      NOT public.p0_can_read_row(v_shadow_pending_photo),
      'a private-Draft''s own contributor cannot read her own pending photo row'
    );
    PERFORM public.p0_assert(
      NOT public.can_authenticated_read_event_photo_object(v_shadow_auth_id, v_shadow_path),
      'a private-Draft''s own contributor cannot read her own pending photo object'
    );
    PERFORM public.p0_assert(
      NOT public.can_delete_own_pending_event_photo_object(v_shadow_auth_id, v_shadow_path),
      'a private-Draft''s own contributor cannot pending-delete her own photo object'
    );

    SET LOCAL ROLE postgres;
  END;

  -- No manual cleanup below: presentation_session_items carries a BEFORE
  -- DELETE immutability trigger that would unconditionally raise on any
  -- attempt to delete it, and this whole fixture is one transaction ending
  -- in ROLLBACK regardless.
END;
$private_draft$;

-- =============================================================================
-- Equivalent non-private Event controls: the same manage_event_photo and
-- create_presentation_deck/start_presentation_session paths an ordinary
-- Event administrator uses must still work exactly as before -- the
-- private-Draft guards above must not have narrowed ordinary administration.
-- =============================================================================

SET LOCAL ROLE postgres;

DO $ordinary_administration_control$
DECLARE
  v_ordinary_pending_photo uuid;
  v_after public.event_photos%ROWTYPE;
  v_ordinary_deck public.presentation_decks%ROWTYPE;
BEGIN
  INSERT INTO public.event_photos (event_id, attendee_id, storage_path, photo_status)
  VALUES (
    current_setting('p0.event_a')::uuid,
    current_setting('p0.attendee_ava')::uuid,
    current_setting('p0.event_a') || '/' || current_setting('p0.attendee_ava') || '/ordinary-moderation-control.jpg',
    'pending'
  ) RETURNING id INTO v_ordinary_pending_photo;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000005', true);
  SELECT * INTO v_after FROM public.manage_event_photo(v_ordinary_pending_photo, 'approved', NULL, 'Looks great', true, 0);
  SET LOCAL ROLE postgres;

  PERFORM public.p0_assert(
    v_after.photo_status = 'approved',
    'an ordinary (non-private-Draft) Event A administrator''s manage_event_photo call still succeeds exactly as before this migration'
  );

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '900e0000-0000-4000-8000-000000000005', true);
  SELECT * INTO v_ordinary_deck FROM public.create_presentation_deck(
    current_setting('p0.event_a')::uuid, 'P0 Ordinary Control Deck', NULL, 8000, 'all_approved'
  );

  PERFORM public.p0_assert(
    v_ordinary_deck.id IS NOT NULL,
    'an ordinary (non-private-Draft) Event A administrator''s create_presentation_deck call still succeeds exactly as before this migration'
  );
  -- Still running as authenticated (Erin) here -- p0_can_read_presentation_deck
  -- is SECURITY INVOKER, so this genuinely re-exercises
  -- presentation_decks_admin_select_policy's RLS as the real caller, the
  -- same positive-control shape the private-Draft denial above used.
  PERFORM public.p0_assert(
    public.p0_can_read_presentation_deck(v_ordinary_deck.id),
    'the ordinary control deck is readable via presentation_decks_admin_select_policy for its own Event administrator'
  );
  SET LOCAL ROLE postgres;

  -- No manual DELETE of v_after / v_ordinary_deck / their audit rows below:
  -- event_photo_command_audit carries the identical BEFORE DELETE
  -- immutability trigger as presentation_session_items. ROLLBACK is the
  -- cleanup for this entire fixture.
END;
$ordinary_administration_control$;

-- =============================================================================
-- Correction 4 (the remaining anonymous approval-existence probe is closed).
-- =============================================================================

DO $probe$
BEGIN
  PERFORM public.p0_assert(
    NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'is_approved_event_photo_object'
    ),
    'is_approved_event_photo_object no longer exists at all -- the anonymous approval-existence/status probe is closed, not merely narrowed'
  );

  PERFORM public.p0_assert(
    NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'event_photos'
        AND grantee = 'anon' AND privilege_type = 'SELECT'
    ),
    'public.event_photos carries no anonymous SELECT table grant'
  );
END;
$probe$;

ROLLBACK;
