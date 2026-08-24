-- Nearby Event/Tenant/Shared Scope Model -- Stage 2: governed reusable
-- Nearby-place -> Event association.
--
-- Adds the one missing bridge the approved architecture identified:
-- populating event_nearby_places.source_master_id (added 20260811120000,
-- unused ever since). Stage 3 (unified editor, Event destination/scope
-- selectors, dirty-edit protection, confirmation UI, delete/retire UI,
-- promotion/demotion) is explicitly not part of this migration, and
-- neither is any reconciliation of the separately-tracked nearby_master
-- RLS/anon-grant drift (Stage 1 closeout item 20) -- re-verified fresh
-- below, still untouched, not folded into this stage.
--
-- LIVE PREFLIGHT (fresh, not assumed from prior-stage notes):
--   * event_nearby_places RLS matches tracked migration history exactly
--     (20260811230000) -- no drift here, unlike nearby_master. INSERT/
--     UPDATE/DELETE: TO authenticated, USING/WITH CHECK
--     has_event_task_authority('event.nearby.manage', event_id). SELECT:
--     TO public, USING (true).
--   * events.tenant_id is NOT NULL (confirmed live) -- every Event has an
--     unambiguous owning Tenant to compare a tenant_specific place's
--     tenant_id against.
--   * has_event_task_authority(p_task_key, p_event_id) delegates to
--     resolve_task_authority(auth.uid(), p_task_key, p_event_id) --
--     unchanged since Stage 0/1's own reads of it.
--   * resolve_effective_nearby_places still reads only
--     event_nearby_places (the nearby_master UNION branch remains
--     disabled, per its own documented geographic-constraint gap) -- a
--     newly associated row is visible through it automatically, with no
--     change required here.
--   * No existing unique constraint governs (event_id, source_master_id)
--     -- and, live-verified fresh, zero of the 85 existing
--     event_nearby_places rows have source_master_id populated, so a
--     new partial unique index on that pair is demonstrably safe against
--     all current data (added below, §1).
--   * nearby_master RLS/grant drift re-verified unchanged from Stage 1's
--     findings (3 policies, 7 anon table grants) -- not reconciled here.
--     This migration's one new RPC is SECURITY DEFINER, owned by
--     postgres, so it is unaffected either way, exactly as Stage 0/1's
--     RPCs already are.
--
-- HIDDEN vs. ARCHIVED, determined from existing canonical meaning, not
-- guessed: public.search_shared_places (20260811120000) already
-- filters `WHERE nm.status = 'active'` -- i.e. the established precedent
-- already treats 'hidden' identically to 'archived' for discovery/
-- reuse purposes, never as "merely hidden from catalog display but
-- still usable." Association below follows that exact precedent: only
-- status = 'active' places are associable, matching search_shared_places
-- bit for bit rather than inventing a different rule for this one path.
--
-- LIFECYCLE: unlike Stage 1's nearby_master RPCs (which correctly omit
-- assert_event_lifecycle_mutable -- a reusable place has no single
-- owning Event), this RPC creates a genuinely Event-scoped
-- event_nearby_places row, exactly the shape create_event_agenda_item/
-- add_presentation_deck_photo already gate. It calls
-- assert_event_lifecycle_mutable(p_event_id) for the same reason those
-- do -- an archived Event's Nearby list should freeze exactly like its
-- Agenda already does, not remain a silently-unguarded exception.

-- ---------------------------------------------------------------------------
-- 1. Duplicate-association protection. Live-verified safe (see preflight
--    above): applies to zero existing rows. Defense-in-depth against a
--    genuine race between two concurrent association calls -- the RPC's
--    own pre-check (§2) already makes the common case an idempotent
--    no-op; this index makes that guarantee hold even under concurrency,
--    via the RPC's own exception handler, never a raw constraint error
--    surfacing to the caller.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX event_nearby_places_event_source_master_unique_idx
  ON public.event_nearby_places (event_id, source_master_id)
  WHERE source_master_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. public.associate_nearby_master_place_with_event -- the missing
--    per-place bridge.
--
-- Authority is two independent checks, exactly as specified: (a)
-- has_event_task_authority('event.nearby.manage', p_event_id) -- the
-- caller may manage this Event's Nearby list at all (destination-Event-
-- based, not catalog authority -- a Tenant Admin or Super Admin reaches
-- this the same way an Event Admin does, through that same task
-- resolver, never a second/parallel check); then (b) a pure data check,
-- never an authority call, that the selected place is actually usable by
-- that Event's Tenant: shared_public places are usable by any authorized
-- Event; tenant_specific places require
-- nearby_master.tenant_id = events.tenant_id exactly -- a caller cannot
-- attach another Tenant's private place merely by knowing its id, even
-- with full authority over their own Event.
--
-- Eligibility: status = 'active' (excludes both archived and hidden, per
-- the search_shared_places precedent above) and review_status =
-- 'approved' (checked unconditionally, not scope-conditionally --
-- tenant_specific rows are always 'approved' by construction since Stage
-- 0's record_tenant_place, so this is equivalent in practice to a
-- shared_public-only check, but remains correct even if that invariant
-- were ever violated). This is never a bypass around Shared review: a
-- pending_review or rejected shared_public candidate cannot be
-- associated by this RPC at all, by construction.
--
-- Display fields are read from the loaded nearby_master row inside the
-- function -- never resubmitted by the caller -- exactly matching the
-- approved identity/use split: nearby_master remains the reusable
-- identity, the new event_nearby_places row is an independent snapshot
-- copy, editable afterward through the existing Event-place workflow
-- exactly like any other event_nearby_places row, and never rewritten by
-- a later master edit (update_nearby_master_place, Stage 1, touches only
-- nearby_master -- it has no awareness of, and never writes,
-- event_nearby_places).
--
-- FIELD MAPPING (nearby_master -> event_nearby_places, this association
-- only):
--   name              <- name
--   address           <- address
--   phone             <- phone
--   website           <- link
--   category          <- category
--   category_id       <- category_id
--   notes             <- description
--   location_code     <- location_code
--   lat               <- lat
--   lng               <- lng
--   source_master_id  <- id
--   event_id          <- p_event_id (parameter)
-- Event-specific, never copied from the master, initialized to the same
-- defaults the existing per-place admin editor already uses for a new
-- row: sort_order (appended after the Event's current maximum, matching
-- saveEventPlace()'s own `eventPlaces.length + 1` precedent), is_hidden
-- = false, distance_miles left NULL (unknown at association time,
-- matching both bulk functions' own `distance_miles: null`).
-- master_place_id (the legacy, already-dead column) is never written
-- here either, matching every other live insert path.
--
-- Idempotent by construction: a pre-check returns the existing
-- association row unchanged if (event_id, source_master_id) already
-- exists -- no error, no duplicate. The unique index above (§1) backstops
-- a genuine concurrent race: if two calls interleave past the pre-check,
-- the loser's INSERT raises unique_violation, caught here and resolved
-- by returning the winner's now-committed row -- the caller always gets
-- a single, consistent association row back, never a raw constraint
-- error and never a silent duplicate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.associate_nearby_master_place_with_event(
  p_event_id uuid,
  p_place_id uuid
)
RETURNS public.event_nearby_places
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event_tenant_id uuid;
  v_place public.nearby_master%ROWTYPE;
  v_existing public.event_nearby_places%ROWTYPE;
  v_row public.event_nearby_places%ROWTYPE;
  v_sort_order integer;
BEGIN
  SELECT e.tenant_id INTO v_event_tenant_id
  FROM public.events AS e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'associate_nearby_master_place_with_event: event % not found', p_event_id;
  END IF;

  IF NOT public.has_event_task_authority('event.nearby.manage', p_event_id) THEN
    RAISE EXCEPTION 'associate_nearby_master_place_with_event: caller is not authorized to manage nearby places for event %', p_event_id;
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  SELECT nm.* INTO v_place
  FROM public.nearby_master AS nm
  WHERE nm.id = p_place_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % not found', p_place_id;
  END IF;

  IF v_place.scope = 'tenant_specific' THEN
    IF v_place.tenant_id IS DISTINCT FROM v_event_tenant_id THEN
      RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % belongs to a different tenant than event %', p_place_id, p_event_id;
    END IF;
  ELSIF v_place.scope = 'shared_public' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % has an unrecognized scope %', p_place_id, v_place.scope;
  END IF;

  IF v_place.status <> 'active' THEN
    RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % is not active (status=%)', p_place_id, v_place.status;
  END IF;

  IF v_place.review_status <> 'approved' THEN
    RAISE EXCEPTION 'associate_nearby_master_place_with_event: place % is not approved (review_status=%)', p_place_id, v_place.review_status;
  END IF;

  SELECT * INTO v_existing
  FROM public.event_nearby_places
  WHERE event_id = p_event_id AND source_master_id = p_place_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_sort_order := COALESCE(
    (SELECT max(sort_order) FROM public.event_nearby_places WHERE event_id = p_event_id),
    0
  ) + 1;

  BEGIN
    INSERT INTO public.event_nearby_places (
      event_id, source_master_id, name, address, phone, website, category, category_id,
      notes, location_code, lat, lng, sort_order, is_hidden
    ) VALUES (
      p_event_id, v_place.id, v_place.name, v_place.address, v_place.phone, v_place.link,
      v_place.category, v_place.category_id, v_place.description, v_place.location_code,
      v_place.lat, v_place.lng, v_sort_order, false
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row
    FROM public.event_nearby_places
    WHERE event_id = p_event_id AND source_master_id = p_place_id;
  END;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.associate_nearby_master_place_with_event(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.associate_nearby_master_place_with_event(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.associate_nearby_master_place_with_event(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reassignment compatibility -- finding only, no new RPC.
--
-- The existing event_nearby_places UPDATE policy already re-evaluates
-- has_event_task_authority('event.nearby.manage', event_id) against the
-- NEW row on a raw `.update({event_id: ...})` (USING for the old row,
-- WITH CHECK for the new one) -- so a linked row CAN already be
-- reassigned to another Event the caller is authorized for, without
-- losing source_master_id (RLS has no opinion on that column at all).
--
-- FLAGGED, per instruction: that same raw UPDATE has no awareness
-- whatsoever of whether the linked nearby_master row's scope remains
-- valid for the destination Event's Tenant. Reassigning a
-- tenant_specific-linked row to an Event in a different Tenant would
-- succeed today, silently leaving source_master_id pointing at a place
-- the destination Tenant has no rights to. No RPC in this migration
-- performs or gates reassignment -- building one is not mechanically
-- required for this stage's own association correctness, so none is
-- added here. This gap is reported for a future stage's explicit
-- authorization, not fixed opportunistically now.
-- ---------------------------------------------------------------------------
