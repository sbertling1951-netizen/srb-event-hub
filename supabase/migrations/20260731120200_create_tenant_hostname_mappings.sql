-- Governed request-hostname to canonical Tenant mapping.
--
-- Seed evidence: app.eventsyncapp.com is the production URL in deploy and
-- do-pull.sh; epicentrax.com is a primary application domain in the project
-- brief. Both currently serve the same EpicentraX application. The canonical
-- FCOC Tenant UUID was confirmed by the prior Event ownership migration.
-- www.epicentrax.com redirects to epicentrax.com and is intentionally not a
-- mapping row because it does not serve the application directly.

BEGIN;

CREATE TABLE public.tenant_hostname_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL,
  tenant_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_hostname_mappings_hostname_key UNIQUE (hostname),
  CONSTRAINT tenant_hostname_mappings_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE RESTRICT,
  CONSTRAINT tenant_hostname_mappings_hostname_check
    CHECK (
      hostname = lower(hostname)
      AND hostname = btrim(hostname)
      AND char_length(hostname) BETWEEN 1 AND 253
      AND hostname ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$'
    )
);

CREATE INDEX tenant_hostname_mappings_tenant_id_idx
  ON public.tenant_hostname_mappings (tenant_id);

CREATE FUNCTION public.set_tenant_hostname_mappings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_tenant_hostname_mappings_updated_at
BEFORE UPDATE ON public.tenant_hostname_mappings
FOR EACH ROW
EXECUTE FUNCTION public.set_tenant_hostname_mappings_updated_at();

ALTER TABLE public.tenant_hostname_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_hostname_mappings FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_hostname_mappings FROM anon;
REVOKE ALL ON TABLE public.tenant_hostname_mappings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_hostname_mappings TO service_role;

REVOKE ALL ON FUNCTION public.set_tenant_hostname_mappings_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tenant_hostname_mappings_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.set_tenant_hostname_mappings_updated_at() FROM authenticated;

COMMENT ON TABLE public.tenant_hostname_mappings IS
  'Authoritative exact request-hostname routing aliases for canonical public.tenants identities.';

COMMENT ON COLUMN public.tenant_hostname_mappings.hostname IS
  'Canonical exact hostname: lowercase DNS hostname only, with no scheme, path, query, fragment, port, or trailing dot.';

COMMENT ON COLUMN public.tenant_hostname_mappings.tenant_id IS
  'Canonical Tenant identity resolved by this hostname; references public.tenants(id).';

COMMENT ON COLUMN public.tenant_hostname_mappings.is_active IS
  'Only active mappings may resolve a request Tenant; inactive rows are retained for lifecycle history.';

COMMENT ON CONSTRAINT tenant_hostname_mappings_tenant_id_fkey ON public.tenant_hostname_mappings IS
  'Prevents deletion of a Tenant while a governed hostname mapping still references it.';

DO $migration$
DECLARE
  canonical_tenant_id CONSTANT uuid := '16c39847-ce1d-43c3-b9bc-75f33e16d711';
  canonical_tenant_count bigint;
  seed_hostname_count bigint;
BEGIN
  SELECT count(*)
    INTO canonical_tenant_count
  FROM public.tenants
  WHERE id = canonical_tenant_id
    AND is_active = true;

  IF canonical_tenant_count <> 1 THEN
    RAISE EXCEPTION
      'Tenant hostname mapping seed requires exactly one active confirmed Tenant %, found %',
      canonical_tenant_id,
      canonical_tenant_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_hostname_mappings
    WHERE hostname IN ('app.eventsyncapp.com', 'epicentrax.com')
  ) THEN
    RAISE EXCEPTION
      'Tenant hostname mapping seed requires app.eventsyncapp.com and epicentrax.com to be unmapped before insertion';
  END IF;

  INSERT INTO public.tenant_hostname_mappings (hostname, tenant_id)
  VALUES
    ('app.eventsyncapp.com', canonical_tenant_id),
    ('epicentrax.com', canonical_tenant_id);

  SELECT count(*)
    INTO seed_hostname_count
  FROM public.tenant_hostname_mappings
  WHERE hostname IN ('app.eventsyncapp.com', 'epicentrax.com')
    AND tenant_id = canonical_tenant_id
    AND is_active = true;

  IF seed_hostname_count <> 2 THEN
    RAISE EXCEPTION
      'Tenant hostname mapping seed expected 2 active confirmed FCOC hostnames for Tenant %, found %',
      canonical_tenant_id,
      seed_hostname_count;
  END IF;
END;
$migration$;

COMMIT;
