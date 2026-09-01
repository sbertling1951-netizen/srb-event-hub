-- Governed downward Event Staff delegation for Event Admin.
--
-- ── The gap ───────────────────────────────────────────────────────────────
-- The seven Event Staff RPCs (create_event_authority_assignment,
-- grant_event_authority_task, revoke_event_authority_task,
-- remove_event_authority_assignment, change_event_authority_profile, plus
-- the two read RPCs list_event_authority_assignments /
-- list_event_authority_profile_catalog) all gate on
-- assert_event_authority_governor(p_event_id) -- Platform Admin, or an
-- ACTIVE Tenant Admin for the Event's Tenant. An Event Admin
-- (admin_event_access.role = 'event_admin' for the Event) is not admitted
-- by that gate at all, so today an EA reaching /admin/event-staff hits a
-- raised exception on every RPC and can manage nobody.
--
-- ── The canonical hierarchy this migration enforces ─────────────────────
--   Platform / Super Admin  →  Tenant Admin  →  Event Admin  →  subordinate
--   Event staff (content / checkin / parking / view_only).
--
-- An Event Admin for Event X may govern subordinate staff for Event X ONLY.
-- An Event Admin may NEVER:
--   * assign the event_admin profile,
--   * change any assignment to event_admin, or modify / remove an existing
--     event_admin assignment,
--   * operate on another Event merely because it shares a Tenant,
--   * grant a task outside the live union of the four subordinate profile
--     templates (the EA-delegable catalog) -- in particular none of the
--     nine EA-reserved tasks: event.definition.manage, event.imports.view,
--     event.imports.manage, event.print.view, event.print.manage,
--     event.reports.export, event.vendors.view, event.vendors.manage,
--     event.validation_rules.manage,
--   * elevate its own assignment (the pre-existing self-elevation fence is
--     kept verbatim in every RPC).
--
-- ── What this migration adds ───────────────────────────────────────────
--   1. resolve_event_staff_delegation(p_event_id) -- same shape and
--      fail-closed discipline as assert_event_authority_governor, but
--      resolves and RETURNS a tier: 'platform' | 'tenant' | 'event_admin'.
--      Precedence is Platform, then Tenant Admin for THIS Event's Tenant,
--      then Event Admin for THIS EXACT Event (respecting the inactive-Tenant
--      operational freeze), otherwise it raises. assert_event_authority_
--      governor itself is left completely untouched -- other callers keep it.
--   2. has_any_event_staff_delegation_authority() -- coarse, Event-agnostic
--      "can this admin reach the Event Staff surface for at least one
--      Event" predicate, for the route guard. Platform, OR any-Tenant
--      Admin, OR event_admin on any Event under an active Tenant.
--   3. is_ea_delegable_task(p_task_key) -- true iff the task is in the live
--      union of the content/checkin/parking/view_only profile templates.
--   4. CREATE OR REPLACE of all seven Event Staff RPCs: swap the governor
--      call for resolve_event_staff_delegation, capture the tier, and add
--      the Event-Admin ceiling. TA / SA behaviour is unchanged -- for those
--      tiers every new branch is a no-op. Every pre-existing property
--      (signatures, return shapes, SECURITY DEFINER, hardened search_path,
--      ownership, grants, auditing, active-admin / profile-validity /
--      event-grantability / self-elevation / uniqueness / disposition
--      protections) is preserved byte-for-byte outside the delegation
--      change.
--
-- ── What this migration does NOT do ────────────────────────────────────
--   * does not touch assert_event_authority_governor, resolve_task_authority,
--     has_event_task_authority, has_platform_admin_authority,
--     has_tenant_admin_authority, has_any_tenant_admin_authority,
--     has_event_admin_authority, or any RLS policy,
--   * does not introduce an event.staff.* / event.event_staff.* task --
--     the Event Staff surface is governed by a PREDICATE, never by a
--     grantable (hence recursively delegable) task,
--   * does not add or change any admin_event_permissions / admin_event_access
--     row -- purely a function-definition migration,
--   * does not widen any table grant.
--
-- ── Fail-closed drift guards (DO block below, runs first) ──────────────
--   G1  the four EA-delegable subordinate profiles exist and are active,
--   G2/G3  the live subordinate-template union stays DISJOINT from the nine
--          EA-reserved tasks,
--   G4  event.validation_rules.manage is never in a subordinate template,
--   G5  no event.staff.* / event.event_staff.* task exists in the registry.
--   Any breach aborts the whole transaction.

BEGIN;

DO $guard$
DECLARE
  v_sub_union        text[];
  v_reserved         text[] := ARRAY[
    'event.definition.manage',
    'event.imports.view', 'event.imports.manage',
    'event.print.view', 'event.print.manage',
    'event.reports.export',
    'event.vendors.view', 'event.vendors.manage',
    'event.validation_rules.manage'
  ];
  v_overlap          text[];
  v_missing_profiles text[];
  v_staff_task       text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'govern_event_staff_downward_delegation may only run as the migration owner role';
  END IF;

  -- G1: the four EA-delegable subordinate profiles exist and are active.
  SELECT array_agg(p ORDER BY p) INTO v_missing_profiles
  FROM unnest(ARRAY['content', 'checkin', 'parking', 'view_only']) AS p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.admin_event_profiles ep
    WHERE ep.profile_key = p AND ep.is_active
  );
  IF v_missing_profiles IS NOT NULL THEN
    RAISE EXCEPTION
      'subordinate profile drift: missing or inactive EA-delegable profile(s) % (ABORT)',
      v_missing_profiles;
  END IF;

  -- G2: the live union of the four subordinate profile templates -- the
  --     exact set is_ea_delegable_task() computes at runtime.
  SELECT array_agg(DISTINCT task_key ORDER BY task_key) INTO v_sub_union
  FROM public.admin_event_profile_tasks
  WHERE profile_key IN ('content', 'checkin', 'parking', 'view_only');

  -- G3: that union must remain disjoint from every EA-reserved task.
  SELECT array_agg(k ORDER BY k) INTO v_overlap
  FROM unnest(v_sub_union) AS k
  WHERE k = ANY(v_reserved);
  IF v_overlap IS NOT NULL THEN
    RAISE EXCEPTION
      'delegation ceiling breach: a subordinate profile template now grants EA-reserved task(s) % (ABORT)',
      v_overlap;
  END IF;

  -- G4: validation_rules.manage in particular must never be delegable.
  IF 'event.validation_rules.manage' = ANY(v_sub_union) THEN
    RAISE EXCEPTION
      'delegation ceiling breach: event.validation_rules.manage is in a subordinate profile template (ABORT)';
  END IF;

  -- G5: no Event-Staff task may exist in the registry. Delegation authority
  --     is a predicate; a task would be event-grantable and hence
  --     recursively delegable, and would contradict governance/task
  --     separation.
  SELECT task_key INTO v_staff_task
  FROM public.admin_task_registry
  WHERE task_key LIKE 'event.staff.%' OR task_key LIKE 'event.event_staff.%'
  LIMIT 1;
  IF v_staff_task IS NOT NULL THEN
    RAISE EXCEPTION
      'delegation model breach: registry contains an Event-Staff task (%) -- delegation must remain a predicate, not a grantable task (ABORT)',
      v_staff_task;
  END IF;

  RAISE NOTICE
    'event-staff downward delegation guards passed: subordinate union has % task(s), disjoint from the % EA-reserved task(s)',
    COALESCE(array_length(v_sub_union, 1), 0), array_length(v_reserved, 1);
END
$guard$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. is_ea_delegable_task -- live union of the four subordinate templates.
--    Inner-only (no authenticated grant); every caller below is a
--    SECURITY DEFINER function owned by postgres.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_ea_delegable_task(p_task_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_event_profile_tasks
    WHERE profile_key IN ('content', 'checkin', 'parking', 'view_only')
      AND task_key = p_task_key
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. resolve_event_staff_delegation -- the tier resolver. Same fail-closed
--    contract as assert_event_authority_governor (which is left untouched),
--    plus a third accepted tier: Event Admin for this exact Event.
--    Inner-only.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_event_staff_delegation(p_event_id uuid)
RETURNS TABLE(tenant_id uuid, actor_admin_user_id uuid, actor_tier text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant_active boolean;
BEGIN
  SELECT e.tenant_id, t.is_active
    INTO tenant_id, v_tenant_active
  FROM public.events e
  JOIN public.tenants t ON t.id = e.tenant_id
  WHERE e.id = p_event_id;
  IF NOT FOUND OR tenant_id IS NULL THEN
    RAISE EXCEPTION 'event or tenant not found';
  END IF;

  SELECT au.id INTO actor_admin_user_id
  FROM public.admin_users au
  WHERE au.user_id = auth.uid() AND au.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'caller is not active admin';
  END IF;

  -- Precedence: Platform, then Tenant Admin for THIS Event's Tenant, then
  -- Event Admin for THIS EXACT Event. Nothing else is delegation authority.
  IF public.has_platform_admin_authority(auth.uid()) THEN
    actor_tier := 'platform';
    RETURN NEXT;
    RETURN;
  END IF;

  IF public.has_tenant_admin_authority(auth.uid(), tenant_id) THEN
    actor_tier := 'tenant';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Event Admin tier: an active admin_event_access row with role
  -- 'event_admin' for exactly p_event_id, and the Event's Tenant is active
  -- (inactive-Tenant operational freeze -- matches has_event_admin_authority).
  IF v_tenant_active AND EXISTS (
    SELECT 1
    FROM public.admin_event_access aea
    WHERE aea.admin_user_id = actor_admin_user_id
      AND aea.event_id = p_event_id
      AND aea.role = 'event_admin'
  ) THEN
    actor_tier := 'event_admin';
    RETURN NEXT;
    RETURN;
  END IF;

  RAISE EXCEPTION 'caller lacks Event staff delegation authority';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. has_any_event_staff_delegation_authority -- coarse route-guard
--    predicate. No Event dimension; answers only "can this admin reach the
--    Event Staff surface for at least one Event."
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_any_event_staff_delegation_authority()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_platform_admin_authority(v_uid) THEN
    RETURN true;
  END IF;

  IF public.has_any_tenant_admin_authority() THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users au
    JOIN public.admin_event_access aea ON aea.admin_user_id = au.id
    JOIN public.events e ON e.id = aea.event_id
    JOIN public.tenants t ON t.id = e.tenant_id AND t.is_active
    WHERE au.user_id = v_uid
      AND au.is_active
      AND aea.role = 'event_admin'
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. The seven Event Staff RPCs -- CREATE OR REPLACE with the delegation
--    resolver + Event-Admin ceiling. Everything outside the delegation
--    change is byte-for-byte the prior definition
--    (20260811170000 / 20260813170000).
-- ═════════════════════════════════════════════════════════════════════════

-- create_event_authority_assignment: EA may create only a subordinate
-- (content/checkin/parking/view_only) assignment. The materialized bundle
-- for any of those is a subset of the EA-delegable catalog by construction
-- (guard G2/G3), so no reserved task can leak in through creation.
CREATE OR REPLACE FUNCTION public.create_event_authority_assignment(p_target_admin_user_id uuid,p_event_id uuid,p_profile_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_tenant uuid; v_actor uuid; v_tier text; v_target_auth uuid; v_assignment uuid; v_task text;
BEGIN
 SELECT tenant_id,actor_admin_user_id,actor_tier INTO v_tenant,v_actor,v_tier FROM public.resolve_event_staff_delegation(p_event_id);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=p_target_admin_user_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'target is not active admin'; END IF;
 IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_event_profiles WHERE profile_key=p_profile_key AND is_active) THEN RAISE EXCEPTION 'unknown profile'; END IF;
 IF v_tier='event_admin' AND p_profile_key NOT IN ('content','checkin','parking','view_only') THEN RAISE EXCEPTION 'Event Admin delegation may not assign the % profile', p_profile_key; END IF;
 INSERT INTO public.admin_event_access(admin_user_id,event_id,role) VALUES(p_target_admin_user_id,p_event_id,p_profile_key) RETURNING id INTO v_assignment;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,p_profile_key,'assignment_created',jsonb_build_object('profile_key',p_profile_key),p_reason);
 FOR v_task IN SELECT task_key FROM public.admin_event_profile_tasks WHERE profile_key=p_profile_key LOOP
  INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source,source_profile_key) VALUES(v_assignment,v_task,v_actor,'profile_materialization',p_profile_key);
  INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,v_task,p_profile_key,'task_granted',jsonb_build_object('source','profile_materialization'),p_reason);
 END LOOP;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,p_profile_key,'bundle_materialized',jsonb_build_object('profile_key',p_profile_key),p_reason);
 RETURN v_assignment;
END $$;

-- grant_event_authority_task: EA may not touch an event_admin assignment,
-- and may grant only an EA-delegable task. The generic 'task is not
-- Event-grantable' fence is kept and runs first.
CREATE OR REPLACE FUNCTION public.grant_event_authority_task(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_role text;v_target_auth uuid;v_tenant uuid;v_actor uuid;v_tier text;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_role FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id,actor_tier INTO v_tenant,v_actor,v_tier FROM public.resolve_event_staff_delegation(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_task_registry WHERE task_key=p_task_key AND is_active AND scope='event' AND event_assignment_grantable) THEN RAISE EXCEPTION 'task is not Event-grantable'; END IF;
 IF v_tier='event_admin' THEN
  IF v_role='event_admin' THEN RAISE EXCEPTION 'Event Admin delegation may not modify an Event Admin assignment'; END IF;
  IF NOT public.is_ea_delegable_task(p_task_key) THEN RAISE EXCEPTION 'Event Admin delegation may not grant the % task', p_task_key; END IF;
 END IF;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source) VALUES(p_assignment_id,p_task_key,v_actor,'manual') ON CONFLICT(admin_event_access_id,permission_key) DO NOTHING;
 IF FOUND THEN INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,p_task_key,'task_granted',jsonb_build_object('source','manual'),p_reason); END IF;
END $$;

-- revoke_event_authority_task: EA may not touch an event_admin assignment,
-- and may revoke only an EA-delegable task.
CREATE OR REPLACE FUNCTION public.revoke_event_authority_task(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_role text;v_target_auth uuid;v_tenant uuid;v_actor uuid;v_tier text;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_role FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id,actor_tier INTO v_tenant,v_actor,v_tier FROM public.resolve_event_staff_delegation(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF v_tier='event_admin' THEN
  IF v_role='event_admin' THEN RAISE EXCEPTION 'Event Admin delegation may not modify an Event Admin assignment'; END IF;
  IF NOT public.is_ea_delegable_task(p_task_key) THEN RAISE EXCEPTION 'Event Admin delegation may not revoke the % task', p_task_key; END IF;
 END IF;
 DELETE FROM public.admin_event_permissions WHERE admin_event_access_id=p_assignment_id AND permission_key=p_task_key;
 IF FOUND THEN INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,action,previous_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,p_task_key,'task_revoked',jsonb_build_object('enabled',true),p_reason); END IF;
END $$;

-- remove_event_authority_assignment: EA may not remove an event_admin
-- assignment.
CREATE OR REPLACE FUNCTION public.remove_event_authority_assignment(p_assignment_id uuid,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_profile text;v_tenant uuid;v_actor uuid;v_tier text;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_profile FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id,actor_tier INTO v_tenant,v_actor,v_tier FROM public.resolve_event_staff_delegation(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF v_tier='event_admin' AND v_profile='event_admin' THEN RAISE EXCEPTION 'Event Admin delegation may not remove an Event Admin assignment'; END IF;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,action,previous_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_profile,'assignment_revoked',jsonb_build_object('profile_key',v_profile),p_reason);
 DELETE FROM public.admin_event_access WHERE id=p_assignment_id;
END $$;

-- change_event_authority_profile: EA may not modify an existing event_admin
-- assignment, may not change any assignment TO event_admin, and -- for
-- preserve_exceptions -- may not carry a task outside the EA-delegable
-- catalog. reset_to_defaults for a subordinate profile is safe by G2/G3.
CREATE OR REPLACE FUNCTION public.change_event_authority_profile(p_assignment_id uuid,p_profile_key text,p_disposition text,p_final_task_keys text[] DEFAULT NULL,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_old text;v_tenant uuid;v_actor uuid;v_tier text;v_final text[];v_task text;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_old FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id,actor_tier INTO v_tenant,v_actor,v_tier FROM public.resolve_event_staff_delegation(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF p_disposition NOT IN ('reset_to_defaults','preserve_exceptions') OR NOT EXISTS(SELECT 1 FROM public.admin_event_profiles WHERE profile_key=p_profile_key AND is_active) THEN RAISE EXCEPTION 'invalid profile change'; END IF;
 IF v_tier='event_admin' THEN
  IF v_old='event_admin' THEN RAISE EXCEPTION 'Event Admin delegation may not modify an Event Admin assignment'; END IF;
  IF p_profile_key NOT IN ('content','checkin','parking','view_only') THEN RAISE EXCEPTION 'Event Admin delegation may not assign the % profile', p_profile_key; END IF;
 END IF;
 IF p_disposition='reset_to_defaults' THEN IF p_final_task_keys IS NOT NULL THEN RAISE EXCEPTION 'reset cannot include final keys'; END IF; SELECT array_agg(task_key ORDER BY task_key) INTO v_final FROM public.admin_event_profile_tasks WHERE profile_key=p_profile_key;
 ELSE IF p_final_task_keys IS NULL THEN RAISE EXCEPTION 'preserve_exceptions needs explicit final keys'; END IF; SELECT array_agg(DISTINCT k ORDER BY k) INTO v_final FROM unnest(p_final_task_keys) k; IF EXISTS(SELECT 1 FROM unnest(v_final) k LEFT JOIN public.admin_task_registry r ON r.task_key=k WHERE r.task_key IS NULL OR NOT r.is_active OR r.scope<>'event' OR NOT r.event_assignment_grantable) THEN RAISE EXCEPTION 'invalid final task'; END IF; END IF;
 IF v_tier='event_admin' AND EXISTS(SELECT 1 FROM unnest(v_final) k WHERE NOT public.is_ea_delegable_task(k)) THEN RAISE EXCEPTION 'Event Admin delegation may not assign a task outside the delegable catalog'; END IF;
 DELETE FROM public.admin_event_permissions WHERE admin_event_access_id=p_assignment_id; UPDATE public.admin_event_access SET role=p_profile_key WHERE id=p_assignment_id;
 FOREACH v_task IN ARRAY v_final LOOP INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source,source_profile_key) VALUES(p_assignment_id,v_task,v_actor,CASE WHEN p_disposition='reset_to_defaults' THEN 'profile_change' ELSE 'manual' END,p_profile_key); END LOOP;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,profile_after,action,previous_state,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_old,p_profile_key,'profile_changed',jsonb_build_object('profile_key',v_old),jsonb_build_object('profile_key',p_profile_key,'final_task_keys',v_final),p_reason);
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_old,p_profile_key,CASE WHEN p_disposition='reset_to_defaults' THEN 'defaults_reset' ELSE 'exceptions_preserved' END,jsonb_build_object('final_task_keys',v_final),p_reason);
END $$;

-- list_event_authority_assignments: existing event_admin rows stay VISIBLE
-- to an EA delegate but are non-governable (can_govern = false), on top of
-- the pre-existing self-row fence.
CREATE OR REPLACE FUNCTION public.list_event_authority_assignments(p_event_id uuid)
RETURNS TABLE(
  assignment_id uuid,
  event_id uuid,
  tenant_id uuid,
  target_admin_user_id uuid,
  target_display_name text,
  target_email text,
  canonical_profile text,
  assignment_created_at timestamptz,
  explicit_grants jsonb,
  can_govern boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_tier text;
BEGIN
  -- Governed gate: validates the Event exists, derives its Tenant, and
  -- fails closed unless the caller is Platform, Tenant Admin for that
  -- Tenant, or Event Admin for this exact Event. Returns the resolved tier.
  SELECT g.tenant_id, g.actor_admin_user_id, g.actor_tier INTO v_tenant, v_actor, v_tier
  FROM public.resolve_event_staff_delegation(p_event_id) AS g;

  RETURN QUERY
  SELECT
    aea.id AS assignment_id,
    aea.event_id,
    v_tenant AS tenant_id,
    aea.admin_user_id AS target_admin_user_id,
    au.display_name AS target_display_name,
    au.email AS target_email,
    aea.role AS canonical_profile,
    aea.created_at AS assignment_created_at,
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object(
           'task_key', aep.permission_key,
           'granted_at', aep.granted_at,
           'grant_source', aep.grant_source,
           'source_profile_key', aep.source_profile_key,
           'granted_by_admin_user_id', aep.granted_by_admin_user_id
         )
         ORDER BY aep.permission_key
       )
       FROM public.admin_event_permissions AS aep
       WHERE aep.admin_event_access_id = aea.id
         AND aep.is_enabled),
      '[]'::jsonb
    ) AS explicit_grants,
    (
      au.user_id IS DISTINCT FROM auth.uid()
      AND NOT (v_tier = 'event_admin' AND aea.role = 'event_admin')
    ) AS can_govern
  FROM public.admin_event_access AS aea
  JOIN public.admin_users AS au ON au.id = aea.admin_user_id
  WHERE aea.event_id = p_event_id
  ORDER BY aea.created_at;
END;
$$;

-- list_event_authority_profile_catalog: an EA delegate is offered ONLY the
-- four subordinate profiles and ONLY EA-delegable tasks. TA / SA see the
-- full catalog exactly as before.
CREATE OR REPLACE FUNCTION public.list_event_authority_profile_catalog(p_event_id uuid)
RETURNS TABLE(
  profile_key text,
  display_name text,
  description text,
  profile_default_task_keys text[],
  event_task_catalog jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid;
  v_tier text;
  v_catalog jsonb;
BEGIN
  SELECT g.tenant_id, g.actor_admin_user_id, g.actor_tier INTO v_tenant, v_actor, v_tier
  FROM public.resolve_event_staff_delegation(p_event_id) AS g;

  SELECT jsonb_agg(
    jsonb_build_object(
      'task_key', r.task_key,
      'scope', r.scope,
      'task_kind', r.task_kind,
      'description', r.description
    )
    ORDER BY r.task_key
  ) INTO v_catalog
  FROM public.admin_task_registry AS r
  WHERE r.is_active
    AND r.scope = 'event'
    AND r.event_assignment_grantable
    AND (v_tier <> 'event_admin' OR public.is_ea_delegable_task(r.task_key));

  RETURN QUERY
  SELECT
    p.profile_key,
    p.display_name,
    p.description,
    COALESCE(
      (SELECT array_agg(pt.task_key ORDER BY pt.task_key)
       FROM public.admin_event_profile_tasks AS pt
       WHERE pt.profile_key = p.profile_key
         AND (v_tier <> 'event_admin' OR public.is_ea_delegable_task(pt.task_key))),
      ARRAY[]::text[]
    ) AS profile_default_task_keys,
    v_catalog AS event_task_catalog
  FROM public.admin_event_profiles AS p
  WHERE p.is_active
    AND (v_tier <> 'event_admin' OR p.profile_key IN ('content', 'checkin', 'parking', 'view_only'))
  ORDER BY p.profile_key;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Ownership + ACLs. New functions mirror assert_event_authority_governor
-- (inner-only) except has_any_event_staff_delegation_authority, which the
-- route guard calls as `authenticated`. The seven RPCs keep the exact
-- ownership and grants they already carried.
-- ─────────────────────────────────────────────────────────────────────────
ALTER FUNCTION public.is_ea_delegable_task(text) OWNER TO postgres;
ALTER FUNCTION public.resolve_event_staff_delegation(uuid) OWNER TO postgres;
ALTER FUNCTION public.has_any_event_staff_delegation_authority() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_ea_delegable_task(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_event_staff_delegation(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_any_event_staff_delegation_authority() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_event_staff_delegation_authority() TO authenticated;

ALTER FUNCTION public.create_event_authority_assignment(uuid,uuid,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.grant_event_authority_task(uuid,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.revoke_event_authority_task(uuid,text,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.remove_event_authority_assignment(uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.change_event_authority_profile(uuid,text,text,text[],text,uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_event_authority_assignment(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_event_authority_assignment(uuid,uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.grant_event_authority_task(uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.grant_event_authority_task(uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_event_authority_task(uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.revoke_event_authority_task(uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_event_authority_assignment(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.remove_event_authority_assignment(uuid,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.change_event_authority_profile(uuid,text,text,text[],text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.change_event_authority_profile(uuid,text,text,text[],text,uuid) TO authenticated;

-- The two read RPCs are reproduced with the exact ACL block their
-- introducing migration (20260811200000) used -- no explicit ALTER OWNER
-- there, and CREATE OR REPLACE never changes ownership, so the existing
-- owner is preserved untouched.
REVOKE ALL ON FUNCTION public.list_event_authority_assignments(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_authority_assignments(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_event_authority_profile_catalog(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_authority_profile_catalog(uuid) TO authenticated;

COMMIT;
