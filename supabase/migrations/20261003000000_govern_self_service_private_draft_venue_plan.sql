-- P-3E: an owner-only PRIVATE venue / place plan for a self-service
-- organizer's own unfinished private draft.
--
-- This is PLANNING DATA ONLY, exactly as
-- docs/architecture/EPICENTRAX_PRIVATE_VENUE_PLAN_CONTRACT.md requires. A
-- venue plan entry is a place the organizer is THINKING ABOUT. It is not a
-- booking, a hold, a contract, a vendor, an admitted participant, a Nearby
-- place, a map object, a catalog asset, or the Event's location. The required
-- lifecycle boundary is:
--
--   private placeholder venue plan entry
--     -> (later) Shared Planning Catalog venue reference
--     -> (later) explicit governed adoption as the Event's location, and/or
--        an operational relationship
--
-- P-3E implements ONLY the first stage: private placeholders. There is NO
-- catalog browse, NO catalog selection, and deliberately NO catalog_asset_id
-- column yet.
--
-- ===========================================================================
-- THE RULE THAT MATTERS MOST
-- ===========================================================================
-- Marking an entry 'selected' is a PRIVATE NOTE TO SELF. It writes NOTHING
-- outside this table. Specifically, no function in this migration ever writes
-- events.location, events.venue_name, events.street_address, events.lat,
-- events.lng, events.visible_to_members, events.status, or
-- self_service_private_event_drafts.location_mode. Adopting a considered
-- place as the Event's real location remains the owner's separate, deliberate
-- act through the existing governed
-- save_my_self_service_private_draft_details path, with its own
-- optimistic-concurrency baseline. This migration does not touch that path.
--
-- What this migration does NOT do:
--   * it never writes or reads any official Event location field, map object,
--     master map, platform map asset, venue_evidence row, coordinate, or
--     geocode; it performs NO geographic search, distance, or map placement;
--   * it never references vendors, event_vendors, vendor_contacts,
--     vendor_org_access, vendor invitations, candidacy, admission,
--     dispositions, vendor access tokens, the vendor workspace, or vendor
--     catalog authority;
--   * it never references event_nearby_places, nearby_master,
--     tenant_place_relevance, or any member-facing Nearby surface;
--   * it never writes people, person_identifiers, person_auth_accounts,
--     person_role_instances, person_event_participations, attendees,
--     households, registrations, capacity, check-in, parking, notifications,
--     email, invitations, or any public/member visibility;
--   * it never matches a typed place name, address, or contact against any
--     existing place, person, or account;
--   * it adds NO booking, availability, capacity, cost, quote, currency,
--     budget, payment, or Passport field;
--   * it grants NO Event task authority and touches NO admin RPC, admin route
--     guard, or admin UI;
--   * it adds NO command ledger and puts NO place/contact/note content into
--     any deletion audit, URL, log, or user-visible error.
--
-- Authorization is the exact self-service organizer-owner rule already used by
-- _organizer_private_draft_agenda_authorize (P-3B, 20260928000000),
-- _organizer_private_draft_guest_authorize (P-3C, 20260930000000), and
-- _organizer_private_draft_vendor_plan_authorize (P-3D, 20261001000000):
-- authenticated + verified email, resolved verified organizer ownership of the
-- exact event, active self-service organizer appointment, active self-service
-- private tenant, event status Draft, event inactive, event not member-visible.
--
-- The records are event-owned. §7 below extends the governed
-- delete_self_service_organizer_event path to remove them cleanly BEFORE its
-- universal fail-closed child-FK dependency scan, in the same change that
-- introduces the table -- never afterwards.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The narrowly-scoped private-draft venue-plan table.
--    A DEDICATED table for places, per the contract's explicit prohibition on
--    one generic polymorphic planning table: this field set already differs
--    from the Vendor Plan's (a location description here; no cost anywhere).
--    Event-owned (ON DELETE RESTRICT, exactly like the P-3B agenda substrate,
--    the P-3C planned-guest table, the P-3D vendor-plan table, and the draft
--    marker -- the governed deletion path removes children explicitly and the
--    fail-closed scan catches anything unexpected).
--    RLS on + all browser grants revoked: the table is reachable ONLY through
--    the tightly-governed organizer RPCs below (postgres-owned, SECURITY
--    DEFINER), never directly by anon / authenticated / service_role.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_private_draft_venue_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  -- Planning fields only. place_name is required; every other field is an
  -- optional private planning note the organizer typed. None of them is ever
  -- matched against an existing place, person, vendor, or account.
  place_name text NOT NULL
    CHECK (btrim(place_name) <> '' AND length(place_name) <= 200),
  -- DESCRIPTIVE, NOT POSITIONAL. "behind the fairgrounds, gravel lot" is as
  -- valid as a street address. Never geocoded, parsed into coordinates, used
  -- to place a map pin, distance-ranked, or geographically searched.
  location_description text
    CHECK (location_description IS NULL OR (btrim(location_description) <> '' AND length(location_description) <= 500)),
  website text
    CHECK (website IS NULL OR (btrim(website) <> '' AND length(website) <= 500)),
  -- Opaque planner-entered text. Never normalized, matched, resolved, or
  -- indexed for discovery -- held only so the organizer can read it back.
  contact_name text
    CHECK (contact_name IS NULL OR (btrim(contact_name) <> '' AND length(contact_name) <= 200)),
  contact_phone text
    CHECK (contact_phone IS NULL OR (btrim(contact_phone) <> '' AND length(contact_phone) <= 50)),
  -- The contract's three private planning statuses, and only those three --
  -- the same vocabulary the Vendor Plan uses, so the organizer learns one set.
  planning_status text NOT NULL DEFAULT 'considering'
    CHECK (planning_status IN ('considering', 'contacted', 'selected')),
  organizer_note text
    CHECK (organizer_note IS NULL OR (btrim(organizer_note) <> '' AND length(organizer_note) <= 2000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.self_service_private_draft_venue_plans OWNER TO postgres;

COMMENT ON TABLE public.self_service_private_draft_venue_plans IS
  'P-3E private venue/place planning for one self-service organizer Draft. Owner-only planning notes; never the Event''s location, a Nearby place, a map object, or a vendor relationship.';
COMMENT ON COLUMN public.self_service_private_draft_venue_plans.location_description IS
  'Optional free-text description of where the place is. Descriptive, not positional: never geocoded, parsed to coordinates, pinned, or distance-searched.';
COMMENT ON COLUMN public.self_service_private_draft_venue_plans.planning_status IS
  'considering / contacted / selected. A private note to self -- "selected" writes nothing outside this table and never sets the Event location.';

CREATE INDEX self_service_private_draft_venue_plans_event_idx
  ON public.self_service_private_draft_venue_plans (event_id, created_at, id);

ALTER TABLE public.self_service_private_draft_venue_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_private_draft_venue_plans
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Internal helper: authorize the caller as the canonical owner of ONE
--    eligible private-draft Event's venue plan. Raises 'Draft not found.' for
--    every miss (missing / non-owned / non-private / live / member-visible /
--    non-Draft), non-enumerating. Never calls has_event_task_authority,
--    has_tenant_admin_authority, has_vendor_catalog_admin_authority, or any
--    map/Nearby authority. Byte-for-byte the same owner rule as
--    _organizer_private_draft_vendor_plan_authorize (20261001000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_draft_venue_plan_authorize(p_event_id uuid)
RETURNS TABLE(organizer_appointment_id uuid, organizer_person_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_appt uuid;
  v_appt_person uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Editing a venue plan requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Editing a venue plan requires a verified account email.';
  END IF;

  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  SELECT oa.id, oa.person_id
    INTO v_appt, v_appt_person
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
  LIMIT 1;

  IF v_appt IS NULL THEN
    RAISE EXCEPTION 'Draft not found.';
  END IF;

  RETURN QUERY SELECT v_appt, v_appt_person;
END;
$function$;

ALTER FUNCTION public._organizer_private_draft_venue_plan_authorize(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_draft_venue_plan_authorize(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared input validation for one venue plan entry. place_name is REQUIRED and
-- planning_status must be one of the contract's three private statuses;
-- everything else is optional. Length-only checks -- the values are private
-- planning notes and are never format-matched, normalized, geocoded, or
-- resolved against any existing record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_venue_plan_validate(
  p_place_name text, p_location_description text, p_website text,
  p_contact_name text, p_contact_phone text, p_planning_status text,
  p_organizer_note text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_place_name IS NULL OR btrim(p_place_name) = '' OR length(btrim(p_place_name)) > 200 THEN
    RAISE EXCEPTION 'A venue plan entry needs a name of 200 characters or fewer.';
  END IF;
  IF p_planning_status IS NULL OR p_planning_status NOT IN ('considering', 'contacted', 'selected') THEN
    RAISE EXCEPTION 'A venue plan status must be considering, contacted, or selected.';
  END IF;
  IF p_location_description IS NOT NULL AND length(p_location_description) > 500 THEN
    RAISE EXCEPTION 'A venue plan address or description must be 500 characters or fewer.';
  END IF;
  IF p_website IS NOT NULL AND length(p_website) > 500 THEN
    RAISE EXCEPTION 'A venue plan website must be 500 characters or fewer.';
  END IF;
  IF p_contact_name IS NOT NULL AND length(p_contact_name) > 200 THEN
    RAISE EXCEPTION 'A venue plan contact name must be 200 characters or fewer.';
  END IF;
  IF p_contact_phone IS NOT NULL AND length(p_contact_phone) > 50 THEN
    RAISE EXCEPTION 'A venue plan phone number must be 50 characters or fewer.';
  END IF;
  IF p_organizer_note IS NOT NULL AND length(p_organizer_note) > 2000 THEN
    RAISE EXCEPTION 'A venue plan note must be 2000 characters or fewer.';
  END IF;
END;
$function$;

ALTER FUNCTION public._organizer_private_venue_plan_validate(text, text, text, text, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_venue_plan_validate(text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Read: the caller's own private-draft venue plan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_private_draft_venue_plans(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  place_name text,
  location_description text,
  website text,
  contact_name text,
  contact_phone text,
  planning_status text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_venue_plan_authorize(p_event_id);

  RETURN QUERY
  SELECT vp.id, vp.place_name, vp.location_description, vp.website,
         vp.contact_name, vp.contact_phone, vp.planning_status,
         vp.organizer_note, vp.created_at, vp.updated_at
  FROM public.self_service_private_draft_venue_plans AS vp
  WHERE vp.event_id = p_event_id
  ORDER BY vp.created_at, vp.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Add one venue plan entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_my_private_draft_venue_plan(
  p_event_id uuid,
  p_place_name text,
  p_location_description text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_planning_status text DEFAULT 'considering',
  p_organizer_note text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  place_name text,
  location_description text,
  website text,
  contact_name text,
  contact_phone text,
  planning_status text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_place_name text := btrim(p_place_name);
  v_location text := nullif(btrim(p_location_description), '');
  v_website text := nullif(btrim(p_website), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_contact_phone text := nullif(btrim(p_contact_phone), '');
  -- NULL means the argument was omitted -> the contract's default. Anything
  -- else must be EXACTLY one of the three approved statuses; a blank or
  -- unrecognized value is rejected, never silently coerced to a default.
  v_status text := coalesce(btrim(p_planning_status), 'considering');
  v_note text := nullif(btrim(p_organizer_note), '');
  v_row public.self_service_private_draft_venue_plans%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_venue_plan_authorize(p_event_id);
  PERFORM public._organizer_private_venue_plan_validate(
    v_place_name, v_location, v_website, v_contact_name, v_contact_phone,
    v_status, v_note
  );

  INSERT INTO public.self_service_private_draft_venue_plans(
    event_id, place_name, location_description, website, contact_name,
    contact_phone, planning_status, organizer_note
  ) VALUES (
    p_event_id, v_place_name, v_location, v_website, v_contact_name,
    v_contact_phone, v_status, v_note
  ) RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.place_name, v_row.location_description, v_row.website,
    v_row.contact_name, v_row.contact_phone, v_row.planning_status,
    v_row.organizer_note, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Edit one venue plan entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_private_draft_venue_plan(
  p_event_id uuid,
  p_venue_plan_id uuid,
  p_place_name text,
  p_location_description text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_planning_status text DEFAULT 'considering',
  p_organizer_note text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  place_name text,
  location_description text,
  website text,
  contact_name text,
  contact_phone text,
  planning_status text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_place_name text := btrim(p_place_name);
  v_location text := nullif(btrim(p_location_description), '');
  v_website text := nullif(btrim(p_website), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_contact_phone text := nullif(btrim(p_contact_phone), '');
  v_status text := coalesce(btrim(p_planning_status), 'considering');
  v_note text := nullif(btrim(p_organizer_note), '');
  v_row public.self_service_private_draft_venue_plans%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_venue_plan_authorize(p_event_id);
  PERFORM public._organizer_private_venue_plan_validate(
    v_place_name, v_location, v_website, v_contact_name, v_contact_phone,
    v_status, v_note
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_venue_plans AS vp
    WHERE vp.id = p_venue_plan_id AND vp.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Venue plan entry not found.';
  END IF;

  -- Only this table's own planning columns are written. Nothing here touches
  -- events.* or self_service_private_event_drafts.location_mode, whatever the
  -- status is set to.
  UPDATE public.self_service_private_draft_venue_plans AS vp
  SET place_name = v_place_name,
      location_description = v_location,
      website = v_website,
      contact_name = v_contact_name,
      contact_phone = v_contact_phone,
      planning_status = v_status,
      organizer_note = v_note,
      updated_at = now()
  WHERE vp.id = p_venue_plan_id AND vp.event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.place_name, v_row.location_description, v_row.website,
    v_row.contact_name, v_row.contact_phone, v_row.planning_status,
    v_row.organizer_note, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Remove one venue plan entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_private_draft_venue_plan(
  p_event_id uuid,
  p_venue_plan_id uuid
)
RETURNS TABLE(deleted_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_venue_plan_authorize(p_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_venue_plans AS vp
    WHERE vp.id = p_venue_plan_id AND vp.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Venue plan entry not found.';
  END IF;

  DELETE FROM public.self_service_private_draft_venue_plans AS vp
  WHERE vp.id = p_venue_plan_id AND vp.event_id = p_event_id;

  RETURN QUERY SELECT p_venue_plan_id;
END;
$function$;

ALTER FUNCTION public.list_my_private_draft_venue_plans(uuid) OWNER TO postgres;
ALTER FUNCTION public.add_my_private_draft_venue_plan(uuid, text, text, text, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.update_my_private_draft_venue_plan(uuid, uuid, text, text, text, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.delete_my_private_draft_venue_plan(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_my_private_draft_venue_plans(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.add_my_private_draft_venue_plan(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_my_private_draft_venue_plan(uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_my_private_draft_venue_plan(uuid, uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_my_private_draft_venue_plans(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_my_private_draft_venue_plan(uuid, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_private_draft_venue_plan(uuid, uuid, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_private_draft_venue_plan(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. P-2D compatibility, in the SAME migration that introduces the table.
--
--    delete_self_service_organizer_event is restated VERBATIM from
--    20261001000000 (the authoritative definition -- 20261002000000 mentions
--    it only in a comment and does not redefine it) with ONLY one added
--    block: for an ALREADY-authorized eligible private Draft, THIS Event's
--    venue-plan rows are removed transactionally right after the P-3D
--    vendor-plan cleanup and BEFORE the existing fail-closed dependency scan.
--    The venue-plan table has no immutability trigger, so no ledger exception
--    or governed-deletion marker is involved. Every other line -- the auth
--    gate, the governed-deletion markers, the P-3B Agenda cleanup, the P-3C
--    guest cleanup, the P-3D vendor cleanup, the fail-closed dependency scan,
--    the empty-workspace teardown, the minimal non-content deletion audit --
--    is unchanged. CREATE OR REPLACE preserves the existing postgres
--    ownership and authenticated-only EXECUTE ACL (same approach as
--    20260929000000 / 20260930000000 / 20261001000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_self_service_organizer_event(
  p_event_id uuid,
  p_idempotency_key uuid
)
RETURNS TABLE(
  outcome text,
  deleted_event_id uuid,
  deleted_tenant_id uuid,
  deletion_scope text,
  removed_command_audit_count integer,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_link_status text;
  v_person_id uuid;
  v_existing public.self_service_event_deletion_audit%ROWTYPE;
  v_appointment_id uuid;
  v_appointment_person_id uuid;
  v_tenant_id uuid;
  v_scope text;
  v_other_events integer;
  v_removed_cmd_audit integer;
  v_dep record;
  v_dep_count bigint;
  v_audit public.self_service_event_deletion_audit%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Deleting an unfinished event requires a verified account email.';
  END IF;

  IF p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An event and an idempotency key are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_event_deletion:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('self_service_event_deletion_target:' || p_event_id::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.self_service_event_deletion_audit AS a
  WHERE a.actor_auth_user_id = v_actor
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.deleted_event_id <> p_event_id THEN
      RAISE EXCEPTION 'Idempotency key was already used to delete a different event.';
    END IF;
    RETURN QUERY SELECT
      'deleted'::text, v_existing.deleted_event_id, v_existing.deleted_tenant_id,
      v_existing.deletion_scope, v_existing.removed_command_audit_count,
      v_existing.occurred_at;
    RETURN;
  END IF;

  SELECT link.status, link.person_id
    INTO v_link_status, v_person_id
  FROM public.resolve_auth_person_link(v_actor) AS link;

  IF v_link_status NOT IN ('resolved', 'no_link') THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  SELECT oa.id, oa.person_id, oa.tenant_id
    INTO v_appointment_id, v_appointment_person_id, v_tenant_id
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
  LIMIT 1;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  -- Was this the last event in its private tenant?  If so, the empty private
  -- workspace goes too.
  SELECT count(*)::integer
    INTO v_other_events
  FROM public.events AS se
  WHERE se.tenant_id = v_tenant_id
    AND se.id <> p_event_id;

  v_scope := CASE WHEN v_other_events = 0
    THEN 'event_and_empty_workspace'
    ELSE 'event_only'
  END;

  SELECT count(*)::integer
    INTO v_removed_cmd_audit
  FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  -- Minimal, non-content deletion fact FIRST.
  INSERT INTO public.self_service_event_deletion_audit (
    organizer_person_id, actor_auth_user_id, deleted_event_id, deleted_tenant_id,
    deletion_scope, removed_command_audit_count, idempotency_key
  ) VALUES (
    v_appointment_person_id, v_actor, p_event_id,
    CASE WHEN v_scope = 'event_and_empty_workspace' THEN v_tenant_id ELSE NULL END,
    v_scope, v_removed_cmd_audit, p_idempotency_key
  ) RETURNING * INTO v_audit;

  -- Open the governed DELETE window for this transaction only: the existing
  -- 'on' marker (immutable onboarding-command / tenant-lifecycle audit
  -- exception) plus a companion marker naming the exact Event id (the
  -- organizer-Agenda ledger exception below verifies BOTH).
  PERFORM set_config('app.self_service_governed_deletion', 'on', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', p_event_id::text, true);

  -- P-3B organizer-Agenda cleanup: THIS Event's known private-draft Agenda
  -- children, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Only this Event's organizer-branch P-3B Agenda ledger rows are removed;
  -- any non-organizer ledger row is left for the scan to fail closed on.
  DELETE FROM public.agenda_command_ledger AS acl
  WHERE acl.event_id = p_event_id
    AND acl.resolved_authority_branch = 'organizer'
    AND acl.task_key IS NULL
    AND acl.action IN (
      'organizer_private_agenda_item_created',
      'organizer_private_agenda_item_updated',
      'organizer_private_agenda_item_deleted'
    );

  DELETE FROM public.agenda_items AS ai
  WHERE ai.event_id = p_event_id;

  DELETE FROM public.event_agenda_state AS eas
  WHERE eas.event_id = p_event_id;

  -- P-3C organizer private guest-list cleanup: THIS Event's planned-guest
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no identity, attendee, or invitation rows exist to
  -- remove, and the deletion audit records only the non-content fact of
  -- deletion (no guest names, emails, phones, or notes).
  DELETE FROM public.self_service_private_draft_planned_guests AS plg
  WHERE plg.event_id = p_event_id;

  -- P-3D organizer private vendor-plan cleanup: THIS Event's vendor-plan
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no vendor account, contact, access, invitation,
  -- candidacy, admission, or disposition row exists to remove, and the
  -- deletion audit records only the non-content fact of deletion (no vendor
  -- names, categories, statuses, websites, contact details, or notes).
  DELETE FROM public.self_service_private_draft_vendor_plans AS svp
  WHERE svp.event_id = p_event_id;

  -- P-3E organizer private venue-plan cleanup: THIS Event's venue-plan rows,
  -- removed BEFORE the fail-closed dependency scan and Event delete. Planning
  -- data only -- no Event location, map object, Nearby place, catalog asset,
  -- vendor relationship, or identity row exists to remove, and the deletion
  -- audit records only the non-content fact of deletion (no place names,
  -- addresses, websites, contact names, phone numbers, statuses, or notes).
  DELETE FROM public.self_service_private_draft_venue_plans AS svnp
  WHERE svnp.event_id = p_event_id;

  -- Complete dependency coverage: after the known private-draft children above,
  -- a hidden Draft self-service event must have no rows in ANY other events(id)
  -- child table.  If that is ever untrue, fail closed with zero partial
  -- deletion -- this whole function is one transaction.  The draft marker and
  -- onboarding command audit for THIS event are the expected children and are
  -- excluded.
  FOR v_dep IN
    SELECT (con.conrelid::regclass)::text AS child_table,
           att.attname AS child_col
    FROM pg_constraint AS con
    JOIN pg_attribute AS att
      ON att.attrelid = con.conrelid
     AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.events'::regclass
      AND con.conrelid NOT IN (
        'public.self_service_private_event_drafts'::regclass,
        'public.self_service_onboarding_command_audit'::regclass
      )
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE %I = $1',
      v_dep.child_table, v_dep.child_col
    ) INTO v_dep_count USING p_event_id;
    IF v_dep_count > 0 THEN
      RAISE EXCEPTION
        'Unfinished event % has unexpected dependent data in %; deletion aborted.',
        p_event_id, v_dep.child_table;
    END IF;
  END LOOP;

  -- Children first: onboarding command audit -> draft marker -> event.
  DELETE FROM public.self_service_onboarding_command_audit AS ca
  WHERE ca.event_id = p_event_id;

  DELETE FROM public.self_service_private_event_drafts AS d
  WHERE d.event_id = p_event_id;

  DELETE FROM public.events AS e
  WHERE e.id = p_event_id;

  IF v_scope = 'event_and_empty_workspace' THEN
    DELETE FROM public.self_service_tenant_lifecycle_audit AS la
    WHERE la.tenant_id = v_tenant_id;

    DELETE FROM public.self_service_organizer_appointments AS oa
    WHERE oa.id = v_appointment_id;

    DELETE FROM public.tenants AS t
    WHERE t.id = v_tenant_id;
  END IF;

  -- Close the governed DELETE window immediately: it must not outlive this
  -- operation even within a longer-lived transaction.  (An error before here
  -- aborts the whole transaction, rolling both markers back regardless.)
  PERFORM set_config('app.self_service_governed_deletion', 'off', true);
  PERFORM set_config('app.self_service_governed_deletion_event_id', '', true);

  RETURN QUERY SELECT
    'deleted'::text, v_audit.deleted_event_id, v_audit.deleted_tenant_id,
    v_audit.deletion_scope, v_audit.removed_command_audit_count, v_audit.occurred_at;
END;
$function$;

COMMIT;
