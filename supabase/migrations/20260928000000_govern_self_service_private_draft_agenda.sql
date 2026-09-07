-- P-3B: a private Agenda for a self-service organizer's own unfinished private
-- draft.
--
-- ONE shared Agenda engine reached through an organizer-authorized doorway.
-- This is NOT the FCOC/admin agenda path and NOT a grant of Event task
-- authority:
--   * no organizer RPC here calls has_event_task_authority;
--   * no admin agenda RPC (create/update/delete_event_agenda_item,
--     reorder/import, templates) is modified;
--   * no admin agenda RLS policy, admin route guard, or selected-admin-event
--     behavior is touched.
--
-- It REUSES the shared agenda substrate:
--   * storage: public.agenda_items (items forced is_published = false,
--     source = 'organizer_manual');
--   * optimistic concurrency: public.event_agenda_state +
--     public._agenda_event_version_advance (identical stale_agenda_version
--     semantics as the admin path -- the two share one per-Event version);
--   * audit: public.agenda_command_ledger + public._agenda_ledger_log, with a
--     distinct authority branch ('organizer') and distinct actions so
--     organizer activity is never mislabeled as tenant-admin task-authority
--     activity.
--
-- Authorization is the exact self-service organizer-owner rule already used by
-- get_my_self_service_private_draft / delete_self_service_organizer_event /
-- save_my_self_service_private_draft_details.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tightly-scoped agenda command-ledger taxonomy extension: one new
--    authority-branch value + three new organizer action values. Every
--    existing value is restated verbatim. No other ledger column, trigger,
--    RLS, or grant changes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agenda_command_ledger
  DROP CONSTRAINT agenda_command_ledger_resolved_authority_branch_check;
ALTER TABLE public.agenda_command_ledger
  ADD CONSTRAINT agenda_command_ledger_resolved_authority_branch_check
  CHECK (resolved_authority_branch IN ('platform', 'tenant', 'event', 'compound', 'organizer'));

ALTER TABLE public.agenda_command_ledger
  DROP CONSTRAINT agenda_command_ledger_action_check;
ALTER TABLE public.agenda_command_ledger
  ADD CONSTRAINT agenda_command_ledger_action_check CHECK (action IN (
    'root_created', 'revision_created', 'revision_published', 'revision_superseded',
    'root_archived', 'template_duplicated', 'template_promoted',
    'event_agenda_saved_as_template', 'template_applied', 'agenda_replaced',
    'revision_content_edited',
    'event_agenda_item_created', 'event_agenda_item_updated', 'event_agenda_item_deleted',
    'event_agenda_items_reordered', 'event_agenda_items_imported',
    'organizer_private_agenda_item_created',
    'organizer_private_agenda_item_updated',
    'organizer_private_agenda_item_deleted'
  ));

-- ---------------------------------------------------------------------------
-- 2. Internal helper: authorize the caller as the canonical owner of ONE
--    eligible private-draft Event's agenda. Raises 'Draft not found.' for
--    every miss (missing / non-owned / non-private / live / member-visible),
--    non-enumerating. Never calls has_event_task_authority and never reads
--    tenant/admin authority.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_draft_agenda_authorize(p_event_id uuid)
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
    RAISE EXCEPTION 'Editing an agenda requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_actor
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Editing an agenda requires a verified account email.';
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

ALTER FUNCTION public._organizer_private_draft_agenda_authorize(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_draft_agenda_authorize(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared input validation for an organizer private-draft agenda item.
-- start_time is REQUIRED because public.agenda_items.start_time is NOT NULL
-- (shared storage); every other field is optional.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._organizer_private_agenda_item_validate(
  p_title text, p_description text, p_location text, p_speaker text,
  p_start_time time, p_end_time time
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_title IS NULL OR btrim(p_title) = '' OR length(btrim(p_title)) > 200 THEN
    RAISE EXCEPTION 'An agenda item needs a title of 200 characters or fewer.';
  END IF;
  IF p_start_time IS NULL THEN
    RAISE EXCEPTION 'An agenda item needs a start time.';
  END IF;
  IF p_end_time IS NOT NULL AND p_end_time < p_start_time THEN
    RAISE EXCEPTION 'An agenda item end time cannot be before its start time.';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'An agenda item description must be 2000 characters or fewer.';
  END IF;
  IF p_location IS NOT NULL AND length(p_location) > 500 THEN
    RAISE EXCEPTION 'An agenda item location must be 500 characters or fewer.';
  END IF;
  IF p_speaker IS NOT NULL AND length(p_speaker) > 200 THEN
    RAISE EXCEPTION 'An agenda item speaker must be 200 characters or fewer.';
  END IF;
END;
$function$;

ALTER FUNCTION public._organizer_private_agenda_item_validate(text, text, text, text, time, time)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_agenda_item_validate(text, text, text, text, time, time)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Read: the caller's own private-draft agenda + its shared version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_private_draft_agenda(p_event_id uuid)
RETURNS TABLE(agenda_version integer, items jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_agenda_authorize(p_event_id);

  RETURN QUERY
  SELECT
    coalesce(
      (SELECT s.version FROM public.event_agenda_state AS s WHERE s.event_id = p_event_id),
      0
    ),
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ai.id,
            'title', ai.title,
            'description', ai.description,
            'location', ai.location,
            'speaker', ai.speaker,
            'agenda_date', ai.agenda_date,
            'start_time', ai.start_time,
            'end_time', ai.end_time
          )
          ORDER BY ai.agenda_date NULLS LAST, ai.start_time NULLS LAST, ai.created_at, ai.id
        )
        FROM public.agenda_items AS ai
        WHERE ai.event_id = p_event_id
      ),
      '[]'::jsonb
    );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Create one agenda item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_my_private_draft_agenda_item(
  p_event_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_speaker text DEFAULT NULL,
  p_agenda_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL
)
RETURNS TABLE(agenda_version integer, item jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_title text := btrim(p_title);
  v_description text := nullif(btrim(p_description), '');
  v_location text := nullif(btrim(p_location), '');
  v_speaker text := nullif(btrim(p_speaker), '');
  v_version integer;
  v_item public.agenda_items%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_agenda_authorize(p_event_id);
  PERFORM public._organizer_private_agenda_item_validate(
    v_title, v_description, v_location, v_speaker, p_start_time, p_end_time
  );

  -- Create has no prior state to conflict with -- matches the admin contract.
  v_version := public._agenda_event_version_advance(p_event_id, NULL);

  INSERT INTO public.agenda_items(
    event_id, title, description, location, speaker,
    agenda_date, start_time, end_time, is_published, source
  ) VALUES (
    p_event_id, v_title, v_description, v_location, v_speaker,
    p_agenda_date, p_start_time, p_end_time, false, 'organizer_manual'
  ) RETURNING * INTO v_item;

  -- Direct ledger insert (the ledger is immutable -- no follow-up UPDATE),
  -- with a distinct organizer authority branch and a NULL admin task_key so
  -- organizer activity is never mislabeled as tenant-admin task authority.
  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,
    agenda_item_id, correlation_id, after_state, outcome
  ) VALUES (
    'organizer_private_agenda_item_created', v_actor, 'organizer', NULL, p_event_id,
    v_item.id, gen_random_uuid(),
    jsonb_build_object('id', v_item.id, 'title', v_item.title), 'success'
  );

  RETURN QUERY SELECT v_version, jsonb_build_object(
    'id', v_item.id, 'title', v_item.title, 'description', v_item.description,
    'location', v_item.location, 'speaker', v_item.speaker,
    'agenda_date', v_item.agenda_date, 'start_time', v_item.start_time, 'end_time', v_item.end_time
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Update one agenda item (optimistic-concurrency protected).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_private_draft_agenda_item(
  p_event_id uuid,
  p_item_id uuid,
  p_expected_agenda_version integer,
  p_title text,
  p_description text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_speaker text DEFAULT NULL,
  p_agenda_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL
)
RETURNS TABLE(agenda_version integer, item jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_title text := btrim(p_title);
  v_description text := nullif(btrim(p_description), '');
  v_location text := nullif(btrim(p_location), '');
  v_speaker text := nullif(btrim(p_speaker), '');
  v_version integer;
  v_item public.agenda_items%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_agenda_authorize(p_event_id);
  PERFORM public._organizer_private_agenda_item_validate(
    v_title, v_description, v_location, v_speaker, p_start_time, p_end_time
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_items AS ai
    WHERE ai.id = p_item_id AND ai.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Agenda item not found.';
  END IF;

  v_version := public._agenda_event_version_advance(p_event_id, p_expected_agenda_version);

  UPDATE public.agenda_items AS ai
  SET title = v_title,
      description = v_description,
      location = v_location,
      speaker = v_speaker,
      agenda_date = p_agenda_date,
      start_time = p_start_time,
      end_time = p_end_time
  WHERE ai.id = p_item_id AND ai.event_id = p_event_id
  RETURNING * INTO v_item;

  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,
    agenda_item_id, correlation_id, after_state, outcome
  ) VALUES (
    'organizer_private_agenda_item_updated', v_actor, 'organizer', NULL, p_event_id,
    p_item_id, gen_random_uuid(),
    jsonb_build_object('id', v_item.id, 'title', v_item.title), 'success'
  );

  RETURN QUERY SELECT v_version, jsonb_build_object(
    'id', v_item.id, 'title', v_item.title, 'description', v_item.description,
    'location', v_item.location, 'speaker', v_item.speaker,
    'agenda_date', v_item.agenda_date, 'start_time', v_item.start_time, 'end_time', v_item.end_time
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Delete one agenda item (optimistic-concurrency protected).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_private_draft_agenda_item(
  p_event_id uuid,
  p_item_id uuid,
  p_expected_agenda_version integer
)
RETURNS TABLE(agenda_version integer, deleted_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_version integer;
BEGIN
  PERFORM public._organizer_private_draft_agenda_authorize(p_event_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_items AS ai
    WHERE ai.id = p_item_id AND ai.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Agenda item not found.';
  END IF;

  v_version := public._agenda_event_version_advance(p_event_id, p_expected_agenda_version);

  DELETE FROM public.agenda_items AS ai
  WHERE ai.id = p_item_id AND ai.event_id = p_event_id;

  INSERT INTO public.agenda_command_ledger(
    action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,
    agenda_item_id, correlation_id, outcome
  ) VALUES (
    'organizer_private_agenda_item_deleted', v_actor, 'organizer', NULL, p_event_id,
    p_item_id, gen_random_uuid(), 'success'
  );

  RETURN QUERY SELECT v_version, p_item_id;
END;
$function$;

ALTER FUNCTION public.get_my_private_draft_agenda(uuid) OWNER TO postgres;
ALTER FUNCTION public.create_my_private_draft_agenda_item(uuid, text, text, text, text, date, time, time) OWNER TO postgres;
ALTER FUNCTION public.update_my_private_draft_agenda_item(uuid, uuid, integer, text, text, text, text, date, time, time) OWNER TO postgres;
ALTER FUNCTION public.delete_my_private_draft_agenda_item(uuid, uuid, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_private_draft_agenda(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.create_my_private_draft_agenda_item(uuid, text, text, text, text, date, time, time) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_my_private_draft_agenda_item(uuid, uuid, integer, text, text, text, text, date, time, time) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.delete_my_private_draft_agenda_item(uuid, uuid, integer) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_private_draft_agenda(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_private_draft_agenda_item(uuid, text, text, text, text, date, time, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_private_draft_agenda_item(uuid, uuid, integer, text, text, text, text, date, time, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_private_draft_agenda_item(uuid, uuid, integer) TO authenticated;

COMMIT;
