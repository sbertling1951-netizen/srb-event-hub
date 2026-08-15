-- Member Magic-Link Identity Activation -- finalize RPC ACL hardening
-- (forward migration).
--
-- Live ACL inspection (following the begin RPC's own hardening,
-- 20260815020000) showed finalize_member_identity_activation_via_magic_link(text)
-- also carries an unintended anon EXECUTE grant (postgres=X/postgres,
-- anon=X/postgres, authenticated=X/postgres, service_role=X/postgres) --
-- the same pg_default_acl-inherited default-privilege drift already
-- fixed three times in this repository (20260814170000, 20260814220000,
-- 20260815020000): every new function created in schema public by
-- either grantor role (postgres, supabase_admin) is granted EXECUTE to
-- anon/authenticated/service_role by default unless a migration
-- explicitly revokes it.
--
-- Unlike the begin RPC, this function's intended execution model is not
-- service-role-only: app/auth/callback/page.tsx calls it directly via
-- lib/supabase.ts's browser-facing, anon-key-initialized `supabase`
-- client, immediately after that page's own code establishes an
-- authenticated session from the magic-link callback -- so `authenticated`
-- EXECUTE is required and intentional (matching this function's own
-- 20260730120000 migration, which explicitly granted EXECUTE TO
-- authenticated). Only the unintended `anon` grant is revoked here.
--
-- Unauthenticated execution was already safe before this migration --
-- the function itself derives its identity strictly from auth.uid() and
-- returns REJECTED immediately when it is null, so anon's EXECUTE
-- privilege was unused capability, not an active gap -- but the ACL
-- boundary should not rely on function-body behavior alone to enforce
-- who may call it, matching the same reasoning already applied to the
-- begin RPC.
--
-- 20260730120000 is already applied and is not edited here (immutable
-- once applied, matching this repository's established migration
-- discipline). This is a narrow, additive-only REVOKE that touches
-- nothing else -- no function body, search_path, authenticated grant,
-- service_role grant, or any other function.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.finalize_member_identity_activation_via_magic_link(text) FROM anon;

COMMIT;
