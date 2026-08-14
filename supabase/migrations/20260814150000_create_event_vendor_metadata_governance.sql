-- Vendor Admission Lifecycle -- Metadata Governance Bridge.
--
-- Restores the ten presentation/participation-mode event_vendors fields
-- Stage 3 (20260814140000) disabled in /admin/vendors and /admin/imports
-- when it retired direct table mutation, via one narrow, canonical
-- SECURITY DEFINER RPC. This is not Stage 4 -- no lifecycle mutation, no
-- new UI, no new authority model.
--
-- Metadata field audit (live schema inspected before writing this
-- migration -- see information_schema.columns / pg_constraint for
-- public.event_vendors): all ten fields previously edited by the two
-- disabled UI panels are genuine presentation/participation-mode
-- metadata, never admission-lifecycle state:
--
--   is_featured               boolean, null, default false
--   is_visible_to_members     boolean, null, default true
--   action_type                text, NOT NULL, default 'service_request',
--                              CHECK IN ('service_request','external_signup','info_only')
--   signup_url                 text, null
--   display_order              integer, null, default 100
--   event_note                 text, null
--   booth_location              text, null
--   show_on_member_dashboard   boolean, NOT NULL, default true
--   allow_service_requests     boolean, NOT NULL, default false
--   notes                       text, null
--
-- is_visible_to_members and show_on_member_dashboard both feed
-- event_vendors_select_policy / "Members can view visible event
-- vendors" (RLS-relevant), but neither determines *whether* a vendor is
-- admitted -- that is admission_state alone. They remain legitimate
-- metadata an Event-authorized admin controls, gated by the same
-- event.vendors.manage authority as admission itself, not a security
-- bypass. action_type/allow_service_requests describe *how* an already-
-- admitted vendor is presented/interacted with -- the same "different
-- axis from admission_state" distinction established since Stage 1.
-- public.event_vendors.status (the legacy, unconstrained field) was
-- never part of either disabled UI panel and is deliberately excluded
-- here too -- out of scope, unrelated to this bridge.
--
-- Partial-update design: no existing repository convention was found
-- for "omitted means unchanged, explicit null means clear" (the one
-- comparable precedent, update_event_announcement in
-- 20260814000000_create_announcements_governed_operations.sql, is a
-- full-replace RPC that requires every field on every call and has no
-- "leave unchanged" semantics at all -- not a fit here, since the two
-- UI panels each edit only a subset of these ten fields). p_updates
-- jsonb is the standard Postgres idiom for this exact problem: a key's
-- absence from the object means unchanged (the UPDATE's CASE falls
-- through to the column's own current value); a key present with JSON
-- null means explicitly clear (nullif/->>'' yields SQL NULL); a key
-- present with a real value sets it. jsonb_object_keys(p_updates) is
-- validated against the exact ten-field allowlist before anything else
-- runs -- an unrecognized key (including any lifecycle column name)
-- rejects the entire call before any row is touched. This is what makes
-- lifecycle-column protection structural rather than incidental: the
-- UPDATE statement's SET list is a fixed, static set of exactly these
-- ten columns in the SQL text -- application_id, admission_state,
-- admitted_at, admitted_by_auth_user_id, admitted_by_admin_user_id,
-- admission_authority_basis, and current_disposition_id are never
-- assigned to in this function, under any input, by construction --
-- and vendor_event_applications, vendor_event_dispositions, and
-- public.vendors are never referenced at all.
--
-- Concurrency: SELECT ... FOR UPDATE locks the target event_vendors row
-- before the UPDATE, the same idiom already established for
-- admit_vendor_for_event/revoke_vendor_admission and used repeatedly
-- elsewhere in this repository (vendor invitation activation, member
-- checkin, magic-link activation). This serializes against a concurrent
-- admit/revoke on the same row rather than racing a stale snapshot. No
-- version column is introduced -- unnecessary given row locking, and no
-- repository precedent uses one for this class of operation.
--
-- Authority: has_event_task_authority('event.vendors.manage', p_event_id)
-- -- the same task as admission/revocation, not a new authority tier.
-- Neither is_active_admin() nor has_vendor_catalog_admin_authority()
-- appears anywhere in this function. No Tenant ID or authority basis is
-- accepted as a parameter (this RPC does not write any authority-
-- provenance column at all, so there is nothing to derive one for).
--
-- Fails closed if the (vendor_id, event_id) event_vendors relationship
-- does not exist -- this RPC identifies an existing relationship only;
-- it never creates one (that remains admit_vendor_for_event's job
-- alone).

BEGIN;

CREATE OR REPLACE FUNCTION public.update_event_vendor_metadata(
  p_vendor_id uuid,
  p_event_id uuid,
  p_updates jsonb
)
RETURNS public.event_vendors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_uid uuid;
  v_event_vendor_id uuid;
  v_key text;
  v_action_type text;
  v_row public.event_vendors%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_vendor_id IS NULL OR p_event_id IS NULL OR p_updates IS NULL THEN
    RAISE EXCEPTION 'missing_input' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'invalid_updates_payload' USING ERRCODE = '22023';
  END IF;

  -- Structural allowlist gate: rejects the entire call (before any row
  -- is touched) if p_updates names anything outside these ten metadata
  -- fields -- including any lifecycle column, application/disposition
  -- field, or vendors.is_active.
  FOR v_key IN SELECT jsonb_object_keys(p_updates) LOOP
    IF v_key NOT IN (
      'is_featured', 'is_visible_to_members', 'action_type', 'signup_url',
      'display_order', 'event_note', 'booth_location', 'show_on_member_dashboard',
      'allow_service_requests', 'notes'
    ) THEN
      RAISE EXCEPTION 'unsupported_metadata_field: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF NOT public.has_event_task_authority('event.vendors.manage', p_event_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_updates ? 'action_type' THEN
    v_action_type := p_updates ->> 'action_type';
    IF v_action_type IS NULL OR v_action_type NOT IN ('service_request', 'external_signup', 'info_only') THEN
      RAISE EXCEPTION 'invalid_action_type' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT ev.id INTO v_event_vendor_id
  FROM public.event_vendors AS ev
  WHERE ev.vendor_id = p_vendor_id AND ev.event_id = p_event_id
  FOR UPDATE;

  IF v_event_vendor_id IS NULL THEN
    RAISE EXCEPTION 'event_vendor_relationship_not_found' USING ERRCODE = '22023';
  END IF;

  UPDATE public.event_vendors AS ev
  SET
    is_featured = CASE WHEN p_updates ? 'is_featured'
      THEN (p_updates ->> 'is_featured')::boolean ELSE ev.is_featured END,
    is_visible_to_members = CASE WHEN p_updates ? 'is_visible_to_members'
      THEN (p_updates ->> 'is_visible_to_members')::boolean ELSE ev.is_visible_to_members END,
    action_type = CASE WHEN p_updates ? 'action_type'
      THEN (p_updates ->> 'action_type') ELSE ev.action_type END,
    signup_url = CASE WHEN p_updates ? 'signup_url'
      THEN nullif(btrim(p_updates ->> 'signup_url'), '') ELSE ev.signup_url END,
    display_order = CASE WHEN p_updates ? 'display_order'
      THEN (p_updates ->> 'display_order')::integer ELSE ev.display_order END,
    event_note = CASE WHEN p_updates ? 'event_note'
      THEN nullif(btrim(p_updates ->> 'event_note'), '') ELSE ev.event_note END,
    booth_location = CASE WHEN p_updates ? 'booth_location'
      THEN nullif(btrim(p_updates ->> 'booth_location'), '') ELSE ev.booth_location END,
    show_on_member_dashboard = CASE WHEN p_updates ? 'show_on_member_dashboard'
      THEN (p_updates ->> 'show_on_member_dashboard')::boolean ELSE ev.show_on_member_dashboard END,
    allow_service_requests = CASE WHEN p_updates ? 'allow_service_requests'
      THEN (p_updates ->> 'allow_service_requests')::boolean ELSE ev.allow_service_requests END,
    notes = CASE WHEN p_updates ? 'notes'
      THEN nullif(btrim(p_updates ->> 'notes'), '') ELSE ev.notes END
  WHERE ev.id = v_event_vendor_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.update_event_vendor_metadata(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_event_vendor_metadata(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_event_vendor_metadata(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.update_event_vendor_metadata(uuid, uuid, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.update_event_vendor_metadata(uuid, uuid, jsonb) TO authenticated;

COMMIT;
