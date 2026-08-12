-- Repair output-column ambiguity in the scoped task resolver. The foundation
-- migration was applied before the resolver had evaluated an assignment path.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_task_authority(p_actor_auth_user_id uuid,p_task_key text,p_event_id uuid)
RETURNS TABLE(allowed boolean,decision_branch text,task_key text,event_id uuid,tenant_id uuid,admin_event_access_id uuid,admin_event_permission_id uuid,denial_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE v_task public.admin_task_registry%ROWTYPE; v_tenant uuid; v_admin uuid; v_access uuid; v_grant uuid;
BEGIN
 allowed:=false; decision_branch:='denied'; task_key:=p_task_key; event_id:=p_event_id; tenant_id:=NULL; admin_event_access_id:=NULL; admin_event_permission_id:=NULL;
 IF p_actor_auth_user_id IS NULL OR p_task_key IS NULL OR p_event_id IS NULL THEN denial_reason:='missing_input'; RETURN NEXT; RETURN; END IF;
 IF auth.uid() IS DISTINCT FROM p_actor_auth_user_id THEN denial_reason:='actor_mismatch'; RETURN NEXT; RETURN; END IF;
 SELECT r.* INTO v_task FROM public.admin_task_registry AS r WHERE r.task_key=p_task_key AND r.is_active;
 IF NOT FOUND THEN denial_reason:='unknown_or_inactive_task'; RETURN NEXT; RETURN; END IF;
 SELECT e.tenant_id INTO v_tenant FROM public.events AS e WHERE e.id=p_event_id;
 IF NOT FOUND OR v_tenant IS NULL THEN denial_reason:='event_or_tenant_not_found'; RETURN NEXT; RETURN; END IF;
 tenant_id:=v_tenant;
 SELECT au.id INTO v_admin FROM public.admin_users AS au WHERE au.user_id=p_actor_auth_user_id AND au.is_active;
 IF NOT FOUND THEN denial_reason:='inactive_or_missing_admin'; RETURN NEXT; RETURN; END IF;
 IF v_task.platform_inherits AND public.has_platform_admin_authority(p_actor_auth_user_id) THEN allowed:=true; decision_branch:='platform'; RETURN NEXT; RETURN; END IF;
 IF v_task.tenant_inherits AND public.has_tenant_admin_authority(p_actor_auth_user_id,v_tenant) THEN allowed:=true; decision_branch:='tenant'; RETURN NEXT; RETURN; END IF;
 IF NOT v_task.event_assignment_grantable THEN denial_reason:='task_not_event_grantable'; RETURN NEXT; RETURN; END IF;
 SELECT aea.id INTO v_access FROM public.admin_event_access AS aea WHERE aea.admin_user_id=v_admin AND aea.event_id=p_event_id;
 IF NOT FOUND THEN denial_reason:='no_event_assignment'; RETURN NEXT; RETURN; END IF;
 admin_event_access_id:=v_access;
 SELECT aep.id INTO v_grant FROM public.admin_event_permissions AS aep WHERE aep.admin_event_access_id=v_access AND aep.permission_key=p_task_key AND aep.is_enabled;
 IF NOT FOUND THEN denial_reason:='task_not_granted'; RETURN NEXT; RETURN; END IF;
 allowed:=true; decision_branch:='event_grant'; admin_event_permission_id:=v_grant; RETURN NEXT;
END $$;

COMMIT;
