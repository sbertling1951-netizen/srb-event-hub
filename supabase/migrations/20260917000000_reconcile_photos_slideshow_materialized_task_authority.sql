-- Photos / Slideshow materialized-grant reconciliation.
--
-- ── The gap ───────────────────────────────────────────────────────────────
-- The canonical Event Task-Authority model (20260811170000) resolves an
-- Event-scoped mutation task for a non-Platform / non-Tenant admin by
-- requiring an explicit, is_enabled row in public.admin_event_permissions
-- (resolve_task_authority, branch 'event_grant'). Those rows are
-- *materialized* from the profile's default bundle
-- (public.admin_event_profile_tasks) at assignment-creation /
-- bulk-materialization time -- NOT read live from the template.
--
-- The approved initial 12-assignment bulk materialization
-- (20260811220000 / …221000 / …222000, executor v_bundle_e) froze the
-- event_admin bundle as the 24-task set that existed at 20260811170000.
-- Two later migrations added tasks to the canonical event_admin AND content
-- profile templates but shipped no backfill:
--
--   * 20260811390000 → 'event.photos.manage'    (event_admin, content)
--   * 20260811400000 → 'event.slideshow.manage' (event_admin, content)
--
-- Net effect in the field: an admin holding the event_admin (or content)
-- profile whose assignment predates those migrations has an
-- admin_event_access row but NO admin_event_permissions row for these two
-- tasks, so has_event_task_authority() returns false and
-- /admin/photos, /admin/photo-library and /admin/slideshow render
-- "No permission" — even though the canonical model says that profile holds
-- the task. Every other event-scoped page works because its task WAS in the
-- frozen 24-task bundle.
--
-- ── What this migration does ─────────────────────────────────────────────
-- Reconciles the *materialized* grants to the *already-approved* profile
-- template, for these two tasks only, for the event_admin and content
-- profiles only. It adds only MISSING enabled rows (ON CONFLICT DO NOTHING);
-- every existing grant — profile default, manual, or exception — is left
-- exactly as-is. It writes normal immutable authority-audit rows.
--
-- ── What this migration does NOT do ─────────────────────────────────────
--   * does not touch resolve_task_authority / has_event_task_authority
--   * does not touch any route guard, nav visibility, or RLS policy
--   * does not touch the legacy is_event_scoped_admin photo-read path
--   * does not grant 'event.photos.delete' (registered but deliberately
--     assigned to no profile — 20260811390000 §1)
--   * does not create any tenant-admin-specific row. A Tenant Admin over the
--     Event's Tenant is ALREADY allowed both tasks by the canonical
--     resolver's 'tenant' branch (both tasks are tenant_inherits=true, and
--     that branch returns BEFORE the admin_event_permissions check) — no
--     backfill is needed or written for that path.
--   * does not touch checkin / parking / view_only assignments — those
--     profiles are deliberately NOT granted these tasks (20260811390000 §
--     profile-mapping, 20260811400000 §profile-mapping) and that narrowing
--     is preserved.
--
-- ── Provenance ──────────────────────────────────────────────────────────
-- New rows carry grant_source='profile_materialization' (they ARE
-- profile-default grants being materialized), source_profile_key=<role>,
-- and materialization_version='20260917-photos-slideshow-reconcile-v1' —
-- the same shape 20260811220000 used, with a distinct version string so
-- these rows are unambiguously attributable to this reconciliation.
--
-- ── Idempotence & fresh replay ─────────────────────────────────────────
-- ON CONFLICT DO NOTHING + NOT EXISTS makes re-application a no-op. On a
-- from-zero replay admin_event_access is empty (no migration seeds it), so
-- this migration inserts nothing and the post-condition is vacuously
-- satisfied. Applied against any database that carries real event_admin /
-- content assignments (production, or a restored snapshot), the
-- fail-closed post-condition below aborts the transaction if ANY such
-- assignment is still missing ANY task its canonical template lists —
-- catching this class of template-vs-materialized drift for good.

BEGIN;

DO $reconcile$
DECLARE
  v_version     text := '20260917-photos-slideshow-reconcile-v1';
  v_correlation uuid := gen_random_uuid();
  v_reason      text := 'Reconcile materialized event_admin/content grants for '
                     || 'event.photos.manage and event.slideshow.manage: both tasks were added to '
                     || 'the canonical profile template (20260811390000, 20260811400000) after the '
                     || '20260811 approved 12-assignment bulk materialization was frozen, with no backfill.';
  v_tasks       text[] := ARRAY['event.photos.manage', 'event.slideshow.manage'];
  v_profiles    text[] := ARRAY['content', 'event_admin'];
  v_task        text;
  v_granted     integer := 0;
  v_still_missing integer;
BEGIN
  -- Defence in depth: admin_event_permissions' ACLs are already closed to
  -- every application role; this block only ever runs as the migration
  -- owner. Reject anything else even if a grant were mistakenly added.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'reconcile_photos_slideshow_materialized_task_authority may only run as the migration owner role';
  END IF;

  -- ── Drift guard 1: both tasks are registered with exactly the canonical
  --    event-scope mutation shape (platform+tenant inherit, event-grantable).
  FOREACH v_task IN ARRAY v_tasks LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_task_registry
      WHERE task_key = v_task
        AND is_active
        AND scope = 'event'
        AND task_kind = 'mutation'
        AND platform_inherits
        AND tenant_inherits
        AND event_assignment_grantable
    ) THEN
      RAISE EXCEPTION
        'task-registry drift: % is not the expected active, event-grantable, platform+tenant-inheriting canonical task (ABORT)',
        v_task;
    END IF;
  END LOOP;

  -- ── Drift guard 2: the profile template grants BOTH tasks to EXACTLY
  --    {content, event_admin} and to no other profile.
  FOREACH v_task IN ARRAY v_tasks LOOP
    IF (
      SELECT array_agg(profile_key ORDER BY profile_key)
      FROM public.admin_event_profile_tasks
      WHERE task_key = v_task
    ) IS DISTINCT FROM ARRAY['content', 'event_admin'] THEN
      RAISE EXCEPTION
        'profile-template drift: % is not granted to exactly {content, event_admin} (ABORT)',
        v_task;
    END IF;
  END LOOP;

  -- ── Drift guard 3: event.photos.delete stays assigned to no profile.
  IF EXISTS (
    SELECT 1 FROM public.admin_event_profile_tasks WHERE task_key = 'event.photos.delete'
  ) THEN
    RAISE EXCEPTION
      'event.photos.delete has acquired a profile grant (ABORT) (this reconciliation must never materialize it)';
  END IF;

  -- ── The reconcile + its audit, one atomic statement. Only (assignment,
  --    task) pairs where the assignment's profile is event_admin/content AND
  --    no admin_event_permissions row exists yet. is_enabled defaults true
  --    (admin_event_permissions_live_grant_check). The audit CTE inserts one
  --    immutable 'task_granted' row per grant THIS run actually created
  --    (driven off `inserted`'s RETURNING, not a re-scan), so a re-applied
  --    migration -- ON CONFLICT DO NOTHING -> zero inserted -> zero audited.
  WITH targets AS (
    SELECT aea.id AS access_id, aea.role AS profile_key, t.task_key
    FROM public.admin_event_access AS aea
    CROSS JOIN LATERAL unnest(v_tasks) AS t(task_key)
    WHERE aea.role = ANY(v_profiles)
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_event_permissions AS p
        WHERE p.admin_event_access_id = aea.id
          AND p.permission_key = t.task_key
      )
  ),
  inserted AS (
    INSERT INTO public.admin_event_permissions
      (admin_event_access_id, permission_key, granted_by_admin_user_id,
       grant_source, source_profile_key, materialization_version)
    SELECT access_id, task_key, NULL,
           'profile_materialization', profile_key, v_version
    FROM targets
    ON CONFLICT (admin_event_access_id, permission_key) DO NOTHING
    RETURNING admin_event_access_id, permission_key
  ),
  audited AS (
    INSERT INTO public.admin_authority_audit
      (correlation_id, actor_auth_user_id, actor_admin_user_id, target_admin_user_id,
       tenant_id, event_id, admin_event_access_id, task_key, profile_after,
       action, new_state, reason, materialization_version)
    SELECT v_correlation, NULL, NULL, aea.admin_user_id,
           e.tenant_id, aea.event_id, i.admin_event_access_id, i.permission_key, aea.role,
           'task_granted',
           jsonb_build_object(
             'source', 'profile_materialization',
             'reconciliation', true,
             'materialization_version', v_version
           ),
           v_reason, v_version
    FROM inserted AS i
    JOIN public.admin_event_access AS aea ON aea.id = i.admin_event_access_id
    JOIN public.events AS e ON e.id = aea.event_id
    RETURNING 1
  )
  SELECT count(*) INTO v_granted FROM inserted;

  -- ── Fail-closed post-condition. After this migration, EVERY event_admin
  --    and content assignment must hold an is_enabled grant for EVERY task
  --    its canonical profile template lists -- not merely the two handled
  --    here. Any residual gap (e.g. a future task added to these templates
  --    without its own backfill) aborts the whole transaction.
  SELECT count(*) INTO v_still_missing
  FROM public.admin_event_access AS aea
  JOIN public.admin_event_profile_tasks AS pt ON pt.profile_key = aea.role
  WHERE aea.role = ANY(v_profiles)
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_event_permissions AS p
      WHERE p.admin_event_access_id = aea.id
        AND p.permission_key = pt.task_key
        AND p.is_enabled
    );

  IF v_still_missing <> 0 THEN
    RAISE EXCEPTION
      'post-reconcile invariant violation: % event_admin/content (assignment, task) pair(s) are still missing a materialized grant their canonical profile template requires (ABORT)',
      v_still_missing;
  END IF;

  RAISE NOTICE
    'photos/slideshow task-authority reconcile: % missing grant row(s) materialized (correlation %, version %)',
    v_granted, v_correlation, v_version;
END
$reconcile$;

COMMIT;
