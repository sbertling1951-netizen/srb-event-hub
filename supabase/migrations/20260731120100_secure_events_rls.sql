-- Remove anonymous event creation immediately. Public event-read policies are
-- intentionally deferred to a tenant-aware member/public access migration;
-- their continued presence is transitional, not approval of the final model.
--
-- Governed migration-history exception: "Public insert events" predates this
-- repository's migration history -- no migration here ever creates it, so it
-- must have been established directly in the linked production database
-- before migration-based tracking began. An unconditional DROP POLICY only
-- succeeds where that pre-existing object happens to be present; on a fresh
-- replay, where public.events carries no such policy, the same statement
-- fails. The fix generalizes the same intent -- "this named policy must not
-- exist afterward" -- so it succeeds whether or not the policy was already
-- present, while still guaranteeing the same end state either way. Because
-- this migration's version is already recorded as applied in the linked
-- production database, this change affects only fresh-replay behavior; it
-- does not and cannot cause the migration to run again there.

DROP POLICY IF EXISTS "Public insert events" ON public.events;
