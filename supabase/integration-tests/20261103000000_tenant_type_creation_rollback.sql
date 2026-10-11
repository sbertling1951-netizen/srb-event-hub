-- Disposable local fixture only; every row is rolled back.
BEGIN;
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_type public.tenant_types;
  v_before integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_uid, 'tenant-type-fixture@example.test');
  INSERT INTO public.admin_users(user_id, email, display_name, privilege_group, is_active)
  VALUES (v_uid, 'tenant-type-fixture@example.test', 'Tenant type fixture', 'super_admin', true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_type FROM public.create_tenant_type(' COMMUNITY_GROUP ', ' Community Group ', 'Fixture');
  IF v_type.code <> 'community_group' OR v_type.label <> 'Community Group' THEN
    RAISE EXCEPTION 'Creation normalization failed';
  END IF;
  BEGIN
    PERFORM public.create_tenant_type('other_code', 'community group');
    RAISE EXCEPTION 'Duplicate name accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'A tenant type with this code or name already exists.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_tenant_type('community_group', 'Another name');
    RAISE EXCEPTION 'Duplicate code accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'A tenant type with this code or name already exists.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_tenant_type('bad-code', 'Bad');
    RAISE EXCEPTION 'Invalid code accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Type code must start%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.tenant_types(code,label) VALUES ('raw_type','Raw type');
    RAISE EXCEPTION 'Raw catalog INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.create_tenant_type('unauthorized','Unauthorized');
    RAISE EXCEPTION 'Ordinary user creation accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Tenant administration requires%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_before FROM public.tenant_type_creation_audit WHERE tenant_type_id = v_type.id AND actor_auth_user_id = v_uid;
  IF v_before <> 1 THEN RAISE EXCEPTION 'Expected one atomic actor audit'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_types WHERE code IN ('unauthorized','raw_type','bad-code','other_code')) THEN
    RAISE EXCEPTION 'Rejected creation left catalog data';
  END IF;
  IF has_function_privilege('anon', 'public.create_tenant_type(text,text,text)', 'EXECUTE') OR has_function_privilege('service_role', 'public.create_tenant_type(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected execute grant';
  END IF;
  BEGIN
    DELETE FROM public.tenant_type_creation_audit WHERE tenant_type_id = v_type.id;
    RAISE EXCEPTION 'Audit deletion accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Tenant type creation audit is immutable.' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'Tenant type authorization, validation, duplicate rejection, atomic audit, and immutability passed';
END $$;
ROLLBACK;
