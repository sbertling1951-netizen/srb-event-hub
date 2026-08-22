-- Corrective follow-up to 20260821230000_add_category_identity_to_nearby_resolver.sql.
--
-- That migration DROPped and recreated public.resolve_effective_nearby_places
-- to add category_id/category_code/category_label, then reapplied EXECUTE
-- to authenticated and anon to match the exact pre-migration grant set
-- (live-verified before writing it: anon=true, authenticated=true,
-- service_role=false).
--
-- Live, read-only verification immediately after applying that migration
-- found service_role had unexpectedly gained EXECUTE -- traced to
-- Supabase's own project-level default privileges: `pg_default_acl` grants
-- EXECUTE on every newly-created public-schema function to
-- postgres/anon/authenticated/service_role automatically, individually
-- (not via the PUBLIC pseudo-role), the moment CREATE FUNCTION runs. The
-- prior migration's `REVOKE ALL ... FROM PUBLIC` does not touch this --
-- REVOKE FROM PUBLIC only revokes what the PUBLIC pseudo-role itself
-- holds, not what a specific role was separately granted via default ACL.
-- Since this function is DROPped and CREATEd fresh (required -- Postgres
-- disallows CREATE OR REPLACE FUNCTION from changing an existing
-- function's RETURNS TABLE column list), it received that default grant
-- new; the original function (created 20260811120000, long before this
-- default-ACL mechanism was relevant to it) never had service_role
-- EXECUTE, per that migration's own grants and every "harden_*_grants"
-- migration since.
--
-- This migration does the one thing the prior one's grant-reapplication
-- missed: explicitly revoke the default-ACL-granted service_role EXECUTE,
-- restoring the exact pre-Stage-B grant set. No other change.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.resolve_effective_nearby_places(uuid) FROM service_role;

COMMIT;
