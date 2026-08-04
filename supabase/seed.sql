-- Local/CI development bootstrap only. This file is never applied to any
-- linked or production database: Supabase runs seed files as part of
-- `db reset` against the local target only, never as part of `db push` or
-- `migration up` against a linked project unless `--include-seed` is
-- explicitly passed, which this repository's deployment process never
-- does. It exists solely so that `npx supabase db reset` leaves a locally
-- usable, Tenant-resolvable environment.
--
-- This is a deliberately separate mechanism from real Tenant bootstrap.
-- Schema migrations never create organizational data (see
-- 20260731120000_add_events_tenant_ownership.sql, which now succeeds on a
-- genuinely empty database precisely so that no migration ever needs to
-- seed a Tenant itself), and this dev-only seed must never be mistaken
-- for, reused by, or treated as precedent for the still-to-be-designed
-- real production bootstrap workflow. That workflow is real, operator-
-- invoked, and produces real organizational data; this file produces
-- neither.
--
-- Every value below is deliberately, unmistakably synthetic. The Tenant
-- UUID is an all-zeros placeholder pattern that can never collide with a
-- real production UUID -- including FCOC's canonical
-- 16c39847-ce1d-43c3-b9bc-75f33e16d711, which this file never references
-- and never reuses. The organization identity is explicitly labeled
-- "Development," and the only hostname mapped is `localhost`.
--
-- No Event, Person, Relationship, Participation, Platform Administrator,
-- or identity-evidence row is created here. No administrator row is
-- created either: local development and Tenant-resolution testing do not
-- require one. Admin routes are a separate, already-gated concern, and an
-- `admin_users` row with no real or synthetic `auth.users` account behind
-- it would be inert for actual sign-in testing while adding data this seed
-- does not need for its stated purpose. A working local admin session, if
-- ever needed, is a separately scoped addition -- not an implicit
-- requirement of Tenant bootstrap.
--
-- Idempotent by design: safe on the normal path (a fresh `db reset` always
-- starts from an empty database) and equally safe if ever re-run against
-- an already-seeded local database, since every insert is conflict-guarded
-- on its natural unique key and changes nothing when the row already
-- exists.

INSERT INTO public.tenants (
  id,
  organization_code,
  slug,
  organization_name,
  display_name,
  app_title,
  app_tagline,
  is_active
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'DEV',
  'epicentrax-dev',
  'EpicentraX Development',
  'EpicentraX Development',
  'EpicentraX (Dev)',
  'Synthetic local development Tenant -- not a real organization.',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_hostname_mappings (
  hostname,
  tenant_id,
  is_active
)
VALUES (
  'localhost',
  '00000000-0000-0000-0000-000000000001',
  true
)
ON CONFLICT (hostname) DO NOTHING;
