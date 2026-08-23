-- event_import_rows -- anon Grant Hygiene.
--
-- Follows the exact least-privilege pattern already applied to
-- public.vendors (20260814060000), public.vendor_contacts/vendor_org_access/
-- vendor_event_status (20260818210000), public.attendees/
-- attendee_household_members/event_nearby_places (20260819090000), and
-- public.master_maps (20260819150000): remove anon table privileges that
-- have zero live consumer. No RLS policy is touched. authenticated/
-- service_role/owner grants are left exactly as-is -- this migration
-- touches anon only.
--
-- LIVE GRANT MATRIX (verified via information_schema.role_table_grants
-- against the linked project, 2026-08-22): anon, authenticated, and
-- service_role each hold an identical, undifferentiated set (SELECT/
-- INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE), independent of what
-- any RLS policy or any actual consumer requires -- the same out-of-band
-- drift pattern already reconciled for every table named above. Table
-- owner is postgres.
--
-- CONSUMER AUDIT (repository-wide reconciliation, see companion report):
-- public.event_import_rows' RLS policies (20260811250000_cutover_imports_
-- task_authority.sql) already restrict every command to `TO authenticated`
-- with `has_event_task_authority('event.imports.manage'/'.view', event_id)`
-- -- zero policy names anon in its TO list, so anon's SELECT/INSERT/UPDATE/
-- DELETE grants have always been RLS-inert; TRUNCATE is, as with every
-- table above, never RLS-governed at all and was the one live gap.
-- Repository-wide grep of every `.from("event_import_rows")` call and
-- every public function body (pg_get_functiondef against every function in
-- the public schema) found exactly one historical application consumer,
-- components/admin/AddEventParticipantModal.tsx -- unreachable dead code
-- with zero import/call sites anywhere in the repository (confirmed by
-- grep and removed in this same change) -- and zero RPC/function
-- dependency of any kind. The table holds 147 historical rows, none of
-- which are the dead modal's own 'manual_participant' import_type,
-- confirming its one-time write path never actually fired against this
-- project. Revoking anon's raw grants therefore removes zero legitimate
-- capability, live or dead.
--
-- authenticated and service_role are NOT touched by this migration.
-- Because the table is now confirmed to have no reachable application
-- reader or writer at all, authenticated's own SELECT/INSERT/UPDATE/
-- DELETE grants may also be stale -- that finding is reported separately
-- (see companion report) rather than acted on here, matching this
-- migration's deliberately narrow, anon-only scope.
--
-- This migration does not touch any RLS policy, helper function, RPC, or
-- schema; it adds no GRANT; it deletes no row; it does not drop the
-- table. public.event_import_rows remains a preserved, legacy historical
-- table pending a later, separately authorized retention/retirement
-- decision.

BEGIN;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.event_import_rows
FROM anon;

COMMIT;
