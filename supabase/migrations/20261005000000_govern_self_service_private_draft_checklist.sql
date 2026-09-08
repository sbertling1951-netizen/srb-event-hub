-- P-3G: an owner-only PRIVATE planning checklist for a self-service
-- organizer's own unfinished private draft.
--
-- This is A BLANK NOTEBOOK WITH CHECKBOXES, exactly as
-- docs/architecture/EPICENTRAX_PRIVATE_PLANNING_CHECKLIST_CONTRACT.md
-- requires. It is NOT a recommended event plan, a readiness measure, a
-- workflow engine, a task-authority system, or a reminder service.
--
-- ===========================================================================
-- THE THREE STATEMENTS THIS MIGRATION MUST KEEP TRUE (contract §B)
-- ===========================================================================
-- 1. IT IS A BLANK NOTEBOOK, NOT A PLAN IMPOSED BY EPICENTRAX. The list
--    starts empty and stays empty until the organizer writes in it. Nothing
--    below inserts, seeds, generates, suggests, templates, orders by
--    importance, or scores a single item. The ONLY INSERT into the checklist
--    table is the organizer's own add command.
--
-- 2. AN EMPTY CHECKLIST SAYS NOTHING ABOUT WHETHER THE EVENT IS READY.
--
-- 3. MARKING EVERY ITEM COMPLETE SAYS NOTHING ABOUT WHETHER THE EVENT IS
--    READY. Completion is a personal marker on one row. No function below
--    aggregates it, counts it, computes a ratio from it, branches on it, or
--    lets it reach events.status, events.is_active, events.visible_to_members,
--    any launch/readiness rule, or any other table.
--
-- ===========================================================================
-- THE TARGET DATE IS INERT
-- ===========================================================================
-- It is a `date` -- deliberately NOT timestamptz, so there is no time of day
-- to schedule against. Nothing acts on it: no reminder, notification,
-- calendar entry, digest, overdue state, escalation, or sort obligation. A
-- date in the past is simply a date in the past. There is no network-capable
-- construct anywhere in this migration that could deliver a reminder even if
-- someone later wanted one.
--
-- What this migration does NOT do:
--   * it never reads, writes, joins to, or extends public.admin_task_registry
--     -- the administrative AUTHORITY TASK catalog, which is a permission
--     system and not a to-do list;
--   * it never touches agenda_items, event_agenda_state, or any agenda path;
--   * it never writes events, self_service_private_event_drafts, or any
--     status / readiness / visibility / location field;
--   * it introduces NO notification, reminder, email, calendar, invitation,
--     assignment, delegation, sharing, or collaboration behavior;
--   * it never writes people, person_identifiers, person_auth_accounts,
--     attendees, registrations, vendors, event_vendors, or any catalog,
--     payment, or Passport surface;
--   * it adds NO ordering / reordering column -- stable creation order only,
--     per this phase's explicit scope;
--   * it adds NO command ledger and puts NO item title, note, date,
--     completion state, or ITEM COUNT into any deletion audit, URL, log, or
--     user-visible error. A count of someone's private reminders is still
--     information about their private reminders.
--
-- Authorization is the exact self-service organizer-owner rule already used by
-- _organizer_private_draft_agenda_authorize (P-3B), _guest_authorize (P-3C),
-- _vendor_plan_authorize (P-3D), _venue_plan_authorize (P-3E), and
-- _registry_plan_authorize (P-3F, 20261004000000).
--
-- The records are event-owned. §7 extends the governed
-- delete_self_service_organizer_event path to remove them AFTER the existing
-- guest / vendor / venue / registry cleanups and BEFORE the universal
-- fail-closed child-FK dependency scan, in the same change that introduces
-- the table.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The narrowly-scoped private-draft checklist table.
--    A DEDICATED table, per the contract's prohibition on one generic
--    polymorphic planning table.
--    Event-owned (ON DELETE RESTRICT, exactly like its P-3B..P-3F siblings).
--    RLS on + all browser grants revoked: reachable ONLY through the
--    tightly-governed organizer RPCs below (postgres-owned, SECURITY
--    DEFINER), never directly by anon / authenticated / service_role.
-- ---------------------------------------------------------------------------
CREATE TABLE public.self_service_private_draft_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  -- Free text the organizer typed. Never parsed for intent, keywords, dates,
  -- entities, or categories; never matched to a suggestion list or template.
  item_title text NOT NULL
    CHECK (btrim(item_title) <> '' AND length(item_title) <= 300),
  organizer_note text
    CHECK (organizer_note IS NULL OR (btrim(organizer_note) <> '' AND length(organizer_note) <= 2000)),
  -- DATE ONLY -- deliberately not timestamptz. A date the organizer wrote
  -- down, not a scheduled event. Nothing acts on it.
  target_date date,
  -- A personal marker on THIS row and nothing else. Defaults to not-done and
  -- is freely reversible.
  is_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.self_service_private_draft_checklist_items OWNER TO postgres;

COMMENT ON TABLE public.self_service_private_draft_checklist_items IS
  'P-3G private planning checklist for one self-service organizer Draft. A blank notebook with checkboxes -- organizer-authored only, never seeded. Empty or all-complete says nothing about event readiness. Unrelated to admin_task_registry.';
COMMENT ON COLUMN public.self_service_private_draft_checklist_items.target_date IS
  'Optional date the organizer wrote down. Date only, no time. Inert: no reminder, notification, calendar entry, overdue state, or escalation acts on it.';
COMMENT ON COLUMN public.self_service_private_draft_checklist_items.is_completed IS
  'Personal done/not-done marker for this row only. Never aggregated, scored, or used as an input to event readiness, launch eligibility, status, or visibility.';

-- Stable creation order. No ordering/rank column exists in this phase.
CREATE INDEX self_service_private_draft_checklist_items_event_idx
  ON public.self_service_private_draft_checklist_items (event_id, created_at, id);

ALTER TABLE public.self_service_private_draft_checklist_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_private_draft_checklist_items
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Internal helper: authorize the caller as the canonical owner of ONE
--    eligible private-draft Event's checklist. Raises 'Draft not found.' for
--    every miss, non-enumerating. Never calls has_event_task_authority,
--    has_tenant_admin_authority, or any vendor/catalog authority.
--    Byte-for-byte the same owner rule as
--    _organizer_private_draft_registry_plan_authorize (20261004000000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_draft_checklist_authorize(p_event_id uuid)
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
    RAISE EXCEPTION 'Editing a planning checklist requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Editing a planning checklist requires a verified account email.';
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

ALTER FUNCTION public._organizer_private_draft_checklist_authorize(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_draft_checklist_authorize(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared input validation for one checklist item. item_title is REQUIRED;
-- the note and the target date are optional. LENGTH-ONLY checks -- the title
-- is never parsed, matched, or categorized, and the date is never range-
-- checked against the event, "today", or anything else. A past date is valid.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_checklist_item_validate(
  p_item_title text, p_organizer_note text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_item_title IS NULL OR btrim(p_item_title) = '' OR length(btrim(p_item_title)) > 300 THEN
    RAISE EXCEPTION 'A checklist item needs a title of 300 characters or fewer.';
  END IF;
  IF p_organizer_note IS NOT NULL AND length(p_organizer_note) > 2000 THEN
    RAISE EXCEPTION 'A checklist note must be 2000 characters or fewer.';
  END IF;
END;
$function$;

ALTER FUNCTION public._organizer_private_checklist_item_validate(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_checklist_item_validate(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Read: the caller's own private-draft checklist, in stable creation
--    order. Returns the rows and nothing derived -- no totals, no counts, no
--    completion ratio, no "next" item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_private_draft_checklist_items(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  item_title text,
  organizer_note text,
  target_date date,
  is_completed boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_checklist_authorize(p_event_id);

  RETURN QUERY
  SELECT ci.id, ci.item_title, ci.organizer_note, ci.target_date,
         ci.is_completed, ci.created_at, ci.updated_at
  FROM public.self_service_private_draft_checklist_items AS ci
  WHERE ci.event_id = p_event_id
  ORDER BY ci.created_at, ci.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Add one checklist item. This is the ONLY INSERT into the checklist table
--    anywhere in this migration: every item exists because the organizer
--    typed it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_my_private_draft_checklist_item(
  p_event_id uuid,
  p_item_title text,
  p_organizer_note text DEFAULT NULL,
  p_target_date date DEFAULT NULL,
  p_is_completed boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  item_title text,
  organizer_note text,
  target_date date,
  is_completed boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_title text := btrim(p_item_title);
  v_note text := nullif(btrim(p_organizer_note), '');
  v_completed boolean := coalesce(p_is_completed, false);
  v_row public.self_service_private_draft_checklist_items%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_checklist_authorize(p_event_id);
  PERFORM public._organizer_private_checklist_item_validate(v_title, v_note);

  INSERT INTO public.self_service_private_draft_checklist_items(
    event_id, item_title, organizer_note, target_date, is_completed
  ) VALUES (
    p_event_id, v_title, v_note, p_target_date, v_completed
  ) RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.item_title, v_row.organizer_note, v_row.target_date,
    v_row.is_completed, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Edit one checklist item, including ticking / unticking it. Completion is
--    just another editable column on this row; it triggers nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_private_draft_checklist_item(
  p_event_id uuid,
  p_checklist_item_id uuid,
  p_item_title text,
  p_organizer_note text DEFAULT NULL,
  p_target_date date DEFAULT NULL,
  p_is_completed boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  item_title text,
  organizer_note text,
  target_date date,
  is_completed boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_title text := btrim(p_item_title);
  v_note text := nullif(btrim(p_organizer_note), '');
  v_completed boolean := coalesce(p_is_completed, false);
  v_row public.self_service_private_draft_checklist_items%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_checklist_authorize(p_event_id);
  PERFORM public._organizer_private_checklist_item_validate(v_title, v_note);

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_checklist_items AS ci
    WHERE ci.id = p_checklist_item_id AND ci.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Checklist item not found.';
  END IF;

  -- Only this table's own columns are written. Nothing here touches events.*,
  -- the draft marker, the agenda, or any readiness/launch surface, whatever
  -- is_completed is set to.
  UPDATE public.self_service_private_draft_checklist_items AS ci
  SET item_title = v_title,
      organizer_note = v_note,
      target_date = p_target_date,
      is_completed = v_completed,
      updated_at = now()
  WHERE ci.id = p_checklist_item_id AND ci.event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.item_title, v_row.organizer_note, v_row.target_date,
    v_row.is_completed, v_row.created_at, v_row.updated_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Remove one checklist item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_private_draft_checklist_item(
  p_event_id uuid,
  p_checklist_item_id uuid
)
RETURNS TABLE(deleted_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_checklist_authorize(p_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_checklist_items AS ci
    WHERE ci.id = p_checklist_item_id AND ci.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Checklist item not found.';
  END IF;

  DELETE FROM public.self_service_private_draft_checklist_items AS ci
  WHERE ci.id = p_checklist_item_id AND ci.event_id = p_event_id;

  RETURN QUERY SELECT p_checklist_item_id;
END;
$function$;

ALTER FUNCTION public.list_my_private_draft_checklist_items(uuid) OWNER TO postgres;
ALTER FUNCTION public.add_my_private_draft_checklist_item(uuid, text, text, date, boolean) OWNER TO postgres;
ALTER FUNCTION public.update_my_private_draft_checklist_item(uuid, uuid, text, text, date, boolean) OWNER TO postgres;
ALTER FUNCTION public.delete_my_private_draft_checklist_item(uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_my_private_draft_checklist_items(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.add_my_private_draft_checklist_item(uuid, text, text, date, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_my_private_draft_checklist_item(uuid, uuid, text, text, date, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_my_private_draft_checklist_item(uuid, uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_my_private_draft_checklist_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_my_private_draft_checklist_item(uuid, text, text, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_private_draft_checklist_item(uuid, uuid, text, text, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_private_draft_checklist_item(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. P-2D compatibility, in the SAME migration that introduces the table.
--
--    delete_self_service_organizer_event is restated VERBATIM from
--    20261004000000 (the authoritative definition) with ONLY one added block:
--    for an ALREADY-authorized eligible private Draft, THIS Event's checklist
--    rows are removed transactionally right after the P-3F registry-plan
--    cleanup and BEFORE the existing fail-closed dependency scan. The
--    checklist table has no immutability trigger, so no ledger exception or
--    governed-deletion marker is involved. Crucially the cleanup captures NO
--    COUNT of removed items -- the deletion audit stays exactly as minimal as
--    it already was. Every other line -- the auth gate, the governed-deletion
--    markers, the P-3B Agenda cleanup, the P-3C guest cleanup, the P-3D
--    vendor cleanup, the P-3E venue cleanup, the P-3F registry cleanup, the
--    fail-closed dependency scan, the empty-workspace teardown, the minimal
--    non-content deletion audit -- is unchanged. CREATE OR REPLACE preserves
--    the existing postgres ownership and authenticated-only EXECUTE ACL.
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

  -- P-3F organizer private registry-plan cleanup: THIS Event's registry-plan
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Planning data only -- no published registry, provider account,
  -- integration, payment, purchase, gift, or order row exists to remove, and
  -- the deletion audit records only the non-content fact of deletion (no
  -- provider names, URLs, statuses, or notes).
  DELETE FROM public.self_service_private_draft_registry_plans AS srp
  WHERE srp.event_id = p_event_id;

  -- P-3G organizer private planning-checklist cleanup: THIS Event's checklist
  -- rows, removed BEFORE the fail-closed dependency scan and Event delete.
  -- Deliberately NO count is captured: the deletion audit must not learn how
  -- many private reminders the organizer kept, any more than what they said.
  DELETE FROM public.self_service_private_draft_checklist_items AS sci
  WHERE sci.event_id = p_event_id;

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
