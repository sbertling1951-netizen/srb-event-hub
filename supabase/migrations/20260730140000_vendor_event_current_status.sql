-- ============================================================================
-- Vendor Workspace V1: vendor-owned, event-specific "Current Status"
--
-- Current Status belongs to the vendor. Announcements belong to the event
-- administrator and are a separate system -- this migration does not touch
-- announcements.
--
-- One row per (vendor_id, event_id). Saving a new status replaces the
-- previous one in place via UPSERT rather than appending a history row.
-- The UNIQUE(vendor_id, event_id) constraint is what guarantees "only one
-- active status per vendor per event" -- there is structurally never more
-- than one row to disagree with, so no separate reconciliation logic is
-- needed and no history/announcement feed is created.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_event_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status_type text NOT NULL
    CHECK (status_type IN ('available', 'busy', 'away', 'fully_booked', 'special_offer', 'custom')),
  message text,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  updated_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_event_status_vendor_event_unique UNIQUE (vendor_id, event_id)
);

CREATE INDEX IF NOT EXISTS vendor_event_status_vendor_id_idx
  ON public.vendor_event_status (vendor_id);

CREATE INDEX IF NOT EXISTS vendor_event_status_event_id_idx
  ON public.vendor_event_status (event_id);

CREATE OR REPLACE FUNCTION public.set_vendor_event_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_vendor_event_status_updated_at ON public.vendor_event_status;
CREATE TRIGGER set_vendor_event_status_updated_at
BEFORE UPDATE ON public.vendor_event_status
FOR EACH ROW
EXECUTE FUNCTION public.set_vendor_event_status_updated_at();

-- --------------------------------------------------------------------------
-- RLS
--
-- Same three-branch SELECT shape as event_vendors_select_policy (admin / own
-- vendor org / member-visible). This queries vendor_org_access and
-- event_vendors -- neither of which is vendor_event_status itself -- so it
-- cannot re-enter its own evaluation the way the recursive policy fixed in
-- 20260730130000_fix_vendor_org_access_policy_recursion.sql did.
-- --------------------------------------------------------------------------

ALTER TABLE public.vendor_event_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_event_status_select_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_select_policy
  ON public.vendor_event_status
  FOR SELECT
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
    OR EXISTS (
      SELECT 1
      FROM public.event_vendors ev
      WHERE ev.vendor_id = vendor_event_status.vendor_id
        AND ev.event_id = vendor_event_status.event_id
        AND ev.is_visible_to_members IS NOT FALSE
    )
  );

-- Any active vendor_org_access member (vendor_admin or vendor_member) may
-- set their own org's status for an event they participate in. Status is
-- routine operational communication, not a structural org change, so unlike
-- vendors/vendor_contacts writes it is intentionally not restricted to
-- vendor_admin.
DROP POLICY IF EXISTS vendor_event_status_insert_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_insert_policy
  ON public.vendor_event_status
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

DROP POLICY IF EXISTS vendor_event_status_update_policy ON public.vendor_event_status;
CREATE POLICY vendor_event_status_update_policy
  ON public.vendor_event_status
  FOR UPDATE
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
  )
  WITH CHECK (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_event_status.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

-- No DELETE policy: the workspace never deletes a status row (deactivate via
-- is_active = false instead), so DELETE remains denied by default under RLS.

COMMIT;
