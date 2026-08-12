-- Stage 5A Part B -- Governed Venue Evidence Foundation.
-- Implements docs/architecture/EPICENTRAX_RENDERER_NEUTRAL_MAPPING_ARCHITECTURE.md
-- (v1.1, Accepted), section "Governed Venue Evidence Foundation."
--
-- Additive schema only. No existing table, RLS policy, grant, route, or
-- application behavior is changed by this migration. public.venue_evidence
-- is not consumed by any authorization decision, and public.master_maps /
-- public.master_map_sites are not written to by anything in this file --
-- existing Master Map administration (app/admin/master-maps/**) continues
-- to work exactly as it does today, untouched.
--
-- This migration creates no evidence row and mutates no existing row of any
-- kind. It defines one table and two governed RPCs a future, separately
-- authorized admin surface would call. Until such a caller exists, both
-- functions are dead code with no invoker -- the same inertness guarantee
-- already established by 20260808100000_create_parking_repair_infrastructure.sql
-- and 20260809120000_create_stale_map_identity_correction_and_recovery_infrastructure.sql.
--
-- Hard rule this migration exists to enforce (Part B.9 of the architecture
-- doc): venue evidence is a candidate/reference, never authoritative venue
-- geometry. Neither public.record_venue_evidence nor
-- public.review_venue_evidence below writes to public.master_maps or
-- public.master_map_sites under any circumstance. Promoting reviewed
-- evidence into an actual Master Map is an explicitly separate, later,
-- governed pathway (Stage 5F) that does not exist yet.
--
-- Evidence-quality vocabulary ('governed' | 'external' | 'partial' |
-- 'stale' | 'unavailable') matches lib/experienceContext/types.ts's
-- SliceEvidenceQuality exactly (see EPICENTRAX_INTELLIGENCE_COLLECTOR_
-- ARCHITECTURE.md, "Evidence Quality Classification") -- a deterministic
-- classification, not a probabilistic score, reused here rather than a
-- second competing vocabulary.
--
-- Review-state shape (status/approved_by/approved_at-style consistency
-- CHECK) matches the precedent in public.parking_repair_manifest
-- (20260808100000) and public.master_site_identity_correction
-- (20260809120000), adapted to this table's "reviewed" terminology per the
-- Stage 5A brief. `reviewed_by` is `text`, not a foreign key to
-- admin_users/auth.users, matching public.parking_repair_manifest.approved_by
-- and public.event_photos.photo_approved_by -- an external/organizational
-- reference, not a live application identity link.
--
-- AUTHORITY (this file was amended twice before ever being applied):
--
-- v1: gated SELECT/record/review on public.is_active_admin(auth.uid())
-- alone -- true for ANY active admin regardless of Tenant, a real
-- cross-Tenant exposure on Tenant-scoped data.
--
-- v2: a repository-wide audit found no governed Tenant-scoped
-- admin-authority primitive existed anywhere in this codebase yet, so
-- every check was tightened to privilege_group = 'super_admin' as a
-- reported, fail-closed interim limitation, pending that primitive being
-- designed and built as its own, separately reviewed piece of work.
--
-- v3 (this version): that primitive now exists --
-- public.has_tenant_admin_authority(auth_user_id, tenant_id), defined in
-- 20260810110000_create_administrative_authority_foundation.sql (applied
-- before this migration -- see that file's ordering note). Every check
-- below now calls it directly in place of the v2 inline super_admin-only
-- predicate. Its own semantics (Super Admin unconditional; otherwise an
-- active, explicit public.admin_tenant_access row for that exact
-- tenant_id) are unchanged by this file -- this migration only swaps
-- which predicate each check uses, per:
--
--   Super Admin      -> venue evidence for any Tenant
--   Tenant Admin(T)  -> venue evidence for Tenant T only
--   Event Admin      -> no venue-evidence authority by default (nothing
--                       below ever calls has_event_admin_authority)
--
-- record_venue_evidence checks has_tenant_admin_authority against the
-- caller-supplied p_tenant_id (the Tenant the new row will belong to --
-- there is no stored row yet to resolve one from). review_venue_evidence
-- checks it against v_row_tenant_id, resolved from the STORED row by
-- p_evidence_id before the authority check runs (unchanged from v2) --
-- never against a caller-supplied Tenant value, so a Tenant A admin
-- cannot review a Tenant B row by passing a different tenant_id, because
-- there is no tenant_id parameter on that function to pass one through.
-- The tenant_id-immutability trigger (prevent_venue_evidence_tenant_change,
-- below) is unchanged -- authority scoping and immutability are enforced
-- independently, neither depends on the other.

-- ---------------------------------------------------------------------------
-- 1. public.venue_evidence
--
--    A piece of provenance-tracked evidence about a venue, from any source
--    type, awaiting or having received admin review. May reference an
--    existing public.master_maps row (evidence about a known venue) or
--    stand alone via `venue_label` (evidence about a venue with no Master
--    Map yet -- the "candidate" stage in Venue Evidence -> Admin review ->
--    Approved Master Map). Never both absent.
-- ---------------------------------------------------------------------------

CREATE TABLE public.venue_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  master_map_id uuid REFERENCES public.master_maps(id),
  venue_label text,

  source_type text NOT NULL CHECK (source_type IN (
    'admin_upload',
    'venue_website',
    'published_pdf',
    'published_image',
    'open_geospatial',
    'public_gis',
    'structured_external_source',
    'manual_entry',
    'field_verification'
  )),
  source_url text,
  source_reference text,

  evidence_quality text NOT NULL DEFAULT 'external' CHECK (evidence_quality IN (
    'governed', 'external', 'partial', 'stale', 'unavailable'
  )),
  -- Deliberately independent of collected_at/created_at, matching
  -- lib/experienceContext's observedAt convention: null means the evidence
  -- itself carries no observation timestamp, never a fabricated one.
  observed_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review', 'approved', 'rejected'
  )),
  reviewed_by text,
  reviewed_at timestamptz,

  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT venue_evidence_review_shape_check CHECK (
    (status = 'pending_review' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT venue_evidence_identifies_a_venue_check CHECK (
    master_map_id IS NOT NULL OR venue_label IS NOT NULL
  )
);

ALTER TABLE public.venue_evidence OWNER TO postgres;

CREATE INDEX venue_evidence_tenant_id_idx ON public.venue_evidence (tenant_id);
CREATE INDEX venue_evidence_master_map_id_idx ON public.venue_evidence (master_map_id) WHERE master_map_id IS NOT NULL;
CREATE INDEX venue_evidence_status_idx ON public.venue_evidence (status);

CREATE OR REPLACE FUNCTION public.set_venue_evidence_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_venue_evidence_updated_at
BEFORE UPDATE ON public.venue_evidence
FOR EACH ROW
EXECUTE FUNCTION public.set_venue_evidence_updated_at();

-- Defense in depth for "changing tenant_id after insertion is impossible":
-- there is no write grant that would let any client change tenant_id
-- directly (see below), and neither governed RPC's UPDATE touches it, but
-- this trigger makes that a structural database guarantee rather than
-- something that merely happens to be true of the current code.
CREATE OR REPLACE FUNCTION public.prevent_venue_evidence_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'venue_evidence.tenant_id is immutable after insert';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_venue_evidence_tenant_change
BEFORE UPDATE ON public.venue_evidence
FOR EACH ROW
EXECUTE FUNCTION public.prevent_venue_evidence_tenant_change();

-- RLS enabled with exactly one policy (SELECT); every write goes through
-- the two governed SECURITY DEFINER functions below, never a raw table
-- INSERT/UPDATE/DELETE grant. This is the "do not create browser-direct
-- writes that bypass governance" requirement, enforced structurally rather
-- than by convention. Deny-by-default posture matches
-- public.responsibilities / public.assignments (20260804140000).
--
-- Authority check: public.has_tenant_admin_authority(auth.uid(), tenant_id)
-- -- Super Admin (any Tenant) or an explicit Tenant Admin for THIS row's
-- own tenant_id. A Tenant A admin's session never satisfies this for a
-- Tenant B row: the primitive compares against the row's actual
-- tenant_id column, per row, not a session-wide flag.

ALTER TABLE public.venue_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.venue_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.venue_evidence FROM anon;
REVOKE ALL ON TABLE public.venue_evidence FROM authenticated;
REVOKE ALL ON TABLE public.venue_evidence FROM service_role;

GRANT SELECT ON TABLE public.venue_evidence TO authenticated;

CREATE POLICY venue_evidence_tenant_admin_select_policy
  ON public.venue_evidence
  FOR SELECT
  TO authenticated
  USING (public.has_tenant_admin_authority(auth.uid(), tenant_id));

-- ---------------------------------------------------------------------------
-- 2. public.record_venue_evidence
--
--    The only legal way to insert a venue_evidence row. Admin-gated (every
--    source_type, including admin_upload, goes through this same governed
--    entry point -- there is no separate "trusted" insert path). Always
--    inserts with status = 'pending_review'; the caller cannot set status,
--    reviewed_by, or reviewed_at directly.
--
--    Authority: public.has_tenant_admin_authority(auth.uid(), p_tenant_id)
--    -- Super Admin may record evidence for any Tenant; a Tenant Admin may
--    record it only for a Tenant they are explicitly assigned to
--    (public.admin_tenant_access). p_tenant_id is otherwise only
--    FK-validated against public.tenants -- the authority check is what
--    prevents an authorized-for-Tenant-A caller from passing an arbitrary
--    p_tenant_id and writing into Tenant B.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_venue_evidence(
  p_tenant_id uuid,
  p_source_type text,
  p_master_map_id uuid DEFAULT NULL,
  p_venue_label text DEFAULT NULL,
  p_source_url text DEFAULT NULL,
  p_source_reference text DEFAULT NULL,
  p_evidence_quality text DEFAULT 'external',
  p_observed_at timestamptz DEFAULT NULL,
  p_collected_at timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_evidence_id uuid;
BEGIN
  IF NOT public.has_tenant_admin_authority(auth.uid(), p_tenant_id) THEN
    RAISE EXCEPTION 'record_venue_evidence: caller is not an active Tenant Admin (or Super Admin) for tenant %', p_tenant_id;
  END IF;

  IF p_master_map_id IS NULL AND (p_venue_label IS NULL OR btrim(p_venue_label) = '') THEN
    RAISE EXCEPTION 'record_venue_evidence: evidence must identify a venue (master_map_id or venue_label)';
  END IF;

  INSERT INTO public.venue_evidence (
    tenant_id,
    master_map_id,
    venue_label,
    source_type,
    source_url,
    source_reference,
    evidence_quality,
    observed_at,
    collected_at,
    notes,
    metadata
  ) VALUES (
    p_tenant_id,
    p_master_map_id,
    p_venue_label,
    p_source_type,
    p_source_url,
    p_source_reference,
    COALESCE(p_evidence_quality, 'external'),
    p_observed_at,
    COALESCE(p_collected_at, now()),
    p_notes,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_evidence_id;

  RETURN v_evidence_id;
END;
$function$;

ALTER FUNCTION public.record_venue_evidence(
  uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_venue_evidence(
  uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_venue_evidence(
  uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.review_venue_evidence
--
--    The only legal way to transition venue_evidence.status out of
--    'pending_review'. Sets reviewed_by/reviewed_at atomically with the
--    decision -- there is no path to an approved/rejected row missing a
--    reviewer. Updates ONLY public.venue_evidence; see the header comment
--    and the in-function comment below for why it must never write to
--    public.master_maps or public.master_map_sites.
--
--    Authority is resolved against the Tenant of the STORED evidence row
--    (v_row_tenant_id, looked up below), never against a caller-supplied
--    Tenant value -- there is no p_tenant_id parameter on this function at
--    all, so there is nothing for a caller to substitute.
--    public.has_tenant_admin_authority(auth.uid(), v_row_tenant_id) is
--    checked only after that lookup succeeds, so a Tenant A admin cannot
--    review a Tenant B row under any input.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.review_venue_evidence(
  p_evidence_id uuid,
  p_decision text,
  p_reviewer text,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row_tenant_id uuid;
BEGIN
  SELECT ve.tenant_id
    INTO v_row_tenant_id
  FROM public.venue_evidence AS ve
  WHERE ve.id = p_evidence_id;

  IF v_row_tenant_id IS NULL THEN
    RAISE EXCEPTION 'review_venue_evidence: no venue_evidence row % found', p_evidence_id;
  END IF;

  IF NOT public.has_tenant_admin_authority(auth.uid(), v_row_tenant_id) THEN
    RAISE EXCEPTION 'review_venue_evidence: caller is not an active Tenant Admin (or Super Admin) for tenant %', v_row_tenant_id;
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'review_venue_evidence: decision must be approved or rejected, got %', p_decision;
  END IF;

  IF p_reviewer IS NULL OR btrim(p_reviewer) = '' THEN
    RAISE EXCEPTION 'review_venue_evidence: reviewer is required';
  END IF;

  UPDATE public.venue_evidence
  SET status = p_decision,
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      notes = COALESCE(p_notes, notes)
  WHERE id = p_evidence_id
    AND status = 'pending_review';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_venue_evidence: no pending_review venue_evidence row % found', p_evidence_id;
  END IF;

  -- Hard rule (Part B.9): this function updates ONLY public.venue_evidence,
  -- above. It must never write to public.master_maps or
  -- public.master_map_sites -- approving evidence makes it a reviewed
  -- candidate/reference, never authoritative venue geometry. Promoting
  -- approved evidence into an actual Master Map change is a separate,
  -- later, explicitly governed pathway (Stage 5F) that does not exist yet.
  -- Do not add such a write here.
END;
$function$;

ALTER FUNCTION public.review_venue_evidence(uuid, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.review_venue_evidence(uuid, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.review_venue_evidence(uuid, text, text, text)
TO authenticated;
