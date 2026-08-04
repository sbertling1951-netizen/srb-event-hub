-- Member check-in writes are governed exclusively by
-- public.submit_member_checkin(...). Retain authenticated table UPDATE
-- privileges only for the separately scoped administrator policies.
--
-- Governed migration-history exception: these three named policies, and the
-- two parking_sites policies below, predate this repository's migration
-- history -- no migration here ever creates them, so each was established
-- directly in the linked production database before migration-based
-- tracking began (the same pattern already repaired in
-- 20260731120100_secure_events_rls.sql and
-- 20260731120200_create_tenant_hostname_mappings.sql, and already applied
-- to the sibling drops earlier in this same series --
-- 20260801120000_close_anonymous_attendee_update_exposure.sql). An
-- unconditional DROP POLICY only succeeds where that pre-existing object
-- happens to be present; on a fresh replay, where none of these policies
-- exist, the same statements fail. The fix generalizes the same intent --
-- "these named policies must not exist afterward" -- so it succeeds whether
-- or not each policy was already present, while still guaranteeing the same
-- end state either way: no self-service or anonymous direct-write policy
-- remains, and the governed RPC (SECURITY DEFINER, table owner privileges)
-- remains unaffected either way since it never depended on these policies
-- or on the anon grants revoked below. Because this migration's version is
-- already recorded as applied in the linked production database, this
-- change affects only fresh-replay behavior; it does not and cannot cause
-- the migration to run again there.

DROP POLICY IF EXISTS "Members can update own attendee checkin row"
ON public.attendees;

DROP POLICY IF EXISTS "Members can update own attendee row"
ON public.attendees;

DROP POLICY IF EXISTS "Members can update own checkin row"
ON public.attendees;

-- Anonymous callers must not regain direct attendee UPDATE access.
REVOKE UPDATE ON TABLE public.attendees FROM anon;

DROP POLICY IF EXISTS "Public insert parking"
ON public.parking_sites;

DROP POLICY IF EXISTS "Public update parking"
ON public.parking_sites;

REVOKE INSERT, UPDATE ON TABLE public.parking_sites FROM anon;
