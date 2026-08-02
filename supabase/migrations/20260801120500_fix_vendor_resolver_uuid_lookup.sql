-- PostgreSQL has no min(uuid) aggregate. Replace only the two existing
-- active-auth-link UUID selections while preserving their count checks.
DO $$
DECLARE
  v_definition text;
  v_initial_old text := $sql$
    min(paa.person_id) FILTER (
      WHERE paa.status = 'active'
        AND p.status = 'active'
    )
  INTO v_auth_link_count, v_valid_auth_person_count, v_existing_person_id
  FROM public.person_auth_accounts AS paa
  JOIN public.people AS p
    ON p.id = paa.person_id
  WHERE paa.auth_user_id = p_auth_user_id;$sql$;
  v_initial_new text := $sql$
    NULL::uuid
  INTO v_auth_link_count, v_valid_auth_person_count, v_existing_person_id
  FROM public.person_auth_accounts AS paa
  JOIN public.people AS p
    ON p.id = paa.person_id
  WHERE paa.auth_user_id = p_auth_user_id;

  SELECT paa.person_id
    INTO v_existing_person_id
  FROM public.person_auth_accounts AS paa
  JOIN public.people AS p
    ON p.id = paa.person_id
  WHERE paa.auth_user_id = p_auth_user_id
    AND paa.status = 'active'
    AND p.status = 'active'
  LIMIT 1;$sql$;
  v_recovery_old text := $sql$
          min(paa.person_id) FILTER (
            WHERE paa.status = 'active'
              AND p.status = 'active'
          )
        INTO v_auth_link_count, v_valid_auth_person_count, v_existing_person_id
        FROM public.person_auth_accounts AS paa
        JOIN public.people AS p
          ON p.id = paa.person_id
        WHERE paa.auth_user_id = p_auth_user_id;$sql$;
  v_recovery_new text := $sql$
          NULL::uuid
        INTO v_auth_link_count, v_valid_auth_person_count, v_existing_person_id
        FROM public.person_auth_accounts AS paa
        JOIN public.people AS p
          ON p.id = paa.person_id
        WHERE paa.auth_user_id = p_auth_user_id;

        SELECT paa.person_id
          INTO v_existing_person_id
        FROM public.person_auth_accounts AS paa
        JOIN public.people AS p
          ON p.id = paa.person_id
        WHERE paa.auth_user_id = p_auth_user_id
          AND paa.status = 'active'
          AND p.status = 'active'
        LIMIT 1;$sql$;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_vendor_person_identity(text,uuid,text,text,uuid,text,text)'::regprocedure
  )
  INTO v_definition;

  IF length(v_definition) - length(replace(v_definition, 'min(paa.person_id)', ''))
    <> length('min(paa.person_id)') * 2
    OR position(v_initial_old IN v_definition) = 0
    OR position(v_recovery_old IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Vendor resolver UUID lookup correction expected exactly two known min(uuid) expressions';
  END IF;

  v_definition := replace(v_definition, v_initial_old, v_initial_new);
  v_definition := replace(v_definition, v_recovery_old, v_recovery_new);

  IF position('min(paa.person_id)' IN v_definition) <> 0
    OR position('max(paa.person_id)' IN v_definition) <> 0 THEN
    RAISE EXCEPTION
      'Vendor resolver UUID lookup correction left an unsupported UUID aggregate';
  END IF;

  EXECUTE v_definition;
END;
$$;
