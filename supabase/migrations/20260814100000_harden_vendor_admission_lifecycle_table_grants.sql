-- Vendor Admission Lifecycle -- Stage 1 grant correction.
--
-- Confirmed defect, caught by live verification immediately after
-- applying 20260814090000_create_vendor_admission_lifecycle_foundation.sql
-- (same day, before Stage 1 was considered complete): that migration's
-- header stated "zero direct INSERT/UPDATE/DELETE grant for any role...
-- Getting this right from day one" -- but CREATE TABLE alone does not
-- guarantee that in this project. Supabase's schema-level default
-- privileges automatically granted the full blanket ACL
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) to anon,
-- authenticated, AND service_role on all three new tables
-- (vendor_disposition_reason_codes, vendor_event_applications,
-- vendor_event_dispositions) the instant they were created -- the exact
-- same out-of-band-grant defect class already found and hardened on
-- public.vendors (20260814060000), the Evaluation tables, and the
-- Map/Parking tables, this time self-inflicted on brand-new tables
-- rather than inherited from a July baseline.
--
-- Zero INSERT/UPDATE/DELETE policy exists on either
-- vendor_event_applications or vendor_event_dispositions (confirmed live
-- immediately before this migration), so RLS already blocked those three
-- commands for anon/authenticated regardless of the grant -- but
-- TRUNCATE is never RLS-governed in Postgres, and service_role carries
-- rolbypassrls=true (confirmed live for this project in the Vendors
-- Grant Hardening stage), so service_role's blanket grant was a fully
-- live, ungated exposure: full direct SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE on tables whose entire design intent is RPC-only mutation
-- from inception, plus scoped SELECT gated by has_event_task_authority.
--
-- This migration removes exactly the excess, leaving only what each
-- role actually needs today: authenticated keeps SELECT only (RLS then
-- narrows that to has_event_task_authority('event.vendors.view',
-- event_id) per row, or USING (true) for the global reason-code lookup);
-- anon and service_role keep nothing on any of the three tables -- no
-- live consumer exists for either yet, and Stage 2's RPCs will be
-- SECURITY DEFINER (owned by postgres), which does not require the
-- invoking role to hold any table grant, exactly matching how
-- register_vendor_self already works on public.vendors. REFERENCES and
-- TRIGGER are left untouched on every role, matching the established
-- hardening precedent (Evaluations, Map/Parking, Vendors) that limits
-- itself to mutation privileges. No RLS policy, schema, or function is
-- touched here.

BEGIN;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_disposition_reason_codes
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_disposition_reason_codes
FROM authenticated;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_disposition_reason_codes
FROM service_role;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_event_applications
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_event_applications
FROM authenticated;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_event_applications
FROM service_role;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_event_dispositions
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_event_dispositions
FROM authenticated;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.vendor_event_dispositions
FROM service_role;

COMMIT;
