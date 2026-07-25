CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_identity_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  display_first_name text,
  display_last_name text,
  preferred_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'inactive')),
  merged_into_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_no_self_merge CHECK (merged_into_person_id IS NULL OR merged_into_person_id <> id),
  CONSTRAINT people_merged_requires_target CHECK (
    (status = 'merged' AND merged_into_person_id IS NOT NULL)
    OR (status <> 'merged' AND merged_into_person_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.person_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  identifier_type text NOT NULL CHECK (
    identifier_type IN (
      'email',
      'phone',
      'membership_number',
      'external_member_id',
      'legacy_user_id',
      'other'
    )
  ),
  identifier_value text NOT NULL CHECK (length(trim(identifier_value)) > 0),
  normalized_value text NOT NULL CHECK (length(trim(normalized_value)) > 0),
  source_type text NOT NULL CHECK (
    source_type IN (
      'attendee_import',
      'attendee_record',
      'authentication',
      'member_confirmation',
      'administrator',
      'invitation',
      'legacy_system',
      'other'
    )
  ),
  source_record_id uuid,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN (
      'unverified',
      'observed',
      'user_confirmed',
      'system_verified',
      'disputed',
      'retired'
    )
  ),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  is_current boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.person_auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'disputed')),
  is_primary boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_auth_accounts_retired_requires_date CHECK (
    (status = 'retired' AND retired_at IS NOT NULL) OR (status <> 'retired')
  )
);

CREATE TABLE IF NOT EXISTS public.identity_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surviving_person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  merged_person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  merge_status text NOT NULL DEFAULT 'proposed' CHECK (
    merge_status IN ('proposed', 'approved', 'completed', 'rejected', 'reversed')
  ),
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_relationships jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiated_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_merge_audit_distinct_people CHECK (surviving_person_id <> merged_person_id)
);

ALTER TABLE public.people
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.person_identifiers
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.person_auth_accounts
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.identity_merge_audit
  ALTER COLUMN updated_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS people_tenant_id_idx ON public.people (tenant_id);
CREATE INDEX IF NOT EXISTS people_merged_into_person_id_idx ON public.people (merged_into_person_id);
CREATE INDEX IF NOT EXISTS people_status_idx ON public.people (status);

CREATE INDEX IF NOT EXISTS person_identifiers_person_id_idx ON public.person_identifiers (person_id);
CREATE INDEX IF NOT EXISTS person_identifiers_tenant_id_idx ON public.person_identifiers (tenant_id);
CREATE INDEX IF NOT EXISTS person_identifiers_identifier_type_idx ON public.person_identifiers (identifier_type);
CREATE INDEX IF NOT EXISTS person_identifiers_normalized_value_idx ON public.person_identifiers (normalized_value);
CREATE INDEX IF NOT EXISTS person_identifiers_verification_status_idx ON public.person_identifiers (verification_status);
CREATE INDEX IF NOT EXISTS person_identifiers_source_record_id_idx ON public.person_identifiers (source_record_id);
CREATE INDEX IF NOT EXISTS person_identifiers_tenant_type_normalized_idx
  ON public.person_identifiers (tenant_id, identifier_type, normalized_value);

CREATE INDEX IF NOT EXISTS person_auth_accounts_person_id_idx ON public.person_auth_accounts (person_id);
CREATE INDEX IF NOT EXISTS person_auth_accounts_auth_user_id_idx ON public.person_auth_accounts (auth_user_id);
CREATE INDEX IF NOT EXISTS person_auth_accounts_status_idx ON public.person_auth_accounts (status);
CREATE UNIQUE INDEX IF NOT EXISTS person_auth_accounts_unique_auth_user_id_idx
  ON public.person_auth_accounts (auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS person_auth_accounts_active_primary_person_idx
  ON public.person_auth_accounts (person_id)
  WHERE is_primary = true AND status = 'active';

CREATE INDEX IF NOT EXISTS identity_merge_audit_surviving_person_id_idx ON public.identity_merge_audit (surviving_person_id);
CREATE INDEX IF NOT EXISTS identity_merge_audit_merged_person_id_idx ON public.identity_merge_audit (merged_person_id);
CREATE INDEX IF NOT EXISTS identity_merge_audit_merge_status_idx ON public.identity_merge_audit (merge_status);
CREATE INDEX IF NOT EXISTS identity_merge_audit_proposed_at_idx ON public.identity_merge_audit (proposed_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_people_updated_at'
      AND tgrelid = 'public.people'::regclass
  ) THEN
    CREATE TRIGGER set_people_updated_at
      BEFORE UPDATE ON public.people
      FOR EACH ROW
      EXECUTE FUNCTION public.set_identity_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_person_identifiers_updated_at'
      AND tgrelid = 'public.person_identifiers'::regclass
  ) THEN
    CREATE TRIGGER set_person_identifiers_updated_at
      BEFORE UPDATE ON public.person_identifiers
      FOR EACH ROW
      EXECUTE FUNCTION public.set_identity_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_person_auth_accounts_updated_at'
      AND tgrelid = 'public.person_auth_accounts'::regclass
  ) THEN
    CREATE TRIGGER set_person_auth_accounts_updated_at
      BEFORE UPDATE ON public.person_auth_accounts
      FOR EACH ROW
      EXECUTE FUNCTION public.set_identity_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_identity_merge_audit_updated_at'
      AND tgrelid = 'public.identity_merge_audit'::regclass
  ) THEN
    CREATE TRIGGER set_identity_merge_audit_updated_at
      BEFORE UPDATE ON public.identity_merge_audit
      FOR EACH ROW
      EXECUTE FUNCTION public.set_identity_updated_at();
  END IF;
END $$;

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_auth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_merge_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'people'
      AND policyname = 'deny_all_anonymous_people'
  ) THEN
    CREATE POLICY deny_all_anonymous_people
      ON public.people
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'people'
      AND policyname = 'deny_all_authenticated_people'
  ) THEN
    CREATE POLICY deny_all_authenticated_people
      ON public.people
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_identifiers'
      AND policyname = 'deny_all_anonymous_person_identifiers'
  ) THEN
    CREATE POLICY deny_all_anonymous_person_identifiers
      ON public.person_identifiers
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_identifiers'
      AND policyname = 'deny_all_authenticated_person_identifiers'
  ) THEN
    CREATE POLICY deny_all_authenticated_person_identifiers
      ON public.person_identifiers
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_auth_accounts'
      AND policyname = 'deny_all_anonymous_person_auth_accounts'
  ) THEN
    CREATE POLICY deny_all_anonymous_person_auth_accounts
      ON public.person_auth_accounts
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_auth_accounts'
      AND policyname = 'deny_all_authenticated_person_auth_accounts'
  ) THEN
    CREATE POLICY deny_all_authenticated_person_auth_accounts
      ON public.person_auth_accounts
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_merge_audit'
      AND policyname = 'deny_all_anonymous_identity_merge_audit'
  ) THEN
    CREATE POLICY deny_all_anonymous_identity_merge_audit
      ON public.identity_merge_audit
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'identity_merge_audit'
      AND policyname = 'deny_all_authenticated_identity_merge_audit'
  ) THEN
    CREATE POLICY deny_all_authenticated_identity_merge_audit
      ON public.identity_merge_audit
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

ALTER TABLE public.attendees
  ADD COLUMN IF NOT EXISTS person_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendees_person_id_fkey'
  ) THEN
    ALTER TABLE public.attendees
      ADD CONSTRAINT attendees_person_id_fkey
      FOREIGN KEY (person_id) REFERENCES public.people(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS attendees_person_id_idx ON public.attendees (person_id);
