-- Evaluations Grant Hardening.
--
-- Confirmed defect (LEM Evaluations Mutation Audit, Stage 3C, and this
-- Grant Hardening pass, 2026-08-13/14): none of the five Evaluation
-- tables ever received a table-level GRANT through any tracked
-- migration -- their current raw ACLs were applied out-of-band, the
-- same drift pattern already reconciled for public.events,
-- public.admin_event_permissions, and public.announcements.
-- service_role holds unrestricted DELETE/INSERT/UPDATE/TRUNCATE on all
-- five tables with zero legitimate consumer -- grepped exhaustively:
-- no server/backend service-role code anywhere in the repository reads
-- or writes any Evaluation table (the two unrelated "evaluation" hits
-- under lib/server/ and app/api/ are identity-evidence evaluation and a
-- vendor-notices shadow evaluation -- different domains, same English
-- word). anon/authenticated additionally hold the same unrestricted set
-- on the three global, Event-independent configuration tables
-- (evaluation_templates, evaluation_questions, evaluation_choices),
-- which also have zero live consumers of any kind -- confirmed by
-- repository-wide grep, the member evaluation UI hardcodes its
-- questions/choices client-side instead of reading them, and neither
-- table carries a single RLS policy.
--
-- This migration removes only the unused mutation privileges
-- (INSERT/UPDATE/DELETE/TRUNCATE). It does not touch SELECT,
-- REFERENCES, or TRIGGER, and it does not touch any RLS policy or add
-- any GRANT -- neither is necessary to retire the privileges removed
-- here. event_evaluations/event_evaluation_answers's existing
-- authenticated grant (SELECT, INSERT, UPDATE only -- no DELETE, no
-- TRUNCATE, granted directly by
-- 20260805130000_close_event_photos_and_evaluations_exposure.sql, not
-- out-of-band) and anon's existing zero grant on those two tables are
-- both already exactly right and are left untouched; every existing
-- is_own_attendee/is_event_scoped_admin RLS policy on all five tables
-- is left untouched.
--
-- service_role's rolbypassrls=true is a separate control from table ACL
-- privilege, confirmed live (a role attribute, not a substitute for
-- REVOKE) -- it is why service_role's grant matters at all despite RLS
-- being enabled on every one of these tables: RLS never applies to it,
-- so the table grant is the only control governing what it can do.
-- Revoking the unused privilege is what actually closes the door;
-- leaving RLS alone has no bearing on service_role either way.
--
-- No Lifecycle guard, no Authority task key, and no mutation RPC is
-- added here -- out of scope for this pass, per the accompanying audit
-- (LIFECYCLE STAGE 3C EVALUATIONS BLOCKED -- REVIEW REQUIRED): there is
-- still no Admin Evaluation mutation path to attach one to, and none is
-- created by this migration either.

BEGIN;

-- ============================================================
-- event_evaluations / event_evaluation_answers -- participant-write
-- surfaces gated by is_own_attendee (member) / is_event_scoped_admin
-- (admin, read-only). authenticated's INSERT/SELECT/UPDATE, required
-- for member evaluation submission/editing, and anon's zero grant are
-- both left exactly as-is. Only service_role's unused mutation
-- privileges are removed.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.event_evaluations
FROM service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.event_evaluation_answers
FROM service_role;

-- ============================================================
-- evaluation_templates / evaluation_questions / evaluation_choices --
-- global, Event-independent configuration tables with no live
-- consumer and no RLS policy of any kind. Their raw mutation grants to
-- anon, authenticated, and service_role are removed. SELECT is left
-- untouched, matching this migration's mutation-only scope.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.evaluation_templates
FROM anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.evaluation_questions
FROM anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.evaluation_choices
FROM anon, authenticated, service_role;

COMMIT;
