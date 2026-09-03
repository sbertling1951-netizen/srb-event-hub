-- Corrective: remove the leftover blanket per-role unique index on
-- public.attendee_household_members.
--
-- Historical production stored the blanket uniqueness object,
-- attendee_household_members_attendee_role_unique, as a STANDALONE unique
-- index (CREATE UNIQUE INDEX ... (attendee_id, person_role)) -- not a named
-- table CONSTRAINT. 20260921000000_allow_multiple_additional_household_members.sql
-- attempted to remove the same logical object with
--   ALTER TABLE public.attendee_household_members
--     DROP CONSTRAINT IF EXISTS attendee_household_members_attendee_role_unique;
-- which matched no *constraint* by that name in production, so it was
-- skipped (NOTICE: "constraint ... does not exist, skipping") and the index
-- survived. That leftover index kept person_role = 'additional' constrained
-- to one row per attendee, blocking the 0..N Additional Participants model
-- 20260921000000 otherwise delivered (its 9-arg
-- manage_attendee_household_member and its plain-INSERT 'additional' branch
-- of record_participant_capacity_increase applied correctly).
--
-- This migration drops exactly that leftover index. It creates, alters, or
-- recreates NOTHING else.
--
-- After this migration the canonical uniqueness rules for
-- public.attendee_household_members are:
--   * attendee_household_members_singleton_role_uq
--       UNIQUE (attendee_id, person_role) WHERE person_role IN ('pilot','copilot')
--     -- created by 20260921000000. Pilot and Co-Pilot remain at most one
--     per registration.
--   * person_role = 'additional' is intentionally 0..N -- NOT uniquely
--     constrained by (attendee_id, person_role). Each Additional Participant
--     is an individual row identified by attendee_household_members.id and
--     ordered by sort_order.
--
-- Idempotent and safe on a fresh replay: a database built purely from the
-- repository migrations gets the object from 20260617000000 as a table
-- CONSTRAINT (whose backing index carries the same name), and
-- 20260921000000's DROP CONSTRAINT already removes both there -- so this
-- DROP INDEX IF EXISTS is simply a no-op on a fresh replay, and drops the
-- surviving standalone index on the linked production database.
--
-- No table, column, PRIMARY KEY, FOREIGN KEY, CHECK constraint, RLS policy,
-- trigger, function, grant, or row is read or written. No other index is
-- recreated or altered. No attendee data is touched.

BEGIN;

DROP INDEX IF EXISTS public.attendee_household_members_attendee_role_unique;

COMMIT;
