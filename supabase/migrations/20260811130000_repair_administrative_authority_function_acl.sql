-- Repair explicit function EXECUTE grants inherited from the linked
-- database's public-schema default function privileges. The Stage 1
-- migrations revoked PUBLIC, but anon and service_role had direct grants.
--
-- This migration is intentionally scoped to functions introduced by the
-- Administrative Authority, Venue Evidence, and Nearby curation stages.
-- public.is_event_scoped_admin(uuid, uuid) is excluded because its live ACL
-- already has the intended postgres + authenticated exposure only.

-- Externally callable authenticated-user authority and governance surface.
REVOKE ALL ON FUNCTION public.has_platform_admin_authority(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_platform_admin_authority(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.has_platform_admin_authority(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.has_platform_admin_authority(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_platform_admin_authority(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_admin_authority(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.has_event_admin_authority(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_event_admin_authority(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.has_event_admin_authority(uuid, uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.has_event_admin_authority(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_event_admin_authority(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) FROM service_role;
REVOKE ALL ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_admin_access(uuid, uuid, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.list_tenant_admin_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tenant_admin_access(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_tenant_admin_access(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.list_tenant_admin_access(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_admin_access(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.record_venue_evidence(uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_venue_evidence(uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_venue_evidence(uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.record_venue_evidence(uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_venue_evidence(uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.review_venue_evidence(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_venue_evidence(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.review_venue_evidence(uuid, text, text, text) FROM service_role;
REVOKE ALL ON FUNCTION public.review_venue_evidence(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.review_venue_evidence(uuid, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_tenant_place(text, text, uuid, uuid, text, text, text, text, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_tenant_place(text, text, uuid, uuid, text, text, text, text, numeric, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_tenant_place(text, text, uuid, uuid, text, text, text, text, numeric, numeric, text) FROM service_role;
REVOKE ALL ON FUNCTION public.record_tenant_place(text, text, uuid, uuid, text, text, text, text, numeric, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_place(text, text, uuid, uuid, text, text, text, text, numeric, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.review_shared_place(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_shared_place(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.review_shared_place(uuid, text, text) FROM service_role;
REVOKE ALL ON FUNCTION public.review_shared_place(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.review_shared_place(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_tenant_category_override(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tenant_category_override(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.set_tenant_category_override(uuid, uuid, text) FROM service_role;
REVOKE ALL ON FUNCTION public.set_tenant_category_override(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_category_override(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) FROM service_role;
REVOKE ALL ON FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.search_shared_places(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_shared_places(text, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.search_shared_places(text, uuid, integer) FROM service_role;
REVOKE ALL ON FUNCTION public.search_shared_places(text, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_shared_places(text, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_effective_nearby_places(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_effective_nearby_places(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_effective_nearby_places(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.resolve_effective_nearby_places(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_effective_nearby_places(uuid) TO authenticated;

-- Internal trigger helpers: callable only by their owning trigger path.
REVOKE ALL ON FUNCTION public.set_venue_evidence_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_venue_evidence_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.set_venue_evidence_updated_at() FROM service_role;
REVOKE ALL ON FUNCTION public.set_venue_evidence_updated_at() FROM authenticated;

REVOKE ALL ON FUNCTION public.prevent_venue_evidence_tenant_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_venue_evidence_tenant_change() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_venue_evidence_tenant_change() FROM service_role;
REVOKE ALL ON FUNCTION public.prevent_venue_evidence_tenant_change() FROM authenticated;

REVOKE ALL ON FUNCTION public.set_place_categories_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_place_categories_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.set_place_categories_updated_at() FROM service_role;
REVOKE ALL ON FUNCTION public.set_place_categories_updated_at() FROM authenticated;

REVOKE ALL ON FUNCTION public.set_tenant_category_overrides_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tenant_category_overrides_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.set_tenant_category_overrides_updated_at() FROM service_role;
REVOKE ALL ON FUNCTION public.set_tenant_category_overrides_updated_at() FROM authenticated;
