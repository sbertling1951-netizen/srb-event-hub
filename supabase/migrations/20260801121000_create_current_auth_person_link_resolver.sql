-- Authenticated callers may classify only their own exact Auth-to-Person link.
-- The underlying UUID-parameter primitive remains restricted to postgres.
CREATE FUNCTION public.resolve_current_auth_person_link()
RETURNS TABLE(
  status text,
  person_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_auth_user_id uuid;
BEGIN
  v_auth_user_id := auth.uid();

  IF v_auth_user_id IS NULL THEN
    RETURN QUERY SELECT 'no_link'::text, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT link.status, link.person_id
  FROM public.resolve_auth_person_link(v_auth_user_id) AS link;
END;
$$;

ALTER FUNCTION public.resolve_current_auth_person_link()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resolve_current_auth_person_link()
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_current_auth_person_link()
FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_current_auth_person_link()
FROM service_role;
GRANT EXECUTE ON FUNCTION public.resolve_current_auth_person_link()
TO authenticated;
