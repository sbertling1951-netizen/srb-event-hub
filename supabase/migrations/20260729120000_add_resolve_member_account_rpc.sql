-- ============================================================
-- Account Login support: resolve_member_account()
--
-- Purpose: let a member who has completed identity activation
-- (Supabase Auth user + person_auth_accounts link + attendees.person_id
-- link) sign in with that Auth session and have the server resolve
-- their own event registrations, without the browser ever asserting
-- a person_id or auth_user_id.
--
-- Authoritative identity path (per architecture rule):
--   auth.uid() -> person_auth_accounts.auth_user_id -> people.id
--   -> attendees.person_id
--
-- attendees.auth_user_id is NOT read or written by this function and
-- remains a non-authoritative, legacy passthrough column consumed only
-- by verify_member_event_login (Event Access).
--
-- Ambiguity handling: public.person_auth_accounts currently carries a
-- table-wide UNIQUE index on auth_user_id
-- (person_auth_accounts_unique_auth_user_id_idx, see
-- 20260724_create_person_identity_foundation.sql), so a given
-- auth.uid() can never have more than one row in this table today,
-- active or otherwise, and this ambiguity case is not currently
-- reachable. This function still fails closed defensively rather than
-- relying on that constraint: it counts the distinct person_id values
-- reachable from active links for the caller and proceeds only when
-- that count is exactly 1. Zero active links, or (should the schema
-- ever allow it) more than one distinct linked person, both result in
-- zero rows being returned, with no signal to the caller distinguishing
-- which case occurred.
--
-- Eligibility rules: mirrors verify_member_event_login exactly, which
-- (as of 20260703_update_verify_member_event_login_for_phone_auth.sql)
-- filters only on event.visible_to_members = true and
-- coalesce(event.is_active, true) = true. It does not filter on any
-- attendees-level field (not registration_status, not cancelled_at,
-- not is_active). This function intentionally reproduces that same,
-- single definition of "may enter the member workspace" rather than
-- introducing a second, stricter one -- Account Login and Event Access
-- must agree on eligibility.
--
-- Tenant scope: public.people carries a nullable tenant_id with no
-- enforcing RLS policy anywhere in this schema; public.attendees and
-- public.events carry no tenant_id column at all. Registrations are
-- event-scoped, not tenant-scoped, and people are effectively
-- platform-global under the current schema. No tenant predicate is
-- added here, matching that existing architecture.
--
-- Security model:
--   - person_auth_accounts and people both have deny-all RLS for both
--     anon and authenticated roles (see 20260724_create_person_identity_foundation.sql).
--     This function is SECURITY DEFINER so it can read across that
--     boundary, but it derives the caller's identity strictly from
--     auth.uid() -- never from a parameter -- and fails closed on any
--     ambiguity in that derivation, so it returns registrations only
--     for the single person unambiguously linked to the caller's own
--     Auth session.
--   - EXECUTE is revoked from PUBLIC and granted only to `authenticated`,
--     so an anonymous (no Supabase Auth session) caller is rejected
--     outright rather than receiving an empty result.
--   - attendees has no RLS policies of its own (pre-existing gap, not
--     introduced here); this function does not change attendees RLS.
--   - No explicit function-ownership convention (ALTER FUNCTION ...
--     OWNER TO ...) exists anywhere else in this repo's migrations, so
--     none is introduced here either; ownership follows the standard
--     Postgres default (the role that executes this migration), same
--     as every other function in this schema.
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_member_account()
RETURNS TABLE(
    attendee_id uuid,
    entry_id text,
    event_id uuid,
    email text,
    pilot_first text,
    pilot_last text,
    copilot_first text,
    copilot_last text,
    has_arrived boolean,
    event_name text,
    venue_name text,
    location text,
    start_date date,
    end_date date,
    lat numeric,
    lng numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_uid uuid;
    v_person_id uuid;
    v_distinct_person_count integer;
BEGIN
    v_uid := auth.uid();

    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    ------------------------------------------------------------------
    -- Fail closed on ambiguous auth links. Never pick one of several
    -- distinct linked people via ORDER BY / LIMIT 1. Multiple active
    -- rows are only acceptable if they all resolve to the same
    -- person_id.
    ------------------------------------------------------------------

    SELECT COUNT(DISTINCT paa.person_id)
      INTO v_distinct_person_count
    FROM public.person_auth_accounts paa
    WHERE paa.auth_user_id = v_uid
      AND paa.status = 'active';

    IF v_distinct_person_count IS DISTINCT FROM 1 THEN
        -- Covers both zero active links and more than one distinct
        -- linked person. No distinction is surfaced to the caller.
        RETURN;
    END IF;

    SELECT paa.person_id
      INTO v_person_id
    FROM public.person_auth_accounts paa
    WHERE paa.auth_user_id = v_uid
      AND paa.status = 'active'
    LIMIT 1;

    -- The linked person record itself must still be active (not merged
    -- away or deactivated).
    IF NOT EXISTS (
        SELECT 1 FROM public.people p
        WHERE p.id = v_person_id
          AND p.status = 'active'
    ) THEN
        RETURN;
    END IF;

    ------------------------------------------------------------------
    -- Return only registrations belonging to this person, using the
    -- same event eligibility rules as verify_member_event_login (no
    -- attendees-level filter; event must be visible_to_members and
    -- active). No other person's data is reachable from this function,
    -- regardless of input, because v_person_id is derived entirely
    -- server-side from auth.uid() with ambiguity failed closed above.
    ------------------------------------------------------------------

    RETURN QUERY
    SELECT
        a.id,
        a.entry_id,
        a.event_id,
        a.email,
        a.pilot_first,
        a.pilot_last,
        a.copilot_first,
        a.copilot_last,
        a.has_arrived,
        e.name,
        e.venue_name,
        e.location,
        e.start_date,
        e.end_date,
        e.lat,
        e.lng
    FROM public.attendees a
    JOIN public.events e
      ON e.id = a.event_id
    WHERE a.person_id = v_person_id
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true
    ORDER BY e.start_date DESC NULLS LAST;

END;
$$;

REVOKE ALL ON FUNCTION public.resolve_member_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_member_account() TO authenticated;
