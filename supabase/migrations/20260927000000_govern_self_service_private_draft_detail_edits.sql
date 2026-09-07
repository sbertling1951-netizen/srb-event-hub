-- P-3A: the first real organizer planning tool -- a private-draft owner edits
-- her own unfinished event's setup details.
--
-- ONE shared Event engine reached through an organizer-authorized doorway.
-- This is NOT an Event-Admin grant and NOT an FCOC/admin copy:
--   * it never calls has_event_admin_authority / has_tenant_admin_authority;
--   * it never touches admin_users / admin_event_access / admin_tenant_access /
--     person_tenant_administrator_appointments;
--   * it authorizes ONLY against an active self-service private organizer
--     appointment whose subject is the caller's resolved canonical Person
--     (or, for a genuinely unlinked account, that account's own appointment) --
--     the same owner rule as get_my_self_service_private_draft and
--     delete_self_service_organizer_event.
--
-- It updates exactly the P-2A/P-2C editable field set and nothing else:
--   * public.events                         -> name, start_date, end_date,
--                                              timezone, location
--   * public.self_service_private_event_drafts -> location_mode, starter_template
-- Event status / is_active / visible_to_members / event_code, and every
-- tenant / organization field, are never read for change and never written.
-- Capacity (P-2D), deletion (P-2D), RLS policies, tenant resolution, hostname,
-- and auth/session logic are all unchanged.
--
-- Stale-save protection: the caller passes the baseline it loaded; if the
-- persisted row differs, NEITHER table is written and 'stale_draft_details'
-- is raised.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_my_self_service_private_draft_details(
  p_event_id uuid,
  -- proposed values (same field set + rules as create_self_service_organizer_draft)
  p_event_name text,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_location_mode text,
  p_location text,
  p_starter_template text,
  -- expected persisted baseline, as loaded by this editor
  p_expected_event_name text,
  p_expected_start_date date,
  p_expected_end_date date,
  p_expected_timezone text,
  p_expected_location text,
  p_expected_location_mode text,
  p_expected_starter_template text
)
RETURNS TABLE(
  tenant_id uuid,
  organizer_appointment_id uuid,
  organizer_person_id uuid,
  event_id uuid,
  organization_name text,
  event_name text,
  start_date date,
  end_date date,
  timezone text,
  location_mode text,
  location text,
  starter_template text,
  status text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_event_name text := nullif(btrim(p_event_name), '');
  v_timezone text := nullif(btrim(p_timezone), '');
  v_location_mode text := nullif(btrim(p_location_mode), '');
  v_location text := nullif(btrim(p_location), '');
  v_starter_template text := nullif(btrim(p_starter_template), '');
  v_link_status text;
  v_person_id uuid;
  v_event public.events%ROWTYPE;
  v_draft public.self_service_private_event_drafts%ROWTYPE;
  v_appointment_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Saving event details requires an authenticated verified account.';
  END IF;

  -- Same verified-account contract as the create / delete commands.
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Saving event details requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  -- Same validation as draft creation (verbatim messages).
  IF v_event_name IS NULL OR length(v_event_name) > 200 THEN
    RAISE EXCEPTION 'Event name is required and must be 200 characters or fewer.';
  END IF;

  IF p_end_date IS NULL THEN
    RAISE EXCEPTION 'A scheduled Event end date is required.';
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Event end date cannot be before start date.';
  END IF;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names AS tz WHERE tz.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'A valid IANA Event timezone is required.';
  END IF;

  IF v_location_mode NOT IN ('location', 'online', 'no_location') THEN
    RAISE EXCEPTION 'Location mode must be location, online, or no_location.';
  END IF;

  IF v_location_mode = 'location' AND v_location IS NULL THEN
    RAISE EXCEPTION 'A location is required when location mode is location.';
  END IF;

  IF v_location_mode <> 'location' AND v_location IS NOT NULL THEN
    RAISE EXCEPTION 'Location text is allowed only when location mode is location.';
  END IF;

  IF v_location IS NOT NULL AND length(v_location) > 500 THEN
    RAISE EXCEPTION 'Location must be 500 characters or fewer.';
  END IF;

  IF v_starter_template NOT IN (
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity'
  ) THEN
    RAISE EXCEPTION 'Starter template is not recognized.';
  END IF;

  -- Fail-closed identity: exactly-resolved, or a genuinely unlinked account
  -- matched only by its OWN appointment row (same precedence as the read /
  -- delete RPCs).  Anything else is treated as a missing draft.
  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  -- Authorize + lock: a hidden, inactive, non-member-visible Draft in an
  -- active private self-service tenant the caller personally organizes.
  -- Person-scoped when resolved; own-appointment only when no_link.  Locks
  -- the events row and the draft-marker row against a concurrent save/delete.
  SELECT e.*
    INTO v_event
  FROM public.self_service_private_event_drafts AS d
  JOIN public.self_service_organizer_appointments AS oa
    ON oa.id = d.organizer_appointment_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  WHERE d.event_id = p_event_id
    AND oa.is_active = true
    AND (
      (v_link_status = 'resolved' AND oa.person_id = v_person_id)
      OR (v_link_status = 'no_link' AND oa.auth_user_id = v_actor)
    )
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  FOR UPDATE OF e
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT d.*
    INTO v_draft
  FROM public.self_service_private_event_drafts AS d
  WHERE d.event_id = p_event_id
  FOR UPDATE;

  v_appointment_id := v_draft.organizer_appointment_id;

  -- Optimistic stale-save protection: if the persisted baseline differs from
  -- what the editor loaded, write NEITHER table.
  IF v_event.name IS DISTINCT FROM p_expected_event_name
     OR v_event.start_date IS DISTINCT FROM p_expected_start_date
     OR v_event.end_date IS DISTINCT FROM p_expected_end_date
     OR v_event.timezone IS DISTINCT FROM p_expected_timezone
     OR v_event.location IS DISTINCT FROM p_expected_location
     OR v_draft.location_mode IS DISTINCT FROM p_expected_location_mode
     OR v_draft.starter_template IS DISTINCT FROM p_expected_starter_template
  THEN
    RAISE EXCEPTION 'stale_draft_details';
  END IF;

  UPDATE public.events AS e
  SET name = v_event_name,
      start_date = p_start_date,
      end_date = p_end_date,
      timezone = v_timezone,
      location = v_location
  WHERE e.id = p_event_id;

  UPDATE public.self_service_private_event_drafts AS d
  SET location_mode = v_location_mode,
      starter_template = v_starter_template
  WHERE d.event_id = p_event_id;

  -- Return the same safe draft shape get_my_self_service_private_draft returns,
  -- re-validating every draft / private / active predicate.
  RETURN QUERY
  SELECT
    t.id,
    oa.id,
    oa.person_id,
    e.id,
    t.organization_name,
    e.name,
    e.start_date,
    e.end_date,
    e.timezone,
    d.location_mode,
    e.location,
    d.starter_template,
    e.status,
    e.is_active,
    e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.id = v_appointment_id
    AND oa.is_active = true
    AND d.event_id = p_event_id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;
END;
$function$;

ALTER FUNCTION public.save_my_self_service_private_draft_details(
  uuid, text, date, date, text, text, text, text, text, date, date, text, text, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.save_my_self_service_private_draft_details(
  uuid, text, date, date, text, text, text, text, text, date, date, text, text, text, text
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.save_my_self_service_private_draft_details(
  uuid, text, date, date, text, text, text, text, text, date, date, text, text, text, text
) TO authenticated;

COMMIT;
