-- Presentation/Slideshow Authority Foundation Stage 2: adds the
-- event.slideshow.manage Task Authority governing live presenter
-- console access. Stage 1's audit found /admin/slideshow ungoverned:
-- zero admin_task_registry rows named slideshow or presentation, and
-- the page itself has no AdminRouteGuard at all (unlike every sibling
-- /admin/* page). This migration establishes only the governance
-- boundary -- no durable presentation session/deck schema, no
-- Realtime transport, no viewer change. Those are later stages.
BEGIN;

INSERT INTO public.admin_task_registry
  (task_key, scope, task_kind, description, platform_inherits, tenant_inherits, event_assignment_grantable)
VALUES
  ('event.slideshow.manage', 'event', 'mutation',
   'Control live Event presentation/slideshow operation: start, stop, advance, and presenter console access for the audience screen.',
   true, true, true);

-- Profile mapping mirrors 20260811390000's own event.photos.manage
-- reasoning exactly: event_admin (its bundle is every event-scope task
-- except validation_rules.manage, per 20260811170000's own INSERT
-- shape) and content -- the closest functional match to "Event
-- Communications" in the fixed five-profile registry (event_admin,
-- content, checkin, parking, view_only; see admin_event_profiles'
-- CHECK constraint). content's existing grant set (agenda,
-- announcements, locations, nearby, event.photos.manage) is exactly
-- the audience-facing Event content surface; live presentation control
-- belongs to that same surface. checkin and parking are narrowly-scoped
-- operational bundles with no thematic connection to presentation
-- control and are deliberately not granted this task, matching the
-- precedent the Photo governance migration itself established.
INSERT INTO public.admin_event_profile_tasks (profile_key, task_key) VALUES
  ('event_admin', 'event.slideshow.manage'),
  ('content', 'event.slideshow.manage');

COMMIT;
