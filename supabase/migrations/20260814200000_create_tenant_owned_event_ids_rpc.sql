-- Public Event Read Surface Split -- Known-Context Tenant Ownership
-- Validation contract for lib/server/workspaceContextResolver.ts.
--
-- Classification audit (LEM, 2026-08-14) found this resolver's Event read
-- shape does not fit either existing governed contract: it is not open
-- discovery (get_public_discoverable_events -- no established Event yet)
-- and it is not a single known-context detail read
-- (get_event_continuity_context -- one p_event_id, full row). It instead
-- validates a *set* of already participation-derived candidate Event ids
-- (from public.resolve_member_account) against the independently
-- server-resolved Tenant, returning only which of those ids the Tenant
-- actually owns. This is the same "independently re-derive Event ->
-- Tenant ownership from public.events, never trust a caller's claim"
-- pattern already established by public.submit_member_checkin
-- (20260804130000_require_tenant_verification_in_member_checkin.sql) and
-- the governed member-vendor-request boundary
-- (20260804160000/20260807130000), which both take a server-resolved
-- p_tenant_id and independently check e.tenant_id = p_tenant_id rather
-- than trusting the caller. This migration reuses that exact model for a
-- read instead of a write.
--
-- p_tenant_id is supplied by the caller (resolveWorkspaceContext, which
-- resolves it server-side from the request's real Host header via
-- lib/server/tenantResolver.ts -- never from browser-asserted input) but
-- is not trusted as authority by itself: it only ever narrows the
-- returned set to Events that Tenant genuinely owns in public.events,
-- exactly matching the precedent's own reasoning. Combined with
-- resolveWorkspaceContext's own participation-derived candidate set, a
-- caller cannot widen its own access by asserting a different Tenant id.
--
-- Projection is id only, per the task boundary: the resolver already has
-- every other field it displays (name/venue_name/location/dates) from
-- resolve_member_account's own row, and only needed this table read to
-- confirm which candidate ids are Tenant-owned.
--
-- Predicate is `id = ANY(p_event_ids) AND tenant_id = p_tenant_id`,
-- reproducing workspaceContextResolver.ts's prior direct read
-- (`.in("id", eventIdsToValidate).eq("tenant_id", tenant.id)`) exactly --
-- no visibility/lifecycle predicate is added, matching the task's
-- instruction not to turn this into discovery or continuity logic. No
-- ORDER BY or LIMIT: the prior read returned the full matching set with
-- no order/limit, and the resolver only ever consumes it as a Set.
--
-- SECURITY DEFINER / search_path pattern matches the other governed Event
-- read functions, for the same reason: once the broad table policy is
-- narrowed, this function must remain independently authoritative rather
-- than depending on the caller's own table-level grant. EXECUTE is
-- granted to authenticated only, not anon: resolveWorkspaceContext calls
-- this only after resolveAuthenticatedRequest has already confirmed an
-- authenticated session (an unauthenticated caller returns before this
-- point), matching public.resolve_member_account's own
-- authenticated-only grant -- there is no anon-reachable caller to
-- support.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_tenant_owned_event_ids(
    p_event_ids uuid[],
    p_tenant_id uuid
)
RETURNS TABLE(
    id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
      e.id
  FROM public.events e
  WHERE e.id = ANY(p_event_ids)
    AND e.tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) TO authenticated;

-- Applied up front (matching 20260814190000's precedent): Supabase's
-- schema-level default privileges for service_role would otherwise grant
-- it EXECUTE on this new function too, even though no service_role
-- consumer exists for it (workspaceContextResolver.ts calls it only via
-- the caller's own authenticated-user-bound client, never service-role).
REVOKE EXECUTE ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) FROM service_role;

COMMIT;
