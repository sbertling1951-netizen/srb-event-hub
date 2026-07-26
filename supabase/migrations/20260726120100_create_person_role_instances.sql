CREATE TABLE IF NOT EXISTS public.person_role_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  identity_role text NOT NULL CHECK (identity_role IN ('PILOT', 'HOUSEHOLD_MEMBER')),
  household_member_id uuid REFERENCES public.attendee_household_members(id) ON DELETE CASCADE,
  source_table text NOT NULL,
  source_record_id uuid NOT NULL,
  attribution_method text NOT NULL CHECK (attribution_method IN ('automatic_backfill')),
  evidence_source text NOT NULL,
  source_manifest_version text,
  source_role_instance_key text NOT NULL,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_role_instances_source_role_instance_key_unique UNIQUE (source_role_instance_key),
  CONSTRAINT person_role_instances_source_unique UNIQUE (source_table, source_record_id),
  CONSTRAINT person_role_instances_role_source_consistency CHECK (
    (identity_role = 'PILOT'
      AND household_member_id IS NULL
      AND source_table = 'public.attendees'
      AND source_record_id = attendee_id)
    OR
    (identity_role = 'HOUSEHOLD_MEMBER'
      AND household_member_id IS NOT NULL
      AND source_table = 'public.attendee_household_members'
      AND source_record_id = household_member_id)
  )
);

CREATE INDEX IF NOT EXISTS person_role_instances_person_id_idx
  ON public.person_role_instances (person_id);

CREATE INDEX IF NOT EXISTS person_role_instances_tenant_id_idx
  ON public.person_role_instances (tenant_id);

CREATE INDEX IF NOT EXISTS person_role_instances_event_id_idx
  ON public.person_role_instances (event_id);

CREATE INDEX IF NOT EXISTS person_role_instances_attendee_id_idx
  ON public.person_role_instances (attendee_id);

CREATE INDEX IF NOT EXISTS person_role_instances_household_member_id_idx
  ON public.person_role_instances (household_member_id);

CREATE INDEX IF NOT EXISTS person_role_instances_role_idx
  ON public.person_role_instances (identity_role);

CREATE INDEX IF NOT EXISTS person_role_instances_attribution_method_idx
  ON public.person_role_instances (attribution_method);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_person_role_instances_updated_at'
      AND tgrelid = 'public.person_role_instances'::regclass
  ) THEN
    CREATE TRIGGER set_person_role_instances_updated_at
      BEFORE UPDATE ON public.person_role_instances
      FOR EACH ROW
      EXECUTE FUNCTION public.set_identity_updated_at();
  END IF;
END
$$;

ALTER TABLE public.person_role_instances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_role_instances'
      AND policyname = 'deny_all_anonymous_person_role_instances'
  ) THEN
    CREATE POLICY deny_all_anonymous_person_role_instances
      ON public.person_role_instances
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'person_role_instances'
      AND policyname = 'deny_all_authenticated_person_role_instances'
  ) THEN
    CREATE POLICY deny_all_authenticated_person_role_instances
      ON public.person_role_instances
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;
