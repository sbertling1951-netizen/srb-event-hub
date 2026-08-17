-- Member Check-In Site-Reporting Cutover -- Stage B.
--
-- Forward-repairs submit_member_checkin per the settled architecture
-- (docs/architecture/EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md §4.1/§7;
-- docs/architecture/EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md
-- §3.1/§9.2, accepted at commit 0a53709 "Define member site reporting
-- boundary"). The current durable implementation is explicitly
-- nonconforming: it clears the member's canonical occupancy, assigns a
-- vacant site, materializes parking inventory, and writes
-- attendees.assigned_site -- all without record_site_placement
-- authority/history. This migration retires every one of those behaviors.
--
-- 1. A new, narrow, append-only evidence table -- public.member_site_reports
--    -- records "What site are you parked in?" as reported placement
--    evidence only (Implementation Specification §7/§9.2 item 3). It is
--    never an authoritative placement source, never occupies inventory,
--    and is not directly writable or readable by any client role.
-- 2. A new private helper, public._record_member_site_report, is the sole
--    writer. It is callable only by an already-verified SECURITY DEFINER
--    caller (submit_member_checkin) -- it has no client-callable grant at
--    all, matching the existing _allocate_event_placement_sequence /
--    _apply_attendee_sharing_preferences private-helper pattern. Blank
--    input creates no report (§9.2 item 4): the helper itself enforces
--    this, so every future caller gets it for free. A nonblank value is
--    matched, read-only, against the Event's selected master map template
--    only -- it never reads parking_sites occupancy, never locks a row,
--    and never materializes inventory (§9.2 item 5: unmatched text is
--    preserved evidence, not an error or a reason to fabricate inventory).
-- 3. submit_member_checkin keeps its exact existing signature and its
--    exact existing identity/Tenant/Event verification (byte-for-byte
--    unchanged -- see the untouched block below). Only the placement
--    mutation is replaced: it now calls the evidence helper with the
--    already-verified attendee/Event/Tenant/authorization-basis context
--    instead of writing parking_sites or attendees.assigned_site
--    (§9.2 item 6). It never invokes record_site_placement.
--
-- attendees.assigned_site is no longer written by this function at all --
-- neither on the report path nor as a side effect of Arrival. The
-- function's RETURN TABLE shape is unchanged (still includes
-- assigned_site) and member_checkin_audit's previous/new_values jsonb
-- still carries the assigned_site key -- both required by
-- member_checkin_audit's own existing CHECK constraints, which this
-- migration does not touch -- but the value now only ever reflects the
-- attendee's true current (Parking-owned) column, read and returned
-- unchanged by this function, never assigned by it. Arrival and sharing
-- behavior, and every existing verification branch, are otherwise
-- untouched.
--
-- Lifecycle note: submit_member_checkin has no Event lifecycle mutability
-- guard today (no call to assert_event_lifecycle_mutable), unlike
-- record_site_placement and complete_admin_checkin. This migration does
-- not add one -- adding lifecycle enforcement to Member Check-In's Arrival
-- path is a distinct policy question outside this Stage B site-reporting
-- cutover's explicit scope, and is flagged in the accompanying report
-- rather than decided here.

BEGIN;

-- ============================================================
-- 1. member_site_reports. Narrow, append-only evidence. No role is ever
--    granted INSERT/UPDATE/DELETE/SELECT -- immutable by construction,
--    matching site_placement_history. Writes go only through
--    _record_member_site_report below; reads go only through the governed
--    Parking-staff read surface added in the companion migration
--    (20260817170000_add_member_site_report_read_surfaces.sql).
-- ============================================================

CREATE TABLE public.member_site_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id),
  raw_reported_value text NOT NULL,
  normalized_reported_value text NOT NULL,
  matched_master_site_id uuid REFERENCES public.master_map_sites(id),
  authorization_basis text NOT NULL,
  actor_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  actor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Nullable, optional cross-reference to a later authorized placement
  -- decision that relied on this report (Implementation Specification §7's
  -- source_report_history_id, mirrored in the opposite direction). Not
  -- populated by Stage B -- forward-compatible schema only, per "optional
  -- link ... if useful and supported."
  linked_placement_history_id uuid REFERENCES public.site_placement_history(id),
  CONSTRAINT member_site_reports_authorization_basis_check CHECK (
    authorization_basis IN ('authenticated', 'temporary')
  ),
  CONSTRAINT member_site_reports_actor_context_check CHECK (
    (authorization_basis = 'authenticated'
      AND actor_person_id IS NOT NULL
      AND actor_auth_user_id IS NOT NULL)
    OR (authorization_basis = 'temporary'
      AND actor_person_id IS NULL
      AND actor_auth_user_id IS NULL)
  ),
  CONSTRAINT member_site_reports_raw_value_length_check CHECK (
    char_length(raw_reported_value) BETWEEN 1 AND 100
  ),
  CONSTRAINT member_site_reports_normalized_value_not_blank_check CHECK (
    char_length(normalized_reported_value) >= 1
  )
);

CREATE INDEX member_site_reports_event_id_reported_at_idx
  ON public.member_site_reports (event_id, reported_at DESC);
CREATE INDEX member_site_reports_attendee_id_reported_at_idx
  ON public.member_site_reports (attendee_id, reported_at DESC);

ALTER TABLE public.member_site_reports OWNER TO postgres;
ALTER TABLE public.member_site_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_site_reports FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.member_site_reports IS
  'Narrow, append-only Member-reported-site evidence ("What site are you parked in?"). Never authoritative placement -- see record_site_placement / site_placement_history for the sole canonical current placement.';

-- ============================================================
-- 2. _record_member_site_report. Private evidence-recording helper
--    (Implementation Specification §3.1). Not executable by anon or
--    authenticated -- only reachable through a trusted SECURITY DEFINER
--    caller (submit_member_checkin) that has already independently
--    verified identity, Event, and Tenant. It receives that verified
--    context as parameters; it never re-derives or trusts a client-
--    asserted attendee/Event/Tenant itself.
-- ============================================================

CREATE FUNCTION public._record_member_site_report(
  p_event_id uuid,
  p_attendee_id uuid,
  p_raw_value text,
  p_authorization_basis text,
  p_actor_person_id uuid,
  p_actor_auth_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_normalized text;
  v_selected_master_map_id uuid;
  v_matched_master_site_id uuid;
  v_report_id uuid;
BEGIN
  -- Blank input creates no report -- enforced here so every caller gets
  -- this rule for free, rather than re-implementing it at each call site.
  v_normalized := nullif(upper(btrim(p_raw_value)), '');

  IF v_normalized IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_event_id IS NULL OR p_attendee_id IS NULL OR p_authorization_basis IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Optional match, read-only, against the Event's selected master map
  -- template only -- never parking_sites occupancy, never a lock, never
  -- materialization. An unmatched value is simply left NULL here and
  -- preserved as evidence regardless (§9.2 item 5).
  SELECT ems.selected_master_map_id INTO v_selected_master_map_id
  FROM public.event_map_settings AS ems
  WHERE ems.event_id = p_event_id;

  IF v_selected_master_map_id IS NOT NULL THEN
    SELECT mms.id INTO v_matched_master_site_id
    FROM public.master_map_sites AS mms
    WHERE mms.master_map_id = v_selected_master_map_id
      AND mms.site_number = v_normalized;
  END IF;

  INSERT INTO public.member_site_reports (
    event_id, attendee_id, raw_reported_value, normalized_reported_value,
    matched_master_site_id, authorization_basis, actor_person_id, actor_auth_user_id
  ) VALUES (
    p_event_id, p_attendee_id, btrim(p_raw_value), v_normalized,
    v_matched_master_site_id, p_authorization_basis, p_actor_person_id, p_actor_auth_user_id
  ) RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

ALTER FUNCTION public._record_member_site_report(uuid, uuid, text, text, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._record_member_site_report(uuid, uuid, text, text, uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 3. submit_member_checkin. Exact existing signature. Identity/Tenant/
--    Event verification is byte-for-byte unchanged from
--    20260804130000_require_tenant_verification_in_member_checkin.sql.
--    The placement-mutation block (site lookup + parking_sites
--    materialize/clear/assign) is removed and replaced with one call to
--    the evidence helper above, using the already-verified context. The
--    final attendees UPDATE no longer sets assigned_site; the audit
--    payload still carries its (now provably unchanged) value to satisfy
--    member_checkin_audit's existing CHECK constraints.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_member_checkin(
  p_event_id uuid,
  p_expected_attendee_id uuid,
  p_has_arrived boolean,
  p_share_with_attendees boolean,
  p_assigned_site text,
  p_tenant_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  assigned_site text,
  share_with_attendees boolean,
  has_arrived boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_person_id uuid;
  v_verified_attendee_id uuid;
  v_match_count integer;
  v_match_ids uuid[];
  v_identifier_is_email boolean;
  v_normalized_email text;
  v_normalized_phone text;
  v_authorization_basis text;
  v_previous_has_arrived boolean;
  v_previous_share_with_attendees boolean;
  v_previous_assigned_site text;
  v_previous_arrival_status text;
  v_updated_id uuid;
  v_updated_assigned_site text;
  v_updated_share_with_attendees boolean;
  v_updated_has_arrived boolean;
  v_updated_arrival_status text;
BEGIN
  IF p_event_id IS NULL
    OR p_expected_attendee_id IS NULL
    OR p_has_arrived IS NULL
    OR p_share_with_attendees IS NULL
    OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  -- Independent Tenant re-verification. p_tenant_id is a value the caller
  -- supplies, but this check gives it no authority by itself: it only
  -- succeeds when the Event this call targets is actually, currently owned
  -- by that Tenant in public.events. A caller cannot widen its own access
  -- by asserting a different Tenant ID -- it can only ever narrow the same
  -- Event/Person/Attendee checks already enforced below to Events that
  -- Tenant genuinely owns.
  SELECT count(*)
    INTO v_match_count
  FROM public.events AS e
  WHERE e.id = p_event_id
    AND e.tenant_id = p_tenant_id;

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    v_authorization_basis := 'authenticated';

    SELECT link.person_id
      INTO v_person_id
    FROM public.resolve_auth_person_link(v_uid) AS link
    WHERE link.status = 'resolved';

    IF v_person_id IS NULL THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    SELECT count(*)
      INTO v_match_count
    FROM public.attendees AS a
    JOIN public.events AS e
      ON e.id = a.event_id
    WHERE a.id = p_expected_attendee_id
      AND a.person_id = v_person_id
      AND a.event_id = p_event_id
      AND coalesce(a.is_active, true) = true
      AND e.visible_to_members = true
      AND coalesce(e.is_active, true) = true;

    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_verified_attendee_id := p_expected_attendee_id;
  ELSE
    v_authorization_basis := 'temporary';

    IF nullif(btrim(p_event_code), '') IS NULL
      OR nullif(btrim(p_registration_identifier), '') IS NULL THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_identifier_is_email := position('@' IN btrim(p_registration_identifier)) > 0;

    IF v_identifier_is_email THEN
      v_normalized_email := lower(btrim(p_registration_identifier));

      IF position('@' IN v_normalized_email) = 1
        OR position('@' IN v_normalized_email) = length(v_normalized_email) THEN
        RAISE EXCEPTION 'Member check-in verification failed.';
      END IF;
    ELSE
      v_normalized_phone := regexp_replace(
        btrim(p_registration_identifier),
        '[^0-9]',
        '',
        'g'
      );

      IF length(v_normalized_phone) = 11
        AND left(v_normalized_phone, 1) = '1' THEN
        v_normalized_phone := substring(v_normalized_phone FROM 2);
      END IF;

      IF v_normalized_phone = '' THEN
        RAISE EXCEPTION 'Member check-in verification failed.';
      END IF;
    END IF;

    WITH primary_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendees AS a
      JOIN public.events AS e
        ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND (
              lower(btrim(coalesce(a.email, ''))) = v_normalized_email
              OR lower(btrim(coalesce(a.copilot_email, ''))) = v_normalized_email
            )
          )
          OR (
            NOT v_identifier_is_email
            AND (
              CASE
                WHEN length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.primary_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.cell_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
              OR CASE
                WHEN length(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')) = 11
                  AND left(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
                THEN substring(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
                ELSE regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g')
              END = v_normalized_phone
            )
          )
        )
    ),
    household_matches AS (
      SELECT a.id AS attendee_id
      FROM public.attendee_household_members AS hm
      JOIN public.attendees AS a
        ON a.id = hm.attendee_id
      JOIN public.events AS e
        ON e.id = a.event_id
      WHERE a.event_id = p_event_id
        AND lower(btrim(coalesce(e.event_code, ''))) = lower(btrim(p_event_code))
        AND e.visible_to_members = true
        AND coalesce(e.is_active, true) = true
        AND coalesce(a.is_active, true) = true
        AND (
          (
            v_identifier_is_email
            AND lower(btrim(coalesce(hm.email, ''))) = v_normalized_email
          )
          OR (
            NOT v_identifier_is_email
            AND CASE
              WHEN length(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')) = 11
                AND left(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
              THEN substring(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g') FROM 2)
              ELSE regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g')
            END = v_normalized_phone
          )
        )
    ),
    verified_matches AS (
      SELECT attendee_id FROM primary_matches
      UNION
      SELECT attendee_id FROM household_matches
    )
    SELECT count(*), array_agg(attendee_id)
      INTO v_match_count, v_match_ids
    FROM verified_matches;

    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;

    v_verified_attendee_id := v_match_ids[1];

    IF v_verified_attendee_id IS DISTINCT FROM p_expected_attendee_id THEN
      RAISE EXCEPTION 'Member check-in verification failed.';
    END IF;
  END IF;

  -- Member-reported site: non-authoritative evidence only (Site Assignment
  -- Governance Architecture §7; Site Placement Implementation Specification
  -- §3.1/§9.2). This never touches parking_sites or attendees.assigned_site
  -- -- it writes only the append-only member_site_reports evidence table,
  -- using the identity/Event/Tenant context already verified above. Blank
  -- input creates no report (the helper itself enforces this).
  PERFORM public._record_member_site_report(
    p_event_id,
    v_verified_attendee_id,
    p_assigned_site,
    v_authorization_basis,
    v_person_id,
    v_uid
  );

  SELECT
    a.has_arrived,
    a.share_with_attendees,
    a.assigned_site,
    a.arrival_status
  INTO
    v_previous_has_arrived,
    v_previous_share_with_attendees,
    v_previous_assigned_site,
    v_previous_arrival_status
  FROM public.attendees AS a
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  -- Arrival-owned columns only. assigned_site is deliberately absent from
  -- this SET clause -- Member Check-In no longer writes canonical
  -- placement or its compatibility projection in any form.
  UPDATE public.attendees AS a
  SET has_arrived = p_has_arrived,
      share_with_attendees = p_share_with_attendees,
      arrival_status = CASE
        WHEN p_has_arrived THEN 'arrived'
        ELSE 'not_arrived'
      END
  WHERE a.id = v_verified_attendee_id
    AND a.event_id = p_event_id
  RETURNING
    a.id,
    a.assigned_site,
    a.share_with_attendees,
    a.has_arrived,
    a.arrival_status
  INTO
    v_updated_id,
    v_updated_assigned_site,
    v_updated_share_with_attendees,
    v_updated_has_arrived,
    v_updated_arrival_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member check-in verification failed.';
  END IF;

  INSERT INTO public.member_checkin_audit (
    event_id,
    attendee_id,
    authorization_basis,
    actor_person_id,
    actor_auth_user_id,
    changed_fields,
    previous_values,
    new_values
  )
  VALUES (
    p_event_id,
    v_verified_attendee_id,
    v_authorization_basis,
    v_person_id,
    v_uid,
    -- assigned_site can never appear here -- this function no longer
    -- writes it, so previous and updated values are always identical.
    array_remove(ARRAY[
      CASE WHEN v_previous_has_arrived IS DISTINCT FROM v_updated_has_arrived THEN 'has_arrived' END,
      CASE WHEN v_previous_share_with_attendees IS DISTINCT FROM v_updated_share_with_attendees THEN 'share_with_attendees' END,
      CASE WHEN v_previous_arrival_status IS DISTINCT FROM v_updated_arrival_status THEN 'arrival_status' END
    ], NULL),
    jsonb_build_object(
      'has_arrived', v_previous_has_arrived,
      'share_with_attendees', v_previous_share_with_attendees,
      'assigned_site', v_previous_assigned_site,
      'arrival_status', v_previous_arrival_status
    ),
    jsonb_build_object(
      'has_arrived', v_updated_has_arrived,
      'share_with_attendees', v_updated_share_with_attendees,
      'assigned_site', v_updated_assigned_site,
      'arrival_status', v_updated_arrival_status
    )
  );

  RETURN QUERY
  SELECT
    v_updated_id,
    v_updated_assigned_site,
    v_updated_share_with_attendees,
    v_updated_has_arrived;
END;
$$;

ALTER FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_member_checkin(uuid, uuid, boolean, boolean, text, uuid, text, text)
TO anon, authenticated;

COMMIT;
