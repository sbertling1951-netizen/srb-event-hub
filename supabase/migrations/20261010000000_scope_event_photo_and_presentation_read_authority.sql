-- P0 Event-Photo Read-Surface Repair.
--
-- Closes the confirmed authorization defect recorded in
-- docs/architecture/EPICENTRAX_EVENT_PHOTO_READ_SURFACE_REMEDIATION_SPECIFICATION.md:
-- an approved public.event_photos row, and its approved event-photos storage
-- object, were readable by ANY authenticated caller (and, for the storage
-- object, ANY anonymous caller) regardless of that caller's own Event,
-- contributor, or Event-administrator relationship to the photo.
--
-- This migration governs BOTH surfaces together, per the specification's §5
-- ("removing only one of these surfaces is incomplete"):
--   1. public.event_photos approved-row SELECT policy;
--   2. storage.objects anonymous approved-photo SELECT policy (removed, no
--      anonymous replacement -- anonymous slideshow delivery moves entirely
--      to a server-mediated route in application code, not RLS);
--   3. storage.objects authenticated approved-photo read helper
--      (can_authenticated_read_event_photo_object);
--   4. the public.read_public_presentation_session anonymous response shape
--      (no longer discloses a raw storage path to the browser).
--
-- Adversarial-review corrections (Dou, applied within this same migration
-- rather than as a follow-up, since it is still uncommitted): closes
-- (1) forged metadata-to-storage-path aliasing (new
-- is_canonical_event_photo_path predicate, enforced at INSERT and re-checked
-- in the object-read and pending-delete helpers that trust a metadata row's
-- storage_path); (2) two authoritative predecessor safeguards this
-- migration's first pass silently dropped from read_public_presentation_session
-- by restating the wrong (superseded) source definition -- the active-Tenant
-- eligibility check and the timed-advance invocation -- plus a
-- revocation-clearing fix so rejected/ineligible content actually stops
-- being served, not just its storage path; (3) an explicit self-service
-- private-Draft exclusion on every ordinary photo/gallery/slideshow authority
-- path reachable through Platform/Event admin authority; (4) removal of the
-- orphaned anonymous approval-existence probe (is_approved_event_photo_object)
-- and the now-unused anon table grant on public.event_photos. See each
-- numbered section below for the specific finding it closes.
--
-- Complete private-Draft photo boundary closure (this same migration, a
-- third corrective pass, still uncommitted): the second pass closed the
-- private-Draft gap for the READ-side table policy, the object-read helper's
-- admin branch, and both presentation resolvers, but left every remaining
-- ordinary Event-photo mutation/upload/delete path uncorrected -- some
-- because they have no admin branch and were reasoned to be structurally
-- unreachable (a private Draft has no attendees), others (manage_event_photo)
-- because closing them was explicitly deferred as a separately-scoped
-- decision. Both rationales are superseded here: every one of those paths
-- now carries the SAME explicit, self-contained private-Draft exclusion,
-- independent of whether an attendee row could exist or an admin task grant
-- could apply. event_photos_member_insert_policy,
-- event_photos_member_delete_own_pending_policy, can_upload_event_photo_object,
-- and both branches of can_authenticated_read_event_photo_object /
-- can_delete_own_pending_event_photo_object gain the exclusion for
-- uniformity and defense-in-depth, even though only manage_event_photo's
-- admin/task-authority branch was ever reachable by a genuine outside actor.
-- manage_event_photo itself -- the sole surviving write path for
-- photo_status/captions/featured_level, since event_photos_admin_update_policy
-- and authenticated's raw UPDATE grant were both already retired by
-- 20260811390000 -- gains the identical exclusion ahead of its
-- has_event_task_authority check, closing the one path this migration's
-- prior pass deliberately left as a residual finding: a genuine Platform
-- Administrator (has_event_task_authority's platform-inherits branch) could
-- otherwise approve, reject, or edit a private-Draft's photos. This does
-- NOT touch has_event_task_authority/resolve_task_authority themselves
-- (20260811170000) -- that remains the correct, separately-scoped boundary
-- for every other admin task domain; only manage_event_photo's own body
-- gains a photo-specific guard ahead of it.
--
-- Fourth corrective pass (this same migration, still uncommitted), Dou's
-- final adversarial review, in four parts:
--
-- (A) RLS-safe private-Draft closure. Every private-Draft exclusion above
--     was, until this pass, an inline `(SELECT e.tenant_id FROM
--     public.events AS e WHERE e.id = ...)` subquery embedded directly in
--     RLS policy text. Policy USING/WITH CHECK clauses evaluate as the
--     QUERYING ROLE, not as postgres -- and the events table's own
--     authenticated-SELECT policy (20260924000000) already excludes
--     private-Draft rows from ordinary callers, INCLUDING a genuine
--     Platform Administrator (that policy's own exclusion is unconditional
--     by design). So for exactly the caller this exclusion exists to stop,
--     the inline subquery returned NULL, not the real tenant_id, and
--     _is_self_service_private_draft_tenant(NULL) coalesces to false --
--     silently defeating the exclusion for that same caller in every one of
--     these policies. New public.is_self_service_private_draft_event(uuid)
--     (SECURITY DEFINER, fixed search_path, fails closed to true on a NULL
--     or unresolved event_id) resolves the Tenant via a direct,
--     RLS-bypassing read of public.events from inside its own body, and
--     every private-Draft exclusion in this migration -- all four
--     event_photos RLS policies, both branches of
--     can_authenticated_read_event_photo_object, can_delete_own_pending_
--     event_photo_object, can_upload_event_photo_object,
--     manage_event_photo, and both presentation resolvers -- is restated to
--     call it instead of the vulnerable inline pattern. See section 1C.
--
-- (B) Exact, traversal-safe canonical paths. is_canonical_event_photo_path
--     previously only enforced a MINIMUM of 3 path segments with the first
--     two matching -- a forged row with two genuinely-matching leading
--     segments and any number of additional trailing segments (including
--     `..`-shaped ones) after them was accepted as "canonical." Strengthened
--     to the EXACT grammar the one real producer
--     (app/member/photos/page.tsx's uploadPhoto) emits --
--     `{event_id}/{attendee_id}/{filename}`, exactly three segments, no
--     more, no fewer, filename nonempty and never a bare `.`/`..` segment.
--     Applied everywhere an authorization or delivery decision reads
--     event_photos.storage_path: both event_photos SELECT policies (newly
--     added to event_photos_owner_or_admin_select_policy), the object-read/
--     upload/pending-delete helpers (already applying it), and the
--     presentation slot resolver's own JOIN (newly added). A legacy
--     aliased/malformed row fails every one of these checks and becomes
--     invisible -- never repaired, never redirected. See sections 1B and 6.
--
-- (C) Private-Draft slideshow administration closure. Every presentation-
--     domain RLS SELECT policy (presentation_decks/presentation_deck_items/
--     presentation_sessions/presentation_session_items admin-read) and
--     mutation RPC gated on has_event_task_authority('event.slideshow.
--     manage', ...) -- create/update/archive_presentation_deck,
--     add_presentation_deck_photo, remove_presentation_deck_item,
--     reorder_presentation_deck_items, start/pause/resume/next/previous/
--     end_presentation_session, advance_presentation_session_if_due --
--     carried the identical unconditional-Platform-Admin private-Draft gap
--     as manage_event_photo, closed the same way: one guard using
--     is_self_service_private_draft_event, immediately before the existing
--     has_event_task_authority check (RPCs) or ANDed into the policy
--     (RLS). has_event_task_authority/resolve_task_authority themselves are
--     NOT touched. See section 10.
--
-- (D) The rollback fixture is corrected for honesty/executability -- see
--     supabase/integration-tests/20261010000000_..._rollback.sql's own
--     header for the specific repairs (identity setup, no forbidden
--     private-session/immutable-audit cleanup, a real positive-control
--     Event, narrower exception handling, and new canonical/traversal/
--     revocation assertions).
--
-- Fifth corrective pass (this same migration, still uncommitted), Lun's
-- final adversarial review: the metadata-absent/path-derived fallback
-- branches in can_authenticated_read_event_photo_object and the entire body
-- of can_upload_event_photo_object never actually called the strengthened
-- is_canonical_event_photo_path predicate at all -- each independently
-- reimplemented its own "at least 3 segments, first two match" parsing, so
-- Part B's exact-grammar strengthening (third pass) never reached these two
-- specific branches. Both now REQUIRE is_canonical_event_photo_path
-- (identical to the metadata-row branch and every other authorization path
-- in this file) instead of their own ad-hoc minimum-segment/prefix-only
-- logic; there is no remaining path in either function that authorizes on
-- segment count or a matching prefix alone. See sections 4 and 4C.
--
-- What this migration does NOT change, by design (preserved exactly, per
-- spec §3.1 "the existing correctly narrow paths remain intact"):
--   * a contributor's own read/upload/pending-delete for an ordinary
--     (non-private-Draft) Event -- unchanged;
--   * an Event administrator's moderation via is_event_scoped_admin /
--     has_event_admin_authority / has_event_task_authority for an ordinary
--     (non-private-Draft) Event -- unchanged;
--   * event_photos_object_member_upload_policy,
--     event_photos_object_member_delete_pending_policy -- both storage.objects
--     policies are thin wrappers around can_upload_event_photo_object /
--     can_delete_own_pending_event_photo_object and inherit this migration's
--     corrections through those functions without needing their own edit;
--   * has_event_task_authority / resolve_task_authority themselves, and
--     every other admin task domain (agenda, vendor, etc.) they gate --
--     untouched, on purpose, per the reasoning above.
--
-- Architectural note (see the specification's implementation-plan handoff):
-- storage.objects RLS authorizes a read of a row as a whole; it cannot
-- distinguish "read this object to render a size-capped rendition" from
-- "read this object to obtain the untransformed original," because both
-- requests evaluate the identical SELECT policy before Supabase Storage
-- mints either kind of signed access. Consequently a same-Event
-- non-contributor attendee's ordinary gallery viewing of someone else's
-- approved photo is NOT expressed as a storage.objects RLS grant at all --
-- it is served exclusively by the new app/api/photos/gallery-image route
-- (lib/server/eventPhotoRendition.ts), which authorizes the caller through
-- their own real, RLS-scoped session (never a service-role bypass of the
-- authorization decision) and only then uses a narrowly-scoped elevated
-- storage read, strictly internal to that one already-authorized request,
-- to produce a size-capped rendition. The contributor and the Event
-- administrator keep the existing direct-signed-URL path for both view and
-- true original download, since for those two roles the specification does
-- not distinguish the two capabilities.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. New helper: is any attendee row for this Event owned by the caller's
--    resolved canonical Person -- NOT a specific attendee_id equality check
--    (that is is_own_attendee's job, unchanged). This is the "governed
--    attendee of this Event" predicate the new event_photos policy and the
--    new can_authenticated_read_event_photo_object branch both need.
--
--    Deliberately mirrors is_own_attendee's exact resolve_auth_person_link
--    pattern (20260805130000) rather than inventing a new identity path.
--    Deliberately does NOT consult self_service_organizer_appointments,
--    admin_users, or any Tenant/Event/Platform authority table -- a
--    private-event organizer holds no attendees row for her own Draft
--    (P-2A/P-2C create none), so this predicate grants such an organizer
--    nothing, by construction, satisfying the specification's §4
--    "no Platform, Tenant, or Event administrator authority is created for
--    a person-owned private-event organizer" and "a self-service private
--    Draft remains ... unavailable to every ordinary Member/Admin/
--    Event-photo path."
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_authenticated_attendee_of_event(
  p_auth_user_id uuid,
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_person_id uuid;
BEGIN
  IF p_auth_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT link.person_id
    INTO v_person_id
  FROM public.resolve_auth_person_link(p_auth_user_id) AS link
  WHERE link.status = 'resolved';

  IF v_person_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.attendees AS a
    WHERE a.person_id = v_person_id
      AND a.event_id = p_event_id
  );
END;
$$;

ALTER FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
FROM anon;
REVOKE ALL ON FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
FROM service_role;

GRANT EXECUTE ON FUNCTION public.is_authenticated_attendee_of_event(uuid, uuid)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 1B. Adversarial-review correction (Dou): forged metadata-to-storage-path
--     aliasing. Every authority check below this point trusts that an
--     event_photos row's own storage_path lives inside that SAME row's own
--     event_id/attendee_id path namespace ("{event_id}/{attendee_id}/...",
--     the exact convention app/member/photos/page.tsx's uploadPhoto already
--     writes). Nothing before this correction actually verified that: a
--     caller who legitimately owns attendee/event row A (and so legitimately
--     passes is_own_attendee for row A) could INSERT a pending row whose
--     event_id/attendee_id are her own, but whose storage_path text is
--     forged to equal a DIFFERENT attendee's or DIFFERENT Event's real
--     object path -- and every downstream helper that matched purely on
--     `ep.storage_path = p_object_name` would then treat her as the owner of
--     THAT object, because the match is on the forged text value, not on
--     provable path/row consistency. This is a pure text-parsing predicate
--     (mirrors the identical path-derived logic
--     can_upload_event_photo_object already uses for the upload-window
--     fallback) -- no table read, so it cannot itself be tricked by a forged
--     row; it only answers "does this exact storage_path literally live
--     under this exact event_id/attendee_id's own namespace."
--
--     Adversarial-review correction (Dou, final round): strengthened from
--     "at least 3 segments, first two match" to the EXACT grammar the one
--     real producer emits -- app/member/photos/page.tsx's uploadPhoto:
--       const extension = file.name.split(".").pop() || "jpg";
--       const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
--       const fileName = `${workspaceEvent.id}/${attendeeId}/${uniqueId}.${extension}`;
--     i.e. exactly `{event_id}/{attendee_id}/{filename}` -- three segments,
--     no more, no fewer. The prior "< 3" check only enforced a minimum,
--     so a forged row with two genuinely-matching leading segments and any
--     number of trailing segments after them (including `..`-shaped ones)
--     was previously accepted as "canonical." The filename segment itself
--     is left unconstrained beyond non-empty and never a bare dot-segment
--     -- the real producer places no allowlist on it (the extension is
--     whatever follows the last "." in the uploader's own original
--     filename, defaulting to "jpg" only when the filename is falsy), so
--     inventing a stricter filename grammar than the producer actually
--     emits would reject genuine uploads this codebase already accepts.
--     A leading/trailing/doubled slash is already rejected as a byproduct
--     of the exact-3-segment count (each produces an extra empty segment)
--     combined with the nonempty-filename check below, so no separate
--     slash-position check is needed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_canonical_event_photo_path(
  p_event_id uuid,
  p_attendee_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_parts text[];
  v_filename text;
BEGIN
  IF p_event_id IS NULL OR p_attendee_id IS NULL OR p_object_name IS NULL THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(p_object_name, '/');

  IF array_length(v_parts, 1) IS DISTINCT FROM 3 THEN
    RETURN false;
  END IF;

  IF v_parts[1] IS DISTINCT FROM p_event_id::text
    OR v_parts[2] IS DISTINCT FROM p_attendee_id::text THEN
    RETURN false;
  END IF;

  v_filename := v_parts[3];

  IF v_filename IS NULL OR btrim(v_filename) = '' OR v_filename IN ('.', '..') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

ALTER FUNCTION public.is_canonical_event_photo_path(uuid, uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_canonical_event_photo_path(uuid, uuid, text)
FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.is_canonical_event_photo_path(uuid, uuid, text)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 1C. Adversarial-review correction (Dou, final round): the private-Draft
--     exclusion used throughout this migration up to this point was an
--     inline `(SELECT e.tenant_id FROM public.events AS e WHERE e.id = ...)`
--     subquery written directly into RLS policy USING/WITH CHECK clauses.
--     Those clauses evaluate as the QUERYING ROLE (authenticated), not as
--     postgres -- and the events table's own authenticated-SELECT RLS
--     policy (20260924000000) itself excludes private-Draft rows. So for
--     the exact caller this exclusion exists to stop (a Platform
--     Administrator, or any authenticated caller, probing a private-Draft
--     event_id), that inline subquery returned NO ROW -- not the real
--     tenant_id, but NULL -- and _is_self_service_private_draft_tenant(NULL)
--     coalesces to false ("not a private Draft"), silently defeating every
--     exclusion built this way. This is exactly the class of bug RLS
--     recursion/visibility interactions are known to cause in this
--     codebase, and the fix is the same one already used elsewhere: a
--     narrow, SECURITY DEFINER, fixed-search-path helper that resolves the
--     Tenant from a direct (RLS-bypassing, because it runs as the function
--     owner) read of public.events itself, never through a subquery
--     embedded in caller-evaluated policy text. Every private-Draft
--     exclusion in this migration -- RLS policy and PL/pgSQL function alike
--     -- is restated below to call this one helper instead of the
--     vulnerable inline pattern.
--
--     Fails closed (returns true, "treat as private-Draft / excluded") for
--     a NULL or unresolved event_id -- a caller cannot bypass the guard by
--     supplying a garbage or already-deleted event_id and hoping an
--     unresolved lookup defaults to "not private."
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_self_service_private_draft_event(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT e.tenant_id
    INTO v_tenant_id
  FROM public.events AS e
  WHERE e.id = p_event_id;

  IF NOT FOUND OR v_tenant_id IS NULL THEN
    RETURN true;
  END IF;

  RETURN public._is_self_service_private_draft_tenant(v_tenant_id);
END;
$$;

ALTER FUNCTION public.is_self_service_private_draft_event(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_self_service_private_draft_event(uuid)
FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.is_self_service_private_draft_event(uuid)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.event_photos: replace the unconditioned approved-row policy.
--    Also closes Dou's second confirmed finding for this same policy: the
--    predecessor's admin branch (is_event_scoped_admin ->
--    has_event_admin_authority) resolves true for ANY Platform Administrator
--    on ANY event_id, including a self-service private-Draft's event --
--    private-draft Tenants are marked is_active = true once activated, so
--    nothing before this correction actually excluded them from ordinary
--    Platform authority reach into the photo domain. Mirrors the exact
--    exclusion 20260924000000 already applies to the events/tenants RLS
--    policies for the same reason -- reusing that migration's own
--    _is_self_service_private_draft_tenant helper, not a new mechanism.
--    event_photos_owner_or_admin_select_policy (contributor / admin, any
--    status) is separately corrected below for the identical reason. anon
--    loses this table entirely -- no anonymous consumer reads event_photos
--    rows directly any more (slideshow captions move to a governed server
--    route in application code, see below).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS event_photos_public_select_policy ON public.event_photos;

CREATE POLICY event_photos_event_scoped_approved_select_policy
  ON public.event_photos
  FOR SELECT
  TO authenticated
  USING (
    photo_status = 'approved'
    AND public.is_canonical_event_photo_path(event_id, attendee_id, storage_path)
    AND NOT public.is_self_service_private_draft_event(event_id)
    AND (
      public.is_authenticated_attendee_of_event(auth.uid(), event_id)
      OR public.is_event_scoped_admin(auth.uid(), event_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 2B. Adversarial-review correction (Dou): the pre-existing
--     event_photos_owner_or_admin_select_policy (20260805130000, not
--     introduced by this migration) has the identical unconditional-
--     Platform-Admin private-Draft gap in its own admin branch.
--
--     Adversarial-review correction (runtime-proven, private-Draft
--     contributor-read closure): the contributor branch (is_own_attendee)
--     was left out of that correction on the reasoning that "a self-service
--     private Draft has no attendees rows at all under the current
--     architecture, so it was never reachable through that branch" -- the
--     same kind of reachability assumption this migration explicitly
--     rejects as a security boundary everywhere else (see e.g. section 2D
--     and can_delete_own_pending_event_photo_object's own header comment).
--     A local, isolated runtime replay of this exact migration proved it
--     wrong: inserting a genuinely matching attendees row for a private-
--     Draft event (bypassing no RLS the real product doesn't already have
--     some other path to) let that attendee read her own pending photo row
--     via this policy's is_own_attendee branch, because the private-Draft
--     exclusion was nested only inside the admin branch's OR arm and so
--     never reached the contributor branch at all. The exclusion is now a
--     top-level AND over the entire owner/admin disjunction, matching
--     event_photos_event_scoped_approved_select_policy immediately above --
--     it must govern is_own_attendee exactly as much as is_event_scoped_admin,
--     not depend on whether a private-Draft attendee row is ever supposed to
--     exist.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS event_photos_owner_or_admin_select_policy ON public.event_photos;

CREATE POLICY event_photos_owner_or_admin_select_policy
  ON public.event_photos
  FOR SELECT
  TO authenticated
  USING (
    public.is_canonical_event_photo_path(event_id, attendee_id, storage_path)
    AND NOT public.is_self_service_private_draft_event(event_id)
    AND (
      public.is_own_attendee(auth.uid(), attendee_id, event_id)
      OR public.is_event_scoped_admin(auth.uid(), event_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 2C. Adversarial-review correction (Dou): enforce canonical-path proof at
--     INSERT time, closing the forgery at its source. Restated from
--     20260805130000 with exactly one added AND clause; every other
--     condition (ownership, pending-only, not pre-featured) is unchanged.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS event_photos_member_insert_policy ON public.event_photos;

CREATE POLICY event_photos_member_insert_policy
  ON public.event_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_own_attendee(auth.uid(), attendee_id, event_id)
    AND photo_status = 'pending'
    AND coalesce(is_featured, false) = false
    AND coalesce(featured_level, 0) = 0
    AND public.is_canonical_event_photo_path(event_id, attendee_id, storage_path)
    AND NOT public.is_self_service_private_draft_event(event_id)
  );

-- ---------------------------------------------------------------------------
-- 2D. Complete private-Draft photo boundary closure: the pre-existing
--     event_photos_member_delete_own_pending_policy (20260805130000, not
--     introduced by this migration) has no admin branch and is therefore
--     structurally unreachable for a private Draft today (no attendees row
--     can exist there) -- but per the explicit requirement that this
--     exclusion "must not rely on the absence of attendees," it gains the
--     identical, self-contained exclusion anyway, for uniformity with every
--     other ordinary Event-photo path in this file.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS event_photos_member_delete_own_pending_policy ON public.event_photos;

CREATE POLICY event_photos_member_delete_own_pending_policy
  ON public.event_photos
  FOR DELETE
  TO authenticated
  USING (
    public.is_own_attendee(auth.uid(), attendee_id, event_id)
    AND photo_status = 'pending'
    AND NOT public.is_self_service_private_draft_event(event_id)
  );

-- ---------------------------------------------------------------------------
-- Note: event_photos_admin_update_policy (20260805130000) is NOT restated or
-- corrected here because it no longer exists -- 20260811390000 already
-- dropped it and REVOKEd UPDATE on public.event_photos from authenticated
-- entirely. manage_event_photo (corrected below, near the end of this
-- migration) is the sole surviving write path for photo_status/captions/
-- featured_level; there is no other UPDATE policy left to close.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. storage.objects: remove the anonymous bucket-wide approved-photo
--    policy outright. No anonymous storage.objects policy is added in its
--    place -- the audience slideshow's image delivery moves entirely to a
--    server-mediated route (app/api/slideshow/presentation-image) that
--    re-validates session/slot liveness on every request and never exposes
--    a storage signed URL to the browser.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS event_photos_object_public_approved_read_policy ON storage.objects;

-- ---------------------------------------------------------------------------
-- 4. storage.objects (authenticated): can_authenticated_read_event_photo_object
--    loses its unconditioned "approved" branch. The metadata-row branch
--    gains two corrections (Dou):
--      * public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id,
--        ep.storage_path) -- the row's OWN storage_path must actually live
--        under the row's OWN event_id/attendee_id namespace before either
--        is_own_attendee or is_event_scoped_admin is even consulted. Without
--        this, a caller's own legitimately-owned pending row with a forged
--        storage_path (pointing at a different attendee's or a different
--        Event's real object) would satisfy is_own_attendee on the row's
--        real event_id/attendee_id columns while ep.storage_path =
--        p_object_name still matched the forged text -- granting read of an
--        object neither the row's event_id/attendee_id namespace nor the
--        caller actually owns.
--      * NOT public._is_self_service_private_draft_tenant(...) -- closes the
--        same unconditional-Platform-Admin private-Draft gap as the table
--        policies above.
--    Complete private-Draft photo boundary closure: this exclusion is now
--    applied once, to the metadata-row branch's OR as a whole (both
--    is_own_attendee and is_event_scoped_admin), and ALSO to the
--    path-derived upload-window fallback below -- both branches are
--    structurally unreachable for a private Draft today (no attendees row
--    can exist there), but per the explicit requirement that this exclusion
--    "must not rely on the absence of attendees... or lack of organizer
--    admin authority," each branch now carries its own self-contained
--    guarantee rather than depending on that architectural fact holding.
--
--    Adversarial-review correction (Lun): the metadata-absent/path-derived
--    fallback below previously reimplemented its OWN "at least 3 segments,
--    first two match" parsing entirely independently of
--    is_canonical_event_photo_path -- so strengthening that predicate
--    (exact 3 segments, no dot-segments) in the prior correction round
--    never actually reached this branch at all. A caller with no metadata
--    row yet (the legitimate upload-window case) could still present
--    `{event_id}/{attendee_id}/../../../other-event/other-attendee/secret.jpg`
--    -- the first two segments genuinely match, `array_length >= 3` is
--    trivially true, and this branch granted read with no further check on
--    what followed. The fallback now extracts segments 1/2 (still needed as
--    explicit uuid arguments for is_own_attendee, a separate, unrelated
--    check) only as far as is required to call
--    is_canonical_event_photo_path(v_event_id, v_attendee_id,
--    p_object_name) -- the exact same predicate the metadata-row branch
--    above already requires -- as the REQUIRED gate on the path's shape.
--    There is no longer any minimum-segment-count or prefix-only check that
--    can authorize a path on its own; array_length(v_parts, 1) IS NULL is
--    retained only as a cheap early exit for a path with no delimiter at
--    all, not as part of the authorization decision -- is_own_attendee and
--    the private-Draft exclusion still separately require the caller to
--    genuinely own the attendee/event named in the (now exact-grammar-
--    verified) path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_authenticated_read_event_photo_object(
  p_auth_user_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_parts text[];
  v_event_id uuid;
  v_attendee_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.event_photos ep
    WHERE ep.storage_path = p_object_name
      AND public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id, ep.storage_path)
      AND NOT public.is_self_service_private_draft_event(ep.event_id)
      AND (
        public.is_own_attendee(p_auth_user_id, ep.attendee_id, ep.event_id)
        OR public.is_event_scoped_admin(p_auth_user_id, ep.event_id)
      )
  ) THEN
    RETURN true;
  END IF;

  v_parts := string_to_array(p_object_name, '/');
  IF array_length(v_parts, 1) IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_event_id := v_parts[1]::uuid;
    v_attendee_id := v_parts[2]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN public.is_canonical_event_photo_path(v_event_id, v_attendee_id, p_object_name)
    AND public.is_own_attendee(p_auth_user_id, v_attendee_id, v_event_id)
    AND NOT public.is_self_service_private_draft_event(v_event_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4B. Adversarial-review correction (Dou): the pre-existing
--     can_delete_own_pending_event_photo_object (20260811390000, not
--     introduced by this migration) has the identical metadata-aliasing gap
--     for DELETE -- a forged pending row would let its owner delete another
--     attendee's or another Event's real storage object. Restated with the
--     same canonical-path AND clause added; the pending-only and
--     is_own_attendee conditions are otherwise unchanged. Complete
--     private-Draft photo boundary closure adds the same self-contained
--     exclusion applied throughout this migration -- this function has no
--     admin branch, so it was already structurally unreachable, but the
--     guarantee must not depend on that.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_delete_own_pending_event_photo_object(
  p_auth_user_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_photos ep
    WHERE ep.storage_path = p_object_name
      AND ep.photo_status = 'pending'
      AND public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id, ep.storage_path)
      AND public.is_own_attendee(p_auth_user_id, ep.attendee_id, ep.event_id)
      AND NOT public.is_self_service_private_draft_event(ep.event_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4C. Complete private-Draft photo boundary closure: the pre-existing
--     can_upload_event_photo_object (20260811390000, not introduced by this
--     migration, and not touched by the second correction pass) derives
--     event_id/attendee_id directly from the requested upload path and
--     checks only is_own_attendee -- no admin branch, structurally
--     unreachable for a private Draft today, but gains the same
--     self-contained exclusion for the same reason as every other path in
--     this migration.
--
--     Adversarial-review correction (Lun): this entire function IS a
--     metadata-absent, path-derived check by design (it authorizes the
--     upload BEFORE any event_photos row exists) -- and, exactly like
--     can_authenticated_read_event_photo_object's fallback, it previously
--     reimplemented its own "at least 3 segments, first two match" parsing
--     independently of is_canonical_event_photo_path, so the strengthened
--     exact-grammar predicate never actually gated an upload at all. A
--     caller could request an upload URL for
--     `{event_id}/{attendee_id}/../../../other-event/other-attendee/x.jpg`
--     and this function would authorize it, because only the first two
--     segments were ever checked. Segments 1/2 are still extracted (as
--     explicit uuid arguments for is_own_attendee), but
--     is_canonical_event_photo_path(v_event_id, v_attendee_id,
--     p_object_name) is now the REQUIRED gate on the path's shape as a
--     whole -- there is no remaining minimum-segment-count or prefix-only
--     authorization path. Legitimate metadata-absent upload behavior for
--     the real producer's exact grammar
--     (app/member/photos/page.tsx: `${workspaceEvent.id}/${attendeeId}/
--     ${uniqueId}.${extension}`) is unchanged: that grammar already
--     satisfies is_canonical_event_photo_path by construction, and no
--     event_photos row is required to exist before upload -- this function
--     still never reads that table.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_upload_event_photo_object(
  p_auth_user_id uuid,
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_parts text[];
  v_event_id uuid;
  v_attendee_id uuid;
BEGIN
  IF p_auth_user_id IS NULL OR p_object_name IS NULL THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(p_object_name, '/');
  IF array_length(v_parts, 1) IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_event_id := v_parts[1]::uuid;
    v_attendee_id := v_parts[2]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN public.is_canonical_event_photo_path(v_event_id, v_attendee_id, p_object_name)
    AND public.is_own_attendee(p_auth_user_id, v_attendee_id, v_event_id)
    AND NOT public.is_self_service_private_draft_event(v_event_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. read_public_presentation_session: stop disclosing a raw storage path
--    to the anonymous browser (spec: "Remove raw storage paths from
--    anonymous slideshow/session responses"). The RETURNS TABLE shape is
--    left unchanged (no signature break for any other caller) -- the two
--    path columns are now always NULL. The browser now learns the session's
--    state and which content_ref_id/content_type is current/next, but never
--    a fetchable path; it must call app/api/slideshow/presentation-image
--    with the session id and a "current"/"next" slot instead, and that
--    route re-derives the real path itself, server-side, from this same
--    liveness/current-index logic.
--
--    Adversarial-review corrections (Dou), both restoring authoritative
--    predecessor behavior this migration's initial restatement of this
--    function silently dropped by restating only the ORIGINAL
--    20260811420000 definition instead of its actual current, later-
--    superseding one (20260824010000):
--      * the active-Tenant eligibility check that gates the whole function
--        (absent Tenant/inactive Tenant/inactive private-Draft Tenant ->
--        the same "not active" row shape as an unknown/ended session,
--        non-enumerating) -- extended here with the identical private-Draft
--        exclusion applied elsewhere in this migration, since an activated
--        self-service private-Draft Tenant is_active = true and so was not
--        excluded by the tenant-active check alone;
--      * the PERFORM public.advance_presentation_session_if_due_internal(...)
--        call -- without it, unattended audience playback never advances,
--        because nothing else drives the timed-advance check; the audience
--        viewer's own ~1s poll of this RPC is the sole trigger.
--
--    Revocation-clearing correction (Dou): current_content_type/
--    current_content_ref_id/current_duration_ms (and the next_* triplet) are
--    now NULLed, not just passed through from the session item, whenever
--    that slot names a photo that is no longer approved (rejected after
--    being shown, or otherwise no longer eligible). This restores -- via a
--    different column, since storage_path itself can no longer serve this
--    role at all -- the exact "ineligible content resolves to nothing"
--    guarantee the predecessor achieved by CASE-nulling storage_path alone
--    (safe there only because the legacy viewer used storage_path itself,
--    not content_type/content_ref_id, as its re-fetch/clear signal). The
--    audience viewer (app/slideshow/view/page.tsx) already treats a
--    non-"photo" current_content_type as nothing-to-display and already
--    clears its caption in that same case -- both unchanged by this
--    correction, since the fix is entirely in what this function returns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.read_public_presentation_session(p_session_id uuid)
RETURNS TABLE (
  session_active boolean,
  event_id uuid,
  playback_state text,
  state_version bigint,
  item_count integer,
  sequence_number integer,
  current_content_type text,
  current_content_ref_id uuid,
  current_storage_path text,
  current_duration_ms integer,
  next_content_type text,
  next_content_ref_id uuid,
  next_storage_path text,
  next_duration_ms integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_session public.presentation_sessions%ROWTYPE;
  v_item_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.presentation_sessions AS ps
    JOIN public.events AS e ON e.id = ps.event_id
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE ps.id = p_session_id
      AND t.is_active = true
      AND NOT public.is_self_service_private_draft_event(e.id)
  ) THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::text, NULL::bigint, NULL::integer, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  PERFORM public.advance_presentation_session_if_due_internal(p_session_id);

  SELECT * INTO v_session FROM public.presentation_sessions WHERE id = p_session_id;

  IF NOT FOUND OR v_session.status <> 'live' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::text, NULL::bigint, NULL::integer, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer,
      NULL::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = p_session_id;

  RETURN QUERY
  SELECT
    true,
    v_session.event_id,
    v_session.playback_state,
    v_session.state_version,
    v_item_count,
    v_session.current_index,
    CASE WHEN cur.content_type = 'photo' AND ep_cur.id IS NULL THEN NULL ELSE cur.content_type END,
    CASE WHEN cur.content_type = 'photo' AND ep_cur.id IS NULL THEN NULL ELSE cur.content_ref_id END,
    NULL::text, -- current_storage_path: intentionally never disclosed to the browser
    CASE WHEN cur.content_type = 'photo' AND ep_cur.id IS NULL THEN NULL ELSE cur.duration_ms END,
    CASE WHEN nxt.content_type = 'photo' AND ep_nxt.id IS NULL THEN NULL ELSE nxt.content_type END,
    CASE WHEN nxt.content_type = 'photo' AND ep_nxt.id IS NULL THEN NULL ELSE nxt.content_ref_id END,
    NULL::text, -- next_storage_path: intentionally never disclosed to the browser
    CASE WHEN nxt.content_type = 'photo' AND ep_nxt.id IS NULL THEN NULL ELSE nxt.duration_ms END
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.presentation_session_items cur
    ON cur.session_id = p_session_id AND cur.sequence_number = v_session.current_index
  LEFT JOIN public.event_photos ep_cur
    ON ep_cur.id = cur.content_ref_id AND ep_cur.photo_status = 'approved'
  LEFT JOIN public.presentation_session_items nxt
    ON nxt.session_id = p_session_id AND nxt.sequence_number = v_session.current_index + 1
  LEFT JOIN public.event_photos ep_nxt
    ON ep_nxt.id = nxt.content_ref_id AND ep_nxt.photo_status = 'approved';
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. New server-only resolver: given a live session id and a slot
--    ("current"/"next"), returns the actual approved storage_path for that
--    slot -- or nothing if the session is not live, the slot has no photo,
--    or the referenced event_photos row is not (or no longer) approved.
--    This is the ONLY function that still discloses a raw storage_path for
--    an anonymous-origin request, and EXECUTE is granted to service_role
--    ONLY -- the same "server-route-only" grant shape already established
--    by this codebase's identity-claim verification RPCs (e.g.
--    evaluate_member_identity_claim, 20260727120100). Neither anon nor
--    authenticated may call it directly; only the Next.js
--    presentation-image route, using the existing shared admin/service-role
--    client (lib/server/supabaseAdmin.ts), can -- and only after this
--    function's own WHERE clauses (live session, matching slot, approved
--    photo) have independently decided the request is eligible. This is not
--    a service-role authority bypass: the function itself performs the
--    entire authorization decision; the service-role credential is used
--    only to invoke an already-self-contained, already-narrow check.
--
--    Adversarial-review correction (Dou): this resolver decides the exact
--    same "is this session/slot eligible" question read_public_presentation_
--    session does, and must fail the same way -- it now requires the
--    identical active, non-private-Draft Tenant condition, so a Tenant
--    deactivation or a private-Draft session (reachable only through the
--    same unconditional-Platform-Admin gap corrected elsewhere in this
--    migration) denies the image exactly as it denies the state poll,
--    rather than continuing to serve a rendition through this narrower path
--    after the state poll has already gone dark.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._resolve_live_presentation_slot_path(
  p_session_id uuid,
  p_slot text
)
RETURNS TABLE(content_ref_id uuid, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_session public.presentation_sessions%ROWTYPE;
  v_target_index integer;
BEGIN
  IF p_slot NOT IN ('current', 'next') THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.presentation_sessions AS ps
    JOIN public.events AS e ON e.id = ps.event_id
    JOIN public.tenants AS t ON t.id = e.tenant_id
    WHERE ps.id = p_session_id
      AND t.is_active = true
      AND NOT public.is_self_service_private_draft_event(e.id)
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.presentation_sessions WHERE id = p_session_id;

  IF NOT FOUND OR v_session.status <> 'live' THEN
    RETURN;
  END IF;

  v_target_index := CASE WHEN p_slot = 'current'
    THEN v_session.current_index
    ELSE v_session.current_index + 1
  END;

  RETURN QUERY
  SELECT ep.id, ep.storage_path
  FROM public.presentation_session_items AS psi
  JOIN public.event_photos AS ep
    ON ep.id = psi.content_ref_id
   AND ep.photo_status = 'approved'
   AND public.is_canonical_event_photo_path(ep.event_id, ep.attendee_id, ep.storage_path)
  WHERE psi.session_id = p_session_id
    AND psi.sequence_number = v_target_index
    AND psi.content_type = 'photo';
END;
$$;

ALTER FUNCTION public._resolve_live_presentation_slot_path(uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public._resolve_live_presentation_slot_path(uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._resolve_live_presentation_slot_path(uuid, text)
TO service_role;

-- ---------------------------------------------------------------------------
-- 7. New server-only resolver: the caption/attribution fields for a live
--    session's current/next slot, keyed the same way as (6) -- used by the
--    presentation-caption route so an anonymous slideshow viewer never
--    queries public.event_photos directly (that table now has no anon
--    grant at all, by design).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.read_live_presentation_slot_caption(
  p_session_id uuid,
  p_slot text
)
RETURNS TABLE(
  member_caption text,
  admin_caption text,
  show_caption boolean,
  photographer_name_snapshot text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_ref uuid;
BEGIN
  SELECT s.content_ref_id INTO v_ref
  FROM public._resolve_live_presentation_slot_path(p_session_id, p_slot) AS s;

  IF v_ref IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ep.member_caption, ep.admin_caption, ep.show_caption, ep.photographer_name_snapshot
  FROM public.event_photos AS ep
  WHERE ep.id = v_ref
    AND ep.photo_status = 'approved';
END;
$$;

ALTER FUNCTION public.read_live_presentation_slot_caption(uuid, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.read_live_presentation_slot_caption(uuid, text)
FROM PUBLIC, service_role;

GRANT EXECUTE ON FUNCTION public.read_live_presentation_slot_caption(uuid, text)
TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Adversarial-review correction (Dou): close the remaining anonymous
--    approval-existence probe.
--
--    is_approved_event_photo_object (20260811390000) was granted EXECUTE TO
--    anon, authenticated as the predicate the now-dropped
--    event_photos_object_public_approved_read_policy called. Dropping that
--    policy (step 3 above) removed its only consumer -- confirmed by
--    repository-wide search, this migration included -- but left the
--    function itself directly RPC-callable by anon: any caller who already
--    knows or is guessing a storage path could call it directly
--    (`rpc('is_approved_event_photo_object', {p_object_name})`) and learn
--    whether that exact path exists and is approved, entirely independent
--    of Event/attendee/admin scope -- a pure existence+status oracle with no
--    remaining legitimate purpose. It is dropped outright, not merely
--    revoked: no other policy, function, or application call site
--    references it (verified by search), so there is nothing "narrowly
--    justified" left to preserve.
--
--    public.event_photos also still carries the original
--    `GRANT SELECT ... TO anon` table-level grant from 20260805130000. Every
--    RLS policy that ever gave anon a row through that grant is gone as of
--    this migration (event_photos_public_select_policy dropped above); no
--    other policy on this table names anon at all. With RLS enabled and no
--    permissive policy naming anon, the grant already returns zero rows to
--    anon in practice -- this closes it explicitly rather than leaving an
--    inert but still-present anonymous table privilege.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.is_approved_event_photo_object(text);

REVOKE SELECT ON TABLE public.event_photos FROM anon;

-- ---------------------------------------------------------------------------
-- 9. Complete private-Draft photo boundary closure: manage_event_photo
--    (20260813170000, not introduced by this migration) is the SOLE
--    surviving write path for photo_status/captions/featured_level --
--    event_photos_admin_update_policy and authenticated's raw UPDATE grant
--    on public.event_photos were both already retired by 20260811390000
--    (see the note near event_photos_member_delete_own_pending_policy
--    above). Its authority check, has_event_task_authority('event.photos.
--    manage', v_event_id), resolves true for a genuine Platform
--    Administrator on ANY event_id via resolve_task_authority's
--    platform-inherits branch (20260811170000) -- with no private-Draft
--    exclusion of its own, this was the one remaining path through which a
--    real Platform Administrator could approve, reject, or edit a
--    self-service private-Draft's photos, previously recorded as a known,
--    deliberately-deferred residual finding.
--
--    The fix is narrowly scoped to this one function's own body: a single
--    guard, using the same _is_self_service_private_draft_tenant helper as
--    every other correction in this migration, raised BEFORE the existing
--    has_event_task_authority check (same 'unauthorized' exception, so a
--    caller cannot distinguish "you lack this task grant" from "this Event
--    is a private Draft" -- non-enumerating, matching every other denial
--    shape in this file). has_event_task_authority and resolve_task_authority
--    themselves are NOT touched -- they remain the correct, unmodified
--    authority boundary for every other admin task domain (agenda, vendor,
--    slideshow deck/session management, etc.); only manage_event_photo's own
--    body gains a photo-specific guard ahead of them. Every other line of
--    the function -- the row fetch, assert_event_lifecycle_mutable, status/
--    featured-level validation, the UPDATE, and the audit insert -- is
--    restated byte-for-byte from 20260813170000, unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.manage_event_photo(
  p_photo_id uuid,
  p_photo_status text,
  p_member_caption text,
  p_admin_caption text,
  p_show_caption boolean,
  p_featured_level integer
)
RETURNS public.event_photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_before public.event_photos%ROWTYPE;
  v_after public.event_photos%ROWTYPE;
  v_is_featured boolean;
BEGIN
  SELECT * INTO v_before FROM public.event_photos WHERE id = p_photo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found';
  END IF;

  v_event_id := v_before.event_id;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.photos.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF p_photo_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF p_featured_level IS NULL OR p_featured_level < 0 OR p_featured_level > 3 THEN
    RAISE EXCEPTION 'invalid_featured_level';
  END IF;

  v_is_featured := p_featured_level > 0;

  UPDATE public.event_photos
  SET
    photo_status = p_photo_status,
    member_caption = p_member_caption,
    admin_caption = p_admin_caption,
    show_caption = coalesce(p_show_caption, show_caption),
    featured_level = p_featured_level,
    is_featured = v_is_featured,
    updated_at = now()
  WHERE id = p_photo_id
  RETURNING * INTO v_after;

  INSERT INTO public.event_photo_command_audit
    (photo_id, event_id, actor_auth_user_id, action, before_state, after_state)
  VALUES (
    p_photo_id, v_event_id, auth.uid(), 'photo_updated',
    jsonb_build_object(
      'photo_status', v_before.photo_status, 'member_caption', v_before.member_caption,
      'admin_caption', v_before.admin_caption, 'show_caption', v_before.show_caption,
      'featured_level', v_before.featured_level, 'is_featured', v_before.is_featured
    ),
    jsonb_build_object(
      'photo_status', v_after.photo_status, 'member_caption', v_after.member_caption,
      'admin_caption', v_after.admin_caption, 'show_caption', v_after.show_caption,
      'featured_level', v_after.featured_level, 'is_featured', v_after.is_featured
    )
  );

  RETURN v_after;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Private-Draft slideshow administration closure (Part C). Inventory:
--     every presentation-domain RLS SELECT policy and mutation RPC gated on
--     has_event_task_authority('event.slideshow.manage', ...) -- the deck
--     CRUD RPCs (create/update/archive_presentation_deck,
--     add_presentation_deck_photo, remove_presentation_deck_item,
--     reorder_presentation_deck_items), the four admin-read RLS policies on
--     presentation_decks/presentation_deck_items/presentation_sessions/
--     presentation_session_items, and the session-control RPCs
--     (start/pause/resume/next/previous/end_presentation_session,
--     advance_presentation_session_if_due). Every one of these resolves true
--     for a genuine Platform Administrator on ANY event_id via
--     resolve_task_authority's platform-inherits branch, with no
--     private-Draft exclusion of its own -- the same gap closed in
--     manage_event_photo above, now closed for the entire slideshow
--     administration surface.
--
--     Each RLS policy and RPC gains exactly one guard -- using the row-
--     derived is_self_service_private_draft_event helper (Part A), never a
--     caller-visible events subquery -- placed immediately before its
--     existing has_event_task_authority check (RPCs: identical
--     'unauthorized' exception, non-enumerating; RLS policies: an added
--     AND NOT clause). has_event_task_authority / resolve_task_authority
--     themselves are NOT touched anywhere in this section. Every other line
--     of every function -- validation, the actual INSERT/UPDATE/DELETE, and
--     the return shape -- is restated byte-for-byte from 20260811410000 /
--     20260811420000 / 20260813170000, unchanged.
-- ---------------------------------------------------------------------------

-- --- RLS SELECT policies (presentation_decks, presentation_deck_items,
--     presentation_sessions, presentation_session_items) ------------------

DROP POLICY IF EXISTS presentation_decks_admin_select_policy ON public.presentation_decks;

CREATE POLICY presentation_decks_admin_select_policy
  ON public.presentation_decks
  FOR SELECT
  TO authenticated
  USING (
    NOT public.is_self_service_private_draft_event(event_id)
    AND public.has_event_task_authority('event.slideshow.manage', event_id)
  );

DROP POLICY IF EXISTS presentation_deck_items_admin_select_policy ON public.presentation_deck_items;

CREATE POLICY presentation_deck_items_admin_select_policy
  ON public.presentation_deck_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.presentation_decks d
      WHERE d.id = presentation_deck_items.deck_id
        AND NOT public.is_self_service_private_draft_event(d.event_id)
        AND public.has_event_task_authority('event.slideshow.manage', d.event_id)
    )
  );

DROP POLICY IF EXISTS presentation_sessions_admin_select_policy ON public.presentation_sessions;

CREATE POLICY presentation_sessions_admin_select_policy
  ON public.presentation_sessions
  FOR SELECT
  TO authenticated
  USING (
    NOT public.is_self_service_private_draft_event(event_id)
    AND public.has_event_task_authority('event.slideshow.manage', event_id)
  );

DROP POLICY IF EXISTS presentation_session_items_admin_select_policy ON public.presentation_session_items;

CREATE POLICY presentation_session_items_admin_select_policy
  ON public.presentation_session_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.presentation_sessions s
      WHERE s.id = presentation_session_items.session_id
        AND NOT public.is_self_service_private_draft_event(s.event_id)
        AND public.has_event_task_authority('event.slideshow.manage', s.event_id)
    )
  );

-- --- Deck CRUD RPCs --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_presentation_deck(
  p_event_id uuid,
  p_name text,
  p_description text,
  p_default_duration_ms integer,
  p_selection_mode text
)
RETURNS public.presentation_decks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_row public.presentation_decks%ROWTYPE;
BEGIN
  IF public.is_self_service_private_draft_event(p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', p_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(p_event_id);

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_selection_mode NOT IN ('all_approved', 'manual') THEN
    RAISE EXCEPTION 'invalid_selection_mode';
  END IF;

  IF p_default_duration_ms IS NULL OR p_default_duration_ms < 1000 OR p_default_duration_ms > 300000 THEN
    RAISE EXCEPTION 'invalid_default_duration_ms';
  END IF;

  INSERT INTO public.presentation_decks
    (event_id, name, description, default_duration_ms, selection_mode, created_by_auth_user_id)
  VALUES
    (p_event_id, btrim(p_name), p_description, p_default_duration_ms, p_selection_mode, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_presentation_deck(
  p_deck_id uuid,
  p_name text,
  p_description text,
  p_default_duration_ms integer,
  p_selection_mode text
)
RETURNS public.presentation_decks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_row public.presentation_decks%ROWTYPE;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  IF p_selection_mode NOT IN ('all_approved', 'manual') THEN
    RAISE EXCEPTION 'invalid_selection_mode';
  END IF;

  IF p_default_duration_ms IS NULL OR p_default_duration_ms < 1000 OR p_default_duration_ms > 300000 THEN
    RAISE EXCEPTION 'invalid_default_duration_ms';
  END IF;

  IF p_selection_mode = 'all_approved'
     AND EXISTS (SELECT 1 FROM public.presentation_deck_items WHERE deck_id = p_deck_id) THEN
    RAISE EXCEPTION 'deck_has_items';
  END IF;

  UPDATE public.presentation_decks
  SET
    name = btrim(p_name),
    description = p_description,
    default_duration_ms = p_default_duration_ms,
    selection_mode = p_selection_mode,
    updated_at = now()
  WHERE id = p_deck_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_presentation_deck(p_deck_id uuid)
RETURNS public.presentation_decks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_row public.presentation_decks%ROWTYPE;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  UPDATE public.presentation_decks
  SET lifecycle_status = 'archived', updated_at = now()
  WHERE id = p_deck_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_presentation_deck_photo(
  p_deck_id uuid,
  p_photo_id uuid,
  p_duration_ms integer
)
RETURNS public.presentation_deck_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_selection_mode text;
  v_photo_event_id uuid;
  v_photo_status text;
  v_next_sort_order integer;
  v_row public.presentation_deck_items%ROWTYPE;
BEGIN
  SELECT event_id, selection_mode INTO v_event_id, v_selection_mode
  FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_selection_mode <> 'manual' THEN
    RAISE EXCEPTION 'deck_not_manual';
  END IF;

  SELECT event_id, photo_status INTO v_photo_event_id, v_photo_status
  FROM public.event_photos WHERE id = p_photo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found';
  END IF;

  IF v_photo_event_id <> v_event_id THEN
    RAISE EXCEPTION 'photo_event_mismatch';
  END IF;

  IF v_photo_status <> 'approved' THEN
    RAISE EXCEPTION 'photo_not_approved';
  END IF;

  IF p_duration_ms IS NOT NULL AND (p_duration_ms < 1000 OR p_duration_ms > 300000) THEN
    RAISE EXCEPTION 'invalid_duration_ms';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.presentation_deck_items
    WHERE deck_id = p_deck_id AND content_ref_id = p_photo_id
  ) THEN
    RAISE EXCEPTION 'photo_already_in_deck';
  END IF;

  SELECT COALESCE(MAX(sort_order) + 1, 0) INTO v_next_sort_order
  FROM public.presentation_deck_items WHERE deck_id = p_deck_id;

  INSERT INTO public.presentation_deck_items
    (deck_id, content_type, content_ref_id, sort_order, duration_ms)
  VALUES
    (p_deck_id, 'photo', p_photo_id, v_next_sort_order, p_duration_ms)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_presentation_deck_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_deck_id uuid;
  v_event_id uuid;
BEGIN
  SELECT deck_id INTO v_deck_id FROM public.presentation_deck_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found';
  END IF;

  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = v_deck_id;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  DELETE FROM public.presentation_deck_items WHERE id = p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_presentation_deck_items(
  p_deck_id uuid,
  p_item_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_current uuid[];
  v_requested uuid[];
  v_i integer;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_item_list';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_current
  FROM public.presentation_deck_items WHERE deck_id = p_deck_id;

  SELECT array_agg(x ORDER BY x) INTO v_requested
  FROM unnest(p_item_ids) x;

  IF v_current IS DISTINCT FROM v_requested THEN
    RAISE EXCEPTION 'item_set_mismatch';
  END IF;

  SET CONSTRAINTS public.presentation_deck_items_deck_sort_order_key DEFERRED;

  FOR v_i IN 1 .. array_length(p_item_ids, 1) LOOP
    UPDATE public.presentation_deck_items
    SET sort_order = v_i, updated_at = now()
    WHERE id = p_item_ids[v_i] AND deck_id = p_deck_id;
  END LOOP;
END;
$$;

-- --- Session control RPCs ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_presentation_session(p_deck_id uuid)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_selection_mode text;
  v_lifecycle_status text;
  v_default_duration_ms integer;
  v_session_id uuid;
  v_item_count integer;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, selection_mode, lifecycle_status, default_duration_ms
  INTO v_event_id, v_selection_mode, v_lifecycle_status, v_default_duration_ms
  FROM public.presentation_decks WHERE id = p_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deck_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_lifecycle_status <> 'active' THEN
    RAISE EXCEPTION 'deck_archived';
  END IF;

  IF EXISTS (SELECT 1 FROM public.presentation_sessions WHERE event_id = v_event_id AND status = 'live') THEN
    RAISE EXCEPTION 'session_already_active';
  END IF;

  INSERT INTO public.presentation_sessions
    (event_id, deck_id, status, playback_state, current_index, state_version, started_by_auth_user_id, current_item_started_at)
  VALUES
    (v_event_id, p_deck_id, 'live', 'playing', 0, 1, auth.uid(), now())
  RETURNING id INTO v_session_id;

  IF v_selection_mode = 'manual' THEN
    INSERT INTO public.presentation_session_items
      (session_id, source_deck_item_id, content_type, content_ref_id, sequence_number, duration_ms)
    SELECT
      v_session_id,
      di.id,
      di.content_type,
      di.content_ref_id,
      (row_number() OVER (ORDER BY di.sort_order))::integer - 1,
      COALESCE(di.duration_ms, v_default_duration_ms)
    FROM public.presentation_deck_items di
    WHERE di.deck_id = p_deck_id
      AND (
        di.content_type = 'blank'
        OR EXISTS (
          SELECT 1 FROM public.event_photos ep
          WHERE ep.id = di.content_ref_id AND ep.event_id = v_event_id AND ep.photo_status = 'approved'
        )
      );
  ELSIF v_selection_mode = 'all_approved' THEN
    INSERT INTO public.presentation_session_items
      (session_id, source_deck_item_id, content_type, content_ref_id, sequence_number, duration_ms)
    SELECT
      v_session_id,
      NULL,
      'photo',
      ep.id,
      (row_number() OVER (ORDER BY md5(v_session_id::text || ep.id::text)))::integer - 1,
      v_default_duration_ms
    FROM public.event_photos ep
    WHERE ep.event_id = v_event_id AND ep.photo_status = 'approved';
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = v_session_id;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'deck_has_no_playable_items';
  END IF;

  SELECT * INTO v_row FROM public.presentation_sessions WHERE id = v_session_id;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_presentation_session(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  UPDATE public.presentation_sessions
  SET playback_state = 'paused', state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_presentation_session(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  UPDATE public.presentation_sessions
  SET playback_state = 'playing', current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_presentation_slide(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_current_index integer;
  v_item_count integer;
  v_next_index integer;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status, current_index INTO v_event_id, v_status, v_current_index
  FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  SELECT count(*) INTO v_item_count FROM public.presentation_session_items WHERE session_id = p_session_id;
  v_next_index := LEAST(v_current_index + 1, v_item_count - 1);

  IF v_next_index = v_current_index THEN
    SELECT * INTO v_row FROM public.presentation_sessions WHERE id = p_session_id;
    IF v_row.state_version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_version';
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.presentation_sessions
  SET current_index = v_next_index, current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.previous_presentation_slide(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_current_index integer;
  v_prev_index integer;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status, current_index INTO v_event_id, v_status, v_current_index
  FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  v_prev_index := GREATEST(v_current_index - 1, 0);

  IF v_prev_index = v_current_index THEN
    SELECT * INTO v_row FROM public.presentation_sessions WHERE id = p_session_id;
    IF v_row.state_version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_version';
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.presentation_sessions
  SET current_index = v_prev_index, current_item_started_at = now(), state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_presentation_session(p_session_id uuid, p_expected_version bigint)
RETURNS public.presentation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
  v_status text;
  v_row public.presentation_sessions%ROWTYPE;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'session_not_live';
  END IF;

  UPDATE public.presentation_sessions
  SET status = 'ended', ended_at = now(), ended_by_auth_user_id = auth.uid(),
      state_version = state_version + 1, updated_at = now()
  WHERE id = p_session_id AND state_version = p_expected_version
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_version';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_presentation_session_if_due(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM public.presentation_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF public.is_self_service_private_draft_event(v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT public.has_event_task_authority('event.slideshow.manage', v_event_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public.assert_event_lifecycle_mutable(v_event_id);

  PERFORM public.advance_presentation_session_if_due_internal(p_session_id);
END;
$$;

COMMIT;
