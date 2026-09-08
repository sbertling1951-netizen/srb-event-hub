-- P-3D follow-on: split the private Vendor Plan's single opaque "contact
-- detail" into an explicit, optional Contact name + Phone number, WITHOUT
-- disturbing any data or any caller that already exists.
--
-- Still PLANNING DATA ONLY, exactly as
-- docs/architecture/EPICENTRAX_PRIVATE_VENDOR_PLAN_CONTRACT.md requires. A
-- contact name and a phone number typed here are private notes the organizer
-- keeps so she can read them back. They are NEVER normalized, parsed, matched,
-- looked up, resolved to a Person, messaged, invited, notified, or turned into
-- a vendor account, contact, access grant, candidacy, admission, or payment.
--
-- ===========================================================================
-- MIGRATION-BEFORE-DEPLOY COMPATIBILITY (the whole point of this file)
-- ===========================================================================
-- This migration is applied while the PREVIOUS P-3D app build (ac044fe) is
-- still serving. That build calls, through PostgREST, with NAMED arguments:
--
--   list_my_private_draft_vendor_plans(p_event_id)
--   add_my_private_draft_vendor_plan(p_event_id, p_vendor_name,
--     p_service_category, p_planning_status, p_website, p_contact_detail,
--     p_organizer_note)
--   update_my_private_draft_vendor_plan(p_event_id, p_vendor_plan_id,
--     p_vendor_name, p_service_category, p_planning_status, p_website,
--     p_contact_detail, p_organizer_note)
--   delete_my_private_draft_vendor_plan(p_event_id, p_vendor_plan_id)
--
-- Three deliberate choices keep that build working unchanged:
--
--   1. The two new parameters are APPENDED LAST and both DEFAULT NULL. Every
--      pre-existing parameter keeps its name, type, position, and default, so
--      the old build's named-argument calls still resolve and simply leave the
--      new columns NULL.
--
--   2. These functions are DROPped and recreated rather than CREATE OR
--      REPLACEd. CREATE OR REPLACE cannot change a function's return type or
--      argument list -- it would create a SECOND overload beside the old one,
--      and the old build's 7-named-argument call would then match BOTH and
--      fail as ambiguous ("function is not unique"). Dropping first
--      guarantees exactly ONE function of each name exists. The whole file is
--      one transaction, so there is no window in which a function is missing;
--      concurrent callers simply block on the DDL lock until COMMIT.
--
--   3. The RETURNS TABLE gains two columns at the END. Extra result columns
--      are additive for the old build, whose row parser reads the keys it
--      knows and ignores the rest.
--
-- `delete_my_private_draft_vendor_plan` is not touched at all -- it has no
-- field arguments and needs no change.
--
-- delete_self_service_organizer_event is DELIBERATELY NOT restated here: this
-- migration adds no child table, so the governed deletion path, its
-- fail-closed dependency scan, its markers, and its minimal non-content audit
-- are all untouched and keep working exactly as 20261001000000 left them.
--
-- ===========================================================================
-- LEGACY DATA
-- ===========================================================================
-- `contact_detail` is KEPT, exactly as it is. This migration does not read,
-- parse, split, guess at, backfill, migrate, or delete a single existing
-- value. A row written by the old build keeps its opaque contact_detail
-- verbatim; the new UI shows it under a clearly-labelled legacy heading and
-- never pretends it is a contact name or a phone number.
--
-- What this migration does NOT do:
--   * it never references vendors, event_vendors, vendor_contacts,
--     vendor_org_access, vendor invitations, candidacy, admission,
--     dispositions, vendor access tokens, the vendor workspace, or vendor
--     catalog authority;
--   * it never writes people, person_identifiers, person_auth_accounts,
--     attendees, registrations, capacity, check-in, notifications, or any
--     public/member visibility;
--   * it adds NO catalog reference and NO cost/quote/currency/budget field;
--   * it changes NO authorization rule -- _organizer_private_draft_vendor_plan_authorize
--     is untouched and still the only gate.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Two new nullable planning columns. Length-bounded only, exactly like
--    every other planner-entered field on this table. contact_detail is left
--    completely alone beside them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.self_service_private_draft_vendor_plans
  ADD COLUMN contact_name text
    CHECK (contact_name IS NULL OR (btrim(contact_name) <> '' AND length(contact_name) <= 200)),
  ADD COLUMN contact_phone text
    CHECK (contact_phone IS NULL OR (btrim(contact_phone) <> '' AND length(contact_phone) <= 50));

COMMENT ON COLUMN public.self_service_private_draft_vendor_plans.contact_name IS
  'Optional private planning note: who the organizer speaks to. Opaque text; never matched or resolved to a Person.';
COMMENT ON COLUMN public.self_service_private_draft_vendor_plans.contact_phone IS
  'Optional private planning note: a phone number the organizer wrote down. Opaque text; never normalized, dialled, messaged, or matched.';
COMMENT ON COLUMN public.self_service_private_draft_vendor_plans.contact_detail IS
  'LEGACY, pre-20261002000000 free-text contact field. Retained verbatim and never parsed or backfilled; superseded for new entries by contact_name + contact_phone.';

-- ---------------------------------------------------------------------------
-- 2. Validation gains the two new optional fields. DROP + recreate: the
--    argument list changes, so CREATE OR REPLACE cannot be used. This helper
--    is internal and granted to nobody, so no caller is affected.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._organizer_private_vendor_plan_validate(text, text, text, text, text, text);

CREATE FUNCTION public._organizer_private_vendor_plan_validate(
  p_vendor_name text, p_service_category text, p_planning_status text,
  p_website text, p_contact_detail text, p_organizer_note text,
  p_contact_name text, p_contact_phone text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_vendor_name IS NULL OR btrim(p_vendor_name) = '' OR length(btrim(p_vendor_name)) > 200 THEN
    RAISE EXCEPTION 'A vendor plan entry needs a name of 200 characters or fewer.';
  END IF;
  IF p_planning_status IS NULL OR p_planning_status NOT IN ('considering', 'contacted', 'selected') THEN
    RAISE EXCEPTION 'A vendor plan status must be considering, contacted, or selected.';
  END IF;
  IF p_service_category IS NOT NULL AND length(p_service_category) > 120 THEN
    RAISE EXCEPTION 'A vendor plan category must be 120 characters or fewer.';
  END IF;
  IF p_website IS NOT NULL AND length(p_website) > 500 THEN
    RAISE EXCEPTION 'A vendor plan website must be 500 characters or fewer.';
  END IF;
  IF p_contact_detail IS NOT NULL AND length(p_contact_detail) > 320 THEN
    RAISE EXCEPTION 'A vendor plan contact detail must be 320 characters or fewer.';
  END IF;
  IF p_contact_name IS NOT NULL AND length(p_contact_name) > 200 THEN
    RAISE EXCEPTION 'A vendor plan contact name must be 200 characters or fewer.';
  END IF;
  IF p_contact_phone IS NOT NULL AND length(p_contact_phone) > 50 THEN
    RAISE EXCEPTION 'A vendor plan phone number must be 50 characters or fewer.';
  END IF;
  IF p_organizer_note IS NOT NULL AND length(p_organizer_note) > 2000 THEN
    RAISE EXCEPTION 'A vendor plan note must be 2000 characters or fewer.';
  END IF;
END;
$function$;

ALTER FUNCTION public._organizer_private_vendor_plan_validate(text, text, text, text, text, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public._organizer_private_vendor_plan_validate(text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Read: two more columns, appended last. The authorization call is
--    unchanged and still runs before any row is touched.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_my_private_draft_vendor_plans(uuid);

CREATE FUNCTION public.list_my_private_draft_vendor_plans(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  vendor_name text,
  service_category text,
  planning_status text,
  website text,
  contact_detail text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz,
  contact_name text,
  contact_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._organizer_private_draft_vendor_plan_authorize(p_event_id);

  RETURN QUERY
  SELECT vp.id, vp.vendor_name, vp.service_category, vp.planning_status,
         vp.website, vp.contact_detail, vp.organizer_note,
         vp.created_at, vp.updated_at, vp.contact_name, vp.contact_phone
  FROM public.self_service_private_draft_vendor_plans AS vp
  WHERE vp.event_id = p_event_id
  ORDER BY vp.created_at, vp.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Add: the two new parameters are appended LAST and default NULL, so the
--    already-deployed build's 7-named-argument call still resolves.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.add_my_private_draft_vendor_plan(uuid, text, text, text, text, text, text);

CREATE FUNCTION public.add_my_private_draft_vendor_plan(
  p_event_id uuid,
  p_vendor_name text,
  p_service_category text DEFAULT NULL,
  p_planning_status text DEFAULT 'considering',
  p_website text DEFAULT NULL,
  p_contact_detail text DEFAULT NULL,
  p_organizer_note text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  vendor_name text,
  service_category text,
  planning_status text,
  website text,
  contact_detail text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz,
  contact_name text,
  contact_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_vendor_name text := btrim(p_vendor_name);
  v_category text := nullif(btrim(p_service_category), '');
  -- NULL means the argument was omitted -> the contract's default. Anything
  -- else must be EXACTLY one of the three approved statuses; a blank or
  -- unrecognized value is rejected, never silently coerced to a default.
  v_status text := coalesce(btrim(p_planning_status), 'considering');
  v_website text := nullif(btrim(p_website), '');
  v_contact text := nullif(btrim(p_contact_detail), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_contact_phone text := nullif(btrim(p_contact_phone), '');
  v_note text := nullif(btrim(p_organizer_note), '');
  v_row public.self_service_private_draft_vendor_plans%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_vendor_plan_authorize(p_event_id);
  PERFORM public._organizer_private_vendor_plan_validate(
    v_vendor_name, v_category, v_status, v_website, v_contact, v_note,
    v_contact_name, v_contact_phone
  );

  INSERT INTO public.self_service_private_draft_vendor_plans(
    event_id, vendor_name, service_category, planning_status, website,
    contact_detail, organizer_note, contact_name, contact_phone
  ) VALUES (
    p_event_id, v_vendor_name, v_category, v_status, v_website, v_contact,
    v_note, v_contact_name, v_contact_phone
  ) RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.vendor_name, v_row.service_category, v_row.planning_status,
    v_row.website, v_row.contact_detail, v_row.organizer_note,
    v_row.created_at, v_row.updated_at, v_row.contact_name, v_row.contact_phone;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Edit: same appended-and-defaulted shape. contact_detail remains a normal
--    writable parameter so the already-deployed build keeps its exact current
--    behavior, and so the new build can round-trip a legacy value back
--    UNCHANGED instead of silently blanking it on an unrelated edit.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_my_private_draft_vendor_plan(uuid, uuid, text, text, text, text, text, text);

CREATE FUNCTION public.update_my_private_draft_vendor_plan(
  p_event_id uuid,
  p_vendor_plan_id uuid,
  p_vendor_name text,
  p_service_category text DEFAULT NULL,
  p_planning_status text DEFAULT 'considering',
  p_website text DEFAULT NULL,
  p_contact_detail text DEFAULT NULL,
  p_organizer_note text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  vendor_name text,
  service_category text,
  planning_status text,
  website text,
  contact_detail text,
  organizer_note text,
  created_at timestamptz,
  updated_at timestamptz,
  contact_name text,
  contact_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_vendor_name text := btrim(p_vendor_name);
  v_category text := nullif(btrim(p_service_category), '');
  v_status text := coalesce(btrim(p_planning_status), 'considering');
  v_website text := nullif(btrim(p_website), '');
  v_contact text := nullif(btrim(p_contact_detail), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_contact_phone text := nullif(btrim(p_contact_phone), '');
  v_note text := nullif(btrim(p_organizer_note), '');
  v_row public.self_service_private_draft_vendor_plans%ROWTYPE;
BEGIN
  PERFORM public._organizer_private_draft_vendor_plan_authorize(p_event_id);
  PERFORM public._organizer_private_vendor_plan_validate(
    v_vendor_name, v_category, v_status, v_website, v_contact, v_note,
    v_contact_name, v_contact_phone
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.self_service_private_draft_vendor_plans AS vp
    WHERE vp.id = p_vendor_plan_id AND vp.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Vendor plan entry not found.';
  END IF;

  UPDATE public.self_service_private_draft_vendor_plans AS vp
  SET vendor_name = v_vendor_name,
      service_category = v_category,
      planning_status = v_status,
      website = v_website,
      contact_detail = v_contact,
      organizer_note = v_note,
      contact_name = v_contact_name,
      contact_phone = v_contact_phone,
      updated_at = now()
  WHERE vp.id = p_vendor_plan_id AND vp.event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.vendor_name, v_row.service_category, v_row.planning_status,
    v_row.website, v_row.contact_detail, v_row.organizer_note,
    v_row.created_at, v_row.updated_at, v_row.contact_name, v_row.contact_phone;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. DROP + CREATE discards each function's ACL, so ownership and the
--    authenticated-only EXECUTE grant are restated here exactly as
--    20261001000000 established them. delete_my_private_draft_vendor_plan is
--    untouched above and therefore keeps its original owner and ACL.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.list_my_private_draft_vendor_plans(uuid) OWNER TO postgres;
ALTER FUNCTION public.add_my_private_draft_vendor_plan(uuid, text, text, text, text, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.update_my_private_draft_vendor_plan(uuid, uuid, text, text, text, text, text, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_my_private_draft_vendor_plans(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.add_my_private_draft_vendor_plan(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_my_private_draft_vendor_plan(uuid, uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_my_private_draft_vendor_plans(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_my_private_draft_vendor_plan(uuid, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_private_draft_vendor_plan(uuid, uuid, text, text, text, text, text, text, text, text) TO authenticated;

COMMIT;
