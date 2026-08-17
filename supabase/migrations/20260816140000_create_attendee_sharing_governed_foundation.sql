-- Granular Attendee Sharing: replaces the single all-or-nothing
-- attendees.share_with_attendees boolean with a governed, field-level
-- registry and Person x Event (attendee-record-scoped) preference model,
-- per the approved Attendee Sharing Architecture.
--
-- attendees.share_with_attendees is retained, unwritten by any path this
-- migration touches, as a read-only legacy projection during transition --
-- the same "governed compatibility projection, not a second source of
-- truth" pattern already used for attendees.assigned_site.
--
-- V1 locked scope (business decisions, not re-derived here):
--   - Sharing preferences are Person x Event / participation scoped and do
--     not carry across Events.
--   - Name is mandatory participation identity: turning on any optional
--     field implies Name is shared; sharing nothing means the attendee is
--     not exposed and cannot view others' shared information.
--   - V1 optional fields: email, phone, campsite_location, coach_make_model
--     (make + model only -- no length, year, VIN, or plate).
--   - Household members and the Co-pilot's own identity are explicitly
--     excluded: a Pilot's participation must never expose them, and no
--     independent Person-level consent mechanism exists for either today.
--     This migration therefore returns Pilot identity only from every
--     surface it touches, and retires get_event_locator_household_members
--     from live use rather than adapting it.
--   - Campsite must resolve through governed parking_sites occupancy
--     (record_site_placement's own canonical source), never the unmigrated
--     free-text attendees.assigned_site projection.
--   - Legacy CSV "share email with other attendees = Yes" maps only to
--     Name + Email; "No" maps to full non-participation. No broader
--     consent is inferred for any newly introduced field.

BEGIN;

-- ─── A. Governed field registry ─────────────────────────────────────────

CREATE TABLE public.attendee_sharing_fields (
  field_key text PRIMARY KEY,
  label text NOT NULL,
  is_mandatory_identity boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.attendee_sharing_fields
  (field_key, label, is_mandatory_identity, sort_order)
VALUES
  ('name', 'Name', true, 0),
  ('email', 'Email', false, 1),
  ('phone', 'Phone', false, 2),
  ('campsite_location', 'Campsite location', false, 3),
  ('coach_make_model', 'Coach make/model', false, 4);

ALTER TABLE public.attendee_sharing_fields OWNER TO postgres;
ALTER TABLE public.attendee_sharing_fields ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendee_sharing_fields FROM PUBLIC, anon, authenticated, service_role;

-- ─── B. Person x Event (attendee-record-scoped) preference storage ─────
--
-- attendee_id alone is the correct and sufficient scope key: each Event
-- already has its own separate attendees row per participant (the
-- existing model), so no redundant event_id column is stored here --
-- doing so would create a second, driftable copy of what attendees.event_id
-- already authoritatively answers.

CREATE TABLE public.attendee_sharing_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id),
  field_key text NOT NULL REFERENCES public.attendee_sharing_fields(field_key),
  shared boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('legacy_csv_migration', 'admin_checkin', 'member_self_service')),
  changed_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  changed_by_auth_user_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendee_sharing_preferences_attendee_field_unique UNIQUE (attendee_id, field_key)
);

CREATE INDEX attendee_sharing_preferences_attendee_idx
  ON public.attendee_sharing_preferences (attendee_id);

ALTER TABLE public.attendee_sharing_preferences OWNER TO postgres;
ALTER TABLE public.attendee_sharing_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendee_sharing_preferences FROM PUBLIC, anon, authenticated, service_role;

-- Append-only evidence of who changed which field, when, from what to
-- what, and through which surface -- the minimum needed to prove consent
-- state and investigate a dispute. No row is ever written for a call that
-- did not actually change a value.

CREATE TABLE public.attendee_sharing_preference_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id),
  field_key text NOT NULL REFERENCES public.attendee_sharing_fields(field_key),
  previous_shared boolean,
  resulting_shared boolean NOT NULL,
  source text NOT NULL,
  actor_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  actor_auth_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendee_sharing_preference_history_attendee_idx
  ON public.attendee_sharing_preference_history (attendee_id, occurred_at);

ALTER TABLE public.attendee_sharing_preference_history OWNER TO postgres;
ALTER TABLE public.attendee_sharing_preference_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendee_sharing_preference_history FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_attendee_sharing_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
BEGIN
  RAISE EXCEPTION 'attendee_sharing_preference_history is immutable';
END
$$;

CREATE TRIGGER prevent_attendee_sharing_history_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.attendee_sharing_preference_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_attendee_sharing_history_mutation();

-- ─── D. Governed preference mutation ────────────────────────────────────
--
-- Internal helper: the one place that validates keys against the
-- registry, computes participation, upserts every registered field, and
-- writes history only where a value actually changed. Not directly
-- callable by any client role -- entry points below establish actor
-- authority first, exactly as record_site_placement's own trusted
-- report handoff does for Site Placement.

CREATE OR REPLACE FUNCTION public._apply_attendee_sharing_preferences(
  p_attendee_id uuid,
  p_shared_field_keys text[],
  p_source text,
  p_actor_admin_user_id uuid,
  p_actor_auth_user_id uuid
)
RETURNS TABLE(
  outcome text,
  attendee_id uuid,
  shared_field_keys text[],
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_keys text[];
  v_participates boolean;
  v_field record;
  v_previous boolean;
  v_resulting boolean;
BEGIN
  IF p_attendee_id IS NULL OR p_source IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.attendees WHERE id = p_attendee_id) THEN
    RAISE EXCEPTION 'attendee_not_found';
  END IF;

  SELECT coalesce(array_agg(DISTINCT k), ARRAY[]::text[])
    INTO v_keys
  FROM unnest(coalesce(p_shared_field_keys, ARRAY[]::text[])) AS k;

  -- Every requested key must be a currently-active, non-mandatory
  -- registry key, or the entire call fails closed with no partial write --
  -- an unregistered key has nothing to mean and nothing to grant.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_keys) AS requested(key)
    LEFT JOIN public.attendee_sharing_fields AS f
      ON f.field_key = requested.key
     AND f.is_active
     AND NOT f.is_mandatory_identity
    WHERE f.field_key IS NULL
  ) THEN
    RAISE EXCEPTION 'unknown_share_field';
  END IF;

  v_participates := coalesce(array_length(v_keys, 1), 0) > 0;

  FOR v_field IN
    SELECT field_key, is_mandatory_identity
    FROM public.attendee_sharing_fields
    WHERE is_active
  LOOP
    v_resulting := CASE
      WHEN v_field.is_mandatory_identity THEN v_participates
      ELSE v_field.field_key = ANY (v_keys)
    END;

    SELECT shared INTO v_previous
    FROM public.attendee_sharing_preferences
    WHERE attendee_id = p_attendee_id AND field_key = v_field.field_key;

    INSERT INTO public.attendee_sharing_preferences (
      attendee_id, field_key, shared, source,
      changed_by_admin_user_id, changed_by_auth_user_id, changed_at
    ) VALUES (
      p_attendee_id, v_field.field_key, v_resulting, p_source,
      p_actor_admin_user_id, p_actor_auth_user_id, now()
    )
    ON CONFLICT (attendee_id, field_key) DO UPDATE
    SET shared = excluded.shared,
        source = excluded.source,
        changed_by_admin_user_id = excluded.changed_by_admin_user_id,
        changed_by_auth_user_id = excluded.changed_by_auth_user_id,
        changed_at = excluded.changed_at;

    IF v_previous IS DISTINCT FROM v_resulting THEN
      INSERT INTO public.attendee_sharing_preference_history (
        attendee_id, field_key, previous_shared, resulting_shared,
        source, actor_admin_user_id, actor_auth_user_id
      ) VALUES (
        p_attendee_id, v_field.field_key, v_previous, v_resulting,
        p_source, p_actor_admin_user_id, p_actor_auth_user_id
      );
    END IF;
  END LOOP;

  RETURN QUERY SELECT 'applied'::text, p_attendee_id, v_keys, NULL::text;
END;
$$;

ALTER FUNCTION public._apply_attendee_sharing_preferences(uuid, text[], text, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._apply_attendee_sharing_preferences(uuid, text[], text, uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- Admin Check-In entry point. Authority is re-derived server-side on
-- every call, exactly as complete_admin_checkin already does for
-- placement and arrival -- a stale UI permission cache can never produce
-- a false write. Parameterized by an explicit field-key list (never a
-- hidden "share everything" flag) so a future member self-service entry
-- point can call the same internal helper with source =
-- 'member_self_service' and its own actor resolution, without redesign.

CREATE OR REPLACE FUNCTION public.set_attendee_sharing_preferences(
  p_attendee_id uuid,
  p_expected_event_id uuid,
  p_shared_field_keys text[]
)
RETURNS TABLE(
  outcome text,
  attendee_id uuid,
  shared_field_keys text[],
  rejection_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_admin_id uuid;
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL OR p_attendee_id IS NULL OR p_expected_event_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT a.event_id INTO v_event_id
  FROM public.attendees AS a
  WHERE a.id = p_attendee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendee_not_found';
  END IF;

  IF v_event_id <> p_expected_event_id THEN
    RAISE EXCEPTION 'event_scope_mismatch';
  END IF;

  IF NOT public.has_event_task_authority('event.checkin.manage', v_event_id)
     AND NOT public.has_event_task_authority('event.parking.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  SELECT au.id INTO v_admin_id
  FROM public.admin_users AS au
  WHERE au.user_id = v_actor AND au.is_active;

  RETURN QUERY
  SELECT * FROM public._apply_attendee_sharing_preferences(
    p_attendee_id, p_shared_field_keys, 'admin_checkin', v_admin_id, v_actor
  );
END;
$$;

ALTER FUNCTION public.set_attendee_sharing_preferences(uuid, uuid, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_attendee_sharing_preferences(uuid, uuid, text[])
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_attendee_sharing_preferences(uuid, uuid, text[])
TO authenticated;

-- Admin Check-In's own read path: current preference state for every
-- attendee in the working Event, so the sharing panel can preserve
-- imported/current choices as its initial state rather than defaulting
-- blank. Same authority derivation as the write path above.

CREATE OR REPLACE FUNCTION public.get_admin_attendee_sharing_preferences(p_event_id uuid)
RETURNS TABLE(
  attendee_id uuid,
  field_key text,
  shared boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.has_event_task_authority('event.checkin.manage', p_event_id)
     AND NOT public.has_event_task_authority('event.parking.manage', p_event_id) THEN
    RAISE EXCEPTION 'authorization_denied';
  END IF;

  RETURN QUERY
  SELECT p.attendee_id, p.field_key, p.shared
  FROM public.attendee_sharing_preferences AS p
  JOIN public.attendees AS a ON a.id = p.attendee_id
  WHERE a.event_id = p_event_id;
END;
$$;

ALTER FUNCTION public.get_admin_attendee_sharing_preferences(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_attendee_sharing_preferences(uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_attendee_sharing_preferences(uuid)
TO authenticated;

-- ─── C. Legacy backfill ──────────────────────────────────────────────────
--
-- share_with_attendees = true captured consent to share email only --
-- migrates to Name (the mandatory participation identity a Yes clearly
-- intended) + Email, nothing else. share_with_attendees = false or null
-- migrates to full non-participation. No newly introduced field inherits
-- consent it was never asked for. Set-based and ON CONFLICT-safe so a
-- re-run inserts nothing further and writes no duplicate history.

WITH backfill AS (
  SELECT
    a.id AS attendee_id,
    f.field_key,
    CASE
      WHEN f.field_key IN ('name', 'email') THEN coalesce(a.share_with_attendees, false)
      ELSE false
    END AS shared
  FROM public.attendees AS a
  CROSS JOIN public.attendee_sharing_fields AS f
  WHERE f.is_active
),
inserted AS (
  INSERT INTO public.attendee_sharing_preferences (
    attendee_id, field_key, shared, source, changed_at
  )
  SELECT attendee_id, field_key, shared, 'legacy_csv_migration', now()
  FROM backfill
  ON CONFLICT (attendee_id, field_key) DO NOTHING
  RETURNING attendee_id, field_key, shared
)
INSERT INTO public.attendee_sharing_preference_history (
  attendee_id, field_key, previous_shared, resulting_shared, source
)
SELECT attendee_id, field_key, NULL, shared, 'legacy_csv_migration'
FROM inserted;

-- ─── E/F/G. Governed attendee-sharing read contract ─────────────────────
--
-- Both surfaces below share the identical masking shape: a field is
-- returned only when the target's own attendee_sharing_preferences row
-- for that key is shared = true, resolved entirely in SQL. An unshared
-- field is NULL in the result itself -- there is no client-side branch
-- left to bypass, and campsite/location resolves through the governed
-- parking_sites occupancy (record_site_placement's own canonical source),
-- never the unmigrated free-text attendees.assigned_site projection.
--
-- Return shapes change from what these functions returned before, so
-- each is dropped and recreated rather than replaced in place.

DROP FUNCTION IF EXISTS public.get_event_attendee_locator(uuid, text, text);

CREATE OR REPLACE FUNCTION public.get_event_attendee_locator(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  pilot_first text,
  pilot_last text,
  email text,
  phone text,
  campsite_location text,
  coach_make text,
  coach_model text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_caller_attendee_id uuid;
  v_caller_participates boolean;
BEGIN
  -- (A) Requester has legitimate Event access -- unchanged: the same
  -- identity resolver every attendee-facing RPC already shares.
  v_caller_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_caller_attendee_id IS NULL THEN
    RETURN;
  END IF;

  -- (B) Requester participates in sharing -- share to see.
  SELECT shared INTO v_caller_participates
  FROM public.attendee_sharing_preferences
  WHERE attendee_id = v_caller_attendee_id AND field_key = 'name';

  IF NOT coalesce(v_caller_participates, false) THEN
    RETURN;
  END IF;

  -- (C)/(D)/(E) Target participates, target's own field-level choices,
  -- Event scope, and the attendee-record identity boundary -- resolved
  -- together in one query, one row per participating target.
  RETURN QUERY
  SELECT
    a.id,
    CASE WHEN name_pref.shared THEN a.pilot_first ELSE NULL END,
    CASE WHEN name_pref.shared THEN a.pilot_last ELSE NULL END,
    CASE WHEN email_pref.shared THEN a.email ELSE NULL END,
    CASE WHEN phone_pref.shared THEN coalesce(a.primary_phone, a.cell_phone) ELSE NULL END,
    CASE WHEN campsite_pref.shared THEN site.display_label ELSE NULL END,
    CASE WHEN coach_pref.shared THEN a.coach_manufacturer ELSE NULL END,
    CASE WHEN coach_pref.shared THEN a.coach_model ELSE NULL END
  FROM public.attendees AS a
  JOIN public.events AS e ON e.id = a.event_id
  JOIN public.attendee_sharing_preferences AS name_pref
    ON name_pref.attendee_id = a.id AND name_pref.field_key = 'name'
  LEFT JOIN public.attendee_sharing_preferences AS email_pref
    ON email_pref.attendee_id = a.id AND email_pref.field_key = 'email'
  LEFT JOIN public.attendee_sharing_preferences AS phone_pref
    ON phone_pref.attendee_id = a.id AND phone_pref.field_key = 'phone'
  LEFT JOIN public.attendee_sharing_preferences AS campsite_pref
    ON campsite_pref.attendee_id = a.id AND campsite_pref.field_key = 'campsite_location'
  LEFT JOIN public.attendee_sharing_preferences AS coach_pref
    ON coach_pref.attendee_id = a.id AND coach_pref.field_key = 'coach_make_model'
  LEFT JOIN public.parking_sites AS site
    ON site.event_id = a.event_id AND site.assigned_attendee_id = a.id
  WHERE a.event_id = p_event_id
    AND name_pref.shared = true
    AND coalesce(a.is_active, true) = true
    AND coalesce(a.registration_status, '') IN ('active', 'registered')
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
END;
$$;

ALTER FUNCTION public.get_event_attendee_locator(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_event_attendee_locator(uuid, text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_attendee_locator(uuid, text, text) TO anon, authenticated;

-- Household members are explicitly out of the granular sharing contract
-- (a Pilot's participation must never expose them, and no independent
-- consent mechanism exists for them today). Rather than adapt this
-- function to a masking model it was never designed for, its only
-- attendee-sharing caller is removed and its execute grants are revoked
-- so it is no longer reachable through this surface at all. The function
-- body is left intact -- repair forward, not an edit to an applied
-- migration -- in case a future, separately governed need for
-- self-household reads (e.g. get_my_household_members's own,
-- unaffected, self-access path) is ever extended here explicitly.

REVOKE EXECUTE ON FUNCTION public.get_event_locator_household_members(uuid, text, text)
FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.get_event_public_roster(uuid);

CREATE OR REPLACE FUNCTION public.get_event_public_roster(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  pilot_first text,
  pilot_last text,
  coach_make text,
  coach_model text,
  campsite_location text,
  has_arrived boolean,
  arrival_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  -- No caller identity is resolved here -- this remains the deliberate,
  -- pre-existing one-way opt-in broadcast feed (coach map / public coach
  -- map), never the reciprocal Locator. Arrival is independent of Site
  -- Placement and sharing under the Accepted Site Placement Governance
  -- Architecture, so has_arrived/arrival_status are left untouched; every
  -- other column is now masked per the target's own field-level choice
  -- exactly as the Locator masks them, replacing the old all-or-nothing
  -- blanket sharing flag.
  SELECT
    a.id,
    CASE WHEN name_pref.shared THEN a.pilot_first ELSE NULL END,
    CASE WHEN name_pref.shared THEN a.pilot_last ELSE NULL END,
    CASE WHEN coach_pref.shared THEN a.coach_manufacturer ELSE NULL END,
    CASE WHEN coach_pref.shared THEN a.coach_model ELSE NULL END,
    CASE WHEN campsite_pref.shared THEN site.display_label ELSE NULL END,
    a.has_arrived,
    a.arrival_status
  FROM public.attendees AS a
  JOIN public.events AS e ON e.id = a.event_id
  JOIN public.attendee_sharing_preferences AS name_pref
    ON name_pref.attendee_id = a.id AND name_pref.field_key = 'name'
  LEFT JOIN public.attendee_sharing_preferences AS coach_pref
    ON coach_pref.attendee_id = a.id AND coach_pref.field_key = 'coach_make_model'
  LEFT JOIN public.attendee_sharing_preferences AS campsite_pref
    ON campsite_pref.attendee_id = a.id AND campsite_pref.field_key = 'campsite_location'
  LEFT JOIN public.parking_sites AS site
    ON site.event_id = a.event_id AND site.assigned_attendee_id = a.id
  WHERE a.event_id = p_event_id
    AND name_pref.shared = true
    AND coalesce(a.is_active, true) = true
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
$$;

ALTER FUNCTION public.get_event_public_roster(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_event_public_roster(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_public_roster(uuid) TO anon, authenticated;

COMMIT;
