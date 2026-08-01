-- Remove anonymous event creation immediately. Public event-read policies are
-- intentionally deferred to a tenant-aware member/public access migration;
-- their continued presence is transitional, not approval of the final model.

DROP POLICY "Public insert events" ON public.events;
