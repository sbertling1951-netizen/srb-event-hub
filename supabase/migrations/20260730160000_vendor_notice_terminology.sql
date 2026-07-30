-- ============================================================================
-- Vendor Notices: evolve the existing vendor_event_status foundation
--
-- "Vendor Notices" is the same capability as the vendor Current Status
-- feature shipped in 20260730140000_vendor_event_current_status.sql -- one
-- vendor-owned, event-specific slot (type + short message + optional
-- expiration + active flag), one row per (vendor_id, event_id). Rather than
-- create a second table/feature for the same data (a "one source of truth"
-- violation), this migration evolves that table in place:
--
-- 1) Replaces the status_type vocabulary with the Vendor Notices Version 1
--    types: available_today, show_special, out_of_area, closed, other.
--    Safe with no data migration -- the table has 0 rows in production as
--    of this migration (verified live before writing this file).
-- 2) Adds a DELETE policy. The original migration deliberately omitted one
--    ("the workspace never deletes a status row") because V1 Current
--    Status had no delete action; Vendor Notices V1 explicitly requires
--    vendors to be able to delete their own notices, so that assumption no
--    longer holds. The policy mirrors the existing INSERT/UPDATE policy
--    shape exactly (same vendor_org_access-active-member check).
--
-- No new table. No column rename (status_type/message/expires_at/is_active
-- keep their names; "notice" is UI/API vocabulary, not a schema change).
-- No change to any other table, policy, or grant.
-- ============================================================================

BEGIN;

ALTER TABLE public.vendor_event_status
  DROP CONSTRAINT vendor_event_status_status_type_check;

ALTER TABLE public.vendor_event_status
  ADD CONSTRAINT vendor_event_status_status_type_check
  CHECK (status_type IN ('available_today', 'show_special', 'out_of_area', 'closed', 'other'));

DROP POLICY IF EXISTS vendor_event_status_delete_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_delete_policy
  ON public.vendor_event_status
  FOR DELETE
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

COMMIT;
