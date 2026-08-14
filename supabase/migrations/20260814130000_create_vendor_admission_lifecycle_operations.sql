-- Vendor Admission Lifecycle -- Stage 2: Governed Operations.
--
-- Implements the SECURITY DEFINER RPC boundary for the Event admission
-- lifecycle over Stage 1's schema (20260814090000/100000/110000/120000).
-- No RLS policy, table grant, or Admin UI is touched here; the legacy
-- direct-write paths on event_vendors (is_active_admin-gated) are
-- deliberately left untouched -- Stage 3's job, only after this governed
-- replacement is proven. See this migration's own report for the
-- complete inventory of what Stage 3 must retire.
--
-- Canonical authority, exclusively: has_event_task_authority(task_key,
-- event_id) / resolve_task_authority(uid, task_key, event_id), against
-- the already-registered 'event.vendors.manage' (mutation) and
-- 'event.vendors.view' (read) tasks. Neither is_active_admin() nor
-- has_vendor_catalog_admin_authority() appears anywhere below --
-- catalog-CRUD authority and Event admission authority remain separate
-- questions, exactly as the prior reconciliation established. Every
-- authority_basis value stamped onto a disposition/admission comes
-- directly from resolve_task_authority's own decision_branch output
-- ('platform'/'tenant'/'event_grant') -- never accepted as a caller
-- parameter, and never 'backfill' (that value is reserved for the
-- Stage 1 migration-only backfill, which never runs through these RPCs).
--
-- Concurrency: every mutation RPC locks the relevant existing row (the
-- candidacy and/or event_vendors roster row) with SELECT ... FOR UPDATE
-- before reading or changing its current state -- the same idiom already
-- used throughout this repository for exactly this purpose (vendor
-- invitation activation, member checkin, magic-link activation; grep
-- FOR UPDATE across supabase/migrations for precedent). Candidacy
-- creation additionally uses INSERT ... ON CONFLICT (vendor_id, event_id)
-- DO NOTHING against the Stage 1 unique constraint, which is atomic
-- under Postgres MVCC regardless of locking -- two simultaneous
-- registration calls can never produce two candidacy rows. No
-- caller-supplied idempotency key is introduced: this repository has no
-- established convention of caller-supplied idempotency keys for
-- admin-authored governed mutations (the one idempotency_key column
-- found elsewhere, site_placement_history.idempotency_key, is an
-- audit-trail field, not a caller-supplied dedup token for this class of
-- operation), and row-locking plus unique constraints already make
-- every mutation below deterministic without one.
--
-- Idempotency policy for admit/reject/revoke, applied consistently: each
-- locks the relevant row, and if the requested transition already
-- matches the current state, returns an 'already_X' outcome with zero
-- new disposition row -- never silently succeeding without having
-- checked, and never spamming duplicate dispositions for a repeated
-- click/retry of the same decision. A genuinely different decision
-- (e.g. re-admitting after a revocation) always produces a fresh,
-- immutable disposition.

BEGIN;

-- ============================================================
-- 1. register_vendor_event_candidacy -- admin-authored candidacy only.
-- Requires event.vendors.manage. Never admits. Idempotent: a second call
-- for the same (vendor_id, event_id) returns the existing row rather
-- than erroring or duplicating (the unique constraint makes this atomic
-- under concurrency).
--
-- Vendor self-registration audit (not implemented, not modified here):
-- register_vendor_self (20260805120000) creates only the catalog
-- identity (public.vendors) and the registering person's own portal
-- access (vendor_org_access) -- it takes no Event parameter and creates
-- no candidacy today. A future vendor-self-facing candidacy path would
-- need its own RPC, authorized by the caller's own active
-- vendor_org_access for that vendor (not admin task authority), and is
-- explicitly out of scope for this stage.
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_vendor_event_candidacy(
  p_vendor_id uuid,
  p_event_id uuid
)
RETURNS TABLE(
  outcome text,
  application_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
  v_admin_user_id uuid;
  v_authorized boolean;
  v_new_id uuid;
  v_new_status text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_vendor_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id) THEN
    RAISE EXCEPTION 'vendor_not_found' USING ERRCODE = '22023';
  END IF;

  v_authorized := public.has_event_task_authority('event.vendors.manage', p_event_id);
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_user_id FROM public.admin_users WHERE user_id = v_uid AND is_active = true;

  INSERT INTO public.vendor_event_applications
    (vendor_id, event_id, status, submitted_by_auth_user_id, submitted_by_admin_user_id)
  VALUES
    (p_vendor_id, p_event_id, 'pending', v_uid, v_admin_user_id)
  ON CONFLICT (vendor_id, event_id) DO NOTHING
  RETURNING vendor_event_applications.id, vendor_event_applications.status INTO v_new_id, v_new_status;

  IF v_new_id IS NOT NULL THEN
    outcome := 'created';
    application_id := v_new_id;
    status := v_new_status;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT a.id, a.status INTO v_new_id, v_new_status
  FROM public.vendor_event_applications AS a
  WHERE a.vendor_id = p_vendor_id AND a.event_id = p_event_id;

  outcome := 'already_exists';
  application_id := v_new_id;
  status := v_new_status;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.register_vendor_event_candidacy(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_vendor_event_candidacy(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_vendor_event_candidacy(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.register_vendor_event_candidacy(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.register_vendor_event_candidacy(uuid, uuid) TO authenticated;

-- ============================================================
-- 2. admit_vendor_for_event -- atomic. Gets-or-creates the candidacy (so
-- an admin can admit a known catalog vendor for a new Event directly,
-- without a separate registration step), locks any existing roster row,
-- and either creates or reactivates it. Idempotent if already admitted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admit_vendor_for_event(
  p_vendor_id uuid,
  p_event_id uuid
)
RETURNS TABLE(
  outcome text,
  event_vendor_id uuid,
  application_id uuid,
  disposition_id uuid,
  admission_state text,
  authority_basis text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
  v_admin_user_id uuid;
  v_authority RECORD;
  v_application_id uuid;
  v_event_vendor_id uuid;
  v_current_admission_state text;
  v_current_disposition_id uuid;
  v_disposition_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_vendor_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id) THEN
    RAISE EXCEPTION 'vendor_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_authority FROM public.resolve_task_authority(v_uid, 'event.vendors.manage', p_event_id);
  IF NOT v_authority.allowed THEN
    RAISE EXCEPTION 'not_authorized: %', coalesce(v_authority.denial_reason, 'denied') USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_user_id FROM public.admin_users WHERE user_id = v_uid AND is_active = true;

  INSERT INTO public.vendor_event_applications
    (vendor_id, event_id, status, submitted_by_auth_user_id, submitted_by_admin_user_id)
  VALUES
    (p_vendor_id, p_event_id, 'pending', v_uid, v_admin_user_id)
  ON CONFLICT (vendor_id, event_id) DO NOTHING
  RETURNING id INTO v_application_id;

  IF v_application_id IS NULL THEN
    SELECT a.id INTO v_application_id
    FROM public.vendor_event_applications AS a
    WHERE a.vendor_id = p_vendor_id AND a.event_id = p_event_id;
  END IF;

  SELECT ev.id, ev.admission_state, ev.current_disposition_id
    INTO v_event_vendor_id, v_current_admission_state, v_current_disposition_id
  FROM public.event_vendors AS ev
  WHERE ev.vendor_id = p_vendor_id AND ev.event_id = p_event_id
  FOR UPDATE;

  IF v_event_vendor_id IS NOT NULL AND v_current_admission_state = 'admitted' THEN
    outcome := 'already_admitted';
    event_vendor_id := v_event_vendor_id;
    application_id := v_application_id;
    disposition_id := v_current_disposition_id;
    admission_state := v_current_admission_state;
    authority_basis := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.vendor_event_dispositions
    (vendor_id, application_id, event_id, decision_type, authority_basis, actor_auth_user_id, actor_admin_user_id)
  VALUES
    (p_vendor_id, v_application_id, p_event_id, 'admitted', v_authority.decision_branch, v_uid, v_admin_user_id)
  RETURNING id INTO v_disposition_id;

  IF v_event_vendor_id IS NULL THEN
    INSERT INTO public.event_vendors
      (event_id, vendor_id, application_id, admission_state, admitted_at,
       admitted_by_auth_user_id, admitted_by_admin_user_id, admission_authority_basis, current_disposition_id)
    VALUES
      (p_event_id, p_vendor_id, v_application_id, 'admitted', now(),
       v_uid, v_admin_user_id, v_authority.decision_branch, v_disposition_id)
    RETURNING id INTO v_event_vendor_id;
  ELSE
    UPDATE public.event_vendors
    SET admission_state = 'admitted',
        admitted_at = now(),
        admitted_by_auth_user_id = v_uid,
        admitted_by_admin_user_id = v_admin_user_id,
        admission_authority_basis = v_authority.decision_branch,
        application_id = v_application_id,
        current_disposition_id = v_disposition_id
    WHERE id = v_event_vendor_id;
  END IF;

  outcome := 'admitted';
  event_vendor_id := v_event_vendor_id;
  application_id := v_application_id;
  disposition_id := v_disposition_id;
  admission_state := 'admitted';
  authority_basis := v_authority.decision_branch;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.admit_vendor_for_event(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admit_vendor_for_event(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_vendor_for_event(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admit_vendor_for_event(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admit_vendor_for_event(uuid, uuid) TO authenticated;

-- ============================================================
-- 3. reject_vendor_event_candidacy -- structured reason required. Never
-- touches event_vendors, never touches vendors.is_active. Refuses to
-- reject a candidacy that already has an active admission (use revoke
-- instead) to prevent a contradictory application='rejected' +
-- event_vendors='admitted' state.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_vendor_event_candidacy(
  p_vendor_id uuid,
  p_event_id uuid,
  p_reason_code text,
  p_reason_text text DEFAULT NULL
)
RETURNS TABLE(
  outcome text,
  application_id uuid,
  disposition_id uuid,
  status text,
  authority_basis text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
  v_admin_user_id uuid;
  v_authority RECORD;
  v_application_id uuid;
  v_current_status text;
  v_current_disposition_id uuid;
  v_disposition_id uuid;
  v_has_active_admission boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_vendor_id IS NULL OR p_event_id IS NULL OR p_reason_code IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = p_vendor_id) THEN
    RAISE EXCEPTION 'vendor_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_disposition_reason_codes
    WHERE code = p_reason_code AND is_active = true
  ) THEN
    RAISE EXCEPTION 'invalid_reason_code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_authority FROM public.resolve_task_authority(v_uid, 'event.vendors.manage', p_event_id);
  IF NOT v_authority.allowed THEN
    RAISE EXCEPTION 'not_authorized: %', coalesce(v_authority.denial_reason, 'denied') USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_user_id FROM public.admin_users WHERE user_id = v_uid AND is_active = true;

  INSERT INTO public.vendor_event_applications
    (vendor_id, event_id, status, submitted_by_auth_user_id, submitted_by_admin_user_id)
  VALUES
    (p_vendor_id, p_event_id, 'pending', v_uid, v_admin_user_id)
  ON CONFLICT (vendor_id, event_id) DO NOTHING
  RETURNING id INTO v_application_id;

  IF v_application_id IS NULL THEN
    SELECT a.id INTO v_application_id
    FROM public.vendor_event_applications AS a
    WHERE a.vendor_id = p_vendor_id AND a.event_id = p_event_id;
  END IF;

  SELECT a.status, a.current_disposition_id INTO v_current_status, v_current_disposition_id
  FROM public.vendor_event_applications AS a
  WHERE a.id = v_application_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.event_vendors ev
    WHERE ev.vendor_id = p_vendor_id AND ev.event_id = p_event_id AND ev.admission_state = 'admitted'
  ) INTO v_has_active_admission;

  IF v_has_active_admission THEN
    RAISE EXCEPTION 'cannot_reject_active_admission_use_revoke' USING ERRCODE = '55000';
  END IF;

  IF v_current_status = 'rejected' THEN
    outcome := 'already_rejected';
    application_id := v_application_id;
    disposition_id := v_current_disposition_id;
    status := v_current_status;
    authority_basis := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.vendor_event_dispositions
    (vendor_id, application_id, event_id, decision_type, reason_code, reason_text, authority_basis, actor_auth_user_id, actor_admin_user_id)
  VALUES
    (p_vendor_id, v_application_id, p_event_id, 'rejected', p_reason_code, p_reason_text, v_authority.decision_branch, v_uid, v_admin_user_id)
  RETURNING id INTO v_disposition_id;

  outcome := 'rejected';
  application_id := v_application_id;
  disposition_id := v_disposition_id;
  status := 'rejected';
  authority_basis := v_authority.decision_branch;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.reject_vendor_event_candidacy(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_vendor_event_candidacy(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_vendor_event_candidacy(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reject_vendor_event_candidacy(uuid, uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.reject_vendor_event_candidacy(uuid, uuid, text, text) TO authenticated;

-- ============================================================
-- 4. revoke_vendor_admission -- requires a currently admitted roster
-- relationship. Never touches vendor_event_applications.status (stays at
-- its historical 'admitted' outcome, per the Stage 1 invariant). Never
-- modifies the original 'admitted' disposition -- only appends a new,
-- separate 'revoked' one.
-- ============================================================

CREATE OR REPLACE FUNCTION public.revoke_vendor_admission(
  p_vendor_id uuid,
  p_event_id uuid,
  p_reason_code text,
  p_reason_text text DEFAULT NULL
)
RETURNS TABLE(
  outcome text,
  event_vendor_id uuid,
  application_id uuid,
  disposition_id uuid,
  admission_state text,
  authority_basis text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
  v_admin_user_id uuid;
  v_authority RECORD;
  v_event_vendor_id uuid;
  v_application_id uuid;
  v_current_admission_state text;
  v_current_disposition_id uuid;
  v_disposition_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_vendor_id IS NULL OR p_event_id IS NULL OR p_reason_code IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_disposition_reason_codes
    WHERE code = p_reason_code AND is_active = true
  ) THEN
    RAISE EXCEPTION 'invalid_reason_code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_authority FROM public.resolve_task_authority(v_uid, 'event.vendors.manage', p_event_id);
  IF NOT v_authority.allowed THEN
    RAISE EXCEPTION 'not_authorized: %', coalesce(v_authority.denial_reason, 'denied') USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_user_id FROM public.admin_users WHERE user_id = v_uid AND is_active = true;

  SELECT ev.id, ev.application_id, ev.admission_state, ev.current_disposition_id
    INTO v_event_vendor_id, v_application_id, v_current_admission_state, v_current_disposition_id
  FROM public.event_vendors AS ev
  WHERE ev.vendor_id = p_vendor_id AND ev.event_id = p_event_id
  FOR UPDATE;

  IF v_event_vendor_id IS NULL THEN
    RAISE EXCEPTION 'no_admission_to_revoke' USING ERRCODE = '22023';
  END IF;

  IF v_current_admission_state = 'revoked' THEN
    outcome := 'already_revoked';
    event_vendor_id := v_event_vendor_id;
    application_id := v_application_id;
    disposition_id := v_current_disposition_id;
    admission_state := v_current_admission_state;
    authority_basis := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.vendor_event_dispositions
    (vendor_id, application_id, event_id, decision_type, reason_code, reason_text, authority_basis, actor_auth_user_id, actor_admin_user_id)
  VALUES
    (p_vendor_id, v_application_id, p_event_id, 'revoked', p_reason_code, p_reason_text, v_authority.decision_branch, v_uid, v_admin_user_id)
  RETURNING id INTO v_disposition_id;

  UPDATE public.event_vendors
  SET admission_state = 'revoked',
      current_disposition_id = v_disposition_id
  WHERE id = v_event_vendor_id;

  outcome := 'revoked';
  event_vendor_id := v_event_vendor_id;
  application_id := v_application_id;
  disposition_id := v_disposition_id;
  admission_state := 'revoked';
  authority_basis := v_authority.decision_branch;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.revoke_vendor_admission(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_vendor_admission(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_vendor_admission(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_vendor_admission(uuid, uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.revoke_vendor_admission(uuid, uuid, text, text) TO authenticated;

-- ============================================================
-- 5. list_vendor_event_applications -- governed read for the future
-- application queue. Single has_event_task_authority('event.vendors.view')
-- gate for the whole Event, then returns every candidacy for it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_vendor_event_applications(p_event_id uuid)
RETURNS TABLE(
  application_id uuid,
  vendor_id uuid,
  vendor_business_name text,
  vendor_is_active boolean,
  event_id uuid,
  candidacy_status text,
  current_participation_state text,
  event_vendor_id uuid,
  submitted_at timestamptz,
  submitted_by_admin_user_id uuid,
  latest_disposition_id uuid,
  latest_decision_type text,
  latest_reason_code text,
  latest_reason_classification text,
  latest_occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.vendors.view', p_event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.vendor_id, v.business_name, v.is_active, a.event_id, a.status,
    ev.admission_state, ev.id, a.submitted_at, a.submitted_by_admin_user_id,
    d.id, d.decision_type, d.reason_code, d.reason_classification, d.occurred_at
  FROM public.vendor_event_applications AS a
  JOIN public.vendors AS v ON v.id = a.vendor_id
  LEFT JOIN public.event_vendors AS ev ON ev.application_id = a.id
  LEFT JOIN public.vendor_event_dispositions AS d ON d.id = a.current_disposition_id
  WHERE a.event_id = p_event_id
  ORDER BY a.submitted_at DESC;
END;
$$;

ALTER FUNCTION public.list_vendor_event_applications(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_vendor_event_applications(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_vendor_event_applications(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_vendor_event_applications(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.list_vendor_event_applications(uuid) TO authenticated;

-- ============================================================
-- 6. list_vendor_event_dispositions -- governed RAW disposition read,
-- scoped to one Event the caller is authorized to view (EA: their
-- assigned Events; TA: any Event in their Tenant via tenant_inherits;
-- SA: any Event via platform_inherits -- all resolved by the same single
-- has_event_task_authority call, no separate logic needed).
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_vendor_event_dispositions(
  p_event_id uuid,
  p_vendor_id uuid DEFAULT NULL
)
RETURNS TABLE(
  disposition_id uuid,
  vendor_id uuid,
  application_id uuid,
  event_id uuid,
  decision_type text,
  reason_code text,
  reason_classification text,
  reason_text text,
  actor_auth_user_id uuid,
  actor_admin_user_id uuid,
  authority_basis text,
  backfill_note text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.vendors.view', p_event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.vendor_id, d.application_id, d.event_id, d.decision_type,
    d.reason_code, d.reason_classification, d.reason_text,
    d.actor_auth_user_id, d.actor_admin_user_id, d.authority_basis, d.backfill_note, d.occurred_at
  FROM public.vendor_event_dispositions AS d
  WHERE d.event_id = p_event_id
    AND (p_vendor_id IS NULL OR d.vendor_id = p_vendor_id)
  ORDER BY d.occurred_at DESC;
END;
$$;

ALTER FUNCTION public.list_vendor_event_dispositions(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_vendor_event_dispositions(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_vendor_event_dispositions(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_vendor_event_dispositions(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.list_vendor_event_dispositions(uuid, uuid) TO authenticated;

-- ============================================================
-- 7. get_vendor_intelligence_summary -- narrow, derived, cross-platform
-- advisory signal. p_event_id is an authority ANCHOR only (the caller
-- must hold event.vendors.view for some Event they are legitimately
-- working in) -- the returned aggregate is deliberately vendor-wide,
-- spanning every Tenant/Event, since that is the entire point of a
-- cross-platform signal. Only performance_quality-classified
-- rejected/revoked dispositions ever count as adverse evidence;
-- operational_capacity and administrative_other never contribute.
-- Returns counts and a timestamp only -- no reason text, no actor, no
-- originating Tenant/Event identity, no complainant identity.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_vendor_intelligence_summary(
  p_vendor_id uuid,
  p_event_id uuid
)
RETURNS TABLE(
  vendor_id uuid,
  has_quality_concerns boolean,
  quality_concern_count integer,
  most_recent_quality_concern_at timestamptz,
  distinct_events_with_concern_count integer,
  distinct_tenants_with_concern_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_vendor_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_event_task_authority('event.vendors.view', p_event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p_vendor_id,
    count(*) FILTER (
      WHERE d.decision_type IN ('rejected', 'revoked') AND d.reason_classification = 'performance_quality'
    ) > 0,
    count(*) FILTER (
      WHERE d.decision_type IN ('rejected', 'revoked') AND d.reason_classification = 'performance_quality'
    )::integer,
    max(d.occurred_at) FILTER (
      WHERE d.decision_type IN ('rejected', 'revoked') AND d.reason_classification = 'performance_quality'
    ),
    count(DISTINCT d.event_id) FILTER (
      WHERE d.decision_type IN ('rejected', 'revoked') AND d.reason_classification = 'performance_quality'
    )::integer,
    count(DISTINCT d.tenant_id) FILTER (
      WHERE d.decision_type IN ('rejected', 'revoked') AND d.reason_classification = 'performance_quality'
    )::integer
  FROM public.vendor_event_dispositions AS d
  WHERE d.vendor_id = p_vendor_id;
END;
$$;

ALTER FUNCTION public.get_vendor_intelligence_summary(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_vendor_intelligence_summary(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_vendor_intelligence_summary(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_vendor_intelligence_summary(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_intelligence_summary(uuid, uuid) TO authenticated;

COMMIT;
