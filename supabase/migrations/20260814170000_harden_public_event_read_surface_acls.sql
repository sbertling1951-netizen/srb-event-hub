-- Public Event Read Surface Split, Stage 1 hardening (forward migration).
--
-- Live ACL inspection after 20260814160000 applied showed
-- get_public_discoverable_events() and get_event_continuity_context(uuid)
-- each carry an unintended service_role EXECUTE grant
-- (postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
-- service_role=X/postgres) -- inherited from this project's own
-- schema-level default privileges for service_role, not granted by
-- 20260814160000 itself (that migration's REVOKE ALL ... FROM PUBLIC
-- plus GRANT EXECUTE ... TO anon, authenticated never named
-- service_role). Neither function has a proven service_role consumer:
-- every existing service_role read of public.events goes through the
-- base table directly (app/api/vendor/workspace/summary/route.ts,
-- app/api/member/identity-claim/evaluate/route.ts, and
-- lib/server/workspaceContextResolver.ts's authenticated-user-bound
-- client), so this grant is unused capability, not a required one.
--
-- 20260814160000 is already applied and is not edited here (immutable
-- once applied, matching this repository's established migration
-- discipline). This is a narrow, additive-only REVOKE that touches
-- nothing else -- no function body, predicate, column projection, or
-- anon/authenticated grant changes.
--
-- SECURITY DEFINER/search_path is intentionally left unchanged: live
-- inspection of pg_namespace.nspacl for schema public
-- (=U/pg_database_owner, plus explicit anon/authenticated/service_role
-- entries each carrying only U, no C) and has_schema_privilege() for
-- anon/authenticated/service_role all confirm CREATE on schema public
-- already has zero runtime/untrusted-role grantees. Nothing here can
-- create a search-path-shadowing object in public, so the search-path
-- pinning the two functions already carry (SET search_path TO 'public')
-- has no unsafe-search-path defect to correct, and this migration does
-- not touch either function's definition.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_public_discoverable_events() FROM service_role;
REVOKE EXECUTE ON FUNCTION public.get_event_continuity_context(uuid) FROM service_role;

COMMIT;
