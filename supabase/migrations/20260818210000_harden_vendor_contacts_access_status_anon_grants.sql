-- Vendor Contacts / Vendor Org Access / Vendor Event Status -- anon Grant
-- Hygiene.
--
-- Candidate #3 (20260818200000) reconciled these three tables' RLS Admin
-- authority and explicitly deferred anon table-grant hygiene as a
-- separate, later pass. This migration closes that gap.
--
-- LIVE GRANT MATRIX (verified via information_schema.role_table_grants
-- against the linked project, 2026-08-18): anon, authenticated, and
-- service_role each hold an identical, undifferentiated set of
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on all three
-- tables -- the same raw, out-of-band ACL drift pattern already
-- reconciled for public.vendors (20260814060000), public.events, the
-- Evaluation tables, and Map/Parking. This migration touches only anon;
-- authenticated and service_role are left exactly as-is, per this
-- workstream's scope.
--
-- ANON-CONSUMER AUDIT (repository-wide, exhaustive):
--
--   * RLS proof, not assumption: every live policy on all three tables
--     is scoped `TO authenticated` -- confirmed via pg_policies, zero
--     rows target anon. This is not new: vendor_event_status_select_
--     policy (the oldest of the three, 20260730140000) was created
--     `TO authenticated` from the table's very inception, unchanged by
--     every later migration through and including 20260818200000. A
--     role-scoped policy never evaluates for a role outside its TO
--     list -- Postgres denies the whole role class before any USING/
--     WITH CHECK predicate runs -- so no permissive branch on any of
--     these three tables has ever admitted the anon role, on any
--     command, at any point in these tables' history.
--
--   * This app does have a genuine anon-role browser consumer to check
--     against, not a hypothetical one: app/member/login's "Temporary
--     Event Access" path (verify_member_event_login RPC) authenticates
--     an attendee by event code + registration identifier and persists
--     the result to localStorage only -- it never calls supabase.auth.
--     signIn*, so it establishes no Supabase Auth session. The shared
--     browser client (lib/supabase.ts) therefore issues every
--     subsequent request for that session as the bare anon apikey, and
--     PostgREST executes it as the `anon` database role -- confirmed
--     by comparison with the identical pattern already documented for
--     temporary event-code map sessions in 20260816160000.
--
--   * app/member/page.tsx and app/member/vendor-signup/page.tsx both
--     read public.vendor_event_status directly from this same shared
--     browser client (vendor notices for the member dashboard). For a
--     Temporary-Event-Access session, that read has always run as anon
--     against a `TO authenticated`-only policy -- i.e., it has always
--     silently returned zero rows / hit the caught-and-logged error
--     branch already present at both call sites, from the table's
--     20260730140000 creation onward. Revoking anon's table grant here
--     changes nothing about that call's outcome: PostgREST already
--     rejects it (or filters it to nothing) for the identical
--     role-scope reason before any grant is consulted. Members signed
--     in through a real Supabase Auth session (password sign-in,
--     activated account) are unaffected either way -- their requests
--     run as `authenticated` and are governed entirely by the policies
--     Candidate #3 left untouched.
--
--   * vendor_contacts and vendor_org_access have no member-facing or
--     anon-facing caller at all: their only direct-table consumer,
--     confirmed by Candidate #3's own caller-matrix audit and
--     re-confirmed here, is app/api/admin/vendors/invitations/route.ts
--     (service-role) plus the service-role vendor workspace routes
--     (lib/server/vendorAccess.ts, app/api/vendor/session/route.ts,
--     app/api/vendor/workspace/contacts/route.ts). None runs as anon.
--
--   * SECURITY DEFINER dependency check: every function whose body
--     references any of these three tables (activate_vendor_invitation,
--     register_vendor_self, resolve_vendor_person_identity,
--     is_vendor_org_admin, evaluate_vendor_notices_authority_shadow) is
--     owned by postgres and executes with the function owner's own
--     privileges, not the calling role's -- confirmed live via
--     pg_proc/pg_get_userbyid. A table-level REVOKE from anon cannot
--     affect any of them. None is itself EXECUTE-granted to anon
--     (confirmed via has_function_privilege), so there is no anon RPC
--     entry point into this family either.
--
--   * TRUNCATE is never RLS-governed in Postgres regardless of policy
--     scope -- it was, before this migration, the one privilege in
--     anon's grant that was not already inert by role-scope alone. Its
--     removal here is what actually closes a reachable exposure, the
--     same reasoning already applied to public.vendors in 20260814060000.
--
-- TARGET ACL: anon loses SELECT, INSERT, UPDATE, DELETE, TRUNCATE on all
-- three tables -- none had a live policy path or a live consumer.
-- REFERENCES and TRIGGER are left untouched, matching the direct sibling
-- precedent set by public.vendors' own grant hardening (20260814060000),
-- which limits itself to consumer-backed mutation/read privileges and
-- leaves the DDL-adjacent set alone as a scope-discipline default. (A
-- stricter precedent revoking REFERENCES/TRIGGER outright exists --
-- 20260814110000 -- but that migration explicitly scoped itself to three
-- brand-new admission-lifecycle tables with a fresh, from-scratch
-- dependency proof, and explicitly declined to extend that stricter
-- standard retroactively to public.vendors or any other existing table.
-- These three tables are direct, long-lived siblings of public.vendors,
-- not a new table family, so the vendors precedent -- not the admission-
-- lifecycle one -- is the applicable convention here.) authenticated and
-- service_role are not touched by this migration at all. No RLS policy,
-- helper function, RPC, or schema is touched; no GRANT is added.

BEGIN;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_contacts
FROM anon;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_org_access
FROM anon;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_event_status
FROM anon;

COMMIT;
