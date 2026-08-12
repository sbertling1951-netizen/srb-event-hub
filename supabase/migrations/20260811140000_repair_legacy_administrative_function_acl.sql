-- Repair anonymous EXECUTE exposure on the three legacy administrative
-- authority functions identified by the Legacy Administrative Authority
-- Exposure Audit:
--
--   public.is_active_admin(uuid)
--   public.is_current_admin()
--   public.is_super_admin(uuid)
--
-- All three carried an explicit PUBLIC EXECUTE grant that was never revoked
-- at creation time (is_active_admin: 20260727120300; is_current_admin and
-- is_super_admin: created outside tracked migration history, confirmed via
-- linked-database catalog inspection and cross-checked against
-- supabase/identity-audits/baseline-diagnostics/migration_history_reconciliation_plan.md).
-- anon and service_role additionally held direct grants. The audit proved:
--
--   - no direct application .rpc() caller exists for any of the three
--   - all 40 dependent RLS policies (27 tables) run as `authenticated` and
--     already require -- and already have -- their own independent
--     `authenticated` EXECUTE grant, proven empirically to be unaffected by
--     revoking a different role's grant
--   - is_super_admin(uuid) is SECURITY DEFINER and gave anon a truthful
--     boolean oracle for arbitrary candidate auth UUIDs; is_active_admin is
--     SECURITY INVOKER and was already neutered for anon by admin_users'
--     own RLS; is_current_admin() is self-referential via auth.uid() and
--     anon has no way to target anyone but itself
--
-- Scope: ACL only. No function body, security mode, search_path, RLS
-- policy, table grant, or authority predicate is touched by this file. The
-- broader legacy authority-model questions raised by the audit (19
-- is_current_admin policies scoped TO PUBLIC rather than TO authenticated,
-- Tenant/Event scoping gaps, is_super_admin's unpinned search_path,
-- is_active_admin/is_current_admin duplicate semantics, table-level
-- DELETE/TRUNCATE grants) are explicitly out of scope for this migration.

REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_admin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_current_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_current_admin() FROM anon;
REVOKE ALL ON FUNCTION public.is_current_admin() FROM service_role;
REVOKE ALL ON FUNCTION public.is_current_admin() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
