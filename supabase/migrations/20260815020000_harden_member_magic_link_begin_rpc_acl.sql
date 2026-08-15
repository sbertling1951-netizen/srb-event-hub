-- Member Magic-Link Identity Activation -- begin RPC ACL hardening (forward migration).
--
-- Live ACL inspection after 20260815010000 applied (the pgcrypto
-- search_path repair) showed begin_member_identity_claim_magic_link(text,
-- text, text, text) carries unintended anon and authenticated EXECUTE
-- grants (postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
-- service_role=X/postgres) -- inherited from this project's own
-- schema-level default privileges, not granted by 20260730120000 itself,
-- which explicitly revoked only FROM PUBLIC and granted EXECUTE only TO
-- service_role. pg_default_acl confirms the exact source: schema public,
-- object type function, grantor postgres (and, separately, grantor
-- supabase_admin) each carry a default ACL of
-- {postgres=X,anon=X,authenticated=X,service_role=X} -- every new
-- function created in public by either role is granted EXECUTE to
-- anon/authenticated/service_role by default unless a migration
-- explicitly revokes it. This is the same class of drift
-- 20260814170000/20260814220000 already found and fixed elsewhere in
-- this repository (there for an unintended service_role grant and an
-- unintended anon grant respectively), now confirmed here.
--
-- The only traced repository caller,
-- app/api/member/identity-claim/verification/initiate-magic-link/route.ts,
-- has always invoked this RPC through the service-role admin client
-- (getSupabaseAdmin()); no anon- or authenticated-role caller exists.
-- service-role-only execution is the proven intended model.
--
-- Directly related functions in the same magic-link/identity-claim flow
-- were inspected live and found already clean: both
-- begin_member_identity_claim_verification and
-- finalize_member_identity_activation show only postgres/service_role
-- EXECUTE today -- no anon or authenticated grant exists, so neither
-- needs repair. finalize_member_identity_activation_via_magic_link does
-- carry an unintended anon EXECUTE grant of the same default-privilege
-- kind, but its proven intended execution model is authenticated (its
-- own migration explicitly grants EXECUTE TO authenticated, and
-- app/auth/callback/page.tsx calls it directly from the browser's own
-- authenticated Supabase client) -- not service-role-only -- so it does
-- not meet this repair's inclusion criterion and is recorded separately
-- as a follow-up concern rather than touched here.
--
-- 20260730120000 is already applied and is not edited here (immutable
-- once applied, matching this repository's established migration
-- discipline). This is a narrow, additive-only REVOKE that touches
-- nothing else -- no function body, search_path, PUBLIC revoke, or
-- service_role grant changes (both already correct and left untouched).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.begin_member_identity_claim_magic_link(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.begin_member_identity_claim_magic_link(text, text, text, text) FROM authenticated;

COMMIT;
