-- ==========================================================================
-- Vendor domain clean reset + person-specific access foundation
--
-- Authorized by project owner for clean vendor-domain restart:
-- - All legacy vendor-domain rows are intentionally deleted.
-- - Real vendors will self-register again with person-specific auth.
--
-- This migration:
-- 1) Creates vendor contact/access foundation tables for person-specific auth.
-- 2) Clears legacy vendor-domain data in FK-safe order.
-- 3) Clears stale attendee vendor assignment fields (without deleting attendees).
-- 4) Retires shared vendor token columns used for legacy organization-wide access.
-- 5) Applies scoped RLS for vendor workspace boundaries and admin authority.
--
-- Non-goals:
-- - Does not create fake auth users.
-- - Does not create replacement vendor rows.
-- - Does not auto-approve event participation.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  first_name text,
  last_name text,
  email text,
  mobile_phone text,
  role_title text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_contacts_vendor_id_idx
  ON public.vendor_contacts (vendor_id);

CREATE INDEX IF NOT EXISTS vendor_contacts_person_id_idx
  ON public.vendor_contacts (person_id);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_contacts_vendor_email_unique
  ON public.vendor_contacts (vendor_id, lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_contacts_primary_per_vendor_unique
  ON public.vendor_contacts (vendor_id)
  WHERE is_primary = true;

ALTER TABLE public.vendor_contacts
  ADD CONSTRAINT vendor_contacts_id_vendor_id_unique UNIQUE (id, vendor_id);

CREATE TABLE IF NOT EXISTS public.vendor_org_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  vendor_contact_id uuid NOT NULL,
  person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invitation_email text NOT NULL,
  access_role text NOT NULL
    CHECK (access_role IN ('vendor_admin', 'vendor_member')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  invited_for_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  invited_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  revoked_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_org_access_contact_vendor_fk
    FOREIGN KEY (vendor_contact_id, vendor_id)
    REFERENCES public.vendor_contacts(id, vendor_id)
    ON DELETE CASCADE,
  CONSTRAINT vendor_org_access_active_requires_auth
    CHECK (status <> 'active' OR auth_user_id IS NOT NULL),
  CONSTRAINT vendor_org_access_revoked_requires_timestamp
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS vendor_org_access_vendor_id_idx
  ON public.vendor_org_access (vendor_id);

CREATE INDEX IF NOT EXISTS vendor_org_access_contact_id_idx
  ON public.vendor_org_access (vendor_contact_id);

CREATE INDEX IF NOT EXISTS vendor_org_access_auth_user_id_idx
  ON public.vendor_org_access (auth_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_org_access_active_vendor_auth_unique
  ON public.vendor_org_access (vendor_id, auth_user_id)
  WHERE status = 'active' AND auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_vendor_contact_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_vendor_org_access_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_vendor_contact_updated_at ON public.vendor_contacts;
CREATE TRIGGER set_vendor_contact_updated_at
BEFORE UPDATE ON public.vendor_contacts
FOR EACH ROW
EXECUTE FUNCTION public.set_vendor_contact_updated_at();

DROP TRIGGER IF EXISTS set_vendor_org_access_updated_at ON public.vendor_org_access;
CREATE TRIGGER set_vendor_org_access_updated_at
BEFORE UPDATE ON public.vendor_org_access
FOR EACH ROW
EXECUTE FUNCTION public.set_vendor_org_access_updated_at();

-- --------------------------------------------------------------------------
-- Authorized clean vendor-domain reset (FK-safe order)
-- --------------------------------------------------------------------------

UPDATE public.attendees
SET
  vendor_master_id = NULL,
  vendor_assigned_event_id = NULL
WHERE vendor_master_id IS NOT NULL OR vendor_assigned_event_id IS NOT NULL;

DELETE FROM public.vendor_service_requests;
DELETE FROM public.event_vendors;
DELETE FROM public.vendor_services;
DELETE FROM public.vendor_org_access;
DELETE FROM public.vendor_contacts;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendors'
      AND column_name = 'access_token'
  ) THEN
    EXECUTE 'UPDATE public.vendors SET access_token = NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendors'
      AND column_name = 'access_token_expires_at'
  ) THEN
    EXECUTE 'UPDATE public.vendors SET access_token_expires_at = NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendors'
      AND column_name = 'vendor_portal_enabled'
  ) THEN
    EXECUTE 'UPDATE public.vendors SET vendor_portal_enabled = false';
  END IF;
END
$$;

DELETE FROM public.vendors;

DROP INDEX IF EXISTS public.vendors_access_token_key;
ALTER TABLE public.vendors DROP COLUMN IF EXISTS access_token;
ALTER TABLE public.vendors DROP COLUMN IF EXISTS access_token_expires_at;
ALTER TABLE public.vendors DROP COLUMN IF EXISTS vendor_portal_enabled;

-- --------------------------------------------------------------------------
-- RLS + policy boundaries
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_active_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = _uid
      AND au.is_active = true
  );
$$;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_org_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_select_policy ON public.vendors;
CREATE POLICY vendors_select_policy
  ON public.vendors
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_vendors ev
      WHERE ev.vendor_id = vendors.id
        AND ev.is_visible_to_members IS NOT FALSE
    )
  );

DROP POLICY IF EXISTS vendors_insert_policy ON public.vendors;
CREATE POLICY vendors_insert_policy
  ON public.vendors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    length(trim(coalesce(business_name, name, ''))) > 0
  );

DROP POLICY IF EXISTS vendors_update_policy ON public.vendors;
CREATE POLICY vendors_update_policy
  ON public.vendors
  FOR UPDATE
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  )
  WITH CHECK (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendors.id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  );

DROP POLICY IF EXISTS vendor_contacts_select_policy ON public.vendor_contacts;
CREATE POLICY vendor_contacts_select_policy
  ON public.vendor_contacts
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
  );

DROP POLICY IF EXISTS vendor_contacts_insert_policy ON public.vendor_contacts;
CREATE POLICY vendor_contacts_insert_policy
  ON public.vendor_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  );

DROP POLICY IF EXISTS vendor_contacts_update_policy ON public.vendor_contacts;
CREATE POLICY vendor_contacts_update_policy
  ON public.vendor_contacts
  FOR UPDATE
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  )
  WITH CHECK (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = vendor_contacts.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
        AND voa.access_role = 'vendor_admin'
    )
  );

DROP POLICY IF EXISTS vendor_org_access_select_policy ON public.vendor_org_access;
CREATE POLICY vendor_org_access_select_policy
  ON public.vendor_org_access
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR auth_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access admin_access
      WHERE admin_access.vendor_id = vendor_org_access.vendor_id
        AND admin_access.auth_user_id = auth.uid()
        AND admin_access.status = 'active'
        AND admin_access.access_role = 'vendor_admin'
    )
  );

DROP POLICY IF EXISTS vendor_org_access_admin_insert_policy ON public.vendor_org_access;
CREATE POLICY vendor_org_access_admin_insert_policy
  ON public.vendor_org_access
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_admin(auth.uid())
  );

DROP POLICY IF EXISTS vendor_org_access_admin_update_policy ON public.vendor_org_access;
CREATE POLICY vendor_org_access_admin_update_policy
  ON public.vendor_org_access
  FOR UPDATE
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
  )
  WITH CHECK (
    public.is_active_admin(auth.uid())
  );

DROP POLICY IF EXISTS event_vendors_select_policy ON public.event_vendors;
CREATE POLICY event_vendors_select_policy
  ON public.event_vendors
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.vendor_org_access voa
      WHERE voa.vendor_id = event_vendors.vendor_id
        AND voa.auth_user_id = auth.uid()
        AND voa.status = 'active'
    )
    OR event_vendors.is_visible_to_members IS NOT FALSE
  );

DROP POLICY IF EXISTS event_vendors_admin_write_policy ON public.event_vendors;
CREATE POLICY event_vendors_admin_write_policy
  ON public.event_vendors
  FOR ALL
  TO authenticated
  USING (public.is_active_admin(auth.uid()))
  WITH CHECK (public.is_active_admin(auth.uid()));

COMMIT;
