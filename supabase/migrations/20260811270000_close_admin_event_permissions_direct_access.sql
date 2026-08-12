-- Reconciles migration history with a production correction already
-- applied manually via the Supabase SQL Editor: the last remaining
-- application-facing RLS policy on the canonical Event-task grant store
-- (public.admin_event_permissions) has been removed. Table ACLs were
-- already closed to PUBLIC/anon/authenticated/service_role by
-- 20260811170000_create_scoped_task_authority_foundation.sql; all reads
-- and writes to this table go through governed SECURITY DEFINER
-- functions (resolve_task_authority, has_event_task_authority,
-- list_effective_event_capabilities, create/change/grant/revoke/remove
-- event authority RPCs, list_event_authority_assignments), which run as
-- table owner and are unaffected by RLS policy presence or absence.
--
-- IF EXISTS is required: production already lacks this policy (dropped
-- manually), so this statement is a no-op there recording the migration
-- version; a fresh replay still carries the policy from
-- 20260811170000 and needs the actual drop performed here.

DROP POLICY IF EXISTS "Admins can manage admin_event_permissions"
ON public.admin_event_permissions;
