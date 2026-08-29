-- Member My Check-In (and Admin Check-In) sharing-preference save failed
-- for every caller: "Your check-in was saved, but your sharing choice
-- could not be saved."
--
-- Root cause: public._apply_attendee_sharing_preferences -- the one
-- internal helper both the member entry point
-- (set_member_attendee_sharing_preferences, 20260816150000) and the admin
-- entry point (set_attendee_sharing_preferences, 20260816140000) delegate
-- to -- declares a RETURNS TABLE column named "attendee_id". Under the
-- default plpgsql.variable_conflict = error that implicit OUT variable
-- collides with public.attendee_sharing_preferences.attendee_id in two
-- statements inside the per-field loop:
--
--   1. SELECT shared INTO v_previous
--        FROM public.attendee_sharing_preferences
--       WHERE attendee_id = p_attendee_id ...      -- 42702, ambiguous
--   2. INSERT ... ON CONFLICT (attendee_id, field_key) DO UPDATE ...
--                              ^^^^^^^^^^^ inference clause -- 42702
--
-- Every call raised 42702 before writing anything, so the granular
-- attendee_sharing_preferences registry (which get_event_attendee_locator
-- and get_event_public_roster actually read) has been unwritable by any
-- surface since 20260816140000. The primary check-in write succeeds
-- because submit_member_checkin updates only attendees.share_with_attendees
-- directly and never calls this helper.
--
-- Narrowest canonical repair, at the actual broken boundary, following the
-- repository's stated preference for explicit qualification over
-- #variable_conflict (see 20260903000000):
--   - qualify the SELECT's predicate through a table alias;
--   - target the ON CONFLICT arbiter by its existing constraint name
--     (attendee_sharing_preferences_attendee_field_unique, 20260816140000)
--     rather than a column-inference list, which cannot be table-qualified.
--
-- Nothing else changes: same signature, same RETURNS TABLE shape (the
-- external contract both wrappers expose is unchanged), same SECURITY
-- DEFINER owner and grants, same validation (unknown_share_field still
-- fails closed with no partial write), same participation/mandatory-identity
-- logic, same append-only history. No table, RLS, grant, authority, or
-- identity-contract change. Parking placement is untouched -- this helper
-- has never written parking_sites or attendees.assigned_site.

BEGIN;

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

    -- Qualified through the alias: an unqualified "attendee_id" here is
    -- ambiguous against this function's RETURNS TABLE OUT column of the
    -- same name.
    SELECT pref.shared INTO v_previous
    FROM public.attendee_sharing_preferences AS pref
    WHERE pref.attendee_id = p_attendee_id
      AND pref.field_key = v_field.field_key;

    -- ON CONFLICT arbitration by constraint name: a column-inference list
    -- "(attendee_id, field_key)" hits the same OUT-column ambiguity and
    -- cannot be table-qualified.
    INSERT INTO public.attendee_sharing_preferences (
      attendee_id, field_key, shared, source,
      changed_by_admin_user_id, changed_by_auth_user_id, changed_at
    ) VALUES (
      p_attendee_id, v_field.field_key, v_resulting, p_source,
      p_actor_admin_user_id, p_actor_auth_user_id, now()
    )
    ON CONFLICT ON CONSTRAINT attendee_sharing_preferences_attendee_field_unique DO UPDATE
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

COMMIT;
