-- Scoped Task Authority Foundation. No existing Event assignment is
-- materialized or rewritten here; operational resource policies stay intact.
BEGIN;

CREATE TABLE public.admin_task_registry (
  task_key text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('event','tenant','platform')),
  task_kind text NOT NULL CHECK (task_kind IN ('read','mutation','governance','export')),
  description text NOT NULL,
  platform_inherits boolean NOT NULL DEFAULT false,
  tenant_inherits boolean NOT NULL DEFAULT false,
  event_assignment_grantable boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'event') = event_assignment_grantable),
  CHECK (scope <> 'platform' OR (platform_inherits AND NOT tenant_inherits))
);

INSERT INTO public.admin_task_registry
  (task_key,scope,task_kind,description,platform_inherits,tenant_inherits,event_assignment_grantable)
VALUES
 ('event.workspace.view','event','read','View Event administrative workspace.',true,true,true),
 ('event.definition.manage','event','mutation','Manage Event definition.',true,true,true),
 ('event.agenda.view','event','read','View Event agenda.',true,true,true),
 ('event.agenda.manage','event','mutation','Manage Event agenda.',true,true,true),
 ('event.announcements.view','event','read','View Event announcements.',true,true,true),
 ('event.announcements.manage','event','mutation','Manage Event announcements.',true,true,true),
 ('event.attendees.view','event','read','View Event attendees.',true,true,true),
 ('event.attendees.manage','event','mutation','Manage Event attendees.',true,true,true),
 ('event.checkin.view','event','read','View Event check-in.',true,true,true),
 ('event.checkin.manage','event','mutation','Manage Event check-in.',true,true,true),
 ('event.parking.view','event','read','View Event parking.',true,true,true),
 ('event.parking.manage','event','mutation','Manage Event parking.',true,true,true),
 ('event.imports.view','event','read','View Event imports.',true,true,true),
 ('event.imports.manage','event','mutation','Manage Event imports.',true,true,true),
 ('event.locations.view','event','read','View Event locations.',true,true,true),
 ('event.locations.manage','event','mutation','Manage Event locations.',true,true,true),
 ('event.nearby.view','event','read','View Event nearby places.',true,true,true),
 ('event.nearby.manage','event','mutation','Manage Event nearby places.',true,true,true),
 ('event.print.view','event','read','View Event print settings.',true,true,true),
 ('event.print.manage','event','mutation','Manage Event print settings.',true,true,true),
 ('event.reports.view','event','read','View Event reports.',true,true,true),
 ('event.reports.export','event','export','Export Event reports.',true,true,true),
 ('event.vendors.view','event','read','View Event vendor associations.',true,true,true),
 ('event.vendors.manage','event','mutation','Manage Event vendor associations.',true,true,true),
 ('event.validation_rules.manage','event','mutation','Manage Event validation rules.',true,true,true),
 ('tenant.event_assignments.manage','tenant','governance','Manage Event assignments for owned Tenant.',true,true,false),
 ('platform.admin_users.manage','platform','governance','Manage Platform admin users.',true,false,false),
 ('platform.maps.manage','platform','mutation','Manage Platform maps.',true,false,false),
 ('platform.nearby_catalog.manage','platform','mutation','Manage Platform nearby catalog.',true,false,false);

CREATE TABLE public.admin_event_profiles (
 profile_key text PRIMARY KEY CHECK (profile_key IN ('event_admin','content','checkin','parking','view_only')),
 display_name text NOT NULL, description text NOT NULL, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.admin_event_profiles(profile_key,display_name,description) VALUES
 ('event_admin','Event Admin','Broad Event operational default bundle.'),
 ('content','Content','Event content default bundle.'),
 ('checkin','Check-In','Event check-in default bundle.'),
 ('parking','Parking','Event parking default bundle.'),
 ('view_only','View Only','Read-only Event default bundle.');

CREATE TABLE public.admin_event_profile_tasks (
 profile_key text NOT NULL REFERENCES public.admin_event_profiles(profile_key) ON DELETE CASCADE,
 task_key text NOT NULL REFERENCES public.admin_task_registry(task_key) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(profile_key,task_key)
);
CREATE OR REPLACE FUNCTION public.enforce_admin_event_profile_task() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.admin_task_registry r WHERE r.task_key=NEW.task_key AND r.scope='event' AND r.event_assignment_grantable AND r.is_active) THEN
  RAISE EXCEPTION 'profile task must be active and Event-grantable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_admin_event_profile_task_trigger BEFORE INSERT OR UPDATE ON public.admin_event_profile_tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_event_profile_task();

INSERT INTO public.admin_event_profile_tasks(profile_key,task_key)
SELECT 'event_admin', task_key FROM public.admin_task_registry WHERE scope='event' AND task_key <> 'event.validation_rules.manage'
UNION ALL VALUES
 ('content','event.workspace.view'),('content','event.agenda.view'),('content','event.agenda.manage'),('content','event.announcements.view'),('content','event.announcements.manage'),('content','event.locations.view'),('content','event.locations.manage'),('content','event.nearby.view'),('content','event.nearby.manage'),
 ('checkin','event.workspace.view'),('checkin','event.attendees.view'),('checkin','event.attendees.manage'),('checkin','event.checkin.view'),('checkin','event.checkin.manage'),
 ('parking','event.workspace.view'),('parking','event.attendees.view'),('parking','event.parking.view'),('parking','event.parking.manage'),
 ('view_only','event.workspace.view'),('view_only','event.agenda.view'),('view_only','event.announcements.view'),('view_only','event.locations.view'),('view_only','event.nearby.view'),('view_only','event.reports.view');

ALTER TABLE public.admin_event_permissions
 ADD COLUMN granted_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN granted_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
 ADD COLUMN grant_source text NOT NULL DEFAULT 'manual' CHECK (grant_source IN ('profile_materialization','manual','profile_change')),
 ADD COLUMN source_profile_key text REFERENCES public.admin_event_profiles(profile_key) ON DELETE SET NULL,
 ADD CONSTRAINT admin_event_permissions_canonical_task_fkey FOREIGN KEY(permission_key) REFERENCES public.admin_task_registry(task_key),
 ADD CONSTRAINT admin_event_permissions_live_grant_check CHECK (is_enabled = true);
CREATE INDEX admin_event_permissions_resolver_lookup_idx ON public.admin_event_permissions(admin_event_access_id,permission_key) WHERE is_enabled;

CREATE TABLE public.admin_authority_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 actor_auth_user_id uuid, actor_admin_user_id uuid, target_admin_user_id uuid, tenant_id uuid, event_id uuid, admin_event_access_id uuid,
 task_key text, profile_before text, profile_after text,
 action text NOT NULL CHECK(action IN ('assignment_created','profile_changed','bundle_materialized','task_granted','task_revoked','defaults_reset','exceptions_preserved','assignment_revoked')),
 previous_state jsonb NOT NULL DEFAULT '{}'::jsonb, new_state jsonb NOT NULL DEFAULT '{}'::jsonb, reason text
);
CREATE INDEX admin_authority_audit_event_idx ON public.admin_authority_audit(event_id,occurred_at DESC);
CREATE OR REPLACE FUNCTION public.prevent_admin_authority_audit_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$ BEGIN RAISE EXCEPTION 'admin_authority_audit is immutable'; END $$;
CREATE TRIGGER prevent_admin_authority_audit_mutation_trigger BEFORE UPDATE OR DELETE ON public.admin_authority_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_authority_audit_mutation();

-- Existing rows are all event_admin, so this constraint changes no row.
ALTER TABLE public.admin_event_access DROP CONSTRAINT admin_event_access_role_check;
ALTER TABLE public.admin_event_access ADD CONSTRAINT admin_event_access_role_check CHECK(role IN ('event_admin','content','checkin','parking','view_only'));

CREATE OR REPLACE FUNCTION public.resolve_task_authority(p_actor_auth_user_id uuid,p_task_key text,p_event_id uuid)
RETURNS TABLE(allowed boolean,decision_branch text,task_key text,event_id uuid,tenant_id uuid,admin_event_access_id uuid,admin_event_permission_id uuid,denial_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_task public.admin_task_registry%ROWTYPE; v_tenant uuid; v_admin uuid; v_access uuid; v_grant uuid;
BEGIN
 allowed:=false; decision_branch:='denied'; task_key:=p_task_key; event_id:=p_event_id; tenant_id:=NULL; admin_event_access_id:=NULL; admin_event_permission_id:=NULL;
 IF p_actor_auth_user_id IS NULL OR p_task_key IS NULL OR p_event_id IS NULL THEN denial_reason:='missing_input'; RETURN NEXT; RETURN; END IF;
 IF auth.uid() IS DISTINCT FROM p_actor_auth_user_id THEN denial_reason:='actor_mismatch'; RETURN NEXT; RETURN; END IF;
 SELECT * INTO v_task FROM public.admin_task_registry WHERE admin_task_registry.task_key=p_task_key AND is_active;
 IF NOT FOUND THEN denial_reason:='unknown_or_inactive_task'; RETURN NEXT; RETURN; END IF;
 SELECT e.tenant_id INTO v_tenant FROM public.events e WHERE e.id=p_event_id;
 IF NOT FOUND OR v_tenant IS NULL THEN denial_reason:='event_or_tenant_not_found'; RETURN NEXT; RETURN; END IF;
 tenant_id:=v_tenant;
 SELECT id INTO v_admin FROM public.admin_users WHERE user_id=p_actor_auth_user_id AND is_active;
 IF NOT FOUND THEN denial_reason:='inactive_or_missing_admin'; RETURN NEXT; RETURN; END IF;
 IF v_task.platform_inherits AND public.has_platform_admin_authority(p_actor_auth_user_id) THEN allowed:=true; decision_branch:='platform'; RETURN NEXT; RETURN; END IF;
 IF v_task.tenant_inherits AND public.has_tenant_admin_authority(p_actor_auth_user_id,v_tenant) THEN allowed:=true; decision_branch:='tenant'; RETURN NEXT; RETURN; END IF;
 IF NOT v_task.event_assignment_grantable THEN denial_reason:='task_not_event_grantable'; RETURN NEXT; RETURN; END IF;
 SELECT id INTO v_access FROM public.admin_event_access WHERE admin_user_id=v_admin AND event_id=p_event_id;
 IF NOT FOUND THEN denial_reason:='no_event_assignment'; RETURN NEXT; RETURN; END IF;
 admin_event_access_id:=v_access;
 SELECT id INTO v_grant FROM public.admin_event_permissions WHERE admin_event_access_id=v_access AND permission_key=p_task_key AND is_enabled;
 IF NOT FOUND THEN denial_reason:='task_not_granted'; RETURN NEXT; RETURN; END IF;
 allowed:=true; decision_branch:='event_grant'; admin_event_permission_id:=v_grant; RETURN NEXT;
END $$;
CREATE OR REPLACE FUNCTION public.has_event_task_authority(p_task_key text,p_event_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$ SELECT COALESCE((SELECT allowed FROM public.resolve_task_authority(auth.uid(),p_task_key,p_event_id)),false) $$;

CREATE OR REPLACE FUNCTION public.assert_event_authority_governor(p_event_id uuid)
RETURNS TABLE(tenant_id uuid,actor_admin_user_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
BEGIN
 SELECT e.tenant_id INTO tenant_id FROM public.events e WHERE e.id=p_event_id;
 IF NOT FOUND OR tenant_id IS NULL THEN RAISE EXCEPTION 'event or tenant not found'; END IF;
 SELECT au.id INTO actor_admin_user_id FROM public.admin_users au WHERE au.user_id=auth.uid() AND au.is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'caller is not active admin'; END IF;
 IF NOT public.has_platform_admin_authority(auth.uid()) AND NOT public.has_tenant_admin_authority(auth.uid(),tenant_id) THEN RAISE EXCEPTION 'caller lacks Event governance authority'; END IF;
 RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.create_event_authority_assignment(p_target_admin_user_id uuid,p_event_id uuid,p_profile_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_tenant uuid; v_actor uuid; v_target_auth uuid; v_assignment uuid; v_task text;
BEGIN
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(p_event_id);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=p_target_admin_user_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'target is not active admin'; END IF;
 IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_event_profiles WHERE profile_key=p_profile_key AND is_active) THEN RAISE EXCEPTION 'unknown profile'; END IF;
 INSERT INTO public.admin_event_access(admin_user_id,event_id,role) VALUES(p_target_admin_user_id,p_event_id,p_profile_key) RETURNING id INTO v_assignment;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,p_profile_key,'assignment_created',jsonb_build_object('profile_key',p_profile_key),p_reason);
 FOR v_task IN SELECT task_key FROM public.admin_event_profile_tasks WHERE profile_key=p_profile_key LOOP
  INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source,source_profile_key) VALUES(v_assignment,v_task,v_actor,'profile_materialization',p_profile_key);
  INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,v_task,p_profile_key,'task_granted',jsonb_build_object('source','profile_materialization'),p_reason);
 END LOOP;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,p_target_admin_user_id,v_tenant,p_event_id,v_assignment,p_profile_key,'bundle_materialized',jsonb_build_object('profile_key',p_profile_key),p_reason);
 RETURN v_assignment;
END $$;

CREATE OR REPLACE FUNCTION public.grant_event_authority_task(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_tenant uuid;v_actor uuid;
BEGIN
 SELECT event_id,admin_user_id INTO v_event,v_target FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_task_registry WHERE task_key=p_task_key AND is_active AND scope='event' AND event_assignment_grantable) THEN RAISE EXCEPTION 'task is not Event-grantable'; END IF;
 INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source) VALUES(p_assignment_id,p_task_key,v_actor,'manual') ON CONFLICT(admin_event_access_id,permission_key) DO NOTHING;
 IF FOUND THEN INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,p_task_key,'task_granted',jsonb_build_object('source','manual'),p_reason); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_event_authority_task(p_assignment_id uuid,p_task_key text,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_tenant uuid;v_actor uuid;
BEGIN
 SELECT event_id,admin_user_id INTO v_event,v_target FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 DELETE FROM public.admin_event_permissions WHERE admin_event_access_id=p_assignment_id AND permission_key=p_task_key;
 IF FOUND THEN INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,task_key,action,previous_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,p_task_key,'task_revoked',jsonb_build_object('enabled',true),p_reason); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.remove_event_authority_assignment(p_assignment_id uuid,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_profile text;v_tenant uuid;v_actor uuid;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_profile FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,action,previous_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_profile,'assignment_revoked',jsonb_build_object('profile_key',v_profile),p_reason);
 DELETE FROM public.admin_event_access WHERE id=p_assignment_id;
END $$;

-- Profile changes require a later governed caller to send either a reset or
-- an explicit complete final task set; no implicit exception preservation.
CREATE OR REPLACE FUNCTION public.change_event_authority_profile(p_assignment_id uuid,p_profile_key text,p_disposition text,p_final_task_keys text[] DEFAULT NULL,p_reason text DEFAULT NULL,p_correlation_id uuid DEFAULT gen_random_uuid()) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_event uuid;v_target uuid;v_target_auth uuid;v_old text;v_tenant uuid;v_actor uuid;v_final text[];v_task text;
BEGIN
 SELECT event_id,admin_user_id,role INTO v_event,v_target,v_old FROM public.admin_event_access WHERE id=p_assignment_id; IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found'; END IF;
 SELECT tenant_id,actor_admin_user_id INTO v_tenant,v_actor FROM public.assert_event_authority_governor(v_event);
 SELECT user_id INTO v_target_auth FROM public.admin_users WHERE id=v_target; IF v_target_auth=auth.uid() THEN RAISE EXCEPTION 'self-elevation is forbidden'; END IF;
 IF p_disposition NOT IN ('reset_to_defaults','preserve_exceptions') OR NOT EXISTS(SELECT 1 FROM public.admin_event_profiles WHERE profile_key=p_profile_key AND is_active) THEN RAISE EXCEPTION 'invalid profile change'; END IF;
 IF p_disposition='reset_to_defaults' THEN IF p_final_task_keys IS NOT NULL THEN RAISE EXCEPTION 'reset cannot include final keys'; END IF; SELECT array_agg(task_key ORDER BY task_key) INTO v_final FROM public.admin_event_profile_tasks WHERE profile_key=p_profile_key;
 ELSE IF p_final_task_keys IS NULL THEN RAISE EXCEPTION 'preserve_exceptions needs explicit final keys'; END IF; SELECT array_agg(DISTINCT k ORDER BY k) INTO v_final FROM unnest(p_final_task_keys) k; IF EXISTS(SELECT 1 FROM unnest(v_final) k LEFT JOIN public.admin_task_registry r ON r.task_key=k WHERE r.task_key IS NULL OR NOT r.is_active OR r.scope<>'event' OR NOT r.event_assignment_grantable) THEN RAISE EXCEPTION 'invalid final task'; END IF; END IF;
 DELETE FROM public.admin_event_permissions WHERE admin_event_access_id=p_assignment_id; UPDATE public.admin_event_access SET role=p_profile_key WHERE id=p_assignment_id;
 FOREACH v_task IN ARRAY v_final LOOP INSERT INTO public.admin_event_permissions(admin_event_access_id,permission_key,granted_by_admin_user_id,grant_source,source_profile_key) VALUES(p_assignment_id,v_task,v_actor,CASE WHEN p_disposition='reset_to_defaults' THEN 'profile_change' ELSE 'manual' END,p_profile_key); END LOOP;
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,profile_after,action,previous_state,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_old,p_profile_key,'profile_changed',jsonb_build_object('profile_key',v_old),jsonb_build_object('profile_key',p_profile_key,'final_task_keys',v_final),p_reason);
 INSERT INTO public.admin_authority_audit(correlation_id,actor_auth_user_id,actor_admin_user_id,target_admin_user_id,tenant_id,event_id,admin_event_access_id,profile_before,profile_after,action,new_state,reason) VALUES(p_correlation_id,auth.uid(),v_actor,v_target,v_tenant,v_event,p_assignment_id,v_old,p_profile_key,CASE WHEN p_disposition='reset_to_defaults' THEN 'defaults_reset' ELSE 'exceptions_preserved' END,jsonb_build_object('final_task_keys',v_final),p_reason);
END $$;

CREATE OR REPLACE FUNCTION public.list_effective_event_capabilities(p_event_id uuid) RETURNS TABLE(task_key text,allowed boolean,decision_branch text,denial_reason text) LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$ SELECT r.task_key,d.allowed,d.decision_branch,d.denial_reason FROM public.admin_task_registry r CROSS JOIN LATERAL public.resolve_task_authority(auth.uid(),r.task_key,p_event_id) d WHERE r.is_active ORDER BY r.task_key $$;

ALTER TABLE public.admin_task_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_event_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_event_profile_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_authority_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_task_registry,public.admin_event_profiles,public.admin_event_profile_tasks,public.admin_event_permissions,public.admin_authority_audit FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.resolve_task_authority(uuid,text,uuid),public.has_event_task_authority(text,uuid),public.assert_event_authority_governor(uuid),public.create_event_authority_assignment(uuid,uuid,text,text,uuid),public.change_event_authority_profile(uuid,text,text,text[],text,uuid),public.grant_event_authority_task(uuid,text,text,uuid),public.revoke_event_authority_task(uuid,text,text,uuid),public.remove_event_authority_assignment(uuid,text,uuid),public.list_effective_event_capabilities(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_task_authority(uuid,text,uuid),public.has_event_task_authority(text,uuid),public.create_event_authority_assignment(uuid,uuid,text,text,uuid),public.change_event_authority_profile(uuid,text,text,text[],text,uuid),public.grant_event_authority_task(uuid,text,text,uuid),public.revoke_event_authority_task(uuid,text,text,uuid),public.remove_event_authority_assignment(uuid,text,uuid),public.list_effective_event_capabilities(uuid) TO authenticated;
COMMIT;
