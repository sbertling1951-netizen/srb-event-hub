-- Governed exact Google Place-ID matching for Nearby Admin candidates.
--
-- This is deliberately a narrow read surface. The browser supplies only the
-- current search-result IDs and learns only which exact IDs are already
-- represented in the canonical scope it may govern for the selected Event.
-- It never receives identity rows, master IDs, names, or any fuzzy-match data.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_matching_google_place_ids_for_nearby_administration(
  p_event_id uuid,
  p_google_place_ids text[]
)
RETURNS TABLE (
  google_place_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_event_tenant_id uuid;
  v_event_task_allowed boolean;
  v_is_platform_admin boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Google Nearby candidate matching requires authenticated authority.';
  END IF;

  SELECT authority.allowed, authority.tenant_id
    INTO v_event_task_allowed, v_event_tenant_id
  FROM public.resolve_task_authority(v_actor, 'event.nearby.manage', p_event_id) AS authority;

  IF v_event_task_allowed IS DISTINCT FROM true OR v_event_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Google Nearby candidate matching requires event.nearby.manage authority.';
  END IF;

  IF coalesce(cardinality(p_google_place_ids), 0) = 0 THEN
    RETURN;
  END IF;

  v_is_platform_admin := public.has_platform_admin_authority(v_actor);

  RETURN QUERY
  SELECT DISTINCT provider_identity.provider_place_id
  FROM public.nearby_master_provider_identities AS provider_identity
  JOIN public.nearby_master AS master
    ON master.id = provider_identity.nearby_master_id
  WHERE provider_identity.provider = 'google_places'
    AND provider_identity.provider_place_id IN (
      SELECT nullif(btrim(search_result.google_place_id), '')
      FROM unnest(p_google_place_ids) AS search_result(google_place_id)
      WHERE nullif(btrim(search_result.google_place_id), '') IS NOT NULL
    )
    AND master.status = 'active'
    AND (
      (master.scope = 'shared_public' AND v_is_platform_admin)
      OR (
        master.scope = 'tenant_specific'
        AND master.tenant_id = v_event_tenant_id
        AND public.has_tenant_admin_authority(v_actor, master.tenant_id)
      )
    )
  ORDER BY provider_identity.provider_place_id;
END;
$function$;

ALTER FUNCTION public.list_matching_google_place_ids_for_nearby_administration(uuid, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_matching_google_place_ids_for_nearby_administration(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_matching_google_place_ids_for_nearby_administration(uuid, text[])
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
