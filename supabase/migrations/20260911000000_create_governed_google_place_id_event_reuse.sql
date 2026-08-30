-- Governed Google Place-ID -> Event canonical reuse for the Nearby
-- curated-list builder.
--
-- Problem this solves. The builder's Search Candidates carry an exact
-- Google Place ID. Some of those places already exist as an approved
-- canonical `nearby_master` row. The browser must be able to REUSE such a
-- place for the current Event (an additive Event association) instead of
-- inserting a divergent Event-only snapshot -- without this function
-- itself returning a `nearby_master.id`, without it becoming a
-- catalog-membership oracle, and without it granting any
-- catalog-management capability.
--
-- Scope note: `nearby_master` rows are already readable by any
-- authenticated role (the tracked, still-unreconciled Stage-1 RLS drift
-- `nearby_master_authenticated_select_policy`, 20260823080000 Part B), so
-- the `id` and scope of a catalog row are not themselves secret. What
-- stays opaque is the Google-Place-ID <-> `nearby_master` *linkage*
-- (`nearby_master_provider_identities`, fully REVOKEd). This function's
-- `reused` answer necessarily reveals the positive side of that linkage
-- for an approved, in-scope place -- which is inherent to reuse and
-- acceptable -- but it never hands back the id and never reveals the
-- linkage for an ineligible place.
--
-- `list_matching_google_place_ids_for_nearby_administration`
-- (20260825020000) deliberately returns only the Google Place ID and only
-- to platform/tenant admins -- it is a suppression read, not a reuse
-- path, and it cannot answer "which canonical row" or serve a plain Event
-- Admin.
--
-- This function is a single mutation-owning operation. It takes the exact
-- Google Place IDs the builder wants to reuse and, for each one, either
-- performs the additive association (delegating entirely to
-- `associate_nearby_master_place_with_event`, which stays the authority
-- backstop and owns snapshot mapping, idempotence, and the unique-index
-- race handling) or reports that the place is not reusable for this Event.
-- It returns only a collapsed outcome per Place ID -- never a master id,
-- never a reason that would distinguish "no canonical row" from "wrong
-- Tenant" / "pending_review" / "rejected" (that collapse is
-- defense-in-depth given the Part B drift above, not the sole barrier).
-- `nearby_master_provider_identities` stays fully REVOKEd from every
-- browser-reachable role; this migration adds no grant on it.
--
-- Eligibility predicate is IDENTICAL to
-- `associate_nearby_master_place_with_event`'s own checks
-- (20260823070000): active, review_status = 'approved', and
-- shared_public OR tenant_specific matching the Event's Tenant. Authority
-- is `event.nearby.manage` for the Event (the same gate the association
-- RPC uses -- reuse of an approved place does not require Tenant catalog
-- authority). Event lifecycle must be mutable.
--
-- Failed-association classification. On ANY exception from the delegated
-- association the nested error is discarded UNSEEN (it is not classified
-- by SQLSTATE -- P0001 is PostgreSQL's generic user-raised code and does
-- not prove ineligibility). The true reason is re-derived from CURRENT
-- state: re-check event.nearby.manage authority, re-check Event lifecycle
-- mutability, and re-run the exact eligibility predicate. `not_reusable`
-- is returned ONLY when that re-check proves the exact candidate is now
-- ineligible. Authority lost, lifecycle no longer mutable, an unexpected
-- error, or "still eligible" (the nested failure was genuinely
-- unexpected) all raise the single identifier-free `Nearby place reuse
-- failed.` -- never `not_reusable`, so the client never falls through to
-- an Event-only insert. Each re-check runs inside its own handler so its
-- own exception text cannot leak either.

BEGIN;

-- ============================================================
-- PARITY START: copied verbatim into the linked rollback fixture
-- ============================================================

CREATE OR REPLACE FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(
  p_event_id uuid,
  p_google_place_ids text[]
)
RETURNS TABLE (
  google_place_id text,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_event_task_allowed boolean;
  v_event_tenant_id uuid;
  v_place_id text;
  v_master_id uuid;
  v_already boolean;
  v_recheck_allowed boolean;
  v_recheck_tenant_id uuid;
  v_recheck_master_id uuid;
  v_failure_class text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nearby place reuse requires authenticated authority.';
  END IF;

  -- Same authority as associate_nearby_master_place_with_event: the
  -- resolve_task_authority call also yields the Event's Tenant, used for
  -- the tenant_specific scope check below.
  SELECT authority.allowed, authority.tenant_id
    INTO v_event_task_allowed, v_event_tenant_id
  FROM public.resolve_task_authority(v_actor, 'event.nearby.manage', p_event_id) AS authority;

  IF v_event_task_allowed IS DISTINCT FROM true OR v_event_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nearby place reuse requires event.nearby.manage authority.';
  END IF;

  -- Fail early and uniformly on an immutable Event; the association RPC
  -- would raise the same condition per row.
  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  IF coalesce(cardinality(p_google_place_ids), 0) = 0 THEN
    RETURN;
  END IF;

  FOR v_place_id IN
    SELECT DISTINCT nullif(btrim(candidate.value), '')
    FROM unnest(p_google_place_ids) AS candidate(value)
    WHERE nullif(btrim(candidate.value), '') IS NOT NULL
  LOOP
    google_place_id := v_place_id;
    v_master_id := NULL;

    -- Exact provider identity only. No name/address/coordinate matching.
    -- The scope/status/review predicate is exactly what
    -- associate_nearby_master_place_with_event will itself enforce.
    SELECT master.id
      INTO v_master_id
    FROM public.nearby_master_provider_identities AS provider_identity
    JOIN public.nearby_master AS master
      ON master.id = provider_identity.nearby_master_id
    WHERE provider_identity.provider = 'google_places'
      AND provider_identity.provider_place_id = v_place_id
      AND master.status = 'active'
      AND master.review_status = 'approved'
      AND (
        master.scope = 'shared_public'
        OR (master.scope = 'tenant_specific' AND master.tenant_id = v_event_tenant_id)
      );

    IF v_master_id IS NULL THEN
      -- Collapsed: no canonical row, wrong Tenant, pending_review, and
      -- rejected all report the same thing.
      outcome := 'not_reusable';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_nearby_places AS existing
      WHERE existing.event_id = p_event_id
        AND existing.source_master_id = v_master_id
    )
      INTO v_already;

    IF v_already THEN
      outcome := 'already_associated';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Delegate the write in a subtransaction. The eligibility SELECT above
    -- and this PERFORM are not atomic; the BEGIN..EXCEPTION block is a
    -- subtransaction, so ANY failure here rolls back a partial association
    -- -- nothing half-written can persist.
    BEGIN
      PERFORM public.associate_nearby_master_place_with_event(p_event_id, v_master_id);
      outcome := 'reused';
      RETURN NEXT;
      CONTINUE;
    EXCEPTION WHEN OTHERS THEN
      -- Discard the nested exception UNSEEN. Its SQLSTATE proves nothing
      -- (P0001 is PostgreSQL's generic user-raised code; the delegated
      -- function and its downstream checks use it for authority, Event
      -- lifecycle, AND ineligibility). The true reason is re-derived from
      -- CURRENT state below -- never inferred from the nested error.
      NULL;
    END;

    -- Re-establish, in order, ALL WITHIN ONE enclosing WHEN OTHERS
    -- handler (below) so that a raise from any of these steps -- a
    -- lifecycle raise (event_archived), a resolve_task_authority error,
    -- anything -- is sanitized to a generic failure and its text can
    -- never leak:
    --   (a) the caller still holds event.nearby.manage for this Event;
    --   (b) the Event is still lifecycle-mutable;
    --   (c) this exact canonical candidate is still reuse-eligible, by the
    --       identical predicate used above.
    v_failure_class := 'unexpected';
    v_recheck_master_id := NULL;
    BEGIN
      SELECT authority.allowed, authority.tenant_id
        INTO v_recheck_allowed, v_recheck_tenant_id
      FROM public.resolve_task_authority(v_actor, 'event.nearby.manage', p_event_id) AS authority;

      IF v_recheck_allowed IS DISTINCT FROM true OR v_recheck_tenant_id IS NULL THEN
        v_failure_class := 'authority_lost';
      ELSE
        PERFORM public.assert_event_lifecycle_mutable(p_event_id);

        SELECT master.id
          INTO v_recheck_master_id
        FROM public.nearby_master_provider_identities AS provider_identity
        JOIN public.nearby_master AS master
          ON master.id = provider_identity.nearby_master_id
        WHERE provider_identity.provider = 'google_places'
          AND provider_identity.provider_place_id = v_place_id
          AND master.status = 'active'
          AND master.review_status = 'approved'
          AND (
            master.scope = 'shared_public'
            OR (master.scope = 'tenant_specific' AND master.tenant_id = v_recheck_tenant_id)
          );

        IF v_recheck_master_id IS NULL THEN
          v_failure_class := 'ineligible';
        ELSE
          v_failure_class := 'still_eligible';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A lifecycle raise (event_archived), or any unexpected error in
      -- the re-check itself. Never a statement about reuse eligibility.
      v_failure_class := 'unexpected';
    END;

    IF v_failure_class = 'ineligible' THEN
      -- Proven from post-failure state: this exact canonical candidate is
      -- now genuinely ineligible (retired / rejected / re-scoped /
      -- deleted). This is the ONLY path to not_reusable after a failed
      -- association.
      outcome := 'not_reusable';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- authority_lost | still_eligible | unexpected (incl.
    -- lifecycle-immutable): fail generically. Never not_reusable, so the
    -- client performs no Event-only fallback. No nested / id-bearing /
    -- distinguishing detail is exposed.
    RAISE EXCEPTION 'Nearby place reuse failed.';
  END LOOP;
END;
$function$;

ALTER FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reuse_nearby_places_by_google_place_id_for_event(uuid, text[])
  TO authenticated;

-- ============================================================
-- PARITY END
-- ============================================================

COMMIT;
