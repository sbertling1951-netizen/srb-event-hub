-- Tenant T0: Event Tenant ownership is an immutable identity boundary.
--
-- public.events.tenant_id is the one canonical Event -> Tenant ownership
-- fact. Authenticated Event metadata editing remains governed by the existing
-- has_event_admin_authority RLS policy, but that policy deliberately includes
-- direct Event assignments. Without a separate ownership invariant, a direct
-- Event Admin could keep satisfying the policy while changing tenant_id and
-- thereby transfer inherited authority between Tenants.
--
-- There is intentionally no Event-transfer operation in this stage. Until a
-- separately governed policy decides whether transfer is ever legal, every
-- ordinary UPDATE path -- Event Admin, Tenant Admin, Platform Admin, or
-- service-role code -- receives the same database-enforced rejection when it
-- attempts to change an existing Event's Tenant.

BEGIN;

CREATE FUNCTION public.prevent_event_tenant_ownership_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'events.tenant_id is immutable after insert';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.prevent_event_tenant_ownership_change() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_event_tenant_ownership_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_event_tenant_ownership_change
BEFORE UPDATE OF tenant_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_event_tenant_ownership_change();

-- The server-side Vendor invitation helper must consume the same canonical
-- predicate as Event RLS rather than reimplementing the hierarchy from raw
-- admin tables. service_role already owns the server-only caller boundary;
-- this grant exposes no new authenticated or anonymous capability.
GRANT EXECUTE ON FUNCTION public.has_event_admin_authority(uuid, uuid)
  TO service_role;

COMMIT;
