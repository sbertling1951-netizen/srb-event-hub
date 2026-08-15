-- Tenant Ownership Validation RPC ACL hardening (forward migration).
--
-- Live ACL inspection after 20260814200000 applied showed
-- get_tenant_owned_event_ids(uuid[], uuid) carries an unintended anon
-- EXECUTE grant (proacl: postgres=X/postgres, anon=X/postgres,
-- authenticated=X/postgres) -- inherited from this project's own
-- schema-level default privileges for anon (and, matching every prior
-- new function in this repository, service_role too), not granted by
-- 20260814200000 itself, which explicitly stated only
-- `GRANT EXECUTE ... TO authenticated`. This is the exact same class of
-- drift 20260814170000 already found and fixed for
-- get_public_discoverable_events/get_event_continuity_context, this time
-- for a function that (unlike those two) is deliberately not intended for
-- anon at all: workspaceContextResolver.ts only calls it after
-- resolveAuthenticatedRequest has already confirmed an authenticated
-- session, so there is no anon-reachable caller to support, matching
-- public.resolve_member_account's own authenticated-only grant.
--
-- 20260814200000 is already applied and is not edited here (immutable
-- once applied, matching this repository's established migration
-- discipline). This is a narrow, additive-only REVOKE that touches
-- nothing else -- no function body, predicate, column projection, or
-- authenticated grant changes. service_role was already correctly
-- revoked by 20260814200000 itself and needs no further action here.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_tenant_owned_event_ids(uuid[], uuid) FROM anon;

COMMIT;
