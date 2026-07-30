-- ============================================================================
-- Vendor invitation workflow: close a duplicate-pending-invitation race
--
-- app/api/admin/vendors/invitations POST already checks for an existing
-- (vendor_id, invitation_email) row before inserting a new pending one, but
-- that check-then-insert is not atomic. A partial unique index makes the
-- "at most one pending invitation per (vendor, email)" invariant a database
-- guarantee rather than an application-level assumption -- mirroring the
-- existing vendor_org_access_active_vendor_auth_unique index already applied
-- for the analogous "at most one active row per (vendor, auth user)" rule
-- (20260727120300_vendor_person_specific_access_foundation.sql).
--
-- No data is modified. No RLS, privilege, or unrelated schema change.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_org_access_pending_vendor_email_unique
  ON public.vendor_org_access (vendor_id, invitation_email)
  WHERE status = 'pending';

COMMIT;
