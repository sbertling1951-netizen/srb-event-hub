-- Route authenticated and Temporary Event Access identity through the one
-- canonical resolver. The function body is taken from the deployed definition
-- and only its duplicated identity branch is replaced.

DO $migration$
DECLARE
  v_definition text;
  v_repaired_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)'::regprocedure
  )
  INTO v_definition;

  v_repaired_definition := regexp_replace(
    v_definition,
    '(?s)  v_uid := auth\.uid\(\);.*?  -- Member-reported site:',
    $$  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    v_authorization_basis := 'authenticated';

    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';

    IF v_person_id IS NULL THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
      p_event_id, NULL, NULL
    );
  ELSE
    v_authorization_basis := 'temporary';

    v_verified_attendee_id := public.resolve_temporary_or_authenticated_attendee(
      p_event_id, p_event_code, p_registration_identifier
    );

    IF v_verified_attendee_id IS NULL
      AND left(p_registration_identifier, char_length('__TEA_CAPABILITY__:')) =
        '__TEA_CAPABILITY__:' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'Temporary Event Access session is no longer valid.';
    END IF;
  END IF;

  IF v_verified_attendee_id IS NULL
    OR v_verified_attendee_id IS DISTINCT FROM p_expected_attendee_id THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  -- Member-reported site:$$,
    'g'
  );

  IF v_repaired_definition = v_definition
    OR v_repaired_definition NOT LIKE '%public.resolve_temporary_or_authenticated_attendee(%'
    OR v_repaired_definition NOT LIKE '%ERRCODE = ''P0002''%'
  THEN
    RAISE EXCEPTION 'submit_member_checkin repair did not match the deployed function';
  END IF;

  EXECUTE v_repaired_definition;
END;
$migration$;

ALTER FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  TO anon, authenticated;