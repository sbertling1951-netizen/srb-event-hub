-- Tenant logos are public presentation assets. Writes preserve the existing
-- Platform Administrator metadata boundary, including inactive configuration.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-logos', 'tenant-logos', true, 2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE FUNCTION public.can_upload_tenant_logo(p_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN RETURN false; END IF;
  IF p_name IS NULL OR p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.tenants WHERE id = split_part(p_name, '/', 1)::uuid);
END;
$function$;
ALTER FUNCTION public.can_upload_tenant_logo(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_upload_tenant_logo(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_tenant_logo(text) TO anon, authenticated;

CREATE POLICY tenant_logo_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'tenant-logos' AND public.can_upload_tenant_logo(name));
-- Restrictive gates keep unrelated permissive policies from widening access.
CREATE POLICY tenant_logo_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id <> 'tenant-logos' OR
  (auth.uid() IS NOT NULL AND public.can_upload_tenant_logo(name)));
CREATE POLICY tenant_logo_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
USING (bucket_id <> 'tenant-logos') WITH CHECK (bucket_id <> 'tenant-logos');
CREATE POLICY tenant_logo_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
USING (bucket_id <> 'tenant-logos');

-- Extend the existing immutable administrative audit, rather than introduce
-- another authority/audit store. Removing a logo only detaches its URL.
ALTER TABLE public.tenant_administration_audit DROP CONSTRAINT tenant_administration_audit_action_check;
ALTER TABLE public.tenant_administration_audit ADD CONSTRAINT tenant_administration_audit_action_check CHECK (action IN (
  'tenant_created', 'tenant_metadata_updated', 'tenant_activated', 'tenant_deactivated',
  'tenant_status_unchanged', 'tenant_admin_assigned', 'tenant_admin_reactivated',
  'tenant_admin_revoked', 'tenant_admin_access_unchanged', 'hostname_mapping_created',
  'hostname_mapping_activated', 'hostname_mapping_deactivated', 'hostname_mapping_status_unchanged',
  'tenant_logo_uploaded'
));

-- Storage completes uploads with its own database session. Finalize under the
-- actual authenticated caller, verifying both immutable path and object owner.
CREATE FUNCTION public.finalize_tenant_logo_upload(p_storage_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_actor uuid; v_owner text;
BEGIN
  v_actor := public._require_platform_admin_actor();
  IF NOT public.can_upload_tenant_logo(p_storage_path) THEN
    RAISE EXCEPTION 'Invalid Tenant logo path.';
  END IF;
  SELECT o.owner_id INTO v_owner FROM storage.objects AS o
  WHERE o.bucket_id = 'tenant-logos' AND o.name = p_storage_path
  FOR UPDATE;
  IF v_owner IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Tenant logo upload is unavailable.';
  END IF;
  -- The object lock serializes retries: one audit per immutable upload.
  IF NOT EXISTS (SELECT 1 FROM public.tenant_administration_audit AS a
    WHERE a.tenant_id = split_part(p_storage_path, '/', 1)::uuid
      AND a.action = 'tenant_logo_uploaded'
      AND a.after_state ->> 'storage_path' = p_storage_path) THEN
    INSERT INTO public.tenant_administration_audit
      (tenant_id, action, actor_auth_user_id, actor_admin_user_id, after_state)
    VALUES (split_part(p_storage_path, '/', 1)::uuid, 'tenant_logo_uploaded', auth.uid(), v_actor,
      jsonb_build_object('bucket_id', 'tenant-logos', 'storage_path', p_storage_path));
  END IF;
END;
$function$;
ALTER FUNCTION public.finalize_tenant_logo_upload(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_tenant_logo_upload(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_tenant_logo_upload(text) TO authenticated;

COMMIT;
