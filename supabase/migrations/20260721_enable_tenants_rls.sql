ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.tenants
FROM anon, authenticated;

DROP POLICY IF EXISTS "Active tenants are readable by browser roles"
ON public.tenants;

CREATE POLICY "Active tenants are readable by browser roles"
ON public.tenants
FOR SELECT
TO anon, authenticated
USING (is_active = true);
