-- Provenance foundation + governed executor for the approved initial
-- 12-assignment task-authority materialization
-- (version 20260811-approved-12-assignment-v1).
--
-- Schema-only in this migration: adds provenance columns, an immutable
-- materialization ledger, and one narrow, server-only executor function.
-- Nothing is materialized here -- the executor is defined but not invoked.
-- Invocation happens in the next migration, so the two can be reviewed and
-- validated independently before any production grant is written.

BEGIN;

-- ---------------------------------------------------------------------
-- Grant provenance: which materialization run (if any) produced a given
-- explicit task grant. NULL for grants created through the ordinary
-- per-user governed RPCs (create_event_authority_assignment,
-- grant_event_authority_task, change_event_authority_profile) -- this
-- column exists only to answer "was this row produced by the approved
-- historical bulk materialization, and which version."
-- ---------------------------------------------------------------------
ALTER TABLE public.admin_event_permissions
  ADD COLUMN materialization_version text;

-- ---------------------------------------------------------------------
-- Audit provenance: same purpose, on the existing immutable audit table.
-- A dedicated column, consistent with the table's existing design (typed
-- columns for structured facts, jsonb reserved for state snapshots).
-- ---------------------------------------------------------------------
ALTER TABLE public.admin_authority_audit
  ADD COLUMN materialization_version text;

-- ---------------------------------------------------------------------
-- Materialization ledger: one immutable row per (assignment_id,
-- materialization_version) that a materialization run has completed.
-- Provenance only -- no function in this foundation reads this table to
-- make an authority decision; resolve_task_authority is unaffected and
-- unchanged. No FK to admin_event_access(id), deliberately matching
-- admin_authority_audit's own existing design: a ledger entry is a
-- historical fact about a materialization event and must survive even if
-- the referenced assignment is later removed by a governed RPC.
-- ---------------------------------------------------------------------
CREATE TABLE public.admin_authority_materialization_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  materialization_version text NOT NULL,
  canonical_profile text NOT NULL,
  bundle_digest text NOT NULL,
  evidence_classification text NOT NULL,
  materialized_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  completion_audit_id uuid,
  CONSTRAINT admin_authority_materialization_ledger_unique UNIQUE (assignment_id, materialization_version)
);

CREATE INDEX admin_authority_materialization_ledger_assignment_idx
  ON public.admin_authority_materialization_ledger (assignment_id);

CREATE OR REPLACE FUNCTION public.prevent_admin_authority_materialization_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
BEGIN
  RAISE EXCEPTION 'admin_authority_materialization_ledger is immutable';
END $$;

CREATE TRIGGER prevent_admin_authority_materialization_ledger_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.admin_authority_materialization_ledger
  FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_authority_materialization_ledger_mutation();

ALTER TABLE public.admin_authority_materialization_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_authority_materialization_ledger FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- The governed executor. Server-only: the entire approved manifest
-- (assignment IDs, profiles, Bundle E, Bundle C, version string) is
-- hardcoded in the function body, not accepted as a parameter -- there is
-- no input surface through which a caller could supply a different
-- manifest. EXECUTE is granted to no role at all (not even
-- authenticated); it is invoked exactly once, directly from within a
-- migration, by the migration's own elevated (postgres) connection. This
-- is "server-only/database-governed" in the strict sense: it is not part
-- of the live application's callable RPC surface.
--
-- Idempotent: if all 12 assignments already carry a completed ledger row
-- for this exact version, returns the current state as a no-op rather
-- than re-materializing. Any partial/conflicting/drifted state aborts the
-- whole transaction (RAISE EXCEPTION), never repairs silently.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.materialize_approved_event_authority_20260811_v1()
RETURNS TABLE(assignment_id uuid, profile_key text, tasks_granted integer)
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_version text := '20260811-approved-12-assignment-v1';
  v_manifest jsonb := '[
    {"assignment_id":"3aad9c51-5793-46f9-b16f-24a12b286dec","profile":"event_admin"},
    {"assignment_id":"4029777a-9ce6-4971-9037-25f4eb5049eb","profile":"event_admin"},
    {"assignment_id":"46eb87bc-db81-47c2-9ca5-305e909950c4","profile":"event_admin"},
    {"assignment_id":"534d292f-4afe-4289-8b68-134cb4d13c5b","profile":"event_admin"},
    {"assignment_id":"5e7cf2c3-604e-418c-bf0d-a0cbc201f05a","profile":"event_admin"},
    {"assignment_id":"6013114a-6d92-495c-900d-42d3d189217c","profile":"event_admin"},
    {"assignment_id":"71f5541e-3432-41c0-8662-c0f016469d09","profile":"event_admin"},
    {"assignment_id":"7820f919-98a1-4a0e-b444-297bdf3579ee","profile":"event_admin"},
    {"assignment_id":"7866bcfc-237d-4139-b334-806fa21aaa69","profile":"checkin"},
    {"assignment_id":"89383c3b-2a1e-4e22-97ea-df7578c46686","profile":"event_admin"},
    {"assignment_id":"da8e79b7-180c-43dd-8822-0786d5594770","profile":"event_admin"},
    {"assignment_id":"f4b98e61-c506-498e-81bd-3915c22c671f","profile":"event_admin"}
  ]'::jsonb;
  v_bundle_e text[] := ARRAY[
    'event.workspace.view','event.definition.manage','event.agenda.view','event.agenda.manage',
    'event.announcements.view','event.announcements.manage','event.attendees.view','event.attendees.manage',
    'event.checkin.view','event.checkin.manage','event.parking.view','event.parking.manage',
    'event.imports.view','event.imports.manage','event.locations.view','event.locations.manage',
    'event.nearby.view','event.nearby.manage','event.print.view','event.print.manage',
    'event.reports.view','event.reports.export','event.vendors.view','event.vendors.manage'
  ];
  v_bundle_c text[] := ARRAY[
    'event.workspace.view','event.attendees.view','event.attendees.manage',
    'event.checkin.view','event.checkin.manage'
  ];
  v_item jsonb;
  v_aid uuid;
  v_profile text;
  v_bundle text[];
  v_task text;
  v_correlation uuid := gen_random_uuid();
  v_expected_ids uuid[];
  v_actual_ids uuid[];
  v_ledger_existing int;
  v_ledger_this_version int;
  v_grants_existing int;
  v_old_role text;
  v_tenant uuid;
  v_target_admin uuid;
  v_target_active boolean;
  v_event_id uuid;
  v_bundle_audit_id uuid;
  v_total_grants int;
BEGIN
  -- Defense in depth beyond the missing EXECUTE grant: this operation may
  -- only run as the migration/owner connection, never as an application
  -- role, even if a future grant were mistakenly added.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'materialize_approved_event_authority_20260811_v1 may only run as the migration owner role';
  END IF;

  SELECT array_agg((v->>'assignment_id')::uuid ORDER BY (v->>'assignment_id')::uuid)
    INTO v_expected_ids
  FROM jsonb_array_elements(v_manifest) v;

  IF array_length(v_expected_ids, 1) <> 12 THEN
    RAISE EXCEPTION 'approved manifest does not contain exactly 12 assignments';
  END IF;

  -- Lock all 12 target rows, in deterministic UUID order, before any
  -- further check -- re-run every preflight assertion after locks are
  -- acquired, not before.
  SELECT array_agg(id ORDER BY id) INTO v_actual_ids
  FROM public.admin_event_access
  WHERE id = ANY(v_expected_ids)
  FOR UPDATE;

  IF v_actual_ids IS DISTINCT FROM v_expected_ids THEN
    RAISE EXCEPTION 'live admin_event_access does not contain exactly the approved 12 assignment IDs';
  END IF;

  -- Bundle drift check against the live profile-task catalog.
  IF (SELECT array_agg(task_key ORDER BY task_key) FROM public.admin_event_profile_tasks WHERE profile_key = 'event_admin')
     IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_bundle_e) x) THEN
    RAISE EXCEPTION 'event_admin profile-task bundle has drifted from the approved Bundle E definition';
  END IF;
  IF (SELECT array_agg(task_key ORDER BY task_key) FROM public.admin_event_profile_tasks WHERE profile_key = 'checkin')
     IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_bundle_c) x) THEN
    RAISE EXCEPTION 'checkin profile-task bundle has drifted from the approved Bundle C definition';
  END IF;

  -- Idempotence contract.
  SELECT count(*) INTO v_ledger_existing
  FROM public.admin_authority_materialization_ledger
  WHERE assignment_id = ANY(v_expected_ids);

  IF v_ledger_existing = 12 THEN
    SELECT count(*) INTO v_ledger_this_version
    FROM public.admin_authority_materialization_ledger
    WHERE assignment_id = ANY(v_expected_ids) AND materialization_version = v_version;

    IF v_ledger_this_version <> 12 THEN
      RAISE EXCEPTION 'conflicting materialization version already recorded for one or more approved assignments -- ABORT';
    END IF;

    -- Exact completed state for this version already exists: successful no-op.
    RETURN QUERY
    SELECT l.assignment_id, l.canonical_profile,
      (SELECT count(*)::int FROM public.admin_event_permissions p WHERE p.admin_event_access_id = l.assignment_id AND p.is_enabled)
    FROM public.admin_authority_materialization_ledger l
    WHERE l.assignment_id = ANY(v_expected_ids)
    ORDER BY l.assignment_id;
    RETURN;
  ELSIF v_ledger_existing > 0 THEN
    RAISE EXCEPTION 'partial materialization ledger state detected (% of 12) -- ABORT, no silent repair', v_ledger_existing;
  END IF;

  SELECT count(*) INTO v_grants_existing
  FROM public.admin_event_permissions p
  WHERE p.admin_event_access_id = ANY(v_expected_ids);

  IF v_grants_existing > 0 THEN
    RAISE EXCEPTION 'existing explicit grants already present for one or more approved assignments -- ABORT (possible manual grant)';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_manifest) ORDER BY (value->>'assignment_id') LOOP
    v_aid := (v_item->>'assignment_id')::uuid;
    v_profile := v_item->>'profile';

    SELECT admin_user_id, event_id, role INTO v_target_admin, v_event_id, v_old_role
    FROM public.admin_event_access WHERE id = v_aid;

    SELECT is_active INTO v_target_active FROM public.admin_users WHERE id = v_target_admin;
    IF v_target_active IS NOT TRUE THEN
      RAISE EXCEPTION 'target admin for assignment % is not active -- ABORT', v_aid;
    END IF;

    SELECT tenant_id INTO v_tenant FROM public.events WHERE id = v_event_id;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'event for assignment % has no resolvable tenant -- ABORT', v_aid;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.admin_event_profiles WHERE profile_key = v_profile AND is_active) THEN
      RAISE EXCEPTION 'approved profile % is not active/known -- ABORT', v_profile;
    END IF;

    v_bundle := CASE v_profile WHEN 'event_admin' THEN v_bundle_e WHEN 'checkin' THEN v_bundle_c ELSE NULL END;
    IF v_bundle IS NULL THEN
      RAISE EXCEPTION 'unexpected profile % in approved manifest -- ABORT', v_profile;
    END IF;
    IF v_bundle && ARRAY['event.validation_rules.manage'] THEN
      RAISE EXCEPTION 'approved bundle unexpectedly includes the excluded validation-rules task -- ABORT';
    END IF;

    -- Stage 7: A1's descriptive-profile correction, in the same
    -- transaction as its five grants, with structured provenance.
    IF v_profile IS DISTINCT FROM v_old_role THEN
      UPDATE public.admin_event_access SET role = v_profile WHERE id = v_aid;

      INSERT INTO public.admin_authority_audit(
        correlation_id, actor_auth_user_id, actor_admin_user_id, target_admin_user_id,
        tenant_id, event_id, admin_event_access_id, profile_before, profile_after,
        action, previous_state, new_state, reason, materialization_version
      ) VALUES (
        v_correlation, NULL, NULL, v_target_admin,
        v_tenant, v_event_id, v_aid, v_old_role, v_profile,
        'profile_changed', jsonb_build_object('profile_key', v_old_role), jsonb_build_object('profile_key', v_profile),
        'approved legacy-role coercion correction', v_version
      );

      INSERT INTO public.admin_authority_audit(
        correlation_id, actor_auth_user_id, actor_admin_user_id, target_admin_user_id,
        tenant_id, event_id, admin_event_access_id, profile_before, profile_after,
        action, new_state, reason, materialization_version
      ) VALUES (
        v_correlation, NULL, NULL, v_target_admin,
        v_tenant, v_event_id, v_aid, v_old_role, v_profile,
        'defaults_reset', jsonb_build_object('final_task_keys', v_bundle),
        'approved legacy-role coercion correction', v_version
      );
    END IF;

    FOREACH v_task IN ARRAY v_bundle LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.admin_task_registry
        WHERE task_key = v_task AND is_active AND scope = 'event' AND event_assignment_grantable
      ) THEN
        RAISE EXCEPTION 'task % is not active/Event-grantable -- ABORT', v_task;
      END IF;

      INSERT INTO public.admin_event_permissions(
        admin_event_access_id, permission_key, granted_by_admin_user_id,
        grant_source, source_profile_key, materialization_version
      ) VALUES (
        v_aid, v_task, NULL, 'profile_materialization', v_profile, v_version
      );

      INSERT INTO public.admin_authority_audit(
        correlation_id, actor_auth_user_id, actor_admin_user_id, target_admin_user_id,
        tenant_id, event_id, admin_event_access_id, task_key, profile_after,
        action, new_state, reason, materialization_version
      ) VALUES (
        v_correlation, NULL, NULL, v_target_admin,
        v_tenant, v_event_id, v_aid, v_task, v_profile,
        'task_granted', jsonb_build_object('source', 'profile_materialization'),
        'initial governed materialization', v_version
      );
    END LOOP;

    INSERT INTO public.admin_authority_audit(
      correlation_id, actor_auth_user_id, actor_admin_user_id, target_admin_user_id,
      tenant_id, event_id, admin_event_access_id, profile_after,
      action, new_state, reason, materialization_version
    ) VALUES (
      v_correlation, NULL, NULL, v_target_admin,
      v_tenant, v_event_id, v_aid, v_profile,
      'bundle_materialized', jsonb_build_object('profile_key', v_profile, 'task_count', array_length(v_bundle, 1)),
      'initial governed materialization', v_version
    ) RETURNING id INTO v_bundle_audit_id;

    INSERT INTO public.admin_authority_materialization_ledger(
      assignment_id, materialization_version, canonical_profile, bundle_digest,
      evidence_classification, correlation_id, completion_audit_id
    ) VALUES (
      v_aid, v_version, v_profile, md5(array_to_string(v_bundle, ',')),
      CASE WHEN v_profile IS DISTINCT FROM v_old_role THEN 'approved_legacy_role_coercion_correction' ELSE 'approved_manifest_default' END,
      v_correlation, v_bundle_audit_id
    );

    RETURN QUERY SELECT v_aid, v_profile, array_length(v_bundle, 1);
  END LOOP;

  SELECT count(*) INTO v_total_grants
  FROM public.admin_event_permissions
  WHERE admin_event_access_id = ANY(v_expected_ids);

  IF v_total_grants <> 269 THEN
    RAISE EXCEPTION 'post-materialization grant count % does not equal expected 269 -- ABORT', v_total_grants;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_approved_event_authority_20260811_v1() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
