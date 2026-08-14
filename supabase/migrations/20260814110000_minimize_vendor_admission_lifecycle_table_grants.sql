-- Vendor Admission Lifecycle -- Stage 1 durability closeout: minimize
-- remaining REFERENCES/TRIGGER grants.
--
-- Dependency check performed before writing this migration (evidence,
-- not assumption): a repository-wide grep of app/ and lib/ for
-- vendor_disposition_reason_codes, vendor_event_applications, and
-- vendor_event_dispositions returns zero hits -- no application code
-- references any of the three tables yet (expected: Stage 2's RPCs and
-- Stage 4's UI do not exist yet). A search of every migration outside
-- 20260814090000/20260814100000 for a FOREIGN KEY ... REFERENCES into
-- any of the three tables also returns zero hits -- every existing FK
-- into them (event_vendors.application_id/current_disposition_id,
-- vendor_event_applications.current_disposition_id,
-- vendor_event_dispositions.application_id/reason_code) was created by
-- Stage 1's own migrations, run as postgres (the table owner), which
-- needs no GRANT of its own privileges to itself.
--
-- REFERENCES and TRIGGER are exclusively DDL-time privileges (required
-- only to CREATE a foreign key constraint against, or CREATE a trigger
-- on, the table) -- never exercised by DML (SELECT/INSERT/UPDATE/
-- DELETE), and therefore never exercised by any runtime request path.
-- Stage 2's future RPCs will be SECURITY DEFINER, owned by postgres,
-- following the register_vendor_self/submit_my_vendor_service_request
-- pattern already established in this repository -- they execute DDL
-- never, and DML with the function owner's own privileges, not the
-- calling role's. No caller-held REFERENCES or TRIGGER grant is or will
-- be required by any concrete, evidenced dependency.
--
-- This migration removes the two remaining privileges left in place by
-- 20260814100000 (which matched the established Evaluations/Map-Parking/
-- Vendors hardening precedent of leaving REFERENCES/TRIGGER untouched as
-- a scope-discipline default, not because a dependency required them).
-- Given an explicit least-privilege target and a confirmed absence of
-- dependency this time, this migration goes one step further than that
-- precedent for these three brand-new tables specifically. It does not
-- retroactively apply this stricter standard to vendors, the Evaluation
-- tables, or the Map/Parking tables -- that would be a separate,
-- out-of-scope decision for each of those tables' own consumers to be
-- re-audited against.
--
-- Resulting grant state: anon holds no direct privilege on any of the
-- three tables; authenticated holds SELECT only (still gated per-row by
-- the has_event_task_authority('event.vendors.view', event_id) policies
-- created in 20260814090000, or USING (true) for the global reason-code
-- lookup); service_role holds no direct privilege on any of the three
-- tables. No RLS policy, schema, or function is touched here.

BEGIN;

REVOKE REFERENCES, TRIGGER
ON TABLE public.vendor_disposition_reason_codes
FROM anon, authenticated, service_role;

REVOKE REFERENCES, TRIGGER
ON TABLE public.vendor_event_applications
FROM anon, authenticated, service_role;

REVOKE REFERENCES, TRIGGER
ON TABLE public.vendor_event_dispositions
FROM anon, authenticated, service_role;

COMMIT;
