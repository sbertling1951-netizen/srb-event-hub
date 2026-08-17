-- Public-Visibility Governance Repair: closes anonymous attendee exposure
-- on /map and replaces /coach-map/public's client-enforced reciprocity
-- with a server-enforced governed contract.
--
-- Business rule (Pap, 2026-08-16): "Public" in EpicentraX is an internal
-- Event-context term -- visible within the governed Event experience to
-- legitimate participating attendees. It never means visible to an
-- anonymous internet caller. Attendee sharing means sharing with other
-- participating Event users under the reciprocal "share to see" rule
-- already built by 20260816140000/20260816150000, not anonymous
-- publication. No existing field-level sharing consent is reinterpreted
-- here as consent to anonymous publication -- the masking rules
-- themselves are unchanged; only who may ever reach them changes.
--
-- get_event_public_roster (20260816140000) was built as a deliberate,
-- non-reciprocal, caller-identity-free broadcast feed and granted to
-- anon -- its own comment called this out explicitly as intentional.
-- That contract cannot be reconciled with the rule above by masking
-- alone: its defect is that no caller identity is resolved at all. Both
-- of its live callers (/map, /coach-map/public) are repointed below to
-- a properly gated replacement in this same change, so no live path
-- depends on it; it is dropped outright rather than left revoked-but-
-- present, so its name/history stop implying anonymous broadcast is
-- ever an acceptable shape for attendee data (repair-forward, not an
-- edit to the applied 20260816140000 migration).
--
-- public.parking_sites has never had Row Level Security enabled and
-- carries a blanket anon SELECT grant covering every column, including
-- assigned_attendee_id -- a direct Person-identifying foreign key. That
-- grant is a live, ungoverned secondary path to attendee-site linkage
-- that bypasses both RPCs entirely: any caller holding only the public
-- anon key could already `select assigned_attendee_id from
-- parking_sites` for any Event, with no identity check of any kind, and
-- temporary event-code member sessions run under this same `anon`
-- database role (this project has no anonymous-auth JWT layer), so a
-- table-wide revoke-from-anon alone would also break their legitimate
-- reads. The grant is narrowed below to a safe column list that excludes
-- assigned_attendee_id; a new governed RPC supplies the one Person-free
-- fact generic map geometry legitimately needs (is this site occupied),
-- without ever handing out who occupies it.

BEGIN;

-- ─── A. Anonymous-safe site geometry (no Person linkage) ───────────────
--
-- Returns exactly what /map and /coach-map/public need to render site
-- markers: layout plus a derived occupied/open boolean. The underlying
-- assigned_attendee_id foreign key is never selected into the result --
-- "is this site taken" is legitimate generic venue geometry; "taken by
-- whom" is Person data and is never answered by this function. Scoped to
-- the same visible_to_members/is_active predicate every other governed
-- discovery/roster contract already uses, which is strictly narrower
-- than parking_sites' previous ungated anon exposure (no Event lifecycle
-- check existed on that grant at all).

CREATE OR REPLACE FUNCTION public.get_event_public_map_sites(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  master_site_id uuid,
  site_number text,
  display_label text,
  map_x numeric,
  map_y numeric,
  is_occupied boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT
    s.id,
    s.master_site_id,
    s.site_number,
    s.display_label,
    s.map_x,
    s.map_y,
    s.assigned_attendee_id IS NOT NULL
  FROM public.parking_sites AS s
  JOIN public.events AS e ON e.id = s.event_id
  WHERE s.event_id = p_event_id
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
$$;

ALTER FUNCTION public.get_event_public_map_sites(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_event_public_map_sites(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_public_map_sites(uuid) TO anon, authenticated;

-- ─── B. Narrow parking_sites: drop the anon Person-linked column ──────
--
-- Table-level SELECT and column-level SELECT are independent ACL entries
-- in Postgres -- holding the table-wide grant satisfies the privilege
-- check regardless of any column-level REVOKE layered alongside it, so
-- closing this required replacing the blanket grant with an explicit
-- safe column list, not merely revoking one column. notes and
-- map_image_url are also dropped from the anon list: neither was ever
-- read by any anon-reachable consumer (confirmed by repository-wide
-- inspection), and notes in particular is free-text admin content with
-- no established public-safety review.

REVOKE SELECT ON TABLE public.parking_sites FROM anon;
GRANT SELECT (id, event_id, site_number, display_label, map_x, map_y, master_site_id)
ON TABLE public.parking_sites
TO anon;

-- ─── C. Governed, reciprocal, map-shaped attendee read contract ────────
--
-- Replaces get_event_public_roster for both /map and /coach-map/public.
-- Reuses the identity boundary and reciprocal share-to-see gate
-- get_event_attendee_locator already established (20260816140000): a
-- caller who has not shared their own Name receives zero rows, not a
-- masked row -- this is the server-side enforcement /coach-map/public
-- previously approximated only in client code. Field shape is
-- map-appropriate (no email/phone -- this is not the Locator); every
-- optional column is masked per the target's own governed preference,
-- exactly as the Locator masks them. registration_status eligibility is
-- enforced here to close the drift the governance review identified:
-- get_event_public_roster never carried this check, so a
-- cancelled-but-still-is_active attendee could previously still surface.
-- Household/Co-pilot identity remains entirely out of scope, as in every
-- governed sharing surface -- only Pilot rows are ever selected. Event
-- lifecycle scope (visible_to_members/is_active) is unchanged from the
-- contract it replaces: archived Events lose this read the same way they
-- always have, independent of and without touching a Person's own
-- historical continuity access elsewhere.

CREATE OR REPLACE FUNCTION public.get_event_participant_map_roster(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_caller_attendee_id uuid;
  v_caller_participates boolean;
BEGIN
  -- (A) Requester has legitimate Event access -- the same identity
  -- resolver every other attendee-facing RPC already shares.
  v_caller_attendee_id := public.resolve_temporary_or_authenticated_attendee(
    p_event_id, p_event_code, p_registration_identifier
  );

  IF v_caller_attendee_id IS NULL THEN
    RETURN;
  END IF;

  -- (B) Requester participates in sharing -- share to see. Fails closed:
  -- a non-participating legitimate attendee gets zero rows back, not a
  -- client-hidden panel over a fully-populated response.
  SELECT shared INTO v_caller_participates
  FROM public.attendee_sharing_preferences
  WHERE attendee_id = v_caller_attendee_id AND field_key = 'name';

  IF NOT coalesce(v_caller_participates, false) THEN
    RETURN;
  END IF;

  -- (C) Target participates, target's own field-level choices, Event
  -- scope, registration eligibility, and lifecycle -- one row per
  -- participating, eligible target.
  RETURN QUERY
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
    AND coalesce(a.registration_status, '') IN ('active', 'registered')
    AND e.visible_to_members = true
    AND coalesce(e.is_active, true) = true;
END;
$$;

ALTER FUNCTION public.get_event_participant_map_roster(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_event_participant_map_roster(uuid, text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_participant_map_roster(uuid, text, text) TO anon, authenticated;

-- ─── D. Retire the non-reciprocal broadcast contract ────────────────────
--
-- Both former callers (/map, /coach-map/public) are repointed to (A)/(C)
-- above in this same change, so no live caller remains. The function is
-- dropped rather than left revoked-but-present: this migration does not
-- leave a knowingly dangerous compatibility path in place on the theory
-- that nothing currently calls it.

DROP FUNCTION IF EXISTS public.get_event_public_roster(uuid);

COMMIT;
