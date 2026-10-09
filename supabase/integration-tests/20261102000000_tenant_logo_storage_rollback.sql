-- Run only against a disposable replay database; all fixtures roll back.
BEGIN;
-- Mirror the Storage API setting so DELETE tests reach the RLS gate.
SET LOCAL storage.allow_delete_query = 'true';
INSERT INTO auth.users (id, email) VALUES
  ('64000000-0000-4000-8000-000000000001', 'sql-logo-platform@fixture.invalid'),
  ('64000000-0000-4000-8000-000000000002', 'sql-logo-ordinary@fixture.invalid');
INSERT INTO public.admin_users (id, email, display_name, is_active, is_super_admin, user_id, privilege_group)
VALUES ('63000000-0000-4000-8000-000000000001', 'sql-logo-platform@fixture.invalid', 'Logo Platform', true, true,
  '64000000-0000-4000-8000-000000000001', 'super_admin');
INSERT INTO public.tenants (id, organization_code, slug, organization_name, display_name, app_title, is_active)
VALUES ('61000000-0000-4000-8000-000000000001', 'LOGO-FIXTURE', 'logo-fixture', 'Logo Fixture', 'Logo Fixture', 'Logo Fixture', false);

INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('tenant-logos', '61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000099.png', '64000000-0000-4000-8000-000000000002');

-- Simulate unrelated over-broad policies and prove the restrictive gates win.
CREATE POLICY logo_fixture_broad ON storage.objects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
DO $test$
BEGIN
  IF public.can_upload_tenant_logo('61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.png') THEN
    RAISE EXCEPTION 'Ordinary user received upload authority';
  END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('tenant-logos', '61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.png');
    RAISE EXCEPTION 'Ordinary upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;

SELECT set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
DO $test$
DECLARE v_count integer;
BEGIN
  IF public.can_upload_tenant_logo('61000000-0000-4000-8000-000000000099/62000000-0000-4000-8000-000000000001.png') OR
    public.can_upload_tenant_logo('61000000-0000-4000-8000-000000000001/../other.png') OR
    public.can_upload_tenant_logo('61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.svg') THEN
    RAISE EXCEPTION 'Invalid tenant/path/format accepted';
  END IF;
  BEGIN
    PERFORM public.finalize_tenant_logo_upload('61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000099.png');
    RAISE EXCEPTION 'Foreign upload finalized';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Tenant logo upload is unavailable.' THEN RAISE; END IF;
  END;
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('tenant-logos', '61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.png', auth.uid()::text);
  PERFORM public.finalize_tenant_logo_upload('61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.png');
  PERFORM public.finalize_tenant_logo_upload('61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.png');
  UPDATE storage.objects SET name = '61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000002.png' WHERE bucket_id = 'tenant-logos';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Logo overwrite allowed'; END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'tenant-logos';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Logo deletion allowed'; END IF;
  PERFORM public.update_tenant_metadata_for_administration('61000000-0000-4000-8000-000000000001', '{"logo_url":"https://fixture.invalid/logo.png"}'::jsonb, 'fixture');
END;
$test$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $test$
BEGIN
  IF public.can_upload_tenant_logo('61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000002.png') THEN RAISE EXCEPTION 'Anonymous authority allowed'; END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('tenant-logos', '61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000002.png');
    RAISE EXCEPTION 'Anonymous upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.tenant_administration_audit WHERE tenant_id = '61000000-0000-4000-8000-000000000001' AND action = 'tenant_logo_uploaded') <> 1 THEN
    RAISE EXCEPTION 'Upload audit missing or unauthorized upload audited';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tenant-logos' AND public AND file_size_limit = 2097152 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']) THEN
    RAISE EXCEPTION 'Public bucket restrictions missing';
  END IF;
END;
$test$;
ROLLBACK;
